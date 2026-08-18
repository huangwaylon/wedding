/**
 * Drives the running app in a real browser over the Chrome DevTools Protocol: the accordion, the
 * read/edit toggle, one write per edit session, the create sheet, whether BOTH `input[type=date]` controls stay
 * inside their row, that the add-a-subtask field is behind Edit and ticking is not, that a checklist
 * link is a sibling of its tick rather than an anchor inside a button, that ticking under a filter
 * keeps the row on screen, that deleting a just-edited task sends no resurrecting `update`, and the
 * whole notes tab — the tab switch, the pencil that opens a session, the field's JS-driven height,
 * whether a toolbar tap keeps the selection, and that the bar gets out of the keyboard's way. A static render fires no blur and runs no effect, so none of it is reachable from
 * `scripts/preview.jsx`. The delete check is a POST count, the fixture replying with the
 * pre-write board: reverting `remove()` in TaskDetail.jsx to a bare `onDelete(task)` prints
 * `["delete:row5", "update:row5:a5:Edited, then deleted"]` — `labelWrite` names the ROW, so an example
 * in the older shape reads as a formatting difference rather than as the regression it is.
 *
 * Four ways this file can verify nothing:
 *
 * - Without `Emulation.setFocusEmulationEnabled`, headless Chrome dispatches no focus or focusout,
 *   so every check that a blur sends NOTHING passes against a board that saved nothing either way.
 * - A Chrome left on the debugging port from an earlier run keeps it, so this attaches to that
 *   browser and reports its board. The page-target count below is the check.
 * - The fixture replies in milliseconds, so no optimistic state lasts long enough to measure:
 *   `tickUnderFilter.done` and `pendingKeepsTheTick` are read after the reply rolled the tick
 *   back. The row staying is the first one's assertion; the second is pinned as a CSS fact in
 *   `test/ui.test.jsx`.
 *
 * - THE STUB KEEPS ITS GRID FOR THE LIFE OF THE PROCESS, and this run deletes the only task with a
 *   checklist. On a second run against the same stub every `.tcard--open` selector throws into
 *   `{ error }` and half the report comes back zero, which reads exactly like a regression. Restart
 *   the stub between runs.
 *
 * Counts assume a healthy endpoint: `send` retries a non-terminal failure, so one write against a
 * flaky one is legitimately two or three requests. The fixture never fails.
 *
 *   1. node scripts/stub-endpoint.mjs
 *   2. npx vite --port 5199 --strictPort --host 127.0.0.1
 *   3. cp scripts/drive.mjs /tmp/cdp-wedding.mjs && node /tmp/cdp-wedding.mjs
 *
 * No new dependency: node has `WebSocket` and `fetch`. Step 3's copy is required — the sandbox
 * refuses `connect 127.0.0.1:<port>` unless the command matches an allowlist entry, and the
 * sanctioned pattern is `node /tmp/cdp-*`. The stub is not optional either: an editor writes to
 * the Sheets API, so a static JSON fixture leaves the write path unexercised and every count at
 * zero. `.env.local` carries both routes, proxied by `vite.config.js`:
 *
 *     VITE_SCRIPT_URL=/wedding/__endpoint
 *     VITE_SHEETS_BASE=/wedding/__sheets
 *
 * The stub applies writes to a real in-memory grid and serves `doGet` from it, so "was it stored"
 * has an answer. It proves nothing about Google: our own code parses the ranges both ways, so a
 * range the real API would reject can pass here. Only a deployed script and a real spreadsheet
 * check that.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const KEY = 'a'.repeat(64)
const URL = `http://localhost:5199/wedding/#k=${KEY}`
// A fresh profile every run: a reused one leaves other tabs in the target list, and the lookup
// below attaches to somebody else's page.
const PROFILE = `/tmp/cdp-wedding-profile-${process.pid}`

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`,
  `--window-size=393,900`, 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2500)

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const target = list.find((t) => t.type === 'page')
// Exactly one page target, or this is attached to a browser from an earlier run.
if (list.filter((t) => t.type === 'page').length !== 1) {
  throw new Error(`expected one page target, found ${list.filter((t) => t.type === 'page').length}`)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })

await send('Runtime.enable')
await send('Page.enable')
/** Focus and focusout: see the header. */
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 2, mobile: true })
/**
 * Count the writes: "one write per edit session" is what this file checks, and neither a toast
 * count nor the row on screen can. A Sheets request names the cells it touches rather than the
 * op, so the op is read off the range:
 *
 *   append                 a create
 *   tasks!A{r}:J{r}        a whole-row write — an update, or a create replayed in place
 *   tasks!G{r}:H{r}        the updated_at/deleted_at span — a delete if the second cell is set,
 *                          a restore if it is blank
 *   config!B{r}            a settings write
 *
 * Enough for every count below and for the resurrection check, which wants "one delete-span write
 * and no whole-row write for that row". The mint is not a write.
 */
