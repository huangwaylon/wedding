/**
 * Drives the hide-what-is-finished preference in a real browser, over the Chrome DevTools Protocol.
 * BRAVE, not Chrome: the two are the same engine, and this is the browser these two people use.
 *
 * None of it is reachable from a static render. The toggle lives behind a tap inside Settings, the
 * preference is read from `localStorage` at mount, and the three things that can go wrong are all
 * about what happens NEXT: the row leaving the list, the figures above it NOT moving with it, and the
 * preference surviving a relaunch. `scripts/drive.mjs`'s header applies here too — a browser left on
 * the debugging port from an earlier run is attached to instead, and the page-target count is the
 * check. It gets a port of its own (9335) so the two can run at once.
 *
 * SEPARATE FROM `drive.mjs` deliberately, rather than appended to it: that script retitles, dates,
 * ticks and deletes rows in one sequence against a fixture that keeps its grid for the life of the
 * stub, and a check about which rows are DRAWN has to know which rows exist.
 *
 *   1. node scripts/stub-endpoint.mjs
 *   2. npx vite --port 5199 --strictPort --host 127.0.0.1
 *   3. cp scripts/drive-completed.mjs /tmp/cdp-completed.mjs && node /tmp/cdp-completed.mjs
 *
 * Step 3's copy is required: the sandbox refuses `connect 127.0.0.1:<port>` unless the command
 * matches `node /tmp/cdp-*`. The fixture's `a7` is the finished row every assertion here is about.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const KEY = 'a'.repeat(64)
const URL = `http://localhost:5199/wedding/#k=${KEY}`
const DONE_TITLE = 'Agree the budget'
const PROFILE = `/tmp/cdp-completed-profile-${process.pid}`

const brave = spawn(BRAVE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9335', `--user-data-dir=${PROFILE}`,
  '--window-size=393,900', 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2500)

const list = await (await fetch('http://127.0.0.1:9335/json/list')).json()
const pages = list.filter((t) => t.type === 'page')
if (pages.length !== 1) throw new Error(`expected one page target, found ${pages.length}`)
const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
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
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 2, mobile: true })

await send('Page.navigate', { url: URL })
// The boot, the mint and the first read.
await wait(3500)

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (out.result?.exceptionDetails) return { error: out.result.exceptionDetails.text }
  return out.result?.result?.value
}
const shot = async (name) => {
  const out = await send('Page.captureScreenshot', { captureBeyondViewport: true })
  writeFileSync(`/tmp/completed-${name}.png`, Buffer.from(out.result.data, 'base64'))
}

/** Tap whatever carries this text. Returns whether anything matched, so a renamed label fails loudly. */
const tap = (text) => evaluate(`
  (() => {
    const hit = [...document.querySelectorAll('button')]
      .find((node) => node.textContent.includes(${JSON.stringify(text)}))
    if (!hit) return false
    hit.click()
    return true
  })()
`)

const board = () => evaluate(`
  ({
    titles: [...document.querySelectorAll('.tcard__title')].map((n) => n.textContent),
    months: [...document.querySelectorAll('.plan__month')].map((n) => n.textContent),
    tallies: [...document.querySelectorAll('.plan__tally')].map((n) => n.textContent),
    percent: document.querySelector('.hero__percent')?.textContent,
    tally: document.querySelector('.hero__tally')?.textContent,
    doneChip: [...document.querySelectorAll('.chip')]
      .map((n) => n.textContent).find((text) => text.startsWith('Done')),
    stored: localStorage.getItem('wd.showDone'),
  })
`)

const report = {}

/* HIDDEN, with nothing stored: the default is the absence of a value. */
report.default = await board()
report.defaultHidesTheFinishedRow = !report.default.titles?.some((t) => t.includes(DONE_TITLE))

/* The toggle, in Settings, where a viewer can reach it too. */
report.openedSettings = await tap('Settings') || await evaluate(`
  (() => { const g = document.querySelector('.hero__gear'); if (!g) return false; g.click(); return true })()
`)
await wait(400)
/* Scrolled to the new section before the picture is taken: the sheet opens at the couple's names, so
   a screenshot of its top says nothing about the control this file is here for. */
await evaluate(`
  (() => {
    const heading = [...document.querySelectorAll('.section__title')]
      .find((node) => node.textContent.includes('Completed tasks'))
    heading?.scrollIntoView({ block: 'center' })
    return Boolean(heading)
  })()
`)
await wait(400)
await shot('settings')
report.sheetOffersShow = await evaluate(
  `document.body.textContent.includes('Show completed tasks')`,
)
report.tappedShow = await tap('Show completed tasks')
await wait(300)
report.sheetNowOffersHide = await evaluate(
  `document.body.textContent.includes('Hide completed tasks')`,
)
await tap('Close')
await tap('Cancel')
await wait(400)

report.shown = await board()
report.showingDrawsTheFinishedRow = Boolean(report.shown.titles?.some((t) => t.includes(DONE_TITLE)))
await shot('showing')

/* A RELAUNCH, which is what `localStorage` is for. */
await send('Page.navigate', { url: URL })
await wait(3000)
report.afterReload = await board()
report.preferenceSurvivesAReload = Boolean(
  report.afterReload.titles?.some((t) => t.includes(DONE_TITLE)),
)

/* Back to hidden, then the gesture with no toast: ticking a row must not make it vanish. */
await evaluate(`
  (() => { const g = document.querySelector('.hero__gear'); g?.click(); return true })()
`)
await wait(400)
await tap('Hide completed tasks')
await wait(300)
await tap('Close')
await tap('Cancel')
await wait(500)
report.hiddenAgain = await board()

report.tickedTitle = await evaluate(`
  (() => {
    const row = document.querySelector('.tcard')
    const title = row?.querySelector('.tcard__title')?.textContent
    row?.querySelector('.tcard__check')?.click()
    return title
  })()
`)
await wait(1200)
report.afterTick = await board()
/* The row it ticked is still drawn, and it is now finished: `ticked` holds it, because ticking raises
   no toast and a row leaving the list on contact reports nothing at all. */
report.tickedRowStillDrawn = Boolean(report.afterTick.titles?.includes(report.tickedTitle))
await shot('ticked')

report.logs = logs
console.log(JSON.stringify(report, null, 2))

ws.close()
brave.kill()
