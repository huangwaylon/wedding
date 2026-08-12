/**
 * The whole backend for the Wedding board. Deployed as a web app from the
 * account that OWNS the spreadsheet, with access "Anyone, even anonymous".
 *
 * WHY THIS IS THE WHOLE BACKEND, not a token minter like its sibling app:
 * view-only visitors — the planners — must read the board with NO credential at
 * all. A minted Google token cannot be read-only (`ScriptApp.getOAuthToken()`
 * returns the script's own authorization, and this script needs write access),
 * so handing one to an anonymous reader would hand them write access. Reads
 * therefore have to happen HERE, behind this script, and once they do, routing
 * writes through the same place removes an entire subsystem — no Cloud project,
 * no Sheets API, no token lifetime, no 401 retry.
 *
 *   doGet   PUBLIC. No key. Returns the board. This is what a planner uses.
 *   doPost  Requires APP_KEY in the JSON body. Every mutation.
 *
 * The `/exec` URL ships in a public bundle, so it is not a secret and nothing
 * may depend on it being hard to guess. APP_KEY is the only access control.
 *
 * THIS SCRIPT MUST BE CONTAINER-BOUND to the spreadsheet — created from the sheet
 * via Extensions > Apps Script, never from script.new. That is what makes the
 * `spreadsheets.currentonly` scope in `appsscript.json` possible, and that scope
 * is the confinement: the script is *incapable* of opening any other file, so no
 * standing "this account must own exactly one spreadsheet" condition is needed
 * and no dedicated Google account is either. A standalone script cannot use that
 * scope; `SpreadsheetApp.getActive()` returns null and every call answers
 * `misconfigured`. (If you ever must go standalone, widen the scope to
 * `spreadsheets` and swap `getActive()` for `openById(<a SHEET_ID property>)` —
 * and accept that the token then reaches every sheet the account can see.)
 *
 * CRITICAL: neither handler may throw. An uncaught throw returns Google's HTML
 * error page instead of JSON, and the client classifies a non-JSON reply as a
 * TRANSIENT failure and retries — so a throw on the reject path becomes a silent
 * retry loop. Both entry points are wrapped, and `doPost` re-checks every
 * dereference rather than trusting the parsed body.
 *
 * Never read `e.parameter` for the key. A key in a query string is written into
 * Google's request logs; requiring it in the POST body is what keeps it out.
 *
 * A SHEETS SERVICE CALL IS THE UNIT OF COST and every op is shaped around that:
 * one read of each tab per request, whole-range writes whose cost does not depend
 * on how many cells changed, and a reply composed from what was read rather than
 * from a second read. The arithmetic in between is free.
 */

/**
 * The column contract. This list and the one in `src/schema.js` MUST be
 * identical and in the same order — `test/schema.test.js` parses this file and
 * fails the build if they drift. Two files know the layout because the boundary
 * is a network hop; nothing else in either codebase may.
 */
var TASK_COLUMNS = [
  'id',
  'title',
  'category',
  // The calendar day it is due, 'YYYY-MM-DD'. Not an instant: no clock time, no window,
  // no flags. A task is a title, a day and a tick.
  'due',
  'done_at',
  'created_at',
  'updated_at',
  // APPEND, never rename or reorder: appending is the only change that cannot shift an
  // existing column's index. The client compares this WHOLE list against its own and refuses
  // every write when anything is missing — comparing only the last entry passes a rename
  // anywhere before it. `parent_id` is deliberately not in TEXT_COLUMNS: it is an id, and an
  // id never starts with =, +, - or @.
  'deleted_at',
  'parent_id',
]

var TASKS_SHEET = 'tasks'
var CONFIG_SHEET = 'config'

/**
 * The ops this deployment can dispatch, reported on every reply beside `schema`.
 *
 * A deployment is pinned to a version, so the browser can be running a bundle newer than the
 * script — and an op the script has never heard of comes back `bad_op`, which is indistinguishable
 * from a bug. `schema` answers the COLUMN question and cannot answer this one: a script can hold
 * every column and still not know how to batch. Reporting the list lets the client fold three ticks
 * into one `updateMany` only where that will land, and send three of them where it will not.
 *
 * It must name exactly what `apply` dispatches. A name here that `apply` does not handle is a
 * promise this script breaks; `test/script.test.js` posts every name in the list.
 */
var OPS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'restore',
  'setConfig',
  'compact',
]

/** Free-text columns, which are the ones a formula could hide in. */
var TEXT_COLUMNS = { title: 1, category: 1 }

/**
 * A template seed posts ~40 tasks at once, so this cannot be as tight as a
 * key-only endpoint's. Past this the request is not worth parsing.
 */