await send('Network.enable')
const posts = []

/** One Sheets write -> a label, or null for anything that is not a write. */
function labelWrite(url, raw) {
  if (url.includes('__endpoint')) return null
  let body
  try {
    body = JSON.parse(raw ?? '{}')
  } catch {
    return null
  }

  if (url.includes(':append')) {
    const ids = (body.values ?? []).map((line) => line[0]).join(',')
    return `create:${ids}`
  }
  if (url.includes(':batchUpdate') && Array.isArray(body.data)) {
    return body.data
      .map((entry) => {
        const range = entry.range ?? ''
        const cells = entry.values?.[0] ?? []
        if (/^config!/.test(range)) return `config:${range}`
        const row = /(\d+)/.exec(range.split('!')[1] ?? '')?.[1] ?? '?'
        if (/![A-F]\d*:[A-Z]/.test(range)) return `update:row${row}:${cells[0] ?? ''}:${cells[1] ?? ''}`
        return `${cells[1] ? 'delete' : 'restore'}:row${row}`
      })
      .join(' + ')
  }
  if (url.includes(':batchUpdate')) return 'compact'
  return null
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.method === 'POST') {
    const label = labelWrite(msg.params.request.url, msg.params.request.postData)
    if (label) posts.push(label)
  }
})

await send('Page.navigate', { url: URL })
await wait(3500)

const evaluate = async (expr) => {
  const out = await send('Runtime.evaluate', { expression: expr, awaitPromiseReject: true, returnByValue: true, awaitPromise: true })
  if (out.result?.exceptionDetails) return { error: out.result.exceptionDetails.text }
  return out.result?.result?.value
}
const shot = async (name) => {
  const out = await send('Page.captureScreenshot', { captureBeyondViewport: true })
  writeFileSync(`/tmp/drive-${name}.png`, Buffer.from(out.result.data, 'base64'))
}

const report = {}
report.rows = await evaluate(`document.querySelectorAll('.tcard').length`)
report.headline = await evaluate(`document.querySelector('.hero__percent')?.textContent`)
report.count = await evaluate(`document.querySelector('.hero__tally')?.textContent`)
report.fab = await evaluate(`Boolean(document.querySelector('.fab'))`)
report.months = await evaluate(`[...document.querySelectorAll('.plan__month')].map(n=>n.textContent)`)
/* Every dated row states its own month above its own day, in every group, lifted or not — a date must
   not need the heading above it to be read. Reported as pairs so a row missing a month is as visible as
   a group of them missing one, with the years beside it: the fixture holds exactly ONE cross-year row
   (a10, lifted into This month), so `years` must read `['2027']` there and be empty everywhere else. An
   empty list everywhere is what a deleted `.tcard__year` also produces, which is why the fixture needs
   that row for this to be a check at all. */
report.rowDates = await evaluate(`
  [...document.querySelectorAll('.plan__group')].map((group) => ({
    heading: group.querySelector('.plan__month').textContent,
    rows: group.querySelectorAll('.tcard').length,
    dates: [...group.querySelectorAll('.tcard__date')].map((n) => n.textContent),
    years: [...group.querySelectorAll('.tcard__year')].map((n) => n.textContent),
  }))
`)
/* The figures behind `.tcard__date`'s 2rem, measured rather than assumed and in whatever locale the
   fixture runs in: the box holds a short month in either alphabet and could not hold one carrying a
   year. `lines` is the tile's height, which is what the row grew by. */
report.dateColumn = await evaluate(`
  (() => {
    const box = document.querySelector('.tcard__date')
    const month = document.querySelector('.tcard__month')
    return {
      box: Math.round(box.getBoundingClientRect().width * 10) / 10,
      month: month.textContent,
      monthWidth: Math.round(month.getBoundingClientRect().width * 10) / 10,
      lines: Math.round(box.getBoundingClientRect().height),
    }
  })()
`)
report.stickyMonth = await evaluate(`getComputedStyle(document.querySelector('.plan__month')).position`)
await shot('01-top')

await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.tcard')].find(c => c.querySelector('.tcard__tally'))
    row.querySelector('.tcard__head').click()
    row.scrollIntoView({ block: 'center' })
    return true
  })()
