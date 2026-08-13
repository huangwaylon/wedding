/**
 * Drives the RUNNING app in a real browser, over the Chrome DevTools Protocol.
 *
 * `scripts/preview.jsx` renders every surface statically, which is what a screenshot needs and
 * all it can be: a static render fires no blur, runs no effect, and never mounts a native date
 * picker. This file covers the other half — the accordion, commit-on-blur, the create sheet, and
 * the one measurement that mattered most in this redesign: whether `input[type=date]` stays
 * inside the row it is drawn in.
 *
 * IT ALSO COVERS THE TWO THINGS ONLY A CLICK CAN REACH: that ticking a row under a filter does
 * not make it vanish, and that deleting a task you have just EDITED does not resurrect it. The
 * second is a POST count, deliberately — the fixture replies with the board as it was before the
 * write, so a resurrection is invisible in the DOM and visible only in the request list. Reverting
 * `remove()` in TaskDetail.jsx to a bare `onDelete(task)` makes it print
 * `["delete:a5:", "update:a5:Edited, then deleted"]`, which is the defect.
 *
 * WHAT THE FIXTURE CANNOT SHOW, and do not read these as passes: the optimistic window. The dev
 * server answers in milliseconds, so `tickUnderFilter.done` and `pendingKeepsTheTick` are measured
 * after the stale reply has already rolled the tick back. The row STAYING is the real assertion in
 * the first; the second is pinned as a CSS fact in `test/ui.test.jsx` instead.
 *
 * EVERY POST COUNT HERE ASSUMES A HEALTHY ENDPOINT. `send` retries a non-terminal failure, so one
 * app-level write against a flaky one is legitimately two or three requests — a count of 2 read as
 * "the unmount flush fired twice" when the endpoint had simply blinked would be a hunt for a defect
 * that is not there. The fixture never fails, which is what keeps these numbers meaningful.
 *
 * No new dependency: `WebSocket` and `fetch` are built into node.
 *
 *   1. node scripts/stub-endpoint.mjs
 *   2. npx vite --port 5199 --strictPort --host 127.0.0.1
 *   3. cp scripts/drive.mjs /tmp/cdp-wedding.mjs && node /tmp/cdp-wedding.mjs
 *
 * THE STUB IS NOT OPTIONAL ANY MORE. A static JSON fixture could stand in for the old endpoint
 * because every read and write went to one URL; an editor now mints a token and writes to the
 * Sheets API, so a fixture would leave the whole write path unexercised and every count below at
 * zero. `.env.local` has to carry BOTH routes, and `vite.config.js` proxies them:
 *
 *     VITE_SCRIPT_URL=/wedding/__endpoint
 *     VITE_SHEETS_BASE=/wedding/__sheets
 *
 * The copy in step 3 is not decoration: the sandbox refuses `connect 127.0.0.1:<port>` unless
 * the command matches an allowlist entry, and the sanctioned pattern for CDP drivers is
 * `node /tmp/cdp-*`.
 *
 * WHAT THE STUB DOES AND DOES NOT PROVE. It applies writes to a real in-memory grid and serves
 * `doGet` from that same grid, so "was it stored" is now a question with an answer — a write, then
 * a refresh, then the new value on screen. What it cannot prove is anything about Google: the
 * ranges are parsed by our own code in both directions, so a range the real API would reject can
 * still pass here. A deployed script and a real spreadsheet are the only check for that.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const KEY = 'a'.repeat(64)
const URL = `http://localhost:5199/wedding/#k=${KEY}`
// A FRESH profile every run. Reusing one leaves other tabs in the target list, and
// `find(type === 'page')` then attaches to somebody else's page — which is how a console
// error from an unrelated app on :3000 turned up in this board's report.
const PROFILE = `/tmp/cdp-wedding-profile-${process.pid}`

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`,
  `--window-size=393,900`, 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2500)

/**
 * VERIFY WE ATTACHED TO THE BROWSER WE JUST STARTED. A Chrome left running from an earlier
 * run still holds the debugging port, so a second spawn silently fails to bind and this
 * connects to the OLD browser — which reported the previous run's filtered, half-open board
 * as if it were a first paint. `Browser.getVersion` is checked against the process we own.
 */

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const target = list.find((t) => t.type === 'page')
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
/**
 * WITHOUT THIS, NO FOCUS EVENT EVER FIRES. Headless Chrome treats the page as unfocused, so
 * `element.focus()` moves `document.activeElement` but dispatches neither focus nor focusout —
 * and every commit-on-blur assertion below then passes against a board that saved nothing.
 * Confirmed by instrumenting the input: only `input` was seen, never `focusout`.
 */
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 2, mobile: true })
/**
 * COUNT THE WRITES. "One write per edit session" is the claim this file exists to check, and
 * counting toasts or watching the row cannot check it — the version before this batched nothing
 * and looked identical on screen while costing a whole round trip per field.
 *
 * THE OP IS NO LONGER IN THE BODY, so it is read off the RANGE instead. Writes go to the Sheets
 * API now, whose request says what cells it touches rather than what the app meant:
 *
 *   append                 a create
 *   tasks!A{r}:I{r}        a whole-row write — an update, or a create replayed in place
 *   tasks!G{r}:H{r}        the updated_at/deleted_at span — a delete if the second cell is set,
 *                          a restore if it is blank
 *   config!B{r}            a settings write
 *
 * That is enough for every count below, AND for the one assertion that needs more than a count:
 * the resurrection check wants "one delete-span write and no whole-row write for that row", which
 * the ranges state exactly. The mint is excluded — it is not a write.
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
report.stickyMonth = await evaluate(`getComputedStyle(document.querySelector('.plan__month')).position`)
await shot('01-top')

// Open the row that has a checklist.
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
 * READ MODE IS THE DEFAULT AND IS INERT. Opening a row must not arm a single field of the task
 * itself — the editor commits on blur, so a caret landing in the title on the tap that opened the
 * row is one stray blur away from renaming it.
 */
