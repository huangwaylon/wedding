/**
 * The progress arithmetic. This is the file that decides what every number on screen means,
 * so the cases that matter most are the misleading ones.
 *
 * The one to keep in mind is why there is no pace verdict on screen at all: dates missed and
 * work finished early cancel in the subtraction, so any single figure claiming "on schedule"
 * can be flatly wrong. See the `overallProgress` cases at the foot of this file.
 */

import { describe, expect, it } from 'vitest'
import {
  SOON_DAYS,
  STATE,
  overallProgress,
  partitionSubtasks,
  taskProgress,
  toPercent,
  withProgress,
} from '../src/lib/progress.js'

/** The day every case below is evaluated against. */
const TODAY = '2027-01-06'

function task(overrides = {}) {
  return {
    id: overrides.id ?? 'a',
    title: overrides.title ?? 'Book the venue',
    category: '',
    due: '2027-01-11',
    start: '',
    doneAt: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: '',
    parentId: '',
    ...overrides,
  }
}

/**
 * A dateless checklist item under `parent`. The id is namespaced by the parent and cannot be
 * clobbered by the overrides, which is why they are spread BEFORE the id rather than after.
 */
function sub(parent, overrides = {}) {
  const { id = 's', ...rest } = overrides
  return task({ title: 'Ring the venue', due: '', ...rest, id: `${parent}-${id}`, parentId: parent })
}

const DONE_AT = '2027-01-02T00:00:00.000Z'

describe('taskProgress: what a task is worth', () => {
  it('is 0% until somebody finishes it, whatever the date says', () => {
    // THE RULE AT THE HEART OF THIS MODEL. Nothing may advance a percentage but a tick, so a
    // date that has merely arrived — or passed — is worth exactly nothing.
    expect(taskProgress(task({ due: '2027-01-11' }), TODAY).percent).toBe(0)
    expect(taskProgress(task({ due: '2027-01-01' }), TODAY).percent).toBe(0)
    expect(taskProgress(task({ due: '' }), TODAY).percent).toBe(0)
  })

  it('is 100% once it is ticked', () => {
    expect(taskProgress(task({ doneAt: DONE_AT }), TODAY).percent).toBe(1)
  })

  it('counts subtasks rather than guessing', () => {
    const subs = [sub('a', { id: '1', doneAt: DONE_AT }), sub('a', { id: '2' })]
    expect(taskProgress(task(), TODAY, subs).percent).toBe(0.5)
    expect(taskProgress(task(), TODAY, subs).tally).toEqual({ done: 1, total: 2 })
  })

  it('lets an explicit tick beat an unfinished tally', () => {
    // Somebody ticking a parent with items open is saying "the rest turned out not to be
    // needed". Answering 50% tells them the app knows better.
    const subs = [sub('a', { id: '1' }), sub('a', { id: '2' })]
    expect(taskProgress(task({ doneAt: DONE_AT }), TODAY, subs).percent).toBe(1)
  })

  it('has no tally at all with no subtasks', () => {
    expect(taskProgress(task(), TODAY).tally).toBeNull()
  })

  it('does not make a 5/5 parent done', () => {
    // A parent with every item ticked reads 100% and stays OPEN: closing it would put a task
    // in the done count with an empty done_at cell and no answer to "when was it finished".
    const subs = [sub('a', { id: '1', doneAt: DONE_AT }), sub('a', { id: '2', doneAt: DONE_AT })]
    const progress = taskProgress(task(), TODAY, subs)
    expect(progress.percent).toBe(1)
    expect(progress.state).not.toBe(STATE.DONE)
  })
})