var MAX_BODY_BYTES = 256 * 1024

/** Per-cell cap. Sheets tolerates far more; a planning board has no use for it. */
var MAX_CELL_CHARS = 2000

/** Two people on two phones can save at the same moment. */
var LOCK_WAIT_MS = 25000

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * The public read. Anonymous and unauthenticated by design.
 *
 * It never creates structure. Building tabs is a write, and an anonymous request
 * must not cause one — so a spreadsheet with no `tasks` tab answers
 * `needsSetup: true` and an editor's first write does the building.
 *
 * Two tab lookups and one read of each tab, which is the floor for a board.
 */
function doGet() {
  try {
    var book = openBook()
    if (!book) return json({ ok: false, error: 'misconfigured' })
    var tasks = book.getSheetByName(TASKS_SHEET)
    if (!tasks) {
      // `schema` and `ops` MUST be here too. Absence of either is how the client detects a
      // deployment older than its own bundle, and this deployment knows both whether or not the
      // tabs exist yet — omit them and a brand-new board greets its owner with "your script is out
      // of date".
      return json({
        ok: true,
        needsSetup: true,
        tasks: [],
        config: {},
        schema: TASK_COLUMNS,
        ops: OPS,
      })
    }
    var timeZone = book.getSpreadsheetTimeZone()
    var config = book.getSheetByName(CONFIG_SHEET)
    var settings = config ? configFrom(config.getDataRange().getValues(), timeZone) : {}
    return json(board(readBlock(tasks), settings, timeZone))
  } catch (err) {
    return json({ ok: false, error: 'server' })
  }
}

function doPost(e) {
  var lock = null
  try {
    if (!e || !e.postData || !e.postData.contents) return unauthorized()
    if (e.postData.contents.length > MAX_BODY_BYTES) return json({ ok: false, error: 'too_large' })

    var body = null
    try {
      body = JSON.parse(e.postData.contents)
    } catch (_) {
      return unauthorized()
    }
    // `null` parses successfully, so this cannot fold into the catch above.
    if (!body || typeof body !== 'object') return unauthorized()

    var props = PropertiesService.getScriptProperties()
    var key = props.getProperty('APP_KEY')
    if (!key || body.key !== key) return unauthorized()

    var book = openBook()
    if (!book) return json({ ok: false, error: 'misconfigured' })

    // Serialize every mutation. Without this, two simultaneous appends can both
    // resolve the same "next" row and one silently overwrites the other.
    lock = LockService.getScriptLock()
    if (!lock.tryLock(LOCK_WAIT_MS)) return json({ ok: false, error: 'busy' })

    var session = openSession(book)
    if (session.error) return json({ ok: false, error: session.error })

    var failure = apply(session, String(body.op || ''), body.payload)
    if (failure) return json({ ok: false, error: failure })

    /**
     * The fresh board rides back on the write's own reply, so a save costs one round trip rather
     * than two — and it is composed from the grid this request ALREADY read, with the write folded
     * in. Reading the sheet again here would be a second full read of it on every save to learn
     * something the ops can state exactly: each one holds the values it wrote, and `writable` is
     * the only transformation between a value and its cell.
     *
     * Nothing from here on touches the service, so the lock spans exactly the reads and the writes.
     */
    return json(board(session.block, configFrom(session.configRows, session.timeZone), session.timeZone))
  } catch (err) {
    return json({ ok: false, error: 'server' })
  } finally {
    if (lock) lock.releaseLock()
  }
}

/**
 * One reply for every rejection: no length, prefix or position of the key is
 * revealed, and a wrong key is indistinguishable from a missing one.
 *
 * `ContentService` cannot set an HTTP status, so this arrives as a 200 and the
 * BODY is the only signal. The client branches on the body, never on `ok`.
 */