report.readMode = await evaluate(`({
  editor: document.querySelectorAll('.tcard--open .editor').length,
  fact: document.querySelector('.tcard--open .tcard__fact')?.textContent,
  trashIcons: document.querySelectorAll('.tcard--open .subtask .btn--icon').length,
  deleteTask: document.querySelectorAll('.tcard--open .btn--danger-quiet').length,
  toggle: document.querySelector('.tcard--open .tcard__edit')?.getAttribute('aria-pressed'),
  // Ticking and adding stay on this path: both are doing the work, not editing the task.
  tickable: document.querySelectorAll('.tcard--open .subtask__toggle').length,
  addField: document.querySelectorAll('.tcard--open .subtask-add__field').length,
})`)

// And the toggle actually toggles, both ways.
await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(400)
report.editMode = await evaluate(`({
  editor: document.querySelectorAll('.tcard--open .editor').length,
  fact: document.querySelectorAll('.tcard--open .tcard__fact').length,
  trashIcons: document.querySelectorAll('.tcard--open .subtask .btn--icon').length,
  deleteTask: document.querySelectorAll('.tcard--open .btn--danger-quiet').length,
  toggle: document.querySelector('.tcard--open .tcard__edit')?.getAttribute('aria-pressed'),
})`)
report.editorFields = await evaluate(`[...document.querySelectorAll('.tcard--open .editor input, .tcard--open .editor select')].map(n=>n.type||n.tagName)`)

