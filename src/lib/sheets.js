/**
 * Every read and write an EDITOR makes, straight to the Sheets API.
 *
 * THE WRITES LIVE HERE RATHER THAN IN THE SCRIPT, and the reason is measured: a request to
 * `/exec` costs 1.0–1.6s of Google's own time before any of our code runs — the 302 hop plus a
 * container start — while `sheets.googleapis.com` answers in ~0.24s. No amount of script tuning
 * reaches that floor, so moving a write back behind `/exec` would cost 2s per save whatever it
 * did there.
 *
 * A PLANNER NEVER REACHES THIS FILE. Reading with no credential at all is the whole reason
 * `doGet` still exists, and a minted token can always write — see `connection.js`.
 *
 * Three rules hold everything here together:
 *
 * EVERY WRITE IS `valueInputOption: RAW`. Never `USER_ENTERED`. RAW stores what it is given,
 * so a title of "=SUM(A:A)" is text and a date is not reformatted to the sheet's locale.
 * This is also why nothing here escapes a leading `=`, `+`, `-` or `@` the way `Code.gs`
 * had to: `setValues` parsed those whatever the cell format said, and RAW does not.
 *
 * NO CACHED ROW NUMBER IS EVER TRUSTED. Row positions shift whenever anyone sorts or inserts
 * in the Sheets UI, so every write resolves id -> row from a read taken immediately before
 * it. `openGrid` is the one door for that, and it is also where the header repair happens.
 *
 * THERE IS NO LOCK ANY MORE, AND THAT IS WHY EACH GESTURE IS ONE WRITE CALL. The script held
 * a script-wide lock, which let it rewrite untouched cells safely and serialised the two
 * editors — at the cost of a 25s wait under contention that the client could not even retry.
 * Without it the rule is narrower and stricter: touch only the cells the edit is about, and
 * send them as ONE `values:batchUpdate`, which Google applies as a unit. Two people editing
 * different rows now never contend at all.
 */

import {
  CONFIG_RANGE,
  CONFIG_SHEET,
  TASKS_RANGE,
  TASKS_SHEET,
  TASK_COLUMNS,
  cellText,
  columnIndex,
  rowRange,
  spanRange,
  taskCells,
} from '../schema.js'
import { getAccessToken, refreshToken } from './connection.js'

/**
 * Overridable ONLY so `scripts/stub-endpoint.mjs` can stand in for Google in dev — the
 * production CSP allows the real host and nothing else, and `vite build` never reads a
 * `server` config. Never point this at anything in a shipped build.
 */
const BASE_URL =
  import.meta.env.VITE_SHEETS_BASE ?? 'https://sheets.googleapis.com/v4/spreadsheets'

const RAW = 'RAW'

/** Plain text, so the Sheets UI cannot coerce a hand-typed date into a real Date. */
const TEXT_FORMAT = '@'

function query(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null) continue
    if (Array.isArray(value)) for (const item of value) search.append(key, String(item))
    else search.set(key, String(value))
  }
  return search.toString()
}

/**
 * Single entry point for every Sheets call.
 *
 * A 401 means the token was rejected — revoked, or simply older than it looked — so
 * re-acquire once and retry exactly once. NEVER more: a revoked grant would loop forever.
 * `refreshToken` guarantees a token newer than any mint that was already in flight when the
 * 401 arrived, which is what makes `connection.js`'s refresh margin a performance choice
 * rather than a correctness one.
 *
 * Thrown errors carry `.status`, which is how `api.js` tells a retryable failure from a terminal
 * one. That is worth more than it looks: `/exec` answers every failure with a 200 and an HTML
 * page, so anything behind it can only guess from whether the body parsed.
 */