function unauthorized() {
  return json({ ok: false, error: 'unauthorized' })
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/**
 * The container. Null means this script is not bound to a spreadsheet, which is
 * a setup mistake rather than a runtime condition — see the header.
 */
function openBook() {
  try {
    return SpreadsheetApp.getActive() || null
  } catch (_) {
    return null
  }
}

// ---------------------------------------------------------------------------
// One request's view of the spreadsheet
// ---------------------------------------------------------------------------

/**
 * Everything a mutation needs from the spreadsheet, gathered ONCE: both tabs, the zone, the tasks
 * grid with its header repaired, and the config grid.
 *
 * One door rather than one per op, so no op can forget the layout repair and none can pay for a
 * read another op already made. The ops then work from these arrays and fold what they wrote back
 * into them — which is what lets the reply carry the whole board without reading it again.
 *
 * THE HOT PATH IS THE FIRST TWO LINES. Both tabs exist on every write but the first one ever, and
 * `getSheets()` is a service call spent to learn something two lookups already answer. Those two
 * lookups are also the only ones in the request: the sheets are threaded through from here rather
 * than asked for again by each op and again by the reply.
 *
 * @returns {{error: string}|{tasks: Sheet, config: Sheet, block: Array[], configRows: Array[],
 *   timeZone: string}}
 */
function openSession(book) {
  var tasks = book.getSheetByName(TASKS_SHEET)
  var config = book.getSheetByName(CONFIG_SHEET)
  if (!tasks || !config) {
    var failure = buildStructure(book)
    if (failure) return { error: failure }
    tasks = book.getSheetByName(TASKS_SHEET)
    config = book.getSheetByName(CONFIG_SHEET)
  }

  return {
    tasks: tasks,
    config: config,
    block: openTasks(tasks),
    // One service call for the key column and the value column together, and the same array is
    // both what `setConfig` edits and what the reply reports.
    configRows: config.getDataRange().getValues(),
    // Read once and threaded through: `stampDeleted`, `compact` and the reply all need it, and
    // asking twice is two service calls for one unchanging fact.
    timeZone: book.getSpreadsheetTimeZone(),
  }
}

/**
 * The tasks grid, read ONCE, with the header repaired from what was read.
 *
 * @returns {Array[]} the grid as it now stands, header included
 */
function openTasks(sheet) {
  var block = readBlock(sheet)
  // Only ever true when somebody has edited the header row in the Sheets UI. Everything after it
  // works from canonical positions, which is what keeps the ops free of any column-resolving
  // branch of their own.
  if (!headerMatches(block[0])) return relayout(sheet, block)
  return block
}

/**
 * The whole tasks grid INCLUDING the header row, read once.
 *
 * A Sheets service call is the unit of cost in Apps Script — the arithmetic in between is free —
 * so the ops share one read and work from the array, rather than each paying for its own
 * `getValues` to find a row by id and a second one for the row it found. The lock is held, so
 * nothing can move underneath it.
 *
 * `getDataRange` rather than `getLastRow` plus a fixed width: it is ONE service call instead of
 * two, and it reports the columns that are actually there — which is what lets the header check
 * above see a hand-edited header whole, rather than reading as many cells as this layout has and
 * concluding the row is simply wrong.
 *
 * The header is row 0 of the result, which is also what lets `headerMatches` check itself
 * without a read of its own.
 *
 * @returns {Array[]} at least one row (the header)
 */
function readBlock(sheet) {
  var block = sheet.getDataRange().getValues()
  return block.length ? block : [[]]
}

/** Whether a header row is already this script's layout. */
function headerMatches(header) {
  if (!header) return false
  for (var i = 0; i < TASK_COLUMNS.length; i++) {
    if (String(header[i]) !== TASK_COLUMNS[i]) return false
  }
  return true
}

/** column name -> index, from the header row a sheet actually has. */
function columnMap(header) {
  var at = {}
  for (var i = 0; i < (header || []).length; i++) {
    var name = String(header[i] == null ? '' : header[i]).trim()
    if (name && at[name] === undefined) at[name] = i
  }
  return at
}

/**
 * Put the header row back to the current layout, by NAME, and return the grid as it now stands.
 *
 * A person can blank, rename, reorder or add a column in the Sheets UI, and everything else here
 * addresses cells by INDEX — so a tab whose header no longer says what this script expects would
 * have its due dates read as categories. The repair is therefore NOT a rewrite of the header
 * text: each row's values are re-read by the name that row's own header cell gives them and
 * written back in canonical order, so a value follows its label instead of staying in its column.
 * A column the header names that this list does not is dropped, and the columns past this
 * layout's width are cleared so the tab a person opens has no unlabelled leftovers in it.
 *
 * It runs under the doPost lock, from `openTasks`, so no other request can be reading the grid
 * half-moved. `doGet` never reaches it: an anonymous read must not cause a write, which is why
 * `tasksFrom` resolves its own columns by name instead.
 */
function relayout(sheet, block) {
  var header = block[0] || []
  var at = columnMap(header)
  var width = Math.max(header.length, TASK_COLUMNS.length)

  var rows = [TASK_COLUMNS.slice()]
  for (var r = 1; r < block.length; r++) {
    var row = []
    for (var c = 0; c < TASK_COLUMNS.length; c++) {
      row.push(cellByName(block[r], at, TASK_COLUMNS[c]))
    }
    rows.push(row)
  }

  var range = sheet.getRange(1, 1, rows.length, TASK_COLUMNS.length)
  range.setNumberFormat('@')
  range.setValues(rows)
  sheet.getRange(1, 1, 1, TASK_COLUMNS.length).setFontWeight('bold')

  // Whatever sat past the layout's width. Cleared rather than left in place: a stray column under
  // a blank header is exactly the kind of thing somebody deletes by hand, taking a real column
  // with it if the count ever shifts.
  if (width > TASK_COLUMNS.length) {
    sheet
      .getRange(1, TASK_COLUMNS.length + 1, Math.max(rows.length, 1), width - TASK_COLUMNS.length)
      .clearContent()
  }
  return rows
}

/** One cell of a row, by the column NAME that row's own header gives it. */
function cellByName(row, at, column) {
  var index = at[column]
  if (index === undefined) return ''
  var value = row[index]
  return value == null ? '' : String(value)
}

/** id -> 1-based row number within a block from `readBlock`, or 0. */
function rowOfId(block, id) {
  var wanted = String(id == null ? '' : id)
  if (!wanted) return 0
  var column = indexOf('id')
  for (var i = 1; i < block.length; i++) {
    if (String(block[i][column]) === wanted) return i + 1
  }
  return 0
}

/**
 * A SPAN of columns beneath the header row, written as ONE range: one format call and one values
 * call whatever its height.
 *
 * The point of this is that its cost does not depend on how many cells changed. Stamping a parent
 * and its four subtasks is two service calls, where a `setValue` per cell would be ten separate
 * round trips — and because `updated_at` and `deleted_at` are ADJACENT in `TASK_COLUMNS`, both
 * columns of that stamp go in the same two.
 *
 * Untouched cells inside the span are rewritten with what they already hold. What makes that safe
 * is the LOCK, not ownership of the columns: the values came from a read taken inside it, so no
 * other request can have changed them in between.
 *
 * It escapes nothing, so a caller writing a column that can hold free text must hand it cells that
 * are already through `textCell` — `setConfig` does — since `setValues` reads a leading =, +, - or
 * @ as a formula whatever the number format says. The task columns it is used for hold ids and
 * timestamps, which cannot start with one.
 */
function writeSpan(sheet, first, rows) {
  if (!rows.length || !rows[0].length) return
  var range = sheet.getRange(2, first + 1, rows.length, rows[0].length)
  // Format before values, always: with the default format `setValues` parses a timestamp string
  // into a Date and the sheet's locale decides what comes back out.
  range.setNumberFormat('@')
  range.setValues(rows)
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Each op writes the sheet AND folds what it wrote into `session`, because the reply is composed
 * from the session rather than from a second read of the grid.
 *
 * The names it dispatches are reported to the client as `OPS`; see there.
 *
 * @returns {string|null} an error code, or null on success.
 */
function apply(session, op, payload) {
  if (op === 'create') return createTasks(session, [payload && payload.task])
  if (op === 'createMany') return createTasks(session, (payload && payload.tasks) || [])
  if (op === 'update') return updateTasks(session, [payload && payload.task])
  if (op === 'updateMany') return updateTasks(session, (payload && payload.tasks) || [])
  if (op === 'delete') return stampDeleted(session, payload && payload.id, nowIso())
  if (op === 'restore') return stampDeleted(session, payload && payload.id, '')
  if (op === 'setConfig') return setConfig(session, payload && payload.config)
  if (op === 'compact') return compact(session)
  return 'bad_op'
}

/**
 * Append — or REWRITE THE ROW THE ID ALREADY NAMES, which is what makes a create REPLAYABLE.
 *
 * THE ID COMES FROM THE CLIENT, so a create that arrives twice is the same row twice, not two
 * tasks. Appending unconditionally made this the one op that could not be retried: a reply lost to
 * a timeout or a redirect hiccup left the caller unable to tell "nothing was written" from "written,
 * and the answer went missing", and re-sending appended a duplicate nothing could distinguish from
 * a real second task. Resolving the id first costs nothing — the grid is already in hand — and it is
 * what lets `api.js` retry a write at all, since every other op was already idempotent by id.
 *
 * A batch splits the same way: the rows a replay already landed are rewritten in place, and only
 * genuinely new ones are appended. The ordinary case is all-new and still one format and one write.
 */
function createTasks(session, tasks) {
  if (!tasks || !tasks.length) return 'bad_payload'

  var known = []
  var rows = []
  var cells = []
  for (var i = 0; i < tasks.length; i++) {
    var row = toRow(tasks[i])
    if (!row) return 'bad_payload'
    var at = rowOfId(session.block, tasks[i].id)
    if (at) {
      keepCreated(session, at, row)
      known.push({ at: at, row: row })
    } else {
      rows.push(row)
      cells.push(writable(row))
    }
  }

  // Through the same path an update takes, so a replay writes exactly what re-sending the edit
  // would have — one format and one write per run of consecutive rows.
  if (known.length) writeRows(session, known)

  if (cells.length) {
    // `readBlock` returns exactly the used rows, so its length IS the last row.
    var first = session.block.length + 1
    var range = session.tasks.getRange(first, 1, cells.length, TASK_COLUMNS.length)
    // Format BEFORE values, and never the other way round: with the default
    // format, `setValues` parses "2026-08-07T10:00" into a Date and the sheet's
    // own locale then decides what comes back out. Plain text ('@') is what keeps
    // a stored string identical on every device forever.
    range.setNumberFormat('@')
    range.setValues(cells)

    // The seed's whole batch is one append and one growth of the block, so the reply describes the
    // board including every new row with nothing read back.
    for (var j = 0; j < rows.length; j++) session.block.push(rows[j])
  }
  return null
}

/**
 * One update or a batch of them, through the same path — `update` is a batch of one, so there is
 * no second write path to keep in step with this one.
 *
 * WHY A BATCH EXISTS: ticking is the app's highest-frequency gesture and a round trip is ~3s, so
 * three ticks were three of them. Here they are one request, one lock and one read of the grid.
 *
 * IT IS ATOMIC ON RESOLUTION. Every id is resolved before ANY cell is written, so a row a partner
 * deleted mid-batch fails the whole batch with `not_found` and nothing half-applies — the client
 * rolls back and refreshes. Resolving first is free: the grid is already in hand.
 */
function updateTasks(session, tasks) {
  if (!tasks || !tasks.length) return 'bad_payload'

  var rows = []
  for (var i = 0; i < tasks.length; i++) {
    var resolved = resolveRow(session, tasks[i])
    if (resolved.error) return resolved.error
    rows.push(resolved)
  }
  writeRows(session, rows)
  return null
}

/**
 * One payload task against the grid: the cells to write and the row to write them to.
 *
 * BY ID, immediately before writing, never from an index the client sent — positions shift whenever
 * anyone sorts or inserts in the Sheets UI, and writing to a stale one overwrites somebody else's
 * task. The one read serves the lookup, the created_at rescue, the header check and the reply.
 *
 * @returns {{error: string}|{at: number, row: Array}} `at` is 1-based, as a grid row is
 */
function resolveRow(session, task) {
  if (!task || typeof task !== 'object') return { error: 'bad_payload' }
  var row = toRow(task)
  if (!row) return { error: 'bad_payload' }

  var found = rowOfId(session.block, task.id)
  if (!found) return { error: 'not_found' }

  keepCreated(session, found, row)
  return { at: found, row: row }
}

/**
 * created_at BELONGS TO THE ROW, not to whatever the client is holding — one home for that rule,
 * because a replayed create rewrites an existing row and has to honour it exactly as an update does.
 *
 * Normalised on the way through, so a cell the Sheets UI coerced to a Date is written back as a
 * string rather than as "Fri Aug 07 2026 …".
 *
 * @param {number} at 1-based grid row
 */
function keepCreated(session, at, row) {
  var created = readCell(session.block[at - 1][indexOf('created_at')], session.timeZone)
  if (created) row[indexOf('created_at')] = created
}

/**
 * Resolved rows, in as few calls as their positions allow: a RUN of consecutive rows goes as one
 * rectangle, and rows scattered down the sheet cost a format and a write each.
 *
 * The win is the single request and the single lock — the rectangle is what falls out of having
 * them, and three tasks ticked in the same stretch of the plan are usually adjacent in the sheet
 * because that is the order they were seeded in.
 */
function writeRows(session, rows) {
  rows.sort(function (left, right) {
    return left.at - right.at
  })

  var run = []
  for (var i = 0; i < rows.length; i++) {
    var last = run.length ? run[run.length - 1] : null
    // The same row twice in one batch: the last one wins, exactly as two sequential updates would.
    if (last && rows[i].at === last.at) run[run.length - 1] = rows[i]
    else if (last && rows[i].at !== last.at + 1) {
      flushRows(session, run)
      run = [rows[i]]
    } else run.push(rows[i])
  }
  flushRows(session, run)
}

/** One run of consecutive rows, as one format and one write. */
function flushRows(session, run) {
  if (!run.length) return

  var cells = []
  for (var i = 0; i < run.length; i++) cells.push(writable(run[i].row))
  var range = session.tasks.getRange(run[0].at, 1, cells.length, TASK_COLUMNS.length)
  // Format before values, always — see `createTasks`.
  range.setNumberFormat('@')
  range.setValues(cells)

  // The reply is composed from the block, so what the block holds has to be what the cells hold.
  for (var j = 0; j < run.length; j++) session.block[run[j].at - 1] = run[j].row
}

/**
 * Soft delete, and its inverse. Rows never change position, so nobody else's cached indices move
 * — which is also why a restore is free.
 *
 * IT CASCADES TO SUBTASKS, and it does so HERE rather than in the client. Deleting a parent
 * from the browser as N separate calls would be N round trips that can half-fail, leaving some
 * children tombstoned and some not. Done here it is one lock, one reply, all-or-nothing.
 *
 * Restore is the exact inverse for the same reason: a parent that came back without its
 * children would look repaired and be missing work.
 *
 * ITS COST DOES NOT DEPEND ON THE CASCADE'S SIZE. `updated_at` and `deleted_at` are the two ends
 * of one span, so a parent with four subtasks costs the same two service calls as a one-row stamp,
 * where a single-cell `setValue` per row would be ten round trips.
 *
 * Untouched cells in the span are rewritten with what they already hold, normalised through
 * `readCell` — so a cell the Sheets UI had coerced to a Date comes back as the wall-clock string
 * the client is being shown, rather than as "Fri Aug 07 2026 …". See `writeSpan` for why
 * rewriting them is safe.
 */
function stampDeleted(session, id, value) {
  if (!id) return 'bad_payload'
  var block = session.block
  var target = rowOfId(block, id)
  if (!target) return 'not_found'

  var parentIndex = indexOf('parent_id')
  var updatedIndex = indexOf('updated_at')
  var deletedIndex = indexOf('deleted_at')
  var first = Math.min(updatedIndex, deletedIndex)
  var last = Math.max(updatedIndex, deletedIndex)
  var stamp = nowIso()

  var rows = []
  for (var i = 1; i < block.length; i++) {
    var mine = i + 1 === target || String(block[i][parentIndex]) === String(id)
    var line = []
    for (var c = first; c <= last; c++) line.push(readCell(block[i][c], session.timeZone))
    if (mine) {
      line[updatedIndex - first] = stamp
      line[deletedIndex - first] = value
    }
    // Back into the block, because the reply is composed from it.
    for (var w = first; w <= last; w++) block[i][w] = line[w - first]
    rows.push(line)
  }
  writeSpan(session.tasks, first, rows)
  return null
}

function setConfig(session, config) {
  if (!config || typeof config !== 'object') return 'bad_payload'

  var rows = session.configRows
  var seen = {}
  var touched = false
  var values = []

  // Column B in ONE write, not a call per key: Settings saves five or six at a time and each one
  // was a format and a value of its own. Every other row is rewritten with the value it already
  // holds — safe for the reason `writeSpan` gives — and normalised, so a cell somebody coerced to
  // a Date does not come back out as "Fri Apr 18 2027 …".
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][0] == null ? '' : rows[i][0]).trim()
    var mine = name && Object.prototype.hasOwnProperty.call(config, name)
    if (mine) {
      seen[name] = true
      touched = true
    }
    var text = mine ? storedCell(config[name]) : readCell(rows[i][1], session.timeZone)
    rows[i][1] = text
    values.push([textCell(text)])
  }
  if (touched) writeSpan(session.config, 1, values)

  // Whatever the tab has never held, appended in one call for the same reason — at `rows.length + 1`,
  // because the grid came from `getDataRange` and its length IS the last row. The two `getLastRow`
  // calls this used to spend asked for something already in hand.
  var appended = []
  for (var key in config) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    if (seen[key]) continue
    appended.push([storedCell(key), storedCell(config[key])])
  }
  if (appended.length) {
    var cells = []
    for (var a = 0; a < appended.length; a++) {
      cells.push([textCell(appended[a][0]), textCell(appended[a][1])])
    }
    var range = session.config.getRange(rows.length + 1, 1, cells.length, 2)
    range.setNumberFormat('@')
    range.setValues(cells)
    for (var b = 0; b < appended.length; b++) rows.push(appended[b])
  }
  return null
}

