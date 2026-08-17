/**
 * `apps-script/Code.gs`, executed.
 *
 * WHAT IS LEFT OF THIS SCRIPT IS TWO THINGS, and this file runs both. `doGet` serves the
 * anonymous board a planner reads with no credential; `doPost` mints an access token for an
 * editor and does nothing else. Every write moved to `src/lib/sheets.js` — see
 * `test/sheets.test.js` — because `/exec` costs 1.0–1.6s before this file runs a line.
 *
 * The two things the fake is deliberately literal about:
 *
 *   A RANGE IS ADDRESSED, NOT NAMED. `getRange(row, column, rows, columns)` is 1-based, so an
 *   off-by-one lands as a real off-by-one here rather than passing.
 *
 *   A CELL CAN HOLD A DATE. Whatever number format was written, a person editing the sheet by
 *   hand can leave a real Date in a cell — and `String(new Date())` is unparseable by the
 *   client. `readCell` is the recovery, and the read has to apply it to every cell.
 *
 * It is NOT a Sheets emulator: formats are recorded rather than applied.
 *
 * THE ONE PROPERTY WORTH MORE THAN ANY ASSERTION BELOW: neither handler may throw. An uncaught
 * throw returns Google's HTML error page instead of JSON, the client reads a non-JSON reply as
 * transient, and a throw on the reject path becomes a silent retry loop.
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_COLUMNS } from '../src/schema.js'

const SOURCE = readFileSync('apps-script/Code.gs', 'utf8')

/**
 * The source with its comments removed.
 *
 * The header explains several rules by NAMING the thing each one forbids, so a raw search of the
 * file matches the prose and passes whatever the code does. Anything asserting an absence has to
 * read this instead.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

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
    getId: () => 'SHEET_ID',
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
    getId: () => 'SHEET_ID',
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

/**
 * The script, with the Apps Script globals it reaches for. `book` may be null, which is what a
 * standalone (non-container-bound) script sees from `getActive()`.
 *
 * `LockService` is still supplied even though nothing should reach for it — a lock taken here
 * would be invisible otherwise, and "it takes no lock" is an assertion rather than an assumption.
 */
function load(book) {
  const lock = { taken: 0, released: 0 }
  const globals = {
    SpreadsheetApp: { getActive: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => KEY }) },
    ScriptApp: { getOAuthToken: () => 'TOKEN' },
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

const mint = (script, key) =>
  JSON.parse(script.doPost({ postData: { contents: JSON.stringify({ key }) } }))

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

describe('the anonymous read', () => {
  it('returns every row as strings', () => {
    const reply = JSON.parse(script.doGet())
    expect(reply.ok).toBe(true)
    expect(reply.tasks).toHaveLength(5)
    expect(reply.tasks[0].id).toBe('p1')
    // Every cell, every row: the client parses strings and nothing else.
    for (const row of reply.tasks) {
      for (const value of Object.values(row)) expect(typeof value).toBe('string')
    }
  })

  it('resolves columns by NAME, so a reordered header still reads correctly', () => {
    // THE READ PATH MAY NOT WRITE — it is anonymous, so it cannot repair a header somebody moved.
    // Reading at this script's own indices would report whatever now sits in `due`'s position as
    // the due date. `relayout` in `src/lib/sheets.js` is the repair, on an editor's next write.
    const due = TASK_COLUMNS.indexOf('due')
    const category = TASK_COLUMNS.indexOf('category')
    for (const line of book.tasks.grid) {
      const held = line[due]
      line[due] = line[category]
      line[category] = held
    }
    const reply = JSON.parse(script.doGet())
    expect(reply.tasks[0].due).toBe('2027-02-01')
    expect(reply.tasks[0].category).toBe('Venue')
  })

  it('drops a column it does not know rather than shifting the rest', () => {
    book.tasks.grid[0].push('something_newer')
    book.tasks.grid[1].push('ignored')
    const reply = JSON.parse(script.doGet())
    expect(reply.tasks[0]).not.toHaveProperty('something_newer')
    expect(reply.tasks[0].parent_id).toBe('')
  })

  it('skips a blank row somebody left with a stray Enter', () => {
    book.tasks.grid.push(new Array(TASK_COLUMNS.length).fill(''))
    expect(JSON.parse(script.doGet()).tasks).toHaveLength(5)
  })

  it('reformats a cell the Sheets UI coerced to a Date', () => {
    // Otherwise it crosses the wire as "Fri Aug 07 2026 …" and the client cannot parse it. The
    // client's `normalizeDay` then slices the clock half off.
    book.tasks.grid[1][TASK_COLUMNS.indexOf('due')] = new Date('2027-01-01T00:00:00Z')
    expect(JSON.parse(script.doGet()).tasks[0].due).toBe('2027-01-01T00:00')
  })

  it('reformats a coerced start cell the same way, it being a day like any other', () => {
    // The optional column reaches the anonymous read through the same `readCell`, so a start date
    // somebody retyped in the Sheets UI arrives parseable rather than as "Fri Jan 01 2027 …".
    book.tasks.grid[1][TASK_COLUMNS.indexOf('start')] = new Date('2027-01-01T00:00:00Z')
    const [row] = JSON.parse(script.doGet()).tasks
    expect(row.start).toBe('2027-01-01T00:00')
    expect(typeof row.start).toBe('string')
  })

  it('reformats a coerced config cell too', () => {
    // A wedding date somebody retyped by hand is the realistic case, and it reaches the countdown.
    book.config.grid.push(['wedding_date', new Date('2027-04-18T00:00:00Z')])
    expect(JSON.parse(script.doGet()).config.wedding_date).toBe('2027-04-18T00:00')
  })

  it('reports the spreadsheet’s own zone, so a mismatch can be surfaced', () => {
    // Wall-clock cells are interpreted in the CONFIG zone, never this one — but a disagreement is
    // what makes a hand-typed cell land a day off, so Settings says so.
    expect(JSON.parse(script.doGet()).sheetTimeZone).toBe('Asia/Tokyo')
  })

  it('answers needsSetup on a board with no tabs, and NEVER builds them', () => {
    // Building tabs is a write, and an anonymous request must not cause one. An editor's first
    // write does it, from the client.
    const fresh = makeFreshBook()
    const reply = JSON.parse(load(fresh).doGet())
    expect(reply).toMatchObject({ ok: true, needsSetup: true, tasks: [], config: {} })
    expect(fresh.inserted).toEqual([])
  })

  it('never writes, and never takes the lock', () => {
    const before = book.tasks.writes
    script.doGet()
    expect(book.tasks.writes).toBe(before)
  })

  it('answers misconfigured rather than throwing when nothing is bound', () => {
    // A standalone script returns null from `getActive()`. An uncaught throw here would return
    // Google's HTML page, which the client classifies as transient and retries forever.
    expect(JSON.parse(load(null).doGet())).toEqual({ ok: false, error: 'misconfigured' })
  })
})

