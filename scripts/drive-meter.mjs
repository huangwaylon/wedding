/**
 * Checks the progress strip in a real browser: BRAVE, over CDP. Two claims, neither of which a static
 * render can make — the first needs the running app's own board, the second needs layout.
 *
 *   accurate   the percentage on screen equals the mean this file recomputes from the endpoint's
 *              rows, done -> 1 and otherwise the subtask tally, top-level rows only
 *   one series the track holds the fill and nothing else: no tick, no second positioned child
 *
 * Same ways of verifying nothing as `drive.mjs`: a browser left on the port is attached to instead,
 * so the page-target count is the check. Port 9336, so all three drivers can run at once.
 *
 *   1. node scripts/stub-endpoint.mjs
 *   2. npx vite --port 5199 --strictPort --host 127.0.0.1
 *   3. cp scripts/drive-meter.mjs /tmp/cdp-meter.mjs && node /tmp/cdp-meter.mjs
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const URL = `http://localhost:5199/wedding/#k=${'a'.repeat(64)}`
const PROFILE = `/tmp/cdp-meter-profile-${process.pid}`

const brave = spawn(BRAVE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9336', `--user-data-dir=${PROFILE}`,
  '--window-size=393,900', 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2500)

const list = await (await fetch('http://127.0.0.1:9336/json/list')).json()
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
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL })
await wait(3500)

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (out.result?.exceptionDetails) return { error: out.result.exceptionDetails.text }
  return out.result?.result?.value
}

const report = {}

/* What the strip says, and what the track actually holds. `.meter` has exactly one element child —
   the fill — and the fill's rect is measured against the track's: a percentage in the style attribute
   is not a width until layout agrees. */
report.strip = await evaluate(`
  (() => {
    const meter = document.querySelector('.meter')
    const fill = meter?.querySelector('.meter__fill')
    const track = meter?.getBoundingClientRect()
    const fillBox = fill?.getBoundingClientRect()
    return {
      percentText: document.querySelector('.hero__percent')?.textContent,
      tally: document.querySelector('.hero__tally')?.textContent,
      valueNow: meter?.getAttribute('aria-valuenow'),
      valueText: meter?.getAttribute('aria-valuetext'),
      role: meter?.getAttribute('role'),
      childCount: meter?.children.length,
      childClasses: [...(meter?.children ?? [])].map((n) => n.className),
      drawnPercent: track && fillBox ? Math.round((fillBox.width / track.width) * 100) : null,
      taller: fillBox && track ? Math.round(fillBox.height - track.height) : null,
    }
  })()
`)

/* THE ACCURACY CHECK: the mean recomputed here from the endpoint's own rows, in this file's arithmetic
   rather than the app's, so a wrong denominator or a subtask counted as a task shows up as a
   disagreement. Done -> 1, else the share of live subtasks ticked, else 0; top-level rows only. */
report.recomputed = await evaluate(`
  fetch('/wedding/__endpoint').then((r) => r.json()).then((board) => {
    const live = board.tasks.filter((t) => !t.deleted_at)
    const topIds = new Set(live.filter((t) => !t.parent_id).map((t) => t.id))
    const top = live.filter((t) => !t.parent_id || !topIds.has(t.parent_id))
    const percents = top.map((t) => {
      if (t.done_at) return 1
      const kids = live.filter((c) => c.parent_id === t.id && topIds.has(t.id))
      if (!kids.length) return 0
      return kids.filter((c) => c.done_at).length / kids.length
    })
    const mean = percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : 0
    return {
      tasks: top.length,
      done: top.filter((t) => t.done_at).length,
      percent: Math.round(mean * 100),
    }
  })
`)

report.figureMatchesTheBoard =
  report.strip?.percentText === `${report.recomputed?.percent}%` &&
  report.strip?.valueNow === String(report.recomputed?.percent)
report.barMatchesTheFigure = report.strip?.drawnPercent === report.recomputed?.percent
report.trackHoldsOnlyTheFill =
  report.strip?.childCount === 1 && report.strip?.childClasses?.[0] === 'meter__fill'
report.logs = logs

const out = await send('Page.captureScreenshot', { clip: { x: 0, y: 0, width: 393, height: 200, scale: 2 } })
writeFileSync('/tmp/meter-strip.png', Buffer.from(out.result.data, 'base64'))

console.log(JSON.stringify(report, null, 2))
ws.close()
brave.kill()
