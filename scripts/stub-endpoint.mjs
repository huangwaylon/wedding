/**
 * A local endpoint that EXECUTES the real `apps-script/Code.gs` against an in-memory grid.
 *
 * It serves the same code the deployment runs, so "does the date survive a round trip" is a
 * question with an answer. A static JSON file cannot answer it: a write against one round-trips
 * as a valid reply holding the value from before the edit, which proves the request left and
 * nothing else.
 *
 *   node scripts/stub-endpoint.mjs [--port 5200]
 *
 * No new dependency: `node:http` and the same `new Function` trick `test/script.test.js` uses.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('apps-script/Code.gs', 'utf8')
const KEY = 'a'.repeat(64)
const args = process.argv.slice(2)
const PORT = Number(args[args.indexOf('--port') + 1]) || 5200

// ---------------------------------------------------------------------------
// A Sheets service, in memory. Same shape as test/script.test.js's fake.
// ---------------------------------------------------------------------------

function makeSheet(name, grid) {
  const sheet = {
    name,
    grid,
    calls: 0,
    getName: () => sheet.name,
    getLastRow: () => {
      sheet.calls += 1
      for (let row = sheet.grid.length; row > 0; row -= 1) {
        if (sheet.grid[row - 1].some((cell) => cell !== '' && cell != null)) return row
      }
      return 0
    },
    getMaxRows: () => Math.max(sheet.grid.length, 1000),
    setFrozenRows: () => {},
    deleteRow: (row) => {
      sheet.calls += 1
      sheet.grid.splice(row - 1, 1)
    },
    getDataRange: () =>
      sheet.getRange(
        1,
        1,
        Math.max(1, lastRowOf(sheet)),
        Math.max(1, Math.max(0, ...sheet.grid.map((line) => line.length))),
      ),
    getRange: (top, left, rows = 1, columns = 1) => ({
      getValues: () => {
        sheet.calls += 1
        const out = []
        for (let r = 0; r < rows; r += 1) {
          const line = []
          for (let c = 0; c < columns; c += 1) line.push(sheet.grid[top - 1 + r]?.[left - 1 + c] ?? '')
          out.push(line)
        }
        return out
      },
      setValues: (values) => {
        sheet.calls += 1
        values.forEach((line, r) => {
          const width = Math.max(left - 1 + columns, ...sheet.grid.map((l) => l.length))
          while (sheet.grid.length < top + r) sheet.grid.push(new Array(width).fill(''))
          line.forEach((value, c) => {
            sheet.grid[top - 1 + r][left - 1 + c] = value
          })
        })
      },
      setValue: (value) => {
        sheet.calls += 1
        sheet.grid[top - 1][left - 1] = value
      },
      setNumberFormat: () => {
        sheet.calls += 1
      },
      setFontWeight: () => {},
      clearContent: () => {
        sheet.calls += 1
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

/** Without bumping the call counter, for `getDataRange`'s own use. */
function lastRowOf(sheet) {
  for (let row = sheet.grid.length; row > 0; row -= 1) {
    if (sheet.grid[row - 1].some((cell) => cell !== '' && cell != null)) return row
  }
  return 0
}

/**
 * A board seven months out: some done, some overdue, some due this fortnight, and three with no
 * date at all — `nodate` is a state of its own, and a row in it must draw and count as one.
 */
function seed() {
  const day = (offset) => {
    const date = new Date(Date.UTC(2026, 7, 12))
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  const rows = [
    ['a1', 'Mail the save-the-dates', 'Stationery', day(-43), ''],
    ['a2', 'Book the photographer and videographer', 'Photo', day(-1), ''],
    ['a3', 'Compare the two venue quotes', 'Venue', day(0), ''],
    ['a4', 'Send the deposit', 'Budget', day(1), ''],
    ['a5', 'Choose the invitation paper', 'Stationery', day(7), ''],
    ['a6', 'Order signage, vow books and favours', 'Gifts', day(120), ''],
    ['a7', 'Agree the budget and who is contributing', 'Budget', day(-60), '2026-07-01T00:00:00.000Z'],
    // The three with no date at all: `nodate` sorts last, into its own group.
    ['a8', 'Decide about a live band', 'Music', '', ''],
    ['a9', 'Ask about corkage', 'Food', '', ''],
    ['a10', 'Find a calligrapher', 'Stationery', '', ''],
  ]
  const subs = ['Shortlist three venues', 'Visit the shortlist', 'Compare quotes in writing']

  const grid = [
    ['id', 'title', 'category', 'due', 'done_at', 'created_at', 'updated_at', 'deleted_at', 'parent_id'],
    ...rows.map(([id, title, category, due, doneAt]) => [
      id, title, category, due, doneAt, '2026-01-01T00:00:00.000Z', '', '', '',
    ]),
    ...subs.map((title, index) => [
      `a3-s${index}`, title, '', '',
      index < 1 ? '2026-07-01T00:00:00.000Z' : '',
      `2026-07-0${index + 1}T00:00:00.000Z`, '', '', 'a3',
    ]),
  ]

  const tasks = makeSheet('tasks', grid)
  const config = makeSheet('config', [
    ['key', 'value'],
    ['partner1_name', 'Aoi'],
    ['partner2_name', 'Ren'],
    ['wedding_date', '2027-04-18'],
    ['venue', 'The 迎賓館 偕楽園 別邸'],
    ['timezone', 'Asia/Tokyo'],
    ['categories', 'Budget, Venue, Guests, Vendors, Attire, Food, Stationery, Photo, Music, Beauty, Gifts, Paperwork, Honeymoon, Other'],
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

const book = seed()

function load() {
  const globals = {
    SpreadsheetApp: { getActive: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => KEY }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType: () => text }),
    },
    Utilities: { formatDate: (date) => date.toISOString().slice(0, 16) },
  }
  const names = Object.keys(globals)
  return new Function(...names, `${SOURCE}\nreturn { doGet, doPost }`)(...names.map((n) => globals[n]))
}

const script = load()

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const before = book.tasks.calls
    let text
    if (request.method === 'POST') {
      text = script.doPost({ postData: { contents: Buffer.concat(chunks).toString('utf8') } })
    } else {
      text = script.doGet()
    }
    const body = JSON.parse(text)
    // A Sheets service call is the unit of cost in Apps Script, so it is the number worth
    // printing: the arithmetic between them is free and the network floor is not ours to fix.
    console.log(
      `${request.method} ${request.method === 'POST' ? JSON.parse(Buffer.concat(chunks).toString('utf8')).op : ''} ` +
        `-> ${body.ok ? 'ok' : body.error} (${book.tasks.calls - before} sheet calls)`,
    )
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    response.end(JSON.stringify(body))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub endpoint on http://127.0.0.1:${PORT}`)
  console.log(`key: ${KEY}`)
})