/**
 * The only hard delete. Requests must go in DESCENDING row order: deleting row 5
 * shifts row 9 up to row 8, so an ascending pass deletes the wrong rows after
 * the first one.
 */
function compact(session) {
  var sheet = session.tasks
  var block = session.block
  if (block.length < 2) return null

  var deletedIndex = indexOf('deleted_at')
  var parentIndex = indexOf('parent_id')
  var idIndex = indexOf('id')

  // The ids about to disappear. A live child pointing at one of them would be left naming a
  // row that no longer exists; the read promotes it to top level either way, but the sheet is
  // what a person looks at and this is the only moment the information still exists.
  var dying = {}
  for (var i = 1; i < block.length; i++) {
    // A blank id is a stray row somebody typed, and recording it would make every top-level task
    // — all of which name no parent — look orphaned.
    var id = String(block[i][idIndex] || '').trim()
    if (id && String(block[i][deletedIndex] || '').trim()) dying[id] = true
  }

  // Every orphaned pointer in ONE write of the parent_id column: a cascade orphans as many
  // children as the parent had, and a cell at a time each one was a format and a value.
  var orphans = false
  var pointers = []
  for (var j = 1; j < block.length; j++) {
    var live = !String(block[j][deletedIndex] || '').trim()
    var held = readCell(block[j][parentIndex], session.timeZone)
    var orphan = live && Boolean(held && dying[held.trim()])
    if (orphan) orphans = true
    var pointer = orphan ? '' : held
    block[j][parentIndex] = pointer
    pointers.push([pointer])
  }
  if (orphans) writeSpan(sheet, parentIndex, pointers)

  // DESCENDING: deleting row 5 shifts row 9 up to row 8, so an ascending pass deletes the
  // wrong rows after the first one. The block loses the same rows, so the reply describes the
  // compacted board.
  for (var k = block.length - 1; k >= 1; k--) {
    if (String(block[k][deletedIndex] || '').trim()) {
      sheet.deleteRow(k + 1)
      block.splice(k, 1)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function board(block, config, timeZone) {
  return {
    ok: true,
    tasks: tasksFrom(block, timeZone),
    config: config,
    /**
     * The columns THIS deployment understands.
     *
     * A deployment is pinned to a version, so the browser can be running a bundle newer than
     * the script — and the script writes rows by looping its own column list, which means an
     * older one silently DROPS a field it has never heard of: a subtask arrives as a stray
     * top-level task with no error anywhere. Reporting the list lets the client refuse the write
     * and say why instead of quietly making a mess.
     */
    schema: TASK_COLUMNS,
    /** The ops it can dispatch, which its columns cannot imply. See `OPS`. */
    ops: OPS,
    /**
     * The spreadsheet's own zone, reported so the client can warn when it
     * disagrees with the `timezone` config value. Wall-clock times in the sheet
     * are interpreted in the CONFIG zone, never this one — but a mismatch is
     * what makes a hand-typed cell land an hour off, so it is worth surfacing.
     */
    sheetTimeZone: timeZone,
  }
}

/**
 * Every task in a grid, resolved by column NAME rather than by position.
 *
 * BY NAME BECAUSE THE READ PATH MAY NOT WRITE. `doGet` is anonymous, so it cannot call `relayout`
 * to put a hand-edited header straight first — and reading such a grid at this script's own indices
 * would report whatever now sits in `due`'s position as the due date. Resolving from the header
 * row costs nothing (the grid is already in hand) and means a board reads correctly whether or not
 * an editor has written to it since somebody moved a column.
 *
 * It takes the grid rather than reading one, because on the write path the grid is already in hand
 * and reading it back would be a second full read on every save.
 */
function tasksFrom(block, timeZone) {
  if (block.length < 2) return []

  var at = columnMap(block[0])
  var tasks = []
  for (var i = 1; i < block.length; i++) {
    var task = {}
    var empty = true
    for (var c = 0; c < TASK_COLUMNS.length; c++) {
      var column = TASK_COLUMNS[c]
      var index = at[column]
      var text = index === undefined ? '' : readCell(block[i][index], timeZone)
      task[column] = text
      if (text) empty = false
    }
    // A blank row is somebody's stray Enter in the Sheets UI, not a task.
    if (!empty && task.id) tasks.push(task)
  }
  return tasks
}

/** The config tab's key/value rows as an object. */
function configFrom(rows, timeZone) {
  var config = {}
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][0] == null ? '' : rows[i][0]).trim()
    // Through `readCell` like every task cell: a wedding date somebody retyped in the Sheets UI
    // can be a real Date, and `String(new Date())` is unparseable by the client.
    if (name && name !== 'key') config[name] = readCell(rows[i][1], timeZone)
  }
  return config
}

