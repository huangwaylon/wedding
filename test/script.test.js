/**
 * `apps-script/Code.gs`, executed.
 *
 * The other cross-boundary test pins the column LIST; this one runs the code. It exists because
 * the write path is shaped for latency — the ops share one read of the grid and stamp whole
 * columns in a single call rather than a cell at a time — and every one of those choices is the
 * kind that returns `{ok: true}` while quietly writing the wrong cell. There is no way to see
 * that from the browser, and the only other place to find out is somebody's real board.
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
 * missing `setNumberFormat` by its effect — the assertions check the call instead. It does not
 * consume a leading apostrophe either, which real Sheets does: no fake can strip that character
 * and still show that the escape was sent, so the tests that care assert the grid and the reply
 * differ by exactly it.
 *
 * IT COUNTS CALLS, and several tests assert an exact number. A Sheets service call is the unit of
 * cost in Apps Script — a write is ~3s of round trip and the arithmetic between calls is free — so
 * a second read of something already in hand is the regression this file exists to catch.
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
    /**
     * ONE service call for the header and every row, which is what the script reads the grid
     * with. It reports the columns that are ACTUALLY there rather than the ones this version
     * expects — that is the whole point, and it is what lets a header somebody widened or
     * reordered be seen as one instead of read as the wrong cells. Clamped to 1x1 like the real
     * thing, so an empty tab still yields a row for the header check to fail on.
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
          // Appended rows take the TAB's own width. The config tab is two columns wide, not as
          // wide as the tasks layout, and a fake that pads every sheet to that tests nothing real.
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
    lookups: 0,
    getSheets: () => sheets,
    getSheetByName: (name) => {
      book.lookups += 1
      return sheets.find((sheet) => sheet.name === name) ?? null
    },
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
  const book = {
    tasks,
    config,
    /** Tab lookups. Cheap next to a read, but not free, and threading the sheets keeps them at two. */
    lookups: 0,
    getSheets: () => sheets,
    getSheetByName: (name) => {
      book.lookups += 1
      return sheets.find((sheet) => sheet.name === name) ?? null
    },
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
    insertSheet: (name) => {
      const made = makeSheet(name, [[]])
      sheets.push(made)
      return made
    },
    deleteSheet: (sheet) => sheets.splice(sheets.indexOf(sheet), 1),
  }
  return book
}

/** The script, with the Apps Script globals it reaches for. */
function load(book) {
  /** Lock use, because a mutation must take exactly one and give it back. */
  const lock = { taken: 0, released: 0 }
  const globals = {
    SpreadsheetApp: { getActive: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => KEY }) },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          lock.taken += 1
          return true
        },
        releaseLock: () => {
          lock.released += 1
        },
      }),
    },
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
  return { ...factory(...names.map((name) => globals[name])), lock }
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

