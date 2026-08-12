/**
 * `apps-script/Code.gs`, executed.
 *
 * The other cross-boundary test pins the column LIST; this one runs the code. It exists because
 * the write path was rewritten for latency — the ops now share one read of the grid and stamp
 * whole columns in a single call instead of a cell at a time — and every one of those changes is
 * the kind that returns `{ok: true}` while quietly writing the wrong cell. There is no way to
 * see that from the browser, and the only other place to find out is somebody's real board.
 *
 * The fake is deliberately literal about the two things that actually bite:
 *
 *   A RANGE IS ADDRESSED, NOT NAMED. `getRange(row, column, rows, columns)` is 1-based and
 *   `setValues` must be given exactly that shape, so an off-by-one lands as a real off-by-one
 *   here rather than passing.
 *
 *   A CELL CAN HOLD A DATE. Whatever number format the script writes, a person editing the sheet
 *   by hand can leave a real Date in a cell — and `String(new Date())` is unparseable by the
 *   client. `readCell` is the recovery, and the column stamping has to preserve it.
 *
 * It is NOT a Sheets emulator. Formats are recorded rather than applied, so it cannot catch a
 * missing `setNumberFormat` by its effect — the assertions check the call instead.
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_COLUMNS } from '../src/schema.js'

const SOURCE = readFileSync('apps-script/Code.gs', 'utf8')
const KEY = 'test-key'

/** A tab: a 2D array of cell values, plus a note of what was formatted. */
function makeSheet(name, grid) {
  const sheet = {
    name,
    grid,
    formatted: [],
    writes: 0,
    reads: 0,
    // Read off the object, not the closed-over argument: a test that renames a tab has to be
    // seen to have renamed it.
    getName: () => sheet.name,
    getLastRow: () => {
      for (let row = sheet.grid.length; row > 0; row -= 1) {
        if (sheet.grid[row - 1].some((cell) => cell !== '' && cell != null)) return row
      }
      return 0
    },
    getMaxRows: () => Math.max(sheet.grid.length, 1000),
    getLastColumn: () => Math.max(0, ...sheet.grid.map((line) => line.length)),
    /**
     * ONE service call for the header and every row, which is what the script reads the grid
     * with. It reports the columns that are ACTUALLY there rather than the nine this version
     * expects — that is the whole point, and it is what lets a legacy thirteen-column layout be
     * seen as one instead of read as nine wrong cells. Clamped to 1x1 like the real thing, so an
     * empty tab still yields a row for the header check to fail on.
     */
    getDataRange: () =>
      sheet.getRange(
        1,
        1,
        Math.max(1, sheet.getLastRow()),
        Math.max(1, Math.max(0, ...sheet.grid.map((line) => line.length))),
      ),
    setFrozenRows: () => {},
    deleteRow: (row) => {
      sheet.grid.splice(row - 1, 1)
    },
    getRange: (top, left, rows = 1, columns = 1) => ({
      getValues: () => {
        sheet.reads += 1
        const out = []
        for (let r = 0; r < rows; r += 1) {
          const line = []
          for (let c = 0; c < columns; c += 1) line.push(sheet.grid[top - 1 + r]?.[left - 1 + c] ?? '')
          out.push(line)
        }
        return out
      },
      setValues: (values) => {
        sheet.writes += 1
        // The shape has to match the range, exactly as the real service demands.
        if (values.length !== rows) throw new Error(`setValues: ${values.length} rows for ${rows}`)
        values.forEach((line, r) => {
          if (line.length !== columns) {
            throw new Error(`setValues: ${line.length} columns for ${columns}`)
          }
          // Appended rows take the TAB's own width. The config tab is two columns wide, not
          // thirteen, and a fake that pads every sheet to the task layout tests nothing real.
          const width = Math.max(left - 1 + columns, ...sheet.grid.map((line) => line.length))
          while (sheet.grid.length < top + r) sheet.grid.push(new Array(width).fill(''))
          line.forEach((value, c) => {
            sheet.grid[top - 1 + r][left - 1 + c] = value
          })
        })
      },
      setValue: (value) => {
        sheet.writes += 1
        sheet.grid[top - 1][left - 1] = value
      },
      setNumberFormat: (format) => {
        sheet.formatted.push({ top, left, rows, columns, format })
      },
      setFontWeight: () => {},
      clearContent: () => {
        sheet.writes += 1
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < columns; c += 1) {
            if (sheet.grid[top - 1 + r]) sheet.grid[top - 1 + r][left - 1 + c] = ''
          }
        }
      },
    }),
  }
  return sheet
}

