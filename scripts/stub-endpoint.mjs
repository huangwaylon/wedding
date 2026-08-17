/**
 * A local stand-in for both halves of this app's backend, over one in-memory spreadsheet.
 *
 *   /                        the real `apps-script/Code.gs`, executed: `doGet` serves the
 *                            anonymous board, `doPost` mints a token.
 *   /v4/spreadsheets/...     enough of the Sheets API for `src/lib/sheets.js` to write through.
 *
 * Both are needed. Writes go to the Sheets API, so a stub running only `Code.gs` leaves the whole
 * write path — every range, every row resolution, the header repair — unexercised by
 * `scripts/drive.mjs`, and a static JSON file answers a write with the value from before the edit.
 * The REST half checks the bearer token against the one the mint issued, so the driver exercises
 * the real credential flow rather than a bypass.
 *
 *   node scripts/stub-endpoint.mjs [--port 5200]
 *
 * No new dependency: `node:http` and the same `new Function` trick `test/script.test.js` uses.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('apps-script/Code.gs', 'utf8')
const KEY = 'a'.repeat(64)
/** What the mint hands out, and what the REST half insists on seeing. */
const TOKEN = 'stub-token'
const SHEET_ID = 'stub-sheet'
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
 * A board seven months out: some done, some overdue, some due this fortnight, and three undated —
 * `nodate` is a state of its own, and a row in it must draw and count as one.
 */
