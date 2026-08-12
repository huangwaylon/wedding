/**
 * Progress. Pure, and the only file that decides what a percentage means.
 *
 * A task is a title, a day and a tick, so a percentage here is WORK DONE and nothing
 * else:
 *
 *   percent    what to draw. done -> 100, else the subtask tally, else 0.
 *   duePassed  whether the calendar has already asked for it. Rolled up as
 *              `expected`, this is where the fill would sit if everything were
 *              finished exactly on its date — the marker on the overall meter.
 *
 * THOSE TWO ARE DIFFERENT CLAIMS OVER THE SAME DENOMINATOR AND MUST NOT BE MERGED.
 * `percent` is countable — "9 of 14 tasks" — while `expected` is the calendar's
 * opinion, and the gap between them is the whole pace signal: a task done early
 * raises the first and not the second, a date that slipped raises the second and not
 * the first. It is shown as the distance between a fill and a mark and never as a
 * sentence, because a sentence has to pick a verdict and a verdict can be wrong —
 * five things late and five future things ticked early sum to a pace of zero.
 *
 * This is a deliberate correction of an earlier model, where a task's percentage was
 * how far the clock had got between a start and an end. That number reached 100% for
 * a window that had merely run out, so "78% complete" and "78% of the time is gone"
 * were the same figure and the app needed a badge, a mark and an overdue count just
 * to stop the headline lying. An unfinished task is now 0%, whatever the date says,
 * and the headline is a number somebody can check by counting.
 *
 * Every task counts EQUALLY in the roll-up — not weighted by subtask count. "62% of
 * our tasks" is a sentence somebody can check; a weighted average silently makes the
 * one task somebody decomposed into ten worth ten times the rest.
 */

import { isDone, isLive } from '../schema.js'
import { daysBetween, isValidDay } from './time.js'

/**
 * How near a due date has to be to count as SOON. Two weeks: near enough that it is
 * this fortnight's work, far enough that a wedding checklist's chip is not either
 * empty or the whole board. Exported because it is part of the meaning of the state
 * rather than a component's constant.
 */
export const SOON_DAYS = 14

/**
 * Split a flat row list into top-level tasks and the subtasks hanging off them.
 *
 * ONE LEVEL, AND THE READ IS WHAT ENFORCES IT. A row is a subtask iff its `parentId` names a
 * LIVE row whose own `parentId` is empty. That rule is depth-1 by construction, so it cannot
 * recurse, cannot walk a cycle, and needs no visited set or depth counter — and it has an
 * answer for every state a hand-edited spreadsheet can reach:
 *
 *   a grandchild      its parent has a parentId, so the parent is not top-level -> promoted
 *   a self-parent     same reasoning, the row is its own non-top-level parent  -> promoted
 *   a two-cycle       neither member is top-level                              -> both promoted
 *   an orphan         the parent is tombstoned, so not live                    -> promoted
 *   a dangling id     names nothing                                            -> promoted
 *
 * PROMOTED, NEVER HIDDEN. A one-pass "group children under parents" that dropped an
 * unresolvable row would make tasks vanish from the board with no error and quietly shrink the
 * roll-up's denominator. On a wedding checklist a silently hidden task is the worst thing this
 * app could do, so the rule fails open: anything it cannot place is a task.
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
 * The order a checklist is read is the order it was typed. `createMany` stamps one timestamp
 * for a whole batch, so ties fall back to sheet order via `Array.sort`'s stability.
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
 * @returns {{percent:number, duePassed:boolean, state:string, dated:boolean,
 *            days:number|null, tally:{done:number,total:number}|null}}
 *   `percent` is 0–1; `days` is signed calendar days until the due date
 */
