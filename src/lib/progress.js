/**
 * Progress. Pure, and the only file that decides what a percentage means.
 *
 *   percent    what to draw. done -> 100, else the subtask tally, else 0.
 *   duePassed  whether the calendar has already asked for it. Rolled up as `expected`.
 *
 * Those are different claims over the same denominator and must not be merged: `percent` is work
 * done and is countable, `expected` is the share of dates that have passed. The gap is drawn as a
 * fill against a mark, never worded — five things late plus five future things ticked early sum to
 * a pace of zero, so any single verdict can be flatly wrong.
 *
 * An unfinished task is 0%, whatever the date says: nothing may make a percentage advance without
 * somebody ticking something.
 *
 * Every top-level task counts equally in the roll-up, never weighted by subtask count: decomposing
 * one task more finely must not change what the rest of the board is worth.
 */

import { isDone, isLive } from '../schema.js'
import { daysBetween, isValidDay, monthOf, normalizeDay } from './time.js'

/**
 * How near a due date has to be to count as soon. Two weeks: near enough to be this fortnight's
 * work, far enough that the chip is neither empty nor the whole board. Exported because it is part
 * of the meaning of the state rather than a component's constant.
 */
export const SOON_DAYS = 14

/**
 * Split a flat row list into top-level tasks and the subtasks hanging off them.
 *
 * One level, enforced on the read: a row is a subtask iff its `parentId` names a live row whose own
 * `parentId` is empty. Depth-1 by construction, so it cannot recurse or walk a cycle and needs no
 * visited set. Every state a hand-edited spreadsheet can reach has an answer:
 *
 *   a grandchild      its parent has a parentId, so the parent is not top-level -> promoted
 *   a self-parent     same reasoning, the row is its own non-top-level parent  -> promoted
 *   a two-cycle       neither member is top-level                              -> both promoted
 *   an orphan         the parent is tombstoned, so not live                    -> promoted
 *   a dangling id     names nothing                                            -> promoted
 *
 * Promoted, never hidden: dropping an unplaceable row would make a task vanish with no error and
 * shrink the roll-up's denominator.
 */
export function partitionSubtasks(tasks) {
  const live = tasks.filter(isLive)
  const topLevel = new Set()
  for (const task of live) if (!task.parentId) topLevel.add(task.id)

  const parents = []
  const children = new Map()
  for (const task of live) {
    if (task.parentId && topLevel.has(task.parentId)) {
      const siblings = children.get(task.parentId)
      if (siblings) siblings.push(task)
      else children.set(task.parentId, [task])
    } else {
      parents.push(task)
    }
  }
  return { parents, children }
}

/**
 * A checklist is read in the order it was typed. `createTasks` stamps one timestamp per batch, so
 * ties fall back to sheet order via `Array.sort`'s stability.
 */
function byCreated(a, b) {
  if (a.createdAt === b.createdAt) return 0
  return a.createdAt < b.createdAt ? -1 : 1
}

export const STATE = {
  DONE: 'done',
  OVERDUE: 'overdue',
  /** Due within `SOON_DAYS`, today included. This fortnight's work. */
  SOON: 'soon',
  LATER: 'later',
  /** No usable date. Counted in the total, contributes 0 unless done. */
  NODATE: 'nodate',
}

/** Display order, and the order the filter chips appear in. Problems first. */
export const STATE_ORDER = [STATE.OVERDUE, STATE.SOON, STATE.LATER, STATE.DONE]

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * @param {object} task as returned by `rowToTask`
 * @param {string} today the board's current day, 'YYYY-MM-DD' (`time.todayIn`)
 * @param {object[]} [subtasks] this task's LIVE subtasks, if any
 * @returns {{percent:number, duePassed:boolean, state:string, dated:boolean, thisMonth:boolean,
 *   days:number|null, tally:{done:number,total:number}|null}} `percent` is 0–1; `days` is signed
 *   calendar days until the due date
 */