/** A brand-new spreadsheet: one empty default tab, nothing of ours. */
function makeFreshBook(existing = ['Sheet1']) {
  const sheets = existing.map((name) => makeSheet(name, [[]]))
  const inserted = []
  const book = {
    inserted,
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
    insertSheet: (name) => {
      const made = makeSheet(name, [[]])
      sheets.push(made)
      inserted.push(name)
      return made
    },
    deleteSheet: (sheet) => sheets.splice(sheets.indexOf(sheet), 1),
  }
  return book
}

function makeBook(rows = []) {
  const header = TASK_COLUMNS.slice()
  const tasks = makeSheet('tasks', [header, ...rows.map((row) => header.map((name) => row[name] ?? ''))])
  const config = makeSheet('config', [
    ['key', 'value'],
    ['timezone', 'Asia/Tokyo'],
  ])
  const sheets = [tasks, config]
  return {
    tasks,
    config,
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
    insertSheet: (name) => {
      const made = makeSheet(name, [[]])
      sheets.push(made)
      return made
    },
    deleteSheet: (sheet) => sheets.splice(sheets.indexOf(sheet), 1),
  }
}

/** The script, with the Apps Script globals it reaches for. */
function load(book) {
  const globals = {
    SpreadsheetApp: { getActive: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => KEY }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType: () => text }),
    },
    Utilities: {
      // Only ever called with the wall-clock pattern; UTC parts are enough for the assertions.
      formatDate: (date) => date.toISOString().slice(0, 16),
    },
  }
  const names = Object.keys(globals)
  const factory = new Function(...names, `${SOURCE}\nreturn { doGet, doPost }`)
  return factory(...names.map((name) => globals[name]))
}

const post = (script, op, payload) =>
  JSON.parse(script.doPost({ postData: { contents: JSON.stringify({ key: KEY, op, payload }) } }))

const task = (overrides) => ({
  id: 'p1',
  title: 'Book the venue',
  category: 'Venue',
  due: '2027-02-01',
  done_at: '',
  deleted_at: '',
  parent_id: '',
  ...overrides,
})

/** The layout this script replaced, for the relayout cases. */
const LEGACY_COLUMNS = [
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
  'parent_id',
]

/** A tasks tab still on the old thirteen-column layout. */
function makeLegacyBook(rows) {
  const tasks = makeSheet('tasks', [
    LEGACY_COLUMNS.slice(),
    ...rows.map((row) => LEGACY_COLUMNS.map((name) => row[name] ?? '')),
  ])
  const config = makeSheet('config', [
    ['key', 'value'],
    ['timezone', 'Asia/Tokyo'],
  ])
  const sheets = [tasks, config]
  return {
    tasks,
    config,
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
    insertSheet: (name) => {
      const made = makeSheet(name, [[]])
      sheets.push(made)
      return made
    },
    deleteSheet: (sheet) => sheets.splice(sheets.indexOf(sheet), 1),
  }
}

const LEGACY_ROWS = [
  {
    id: 'L1',
    title: 'Book the venue',
    category: 'Venue',
    start: '2026-12-01T00:00',
    end: '2027-02-01T23:59',
    all_day: 'TRUE',
    notes: 'call first',
    owner: 'Both',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    deleted_at: '',
    parent_id: '',
  },
  {
    id: 'L2',
    title: 'Shortlist three',
    category: '',
    start: '',
    end: '',
    all_day: '',
    done_at: '2026-06-06T00:00:00.000Z',
    created_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-01-03T00:00:00.000Z',
    deleted_at: '',
    parent_id: 'L1',
  },
]