describe('taskProgress: states', () => {
  const stateOf = (due, extra) => taskProgress(task({ due, ...extra }), TODAY).state

  it('is overdue the DAY AFTER the due date, never on it', () => {
    // Overdue compares DAY STRINGS. A task due today is due today, all day, and must not read
    // as late at 00:01 that morning.
    expect(stateOf('2027-01-05')).toBe(STATE.OVERDUE)
    expect(stateOf(TODAY)).toBe(STATE.SOON)
  })

  it('is soon out to the fortnight and later past it', () => {
    expect(stateOf('2027-01-20')).toBe(STATE.SOON)
    expect(stateOf('2027-01-21')).toBe(STATE.LATER)
    expect(SOON_DAYS).toBe(14)
  })

  it('is done regardless of the date', () => {
    expect(stateOf('2026-01-01', { doneAt: DONE_AT })).toBe(STATE.DONE)
    expect(stateOf('', { doneAt: DONE_AT })).toBe(STATE.DONE)
  })

  it('is nodate for a blank or unusable day', () => {
    expect(stateOf('')).toBe(STATE.NODATE)
    expect(stateOf('2027-02-31')).toBe(STATE.NODATE)
    expect(stateOf('sometime')).toBe(STATE.NODATE)
  })

  it('reports the signed distance, which is what a row prints', () => {
    expect(taskProgress(task({ due: '2027-01-09' }), TODAY).days).toBe(3)
    expect(taskProgress(task({ due: '2027-01-03' }), TODAY).days).toBe(-3)
    expect(taskProgress(task({ due: '' }), TODAY).days).toBeNull()
  })
})

describe('taskProgress: duePassed', () => {
  it('is the calendar asking, not the work being done', () => {
    expect(taskProgress(task({ due: '2027-01-05' }), TODAY).duePassed).toBe(true)
    expect(taskProgress(task({ due: TODAY }), TODAY).duePassed).toBe(false)
    // Still true once it is finished: the date passed either way, and that is what makes the
    // mark on the overall meter a reference rather than a copy of the fill.
    expect(taskProgress(task({ due: '2027-01-05', doneAt: DONE_AT }), TODAY).duePassed).toBe(true)
  })

  it('is false for an undated task, which asks nothing of anybody', () => {
    expect(taskProgress(task({ due: '' }), TODAY).duePassed).toBe(false)
  })
})

describe('taskProgress: ongoing', () => {
  const ongoing = (overrides) => taskProgress(task(overrides), TODAY).ongoing

  it('is false without a start date, which is most tasks', () => {
    // The field is optional and the plan must look exactly as it did for a board that never uses
    // it: no start date, no section, nothing lifted out of its month.
    expect(ongoing({})).toBe(false)
    expect(ongoing({ start: '' })).toBe(false)
  })

  it('starts ON the start day, not the morning after it', () => {
    // A day-string comparison, like overdue, and inclusive at this end: a task starting today is
    // today's work. The other boundary is `due < today`, which is exclusive — the two are different
    // questions and are allowed to disagree.
    expect(ongoing({ start: TODAY })).toBe(true)
    expect(ongoing({ start: '2027-01-05' })).toBe(true)
    expect(ongoing({ start: '2027-01-07' })).toBe(false)
  })

  it('is false once the task is done, and false once it is late', () => {
    // Both louder claims. A finished task is not in progress, and a task past its date is drawn as
    // past its date — a row may only be in one section, or the same task reads as two.
    expect(ongoing({ start: '2027-01-01', doneAt: DONE_AT })).toBe(false)
    expect(ongoing({ start: '2027-01-01', due: '2027-01-05' })).toBe(false)
    expect(ongoing({ start: '2027-01-01', due: '2027-01-11' })).toBe(true)
    // Due today is not late, so it is still ongoing.
    expect(ongoing({ start: '2027-01-01', due: TODAY })).toBe(true)
  })

  it('reads a start cell somebody typed a clock time into, and ignores an impossible one', () => {
    // `readCell` hands the anonymous read '2027-01-01T00:00', and a hand-edited cell can hold
    // anything at all. One means that day; the other means no start date, never a crash.
    expect(ongoing({ start: '2027-01-01T00:00' })).toBe(true)
    expect(ongoing({ start: '2027-02-31' })).toBe(false)
    expect(ongoing({ start: 'next week' })).toBe(false)
  })

  it('is not a state, so the five states and their counts are untouched', () => {
    // A sixth state would have made a task overdue OR ongoing and moved a row out of the overdue
    // count; `ongoing` is orthogonal to all five and is only ever asked which section to draw in.
    const started = taskProgress(task({ start: '2027-01-01' }), TODAY)
    expect(started.state).toBe(STATE.SOON)
    expect(Object.values(STATE)).not.toContain('ongoing')
  })
})