describe('updateMany', () => {
  /**
   * Ticking is the app's most frequent gesture and a round trip is ~3s, so three ticks were three
   * of them. FAMILY sits at grid rows 2..6, which is what lets a run and a scattered set both be
   * expressed here.
   */
  const batch = (...ids) => ({
    tasks: ids.map((id) =>
      task({ id, title: `Done ${id}`, parent_id: id.charAt(0) === 's' ? 'p1' : '' }),
    ),
  })

  it('writes every row in the batch and leaves the others alone', () => {
    expect(post(script, 'updateMany', batch('s1', 's3')).ok).toBe(true)
    const rows = stored(book)
    expect(rows[1].title).toBe('Done s1')
    expect(rows[3].title).toBe('Done s3')
    expect(rows[2].title).toBe('Visit them')
    expect(rows[0].title).toBe('Book the venue')
  })

  it('costs one read and ONE write for a run of consecutive rows', () => {
    post(script, 'updateMany', batch('s1', 's2', 's3'))
    expect(book.tasks.reads).toBe(1)
    expect(book.tasks.writes).toBe(1)
    expect(book.tasks.formatted).toHaveLength(1)
  })

  it('costs a write per run when the rows are scattered, still on one read', () => {
    // Three separate updates are three requests, three locks and three grid reads. This is one of
    // each whatever the rows' positions.
    post(script, 'updateMany', batch('p1', 's2', 'p2'))
    expect(book.tasks.reads).toBe(1)
    expect(book.tasks.writes).toBe(3)
    expect(stored(book).map((row) => row.title)).toEqual([
      'Done p1',
      'Shortlist three',
      'Done s2',
      'Sign the contract',
      'Done p2',
    ])
  })

  it('holds one lock, and gives it back', () => {
    const one = makeBook(FAMILY)
    const script = load(one)
    post(script, 'updateMany', batch('s1', 's2', 's3'))
    expect(script.lock).toEqual({ taken: 1, released: 1 })
  })

  it('fails the whole batch on one missing id, writing nothing', () => {
    // A partner deleting a row mid-batch must not leave half of it applied: the client rolls back
    // and refreshes. Every id resolves before any cell is written, which the grid in hand makes free.
    const before = book.tasks.writes
    const body = post(script, 'updateMany', {
      tasks: [task({ id: 's1', title: 'Done s1' }), task({ id: 'gone', title: 'Nowhere' })],
    })
    expect(body).toEqual({ ok: false, error: 'not_found' })
    expect(book.tasks.writes).toBe(before)
    expect(stored(book)[1].title).toBe('Shortlist three')
  })

  it('fails the whole batch on one unusable row, writing nothing', () => {
    const before = book.tasks.writes
    expect(post(script, 'updateMany', { tasks: [task({ id: 's1' }), { id: 's2' }] }).error).toBe(
      'bad_payload',
    )
    expect(book.tasks.writes).toBe(before)
  })

  it('refuses an empty batch', () => {
    expect(post(script, 'updateMany', { tasks: [] }).error).toBe('bad_payload')
    expect(post(script, 'updateMany', {}).error).toBe('bad_payload')
  })

  it('keeps each row’s own created_at and its parent', () => {
    book.tasks.grid[2][TASK_COLUMNS.indexOf('created_at')] = '2026-01-01T00:00:00.000Z'
    book.tasks.grid[3][TASK_COLUMNS.indexOf('created_at')] = '2026-02-02T00:00:00.000Z'
    post(script, 'updateMany', batch('s1', 's2'))
    const rows = stored(book)
    expect(rows[1].created_at).toBe('2026-01-01T00:00:00.000Z')
    expect(rows[2].created_at).toBe('2026-02-02T00:00:00.000Z')
    expect(rows.slice(1, 3).every((row) => row.parent_id === 'p1')).toBe(true)
  })

  it('lets the last of two entries for one row win', () => {
    post(script, 'updateMany', {
      tasks: [task({ id: 'p1', title: 'First' }), task({ id: 'p1', title: 'Second' })],
    })
    expect(stored(book)[0].title).toBe('Second')
  })

  it('answers with the board the batch produced', () => {
    const body = post(script, 'updateMany', batch('s1', 's2', 's3'))
    expect(body.tasks.map((row) => row.title)).toEqual([
      'Book the venue',
      'Done s1',
      'Done s2',
      'Done s3',
      'Order the cake',
    ])
    expect(body.tasks[1].updated_at).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('is the same path as a single update', () => {
    // `update` is a batch of one, so there is no second write path to keep in step with this one.
    const single = makeBook(FAMILY)
    post(load(single), 'update', { task: task({ id: 's2', title: 'Visited', parent_id: 'p1' }) })
    const many = makeBook(FAMILY)
    post(load(many), 'updateMany', { tasks: [task({ id: 's2', title: 'Visited', parent_id: 'p1' })] })
    expect(many.tasks.writes).toBe(single.tasks.writes)
    expect(stored(many)[2]).toEqual(stored(single)[2])
  })
})

describe('the capability signal', () => {
  /**
   * A deployment is pinned to a version, so a bundle newer than the script has to be able to tell
   * that an op it wants would come back `bad_op` BEFORE it sends one. `schema` reports columns and
   * cannot answer that: a script can hold every column and still not know how to batch.
   */
  const PAYLOADS = {
    create: { task: task({ id: 'c1', title: 'One' }) },
    createMany: { tasks: [task({ id: 'c2', title: 'Two' })] },
    update: { task: task({ id: 'p1' }) },
    updateMany: { tasks: [task({ id: 'p1' })] },
    delete: { id: 'p1' },
    restore: { id: 'p1' },
    setConfig: { config: { timezone: 'Asia/Tokyo' } },
    compact: {},
  }

  it('is reported on the anonymous read, on a write, and on an unbuilt board', () => {
    const read = JSON.parse(script.doGet())
    const written = post(script, 'update', { task: task({ id: 'p1' }) })
    const fresh = JSON.parse(load(makeFreshBook()).doGet())
    expect(read.ops).toContain('updateMany')
    for (const body of [written, fresh]) expect(body.ops).toEqual(read.ops)
  })

  it('names every op the script dispatches, and no others', () => {
    // A name in the list that `apply` does not handle is a promise the script breaks, and one it
    // handles but does not report is a batch the client will never send.
    const ops = JSON.parse(script.doGet()).ops
    expect(ops.slice().sort()).toEqual(Object.keys(PAYLOADS).sort())
    for (const op of ops) {
      const fresh = makeBook(FAMILY)
      expect([op, post(load(fresh), op, PAYLOADS[op]).error]).not.toEqual([op, 'bad_op'])
    }
  })

  it('still refuses a name it does not report', () => {
    expect(post(script, 'updateSome', { tasks: [] }).error).toBe('bad_op')
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
    // ONE range over both columns, however many rows they touch — `updated_at` and `deleted_at`
    // are the two ends of one span. A cell at a time, a parent with four subtasks is ten round
    // trips; two whole columns, it is four.
    const one = makeBook(FAMILY)
    post(load(one), 'delete', { id: 'p2' })
    const many = makeBook(FAMILY)
    post(load(many), 'delete', { id: 'p1' })
    expect(many.tasks.writes).toBe(one.tasks.writes)
    expect(many.tasks.writes).toBe(1)
  })

  it('stamps both columns as one range and touches nothing either side of them', () => {
    post(script, 'delete', { id: 'p1' })
    const span = book.tasks.formatted[book.tasks.formatted.length - 1]
    expect(span.left).toBe(TASK_COLUMNS.indexOf('updated_at') + 1)
    expect(span.columns).toBe(2)
    expect(span.rows).toBe(FAMILY.length)
    // The span is written whole, so a column that crept into it would be overwritten. Everything
    // outside it is untouched, including the `parent_id` that keeps a subtask a subtask.
    expect(stored(book)[0]).toMatchObject({ id: 'p1', title: 'Book the venue', due: '2027-02-01' })
    expect(stored(book)[1]).toMatchObject({ id: 's1', title: 'Shortlist three', parent_id: 'p1' })
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

  it('costs a template seed of 52 one read and one write', () => {
    // The seed is the largest single write the app makes, and its cost has to be the batch's, not
    // the row's.
    const tasks = []
    for (let index = 0; index < 52; index += 1) {
      tasks.push(task({ id: `m${index}`, title: `Seed ${index}` }))
    }
    const body = post(script, 'createMany', { tasks })
    expect(book.tasks.reads).toBe(1)
    expect(book.tasks.writes).toBe(1)
    expect(body.tasks).toHaveLength(FAMILY.length + 52)
  })
})

describe('the cost of a request', () => {
  /**
   * Exact counts, because latency here IS service calls: a write is ~3s of round trip and the
   * arithmetic between calls is free. Every regression this pins has the same shape — spending a
   * second call to learn what the first one already said.
   */
  it('reads each tab once and never reads back what it just wrote', () => {
    post(script, 'update', { task: task({ id: 'p1', title: 'Booked' }) })
    expect(book.tasks.reads).toBe(1)
    expect(book.config.reads).toBe(1)
  })

  it('looks each tab up once, however many places need it', () => {
    // Both exist on every write but the first ever, so the lookups are the cheap way to know it —
    // but the ops and the reply take the sheets from the session rather than asking again.
    post(script, 'update', { task: task({ id: 'p1' }) })
    expect(book.lookups).toBe(2)
  })

  it('reads once on the anonymous path too', () => {
    script.doGet()
    expect(book.tasks.reads).toBe(1)
    expect(book.config.reads).toBe(1)
    expect(book.lookups).toBe(2)
  })

  it('spends one format and one write on every op that touches a row', () => {
    for (const [op, payload] of [
      ['create', { task: task({ id: 'new', title: 'Order flowers' }) }],
      ['update', { task: task({ id: 'p1', title: 'Booked' }) }],
      ['delete', { id: 'p1' }],
      ['restore', { id: 'p1' }],
    ]) {
      const fresh = makeBook(FAMILY)
      post(load(fresh), op, payload)
      expect([op, fresh.tasks.writes, fresh.tasks.formatted.length]).toEqual([op, 1, 1])
    }
  })
})

describe('the reply', () => {
  /**
   * IT IS COMPOSED FROM THE READ THE OP ALREADY MADE, with the write folded in — not from a second
   * read of the grid. That is one full read of the sheet saved on every save, and it is only sound
   * while what the reply says matches what the cells now hold, which is what these pin.
   */
  it('describes the board the write produced', () => {
    const body = post(script, 'update', { task: task({ id: 's2', title: 'Visited', parent_id: 'p1' }) })
    expect(body.tasks).toHaveLength(FAMILY.length)
    expect(body.tasks[2]).toMatchObject({ id: 's2', title: 'Visited', parent_id: 'p1' })
    expect(body.tasks[2].updated_at).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(body.tasks[1].title).toBe('Shortlist three')
  })

  it('carries an appended row', () => {
    const body = post(script, 'create', { task: task({ id: 'new', title: 'Order flowers' }) })
    expect(body.tasks[FAMILY.length]).toMatchObject({ id: 'new', title: 'Order flowers' })
    expect(body.tasks[FAMILY.length].created_at).toMatch(/^\d{4}/)
  })

  it('carries a whole cascade, and a restore’s', () => {
    const deleted = post(script, 'delete', { id: 'p1' })
    expect(deleted.tasks.slice(0, 4).every((row) => row.deleted_at)).toBe(true)
    expect(deleted.tasks[4].deleted_at).toBe('')
    const restored = post(script, 'restore', { id: 'p1' })
    expect(restored.tasks.every((row) => row.deleted_at === '')).toBe(true)
  })

  it('carries a compacted board, rows and pointers both', () => {
    book.tasks.grid[1][TASK_COLUMNS.indexOf('deleted_at')] = '2026-01-01T00:00:00.000Z'
    const body = post(script, 'compact', {})
    expect(body.tasks.map((row) => row.id)).toEqual(['s1', 's2', 's3', 'p2'])
    expect(body.tasks.every((row) => row.parent_id === '')).toBe(true)
  })

  it('carries the config a setConfig just wrote', () => {
    const body = post(script, 'setConfig', { config: { timezone: 'Europe/Paris', venue: 'Meguro' } })
    expect(body.config).toEqual({ timezone: 'Europe/Paris', venue: 'Meguro' })
  })

  it('reports the value the CELL will hold, not the escape it was sent as', () => {
    // Sheets consumes the apostrophe, so the cell holds "=SUM(A:A)" and the reply must say so. The
    // fake keeps it — no fake can strip it and still show the escape was sent — which is why the
    // grid and the reply differ here by exactly that character and both are right.
    const body = post(script, 'update', { task: task({ id: 'p1', title: '=SUM(A:A)' }) })
    expect(stored(book)[0].title).toBe("'=SUM(A:A)")
    expect(body.tasks[0].title).toBe('=SUM(A:A)')
  })

  it('drops a leading apostrophe somebody typed, exactly as the sheet does', () => {
    // "'96 vintage" reaches the cell as "96 vintage" whatever this script does, so a reply echoing
    // the apostrophe would show a title that changes on the next refresh.
    const body = post(script, 'update', { task: task({ id: 'p1', title: "'96 vintage" }) })
    expect(stored(book)[0].title).toBe('96 vintage')
    expect(body.tasks[0].title).toBe('96 vintage')
  })

  it('normalises a Date in a row it never touched', () => {
    // The board is composed from the grid that was read, so every cell still goes through
    // `readCell` — a row somebody hand-edited into a Date is unparseable by the client otherwise.
    book.tasks.grid[5][TASK_COLUMNS.indexOf('due')] = new Date('2027-03-03T00:00:00Z')
    const body = post(script, 'update', { task: task({ id: 'p1' }) })
    expect(body.tasks[4].due).toBe('2027-03-03T00:00')
  })

  it('does not carry a row the write refused', () => {
    expect(post(script, 'update', { task: task({ id: 'nope' }) })).toEqual({
      ok: false,
      error: 'not_found',
    })
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

  it('clears every orphaned pointer in one write', () => {
    // A compaction orphans as many children as the tombstoned parent had, and a cell at a time each
    // one was a format and a value of its own.
    book.tasks.grid[1][TASK_COLUMNS.indexOf('deleted_at')] = '2026-01-01T00:00:00.000Z'
    post(script, 'compact', {})
    expect(book.tasks.writes).toBe(1)
  })

  it('writes nothing at all when it orphans nobody', () => {
    // The usual case: the delete cascaded, so every child of the dying parent is dying with it.
    post(script, 'delete', { id: 'p1' })
    const before = book.tasks.writes
    post(script, 'compact', {})
    expect(book.tasks.writes).toBe(before)
    expect(stored(book).map((row) => row.id)).toEqual(['p2'])
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

  it('repairs a header somebody reordered, by NAME, without moving the data', () => {
    // Dragging a column in the Sheets UI moves the header cell and its values together, so the
    // grid stays consistent while no longer sitting where this script addresses — and everything
    // here addresses by index. Rewriting the header text alone would leave every value a column
    // or more off, so the repair re-reads each row by the name its own header gives it.
    const moved = ['category'].concat(TASK_COLUMNS.filter((name) => name !== 'category'))
    book.tasks.grid = book.tasks.grid.map((line) =>
      moved.map((name) => line[TASK_COLUMNS.indexOf(name)]),
    )

    post(script, 'update', { task: task({ id: 'p1', title: 'Booked' }) })

    expect(book.tasks.grid[0]).toEqual(TASK_COLUMNS)
    const rows = stored(book)
    expect(rows[0]).toMatchObject({ id: 'p1', title: 'Booked', due: '2027-02-01', parent_id: '' })
    // The rows nobody touched came across by name too — read at this layout's indices they would
    // each have taken `category` for an id.
    expect(rows[1]).toMatchObject({
      id: 's1',
      title: 'Shortlist three',
      category: 'Venue',
      parent_id: 'p1',
    })
  })

  it('clears whatever sat past the layout’s width', () => {
    // A stray column under a blank header is exactly the kind of thing somebody deletes by hand,
    // taking a real column with it if the count ever shifts.
    const moved = ['category'].concat(TASK_COLUMNS.filter((name) => name !== 'category'))
    book.tasks.grid = book.tasks.grid.map((line, index) =>
      moved.map((name) => line[TASK_COLUMNS.indexOf(name)]).concat([index ? 'leftover' : 'scratch']),
    )
    post(script, 'update', { task: task({ id: 'p1' }) })
    for (const line of book.tasks.grid) {
      expect(line.slice(TASK_COLUMNS.length).every((cell) => cell === '')).toBe(true)
    }
  })

  it('repairs once, then leaves the grid alone', () => {
    book.tasks.grid[0] = TASK_COLUMNS.slice(0, -1).concat([''])
    post(script, 'update', { task: task({ id: 'p1', title: 'Booked' }) })
    const after = book.tasks.writes
    post(script, 'update', { task: task({ id: 'p1', title: 'Booked again' }) })
    // One write: the row itself. A repair on every save would be wasted round trips.
    expect(book.tasks.writes - after).toBe(1)
  })

  it('leaves a correct header alone', () => {
    const before = book.tasks.writes
    post(script, 'update', { task: task({ id: 'p1' }) })
    // One write: the row itself. A header rewrite on every save would be a wasted round trip.
    expect(book.tasks.writes - before).toBe(1)
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
  const SETTINGS = [
    ['key', 'value'],
    ['partner1_name', 'Aoi'],
    ['partner2_name', 'Ren'],
    ['wedding_date', '2027-04-18'],
    ['venue', 'Meguro'],
    ['timezone', 'Asia/Tokyo'],
  ]

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

  it('writes the value column ONCE however many keys the save carries', () => {
    // Settings is the one sheet that waits for its reply, so a format and a value per key made a
    // five-field save five round trips inside one save.
    book.config.grid = SETTINGS.map((row) => row.slice())
    post(script, 'setConfig', {
      config: {
        partner1_name: 'A',
        partner2_name: 'B',
        wedding_date: '2027-04-19',
        venue: 'V',
        timezone: 'Europe/Paris',
      },
    })
    expect(book.config.writes).toBe(1)
    expect(book.config.grid.map((row) => row[1])).toEqual([
      'value',
      'A',
      'B',
      '2027-04-19',
      'V',
      'Europe/Paris',
    ])
  })

  it('leaves a key it was not sent exactly as it was', () => {
    // The column is written whole, so every untouched row is rewritten — with the value it already
    // holds, or a save of one field would quietly restate the others.
    book.config.grid = SETTINGS.map((row) => row.slice())
    const body = post(script, 'setConfig', { config: { venue: 'Meguro' } })
    expect(book.config.grid[1][1]).toBe('Aoi')
    expect(body.config.partner1_name).toBe('Aoi')
  })

  it('normalises a config cell the Sheets UI coerced to a Date', () => {
    // Written back raw it would land as "Sun Apr 18 2027 …", which the client cannot read.
    book.config.grid = [
      ['key', 'value'],
      ['timezone', 'Asia/Tokyo'],
      ['wedding_date', new Date('2027-04-18T00:00:00Z')],
    ]
    const body = post(script, 'setConfig', { config: { timezone: 'Europe/Paris' } })
    expect(book.config.grid[2][1]).toBe('2027-04-18T00:00')
    expect(body.config.wedding_date).toBe('2027-04-18T00:00')
  })

  it('appends several new keys in one call, without asking for the last row', () => {
    const before = book.config.writes
    post(script, 'setConfig', { config: { venue: 'Meguro', accent: 'rose' } })
    expect(book.config.writes - before).toBe(1)
    expect(book.config.grid.slice(2)).toEqual([
      ['venue', 'Meguro'],
      ['accent', 'rose'],
    ])
  })
})