function seed() {
  const day = (offset) => {
    const date = new Date(Date.UTC(2026, 7, 12))
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  /* `[id, title, category, due, done_at, start]`. Two rows carry a start date that has passed, so
     the Ongoing section renders; a1 and a2 are past their date and unfinished, so Past deadline
     does. a7 has both and is finished, which is the case that must land in neither. */
  const rows = [
    ['a1', 'Mail the save-the-dates', 'Stationery', day(-43), '', ''],
    ['a2', 'Book the photographer and videographer', 'Photo', day(-1), '', day(-30)],
    ['a3', 'Compare the two venue quotes', 'Venue', day(0), '', day(-7)],
    ['a4', 'Send the deposit', 'Budget', day(1), '', ''],
    ['a5', 'Choose the invitation paper', 'Stationery', day(7), '', day(-2)],
    /* The STRAY: begun a fortnight ago, due four months out. It is lifted into This month by the
       running clause, and it is the one row there dated outside the month the heading names — so it is
       the row that has to print its own. */
    ['a6', 'Order signage, vow books and favours', 'Gifts', day(120), '', day(-14)],
    ['a7', 'Agree the budget and who is contributing', 'Budget', day(-60), '2026-07-01T00:00:00.000Z', day(-90)],
    // The three with no date at all: `nodate` sorts last, into its own group.
    ['a8', 'Decide about a live band', 'Music', '', '', ''],
    ['a9', 'Ask about corkage', 'Food', '', '', ''],
    ['a10', 'Find a calligrapher', 'Stationery', '', '', ''],
  ]
  /* The last one holds a URL, so the checklist's linked shape is on screen: the row splits into the
     tick and the link, which no static render can prove is tappable. */
  const subs = [
    'Shortlist three venues',
    'Visit the shortlist',
    'Compare quotes in writing',
    'Quote B: https://venue.example/quotes/2027-04-18',
  ]

  const grid = [
    ['id', 'title', 'category', 'due', 'done_at', 'created_at', 'updated_at', 'deleted_at', 'parent_id', 'start'],
    ...rows.map(([id, title, category, due, doneAt, start]) => [
      id, title, category, due, doneAt, '2026-01-01T00:00:00.000Z', '', '', '', start,
    ]),
    ...subs.map((title, index) => [
      `a3-s${index}`, title, '', '',
      index < 1 ? '2026-07-01T00:00:00.000Z' : '',
      `2026-07-0${index + 1}T00:00:00.000Z`, '', '', 'a3', '',
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
    /* The notes document, so the read path has one and an edit takes the in-place write; a board
       without the row exercises the append half, which `test/sheets.test.js` covers. LONGER THAN
       `.textarea`'s floor on purpose: `drive.mjs` measures whether the field grew to its content, and
       against a short document the min-height reports a fitting box with `grow()` deleted. */
    [
      'notes',
      [
        '# Venue',
        'The garden pavilion, **confirmed** for the 18th.',
        'Rain plan is the orangery, at no extra charge.',
        '',
        '## Still to confirm',
        '- Chair covers, ivory',
        '- Access from 9am for the florist',
        '- Who signs for the delivery',
        '',
        /* One of each link shape, and one refusal: `drive.mjs` counts the anchors and checks that the
           third stayed text. Keep them on their own lines — the toolbar assertions above index into
           the paragraphs by phrase. */
        'Quote: [the pavilion](https://venue.example/pavilion)',
        'Directions: https://maps.example/q/pavilion',
        'Refused: [tap](javascript:alert(1))',
        '',
        '# Food',
        '1. Tasting menu, five courses',
        '2. Two vegetarian, one *gluten free*',
        '3. Cake cut at 8pm',
      ].join('\n'),
    ],
  ])
  const sheets = [tasks, config]
  return {
    tasks,
    config,
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getId: () => SHEET_ID,
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
    ScriptApp: { getOAuthToken: () => TOKEN },
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

// ---------------------------------------------------------------------------
// Enough of the Sheets API to write through
// ---------------------------------------------------------------------------

/** 'A' -> 0, 'AA' -> 26. */
const colOf = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1

/** `tasks!A1:I` / `config!B2` -> the tab and the rectangle. `bottom` null means "to the end". */
function parseRange(range) {
  const [tab, a1] = range.split('!')
  const [, c1, r1, c2, r2] = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a1)
  return {
    tab,
    left: colOf(c1),
    top: r1 ? Number(r1) - 1 : 0,
    right: c2 ? colOf(c2) : colOf(c1),
    bottom: r2 ? Number(r2) - 1 : null,
  }
}

const gridOf = (tab) => book.getSheetByName(tab)?.grid ?? null

function readRange(range) {
  const { tab, top, left, right, bottom } = parseRange(range)
  const rows = gridOf(tab)
  if (!rows) return null
  const last = bottom == null ? rows.length - 1 : Math.min(bottom, rows.length - 1)
  const out = []
  for (let r = top; r <= last; r += 1) {
    out.push((rows[r] ?? []).slice(left, right + 1).map((cell) => (cell == null ? '' : cell)))
  }
  return out
}

function writeRange(range, values) {
  const { tab, top, left } = parseRange(range)
  const rows = gridOf(tab)
  values.forEach((line, r) => {
    while (rows.length <= top + r) rows.push([])
    line.forEach((value, c) => {
      rows[top + r][left + c] = value
    })
  })
}

/** @returns {{status: number, body: object}} */
function sheetsApi(method, path, search, body, auth) {
  // The driver has to carry a real token, or this proves something the app does not do.
  if (auth !== `Bearer ${TOKEN}`) {
    return { status: 401, body: { error: { message: 'stub: bad or missing bearer token' } } }
  }

  const after = path.replace(`/v4/spreadsheets/${SHEET_ID}`, '')

  if (method === 'GET' && after === '') {
    return {
      status: 200,
      body: {
        properties: { timeZone: book.getSpreadsheetTimeZone() },
        sheets: book
          .getSheets()
          .map((sheet, index) => ({ properties: { title: sheet.name, sheetId: 100 + index } })),
      },
    }
  }

  if (method === 'GET' && after === '/values:batchGet') {
    const ranges = search.getAll('ranges')
    const values = ranges.map((range) => readRange(range))
    if (values.some((v) => v === null)) {
      return { status: 400, body: { error: { message: 'stub: unable to parse range' } } }
    }
    return { status: 200, body: { valueRanges: values.map((v) => ({ values: v })) } }
  }

  if (method === 'POST' && after === '/values:batchUpdate') {
    for (const entry of body.data) writeRange(entry.range, entry.values)
    return { status: 200, body: {} }
  }

  if (method === 'POST' && after.endsWith(':append')) {
    const range = decodeURIComponent(after.slice('/values/'.length, -':append'.length))
    const rows = gridOf(parseRange(range).tab)
    for (const line of body.values) rows.push(line.slice())
    return { status: 200, body: {} }
  }

  if (method === 'POST' && after === ':batchUpdate') {
    const replies = []
    for (const request of body.requests) {
      if (request.addSheet) {
        const made = book.insertSheet(request.addSheet.properties.title)
        replies.push({
          addSheet: { properties: { title: made.name, sheetId: 100 + book.getSheets().length } },
        })
      } else if (request.deleteDimension) {
        const { sheetId, startIndex } = request.deleteDimension.range
        book.getSheets()[sheetId - 100]?.grid.splice(startIndex, 1)
        replies.push({})
      } else {
        replies.push({})
      }
    }
    return { status: 200, body: { replies } }
  }

  return { status: 404, body: { error: { message: `stub: unhandled ${method} ${after}` } } }
}

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    const { pathname, searchParams } = new URL(request.url, `http://127.0.0.1:${PORT}`)

    let status = 200
    let body

    if (pathname.startsWith('/v4/spreadsheets')) {
      const result = sheetsApi(
        request.method,
        pathname,
        searchParams,
        raw ? JSON.parse(raw) : null,
        request.headers.authorization,
      )
      status = result.status
      body = result.body
      console.log(`${request.method} ${pathname.replace('/v4/spreadsheets/', '')} -> ${status}`)
    } else if (request.method === 'POST') {
      body = JSON.parse(script.doPost({ postData: { contents: raw } }))
      console.log(`POST /exec (mint) -> ${body.ok ? 'ok' : body.error}`)
    } else {
      body = JSON.parse(script.doGet())
      console.log(`GET /exec (board) -> ${body.ok ? 'ok' : body.error}`)
    }

    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    response.end(JSON.stringify(body))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub endpoint on http://127.0.0.1:${PORT}`)
  console.log(`  /                     Code.gs (doGet + mint)`)
  console.log(`  /v4/spreadsheets/...  the Sheets API`)
  console.log(`key: ${KEY}`)
})
