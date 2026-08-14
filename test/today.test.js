/**
 * `src/state/useToday.js` — the app's whole clock.
 *
 * IT CANNOT BE MOUNTED HERE. The suite runs under vitest's `node` environment, so there is no
 * `document` for the effect to listen on and no renderer that would run an effect anyway. What CAN
 * be checked without one is the claim the poll rests on — that a 15-minute wall-clock boundary is
 * the exact instant a date changes in every zone — and that is a real arithmetic fact about IANA
 * offsets rather than a statement about the source. It is measured against `todayIn`, which is the
 * function the hook actually calls.
 *
 * The rest is read as text, with comments stripped: the module explains the timestamp it must not
 * hold and the `setInterval` it must not use, so a raw match would find the prose.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { todayIn } from '../src/lib/time.js'

const source = readFileSync('src/state/useToday.js', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*\n/gm, '')

/** The poll, pinned against the source below rather than imported: the constant is private. */
const POLL_MS = 900_000

const MINUTE_MS = 60_000

/**
 * Zones whose offset is not a whole hour, both DST-observing and not, plus one that shifts by 30
 * minutes rather than 60. If a quarter-hour poll holds for these it holds for every zone.
 */
const ZONES = [
  'UTC',
  'Asia/Tokyo',
  'Asia/Kolkata', // +5:30
  'Asia/Kathmandu', // +5:45
  'Asia/Tehran', // +3:30
  'Australia/Eucla', // +8:45
  'Australia/Lord_Howe', // +10:30, and its DST step is 30 minutes
  'Pacific/Chatham', // +12:45, with DST
  'Pacific/Marquesas', // -9:30
  'America/St_Johns', // -3:30, with DST
  'Europe/London',
]

/** The instant the date changes in `timeZone` inside the 24 hours after `fromMs`, or 0. */
function midnightAfter(timeZone, fromMs) {
  let previous = todayIn(timeZone, fromMs)
  for (let step = 1; step <= 1440; step += 1) {
    const at = fromMs + step * MINUTE_MS
    const day = todayIn(timeZone, at)
    if (day !== previous) return at
    previous = day
  }
  return 0
}

describe('the poll', () => {
  it('is a quarter of an hour', () => {
    // The constant is what the alignment below depends on: every IANA offset is a whole number of
    // quarter-hours, so this is the coarsest poll that still lands ON a zone's midnight rather
    // than up to a quarter of an hour after it.
    expect(source).toMatch(/const POLL_MS = 900_000\b/)
  })

  it('lands exactly on midnight in every zone, including the :45 ones', () => {
    // The claim the interval is chosen for, checked as arithmetic rather than trusted: for each
    // zone the instant its date changes is an exact multiple of the poll, so the timer that fires
    // on that boundary fires at the moment the countdown and every overdue figure change.
    for (const zone of ZONES) {
      for (const window of [Date.UTC(2027, 0, 15), Date.UTC(2027, 6, 15)]) {
        const midnight = midnightAfter(zone, window)
        expect(midnight, `${zone} never changed date`).toBeGreaterThan(0)
        expect(midnight % POLL_MS, `${zone} at ${new Date(window).toISOString()}`).toBe(0)
      }
    }
  })

  it('re-arms on the NEXT boundary rather than a fixed interval from now', () => {
    // `setTimeout` re-armed each fire, never `setInterval`: an interval drifts off the boundary
    // and is throttled hard in a background tab, which leaves a resumed app on a stale date.
    expect(source).toMatch(/setTimeout\(check, POLL_MS - \(at % POLL_MS\) \|\| POLL_MS\)/)
    expect(source).not.toMatch(/setInterval/)
  })

  it('waits a whole poll when it fires ON a boundary, never 0ms', () => {
    // The `|| POLL_MS` half. A 0ms timeout on an exact boundary fires again in the same
    // millisecond, and every fire re-arms — so the tab spins instead of sleeping.
    const nextIn = (at) => POLL_MS - (at % POLL_MS) || POLL_MS
    for (const at of [0, 1, POLL_MS, POLL_MS * 3, POLL_MS + 1, Date.UTC(2027, 3, 18, 9, 7, 13)]) {
      expect(nextIn(at), `at ${at}`).toBeGreaterThan(0)
      expect(nextIn(at), `at ${at}`).toBeLessThanOrEqual(POLL_MS)
      expect((at + nextIn(at)) % POLL_MS, `at ${at}`).toBe(0)
    }
  })
})

describe('what it holds in state', () => {
  it('is the formatted DAY, so React bails out of all but one render a day', () => {
    // A millisecond timestamp re-rendered `App` — and with it the whole list, since nothing below
    // is memoised — once per poll for a value that changes once a day. The state is a day string,
    // so every fire but one sets the same value and React does nothing with it.
    expect(source).toMatch(/useState\(\(\) => todayIn\(timeZone, Date\.now\(\)\)\)/)
    expect(source).toMatch(/setToday\(todayIn\(timeZone, at\)\)/)
    expect(source).not.toMatch(/setToday\(at\)|setNow\(/)
    expect(source).toMatch(/return today\b/)
  })

  it('re-reads the clock when the app comes back, because its timers were frozen', () => {
    // An installed iOS web app resumed from the app switcher does not navigate, so a pending
    // timeout may be hours late — and the pending one is cleared first, or the re-arm doubles up.
    expect(source).toMatch(/visibilitychange/)
    expect(source).toMatch(/clearTimeout\(timer\)\s*\n\s*check\(\)/)
  })

  it('replaced `useNow`, which is gone rather than left beside it', () => {
    // Two clocks in a codebase is one clock nobody removed: the millisecond one is what made the
    // 1440 renders a day, so nothing may import it again.
    const files = ['src/App.jsx', 'src/components/Hero.jsx', 'src/state/useBoard.js']
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/useNow/)
    }
    expect(() => readFileSync('src/state/useNow.js', 'utf8')).toThrow()
  })
})
