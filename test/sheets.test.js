/**
 * `src/lib/sheets.js` — the write path, driven against a fake Sheets API.
 *
 * THIS IS THE FILE THAT USED TO BE `test/script.test.js`'s write half, and it exists for exactly
 * the same reason: every choice in the module it tests is the kind that succeeds while writing the
 * wrong cell. There is no way to see that from the browser, and the only other place to find out
 * is somebody's real board.
 *
 * TWO THINGS THE OLD SCRIPT GOT FOR FREE AND THIS DOES NOT, so they are what most of the
 * assertions below are about:
 *
 *   THERE IS NO LOCK. The script held a script-wide one, which let it rewrite untouched cells
 *   safely. Without it, a write that touches a cell the edit is not about is how one editor's save
 *   erases the other's — so "only the affected rows" is a correctness rule now, not tidiness.
 *
 *   THE CLIENT RESOLVES ROWS ITSELF. Positions shift whenever anyone sorts in the Sheets UI, so
 *   every write reads the grid immediately before writing it. A cached row number is the bug.
 *
 * The fake parses A1 ranges for real. A range written one row off lands one row off here rather
 * than passing, which is the only reason a fake is worth having.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_COLUMNS } from '../src/schema.js'

vi.mock('../src/lib/connection.js', () => ({
  getAccessToken: (...args) => tokens.get(...args),
  refreshToken: (...args) => tokens.refresh(...args),
}))

const tokens = {
  current: 'token-1',
  mints: 0,
  refreshes: 0,
  async get() {
    tokens.mints += 1
    return tokens.current
  },
  async refresh() {
    tokens.refreshes += 1
    tokens.current = `token-${tokens.refreshes + 1}`
    return tokens.current
  },
}

const sheets = await import('../src/lib/sheets.js')

const ID = 'SHEET'
const HEADER = TASK_COLUMNS.slice()

/** 'A' -> 0. */
const colOf = (letters) =>
  [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1

/** `tasks!A1:I` / `config!B2` -> the tab and the rectangle, rows/cols 0-based, end exclusive. */
function parseRange(range) {
  const [tab, a1] = range.split('!')
  const match = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a1)
  if (!match) throw new Error(`unparseable range ${range}`)
  const [, c1, r1, c2, r2] = match
  return {
    tab,
    left: colOf(c1),
    top: r1 ? Number(r1) - 1 : 0,
    right: c2 ? colOf(c2) : colOf(c1),
    bottom: r2 ? Number(r2) - 1 : null,
  }
}

/** The fake spreadsheet, plus a log of every request made against it. */
function makeApi({ tabs } = {}) {
  const grid = tabs ?? {
    tasks: [HEADER.slice()],
    config: [['key', 'value']],
  }
  const gids = { tasks: 100, config: 200 }
  const log = []

  const used = (tab) => grid[tab] ?? null

  function read(range) {
    const { tab, top, left, right, bottom } = parseRange(range)
    const rows = used(tab)
    if (!rows) {
      const error = new Error('missing tab')
      error.status = 400
      throw error
    }
    const last = bottom == null ? rows.length - 1 : Math.min(bottom, rows.length - 1)
    const out = []
    for (let r = top; r <= last; r += 1) {
      out.push((rows[r] ?? []).slice(left, right + 1).map((cell) => (cell == null ? '' : cell)))
    }
    return out
  }

  function write(range, values) {
    const { tab, top, left } = parseRange(range)
    const rows = grid[tab]
    if (!rows) throw new Error(`write to missing tab ${tab}`)
    values.forEach((line, r) => {
      while (rows.length <= top + r) rows.push([])
      line.forEach((value, c) => {
        rows[top + r][left + c] = value
      })
    })
  }

  const fetch = vi.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url, 'https://sheets.googleapis.com')
    const path = pathname.replace('/v4/spreadsheets', '')
    const body = init.body ? JSON.parse(init.body) : null
    const method = init.method ?? 'GET'
    log.push({ method, path, params: Object.fromEntries(searchParams), body, auth: init.headers?.Authorization })

    const reply = (payload) => ({ ok: true, status: 200, json: async () => payload })
    const fail = (status, message) => ({
      ok: false,
      status,
      json: async () => ({ error: { message } }),
    })

    if (fetch.rejectOnce) {
      const status = fetch.rejectOnce
      fetch.rejectOnce = null
      return fail(status, 'forced')
    }

    if (method === 'GET' && path === `/${ID}/values:batchGet`) {
      try {
        return reply({
          valueRanges: searchParams.getAll('ranges').map((range) => ({ values: read(range) })),
        })
      } catch (error) {
        return fail(error.status ?? 400, 'Unable to parse range')
      }
    }

    if (method === 'GET' && path === `/${ID}`) {
      return reply({
        properties: { timeZone: 'Asia/Tokyo' },
        sheets: Object.keys(grid).map((title) => ({ properties: { title, sheetId: gids[title] } })),
      })
    }

    if (method === 'POST' && path === `/${ID}/values:batchUpdate`) {
      for (const entry of body.data) write(entry.range, entry.values)
      return reply({})
    }

    if (method === 'POST' && path.endsWith(':append')) {
      const range = decodeURIComponent(path.slice(`/${ID}/values/`.length, -':append'.length))
      const { tab } = parseRange(range)
      for (const line of body.values) grid[tab].push(line.slice())
      return reply({})
    }

    if (method === 'POST' && path === `/${ID}:batchUpdate`) {
      const replies = []
      for (const request of body.requests) {
        if (request.addSheet) {
          const title = request.addSheet.properties.title
          grid[title] = [[]]
          gids[title] = 300 + Object.keys(grid).length
          replies.push({ addSheet: { properties: { title, sheetId: gids[title] } } })
        } else if (request.deleteDimension) {
          const { sheetId, startIndex } = request.deleteDimension.range
          const title = Object.keys(gids).find((key) => gids[key] === sheetId)
          grid[title].splice(startIndex, 1)
          replies.push({})
        } else {
          replies.push({})
        }
      }
      return reply({ replies })
    }

    return fail(404, `unhandled ${method} ${path}`)
  })

  vi.stubGlobal('fetch', fetch)
  return { grid, gids, log, fetch }
}

