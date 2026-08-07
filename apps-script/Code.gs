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
    return json(board(book))
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

    var failure = apply(book, String(body.op || ''), body.payload)
    if (failure) return json({ ok: false, error: failure })

    // The fresh board rides back on the write's own reply, so a save costs one
    // round trip rather than two.
    return json(board(book))
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
function apply(book, op, payload) {
  if (op === 'create') return createTasks(book, [payload && payload.task])
  if (op === 'createMany') return createTasks(book, (payload && payload.tasks) || [])
  if (op === 'update') return updateTask(book, payload && payload.task)
  if (op === 'delete') return stampDeleted(book, payload && payload.id, nowIso())
  if (op === 'restore') return stampDeleted(book, payload && payload.id, '')
  if (op === 'setConfig') return setConfig(book, payload && payload.config)
  if (op === 'compact') return compact(book)
  return 'bad_op'
}

function createTasks(book, tasks) {
  if (!tasks || !tasks.length) return 'bad_payload'

  var rows = []
  for (var i = 0; i < tasks.length; i++) {
    var row = toRow(tasks[i])
    if (!row) return 'bad_payload'
    rows.push(row)
  }

  var sheet = book.getSheetByName(TASKS_SHEET)
  var first = sheet.getLastRow() + 1
  var range = sheet.getRange(first, 1, rows.length, TASK_COLUMNS.length)
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

  var sheet = book.getSheetByName(TASKS_SHEET)
  // Resolve id -> row immediately before writing. A row number cached by the
  // client is advisory only: positions shift whenever anyone sorts or inserts in
  // the Sheets UI, and writing to a stale index overwrites someone else's task.
  var found = findRow(sheet, task.id)
  if (!found) return 'not_found'

  // created_at belongs to the row, not to whatever the client is holding.
  var existing = sheet.getRange(found, 1, 1, TASK_COLUMNS.length).getValues()[0]
  row[indexOf('created_at')] = existing[indexOf('created_at')] || row[indexOf('created_at')]

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
function stampDeleted(book, id, value) {
  if (!id) return 'bad_payload'
  var sheet = book.getSheetByName(TASKS_SHEET)
  var row = findRow(sheet, id)
  if (!row) return 'not_found'

  stampOne(sheet, row, value)

  // Children by parent_id. A subtask has no children of its own — one level only — so this
  // cannot recurse and needs no visited set.
  var last = sheet.getLastRow()
  if (last < 2) return null
  var parents = sheet.getRange(2, indexOf('parent_id') + 1, last - 1, 1).getValues()
  for (var i = 0; i < parents.length; i++) {
    if (String(parents[i][0]) === String(id)) stampOne(sheet, i + 2, value)
  }
  return null
}

function stampOne(sheet, row, value) {
  var cell = sheet.getRange(row, indexOf('deleted_at') + 1)
  cell.setNumberFormat('@')
  cell.setValue(value)
  touch(sheet, row)
}

function touch(sheet, row) {
  var cell = sheet.getRange(row, indexOf('updated_at') + 1)
  cell.setNumberFormat('@')
  cell.setValue(nowIso())
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
  var sheet = book.getSheetByName(TASKS_SHEET)
  var last = sheet.getLastRow()
  if (last < 2) return null

  var rows = sheet.getRange(2, 1, last - 1, TASK_COLUMNS.length).getValues()
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

function board(book) {
  var timeZone = book.getSpreadsheetTimeZone()
  return {
    ok: true,
    tasks: readTasks(book, timeZone),
    config: readConfig(book),
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

  if (!names[TASKS_SHEET]) {
    var tasks = book.insertSheet(TASKS_SHEET)
    var header = tasks.getRange(1, 1, 1, TASK_COLUMNS.length)
    header.setValues([TASK_COLUMNS])
    header.setFontWeight('bold')
    tasks.setFrozenRows(1)
    // The whole column, not just the used range: a row typed by hand below the
    // data would otherwise be parsed by the sheet's locale.
    tasks.getRange(1, 1, tasks.getMaxRows(), TASK_COLUMNS.length).setNumberFormat('@')
  } else {
    healHeader(book.getSheetByName(TASKS_SHEET))
  }

  if (!names[CONFIG_SHEET]) {
    var config = book.insertSheet(CONFIG_SHEET)
    var configHeader = config.getRange(1, 1, 1, 2)
    configHeader.setValues([['key', 'value']])
    configHeader.setFontWeight('bold')
    config.setFrozenRows(1)
    config.getRange(1, 1, config.getMaxRows(), 2).setNumberFormat('@')
  }

  // The default "Sheet1" left behind by a brand-new spreadsheet. Removed only
  // when it is empty and ours exist, so it can never take a populated tab with
  // it.
  var leftover = book.getSheetByName('Sheet1')
  if (leftover && book.getSheets().length > 2 && leftover.getLastRow() === 0) {
    book.deleteSheet(leftover)
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
function healHeader(sheet) {
  if (!sheet) return
  var width = TASK_COLUMNS.length
  var header = sheet.getRange(1, 1, 1, width).getValues()[0]
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

/** id -> 1-based row number, or 0. */
function findRow(sheet, id) {
  var wanted = String(id == null ? '' : id)
  if (!wanted) return 0
  var last = sheet.getLastRow()
  if (last < 2) return 0
  var ids = sheet.getRange(2, indexOf('id') + 1, last - 1, 1).getValues()
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === wanted) return i + 2
  }
  return 0
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