/** The stored grid as row objects, header excluded. */
function stored(book) {
  return book.tasks.grid.slice(1).map((line) => {
    const row = {}
    TASK_COLUMNS.forEach((name, index) => {
      row[name] = line[index]
    })
    return row
  })
}

const FAMILY = [
  task({ id: 'p1' }),
  task({ id: 's1', title: 'Shortlist three', parent_id: 'p1' }),
  task({ id: 's2', title: 'Visit them', parent_id: 'p1' }),
  task({ id: 's3', title: 'Sign the contract', parent_id: 'p1' }),
  task({ id: 'p2', title: 'Order the cake', parent_id: '' }),
]

let book
let script

beforeEach(() => {
  book = makeBook(FAMILY)
  script = load(book)
})

describe('the read', () => {
  it('returns every row as strings, with the deployment’s column list', () => {
    const body = JSON.parse(script.doGet())
    expect(body.ok).toBe(true)
    expect(body.tasks).toHaveLength(5)
    expect(body.schema).toEqual(TASK_COLUMNS)
    expect(body.tasks[0].id).toBe('p1')
  })

  it('reformats a cell the Sheets UI coerced to a Date', () => {
    // Otherwise it crosses the wire as "Fri Aug 07 2026 …" and the client cannot parse it. The
    // client's `normalizeDay` then slices the clock half off.
    book.tasks.grid[1][TASK_COLUMNS.indexOf('due')] = new Date('2027-01-01T00:00:00Z')
    expect(JSON.parse(script.doGet()).tasks[0].due).toBe('2027-01-01T00:00')
  })

  it('reports its column list even on a board with no tabs yet', () => {
    // Absence of `schema` is how the client detects a deployment older than its own bundle, and
    // this deployment knows its columns whether or not the tabs exist. Omitting it here made a
    // brand-new, correctly-deployed board greet its owner with "your script is out of date".
    const fresh = makeFreshBook()
    const body = JSON.parse(load(fresh).doGet())
    expect(body.needsSetup).toBe(true)
    expect(body.schema).toEqual(TASK_COLUMNS)
  })

  it('never writes', () => {
    const before = book.tasks.writes
    script.doGet()
    expect(book.tasks.writes).toBe(before)
  })
})

describe('the key', () => {
  it('refuses a wrong one, a missing one, and a malformed body identically', () => {
    const raw = (contents) => JSON.parse(script.doPost({ postData: { contents } }))
    for (const body of [
      JSON.stringify({ key: 'wrong', op: 'delete', payload: { id: 'p1' } }),
      JSON.stringify({ op: 'delete', payload: { id: 'p1' } }),
      'not json',
      'null',
    ]) {
      expect(raw(body)).toEqual({ ok: false, error: 'unauthorized' })
    }
    // And nothing was written on any of those paths.
    expect(stored(book).every((row) => !row.deleted_at)).toBe(true)
  })
})

