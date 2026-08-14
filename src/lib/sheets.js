/**
 * Every read and write an editor makes, straight to the Sheets API. A planner never reaches here:
 * the anonymous read carries no credential, and a minted token can always write.
 *
 * The writes are here, not in the script, because `/exec` costs 1.0–1.6s before our code runs and
 * `sheets.googleapis.com` answers in ~0.24s.
 *
 * Three rules:
 *
 * Every write is `valueInputOption: RAW`, never `USER_ENTERED`. RAW stores what it is given, so a
 * title of "=SUM(A:A)" stays text and a date is not reformatted to the sheet's locale.
 *
 * No cached row number is trusted: positions shift when anyone sorts or inserts in the Sheets UI,
 * so every write resolves id -> row through `openGrid` first.
 *
 * No lock exists, so a write touches only the cells its edit is about, as one `values:batchUpdate`,
 * which Google applies as a unit. Rewriting untouched cells from a stale read is how one editor's
 * save erases the other's.
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
 * Overridable only so `scripts/stub-endpoint.mjs` can stand in for Google in dev. The production
 * CSP allows the real host and nothing else; never set this in a shipped build.
 */
const BASE_URL =
  import.meta.env.VITE_SHEETS_BASE ?? 'https://sheets.googleapis.com/v4/spreadsheets'

const RAW = 'RAW'

/**
 * A hang-stop, not a latency budget: `fetch` has no limit of its own, and `useBoard` holds
 * `reading` for a read and `saving` for a write, so a hung request blocks every later refresh or
 * leaves a row dimmed with nothing able to settle it. An abort has no `.status`, so `api.js`
 * classifies it TRANSIENT and retries — sound because every op here is idempotent. `/exec` has its
 * own ceiling in `api.js`.
 */
const TIMEOUT_MS = 20_000

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
 * A 401 means the token was rejected, so re-mint and retry exactly once — never more, or a revoked
 * grant loops forever. `refreshToken` guarantees a token newer than any mint already in flight,
 * which is what makes `connection.js`'s refresh margin a performance choice rather than a
 * correctness one.
 *
 * Thrown errors carry `.status`, which is how `api.js` tells a retryable failure from a terminal
 * one.
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    // No status at all: DNS, offline, a dropped connection, or the ceiling above. Worth retrying.
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

/**
 * A tab or range that does not exist yet. 400 only: a 404 means no such spreadsheet, and read as
 * "not built yet" a wrong id or a trashed file becomes an empty board, which overwrites the
 * device's last-good snapshot and invites an editor to seed a template over a live one. `api.js`
 * maps it, like every other 4xx, to `misconfigured`.
 */
function looksUninitialized(error) {
  return error.status === 400
}