`)
await wait(600)
report.openRows = await evaluate(`document.querySelectorAll('.tcard--open').length`)

/**
 * Read mode is the default and inert: a caret in the title on the tap that opens a row is one stray
 * edit from a rename nothing confirms, and the session's unmount flush would write it.
 */
report.readMode = await evaluate(`({
  editor: document.querySelectorAll('.tcard--open .editor').length,
  fact: document.querySelector('.tcard--open .tcard__fact')?.textContent,
  trashIcons: document.querySelectorAll('.tcard--open .subtask .btn--icon').length,
  deleteTask: document.querySelectorAll('.tcard--open .btn--danger-quiet').length,
  toggle: document.querySelector('.tcard--open .edit-toggle')?.getAttribute('aria-pressed'),
  // Ticking stays on this path: it is doing the work, not editing the task. The add field does NOT
  // — a text input behind the commonest tap made every open row read as a form to fill in — so this
  // must be 0 here and 1 in the block below.
  tickable: document.querySelectorAll('.tcard--open .subtask__toggle').length,
  addField: document.querySelectorAll('.tcard--open .subtask-add__field').length,
  // The linked shape a static render cannot prove: the anchor is a SIBLING of the tick, so the row
  // has two targets, and neither is inside the other.
  links: document.querySelectorAll('.tcard--open .subtask a.link').length,
  linkOutsideButton: [...document.querySelectorAll('.tcard--open .subtask a.link')].every(a => !a.closest('button')),
  linkTarget: document.querySelector('.tcard--open .subtask a.link')?.target,
})`)

// The toggle both ways.
await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(400)
report.editMode = await evaluate(`({
  editor: document.querySelectorAll('.tcard--open .editor').length,
  fact: document.querySelectorAll('.tcard--open .tcard__fact').length,
  trashIcons: document.querySelectorAll('.tcard--open .subtask .btn--icon').length,
  deleteTask: document.querySelectorAll('.tcard--open .btn--danger-quiet').length,
  toggle: document.querySelector('.tcard--open .edit-toggle')?.getAttribute('aria-pressed'),
  addField: document.querySelectorAll('.tcard--open .subtask-add__field').length,
})`)
report.editorFields = await evaluate(`[...document.querySelectorAll('.tcard--open .editor input, .tcard--open .editor select')].map(n=>n.type||n.tagName)`)

// Closing the row and reopening it must come back in read mode, which is what unmounting buys.
await evaluate(`document.querySelector('.tcard--open .tcard__head').click()`)
await wait(300)
await evaluate(`(()=>{const r=[...document.querySelectorAll('.tcard')].find(c=>c.querySelector('.tcard__tally'));r.querySelector('.tcard__head').click();return true})()`)
await wait(400)
report.modeAfterReopen = await evaluate(`document.querySelector('.tcard--open .edit-toggle')?.getAttribute('aria-pressed')`)
await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(400)
/* Do BOTH date controls fit inside the card? The platform's intrinsic width is a floor, and the
   optional one shares its row with a 44px clear button — the narrower case of the two. */
report.dateFits = await evaluate(`
  [...document.querySelectorAll('.tcard--open input[type=date]')].map((input) => {
    const card = input.closest('.tcard')
    const a = input.getBoundingClientRect(), b = card.getBoundingClientRect()
    return { id: input.id, input: Math.round(a.right), card: Math.round(b.right), overflow: Math.round(a.right - b.right), width: Math.round(a.width), height: Math.round(a.height) }
  })
`)
report.subtasks = await evaluate(`document.querySelectorAll('.tcard--open .subtask').length`)
report.deleteIsLast = await evaluate(`
  (() => {
    const content = document.querySelector('.tcard__content')
    return content.lastElementChild.className
  })()
`)
await shot('02-open')

/**
 * Three fields, one write: blurring between fields must send nothing, and only the POST count shows
 * it. Each field is driven in its own tick, or React has not flushed the onChange update and the
 * handler reads a stale draft; `focus()` comes first because React listens for focusout, which
 * never fires on an element that never had focus. Either mistake verifies nothing.
 */
const setField = async (selector, value) => {
  await evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      el.focus()
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return document.activeElement === el
    })()
  `)
  await wait(250)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).blur()`)
  await wait(250)
}

const postsBeforeEdit = posts.length
await setField('.tcard--open .editor input:not([type=date])', 'Compare the venue quotes CAREFULLY')
/* By ID, never by ordinal: there are TWO date controls in the editor, and
   `querySelector('input[type=date]')` would silently drive the optional one while every assertion
   below still read as being about the deadline. */
await setField('.tcard--open .editor input[id$="-due"]', '2026-12-24')
await setField('.tcard--open .editor input[id$="-start"]', '2026-12-01')
await setField('.tcard--open .editor select', 'Budget')
report.draftOnScreen = await evaluate(`({
  title: document.querySelector('.tcard--open .editor input:not([type=date])').value,
  due: document.querySelector('.tcard--open .editor input[id$="-due"]').value,
  start: document.querySelector('.tcard--open .editor input[id$="-start"]').value,
  category: document.querySelector('.tcard--open .editor select').value,
})`)
// Nothing may have gone out yet: the session has not ended.
report.writesWhileEditing = posts.length - postsBeforeEdit
// The row still reads its stored values.
report.rowWhileEditing = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)

await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(400)
report.writesAfterDone = posts.length - postsBeforeEdit
report.rowAfterDone = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)
report.modeAfterDone = await evaluate(`document.querySelector('.tcard--open .edit-toggle')?.getAttribute('aria-pressed')`)
await wait(1800)
report.rowAfterReply = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)
report.dayAfterReply = await evaluate(`document.querySelector('.tcard--open .tcard__day')?.textContent`)
/* The optional day round-trips through the same one write, and the row it landed on is the one the
   section grouping then reads. */
report.startAfterReply = await evaluate(`document.querySelector('.tcard--open .tcard__fact')?.textContent`)
report.sections = await evaluate(`[...document.querySelectorAll('.plan__month')].map(n => n.textContent)`)
report.toast = await evaluate(`[...document.querySelectorAll('.toast')].map(n=>n.textContent)`)
await shot('03-saved')

// Tick a subtask: one write, and the only single-gesture write left, a tick being the whole edit.
const postsBeforeTick = posts.length
await evaluate(`document.querySelector('.tcard--open .subtask__toggle').click()`)
await wait(1800)
report.tickWrites = posts.length - postsBeforeTick
report.tallyAfterTick = await evaluate(`document.querySelector('.tcard--open .tcard__tally')?.textContent`)

/**
 * An undated task given a date has to leave the "No date" group, land in a dated month, and still
 * be there after a fresh read.
 */
await evaluate(`
  (() => {
    // Collapse everything first: \`.tcard--open\` picks the first match in document order, so an
    // earlier open row makes every selector below address the wrong task.
    for (const open of document.querySelectorAll('.tcard--open .tcard__head')) open.click()
    return true
  })()
