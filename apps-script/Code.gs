/**
 * The board's anonymous read, and the token that buys the write half.
 *
 * A web app deployed from the account that OWNS the spreadsheet, access "Anyone, even anonymous".
 * `doGet` takes no credential; `doPost` mints a Google access token for a JSON body carrying
 * APP_KEY. The `/exec` URL ships in a public bundle, so APP_KEY is the only access control.
 *
 * Writes live in `src/lib/sheets.js`: `/exec` costs 1.0–1.6s before this file runs a line — a 302
 * to the echo URL, plus a container start — against ~0.24s for the Sheets API. `doGet` stays
 * because a planner must read with no credential and a minted token cannot be read-only;
 * `ScriptApp.getOAuthToken()` returns this script's own authorization, which can write.
 *
 * Neither handler may throw: the HTML error page an uncaught throw returns reads as transient to
 * the client, which retries, so a throw on the reject path is a silent retry loop. Both entry
 * points are wrapped and `doPost` re-checks every dereference.
 *
 * Never read `e.parameter` for the key: a query string reaches Google's request logs. There is no
 * `doOptions`: the mint is `text/plain`, a CORS simple request, so no preflight is made — one
 * would be answered with the 302 and fail.
 *
 * The script must stay container-bound, created from the sheet via Extensions > Apps Script.
 * `getActive()` names the file, so there is no SHEET_ID to get wrong, and a standalone script
 * returns null from it and answers `misconfigured`.
 *
 * The scope is `spreadsheets`, not `spreadsheets.currentonly`: the REST API rejects a token
 * carrying only that Apps-Script-runtime scope, and the wide one reaches every spreadsheet the
 * owning account can see. Container binding confines the script, not the token, so that account
 * should own nothing else (README's security model).
 */

/**
 * The column contract, identical to `src/schema.js`'s list and in the same order. The boundary is a
 * network hop, so neither side can import the other; `test/schema.test.js` parses this file and
 * fails on drift. `tasksFrom` shapes the reply from this list, so a column missing here is a field
 * a planner never sees.
 */
var TASK_COLUMNS = [
  'id',
  'title',
  'category',
  // The calendar day it is due, 'YYYY-MM-DD'. Not an instant: no clock time, no window, no flags.
  // A task is a title, a day and a tick.
  'due',
  'done_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'parent_id',
]

var TASKS_SHEET = 'tasks'
var CONFIG_SHEET = 'config'

/** The only legitimate body is `{"key":"<64 hex>"}`. */
var MAX_BODY_BYTES = 1024

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * The public read. It never creates structure — building tabs is a write — so a spreadsheet with no
 * `tasks` tab answers `needsSetup: true` and an editor's first write builds them from the client.
 */
function doGet() {
  try {
    var book = openBook()
    if (!book) return json({ ok: false, error: 'misconfigured' })
    var tasks = book.getSheetByName(TASKS_SHEET)
    if (!tasks) return json({ ok: true, needsSetup: true, tasks: [], config: {} })

    var timeZone = book.getSpreadsheetTimeZone()
    var config = book.getSheetByName(CONFIG_SHEET)
    var settings = config ? configFrom(config.getDataRange().getValues(), timeZone) : {}
    return json({
      ok: true,
      tasks: tasksFrom(readBlock(tasks), timeZone),
      config: settings,
      // Reported so the client can warn when it disagrees with the `timezone` config value:
      // cells are interpreted in the config zone, and a mismatch lands a hand-typed cell an
      // hour off.
      sheetTimeZone: timeZone,
    })
  } catch (err) {
    return json({ ok: false, error: 'server' })
  }
}

/**
 * Mint an access token for an editor. It is the owning account's token, not the caller's, so nothing
 * here identifies a person: the key is a capability and the token is what it buys. The reply is
 * exactly `{ok, token, spreadsheetId}` or `{ok:false, error}` — never an exception message, never
 * an echo of the request.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return unauthorized()
    if (e.postData.contents.length > MAX_BODY_BYTES) return unauthorized()

    var body = null
    try {
      body = JSON.parse(e.postData.contents)
    } catch (_) {
      return unauthorized()
    }
    // `null` parses successfully, so this cannot fold into the catch above.
    if (!body || typeof body !== 'object') return unauthorized()

    var key = PropertiesService.getScriptProperties().getProperty('APP_KEY')
    if (!key || body.key !== key) return unauthorized()

    var book = openBook()
    if (!book) return json({ ok: false, error: 'misconfigured' })

    return json({
      ok: true,
      token: ScriptApp.getOAuthToken(),
      // From the container, not a property: a bound script cannot be pointed at the wrong file.
      spreadsheetId: book.getId(),
    })
  } catch (err) {
    return json({ ok: false, error: 'server' })
  }
}

/**
 * One reply for every rejection: a wrong key is indistinguishable from a missing one, and no
 * length, prefix or position is revealed. `ContentService` cannot set an HTTP status, so this
 * arrives as a 200 and the body is the only signal; the client never branches on `response.ok`.
 */
function unauthorized() {
  return json({ ok: false, error: 'unauthorized' })
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/** The container. Null means the script is not bound to a spreadsheet; see the header. */
function openBook() {
  try {
    return SpreadsheetApp.getActive() || null
  } catch (_) {
    return null
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The whole tasks grid including the header row, read once. `getDataRange` rather than `getLastRow`
 * plus a fixed width: one service call, and it reports the columns that are there, which is what
 * lets `tasksFrom` resolve a hand-edited header.
 *
 * @returns {Array[]} at least one row (the header)
 */
function readBlock(sheet) {
  var block = sheet.getDataRange().getValues()
  return block.length ? block : [[]]
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
 * Every task in a grid, resolved by column name. This handler is anonymous, so it cannot repair a
 * header blanked, renamed or reordered in the Sheets UI, and reading at fixed indices would report
 * whatever sits in `due`'s position as the due date. The grid is in hand, so header resolution is
 * free. `relayout` in `src/lib/sheets.js` repairs the layout on an editor's next write.
 */
function tasksFrom(block, timeZone) {
  if (block.length < 2) return []

  var at = columnMap(block[0])
  var tasks = []
  for (var i = 1; i < block.length; i++) {
    var task = {}
    var empty = true
    for (var c = 0; c < TASK_COLUMNS.length; c++) {
      var index = at[TASK_COLUMNS[c]]
      var text = index === undefined ? '' : readCell(block[i][index], timeZone)
      task[TASK_COLUMNS[c]] = text
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
    // Through `readCell` like every task cell: a wedding date retyped in the Sheets UI can be
    // a real Date.
    if (name && name !== 'key') config[name] = readCell(rows[i][1], timeZone)
  }
  return config
}

/**
 * Every value leaves as a string. The Sheets UI may have coerced a hand-edited cell to a Date or a
 * number whatever the '@' format, and `String(new Date())` gives "Fri Aug 07 2026 …", which the
 * client cannot parse, so a Date is reformatted to wall-clock in the sheet's zone.
 */
function readCell(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm")
  return value == null ? '' : String(value)
}