describe('partitionSubtasks', () => {
  it('nests exactly one level', () => {
    const { parents, children } = partitionSubtasks([task({ id: 'p' }), sub('p')])
    expect(parents.map((row) => row.id)).toEqual(['p'])
    expect(children.get('p').map((row) => row.id)).toEqual(['p-s'])
  })

  it('PROMOTES rather than hides anything it cannot place', () => {
    // A silently hidden task is the worst thing this app could do: it would vanish from the
    // board with no error and quietly shrink the roll-up's denominator.
    const grandchild = task({ id: 'g', parentId: 'p-s' })
    const orphan = task({ id: 'o', parentId: 'gone' })
    const selfParent = task({ id: 'x', parentId: 'x' })
    const rows = [task({ id: 'p' }), sub('p'), grandchild, orphan, selfParent]
    const { parents } = partitionSubtasks(rows)
    expect(parents.map((row) => row.id).sort()).toEqual(['g', 'o', 'p', 'x'])
  })

  it('promotes a child whose parent is tombstoned', () => {
    const rows = [task({ id: 'p', deletedAt: DONE_AT }), sub('p')]
    const { parents } = partitionSubtasks(rows)
    expect(parents.map((row) => row.id)).toEqual(['p-s'])
  })

  it('walks a two-cycle without recursing', () => {
    const rows = [task({ id: 'a', parentId: 'b' }), task({ id: 'b', parentId: 'a' })]
    expect(partitionSubtasks(rows).parents.map((row) => row.id).sort()).toEqual(['a', 'b'])
  })

  it('drops tombstoned rows entirely', () => {
    const rows = [task({ id: 'p' }), sub('p', { id: 'gone', deletedAt: DONE_AT })]
    const { parents, children } = partitionSubtasks(rows)
    expect(parents.map((row) => row.id)).toEqual(['p'])
    expect(children.has('p')).toBe(false)
  })
})

describe('withProgress', () => {
  it('sorts by due date, undated last', () => {
    const rows = [
      task({ id: 'c', due: '2027-03-01' }),
      task({ id: 'none', due: '' }),
      task({ id: 'a', due: '2027-01-01' }),
      task({ id: 'b', due: '2027-02-01' }),
    ]
    expect(withProgress(rows, TODAY).map((row) => row.id)).toEqual(['a', 'b', 'c', 'none'])
  })

  it('breaks a tie on the title', () => {
    const rows = [
      task({ id: 'z', title: 'Zebra', due: '2027-01-01' }),
      task({ id: 'a', title: 'Apple', due: '2027-01-01' }),
    ]
    expect(withProgress(rows, TODAY).map((row) => row.id)).toEqual(['a', 'z'])
  })

  it('returns top-level rows only, each carrying its own subtasks', () => {
    const rows = [task({ id: 'p' }), sub('p', { id: '1' }), sub('p', { id: '2' })]
    const shown = withProgress(rows, TODAY)
    expect(shown).toHaveLength(1)
    expect(shown[0].subtasks.map((row) => row.id)).toEqual(['p-1', 'p-2'])
  })

  it('orders a checklist the way it was typed', () => {
    const rows = [
      task({ id: 'p' }),
      sub('p', { id: '2', createdAt: '2027-01-02T00:00:00.000Z' }),
      sub('p', { id: '1', createdAt: '2027-01-01T00:00:00.000Z' }),
    ]
    expect(withProgress(rows, TODAY)[0].subtasks.map((row) => row.id)).toEqual(['p-1', 'p-2'])
  })

  it('flags a promoted row, so the UI can withhold what it cannot store', () => {
    // "Has a parentId" and "is a subtask" stop being the same question here. A child of a
    // promoted row would be a grandchild, promoted again on the next read.
    const shown = withProgress([task({ id: 'o', parentId: 'gone' })], TODAY)
    expect(shown[0].promoted).toBe(true)
    expect(withProgress([task({ id: 'p' })], TODAY)[0].promoted).toBe(false)
  })
})