`)
await wait(400)
const undatedRow = await evaluate(`
  (() => {
    /* The group whose rows print a dash for a day, found by that dash rather than by position: Past
       deadline and This month are groups too, and if either sorted last, taking the last group would
       date the wrong task and every figure below would be about it while still reading as a pass. */
    const groups = [...document.querySelectorAll('.plan__group')]
    const last = groups.find((g) => g.querySelector('.tcard__day')?.textContent === '\u2013')
    const heading = last.querySelector('.plan__month').textContent
    const row = last.querySelector('.tcard')
    row.querySelector('.tcard__head').click()
    return { heading, title: row.querySelector('.tcard__title').textContent, open: document.querySelectorAll('.tcard--open').length }
  })()
`)
await wait(500)
await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(400)
await setField('.tcard--open .editor input[id$="-due"]', '2027-03-09')
const postsBeforeDating = posts.length
await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(2200)
report.dating = {
  from: undatedRow,
  writes: posts.length - postsBeforeDating,
  group: await evaluate(
    `document.querySelector('.tcard--open')?.closest('.plan__group')?.querySelector('.plan__month')?.textContent`,
  ),
  day: await evaluate(`document.querySelector('.tcard--open .tcard__day')?.textContent`),
}
// And after a real re-read.
await evaluate(`document.querySelector('.tcard--open .tcard__head').click()`)
await wait(200)
await send('Page.reload', { ignoreCache: true })
await wait(4000)
report.dating.afterReload = await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.tcard')].find(
      (c) => c.querySelector('.tcard__title')?.textContent === ${JSON.stringify(undatedRow.title)},
    )
    return {
      group: row?.closest('.plan__group')?.querySelector('.plan__month')?.textContent,
      day: row?.querySelector('.tcard__day')?.textContent,
    }
  })()
`)
report.datedRowsAfterReload = await evaluate(
  `[...document.querySelectorAll('.tcard__day')].filter(n => n.textContent !== '\u2013').length`,
)
await shot('06-dated')

// The FAB's create sheet.
await evaluate(`document.querySelector('.fab').click()`)
await wait(700)
report.sheetFields = await evaluate(`[...document.querySelectorAll('.sheet input, .sheet select')].map(n=>n.type||n.tagName)`)
/* The two days in the order they happen, each label saying which it is: both are `type=date`, so the
   field list above cannot tell them apart and an accidental swap would read as a pass. */
report.sheetDays = await evaluate(`
  [...document.querySelectorAll('.sheet .field')].map((field) => ({
    id: field.querySelector('input, select')?.id,
    label: field.querySelector('label')?.textContent,
    required: field.querySelector('[aria-required="true"]') ? 'yes' : 'no',
  }))
`)
report.sheetDateFits = await evaluate(`
  [...document.querySelectorAll('.sheet input[type=date]')].map((input) => {
    const panel = input.closest('.sheet__panel')
    const a = input.getBoundingClientRect(), b = panel.getBoundingClientRect()
    return { id: input.id, overflow: Math.round(a.right - b.right), width: Math.round(a.width) }
  })
`)
/* The optional field opens BLANK and offers no way to clear what is not there: one control on an
   unused field, and a `✕` beside an empty date wheel is a button that does nothing. */