function batchGet(spreadsheetId, ranges) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values:batchGet`, {
    params: { ranges, majorDimension: 'ROWS' },
  })
}

/** Several ranges in one request: a delete cascading to four subtasks is one call, not five. */
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

// --------------------------------------------------------------------------- The spreadsheet's
// shape ---------------------------------------------------------------------------

/**
 * Tab titles -> gids, plus the spreadsheet's own zone. Cached per session because none of it
 * changes; re-reading it per read would put a second round trip on the hot path.
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

// --------------------------------------------------------------------------- Reading
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
 * Every task in a grid, resolved by column name rather than position — the same rule `doGet` reads
 * by, so a planner and an editor see the same board after somebody moves a column in the Sheets UI.
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
 * The whole board in one round trip, in the shape `api.js` hands to `useBoard`. The zone rides
 * along from the session cache, in parallel, so only the first read of a session pays for it and
 * even that costs one round trip.
 */
export async function loadBoard(spreadsheetId) {
  const wanted = meta(spreadsheetId).catch(() => metaCache)

  let valueRanges
  try {
    const [data] = await Promise.all([batchGet(spreadsheetId, [TASKS_RANGE, CONFIG_RANGE]), wanted])
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // Tabs not built yet. It reads as an empty board, and an editor's first write builds them.
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

// --------------------------------------------------------------------------- One write's view of
// the grid ---------------------------------------------------------------------------

/**
 * id -> 1-based grid row, keyed on the block itself: a batch resolves one id per task, and a linear
 * scan made that a full pass per task. `openGrid` returns a fresh block every call, so an entry
 * cannot be stale.
 */
const rowIndexes = new WeakMap()

/** First match, as a duplicated id has no better answer. 0 for a miss. */
function rowOf(block, id) {
  const wanted = cellText(id)
  if (!wanted) return 0
  let index = rowIndexes.get(block)
  if (!index) {
    const column = columnIndex('id')
    index = new Map()
    for (let i = 1; i < block.length; i += 1) {
      const key = cellText(block[i][column])
      if (key && !index.has(key)) index.set(key, i + 1)
    }
    rowIndexes.set(block, index)
  }
  return index.get(wanted) ?? 0
}

/**
 * Everything a write needs, read once, with the structure and the header both repaired. One door,
 * so no op can forget the repair or pay twice for a read, and the only place that decides a row
 * number.
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
 * Put the header back to this bundle's layout, by name, and return the grid as it now stands.
 *
 * Anyone can blank, rename or reorder a column in the Sheets UI, and every write addresses cells by
 * index, so a mismatched header would send due dates into the category column. The repair moves
 * values, not labels: each row's cells are re-read by the name its own header cell gives them and
 * written back in canonical order. A column `TASK_COLUMNS` does not name is dropped.
 *
 * It does not clear anything past column I and must not start. Every range derives from
 * `TASK_COLUMNS`, so a stray column J cannot shift an index, and wiping it would delete the column
 * a newer deployment appends.
 *
 * One write of the whole grid, so Google applies it atomically; without a lock it cannot promise
 * nobody read the grid in between, and the loser re-resolves on their next write.
 *
 * `doGet` never reaches this: an anonymous read must not cause a write, which is why `tasksFrom`
 * resolves by name on both sides of the wire.
 */
async function relayout(spreadsheetId, block) {
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
 * `created_at` belongs to the row, not to what the client is holding: a replayed create rewrites an
 * existing row and must honour it as an update does.
 */
function createdAtOf(block, row) {
  return row ? cellText(block[row - 1]?.[columnIndex('created_at')]) : ''
}

// --------------------------------------------------------------------------- Operations
// ---------------------------------------------------------------------------

/**
 * An upsert on the client's id: append, or rewrite the row that id already names. That is what
 * makes a create replayable — a lost reply does not say whether the write landed, and an
 * unconditional append would leave a duplicate nothing could distinguish from a real second task.
 *
 * A batch splits the same way: rows a replay already landed are rewritten in place, and only new
 * ones are appended. The ordinary case is all-new and is one append.
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

  // A replayed mixed batch can need both halves. Sequential, in one fixed order, so the result
  // matches re-sending each edit; an append shifts nothing the in-place ranges name.
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
 * One update or a batch of them; `update` is a batch of one, so there is no second write path.
 *
 * Atomic on resolution: every id is resolved before any cell is written, so a row a partner deleted
 * mid-batch fails the whole batch with `not_found`, and the client may roll the whole batch back.
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
 * Soft delete, and its inverse. Rows never move, so no cached index moves and a restore is free.
 *
 * It cascades to subtasks in one request: N calls can half-fail, leaving some children tombstoned
 * and some not, while one `values:batchUpdate` is all-or-nothing. Restore is the exact inverse, or
 * a parent comes back without its children and looks repaired while missing work.
 *
 * `updated_at` and `deleted_at` are adjacent in `TASK_COLUMNS`, so each affected row is one range,
 * and only the rows the delete is about are touched.
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
 * The config tab's key/value pairs. Rows the tab already has are rewritten in place and anything
 * new is appended, one call each — Settings saves five or six at a time.
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
 * Requests must go in descending row order: deleting row 5 shifts row 9 up to row 8, so an
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

  // The ids about to disappear. A live child pointing at one would name a row that no longer
  // exists; the read promotes it either way, but this is the last moment the link exists in the
  // sheet.
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
    // Descending. 0-based and half-open: sheet row N is index N-1.
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

// --------------------------------------------------------------------------- Structure
// ---------------------------------------------------------------------------

function writeHeader(spreadsheetId) {
  return batchUpdateValues(spreadsheetId, [
    { range: `${TASKS_SHEET}!A1`, values: [TASK_COLUMNS.slice()] },
  ])
}

/**
 * Build the two tabs, once, and refuse a spreadsheet that already looks like somebody's work. The
 * id arrives from the token endpoint rather than from a person choosing a file, so a wrong one is a
 * configuration mistake and adding tabs to an unrelated spreadsheet is not something undo can
 * reach. A fresh spreadsheet has one default tab, so several tabs with none of ours among them is
 * refused. The only path that may build structure.
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
          // Frozen here rather than in a second request: a board scrolled past its own column names
          // is unreadable in the Sheets UI.
          gridProperties: { frozenRowCount: 1 },
        },
      },
    })),
  )

  // The whole column, not the used range: a row typed by hand below the data would otherwise be
  // parsed by the sheet's locale on the way in.
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