const task = (id, extra = {}) => ({
  id,
  title: `Task ${id}`,
  category: 'Venue',
  due: '2027-02-01',
  doneAt: '',
  deletedAt: '',
  parentId: '',
  ...extra,
})

/** A grid holding these tasks, header included. */
function gridOf(rows) {
  return {
    tasks: [
      HEADER.slice(),
      ...rows.map((row) =>
        HEADER.map((column) => {
          if (column === 'parent_id') return row.parentId ?? ''
          if (column === 'done_at') return row.doneAt ?? ''
          if (column === 'deleted_at') return row.deletedAt ?? ''
          if (column === 'created_at') return row.createdAt ?? '2026-01-01T00:00:00.000Z'
          if (column === 'updated_at') return row.updatedAt ?? '2026-01-01T00:00:00.000Z'
          return row[column] ?? ''
        }),
      ),
    ],
    config: [['key', 'value'], ['timezone', 'Asia/Tokyo']],
  }
}

/** The stored rows as objects, header excluded. */
function stored(grid) {
  return grid.tasks.slice(1).map((line) => {
    const row = {}
    HEADER.forEach((name, index) => {
      row[name] = line[index] ?? ''
    })
    return row
  })
}

const FAMILY = [
  task('p1'),
  task('s1', { parentId: 'p1' }),
  task('s2', { parentId: 'p1' }),
  task('s3', { parentId: 'p1' }),
  task('p2'),
]

beforeEach(() => {
  tokens.current = 'token-1'
  tokens.mints = 0
  tokens.refreshes = 0
  sheets.resetMetaCache()
  vi.unstubAllGlobals()
})