describe('update', () => {
  it('rewrites the addressed row and leaves its neighbours alone', () => {
    const body = post(script, 'update', { task: task({ id: 's2', title: 'Visited', parent_id: 'p1' }) })
    expect(body.ok).toBe(true)
    const rows = stored(book)
    expect(rows[2].title).toBe('Visited')
    expect(rows[1].title).toBe('Shortlist three')
    expect(rows[3].title).toBe('Sign the contract')
  })

  it('keeps a subtask a subtask', () => {
    // `update` writes the WHOLE row from the payload, so a dropped parent_id silently promotes
    // a checklist item to a task of its own.
    post(script, 'update', { task: task({ id: 's1', title: 'Shortlist three', parent_id: 'p1' }) })
    expect(stored(book)[1].parent_id).toBe('p1')
  })

  it('preserves created_at from the row, not from the client', () => {
    book.tasks.grid[1][TASK_COLUMNS.indexOf('created_at')] = '2026-01-01T00:00:00.000Z'
    post(script, 'update', { task: task({ id: 'p1', created_at: '1999-01-01T00:00:00.000Z' }) })
    expect(stored(book)[0].created_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('answers not_found for a row that is gone, without writing', () => {
    const before = book.tasks.writes
    expect(post(script, 'update', { task: task({ id: 'nope' }) }).error).toBe('not_found')
    expect(book.tasks.writes).toBe(before)
  })

  it('formats before it writes', () => {
    post(script, 'update', { task: task({ id: 'p1' }) })
    expect(book.tasks.formatted.length).toBeGreaterThan(0)
  })

  it('escapes a title that would otherwise become a formula', () => {
    post(script, 'update', { task: task({ id: 'p1', title: '=SUM(A:A)' }) })
    expect(stored(book)[0].title).toBe("'=SUM(A:A)")
  })
})

describe('delete and restore', () => {
  it('cascades to every subtask and to nothing else', () => {
    expect(post(script, 'delete', { id: 'p1' }).ok).toBe(true)
    const rows = stored(book)
    expect(rows.slice(0, 4).every((row) => row.deleted_at)).toBe(true)
    expect(rows[4].deleted_at).toBe('')
  })

  it('restores the same set', () => {
    post(script, 'delete', { id: 'p1' })
    post(script, 'restore', { id: 'p1' })
    expect(stored(book).every((row) => row.deleted_at === '')).toBe(true)
  })

  it('deletes a subtask on its own without touching its parent', () => {
    post(script, 'delete', { id: 's2' })
    const rows = stored(book)
    expect(rows[2].deleted_at).toBeTruthy()
    expect(rows[0].deleted_at).toBe('')
    expect(rows[1].deleted_at).toBe('')
  })

  it('costs the same number of writes whatever the cascade’s size', () => {
    // The point of the rewrite. One cell at a time, a parent with four subtasks was ten round
    // trips and measured 3.6-4.0s against 2.66s for a single row.
    const one = makeBook(FAMILY)
    post(load(one), 'delete', { id: 'p2' })
    const many = makeBook(FAMILY)
    post(load(many), 'delete', { id: 'p1' })
    expect(many.tasks.writes).toBe(one.tasks.writes)
    expect(many.tasks.writes).toBeLessThanOrEqual(2)
  })

  it('leaves an untouched row’s own timestamps as they were', () => {
    // The stamp rewrites whole columns, so every untouched cell is written back — with the value
    // it already held, or this would quietly rewrite the board's history.
    book.tasks.grid[5][TASK_COLUMNS.indexOf('updated_at')] = '2026-05-05T05:05:05.000Z'
    post(script, 'delete', { id: 'p1' })
    expect(stored(book)[4].updated_at).toBe('2026-05-05T05:05:05.000Z')
  })

  it('normalises an untouched cell the Sheets UI coerced to a Date', () => {
    // Written back raw it would land as "Tue May 05 2026 …", which the client cannot read.
    book.tasks.grid[5][TASK_COLUMNS.indexOf('updated_at')] = new Date('2026-05-05T05:05:00Z')
    post(script, 'delete', { id: 'p1' })
    expect(stored(book)[4].updated_at).toBe('2026-05-05T05:05')
  })

  it('stamps updated_at on the rows it changed', () => {
    post(script, 'delete', { id: 's1' })
    expect(stored(book)[1].updated_at).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('answers not_found without writing', () => {
    const before = book.tasks.writes
    expect(post(script, 'delete', { id: 'nope' }).error).toBe('not_found')
    expect(book.tasks.writes).toBe(before)
  })
})

describe('create', () => {
  it('appends and stamps both timestamps', () => {
    post(script, 'create', { task: task({ id: 'new', title: 'Order flowers' }) })
    const rows = stored(book)
    expect(rows).toHaveLength(6)
    expect(rows[5].title).toBe('Order flowers')
    expect(rows[5].created_at).toMatch(/^\d{4}/)
    expect(rows[5].updated_at).toMatch(/^\d{4}/)
  })

  it('refuses a row with no id or no title', () => {
    for (const bad of [{ title: 'x' }, { id: 'y' }, {}]) {
      expect(post(script, 'create', { task: bad }).error).toBe('bad_payload')
    }
    expect(stored(book)).toHaveLength(5)
  })

  it('writes a batch in one call', () => {
    const before = book.tasks.writes
    post(script, 'createMany', {
      tasks: [task({ id: 'm1', title: 'One' }), task({ id: 'm2', title: 'Two' })],
    })
    expect(book.tasks.writes - before).toBe(1)
    expect(stored(book)).toHaveLength(7)
  })
})

describe('compact', () => {
  it('removes tombstoned rows and keeps the rest in order', () => {
    post(script, 'delete', { id: 's2' })
    expect(post(script, 'compact', {}).ok).toBe(true)
    expect(stored(book).map((row) => row.id)).toEqual(['p1', 's1', 's3', 'p2'])
  })

  it('clears a live child’s pointer at the last moment it still means something', () => {
    // Deleting only the parent then compacting leaves the children naming a row that is gone.
    book.tasks.grid[1][TASK_COLUMNS.indexOf('deleted_at')] = '2026-01-01T00:00:00.000Z'
    post(script, 'compact', {})
    const rows = stored(book)
    expect(rows.map((row) => row.id)).toEqual(['s1', 's2', 's3', 'p2'])
    expect(rows.slice(0, 3).every((row) => row.parent_id === '')).toBe(true)
  })

  it('deletes descending, so no surviving row is lost', () => {
    // Ascending, removing row 2 shifts row 6 to row 5 and the next deletion takes the wrong one.
    for (const id of ['s1', 's3']) post(script, 'delete', { id })
    post(script, 'compact', {})
    expect(stored(book).map((row) => row.id)).toEqual(['p1', 's2', 'p2'])
  })
})

describe('structure', () => {
  it('builds both tabs on the first write, and the read never does', () => {
    // Building is a write, and `doGet` is anonymous — so an anonymous request must not be able
    // to cause one. An unbuilt board reads as `needsSetup` and the first save does the work.
    const fresh = makeFreshBook()
    const script = load(fresh)
    expect(JSON.parse(script.doGet())).toMatchObject({ ok: true, needsSetup: true, tasks: [] })
    expect(fresh.inserted).toEqual([])

    const body = post(script, 'create', { task: task({ id: 'z', title: 'First' }) })
    expect(body.ok).toBe(true)
    expect(fresh.inserted).toEqual(['tasks', 'config'])
    expect(body.tasks).toHaveLength(1)
    expect(fresh.getSheetByName('tasks').grid[0]).toEqual(TASK_COLUMNS)
    // The empty default tab is cleared away, but only on the write that built ours.
    expect(fresh.getSheetByName('Sheet1')).toBeNull()
  })

  it('refuses a spreadsheet that already holds somebody else’s work', () => {
    // The container is whatever file the script was created from, so binding it to the wrong one
    // is an easy mistake — and adding tabs to a spreadsheet in use is not something undo reaches.
    const theirs = makeFreshBook(['Budget', 'Guests'])
    expect(post(load(theirs), 'create', { task: task() }).error).toBe('not_empty')
    expect(theirs.inserted).toEqual([])
  })

  it('repairs a header row somebody blanked a cell in', () => {
    book.tasks.grid[0] = TASK_COLUMNS.slice(0, -1).concat([''])
    post(script, 'update', { task: task({ id: 'p1' }) })
    expect(book.tasks.grid[0]).toEqual(TASK_COLUMNS)
  })

  it('leaves a correct header alone', () => {
    const before = book.tasks.writes
    post(script, 'update', { task: task({ id: 'p1' }) })
    // One write: the row itself. A header rewrite on every save would be a wasted round trip.
    expect(book.tasks.writes - before).toBe(1)
  })
})

describe('an existing board on the previous layout', () => {
  let legacy
  let legacyScript

  beforeEach(() => {
    legacy = makeLegacyBook(LEGACY_ROWS)
    legacyScript = load(legacy)
  })

  it('READS by column name, so the anonymous read needs no write', () => {
    // `doGet` cannot relayout — an anonymous request must not cause a write — so it resolves
    // its own columns from the header row it just read. Reading at this version's indices
    // instead would report `start` as the due date and `notes` as `created_at`.
    const before = legacy.tasks.writes
    const body = JSON.parse(legacyScript.doGet())
    expect(legacy.tasks.writes).toBe(before)
    expect(body.tasks).toHaveLength(2)
    expect(body.tasks[0]).toMatchObject({
      id: 'L1',
      title: 'Book the venue',
      // The old closing end of the window IS the due date; the client slices the clock off.
      due: '2027-02-01T23:59',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    expect(body.tasks[1]).toMatchObject({ id: 'L2', parent_id: 'L1', due: '' })
  })

  it('moves the grid onto the new layout on the first WRITE', () => {
    post(legacyScript, 'update', { task: task({ id: 'L1', title: 'Booked', due: '2027-02-01' }) })
    expect(legacy.tasks.grid[0].slice(0, TASK_COLUMNS.length)).toEqual(TASK_COLUMNS)
    const rows = stored(legacy)
    expect(rows[0]).toMatchObject({
      id: 'L1',
      title: 'Booked',
      due: '2027-02-01',
      created_at: '2026-01-01T00:00:00.000Z',
      parent_id: '',
    })
    // The untouched row was carried across by NAME, not by position — read by index it would
    // have taken `start` as its due date and `notes` as its created_at.
    expect(rows[1]).toMatchObject({
      id: 'L2',
      title: 'Shortlist three',
      due: '',
      done_at: '2026-06-06T00:00:00.000Z',
      created_at: '2026-01-03T00:00:00.000Z',
      parent_id: 'L1',
    })
  })

  it('clears the columns the old layout had past the new width', () => {
    // An orphaned `owner` column under a blank header is exactly the kind of thing somebody
    // deletes by hand, taking a real column with it if the count ever shifts again.
    post(legacyScript, 'update', { task: task({ id: 'L1' }) })
    for (const line of legacy.tasks.grid) {
      expect(line.slice(TASK_COLUMNS.length).every((cell) => cell === '')).toBe(true)
    }
  })

  it('runs once, then leaves the grid alone', () => {
    post(legacyScript, 'update', { task: task({ id: 'L1', title: 'Booked' }) })
    const after = legacy.tasks.writes
    post(legacyScript, 'update', { task: task({ id: 'L1', title: 'Booked again' }) })
    // One write: the row itself. A relayout on every save would be wasted round trips.
    expect(legacy.tasks.writes - after).toBe(1)
  })

  it('does not lose a row to the move', () => {
    post(legacyScript, 'create', { task: task({ id: 'N1', title: 'Order flowers' }) })
    expect(stored(legacy).map((row) => row.id)).toEqual(['L1', 'L2', 'N1'])
  })
})

describe('every reply', () => {
  it('carries the fresh board, so a save costs one round trip', () => {
    const body = post(script, 'create', { task: task({ id: 'new', title: 'Order flowers' }) })
    expect(body.tasks).toHaveLength(6)
    expect(body.config.timezone).toBe('Asia/Tokyo')
  })

  it('is a 200 with the verdict in the body, never a thrown error page', () => {
    // A throw returns Google's HTML, which the client classifies as transient and retries — so a
    // throw on a reject path is a silent retry loop.
    for (const op of ['bad_op', 'update', 'delete', 'setConfig']) {
      expect(() => post(script, op, undefined)).not.toThrow()
    }
  })

  it('refuses an unknown op', () => {
    expect(post(script, 'nonsense', {}).error).toBe('bad_op')
  })
})

describe('config', () => {
  it('updates an existing key in place and appends a new one', () => {
    post(script, 'setConfig', { config: { timezone: 'Europe/Paris', venue: 'Meguro' } })
    expect(book.config.grid).toEqual([
      ['key', 'value'],
      ['timezone', 'Europe/Paris'],
      ['venue', 'Meguro'],
    ])
  })

  it('escapes a value that would become a formula', () => {
    post(script, 'setConfig', { config: { venue: '-Meguro' } })
    expect(book.config.grid[2][1]).toBe("'-Meguro")
  })
})