export function taskProgress(task, today, subtasks = []) {
  const dated = isValidDay(task?.due)
  const done = isDone(task)
  const days = dated ? daysBetween(today, task.due) : null

  /**
   * The subtask tally, and why it can be trusted where an estimate could not.
   *
   * This app never asks anybody how far along a task is. Ticking a subtask is not an estimate,
   * it is a count — so a tally is the only partial measurement in the model, and it did not
   * have to be asked for.
   *
   * LIVE subtasks only, which `partitionSubtasks` has already filtered. A parent whose subtasks
   * are all tombstoned therefore has no tally and reads 0% until somebody ticks it.
   */
  const total = subtasks.length
  const tally = total ? { done: subtasks.filter(isDone).length, total } : null

  /**
   * PRECEDENCE: `done_at` > the subtask tally > nothing.
   *
   * `done_at` wins because it is the only explicit human assertion in the model — somebody
   * ticking a parent with two items open is saying "the rest turned out not to be needed", and
   * answering 60% tells them the app knows better. Nothing is blended: "3 of 5 = 60%" is a
   * sentence somebody can check by counting.
   */
  const percent = done ? 1 : clamp01(tally ? tally.done / tally.total : 0)

  let state
  if (done) state = STATE.DONE
  else if (!dated) state = STATE.NODATE
  else if (days < 0) state = STATE.OVERDUE
  else if (days <= SOON_DAYS) state = STATE.SOON
  else state = STATE.LATER

  return {
    percent,
    /**
     * Whether the calendar has already asked for this one. An UNDATED task asks nothing of
     * anybody, so it can be neither ahead nor behind — it counts in the denominator and
     * contributes to neither numerator, which is the only honest treatment of a task nobody
     * has committed to a date for.
     */
    duePassed: dated && days < 0,
    state,
    dated,
    days,
    tally,
  }
}

/**
 * Attach progress to every live task, sorted for display.
 *
 * Sorted by due date ascending, then by title — the order the plan is read in ("what is due
 * next"). Undated tasks sort last: they have no place in a sequence of dates, and putting them
 * first would bury the week in progress.
 *
 * TOP-LEVEL TASKS ONLY, each carrying its own `subtasks`. Subtasks are never sorted into this
 * list: they are dateless, so the comparison below would tear every one of them away from its
 * parent into a trailing pile.
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
         * A row that NAMES a parent and is on this list anyway: `partitionSubtasks` could not
         * place it — dangling, cyclic, or a parent that is tombstoned — and promoted it rather
         * than hide it. The UI has to be able to ask, because "has a `parentId`" and "is a
         * subtask" stop being the same question here, and the client's answer is this one: it
         * is being drawn, counted and rolled up as a task.
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
 * The headline. `percent` is the mean of every task's `percent` — the share of the
 * work that is done — and `expected` is the share whose date has already passed. Same
 * denominator, two different claims, and the distance between them is drawn as a fill
 * against a mark.
 *
 * THERE IS NO VERDICT HERE, DELIBERATELY. An earlier version answered "ahead" or
 * "behind" in words, and the words could be wrong: five tasks past their date with
 * nothing done, plus five future tasks ticked early, sums to a pace of exactly zero
 * and read "On schedule". The graphic cannot make that claim, and `overdue` states the
 * fact independently — so the number that could lie was removed rather than patched.
 *
 * TOP-LEVEL TASKS ONLY, which `withProgress` already guarantees. A subtask must never enter
 * this mean: a parent with ten subtasks would otherwise carry eleven twentieths of a ten-task
 * board — one task outweighing nine — and worse, because decomposing a task is a bookkeeping
 * choice rather than a fact about the wedding. Writing more detail into one task would
 * silently deflate every other.
 *
 * @param {Array} tasks live TOP-LEVEL tasks WITH `progress` attached (`withProgress`)
 */
export function overallProgress(tasks) {
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
    /** How many dates have already passed. The mark's own accessible wording needs it. */
    passed,
    ...counts,
  }
}

/** 0–1 -> a whole percent, for both display and aria values. */
export function toPercent(fraction) {
  return Math.round(clamp01(fraction) * 100)
}
