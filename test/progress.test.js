/**
 * The progress arithmetic. This is the file that decides what every number on screen
 * means, so the cases that matter most are the misleading ones: a window that ran out
 * without being finished, and a roll-up that has to keep "elapsed" and "done" apart.
 */

import { describe, expect, it } from 'vitest'
import {
  PACE_DEAD_BAND,
  STATE,
  overallProgress,
  paceLabel,
  planWindow,
  taskProgress,
  toPercent,
  withProgress,
} from '../src/lib/progress.js'
import { wallToInstant } from '../src/lib/time.js'

const TOKYO = 'Asia/Tokyo'

function task(overrides = {}) {
  return {
    id: overrides.id ?? 'a',
    title: overrides.title ?? 'Book the venue',
    category: '',
    start: '2027-01-01T00:00',
    end: '2027-01-11T00:00',
    allDay: true,
    doneAt: '',
    notes: '',
    owner: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: '',
    ...overrides,
  }
}

const at = (wall) => wallToInstant(wall, TOKYO)

describe('taskProgress', () => {
  it('is 0% and upcoming before the window opens', () => {
    const progress = taskProgress(task(), at('2026-12-25T00:00'), TOKYO)
    expect(progress.percent).toBe(0)
    expect(progress.state).toBe(STATE.UPCOMING)
  })

  it('advances linearly through the window', () => {
    // Ten days wide; day five is half.
    const progress = taskProgress(task(), at('2027-01-06T00:00'), TOKYO)
    expect(progress.percent).toBeCloseTo(0.5, 5)
    expect(progress.state).toBe(STATE.ACTIVE)
  })

  it('reads 100% but OVERDUE once the window has run out unfinished', () => {
    // The single most important case in the app. The percentage is the clock, and the
    // clock has finished — but nothing was done, and the state has to say so, because
    // a bare 100% here would be a lie the UI repeats in the roll-up.
    const progress = taskProgress(task(), at('2027-02-01T00:00'), TOKYO)
    expect(progress.percent).toBe(1)
    expect(progress.state).toBe(STATE.OVERDUE)
  })

  it('pins a done task to 100% while keeping the honest elapsed figure', () => {
    // Marked done on day one of ten: percent is 1, timePercent is still ~0.1, and the
    // gap between them is exactly what the pace marker is drawn from.
    const progress = taskProgress(
      task({ doneAt: '2027-01-02T00:00:00.000Z' }),
      at('2027-01-02T00:00'),
      TOKYO,
    )
    expect(progress.percent).toBe(1)
    expect(progress.timePercent).toBeCloseTo(0.1, 5)
    expect(progress.state).toBe(STATE.DONE)
  })

  it('treats a zero-length window as a milestone, not a division by zero', () => {
    const milestone = task({ start: '2027-04-18T14:00', end: '2027-04-18T14:00' })
    expect(taskProgress(milestone, at('2027-04-18T13:59'), TOKYO).percent).toBe(0)
    expect(taskProgress(milestone, at('2027-04-18T14:01'), TOKYO).percent).toBe(1)
    expect(Number.isFinite(taskProgress(milestone, at('2027-04-18T14:00'), TOKYO).percent)).toBe(
      true,
    )
  })

  it('is unscheduled when either end is unusable', () => {
    for (const broken of [
      task({ start: '' }),
      task({ end: '' }),
      task({ start: '2027-02-31T00:00' }),
    ]) {
      const progress = taskProgress(broken, at('2027-01-06T00:00'), TOKYO)
      expect(progress.state).toBe(STATE.UNSCHEDULED)
      expect(progress.percent).toBe(0)
      expect(progress.scheduled).toBe(false)
    }
  })

  it('lets done win over unscheduled', () => {
    // A task somebody ticked off but never gave dates to is done, not "no dates".
    const progress = taskProgress(
      task({ start: '', end: '', doneAt: '2027-01-02T00:00:00.000Z' }),
      at('2027-01-06T00:00'),
      TOKYO,
    )
    expect(progress.state).toBe(STATE.DONE)
    expect(progress.percent).toBe(1)
  })

  it('reads the window in the BOARD zone, not the runtime one', () => {
    const timed = task({ start: '2027-04-18T09:00', end: '2027-04-18T17:00', allDay: false })
    // 12:00 in Tokyo is 3/8 through a 09:00-17:00 day. Interpreting the same strings in
    // Los Angeles would put this nowhere near 0.375.
    const progress = taskProgress(timed, wallToInstant('2027-04-18T12:00', TOKYO), TOKYO)
    expect(progress.percent).toBeCloseTo(3 / 8, 5)
  })
})

describe('withProgress', () => {
  it('drops tombstoned tasks', () => {
    const rows = [task({ id: 'a' }), task({ id: 'b', deletedAt: '2027-01-01T00:00:00.000Z' })]
    expect(withProgress(rows, at('2027-01-06T00:00'), TOKYO).map((row) => row.id)).toEqual(['a'])
  })

  it('sorts by start, and puts unscheduled last', () => {
    const rows = [
      task({ id: 'late', start: '2027-06-01T00:00', end: '2027-06-02T00:00' }),
      task({ id: 'none', start: '', end: '' }),
      task({ id: 'early', start: '2027-01-01T00:00', end: '2027-01-02T00:00' }),
    ]
    expect(withProgress(rows, at('2027-01-06T00:00'), TOKYO).map((row) => row.id)).toEqual([
      'early',
      'late',
      'none',
    ])
  })
})