/**
 * Everything leaves here as a string. A cell that a person edited by hand may
 * have been coerced to a Date or a number by the Sheets UI regardless of the
 * '@' format this script writes, and `String(new Date())` would produce
 * "Fri Aug 07 2026 …" — unparseable by the client. Reformatting to wall-clock in
 * the sheet's zone is the recovery for exactly that row.
 */
function readCell(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm")
  return value == null ? '' : String(value)
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * Builds the two tabs, once. Refuses a spreadsheet that already looks like
 * somebody's work: the container is whatever file this script was created from,
 * so binding it to the wrong one is an easy mistake — and adding tabs to a
 * spreadsheet somebody is using is not something undo can reach. A fresh
 * spreadsheet has exactly one default tab, so several tabs with none of ours
 * among them is refused.
 *
 * Only reached when a tab is missing — `openSession` decides that on two lookups, so no save but
 * the first one ever spends a `getSheets()` here.
 *
 * @returns {string|null} an error code, or null when the structure is ready.
 */
function buildStructure(book) {
  var sheets = book.getSheets()
  var names = {}
  for (var i = 0; i < sheets.length; i++) names[sheets[i].getName()] = true

  var ours = names[TASKS_SHEET] || names[CONFIG_SHEET]
  if (!ours && sheets.length > 1) return 'not_empty'

  if (!names[TASKS_SHEET]) {
    var tasks = book.insertSheet(TASKS_SHEET)
    var header = tasks.getRange(1, 1, 1, TASK_COLUMNS.length)
    header.setValues([TASK_COLUMNS])
    header.setFontWeight('bold')
    tasks.setFrozenRows(1)
    // The whole column, not just the used range: a row typed by hand below the
    // data would otherwise be parsed by the sheet's locale.
    tasks.getRange(1, 1, tasks.getMaxRows(), TASK_COLUMNS.length).setNumberFormat('@')
  }

  if (!names[CONFIG_SHEET]) {
    var config = book.insertSheet(CONFIG_SHEET)
    var configHeader = config.getRange(1, 1, 1, 2)
    configHeader.setValues([['key', 'value']])
    configHeader.setFontWeight('bold')
    config.setFrozenRows(1)
    config.getRange(1, 1, config.getMaxRows(), 2).setNumberFormat('@')
  }

  // The default "Sheet1" left behind by a brand-new spreadsheet. Only looked for on the write that
  // CREATED a tab — which is the only write that reaches this function at all. Removed only when
  // it is empty and ours both exist, so it can never take a populated tab with it.
  var leftover = book.getSheetByName('Sheet1')
  if (leftover && book.getSheets().length > 2 && leftover.getLastRow() === 0) {
    book.deleteSheet(leftover)
  }

  return null
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function indexOf(column) {
  return TASK_COLUMNS.indexOf(column)
}

/**
 * One task's cells AS THE SHEET WILL READ THEM BACK — which is also what the reply carries, since
 * the reply is composed from the block these rows are folded into. `writable` is what turns this
 * into the values to send.
 *
 * @returns {Array|null} the cell values for one task, or null if unusable.
 */
function toRow(task) {
  if (!task || typeof task !== 'object') return null
  if (!task.id || typeof task.id !== 'string') return null
  if (!clamp(task.title)) return null

  var row = []
  for (var i = 0; i < TASK_COLUMNS.length; i++) {
    row.push(storedCell(task[TASK_COLUMNS[i]]))
  }
  if (!row[indexOf('created_at')]) row[indexOf('created_at')] = nowIso()
  row[indexOf('updated_at')] = nowIso()
  return row
}

/**
 * The same row, escaped for the write. Sheets consumes the leading apostrophe, so the cell ends up
 * holding the row `toRow` built — which is why the reply may state that row without reading the
 * sheet back to see what became of it.
 */
function writable(row) {
  var cells = []
  for (var i = 0; i < TASK_COLUMNS.length; i++) {
    cells.push(TEXT_COLUMNS[TASK_COLUMNS[i]] ? textCell(row[i]) : row[i])
  }
  return cells
}

function clamp(value) {
  if (value == null) return ''
  var text = String(value)
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text
}

/**
 * The value the CELL will hold, which is what the reply reports.
 *
 * A leading apostrophe is Sheets' own literal-text escape and it is consumed on the way in —
 * `textCell`'s, and equally a title somebody typed as "'96 vintage". The reply states the stored
 * value rather than reading the sheet back to see it, so it has to drop the same character the
 * sheet does or a save would echo an apostrophe that vanishes on the next refresh.
 */
function storedCell(value) {
  var text = clamp(value)
  return text.charAt(0) === "'" ? text.slice(1) : text
}

/**
 * `setValue` parses a leading =, +, - or @ as a formula whatever the cell's
 * number format is, so a note of "=SUM(A:A)" would become a live formula — and
 * "-2 guests" would become a negative number. A leading apostrophe is Sheets'
 * own literal-text escape, and `getValue()` returns the text without it, so this
 * round-trips exactly.
 */
function textCell(value) {
  var text = String(value == null ? '' : value)
  return /^[=+\-@]/.test(text) ? "'" + text : text
}

function nowIso() {
  return new Date().toISOString()
}
