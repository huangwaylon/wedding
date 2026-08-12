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
 */
function doGet() {
  try {
    var book = openBook()
    if (!book) return json({ ok: false, error: 'misconfigured' })
    if (!book.getSheetByName(TASKS_SHEET)) {
      // `schema` MUST be here too. Absence of it is how the client detects a deployment older than
      // its own bundle, and this deployment knows its columns whether or not the tabs exist yet —
      // omit it and a brand-new board greets its owner with "your script is out of date".
      return json({ ok: true, needsSetup: true, tasks: [], config: {}, schema: TASK_COLUMNS })
    }
    return json(board(book, book.getSpreadsheetTimeZone()))
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

    var structure = ensureStructure(book)
    if (structure) return json({ ok: false, error: structure })

    // Read once per request and threaded through: `stampDeleted` and `board` both need it, and
    // asking twice is two service calls for one unchanging fact.
    var timeZone = book.getSpreadsheetTimeZone()
    var failure = apply(book, timeZone, String(body.op || ''), body.payload)
    if (failure) return json({ ok: false, error: failure })

    // The fresh board rides back on the write's own reply, so a save costs one
    // round trip rather than two.
    return json(board(book, timeZone))
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
// Operations
// ---------------------------------------------------------------------------

/** @returns {string|null} an error code, or null on success. */
function apply(book, timeZone, op, payload) {
  if (op === 'create') return createTasks(book, [payload && payload.task])
  if (op === 'createMany') return createTasks(book, (payload && payload.tasks) || [])
  if (op === 'update') return updateTask(book, payload && payload.task)
  // The zone is only used to normalise a cell somebody hand-edited into a Date; see stampDeleted.
  if (op === 'delete') return stampDeleted(book, payload && payload.id, nowIso(), timeZone)
  if (op === 'restore') return stampDeleted(book, payload && payload.id, '', timeZone)
  if (op === 'setConfig') return setConfig(book, payload && payload.config)
  if (op === 'compact') return compact(book)
  return 'bad_op'
}

/**
 * The tasks tab and its whole grid, read ONCE, with the header repaired from what was read.
 *
 * One door rather than four call sites, so no op can forget the repair and none can pay for a
 * second read to do it.
 *
 * @returns {{sheet: Sheet, block: Array[]}}
 */
function openTasks(book) {
  var sheet = book.getSheetByName(TASKS_SHEET)
  var block = readBlock(sheet)
  // Only ever true when somebody has edited the header row in the Sheets UI. Everything after it
  // works from canonical positions, which is what keeps the ops free of any column-resolving
  // branch of their own.
  if (!headerMatches(block[0])) block = relayout(sheet, block)
  return { sheet: sheet, block: block }
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
 * `readTasks` resolves its own columns by name instead.
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
 * One column of a block, written in a single call.
 *
 * The point of this is that its cost does not depend on how many cells changed: stamping a parent
 * and its four subtasks is two calls of this, where a `setValue` per cell would be ten separate
 * round trips.
 *
 * Only the script's OWN bookkeeping columns go through here (`updated_at`, `deleted_at`), which
 * is what makes rewriting untouched cells harmless — they are rewritten with the value the
 * client is already being shown.
 */
function writeColumn(sheet, index, values) {
  if (!values.length) return
  var range = sheet.getRange(2, index + 1, values.length, 1)
  // Format before values, always: with the default format `setValues` parses a timestamp string
  // into a Date and the sheet's locale decides what comes back out.
  range.setNumberFormat('@')
  range.setValues(values)
}

function createTasks(book, tasks) {
  if (!tasks || !tasks.length) return 'bad_payload'

  var rows = []
  for (var i = 0; i < tasks.length; i++) {
    var row = toRow(tasks[i])
    if (!row) return 'bad_payload'
    rows.push(row)
  }

  var opened = openTasks(book)
  // `readBlock` returns exactly the used rows, so its length IS the last row.
  var first = opened.block.length + 1
  var range = opened.sheet.getRange(first, 1, rows.length, TASK_COLUMNS.length)
  // Format BEFORE values, and never the other way round: with the default
  // format, `setValues` parses "2026-08-07T10:00" into a Date and the sheet's
  // own locale then decides what comes back out. Plain text ('@') is what keeps
  // a stored string identical on every device forever.
  range.setNumberFormat('@')
  range.setValues(rows)
  return null
}

function updateTask(book, task) {
  if (!task || typeof task !== 'object') return 'bad_payload'
  var row = toRow(task)
  if (!row) return 'bad_payload'

  // Resolved by ID immediately before writing, never from an index the client sent: positions
  // shift whenever anyone sorts or inserts in the Sheets UI, and writing to a stale one
  // overwrites somebody else's task. One read serves the lookup, the created_at rescue and the
  // header check.
  var opened = openTasks(book)
  var sheet = opened.sheet
  var block = opened.block
  var found = rowOfId(block, task.id)
  if (!found) return 'not_found'

  // created_at belongs to the row, not to whatever the client is holding.
  var created = block[found - 1][indexOf('created_at')]
  if (created) row[indexOf('created_at')] = created

  var range = sheet.getRange(found, 1, 1, TASK_COLUMNS.length)
  range.setNumberFormat('@')
  range.setValues([row])
  return null
}

/**
 * Soft delete, and its inverse. One cell write per row, so rows never change position and
 * nobody else's cached indices move — which is also why a restore is free.
 *
 * IT CASCADES TO SUBTASKS, and it does so HERE rather than in the client. Deleting a parent
 * from the browser as N separate calls would be N round trips that can half-fail, leaving some
 * children tombstoned and some not. Done here it is one lock, one reply, all-or-nothing.
 *
 * Restore is the exact inverse for the same reason: a parent that came back without its
 * children would look repaired and be missing work.
 */
function stampDeleted(book, id, value, timeZone) {
  if (!id) return 'bad_payload'
  var opened = openTasks(book)
  var sheet = opened.sheet
  var block = opened.block
  var target = rowOfId(block, id)
  if (!target) return 'not_found'

  var parentIndex = indexOf('parent_id')
  var updatedIndex = indexOf('updated_at')
  var deletedIndex = indexOf('deleted_at')
  var stamp = nowIso()

  /**
   * Two whole-column writes, and their cost does NOT depend on how many rows changed: a parent
   * with four subtasks costs the same two calls as a one-row stamp, where a single-cell
   * `setValue` per row would be ten round trips.
   *
   * Untouched cells are rewritten with what they already hold, normalised through `readCell` —
   * so a cell the Sheets UI had coerced to a Date comes back as the wall-clock string the client
   * is already being shown, rather than as "Fri Aug 07 2026 …". What makes rewriting them safe is
   * the LOCK, not ownership of the columns: the values come from a read taken inside the same lock,
   * so no other request can have changed them in between. (`updated_at` is script-only, but
   * `deleted_at` is not — `toRow` copies it from the client on every create and update.)
   */
  var updated = []
  var deleted = []
  for (var i = 1; i < block.length; i++) {
    var mine = i + 1 === target || String(block[i][parentIndex]) === String(id)
    updated.push([mine ? stamp : readCell(block[i][updatedIndex], timeZone)])
    deleted.push([mine ? value : readCell(block[i][deletedIndex], timeZone)])
  }
  writeColumn(sheet, updatedIndex, updated)
  writeColumn(sheet, deletedIndex, deleted)
  return null
}

function setConfig(book, config) {
  if (!config || typeof config !== 'object') return 'bad_payload'

  var sheet = book.getSheetByName(CONFIG_SHEET)
  var block = sheet.getDataRange().getValues()
  var existing = block.length > 1 ? block.slice(1) : []

  var rowOf = {}
  for (var i = 0; i < existing.length; i++) {
    var name = String(existing[i][0] || '').trim()
    if (name) rowOf[name] = i + 2
  }

  for (var name in config) {
    if (!Object.prototype.hasOwnProperty.call(config, name)) continue
    var value = clamp(config[name])
    if (rowOf[name]) {
      var cell = sheet.getRange(rowOf[name], 2)
      cell.setNumberFormat('@')
      cell.setValue(textCell(value))
    } else {
      var appended = sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2)
      appended.setNumberFormat('@')
      appended.setValues([[clamp(name), textCell(value)]])
      rowOf[name] = sheet.getLastRow()
    }
  }
  return null
}

/**
 * The only hard delete. Requests must go in DESCENDING row order: deleting row 5
 * shifts row 9 up to row 8, so an ascending pass deletes the wrong rows after
 * the first one.
 */
function compact(book) {
  var opened = openTasks(book)
  var sheet = opened.sheet
  if (opened.block.length < 2) return null

  var rows = opened.block.slice(1)
  var deletedIndex = indexOf('deleted_at')
  var parentIndex = indexOf('parent_id')
  var idIndex = indexOf('id')

  // The ids about to disappear. A live child pointing at one of them would be left naming a
  // row that no longer exists; the read promotes it to top level either way, but the sheet is
  // what a person looks at and this is the only moment the information still exists.
  var dying = {}
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][deletedIndex] || '').trim()) dying[String(rows[i][idIndex])] = true
  }
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j][deletedIndex] || '').trim()) continue
    if (!dying[String(rows[j][parentIndex])]) continue
    var cell = sheet.getRange(j + 2, parentIndex + 1)
    cell.setNumberFormat('@')
    cell.setValue('')
  }

  // DESCENDING: deleting row 5 shifts row 9 up to row 8, so an ascending pass deletes the
  // wrong rows after the first one.
  for (var k = rows.length - 1; k >= 0; k--) {
    if (String(rows[k][deletedIndex] || '').trim()) sheet.deleteRow(k + 2)
  }
  return null
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function board(book, timeZone) {
  return {
    ok: true,
    tasks: readTasks(book, timeZone),
    config: readConfig(book),
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
 * Every task, resolved by column NAME rather than by position.
 *
 * BY NAME BECAUSE THIS PATH MAY NOT WRITE. `doGet` is anonymous, so it cannot call `relayout` to
 * put a hand-edited header straight first — and reading such a grid at this script's own indices
 * would report whatever now sits in `due`'s position as the due date. Resolving from the header
 * row costs nothing (the grid is already in hand) and means a board reads correctly whether or not
 * an editor has written to it since somebody moved a column.
 *
 * `getDataRange` is one service call for the header and the rows together.
 */
function readTasks(book, timeZone) {
  var sheet = book.getSheetByName(TASKS_SHEET)
  var block = sheet.getDataRange().getValues()
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

/**
 * One service call, not two. `getLastRow` followed by a sized `getValues` asks the grid twice for
 * what `getDataRange` answers once, on the reply to every single write.
 */
function readConfig(book) {
  var sheet = book.getSheetByName(CONFIG_SHEET)
  if (!sheet) return {}
  var values = sheet.getDataRange().getValues()
  var config = {}
  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][0] == null ? '' : values[i][0]).trim()
    if (name && name !== 'key') config[name] = String(values[i][1] == null ? '' : values[i][1])
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
 * @returns {string|null} an error code, or null when the structure is ready.
 */
function ensureStructure(book) {
  // THE HOT PATH IS THE FIRST TWO LINES. Both tabs exist on every write but the first one ever,
  // and `getSheets()` is a service call — the unit of cost here — spent on every save to learn
  // something two lookups already answer.
  if (book.getSheetByName(TASKS_SHEET) && book.getSheetByName(CONFIG_SHEET)) return null

  var sheets = book.getSheets()
  var names = {}
  for (var i = 0; i < sheets.length; i++) names[sheets[i].getName()] = true

  var ours = names[TASKS_SHEET] || names[CONFIG_SHEET]
  if (!ours && sheets.length > 1) return 'not_empty'

  var built = false
  if (!names[TASKS_SHEET]) {
    built = true
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
    built = true
    var config = book.insertSheet(CONFIG_SHEET)
    var configHeader = config.getRange(1, 1, 1, 2)
    configHeader.setValues([['key', 'value']])
    configHeader.setFontWeight('bold')
    config.setFrozenRows(1)
    config.getRange(1, 1, config.getMaxRows(), 2).setNumberFormat('@')
  }

  // The default "Sheet1" left behind by a brand-new spreadsheet. Only worth looking for on the
  // write that CREATED a tab — after that it is either long gone or somebody's real sheet, and
  // asking every write costs a service call for nothing. Removed only when it is empty and ours
  // both exist, so it can never take a populated tab with it.
  if (built) {
    var leftover = book.getSheetByName('Sheet1')
    if (leftover && book.getSheets().length > 2 && leftover.getLastRow() === 0) {
      book.deleteSheet(leftover)
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function indexOf(column) {
  return TASK_COLUMNS.indexOf(column)
}

/** @returns {Array|null} the cell values for one task, or null if unusable. */
function toRow(task) {
  if (!task || typeof task !== 'object') return null
  if (!task.id || typeof task.id !== 'string') return null
  if (!clamp(task.title)) return null

  var row = []
  for (var i = 0; i < TASK_COLUMNS.length; i++) {
    var column = TASK_COLUMNS[i]
    var value = clamp(task[column])
    row.push(TEXT_COLUMNS[column] ? textCell(value) : value)
  }
  if (!row[indexOf('created_at')]) row[indexOf('created_at')] = nowIso()
  row[indexOf('updated_at')] = nowIso()
  return row
}

function clamp(value) {
  if (value == null) return ''
  var text = String(value)
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text
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