report.sheetStart = await evaluate(`({
  value: document.querySelector('.sheet input[id="task-start"]')?.value,
  clear: document.querySelectorAll('.sheet .field__pair .btn--icon').length,
})`)
await shot('04-sheet')
await evaluate(`document.querySelector('.sheet .btn--secondary').click()`)
await wait(400)

/**
 * The overdue filter: the chip is the control, there is no button. `filterBefore` is recorded so
 * this cannot pass by accident — a selector that stops matching optional-chains into a no-op and
 * reports the chip already pressed and the unfiltered row count.
 */
report.overdueChip = await evaluate(`
  (() => {
    const chip = [...document.querySelectorAll('.chip')].find(c => c.querySelector('.chip__count--alert'))
    if (!chip) return null
    return { text: chip.textContent, pressed: chip.getAttribute('aria-pressed'),
             alertInk: getComputedStyle(chip.querySelector('.chip__count')).color }
  })()
`)
report.filterBefore = await evaluate(`document.querySelector('.chip[aria-pressed=true]')?.textContent`)
await evaluate(`
  [...document.querySelectorAll('.chip')].find(c => c.querySelector('.chip__count--alert'))?.click()
`)
await wait(600)
report.filterAfterOverdue = await evaluate(`document.querySelector('.chip[aria-pressed=true]')?.textContent`)
report.rowsAfterFilter = await evaluate(`document.querySelectorAll('.tcard').length`)
await shot('05-overdue')

/**
 * Ticking under a filter must not make the row vanish: ticking raises no toast, so a row that also
 * leaves the list gives no feedback for the app's most frequent gesture. `App` holds the ticked
 * ids for the life of the filter, so the row stays put wearing its tick while the chip's count
 * drops. A click sets the state, so no static render sees it.
 */
const beforeTickUnderFilter = posts.length
const tickTarget = await evaluate(`
  (() => {
    const row = document.querySelector('.tcard')
    const title = row.querySelector('.tcard__title').textContent
    row.querySelector('.tcard__check').click()
    return { title, rowsBefore: document.querySelectorAll('.tcard').length }
  })()
`)
await wait(900)
report.tickUnderFilter = {
  ...tickTarget,
  ...(await evaluate(`
    (() => {
      const titles = [...document.querySelectorAll('.tcard__title')].map((n) => n.textContent)
      return {
        rowsAfter: titles.length,
        stillThere: titles.includes(${JSON.stringify(tickTarget.title)}),
        // Struck through where it stands, which is the confirmation.
        done: document.querySelectorAll('.tcard--done').length,
        chip: document.querySelector('.chip[aria-pressed=true]')?.textContent,
      }
    })()
  `)),
  writes: posts.length - beforeTickUnderFilter,
}

/**
 * The tick stays at full ink while the write is in flight: dimming the whole card takes the check
 * with it, and a confirmation fading for ~3s reads as un-pressed.
 */
report.pendingKeepsTheTick = await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.tcard')].find((c) => c.className.includes('pending'))
    if (!row) return 'no pending row to measure'
    return {
      head: getComputedStyle(row.querySelector('.tcard__head')).opacity,
      check: getComputedStyle(row.querySelector('.tcard__check')).opacity,
    }
  })()
`)

// Back to everything, which also clears the held rows.
await evaluate(`[...document.querySelectorAll('.chip')].find(c=>!c.disabled)?.click()`)
await wait(500)

/**
 * Deleting a task just edited must not bring it back. `TaskDetail` arms an unmount flush while a
 * session is open, so an optimistic delete unmounts the row and the cleanup resolves the draft
 * against the pre-delete task, carrying an empty `deleted_at` into an `update` that rewrites the
 * whole row and lands second. The check is the write list: one delete-span write for that row, no
 * whole-row write after it.
 */
await evaluate(`
  (() => {
    const row = [...document.querySelectorAll('.tcard')].find(c => c.querySelector('.tcard__tally'))
    row.querySelector('.tcard__head').click()
    row.scrollIntoView({ block: 'center' })
    return true
  })()