// Closing the row and reopening it must come back in READ mode, which is what unmounting buys.
await evaluate(`document.querySelector('.tcard--open .tcard__head').click()`)
await wait(300)
await evaluate(`(()=>{const r=[...document.querySelectorAll('.tcard')].find(c=>c.querySelector('.tcard__tally'));r.querySelector('.tcard__head').click();return true})()`)
await wait(400)
report.modeAfterReopen = await evaluate(`document.querySelector('.tcard--open .tcard__edit')?.getAttribute('aria-pressed')`)
await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(400)
// THE REPORTED BUG: does the date control fit inside its card?
report.dateFits = await evaluate(`
  (() => {
    const input = document.querySelector('.tcard--open input[type=date]')
    const card = input.closest('.tcard')
    const a = input.getBoundingClientRect(), b = card.getBoundingClientRect()
    return { input: Math.round(a.right), card: Math.round(b.right), overflow: Math.round(a.right - b.right), width: Math.round(a.width), height: Math.round(a.height) }
  })()
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
 * THREE FIELDS, ONE WRITE. Blurring between fields must send NOTHING — that is the whole
 * performance fix, and the only honest way to see it is to count the POSTs.
 *
 * Each field is driven in its own tick. Typing and blurring in one synchronous block means React
 * has not flushed the onChange update when the handler runs, so it would read a stale draft; and
 * `focus()` must come first, because React listens for focusout and that never fires on an
 * element which never had focus. Both of those silently made this check verify nothing.
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
await setField('.tcard--open .editor input[type=date]', '2026-12-24')
await setField('.tcard--open .editor select', 'Budget')
report.draftOnScreen = await evaluate(`({
  title: document.querySelector('.tcard--open .editor input:not([type=date])').value,
  due: document.querySelector('.tcard--open .editor input[type=date]').value,
  category: document.querySelector('.tcard--open .editor select').value,
})`)
// Nothing may have gone out yet: the session has not ended.
report.writesWhileEditing = posts.length - postsBeforeEdit
// The row still reads its stored values, because nothing has been written.
report.rowWhileEditing = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)

await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(400)
report.writesAfterDone = posts.length - postsBeforeEdit
report.rowAfterDone = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)
report.modeAfterDone = await evaluate(`document.querySelector('.tcard--open .tcard__edit')?.getAttribute('aria-pressed')`)
await wait(1800)
report.rowAfterReply = await evaluate(`document.querySelector('.tcard--open .tcard__title')?.textContent`)
report.dayAfterReply = await evaluate(`document.querySelector('.tcard--open .tcard__day')?.textContent`)
report.toast = await evaluate(`[...document.querySelectorAll('.toast')].map(n=>n.textContent)`)
await shot('03-saved')

// Tick a subtask. One write, and it is the only path still writing on a single gesture — which
// is right: a tick IS the whole edit.
const postsBeforeTick = posts.length
await evaluate(`document.querySelector('.tcard--open .subtask__toggle').click()`)
await wait(1800)
report.tickWrites = posts.length - postsBeforeTick
report.tallyAfterTick = await evaluate(`document.querySelector('.tcard--open .tcard__tally')?.textContent`)

/**
 * THE REPORTED BUG, end to end: an UNDATED task given a date.
 *
 * It has to leave the "No date" group at the foot of the list, land in a dated month, and still
 * be there after a fresh read. Every part of that was broken at once — the deployed script had
 * never heard of `due` so the write dropped it, and its reads carried no `due` either, so the
 * whole board came back undated and the row appeared to revert.
 */
await evaluate(`
  (() => {
    // COLLAPSE EVERYTHING FIRST. \`.tcard--open\` picks the first match in document order, so
    // with an earlier row still open every selector below silently addressed the WRONG task —
    // and this check reported the app losing a date it had in fact stored on another row.
    for (const open of document.querySelectorAll('.tcard--open .tcard__head')) open.click()
    return true
  })()
`)
await wait(400)
const undatedRow = await evaluate(`
  (() => {
    const groups = [...document.querySelectorAll('.plan__group')]
    const last = groups[groups.length - 1]
    const heading = last.querySelector('.plan__month').textContent
    const row = last.querySelector('.tcard')
    row.querySelector('.tcard__head').click()
    return { heading, title: row.querySelector('.tcard__title').textContent, open: document.querySelectorAll('.tcard--open').length }
  })()
`)
await wait(500)
await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(400)
await setField('.tcard--open .editor input[type=date]', '2027-03-09')
const postsBeforeDating = posts.length
await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(2200)
report.dating = {
  from: undatedRow,
  writes: posts.length - postsBeforeDating,
  // Where the row is NOW: its group heading, and the day its column prints.
  group: await evaluate(
    `document.querySelector('.tcard--open')?.closest('.plan__group')?.querySelector('.plan__month')?.textContent`,
  ),
  day: await evaluate(`document.querySelector('.tcard--open .tcard__day')?.textContent`),
}
// And after a real re-read, which is where it reverted before.
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
report.sheetDateFits = await evaluate(`
  (() => {
    const input = document.querySelector('.sheet input[type=date]')
    const panel = input.closest('.sheet__panel')
    const a = input.getBoundingClientRect(), b = panel.getBoundingClientRect()
    return { overflow: Math.round(a.right - b.right), width: Math.round(a.width) }
  })()
`)
await shot('04-sheet')
await evaluate(`document.querySelector('.sheet .btn--secondary').click()`)
await wait(400)

/**
 * THE OVERDUE FILTER. There is no overdue BUTTON any more — the chip is the control, which is the
 * whole claim behind deleting the card that used to hold one.
 *
 * `filterBefore` is recorded so this cannot pass by accident: the previous version clicked
 * `.overall__alert`, which stopped existing, and optional-chained into a no-op — so it reported
 * the chip that was already pressed and the unfiltered row count, and looked like a pass.
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
 * TICKING SOMETHING OFF UNDER A FILTER MUST NOT MAKE IT VANISH.
 *
 * The highest-frequency gesture in the app meeting its most-used filter. Ticking deliberately
 * raises no toast, so if the row also leaves the list there is NO feedback at all — the tap
 * reads as having done nothing. `App` holds the ticked ids for as long as the filter lasts, so
 * the row stays put wearing its tick while the chip's count drops.
 *
 * A static render cannot see any of this: the state is set by a click.
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
        // Struck through where it stands, which IS the confirmation.
        done: document.querySelectorAll('.tcard--done').length,
        chip: document.querySelector('.chip[aria-pressed=true]')?.textContent,
      }
    })()
  `)),
  writes: posts.length - beforeTickUnderFilter,
}

