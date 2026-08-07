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
  'start',
  'end',
  'all_day',
  'done_at',
  'notes',
  'owner',
  'created_at',
  'updated_at',
  'deleted_at',
  // Appended LAST and it must stay last: appending is the only change that cannot shift an
  // existing column's index. Deliberately not in TEXT_COLUMNS — it is an id, and an id never
  // starts with =, +, - or @.
  'parent_id',
]

var TASKS_SHEET = 'tasks'
var CONFIG_SHEET = 'config'

/** Free-text columns, which are the ones a formula could hide in. */
var TEXT_COLUMNS = { title: 1, category: 1, notes: 1, owner: 1 }

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
      return json({ ok: true, needsSetup: true, tasks: [], config: {} })
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
    // it was two service calls for one unchanging fact.
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
 * One door rather than four call sites, so no op can forget the heal and none can pay for a
 * second read to do it. `healHeader` used to run inside `ensureStructure` with a read of its own,
 * on every single write, to check a row this already has in hand.
 *
 * @returns {{sheet: Sheet, block: Array[]}}
 */
function openTasks(book) {
  var sheet = book.getSheetByName(TASKS_SHEET)
  var block = readBlock(sheet)
  healHeader(sheet, block[0])
  return { sheet: sheet, block: block }
}

/**
 * The whole tasks grid INCLUDING the header row, read once.
 *
 * Every op that has to find a row by id used to pay for its own `getValues` and then a second
 * one for the row it found; `stampDeleted` additionally read the parent column. A Sheets service
 * call is the unit of cost in Apps Script — the arithmetic in between is free — so the ops share
 * one read and work from the array. The lock is held, so nothing can move underneath it.
 *
 * The header is row 0 of the result, which is also what lets `healHeader` check itself without a
 * read of its own.
 *
 * @returns {Array[]} at least one row (the header)
 */
function readBlock(sheet) {
  var last = sheet.getLastRow()
  var rows = Math.max(1, last)
  return sheet.getRange(1, 1, rows, TASK_COLUMNS.length).getValues()
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
 * The point of this is that its cost does not depend on how many cells changed: stamping a
 * parent and its four subtasks was ten separate `setValue`s, each its own round trip, and
 * measured 3.6–4.0s against 2.66s for a single row. Two calls of this replace all of them.
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
   * Two whole-column writes, and their cost does NOT depend on how many rows changed. A parent
   * with four subtasks was ten single-cell `setValue`s — measured 3.6–4.0s against 2.66s for a
   * one-row stamp, all of it round trips.
   *
   * Untouched cells are rewritten with what they already hold, normalised through `readCell` —
   * so a cell the Sheets UI had coerced to a Date comes back as the wall-clock string the client
   * is already being shown, rather than as "Fri Aug 07 2026 …". These are the script's own two
   * bookkeeping columns and nothing else writes them, which is what makes that safe.
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
  var last = sheet.getLastRow()
  var existing = last > 1 ? sheet.getRange(2, 1, last - 1, 2).getValues() : []

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
     * older one silently DROPS a field it has never heard of. That is how a subtask arrived as
     * a stray top-level task with no error anywhere. Reporting the list lets the client refuse
     * the write and say why instead of quietly making a mess.
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

function readTasks(book, timeZone) {
  var sheet = book.getSheetByName(TASKS_SHEET)
  var last = sheet.getLastRow()
  if (last < 2) return []

  var values = sheet.getRange(2, 1, last - 1, TASK_COLUMNS.length).getValues()
  var tasks = []
  for (var i = 0; i < values.length; i++) {
    var task = {}
    var empty = true
    for (var c = 0; c < TASK_COLUMNS.length; c++) {
      var text = readCell(values[i][c], timeZone)
      task[TASK_COLUMNS[c]] = text
      if (text) empty = false
    }
    // A blank row is somebody's stray Enter in the Sheets UI, not a task.
    if (!empty && task.id) tasks.push(task)
  }
  return tasks
}

function readConfig(book) {
  var sheet = book.getSheetByName(CONFIG_SHEET)
  if (!sheet) return {}
  var last = sheet.getLastRow()
  if (last < 2) return {}

  var values = sheet.getRange(2, 1, last - 1, 2).getValues()
  var config = {}
  for (var i = 0; i < values.length; i++) {
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

/**
 * Bring an existing tab's header row up to date when the column list grows.
 *
 * This is not migration code and it moves no data: reads and writes already address columns by
 * index, so a board created before a column existed keeps working with a blank cell. What it
 * fixes is the SHEET a person looks at — otherwise the new column has data under an empty
 * header, which is exactly the kind of thing somebody deletes by hand. Idempotent, and it
 * writes only when the row actually differs.
 */
function healHeader(sheet, header) {
  if (!sheet || !header) return
  var width = TASK_COLUMNS.length
  for (var i = 0; i < width; i++) {
    if (String(header[i]) !== TASK_COLUMNS[i]) {
      var range = sheet.getRange(1, 1, 1, width)
      range.setNumberFormat('@')
      range.setValues([TASK_COLUMNS])
      range.setFontWeight('bold')
      return
    }
  }
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