describe('every write', () => {
  it('is RAW, never USER_ENTERED', async () => {
    // A title of "=SUM(A:A)" must be stored as text, and a date must not be reformatted to the
    // sheet's locale. This is what replaced `Code.gs`'s apostrophe escape.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('p1', { title: '=SUM(A:A)' })])
    await sheets.createTasks(ID, [task('n1', { title: '-2 guests' })])
    await sheets.setConfig(ID, { venue: '@home' })

    const writes = api.log.filter((call) => call.method === 'POST')
    expect(writes.length).toBeGreaterThan(0)
    for (const call of writes) {
      const option = call.params.valueInputOption ?? call.body?.valueInputOption
      expect(option, call.path).toBe('RAW')
    }
    // And it round-trips as the literal text rather than as a formula or a negative number.
    expect(stored(api.grid)[0].title).toBe('=SUM(A:A)')
    expect(stored(api.grid).at(-1).title).toBe('-2 guests')
  })

  it('resolves id -> row from a read taken immediately before it', async () => {
    // Row positions shift whenever anyone sorts or inserts in the Sheets UI, and writing to a
    // stale one overwrites somebody else's task.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('s2', { title: 'Visited' })])
    const order = api.log.map((call) => `${call.method} ${call.path.split('/').pop()}`)
    expect(order[0]).toBe('GET values:batchGet')
    expect(order[1]).toBe('POST values:batchUpdate')
  })

  it('sends ONE request whatever it touches, so Google applies it as a unit', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('p1'), task('s1', { parentId: 'p1' }), task('p2')])
    expect(api.log.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('carries the token, and never sends a request without one', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('p1')])
    for (const call of api.log) expect(call.auth).toBe('Bearer token-1')
  })

  it('carries a timeout, so a connection that never closes cannot wedge the app', async () => {
    /**
     * `fetch` has no limit of its own, and `useBoard` holds `reading` for the life of a read and
     * `saving` for the life of a write — so one socket that never closes blocks every later
     * refresh, or leaves a row dimmed with nothing able to settle it. Invisible from a passing
     * suite, which is why it is pinned here rather than trusted.
     */
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.loadBoard(ID)
    await sheets.updateTasks(ID, [task('p1')])
    expect(api.fetch.mock.calls.length).toBeGreaterThan(0)
    for (const [, init] of api.fetch.mock.calls) {
      expect(init.signal, 'every Sheets call needs a ceiling').toBeInstanceOf(AbortSignal)
    }
  })
})