async function request(path, { method = 'GET', params, body, allowRetry = true } = {}) {
  const token = await getAccessToken()
  const search = query(params)

  let response
  try {
    response = await fetch(`${BASE_URL}${path}${search ? `?${search}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (cause) {
    // No status at all: DNS, offline, a dropped connection. Always worth retrying.
    const error = new Error('Could not reach the Sheets API.')
    error.cause = cause
    throw error
  }

  if (response.ok) return response.json().catch(() => ({}))

  if (response.status === 401 && allowRetry) {
    await refreshToken()
    return request(path, { method, params, body, allowRetry: false })
  }

  const payload = await response.json().catch(() => null)
  const error = new Error(
    `Google Sheets: ${payload?.error?.message ?? response.statusText ?? 'request failed'} ` +
      `(HTTP ${response.status})`,
  )
  error.status = response.status
  throw error
}

/** An app-level refusal, as a code `api.js` maps rather than a sentence. */
function coded(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** A missing tab or range surfaces as a 400 from the values endpoint, not a 404. */
function looksUninitialized(error) {
  return error.status === 400 || error.status === 404
}

function batchGet(spreadsheetId, ranges) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values:batchGet`, {
    params: { ranges, majorDimension: 'ROWS' },
  })
}

/**
 * Several ranges in ONE request, which is what keeps a gesture to a single write whatever it
 * touches: a delete cascading to four subtasks is one call, not five.
 */
function batchUpdateValues(spreadsheetId, data) {
  if (!data.length) return Promise.resolve({})
  return request(`/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: RAW, data },
  })
}

function batchUpdateSheet(spreadsheetId, requests) {
  if (!requests.length) return Promise.resolve({})
  return request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests },
  })
}

// ---------------------------------------------------------------------------
// The spreadsheet's shape
// ---------------------------------------------------------------------------

/**
 * Tab titles -> gids, plus the spreadsheet's own zone. Cached per session because none of it
 * changes: `compact` needs a gid and Settings needs the zone, and paying for either on every
 * read would put a second round trip on the hot path.
 */
let metaCache = { spreadsheetId: null, sheetIds: {}, timeZone: '' }

async function readMeta(spreadsheetId) {
  const data = await request(`/${encodeURIComponent(spreadsheetId)}`, {
    params: { fields: 'properties(timeZone),sheets(properties(sheetId,title))' },
  })
  const sheetIds = {}
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {}
    if (title != null) sheetIds[title] = sheetId
  }
  metaCache = {
    spreadsheetId,
    sheetIds,
    timeZone: data.properties?.timeZone ?? '',
  }
  return metaCache
}