/**
 * AND THE TICK STAYS AT FULL INK WHILE THE WRITE IS IN FLIGHT. Dimming the whole card took the
 * check with it, so the confirmation of that same gesture faded for ~3s — which reads as
 * un-pressed. Measured as a computed opacity on the check inside a pending row.
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
 * DELETING A TASK YOU HAVE JUST EDITED MUST NOT BRING IT BACK.
 *
 * The defect: `TaskDetail` arms an unmount flush on every render while a session is open, and
 * only `done()` disarmed it. The optimistic delete drops the row from the plan, the component
 * unmounts, and the cleanup resolved the buffered draft against the PRE-delete task — a payload
 * carrying an empty `deleted_at`, which `update` writes over the whole row. The two serialise, so
 * the resurrection landed second and won: the task returned ~3s later wearing the edit, with its
 * subtasks gone.
 *
 * The only honest check is the write list. ONE delete-span write for that row, and NO whole-row
 * write after it — the ranges say which is which, so a resurrecting `update` cannot hide.
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
await evaluate(`document.querySelector('.tcard--open .tcard__edit').click()`)
await wait(400)
await setField('.tcard--open .editor input:not([type=date])', 'Edited, then deleted')
const beforeDelete = posts.length
await evaluate(`document.querySelector('.tcard--open .btn--danger-quiet').click()`)
await wait(500)
report.deleteAfterEdit = {
  confirmSheet: await evaluate(`document.querySelectorAll('.sheet').length`),
  // The session has ended, so there is no buffered draft left to flush.
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
 * THE SIGN AND THE TODAY LINE, in the live document rather than a fixture page.
 *
 * The line is a boundary, so what has to be true is its POSITION: every row above it is due
 * before today and the first row below it is not. A line in the wrong place is worse than none.
 */
await send('Page.reload', { ignoreCache: true })
await wait(4000)
report.sign = await evaluate(`
  (() => {
    const now = document.querySelector('.plan__now')
    if (!now) return 'no today line'
    const rows = [...document.querySelectorAll('.tcard, .plan__now')]
    const index = rows.indexOf(now)
    const label = now.textContent
    const plaques = [...document.querySelectorAll('.plan__month--day')].map(n => n.textContent)
    return {
      label,
      rowsAbove: index,
      rowsBelow: rows.length - index - 1,
      // The heading directly above it, and the one carrying the wedding.
      weddingPlaques: plaques,
      tallies: [...document.querySelectorAll('.plan__tally')].map(n => n.textContent),
      // aria-hidden, so the heading's own name is the month alone.
      tallyHidden: [...document.querySelectorAll('.plan__tally')].every(n => n.getAttribute('aria-hidden') === 'true'),
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
 * THE GEAR IS REACHABLE. Two positioned siblings with no z-index paint in DOM order, so putting
 * the full-width text block after the button makes the button unhittable while leaving it
 * perfectly visible AND perfectly keyboard-focusable — the worst possible failure profile, and one
 * that no screenshot and no static render can see. Settings is the only route to the language, the
 * accent, the wedding date, the read-only preview, restore and the edit key.
 */
report.gearReachable = await evaluate(`
  (() => {
    const gear = document.querySelector('.hero__gear')
    if (!gear) return 'no gear'
    const r = gear.getBoundingClientRect()
    const at = (x, y) => document.elementFromPoint(x, y)?.closest('.hero__gear') ? 'gear' : 'blocked'
    // Sampled INSIDE the circle. The corners of a fully-rounded bounding box are not part of the
    // control, so a hit test there correctly reports whatever sits behind it -- asserting on them
    // would fail forever for the wrong reason. (No backticks in here: this string IS a template
    // literal, and one would close it.)
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
 * THE SAFE-AREA GEOMETRY, with a faked inset — an iframe and a headless viewport both report 0px,
 * so `--safe-top` is the one token whose consequences the harness structurally cannot show.
 *
 * `border-box` means a `padding-top` on a fixed-height band comes OUT of the band: the names end
 * up under the clock, `overflow: hidden` clips the gear, and `--hero-height` (which counts the
 * inset) exceeds the header's real height, so the sticky month heading parks in mid-air.
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

report.allPosts = posts
console.log(JSON.stringify(report, null, 2))
console.log('--- console ---')
console.log(logs.length ? logs.join('\n') : '(clean)')
ws.close(); chrome.kill()