describe('overallProgress', () => {
  const now = at('2027-01-06T00:00')

  it('is zero and empty with no tasks', () => {
    const overall = overallProgress([])
    expect(overall.total).toBe(0)
    expect(overall.percent).toBe(0)
    expect(overall.pace).toBe(0)
  })

  it('weights every task equally, regardless of how long it runs', () => {
    // Six months against one day. An equal-weight mean is 50%; a duration-weighted one
    // would be ~99.5% and nobody could reconstruct it by counting.
    const rows = [
      task({ id: 'long', start: '2027-01-01T00:00', end: '2027-07-01T00:00', doneAt: '' }),
      task({
        id: 'short',
        start: '2027-01-01T00:00',
        end: '2027-01-02T00:00',
        doneAt: '2027-01-01T00:00:00.000Z',
      }),
    ]
    const overall = overallProgress(withProgress(rows, at('2027-01-01T00:00'), TOKYO))
    expect(overall.percent).toBeCloseTo(0.5, 3)
  })

  it('counts every state', () => {
    const rows = [
      task({ id: 'done', doneAt: '2027-01-02T00:00:00.000Z' }),
      task({ id: 'overdue', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
      task({ id: 'active' }),
      task({ id: 'upcoming', start: '2027-06-01T00:00', end: '2027-07-01T00:00' }),
      task({ id: 'none', start: '', end: '' }),
    ]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall).toMatchObject({
      total: 5,
      done: 1,
      overdue: 1,
      active: 1,
      upcoming: 1,
      unscheduled: 1,
    })
  })

  it('separates the headline from the on-schedule reference', () => {
    // Two identical ten-day tasks halfway through, one ticked off. The headline is
    // (1 + 0.5) / 2 = 75%; on schedule would be 50%; so 25% ahead.
    const rows = [
      task({ id: 'a', doneAt: '2027-01-06T00:00:00.000Z' }),
      task({ id: 'b' }),
    ]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall.percent).toBeCloseTo(0.75, 5)
    expect(overall.expected).toBeCloseTo(0.5, 5)
    expect(overall.pace).toBeCloseTo(0.25, 5)
    expect(paceLabel(overall.pace, overall.overdue)).toBe('ahead')
  })

  it('reports on-track when nothing has been ticked off yet', () => {
    // Every task at its elapsed fraction and none done: headline and reference are
    // identical, so the app must NOT claim progress against schedule.
    const rows = [task({ id: 'a' }), task({ id: 'b' })]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall.pace).toBeCloseTo(0, 10)
    expect(paceLabel(overall.pace, overall.overdue)).toBe('ontrack')
  })

  it('never calls a rounding difference ahead', () => {
    expect(paceLabel(PACE_DEAD_BAND, 0)).toBe('ontrack')
    expect(paceLabel(PACE_DEAD_BAND + 0.001, 0)).toBe('ahead')
  })

  it('calls a board with anything overdue BEHIND, whatever the arithmetic says', () => {
    // The bug this pins. An overdue task counts as 100% elapsed in the headline and 100%
    // in the reference, so it cancels out of `pace` entirely — a version of paceLabel
    // that took pace alone said "On schedule" for a board with eight tasks past their
    // date. Overdue is the only hard evidence of lateness there is.
    const rows = [
      task({ id: 'late', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
      task({ id: 'early', doneAt: '2027-01-02T00:00:00.000Z' }),
    ]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall.overdue).toBe(1)
    expect(paceLabel(overall.pace, overall.overdue)).toBe('behind')
  })

  it('lets overdue outrank a genuinely early finish', () => {
    // Being ahead on one thing does not stop another from being late, and the label has
    // to name the problem rather than average it away.
    const rows = [
      task({ id: 'late', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
      ...Array.from({ length: 9 }, (_, index) =>
        task({ id: `done${index}`, doneAt: '2027-01-02T00:00:00.000Z' }),
      ),
    ]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall.pace).toBeGreaterThan(PACE_DEAD_BAND)
    expect(paceLabel(overall.pace, overall.overdue)).toBe('behind')
  })

  it('does not let a wall of overdue tasks read as a finished plan', () => {
    // Everything overdue, nothing done: the headline is 100% because the clock says so,
    // and the overdue count is the only thing standing between that and a lie. Both
    // have to be true at once, which is exactly why the UI shows them together.
    const rows = [
      task({ id: 'a', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
      task({ id: 'b', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
    ]
    const overall = overallProgress(withProgress(rows, now, TOKYO))
    expect(overall.percent).toBe(1)
    expect(overall.done).toBe(0)
    expect(overall.overdue).toBe(2)
  })
})

describe('planWindow', () => {
  it('always contains now, so the today line is never off the edge', () => {
    const rows = withProgress(
      [task({ start: '2027-01-01T00:00', end: '2027-02-01T00:00' })],
      at('2028-01-01T00:00'),
      TOKYO,
    )
    const window = planWindow(rows, at('2028-01-01T00:00'))
    expect(window.min).toBeLessThanOrEqual(at('2027-01-01T00:00'))
    expect(window.max).toBeGreaterThanOrEqual(at('2028-01-01T00:00'))
  })

  it('never has a zero span', () => {
    const now = at('2027-01-01T00:00')
    const window = planWindow([], now)
    expect(window.span).toBeGreaterThan(0)
  })

  it('ignores unscheduled tasks', () => {
    const now = at('2027-01-01T00:00')
    const rows = withProgress([task({ start: '', end: '' })], now, TOKYO)
    expect(planWindow(rows, now).span).toBeGreaterThan(0)
  })
})

describe('toPercent', () => {
  it('rounds to a whole percent and clamps', () => {
    expect(toPercent(0)).toBe(0)
    expect(toPercent(0.5)).toBe(50)
    expect(toPercent(0.005)).toBe(1)
    expect(toPercent(1)).toBe(100)
    expect(toPercent(2)).toBe(100)
    expect(toPercent(-1)).toBe(0)
    expect(toPercent(Number.NaN)).toBe(0)
  })
})