function meta(spreadsheetId) {
  if (metaCache.spreadsheetId === spreadsheetId) return Promise.resolve(metaCache)
  return readMeta(spreadsheetId)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** column name -> index, from the header row the sheet actually has. */
function columnMap(header) {
  const at = {}
  for (let i = 0; i < (header ?? []).length; i += 1) {
    const name = cellText(header[i])
    if (name && at[name] === undefined) at[name] = i
  }
  return at
}

/** Whether a header row is already this bundle's layout. */
function headerMatches(header) {
  return TASK_COLUMNS.every((column, index) => cellText(header?.[index]) === column)
}

/**
 * Every task in a grid, resolved by column NAME rather than by position — the same rule
 * `doGet` reads by, so a planner and an editor see the same board even when somebody has
 * moved a column in the Sheets UI and no editor has written since.
 */
function tasksFrom(block) {
  if (block.length < 2) return []
  const at = columnMap(block[0])
  const tasks = []
  for (let i = 1; i < block.length; i += 1) {
    const task = {}
    let empty = true
    for (const column of TASK_COLUMNS) {
      const index = at[column]
      const text = index === undefined ? '' : cellText(block[i][index])
      task[column] = text
      if (text) empty = false
    }
    // A blank row is somebody's stray Enter in the Sheets UI, not a task.
    if (!empty && task.id) tasks.push(task)
  }
  return tasks
}

/** The config tab's key/value rows as an object, in the shape `parseConfig` expects. */
function configFrom(rows) {
  const config = {}
  for (let i = 1; i < rows.length; i += 1) {
    const name = cellText(rows[i]?.[0])
    if (name && name !== 'key') config[name] = cellText(rows[i][1])
  }
  return config
}

/**
 * The whole board in ONE round trip, and the shape `api.js` hands to `useBoard`.
 *
 * The zone rides along from the session cache, so only the FIRST read of a session pays for
 * it — and it pays in parallel, so even that one costs one round trip of latency rather than
 * two.
 */
export async function loadBoard(spreadsheetId) {
  const wanted = meta(spreadsheetId).catch(() => metaCache)

  let valueRanges
  try {
    const [data] = await Promise.all([batchGet(spreadsheetId, [TASKS_RANGE, CONFIG_RANGE]), wanted])
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // A spreadsheet whose tabs have not been built yet. Not an error: it reads as an empty
    // board, and an editor's first write builds them. An anonymous reader gets the same
    // answer from `doGet`.
    if (!looksUninitialized(error)) throw error
    return { tasks: [], config: {}, needsSetup: true, sheetTimeZone: (await wanted).timeZone }
  }

  return {
    tasks: tasksFrom(valueRanges[0]?.values ?? []),
    config: configFrom(valueRanges[1]?.values ?? []),
    needsSetup: false,
    sheetTimeZone: (await wanted).timeZone,
  }
}

// ---------------------------------------------------------------------------
// One write's view of the grid
// ---------------------------------------------------------------------------

/** id -> 1-based grid row, or 0. */
function rowOf(block, id) {
  const wanted = cellText(id)
  if (!wanted) return 0
  const column = columnIndex('id')
  for (let i = 1; i < block.length; i += 1) {
    if (cellText(block[i][column]) === wanted) return i + 1
  }
  return 0
}

/**
 * Everything a write needs, read ONCE, with the structure and the header both repaired.
 *
 * ONE DOOR rather than one per op, so no op can forget the repair and none can pay for a
 * read another already made. It is also the only place that decides a row number, which is
 * what makes "never trust a cached one" enforceable rather than a habit.
 *
 * @returns {Promise<{block: string[][]}>} the grid as it now stands, header included
 */
async function openGrid(spreadsheetId) {
  let data
  try {
    data = await batchGet(spreadsheetId, [TASKS_RANGE])
  } catch (error) {
    if (!looksUninitialized(error)) throw error
    await ensureStructure(spreadsheetId)
    data = await batchGet(spreadsheetId, [TASKS_RANGE])
  }

  let block = data.valueRanges?.[0]?.values ?? []
  if (!block.length) {
    // The tab exists but is empty — somebody deleted the header row by hand.
    await writeHeader(spreadsheetId)
    block = [TASK_COLUMNS.slice()]
  } else if (!headerMatches(block[0])) {
    block = await relayout(spreadsheetId, block)
  }
  return { block }
}

/**
 * Put the header back to this bundle's layout, BY NAME, and return the grid as it now stands.
 *
 * A person can blank, rename or reorder a column in the Sheets UI, and every write addresses cells
 * by INDEX — so a tab whose header no longer says what this bundle expects would have its due
 * dates written into the category column. The repair is therefore NOT a rewrite of the header
 * text: each row's values are re-read by the name that row's own header cell gives them and
 * written back in canonical order, so a value follows its label instead of staying in its column.
 * A column the header names that `TASK_COLUMNS` does not is dropped.
 *
 * IT DOES NOT CLEAR ANYTHING PAST COLUMN I, AND DOES NOT NEED TO. `Code.gs` did, because
 * `getDataRange()` handed it every column that existed and a shifting count could take a real
 * column with it. Every range here is derived from `TASK_COLUMNS` instead, so the read is
 * `tasks!A1:I` and a stray column J is invisible to this app and cannot shift an index. Widening
 * the read to find one would be spending a request to tidy something harmless — and it would also
 * wipe the column a NEWER deployment appends, which is the same mistake in the other direction.
 *
 * IT MOVED FROM THE SCRIPT TO HERE, and it lost the lock on the way. It is one write of the whole
 * grid, so it is still atomic as far as Google is concerned; what it can no longer promise is that
 * nobody read the grid in between. The exposure is one editor repairing a header while the other
 * is mid-save, which needs somebody to have hand-edited the header seconds earlier — and the loser
 * re-resolves on their next write.
 *
 * `doGet` never reaches this: an anonymous read must not cause a write, which is why `tasksFrom`
 * resolves by name on both sides of the wire instead.
 */
export async function relayout(spreadsheetId, block) {
  const at = columnMap(block[0] ?? [])

  const rows = [TASK_COLUMNS.slice()]
  for (let r = 1; r < block.length; r += 1) {
    rows.push(
      TASK_COLUMNS.map((column) => {
        const index = at[column]
        return index === undefined ? '' : cellText(block[r][index])
      }),
    )
  }

  await batchUpdateValues(spreadsheetId, [{ range: TASKS_RANGE, values: rows }])
  return rows
}

function nowIso() {
  return new Date().toISOString()
}

/**
 * created_at BELONGS TO THE ROW, not to whatever the client is holding — one home for that
 * rule, because a replayed create rewrites an existing row and has to honour it exactly as
 * an update does.
 */
function createdAtOf(block, row) {
  return row ? cellText(block[row - 1]?.[columnIndex('created_at')]) : ''
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Append — or REWRITE THE ROW THE ID ALREADY NAMES, which is what makes a create REPLAYABLE.
 *
 * THE ID COMES FROM THE CLIENT, so a create that arrives twice is the same row twice, not two
 * tasks. Appending unconditionally made this the one op that could not be retried: a reply
 * lost to a dropped connection left the caller unable to tell "nothing was written" from
 * "written, and the answer went missing", and re-sending appended a duplicate nothing could
 * distinguish from a real second task. Resolving the id first costs nothing — the grid is
 * already in hand — and it is what lets `api.js` retry a write at all.
 *
 * A batch splits the same way: rows a replay already landed are rewritten in place, and only
 * genuinely new ones are appended. The ordinary case is all-new and is one append.
 */
export async function createTasks(spreadsheetId, tasks) {
  if (!tasks?.length) throw coded('bad_payload', 'createTasks: nothing to create')
  const { block } = await openGrid(spreadsheetId)
  const updatedAt = nowIso()

  const data = []
  const fresh = []
  for (const task of tasks) {
    const row = rowOf(block, task.id)
    const cells = taskCells(task, { createdAt: createdAtOf(block, row), updatedAt })
    if (row) data.push({ range: rowRange(row), values: [cells] })
    else fresh.push(cells)
  }

  // Both halves can happen at once on a replay of a mixed batch. Sequential rather than
  // parallel: an append shifts nothing the in-place ranges name, but doing them in one order
  // every time is what makes the result the same as re-sending each edit would have been.
  if (data.length) await batchUpdateValues(spreadsheetId, data)
  if (fresh.length) {
    await request(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(TASKS_RANGE)}:append`,
      {
        method: 'POST',
        params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
        body: { values: fresh },
      },
    )
  }
}

/**
 * One update or a batch of them, through the same path — `update` is a batch of one, so there
 * is no second write path to keep in step with this one.
 *
 * IT IS ATOMIC ON RESOLUTION. Every id is resolved before ANY cell is written, so a row a
 * partner deleted mid-batch fails the whole batch with `not_found` and nothing half-applies.
 * That is why the client may roll a whole batch back: a partial success would leave it with
 * no way to know which half landed.
 */
export async function updateTasks(spreadsheetId, tasks) {
  if (!tasks?.length) throw coded('bad_payload', 'updateTasks: nothing to update')
  const { block } = await openGrid(spreadsheetId)
  const updatedAt = nowIso()

  const data = []
  for (const task of tasks) {
    const row = rowOf(block, task.id)
    if (!row) throw coded('not_found', `updateTasks: no row for ${task.id}`)
    data.push({
      range: rowRange(row),
      values: [taskCells(task, { createdAt: createdAtOf(block, row), updatedAt })],
    })
  }
  await batchUpdateValues(spreadsheetId, data)
}

/**
 * Soft delete, and its inverse. Rows never change position, so nobody else's cached indices
 * move — which is also why a restore is free.
 *
 * IT CASCADES TO SUBTASKS, and it does so in ONE request. Sending a call per child would be
 * N round trips that can half-fail, leaving some children tombstoned and some not; one
 * `values:batchUpdate` is all-or-nothing as far as Google is concerned. Restore is the exact
 * inverse for the same reason: a parent that came back without its children would look
 * repaired and be missing work.
 *
 * `updated_at` and `deleted_at` are ADJACENT in `TASK_COLUMNS`, so each affected row is ONE
 * range rather than two. Unlike the script's version this touches only the rows the delete is
 * about — without a lock, rewriting a whole column with values read a moment ago is exactly
 * how one editor's save erases another's.
 */
export async function setDeleted(spreadsheetId, id, deletedAt) {
  if (!id) throw coded('bad_payload', 'setDeleted: no id')
  const { block } = await openGrid(spreadsheetId)

  const target = rowOf(block, id)
  if (!target) throw coded('not_found', `setDeleted: no row for ${id}`)

  const parent = columnIndex('parent_id')
  const stamp = nowIso()
  const data = []
  for (let i = 1; i < block.length; i += 1) {
    const mine = i + 1 === target || cellText(block[i][parent]) === cellText(id)
    if (!mine) continue
    data.push({
      range: spanRange(i + 1, 'updated_at', 'deleted_at'),
      values: [[stamp, deletedAt]],
    })
  }
  await batchUpdateValues(spreadsheetId, data)
}

/**
 * The config tab's key/value pairs. Rows the tab already has are rewritten in place and
 * anything new is appended, both in one call each — Settings saves five or six at a time.
 */
export async function setConfig(spreadsheetId, config) {
  if (!config || typeof config !== 'object') throw coded('bad_payload', 'setConfig: no config')

  let rows
  try {
    const read = await batchGet(spreadsheetId, [CONFIG_RANGE])
    rows = read.valueRanges?.[0]?.values ?? []
  } catch (error) {
    if (!looksUninitialized(error)) throw error
    await ensureStructure(spreadsheetId)
    rows = [['key', 'value']]
  }

  const seen = new Set()
  const data = []
  for (let i = 1; i < rows.length; i += 1) {
    const name = cellText(rows[i]?.[0])
    if (!name || !Object.prototype.hasOwnProperty.call(config, name)) continue
    seen.add(name)
    data.push({ range: `${CONFIG_SHEET}!B${i + 1}`, values: [[cellText(config[name])]] })
  }
  if (data.length) await batchUpdateValues(spreadsheetId, data)

  const appended = Object.keys(config)
    .filter((key) => !seen.has(key))
    .map((key) => [key, cellText(config[key])])
  if (appended.length) {
    await request(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(CONFIG_RANGE)}:append`,
      {
        method: 'POST',
        params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
        body: { values: appended },
      },
    )
  }
}

/**
 * The only hard delete.
 *
 * Requests must go in DESCENDING row order: deleting row 5 shifts row 9 up to row 8, so an
 * ascending pass deletes the wrong rows after the first one.
 *
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId) {
  const [{ block }, { sheetIds }] = await Promise.all([
    openGrid(spreadsheetId),
    meta(spreadsheetId),
  ])
  const gid = sheetIds[TASKS_SHEET]
  if (gid == null) throw coded('misconfigured', 'compact: no tasks tab')
  if (block.length < 2) return { removed: 0 }

  const deletedAt = columnIndex('deleted_at')
  const parent = columnIndex('parent_id')
  const idColumn = columnIndex('id')

  // The ids about to disappear. A live child pointing at one of them would be left naming a
  // row that no longer exists; the read promotes it to top level either way, but the sheet is
  // what a person looks at and this is the only moment the information still exists.
  const dying = new Set()
  for (let i = 1; i < block.length; i += 1) {
    const id = cellText(block[i][idColumn])
    if (id && cellText(block[i][deletedAt])) dying.add(id)
  }

  // Every orphaned pointer, and only those: one range per row that actually has one.
  const pointers = []
  const doomed = []
  for (let i = 1; i < block.length; i += 1) {
    if (cellText(block[i][deletedAt])) {
      doomed.push(i + 1)
      continue
    }
    const held = cellText(block[i][parent])
    if (held && dying.has(held)) {
      pointers.push({ range: spanRange(i + 1, 'parent_id', 'parent_id'), values: [['']] })
    }
  }
  if (!doomed.length) return { removed: 0 }
  if (pointers.length) await batchUpdateValues(spreadsheetId, pointers)

  await batchUpdateSheet(
    spreadsheetId,
    // DESCENDING. 0-based and half-open: sheet row N is index N-1.
    doomed
      .slice()
      .sort((left, right) => right - left)
      .map((row) => ({
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
        },
      })),
  )
  return { removed: doomed.length }
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function writeHeader(spreadsheetId) {
  return batchUpdateValues(spreadsheetId, [
    { range: `${TASKS_SHEET}!A1`, values: [TASK_COLUMNS.slice()] },
  ])
}

/**
 * Build the two tabs, once, and REFUSE A SPREADSHEET THAT ALREADY LOOKS LIKE SOMEBODY'S WORK.
 *
 * The id arrives from the token endpoint rather than from a person choosing a file, so a
 * wrong one is a configuration mistake — and adding two tabs to an unrelated spreadsheet is
 * not something undo can reach. A fresh spreadsheet has exactly one default tab, so several
 * tabs with none of ours among them is refused.
 *
 * This is the only path that may build structure, and it moved here from the script for the
 * same reason everything else did.
 */
export async function ensureStructure(spreadsheetId) {
  const { sheetIds } = await readMeta(spreadsheetId)
  const wanted = [TASKS_SHEET, CONFIG_SHEET]
  const missing = wanted.filter((title) => !(title in sheetIds))
  if (!missing.length) return

  if (missing.length === wanted.length && Object.keys(sheetIds).length > 1) {
    throw coded(
      'not_empty',
      'That spreadsheet already has other tabs and none of this app\'s, so it is probably not the board.',
    )
  }

  const created = await batchUpdateSheet(
    spreadsheetId,
    missing.map((title) => ({
      addSheet: {
        properties: {
          title,
          // Frozen here rather than in a second request: the header is a sign, and a board
          // scrolled past its own column names is unreadable in the Sheets UI.
          gridProperties: { frozenRowCount: 1 },
        },
      },
    })),
  )

  // The whole column, not just the used range: a row typed by hand below the data would
  // otherwise be parsed by the sheet's locale on the way in.
  const format = []
  ;(created.replies ?? []).forEach((reply, index) => {
    const gid = reply?.addSheet?.properties?.sheetId
    if (gid == null) return
    format.push({
      repeatCell: {
        range: {
          sheetId: gid,
          startColumnIndex: 0,
          endColumnIndex: missing[index] === TASKS_SHEET ? TASK_COLUMNS.length : 2,
        },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: TEXT_FORMAT } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })
  })
  if (format.length) await batchUpdateSheet(spreadsheetId, format)

  const headers = []
  if (missing.includes(TASKS_SHEET)) {
    headers.push({ range: `${TASKS_SHEET}!A1`, values: [TASK_COLUMNS.slice()] })
  }
  if (missing.includes(CONFIG_SHEET)) {
    headers.push({ range: `${CONFIG_SHEET}!A1`, values: [['key', 'value']] })
  }
  await batchUpdateValues(spreadsheetId, headers)

  // The cache was read before the tabs existed, so `compact` would not find a gid.
  await readMeta(spreadsheetId)
}

/** Only so a test can start from a known session. */
export function resetMetaCache() {
  metaCache = { spreadsheetId: null, sheetIds: {}, timeZone: '' }
}