describe('update', () => {
  it('rewrites the addressed row and leaves its neighbours untouched', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    const before = stored(api.grid)
    await sheets.updateTasks(ID, [task('s2', { title: 'Visited', parentId: 'p1' })])

    const after = stored(api.grid)
    expect(after[2].title).toBe('Visited')
    for (const index of [0, 1, 3, 4]) {
      expect(after[index], `row ${index} moved`).toEqual(before[index])
    }
  })

  it('is ATOMIC ON RESOLUTION: one missing id writes none of the batch', async () => {
    // A row a partner deleted mid-batch fails the whole batch, which is why the client may roll all
    // of it back. A partial success would leave nothing able to say which half landed.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    const before = stored(api.grid)
    await expect(
      sheets.updateTasks(ID, [task('p1', { title: 'Changed' }), task('gone')]),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(stored(api.grid)).toEqual(before)
    expect(api.log.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('keeps created_at from the ROW, never from the client', async () => {
    // A device with a wrong clock must not backdate a row that already exists, and an edit must not
    // restamp when something was made.
    const api = makeApi({ tabs: gridOf([task('p1', { createdAt: '2025-06-01T00:00:00.000Z' })]) })
    await sheets.updateTasks(ID, [task('p1', { title: 'Changed' })])
    expect(stored(api.grid)[0].created_at).toBe('2025-06-01T00:00:00.000Z')
    expect(stored(api.grid)[0].updated_at).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('always writes parent_id, so an edit cannot promote a subtask', async () => {
    // A write rewrites the whole row, so a payload built without it blanks the cell.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('s1', { title: 'Edited', parentId: 'p1' })])
    expect(stored(api.grid)[1].parent_id).toBe('p1')
  })
})

describe('create', () => {
  it('appends a new row', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.createTasks(ID, [task('n1', { title: 'New' })])
    expect(stored(api.grid)).toHaveLength(6)
    expect(stored(api.grid)[5]).toMatchObject({ id: 'n1', title: 'New' })
  })

  it('is an UPSERT on the client’s id, which is what makes a retry safe', async () => {
    // The id is generated in the browser, so the same create arriving twice is the same row twice,
    // not two tasks. A reply lost to a dropped connection left the old code unable to tell
    // "nothing was written" from "written, and the answer went missing".
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.createTasks(ID, [task('n1', { title: 'New' })])
    await sheets.createTasks(ID, [task('n1', { title: 'New' })])
    expect(stored(api.grid).filter((row) => row.id === 'n1')).toHaveLength(1)
    expect(stored(api.grid)).toHaveLength(6)
  })

  it('preserves created_at when a replay rewrites an existing row', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.createTasks(ID, [task('n1')])
    const created = stored(api.grid)[5].created_at
    await sheets.createTasks(ID, [task('n1', { title: 'Replayed' })])
    expect(stored(api.grid)[5].created_at).toBe(created)
    expect(stored(api.grid)[5].title).toBe('Replayed')
  })

  it('splits a mixed batch: known rows in place, new ones appended', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.createTasks(ID, [task('p2', { title: 'Replayed' }), task('n2', { title: 'Fresh' })])
    expect(stored(api.grid)[4].title).toBe('Replayed')
    expect(stored(api.grid)[5]).toMatchObject({ id: 'n2', title: 'Fresh' })
    expect(stored(api.grid)).toHaveLength(6)
  })

  it('appends a whole template seed in one request', async () => {
    const api = makeApi({ tabs: gridOf([]) })
    const drafts = Array.from({ length: 40 }, (_, index) => task(`t${index}`))
    await sheets.createTasks(ID, drafts)
    expect(api.log.filter((call) => call.path.endsWith(':append'))).toHaveLength(1)
    expect(stored(api.grid)).toHaveLength(40)
  })
})

describe('delete and restore', () => {
  it('cascades to subtasks in ONE request', async () => {
    // N separate calls can half-fail, leaving some children tombstoned and some not.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.setDeleted(ID, 'p1', '2026-08-13T00:00:00.000Z')

    const rows = stored(api.grid)
    for (const index of [0, 1, 2, 3]) expect(rows[index].deleted_at, `row ${index}`).toBeTruthy()
    expect(rows[4].deleted_at).toBe('')
    expect(api.log.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('touches ONLY the affected rows, because there is no lock any more', async () => {
    // The script rewrote the whole span with values read a moment earlier, which was safe only
    // because it held a lock. Doing that now is how one editor's save erases the other's.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.setDeleted(ID, 'p2', '2026-08-13T00:00:00.000Z')
    const written = api.log.find((call) => call.method === 'POST').body.data
    expect(written).toHaveLength(1)
    expect(written[0].range).toContain('6:')
  })

  it('writes updated_at and deleted_at as one span per row', async () => {
    // They are adjacent in TASK_COLUMNS, so a cascade is one range per row rather than two.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.setDeleted(ID, 'p1', '2026-08-13T00:00:00.000Z')
    for (const entry of api.log.find((call) => call.method === 'POST').body.data) {
      expect(entry.values[0]).toHaveLength(2)
    }
  })

  it('restores as the exact inverse, children included', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.setDeleted(ID, 'p1', '2026-08-13T00:00:00.000Z')
    await sheets.setDeleted(ID, 'p1', '')
    for (const row of stored(api.grid)) expect(row.deleted_at).toBe('')
  })

  it('refuses a row that is not there rather than writing nothing quietly', async () => {
    makeApi({ tabs: gridOf(FAMILY) })
    await expect(sheets.setDeleted(ID, 'nope', 'x')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('compact', () => {
  it('deletes tombstoned rows in DESCENDING order', async () => {
    // Deleting row 5 shifts row 9 up to row 8, so an ascending pass deletes the wrong rows after
    // the first one.
    const api = makeApi({
      tabs: gridOf([
        task('a'),
        task('b', { deletedAt: 'x' }),
        task('c'),
        task('d', { deletedAt: 'x' }),
        task('e'),
      ]),
    })
    const { removed } = await sheets.compact(ID)
    expect(removed).toBe(2)
    expect(stored(api.grid).map((row) => row.id)).toEqual(['a', 'c', 'e'])

    const deletes = api.log
      .filter((call) => call.body?.requests?.[0]?.deleteDimension)
      .flatMap((call) => call.body.requests.map((r) => r.deleteDimension.range.startIndex))
    expect(deletes).toEqual([...deletes].sort((left, right) => right - left))
  })

  it('clears a live child’s pointer at the one moment the information still exists', async () => {
    // The read promotes an orphan to top level either way, but the sheet is what a person looks at.
    const api = makeApi({
      tabs: gridOf([task('p1', { deletedAt: 'x' }), task('s1', { parentId: 'p1' })]),
    })
    await sheets.compact(ID)
    expect(stored(api.grid)).toHaveLength(1)
    expect(stored(api.grid)[0]).toMatchObject({ id: 's1', parent_id: '' })
  })

  it('does nothing at all with no tombstones', async () => {
    const api = makeApi({ tabs: gridOf([task('a')]) })
    expect(await sheets.compact(ID)).toEqual({ removed: 0 })
    expect(api.log.some((call) => call.body?.requests)).toBe(false)
  })
})

describe('config', () => {
  it('rewrites a key the tab already holds, in place', async () => {
    const api = makeApi({ tabs: gridOf([]) })
    await sheets.setConfig(ID, { timezone: 'Europe/London' })
    expect(api.grid.config).toEqual([['key', 'value'], ['timezone', 'Europe/London']])
  })

  it('appends a key it has never held', async () => {
    const api = makeApi({ tabs: gridOf([]) })
    await sheets.setConfig(ID, { venue: 'The hall' })
    expect(api.grid.config).toEqual([
      ['key', 'value'],
      ['timezone', 'Asia/Tokyo'],
      ['venue', 'The hall'],
    ])
  })

  it('leaves every other row exactly as it was', async () => {
    const api = makeApi({ tabs: gridOf([]) })
    api.grid.config.push(['a_note', 'do not touch'])
    await sheets.setConfig(ID, { timezone: 'Europe/London' })
    expect(api.grid.config.at(-1)).toEqual(['a_note', 'do not touch'])
  })

  it('SHARES THE TAB WITH THE NOTES DOCUMENT, touching one cell per gesture', async () => {
    // The whole reason a document can live in a key/value tab with no lock: `serializeConfig` emits
    // only the fields it is handed and this writes only the rows the payload names, so a notes save
    // and a Settings save landing together cannot overwrite each other. Break either half and the
    // two fight over one range.
    const api = makeApi({ tabs: gridOf([]) })
    await sheets.setConfig(ID, { venue: 'The hall', notes: '# Venue\n- Booked' })
    await sheets.setConfig(ID, { notes: '# Venue\n- Booked\n- Deposit paid' })
    expect(api.grid.config).toEqual([
      ['key', 'value'],
      ['timezone', 'Asia/Tokyo'],
      ['venue', 'The hall'],
      ['notes', '# Venue\n- Booked\n- Deposit paid'],
    ])
  })

  it('stores a multi-line document verbatim, newlines and leading hashes included', async () => {
    // RAW, so a leading `#` or `-` stays text rather than becoming a formula or a bullet the Sheets
    // UI invents, and the interior newlines survive the round trip.
    const api = makeApi({ tabs: gridOf([]) })
    const document = '# Venue\n\n- **Booked** the pavilion\n1. Deposit paid'
    await sheets.setConfig(ID, { notes: document })
    expect(api.grid.config.at(-1)).toEqual(['notes', document])
    expect(api.log.at(-1).body?.valueInputOption ?? 'RAW').toBe('RAW')
  })
})

describe('the header repair', () => {
  it('moves each value by the NAME its own header cell gives it', async () => {
    // A person can reorder a column in the Sheets UI, and every write addresses cells by index —
    // so without this a due date lands in the category column.
    const swapped = gridOf(FAMILY)
    const due = HEADER.indexOf('due')
    const category = HEADER.indexOf('category')
    for (const line of swapped.tasks) {
      const held = line[due]
      line[due] = line[category]
      line[category] = held
    }
    const api = makeApi({ tabs: swapped })

    await sheets.updateTasks(ID, [task('p2', { title: 'Edited' })])
    expect(api.grid.tasks[0]).toEqual(HEADER)
    const rows = stored(api.grid)
    expect(rows[0].due).toBe('2027-02-01')
    expect(rows[0].category).toBe('Venue')
  })

  it('leaves a trailing column alone, in BOTH directions', async () => {
    // The read is `tasks!A1:I`, derived from `TASK_COLUMNS`, so a column past I is invisible to
    // this app and cannot shift an index. `Code.gs` did clear one — it read every column that
    // existed, where a shifting count could take a real column with it — and chasing that here
    // would mean widening the read to tidy something harmless, AND wiping the column a newer
    // deployment appends. So it stays, whether or not the repair runs.
    const wide = gridOf(FAMILY)
    const due = HEADER.indexOf('due')
    const category = HEADER.indexOf('category')
    for (const line of wide.tasks) {
      const held = line[due]
      line[due] = line[category]
      line[category] = held
    }
    wide.tasks[0].push('something_newer')
    wide.tasks[1].push('keep me')
    const api = makeApi({ tabs: wide })

    await sheets.updateTasks(ID, [task('p1')])
    // The repair ran — the layout's own columns are back in order …
    expect(api.grid.tasks[0].slice(0, HEADER.length)).toEqual(HEADER)
    expect(stored(api.grid)[0].due).toBe('2027-02-01')
    // … and it did not reach past the width it knows about.
    expect(api.grid.tasks[0][HEADER.length]).toBe('something_newer')
    expect(api.grid.tasks[1][HEADER.length]).toBe('keep me')
  })

  it('does not run when the header already matches', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.updateTasks(ID, [task('p1')])
    // One write, not two: the repair would be a whole-grid write of its own.
    expect(api.log.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('rebuilds a header somebody deleted entirely', async () => {
    const api = makeApi({ tabs: { tasks: [], config: [['key', 'value']] } })
    await sheets.createTasks(ID, [task('n1')])
    expect(api.grid.tasks[0]).toEqual(HEADER)
    expect(stored(api.grid)[0].id).toBe('n1')
  })
})

describe('structure', () => {
  it('builds both tabs on the first write to an empty spreadsheet', async () => {
    const api = makeApi({ tabs: {} })
    await sheets.createTasks(ID, [task('n1')])
    expect(Object.keys(api.grid).sort()).toEqual(['config', 'tasks'])
    expect(api.grid.tasks[0]).toEqual(HEADER)
    expect(api.grid.config[0]).toEqual(['key', 'value'])
  })

  it('formats the columns as text, so a hand-typed date is not parsed', async () => {
    const api = makeApi({ tabs: {} })
    await sheets.ensureStructure(ID)
    const formats = api.log
      .flatMap((call) => call.body?.requests ?? [])
      .filter((request) => request.repeatCell)
    expect(formats.length).toBeGreaterThan(0)
    for (const request of formats) {
      expect(request.repeatCell.cell.userEnteredFormat.numberFormat).toEqual({
        type: 'TEXT',
        pattern: '@',
      })
    }
  })

  it('REFUSES a spreadsheet that already looks like somebody’s work', async () => {
    // The id arrives from the token endpoint rather than from a person choosing a file, so a wrong
    // one is a configuration mistake — and adding tabs to an unrelated spreadsheet is not
    // something undo can reach.
    const api = makeApi({ tabs: { Budget: [[]], Guests: [[]] } })
    await expect(sheets.ensureStructure(ID)).rejects.toMatchObject({ code: 'not_empty' })
    expect(Object.keys(api.grid).sort()).toEqual(['Budget', 'Guests'])
  })

  it('accepts a fresh spreadsheet, which has exactly one default tab', async () => {
    const api = makeApi({ tabs: { Sheet1: [[]] } })
    await sheets.ensureStructure(ID)
    expect(Object.keys(api.grid)).toContain('tasks')
  })

  it('does nothing when both tabs already exist', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.ensureStructure(ID)
    expect(api.log.some((call) => call.body?.requests)).toBe(false)
  })
})

describe('reading the board', () => {
  it('takes one round trip once the session knows the zone', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    await sheets.loadBoard(ID)
    const first = api.log.length
    api.log.length = 0
    await sheets.loadBoard(ID)
    // The first read also fetches the metadata, in PARALLEL, so even that costs one round trip of
    // latency rather than two. Every read after it is the batchGet alone.
    expect(first).toBe(2)
    expect(api.log).toHaveLength(1)
  })

  it('resolves columns by name and reports the sheet’s zone', async () => {
    makeApi({ tabs: gridOf(FAMILY) })
    const board = await sheets.loadBoard(ID)
    expect(board.tasks).toHaveLength(5)
    expect(board.tasks[0].id).toBe('p1')
    expect(board.config.timezone).toBe('Asia/Tokyo')
    expect(board.sheetTimeZone).toBe('Asia/Tokyo')
  })

  it('reads an unbuilt spreadsheet as an empty board, not an error', async () => {
    makeApi({ tabs: {} })
    const board = await sheets.loadBoard(ID)
    expect(board).toMatchObject({ tasks: [], needsSetup: true })
  })

  it('skips a blank row somebody left with a stray Enter', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    api.grid.tasks.push(new Array(HEADER.length).fill(''))
    expect((await sheets.loadBoard(ID)).tasks).toHaveLength(5)
  })
})

/**
 * 400 IS "NOT BUILT YET"; 404 IS "NO SUCH SPREADSHEET", AND THE TWO MUST NOT DECODE ALIKE.
 *
 * Reading a 404 as an unbuilt board is how a wrong id, a file in the trash or a null id from a
 * superseded mint turned into an EMPTY BOARD — which `useBoard` then wrote over the device's
 * last-good snapshot, so the relaunch was empty too, and which invited an editor to seed a template
 * over the top of a board that still exists. Every one of the three call sites below is a place a
 * 404 has to travel on as an error instead.
 *
 * The fake answers a missing tab with a 400 of its own, so each status here is injected on the read
 * the branch actually looks at, rather than inferred from the shape of the grid.
 */
describe('an id that names nothing', () => {
  /** The FIRST `values:batchGet` answered with `status`; everything after it is served normally. */
  function failsFirstRead(api, status) {
    const real = api.fetch.getMockImplementation()
    let spent = false
    api.fetch.mockImplementation(async (url, init) => {
      if (!spent && String(url).includes('values:batchGet')) {
        spent = true
        return { ok: false, status, json: async () => ({ error: { message: 'forced' } }) }
      }
      return real(url, init)
    })
  }

  it('reads a 400 as an empty board still waiting to be built', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    failsFirstRead(api, 400)
    expect(await sheets.loadBoard(ID)).toMatchObject({ tasks: [], needsSetup: true })
  })

  it('throws a 404 out of loadBoard instead of decoding it as an empty board', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    failsFirstRead(api, 404)
    await expect(sheets.loadBoard(ID)).rejects.toMatchObject({ status: 404 })
  })

  it('throws a 404 out of a write rather than building tabs somewhere else', async () => {
    // `openGrid` builds the structure on a 400. Doing that on a 404 means `ensureStructure` running
    // against a spreadsheet this account may still be able to reach.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    failsFirstRead(api, 404)
    await expect(sheets.updateTasks(ID, [task('p1')])).rejects.toMatchObject({ status: 404 })
    expect(api.log.some((call) => call.body?.requests?.[0]?.addSheet)).toBe(false)
    expect(api.log.some((call) => call.method === 'POST')).toBe(false)
  })

  it('throws a 404 out of a config write, which reads its own range', async () => {
    // `setConfig` does not go through `openGrid`, so it carries the same decision separately.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    failsFirstRead(api, 404)
    await expect(sheets.setConfig(ID, { venue: 'The hall' })).rejects.toMatchObject({ status: 404 })
    expect(api.log.some((call) => call.method === 'POST')).toBe(false)
  })

  it('still builds the config tab on a 400', async () => {
    const api = makeApi({ tabs: {} })
    await sheets.setConfig(ID, { venue: 'The hall' })
    expect(api.grid.config[0]).toEqual(['key', 'value'])
    expect(api.grid.config.at(-1)).toEqual(['venue', 'The hall'])
  })
})

/**
 * The four guards on a payload this bundle built wrongly. Each throws `bad_payload`, which
 * `api.js` maps to `misconfigured` — terminal, so it is said once rather than retried for two
 * seconds — and none of them spends a request first.
 */
describe('a payload that cannot be written', () => {
  it('refuses an empty list or a missing id before any request goes out', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    const cases = [
      ['createTasks', () => sheets.createTasks(ID, [])],
      ['updateTasks', () => sheets.updateTasks(ID, [])],
      ['setDeleted', () => sheets.setDeleted(ID, '', 'x')],
      ['setConfig', () => sheets.setConfig(ID, null)],
    ]
    for (const [name, call] of cases) {
      await expect(call(), name).rejects.toMatchObject({ code: 'bad_payload' })
    }
    expect(api.log).toHaveLength(0)
  })
})

describe('a rejected token', () => {
  it('re-mints and retries EXACTLY once', async () => {
    // A 401 means the token was rejected even if it still looked unexpired. Never more than once:
    // a revoked grant would loop forever.
    const api = makeApi({ tabs: gridOf(FAMILY) })
    api.fetch.rejectOnce = 401
    await sheets.updateTasks(ID, [task('p1', { title: 'Edited' })])

    expect(tokens.refreshes).toBe(1)
    expect(stored(api.grid)[0].title).toBe('Edited')
    expect(api.log[1].auth).toBe('Bearer token-2')
  })

  it('gives up rather than looping when the fresh token is refused too', async () => {
    const api = makeApi({ tabs: gridOf(FAMILY) })
    api.fetch.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'nope' } }),
    }))
    await expect(sheets.updateTasks(ID, [task('p1')])).rejects.toMatchObject({ status: 401 })
    expect(tokens.refreshes).toBe(1)
  })
})