describe('minting a token', () => {
  it('hands back the token and the container’s own id', () => {
    // The id comes from the container rather than from a script property: a bound script cannot be
    // pointed at the wrong file, so there is nothing here to misconfigure.
    expect(mint(script, KEY)).toEqual({ ok: true, token: 'TOKEN', spreadsheetId: 'SHEET_ID' })
  })

  it('refuses a wrong key, a missing one, and a malformed body IDENTICALLY', () => {
    // One reply for every rejection: no length, prefix or position of the key is revealed, and a
    // wrong key is indistinguishable from a missing one.
    const raw = (contents) => JSON.parse(script.doPost({ postData: { contents } }))
    for (const contents of [
      JSON.stringify({ key: 'wrong' }),
      JSON.stringify({}),
      'not json',
      // `null` parses successfully, so it cannot be folded into a try/catch. This one shipped as a
      // crash once: `body.key` dereferenced null and the HTML page came back as a retry loop.
      'null',
      JSON.stringify('a string'),
    ]) {
      expect(raw(contents), contents).toEqual({ ok: false, error: 'unauthorized' })
    }
    expect(raw(undefined)).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('refuses a body with no postData at all rather than throwing', () => {
    expect(JSON.parse(script.doPost())).toEqual({ ok: false, error: 'unauthorized' })
    expect(JSON.parse(script.doPost({}))).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('refuses an oversized body without parsing it', () => {
    // The only legitimate body is ~80 bytes. Anything larger is not worth JSON.parse.
    const contents = JSON.stringify({ key: KEY, filler: 'x'.repeat(2000) })
    expect(JSON.parse(script.doPost({ postData: { contents } }))).toEqual({
      ok: false,
      error: 'unauthorized',
    })
  })

  it('never reads the key from the query string', () => {
    // A key in a query string is written into Google's request logs. Requiring it in the body is
    // what keeps it out, and `e.parameter` is the one way that guarantee gets lost.
    //
    // Comments are stripped first — the header explains this rule by naming the thing it forbids,
    // so a raw search matches the prose and passes forever.
    expect(CODE).not.toContain('e.parameter')
  })

  it('answers misconfigured rather than minting against nothing', () => {
    expect(JSON.parse(load(null).doPost({ postData: { contents: JSON.stringify({ key: KEY }) } })))
      .toEqual({ ok: false, error: 'misconfigured' })
  })

  it('mints NOTHING but the token and the id — never an echo of the request', () => {
    const reply = mint(script, KEY)
    expect(Object.keys(reply).sort()).toEqual(['ok', 'spreadsheetId', 'token'])
  })
})

describe('what this script no longer does', () => {
  /**
   * The writes moved to `src/lib/sheets.js`. These are not decorative: a half-migration that left
   * a write op reachable here would be a second writer with different rules — one that stamps
   * timestamps server-side, holds a lock the client knows nothing about, and answers `ok` to a
   * client that has already applied the edit itself.
   */
  it('dispatches no operations at all', () => {
    for (const op of ['create', 'update', 'updateMany', 'delete', 'restore', 'setConfig', 'compact']) {
      const reply = JSON.parse(
        script.doPost({ postData: { contents: JSON.stringify({ key: KEY, op, payload: {} }) } }),
      )
      // An op is simply ignored — the body is a mint request and nothing else.
      expect(reply.ok, op).toBe(true)
      expect(reply.token, op).toBe('TOKEN')
    }
    // And nothing was written on any of those paths.
    expect(book.tasks.writes).toBe(0)
    expect(book.config.writes).toBe(0)
  })

  it('takes no lock, because it has nothing to serialise', () => {
    // The script-wide lock is what made two editors wait 25s on each other — and `busy`, the code
    // that wait produced, was never even reachable by the client's retry budget.
    expect(CODE).not.toContain('LockService')
    expect(script.lock.taken).toBe(0)
    mint(script, KEY)
    expect(script.lock.taken).toBe(0)
  })

  it('keeps no write-side helper that would drift from the client’s copy', () => {
    for (const gone of ['function relayout', 'function buildStructure', 'function textCell', 'var OPS']) {
      expect(CODE, gone).not.toContain(gone)
    }
  })
})