describe('overallProgress', () => {
  const roll = (rows) => overallProgress(withProgress(rows, TODAY))

  it('is the mean of the tasks, countable by hand', () => {
    const rows = [
      task({ id: 'a', doneAt: DONE_AT }),
      task({ id: 'b', doneAt: DONE_AT }),
      task({ id: 'c' }),
      task({ id: 'd' }),
    ]
    const overall = roll(rows)
    expect(overall.total).toBe(4)
    expect(overall.done).toBe(2)
    expect(toPercent(overall.percent)).toBe(50)
  })

  it('weights every TOP-LEVEL task equally, whatever its checklist', () => {
    // Decomposing one task more finely must not change what the rest of the board is worth.
    // A parent with ten subtasks would otherwise carry eleven twentieths of a ten-task board.
    const plain = [task({ id: 'a', doneAt: DONE_AT }), task({ id: 'b' })]
    const decomposed = [
      task({ id: 'a', doneAt: DONE_AT }),
      task({ id: 'b' }),
      ...Array.from({ length: 9 }, (_, index) => sub('b', { id: `s${index}` })),
    ]
    expect(roll(decomposed).percent).toBeLessThanOrEqual(roll(plain).percent)
    expect(roll(decomposed).total).toBe(2)
  })

  it('counts every state, and the counts sum to the total', () => {
    const rows = [
      task({ id: 'late', due: '2026-12-01' }),
      task({ id: 'soon', due: '2027-01-08' }),
      task({ id: 'later', due: '2027-06-01' }),
      task({ id: 'fin', doneAt: DONE_AT }),
      task({ id: 'none', due: '' }),
    ]
    const overall = roll(rows)
    expect(overall).toMatchObject({ overdue: 1, soon: 1, later: 1, done: 1, nodate: 1, total: 5 })
    expect(overall.overdue + overall.soon + overall.later + overall.done + overall.nodate).toBe(
      overall.total,
    )
  })

  it('reports what the calendar expected separately from what is done', () => {
    // Two dates passed of four, nothing finished: 0% done against 50% expected. Merging the
    // two claims would produce a board reading 50% complete with nothing complete.
    const rows = [
      task({ id: 'a', due: '2026-12-01' }),
      task({ id: 'b', due: '2026-12-02' }),
      task({ id: 'c', due: '2027-06-01' }),
      task({ id: 'd', due: '2027-06-02' }),
    ]
    const overall = roll(rows)
    expect(overall.percent).toBe(0)
    expect(overall.expected).toBe(0.5)
    expect(overall.passed).toBe(2)
  })

  it('does not let a wall of overdue tasks read as a finished plan', () => {
    // Every date passed, nothing done. The headline must say 0% and the fact must be stated
    // separately, which is what `overdue` and `expected` are for.
    const rows = Array.from({ length: 8 }, (_, index) =>
      task({ id: `t${index}`, due: '2026-12-01' }),
    )
    const overall = roll(rows)
    expect(toPercent(overall.percent)).toBe(0)
    expect(overall.overdue).toBe(8)
    expect(overall.expected).toBe(1)
  })

  it('is why there is no pace VERDICT: early work hides missed dates', () => {
    // THE MISLEADING CASE. Two dates passed with nothing done, and two future tasks finished
    // early — so "work done" and "dates passed" are both 50% and any single figure subtracting
    // them reports exactly "on schedule" while two things are late. The screen shows the fill
    // against the mark and states `overdue` on its own, so nothing has to pick a verdict, and
    // this is the test that must fail if a verdict ever appears.
    const rows = [
      task({ id: 'late1', due: '2026-12-01' }),
      task({ id: 'late2', due: '2026-12-02' }),
      task({ id: 'early1', due: '2027-06-01', doneAt: DONE_AT }),
      task({ id: 'early2', due: '2027-06-02', doneAt: DONE_AT }),
    ]
    const overall = roll(rows)
    expect(overall.percent).toBe(overall.expected)
    expect(overall.overdue).toBe(2)
    expect(overall).not.toHaveProperty('pace')
  })

  it('is all zeroes on an empty board rather than NaN', () => {
    const overall = roll([])
    expect(overall).toMatchObject({ total: 0, percent: 0, expected: 0, passed: 0 })
  })
})

describe('toPercent', () => {
  it('rounds to a whole percent and clamps', () => {
    expect(toPercent(0.625)).toBe(63)
    expect(toPercent(-1)).toBe(0)
    expect(toPercent(2)).toBe(100)
    expect(toPercent(Number.NaN)).toBe(0)
  })
})