export function taskProgress(task, today, subtasks = []) {
  const dated = isValidDay(task?.due)
  const done = isDone(task)
  const days = dated ? daysBetween(today, task.due) : null

  /**
   * The subtask tally. Ticking is a count rather than an estimate; this app never asks how far
   * along a task is. Live subtasks only, filtered by `partitionSubtasks`, so a parent whose
   * subtasks are all tombstoned reads 0%.
   */
  const total = subtasks.length
  const tally = total ? { done: subtasks.filter(isDone).length, total } : null

  /**
   * Precedence: `done_at` > the subtask tally > nothing, and nothing is blended. `done_at` wins as
   * the only explicit human assertion in the model: ticking a parent with two items open says the
   * rest was not needed. "3 of 5 = 60%" is checkable by counting; a blend is not.
   */
  const percent = done ? 1 : clamp01(tally ? tally.done / tally.total : 0)

  let state
  if (done) state = STATE.DONE
  else if (!dated) state = STATE.NODATE
  else if (days < 0) state = STATE.OVERDUE
  else if (days <= SOON_DAYS) state = STATE.SOON
  else state = STATE.LATER

  /**
   * Whether this belongs to the month somebody is in, which is TWO claims:
   *
   *   it is this month's row      the same month as today, finished or not — the current month's
   *                               group, hoisted to the top of the plan rather than sat in the
   *                               calendar, so there is one heading for a month and it is the one
   *                               above the rows people are working through
   *   it is running now           its start day has passed and its date has not come, whatever month
   *                               that date is in: work begun early is this month's work, and it is
   *                               the whole reason `start` is a column
   *
   * Finished is excluded from the SECOND only. A completed row still belongs to its own month, which
   * is how the calendar draws one; a completed row from December is not what is running now.
   *
   * Day strings and month strings, both compared as text — `monthOf` owns the layout, nothing here
   * indexes into a date. The start day counts as started, so a task starting today is on from the
   * morning rather than at midnight, and `normalizeDay` covers a cell somebody typed a clock time
   * into.
   *
   * Not a `STATE`. A state is what the filter chips slice by and what the roll-up counts, and this is
   * orthogonal to all five: a row here is also soon, later or done. It decides one thing — which
   * section of the plan a row is drawn in — and adding a sixth state would have made a task overdue OR
   * current, never both, and moved a row out of the overdue count.
   */
  const start = normalizeDay(task?.start)
  const started = Boolean(start) && start <= today
  const dueThisMonth = dated && monthOf(task.due) === monthOf(today)
  const running = started && !done && dated && days > 0

  return {
    percent,
    /**
     * Whether the calendar has already asked for this one. An undated task asks nothing, so it
     * counts in the denominator and contributes to neither numerator.
     */
    duePassed: dated && days < 0,
    state,
    dated,
    /**
     * Overdue is the louder claim and a row may only be in one section, so anything past its date and
     * unfinished is excluded here; an UNDATED row is excluded too, because it belongs to the group
     * that says so — anybody can empty the cell by hand, and such a row sorting anywhere but last
     * would hide the one thing wrong with it behind a section that reads as progress.
     */
    thisMonth: (dueThisMonth || running) && state !== STATE.OVERDUE && state !== STATE.NODATE,
    days,
    tally,
  }
}

/**
 * Attach progress to every live task, sorted by due date ascending then title. Undated tasks sort
 * last: they have no place in a sequence of dates.
 *
 * Top-level tasks only, each carrying its own `subtasks`. Subtasks are dateless, so sorting them
 * into this list would tear every one away from its parent into a trailing pile.
 */
export function withProgress(tasks, today) {
  const { parents, children } = partitionSubtasks(tasks)
  return parents
    .map((task) => {
      const subtasks = (children.get(task.id) ?? []).slice().sort(byCreated)
      return {
        ...task,
        subtasks,
        /**
         * A row that names a parent and is on this list anyway: `partitionSubtasks` could not place
         * it. The UI has to be able to ask, because "has a `parentId`" and "is a subtask" are
         * different questions here; this row is drawn, counted and rolled up as a task.
         */
        promoted: Boolean(task.parentId),
        progress: taskProgress(task, today, subtasks),
      }
    })
    .sort(compareForDisplay)
}

function compareForDisplay(a, b) {
  if (a.progress.dated !== b.progress.dated) return a.progress.dated ? -1 : 1
  if (a.due !== b.due) return a.due < b.due ? -1 : 1
  return a.title.localeCompare(b.title)
}

/**
 * The headline. `percent` is the mean of every task's `percent`; `expected` is the share whose date
 * has passed. Same denominator, two claims, drawn as a fill against a mark.
 *
 * No pace verdict: five tasks past their date with nothing done, plus five future tasks ticked
 * early, sums to zero and would read "on schedule" with five things late. `overdue` states the fact
 * on its own.
 *
 * Top-level tasks only, which `withProgress` guarantees: a subtask in this mean would make a parent
 * with ten subtasks carry eleven twentieths of a ten-task board.
 *
 * @param {Array} tasks live top-level tasks with `progress` attached (`withProgress`)
 */
export function overallProgress(tasks) {
  // Every key in `STATE` needs a slot, `nodate` included: the loop indexes this object by state, so
  // a missing key makes the count NaN for the first undated task.
  const counts = { done: 0, overdue: 0, soon: 0, later: 0, nodate: 0 }
  let percentSum = 0
  let passed = 0

  for (const task of tasks) {
    counts[task.progress.state] += 1
    percentSum += task.progress.percent
    if (task.progress.duePassed) passed += 1
  }

  const total = tasks.length
  return {
    total,
    percent: total ? percentSum / total : 0,
    expected: total ? passed / total : 0,
    /** How many dates have already passed, for the mark's accessible wording. */
    passed,
    ...counts,
  }
}

/** 0–1 -> a whole percent, for both display and aria values. */
export function toPercent(fraction) {
  return Math.round(clamp01(fraction) * 100)
}