`)
await wait(500)
await evaluate(`document.querySelector('.tcard--open .edit-toggle').click()`)
await wait(400)
await setField('.tcard--open .editor input:not([type=date])', 'Edited, then deleted')
const beforeDelete = posts.length
await evaluate(`document.querySelector('.tcard--open .btn--danger-quiet').click()`)
await wait(500)
report.deleteAfterEdit = {
  confirmSheet: await evaluate(`document.querySelectorAll('.sheet').length`),
  // The session has ended, so no buffered draft is left to flush.
  editorStillOpen: await evaluate(`document.querySelectorAll('.tcard--open .editor').length`),
}
await evaluate(`[...document.querySelectorAll('.sheet .btn')].find(b=>b.className.includes('danger'))?.click()`)
await wait(2500)
report.deleteAfterEdit.posts = posts.slice(beforeDelete)
report.deleteAfterEdit.rowsNow = await evaluate(`document.querySelectorAll('.tcard').length`)
report.deleteAfterEdit.titleBack = await evaluate(
  `[...document.querySelectorAll('.tcard__title')].some(n => n.textContent === 'Edited, then deleted')`,
)
await shot('07-deleted')

/**
 * The signs in the live document. There is no Today line to place — the sections replaced it,
 * and with the current month hoisted the boundary it marked always fell at a month heading — so what
 * has to be true is the ORDER of the headings and what each one carries.
 */
await send('Page.reload', { ignoreCache: true })
await wait(4000)
report.sign = await evaluate(`
  (() => {
    const headings = [...document.querySelectorAll('.plan__month')]
    return {
      order: headings.map((n) => n.textContent),
      // The sections lead, and neither takes a month group's done-over-total.
      asides: [...document.querySelectorAll('.plan__aside')].map((n) => n.textContent),
      todayLine: document.querySelectorAll('.plan__now').length,
      weddingPlaques: [...document.querySelectorAll('.plan__month--day')].map((n) => n.textContent),
      tallies: [...document.querySelectorAll('.plan__tally')].map((n) => n.textContent),
      // aria-hidden, so the heading's own name is the month alone.
      tallyHidden: [...document.querySelectorAll('.plan__tally')].every((n) => n.getAttribute('aria-hidden') === 'true'),
    }
  })()
`)
// Horizontal overflow anywhere?
report.docOverflow = await evaluate(`
  (() => {
    const bad = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > document.documentElement.clientWidth + 1) bad.push(el.className || el.tagName)
    }
    return [...new Set(bad)].slice(0, 12)
  })()
`)

/**
 * The gear is reachable. Two positioned siblings with no z-index paint in DOM order, so a
 * full-width text block after the button leaves it visible and keyboard-focusable but unhittable —
 * invisible to a screenshot and to a static render. Settings is the only route to the language,
 * the accent, the wedding date, the read-only preview, restore and the edit key.
 */
report.gearReachable = await evaluate(`
  (() => {
    const gear = document.querySelector('.hero__gear')
    if (!gear) return 'no gear'
    const r = gear.getBoundingClientRect()
    const at = (x, y) => document.elementFromPoint(x, y)?.closest('.hero__gear') ? 'gear' : 'blocked'
    // Inside the circle: the corners of a fully-rounded bounding box are not part of the control,
    // so a hit test there reports whatever is behind it. (No backticks: this is a template
    // literal.)
    const inset = r.width * 0.15
    return {
      centre: at(r.left + r.width / 2, r.top + r.height / 2),
      nearTop: at(r.left + r.width / 2, r.top + inset),
      nearLeft: at(r.left + inset, r.top + r.height / 2),
      nearBottom: at(r.left + r.width / 2, r.bottom - inset),
      size: [Math.round(r.width), Math.round(r.height)],
    }
  })()
`)

/**
 * The safe-area geometry, with a faked inset: an iframe and a headless viewport both report 0px, so
 * `--safe-top` is the one token the harness cannot show. `border-box` means a `padding-top` on a
 * fixed-height band comes out of the band — the names land under the clock, `overflow: hidden`
 * clips the gear, and `--hero-height`, which counts the inset, exceeds the header's real height,
 * so the sticky month heading parks in mid-air.
 */
report.safeArea = await evaluate(`
  (() => {
    const style = document.createElement('style')
    style.textContent = ':root { --safe-top: 59px }'
    document.head.appendChild(style)
    const band = document.querySelector('.hero__photo').getBoundingClientRect()
    const gear = document.querySelector('.hero__gear').getBoundingClientRect()
    const title = document.querySelector('.hero__title').getBoundingClientRect()
    const header = document.querySelector('.hero').getBoundingClientRect()
    const month = getComputedStyle(document.querySelector('.plan__month')).top
    style.remove()
    return {
      bandHeight: Math.round(band.height),
      gearInsideBand: gear.bottom <= band.bottom + 0.5 && gear.top >= band.top - 0.5,
      titleClearsInset: Math.round(title.top) >= 59,
      monthTop: month,
      headerBottom: Math.round(header.bottom),
    }
  })()
