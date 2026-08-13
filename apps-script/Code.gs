/**
 * The read half of the Wedding board's backend, and the token that buys the other half.
 *
 * Deployed as a web app from the account that OWNS the spreadsheet, with access
 * "Anyone, even anonymous".
 *
 *   doGet   PUBLIC. No credential. Returns the board. This is what a planner uses.
 *   doPost  Requires APP_KEY in the JSON body. Mints a Google access token.
 *
 * WHY THE WRITES ARE NOT HERE ANY MORE. A request to `/exec` costs 1.0–1.6s before this
 * file runs a line: `/exec` answers 302, the browser re-requests from the echo URL, and a
 * container has to be warm. That is Google's floor and no amount of script tuning reaches
 * it — this script was already down to four Sheets calls per write and under a millisecond
 * of CPU. So an editor now takes a token from `doPost` and writes to
 * `sheets.googleapis.com` directly, one hop, ~0.24s. Everything that used to happen here —
 * the ops, the lock, the layout repair, building the tabs — lives in `src/lib/sheets.js`.
 *
 * WHY doGet SURVIVES. A planner must read the board with NO credential at all, and a
 * minted token cannot be read-only: `ScriptApp.getOAuthToken()` returns this script's own
 * authorization, which can write. Handing one to an anonymous reader would hand them
 * editing. So the anonymous read has to happen HERE, behind the key, and only the read.
 *
 * The `/exec` URL ships in a public bundle, so it is not a secret and nothing may depend
 * on it being hard to guess. APP_KEY is the only access control.
 *
 * THIS SCRIPT MUST BE CONTAINER-BOUND to the spreadsheet — created from the sheet via
 * Extensions > Apps Script, never from script.new. `getActive()` is what names the file,
 * which is why there is no SHEET_ID property to get wrong. A standalone script returns
 * null from it and every call answers `misconfigured`.
 *
 * THE SCOPE IS `spreadsheets`, NOT `spreadsheets.currentonly`, AND THAT IS THE COST OF THE
 * SPEED. `currentonly` is an Apps-Script-runtime scope: the REST API rejects a bearer
 * token carrying only it, so minting a usable token means the wide scope, and the wide
 * scope reaches every spreadsheet the owning account can see. The account owning this
 * sheet should therefore own nothing else — see README's security model, where that
 * standing condition is stated. Container binding still confines the SCRIPT; it no longer
 * confines the TOKEN.
 *
 * CRITICAL: neither handler may throw. An uncaught throw returns Google's HTML error page
 * instead of JSON, and the client classifies a non-JSON reply as TRANSIENT and retries —
 * so a throw on the reject path becomes a silent retry loop. Both entry points are
 * wrapped, and `doPost` re-checks every dereference rather than trusting the parsed body.
 *
 * Never read `e.parameter` for the key. A key in a query string is written into Google's
 * request logs; requiring it in the POST body is what keeps it out.
 */

/**
 * The column contract. This list and the one in `src/schema.js` MUST be identical and in
 * the same order — `test/schema.test.js` parses this file and fails the build if they
 * drift. Two files know the layout because the boundary is a network hop.
 *
 * It is still needed here even though nothing here writes: `tasksFrom` shapes the reply
 * from it, so a column missing from this list is a field a planner never sees.
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
  'deleted_at',
  'parent_id',
]

var TASKS_SHEET = 'tasks'
var CONFIG_SHEET = 'config'

/**
 * The only legitimate body is `{"key":"<64 hex>"}`. The seed that used to arrive here as
 * forty tasks goes straight to the Sheets API now, so this can be as tight as a key-only
 * endpoint's again.
 */
var MAX_BODY_BYTES = 1024

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * The public read. Anonymous and unauthenticated by design.
 *
 * It never creates structure. Building tabs is a write, and an anonymous request must not
 * cause one — so a spreadsheet with no `tasks` tab answers `needsSetup: true` and an
 * editor's first write does the building, from the client.
 *
 * Two tab lookups and one read of each tab, which is the floor for a board.
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
      /**
       * The spreadsheet's own zone, reported so the client can warn when it disagrees with
       * the `timezone` config value. Wall-clock times in the sheet are interpreted in the
       * CONFIG zone, never this one — but a mismatch is what makes a hand-typed cell land
       * an hour off, so it is worth surfacing.
       */
      sheetTimeZone: timeZone,
    })
  } catch (err) {
    return json({ ok: false, error: 'server' })
  }
}

/**
 * Mint an access token for an editor.
 *
 * The token belongs to the account that owns this spreadsheet, not to whoever is asking,
 * so nothing here identifies a person and the client cannot learn which of the two
 * editors it is. The key is a capability, and this is what it buys.
 *
 * The reply vocabulary is exactly `{ok, token, spreadsheetId}` and `{ok:false, error}` —
 * never an exception message, never an echo of the request.
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
      // From the container rather than from a property: a bound script cannot be pointed
      // at the wrong file, so there is nothing here to misconfigure.
      spreadsheetId: book.getId(),
    })
  } catch (err) {
    return json({ ok: false, error: 'server' })
  }
}

/**
 * One reply for every rejection: no length, prefix or position of the key is revealed, and
 * a wrong key is indistinguishable from a missing one.
 *
 * `ContentService` cannot set an HTTP status, so this arrives as a 200 and the BODY is the
 * only signal. The client branches on the body, never on `ok`.
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
 * The container. Null means this script is not bound to a spreadsheet, which is a setup
 * mistake rather than a runtime condition — see the header.
 */
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
 * The whole tasks grid INCLUDING the header row, read once.
 *
 * `getDataRange` rather than `getLastRow` plus a fixed width: it is ONE service call
 * instead of two, and it reports the columns that are actually there — which is what lets
 * `tasksFrom` resolve a hand-edited header whole, rather than reading as many cells as
 * this layout has and concluding the row is simply wrong.
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
 * Every task in a grid, resolved by column NAME rather than by position.
 *
 * BY NAME BECAUSE THE READ PATH MAY NOT WRITE. A person can blank, rename or reorder a
 * column in the Sheets UI, and this handler is anonymous — so it cannot repair the header,
 * and reading such a grid at this script's own indices would report whatever now sits in
 * `due`'s position as the due date. Resolving from the header row costs nothing (the grid
 * is already in hand). `relayout` in `src/lib/sheets.js` is the repair, and it runs on an
 * editor's next write.
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
    // Through `readCell` like every task cell: a wedding date somebody retyped in the
    // Sheets UI can be a real Date, and `String(new Date())` is unparseable by the client.
    if (name && name !== 'key') config[name] = readCell(rows[i][1], timeZone)
  }
  return config
}

/**
 * Everything leaves here as a string. A cell that a person edited by hand may have been
 * coerced to a Date or a number by the Sheets UI regardless of the '@' format the client
 * writes, and `String(new Date())` would produce "Fri Aug 07 2026 …" — unparseable by the
 * client. Reformatting to wall-clock in the sheet's zone is the recovery for exactly that
 * row.
 */
function readCell(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm")
  return value == null ? '' : String(value)
}