`)

/**
 * THE NOTES TAB. Everything about it that matters is invisible to a static render: the tab switch
 * itself, the field's height (JS-driven, so the harness page understates it and shows a clipped
 * box), whether a toolbar tap keeps the selection, and whether the bar gets out of the way.
 */
await evaluate(`[...document.querySelectorAll('.tabbtn')].find(b => b.textContent.includes('Notes')).click()`)
await wait(600)
report.notes = {
  current: await evaluate(`[...document.querySelectorAll('.tabbtn')].map(b => b.getAttribute('aria-current'))`),
  // The header spans both tabs: the countdown and the tracker are facts about the board.
  hero: await evaluate(`Boolean(document.querySelector('.hero__percent'))`),
  /* This tab floats one too, and it is the way IN: a pencil, where the plan has its `+`. Read mode
     is a document, so there is no bar above it at all — that row of chrome, holding one button and
     sticky so it never scrolled away, is what this replaced. */
  fab: await evaluate(`Boolean(document.querySelector('.fab'))`),
  fabLabel: await evaluate(`document.querySelector('.fab')?.getAttribute('aria-label')`),
  barInReadMode: await evaluate(`Boolean(document.querySelector('.notes__bar'))`),
  rendered: await evaluate(`document.querySelector('.doc')?.textContent`),
  blocks: await evaluate(`[...document.querySelectorAll('.doc > *')].map(n => n.tagName)`),
  emphasis: await evaluate(`document.querySelector('.doc strong')?.textContent`),
  /* The links, which are the reason this document has an anchor at all. Two shapes and one refusal
     in the stub's text: `target=_blank` is load-bearing — installed, a same-window navigation
     replaces the board with no way back — and `javascript:` must have stayed characters. */
  links: await evaluate(`[...document.querySelectorAll('.doc a')].map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel }))`),
  refusedLink: await evaluate(`document.querySelector('.doc')?.textContent.includes('javascript:alert(1)')`),
}
await shot('08-notes')

await evaluate(`document.querySelector('.fab').click()`)
await wait(500)
/* Sticky, so Done stays reachable down a long document — and only measurable now, the bar being the
   session's rather than the document's. */
report.notes.barSticky = await evaluate(`getComputedStyle(document.querySelector('.notes__bar')).position`)
report.notes.fabInSession = await evaluate(`Boolean(document.querySelector('.fab'))`)
report.notes.editing = {
  field: await evaluate(`Boolean(document.querySelector('.textarea'))`),
  tools: await evaluate(`[...document.querySelectorAll('.notes__bar .btn--icon')].map(b => b.getAttribute('aria-label'))`),
  /**
   * The bar is withheld for the whole session: `interactive-widget=resizes-content` re-anchors a
   * bottom-fixed bar just above the iOS keyboard, where two ~196px targets land on the accessory
   * row — one mis-tap from abandoning an open editor. It is also what makes Done the only exit, so
   * the session needs no unmount flush.
   */
  tabbar: await evaluate(`Boolean(document.querySelector('.tabbar'))`),
  /** No caret until somebody puts one: a focus() on a surface that re-renders per keystroke drops the
   *  iOS keyboard mid-word. Anything BUT `input textarea` passes; that string is the regression. */
  focused: await evaluate(`document.activeElement?.className`),
  /**
   * The box follows its content, so it owns no scroller — there is one document scroller. It is
   * measured against a document TALLER than `.textarea`'s floor, or `grow()` can be deleted outright
   * and the min-height still reports a fitting box: `stub-endpoint.mjs` seeds enough lines for that,
   * and `beyondFloor` is what says the measurement meant anything.
   */
  fits: await evaluate(`
    (() => {
      const el = document.querySelector('.textarea')
      // Against the CSS floor, so a box that only ever reached its min-height is visible as such.
      const floor = parseFloat(getComputedStyle(el).minHeight)
      return {
        scroll: el.scrollHeight,
        client: el.clientHeight,
        floor: Math.round(floor),
        beyondFloor: el.clientHeight > floor + 2,
        grown: el.scrollHeight <= el.clientHeight + 2,
      }
    })()
  `),
  /** 16px, or mobile Safari zooms the viewport on focus and will not zoom back. */
  fontSize: await evaluate(`getComputedStyle(document.querySelector('.textarea')).fontSize`),
  fontFamily: await evaluate(`getComputedStyle(document.querySelector('.textarea')).fontFamily.slice(0, 24)`),
}

/**
 * A toolbar tap on a selection. Both halves matter: the text has to change AND the selection has to
 * survive — React re-renders a controlled textarea from its value and the browser then parks the
 * caret at the end of it, so without writing the node and the selection together a second tap acts
 * on the wrong range and every tap sends somebody to the bottom of the document.
 */
report.notes.bold = await evaluate(`
  (() => {
    const el = document.querySelector('.textarea')
    const at = el.value.indexOf('garden pavilion')
    el.focus()
    el.setSelectionRange(at, at + 'garden pavilion'.length)
    const before = el.value
    document.querySelector('.notes__bar [aria-label="Bold"]').click()
    return { before, after: el.value, start: el.selectionStart, end: el.selectionEnd,
             selected: el.value.slice(el.selectionStart, el.selectionEnd) }
  })()
`)
await wait(300)
report.notes.boldAfterRender = await evaluate(`
  (() => {
    const el = document.querySelector('.textarea')
    return { value: el.value.includes('**garden pavilion**'),
             selected: el.value.slice(el.selectionStart, el.selectionEnd) }
  })()
`)

// A second tap is the inverse.
await evaluate(`document.querySelector('.notes__bar [aria-label="Bold"]').click()`)
await wait(300)
report.notes.boldTwice = await evaluate(`document.querySelector('.textarea').value.includes('**garden pavilion**')`)

/** Bullets over two lines: block marks are decided over the whole selection, or a mixed run
 *  alternates on every tap and never converges. */
report.notes.bullets = await evaluate(`
  (() => {
    const el = document.querySelector('.textarea')
    el.focus()
    el.setSelectionRange(el.value.indexOf('The garden'), el.value.length)
    document.querySelector('.notes__bar [aria-label="Bullet list"]').click()
    return el.value
  })()
`)
await wait(300)

// One write for the session, and it is a config cell — nothing else in the sheet is touched.
const beforeNotes = posts.length
await evaluate(`document.querySelector('.notes__bar .edit-toggle').click()`)
await wait(2500)
report.notes.saved = {
  writes: posts.slice(beforeNotes),
  toast: await evaluate(`[...document.querySelectorAll('.toast')].map(n => n.textContent)`),
  /* Back to read mode, which is now the ABSENCE of the bar and the return of the pencil. */
  barGone: await evaluate(`Boolean(document.querySelector('.notes__bar')) === false`),
  fabBack: await evaluate(`document.querySelector('.fab')?.getAttribute('aria-label')`),
  tabbarBack: await evaluate(`Boolean(document.querySelector('.tabbar'))`),
  rendered: await evaluate(`[...document.querySelectorAll('.doc > *')].map(n => n.tagName)`),
  bullets: await evaluate(`document.querySelectorAll('.doc__list--bullets .doc__item').length`),
}

/** Opening and closing the session unchanged must send nothing at all. */
const beforeNoop = posts.length
await evaluate(`document.querySelector('.fab').click()`)
await wait(400)
await evaluate(`document.querySelector('.notes__bar .edit-toggle').click()`)
await wait(1500)
report.notes.unchangedWrites = posts.length - beforeNoop

/** Through the stub's real grid and back: the round trip is the only proof it was stored. */
await send('Page.reload', { ignoreCache: true })
await wait(4000)
// Read BEFORE the click: this is the only moment the boot tab is observable, and it must be the plan.
report.notes.opensOn = await evaluate(
  `document.querySelector('.tabbtn[aria-current]')?.textContent`,
)
await evaluate(`[...document.querySelectorAll('.tabbtn')].find(b => b.textContent.includes('Notes')).click()`)
await wait(600)
report.notes.afterReload = {
  blocks: await evaluate(`[...document.querySelectorAll('.doc > *')].map(n => n.tagName)`),
  text: await evaluate(`document.querySelector('.doc')?.textContent`),
}
await shot('09-notes-saved')

report.notes.overflow = await evaluate(`
  (() => {
    const bad = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > document.documentElement.clientWidth + 1) bad.push(el.className || el.tagName)
    }
    return [...new Set(bad)].slice(0, 12)
  })()
`)

/**
 * The bottom geometry with a faked inset, the mirror of `safeArea` above. --tabbar-height is the bar's
 * WHOLE occupied height and four things offset by it; naming --safe-bottom again anywhere leaves a
 * dead strip, and omitting the bar's term puts it over the last row's controls.
 */
await evaluate(`[...document.querySelectorAll('.tabbtn')].find(b => b.textContent.includes('Plan')).click()`)
await wait(600)
report.safeBottom = await evaluate(`
  (() => {
    const style = document.createElement('style')
    style.textContent = ':root { --safe-bottom: 34px }'
    document.head.appendChild(style)
    const doc = document.documentElement
    // SCROLLED TO THE END, and on the plan, whose document is long enough to reach the bar: measured
    // at the top of a short notes document the content ends hundreds of pixels above it and clears the
    // bar whatever the views wrapper reserves. (No backticks: this is a template literal.)
    doc.scrollTop = doc.scrollHeight
    const bar = document.querySelector('.tabbar').getBoundingClientRect()
    const button = document.querySelector('.tabbtn').getBoundingClientRect()
    const views = document.querySelector('.views')
    const rows = [...document.querySelectorAll('.tcard')]
    const last = (rows[rows.length - 1] ?? views.lastElementChild).getBoundingClientRect()
    const out = {
      barHeight: Math.round(bar.height),
      barAtBottom: Math.round(doc.clientHeight - bar.bottom),
      buttonsAboveInset: Math.round(bar.bottom - button.bottom),
      reserved: getComputedStyle(views).paddingBottom,
      scrolledToEnd: Math.round(doc.scrollTop) > 0,
      lastRowClearsBar: last.bottom <= bar.top + 0.5,
      gapBelowLastRow: Math.round(bar.top - last.bottom),
    }
    style.remove()
    return out
  })()
`)

report.allPosts = posts
console.log(JSON.stringify(report, null, 2))
console.log('--- console ---')
console.log(logs.length ? logs.join('\n') : '(clean)')
ws.close(); chrome.kill()
