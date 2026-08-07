/**
 * Progress. Pure, and the only file that decides what a percentage means.
 *
 * A task's percentage is where the clock has got to between its start and its
 * end — it advances on its own as time passes, with nobody touching anything.
 * Marking a task done pins it to 100%. Those are two different claims and the UI
 * keeps them apart:
 *
 *   percent      what to draw. done -> 100, otherwise the elapsed fraction.
 *   timePercent  the elapsed fraction regardless of done. This is the PACE
 *                reference: rolled up, it is where you would be if everything
 *                were exactly on schedule, which is what the marker on the
 *                overall meter points at.
 *
 * A window that has run out without being marked done is OVERDUE, and its
 * `percent` is 100 while it is emphatically not complete. That is why `percent`
 * is never the only thing on screen: `overallProgress` reports `done` and
 * `overdue` counts alongside it, and a row states its state in words. A number
 * that reads 100% for both "finished" and "ran out of time" would be the single
 * most misleading thing this app could do.
 *
 * Every task counts EQUALLY in the roll-up — not weighted by duration. "62% of
 * our tasks" is a sentence somebody can check by counting; a duration-weighted
 * average silently makes a six-month venue hunt worth thirty times the cake
 * tasting, and nobody can reconstruct it from the screen.
 */

import { isDone, isLive } from '../schema.js'
import { isValidWall, wallToInstant } from './time.js'

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
  ACTIVE: 'active',
  UPCOMING: 'upcoming',
  /** No usable window. Counted in the total, contributes 0 unless done. */
  UNSCHEDULED: 'unscheduled',
}

/** Display order, and the order the filter chips appear in. */
export const STATE_ORDER = [STATE.OVERDUE, STATE.ACTIVE, STATE.UPCOMING, STATE.DONE]

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * @param {object} task as returned by `rowToTask`
 * @param {number} nowMs
 * @param {string} timeZone the board's zone; task times are wall-clock in it
 * @param {object[]} [subtasks] this task's LIVE subtasks, if any
 * @returns {{percent:number, timePercent:number, state:string, startMs:number, endMs:number,
 *            scheduled:boolean, tally:{done:number,total:number}|null}}
 *   percentages are 0–1
 */
export function taskProgress(task, nowMs, timeZone, subtasks = []) {
  const scheduled = isValidWall(task?.start) && isValidWall(task?.end)
  const startMs = scheduled ? wallToInstant(task.start, timeZone) : NaN
  const endMs = scheduled ? wallToInstant(task.end, timeZone) : NaN
  const done = isDone(task)

  /**
   * The subtask tally, and why it can be trusted where an estimate could not.
   *
   * The header says this app never asks anybody how far along a task is. Ticking a subtask is
   * not an estimate, it is a count — so this is the first real work-done measurement the app
   * has, and it did not have to ask for it.
   *
   * LIVE subtasks only, which `partitionSubtasks` has already filtered. A parent whose subtasks
   * are all tombstoned therefore has no tally and falls back to the clock, exactly as before.
   */
  const total = subtasks.length
  const tally = total ? { done: subtasks.filter(isDone).length, total } : null
  const tallied = tally ? tally.done / tally.total : null

  if (!scheduled) {
    // A task with no schedule cannot be ahead of one, so both figures stay equal and it
    // contributes nothing to the pace in either direction.
    const value = done ? 1 : (tallied ?? 0)
    return {
      percent: value,
      timePercent: value,
      state: done ? STATE.DONE : STATE.UNSCHEDULED,
      startMs,
      endMs,
      scheduled,
      tally,
    }
  }

  // A zero-length window is a milestone — "register the marriage" happens at a
  // moment, not over an interval — so it is 0% until its instant and 100% after,
  // never a division by zero.
  const span = endMs - startMs
  const timePercent =
    span > 0 ? clamp01((nowMs - startMs) / span) : nowMs >= endMs ? 1 : 0

  let state
  if (done) state = STATE.DONE
  else if (nowMs >= endMs) state = STATE.OVERDUE
  else if (nowMs >= startMs) state = STATE.ACTIVE
  else state = STATE.UPCOMING

  return {
    /**
     * PRECEDENCE: `done_at` > the subtask tally > the clock.
     *
     * `done_at` wins because it is the only explicit human assertion in the model — somebody
     * ticking a parent with two items open is saying "the rest turned out not to be needed",
     * and answering 60% tells them the app knows better. The tally beats the clock because it
     * is evidence and the clock is a stand-in for evidence. Nothing is blended: "3 of 5 = 60%"
     * is a sentence somebody can check by counting, and `0.5 × elapsed + 0.5 × tally` is not.
     */
    percent: done ? 1 : (tallied ?? timePercent),
    /** Always the clock. This is the pace reference, and merging it would destroy the signal. */
    timePercent,
    state,
    startMs,
    endMs,
    scheduled,
    tally,
  }
}

/**
 * Attach progress to every live task, sorted for display.
 *
 * Sorted by start ascending, then by end, then by title — a stable order that
 * matches how the plan is read ("what is coming next"). Unscheduled tasks sort
 * last: they have no place on a timeline, and putting them first would bury the
 * thing happening this week.
 *
 * TOP-LEVEL TASKS ONLY, each carrying its own `subtasks`. Subtasks are never sorted into this
 * list: they are dateless, so `compareForDisplay` would tear every one of them away from its
 * parent into a trailing pile.
 */
export function withProgress(tasks, nowMs, timeZone) {
  const { parents, children } = partitionSubtasks(tasks)
  return parents
    .map((task) => {
      // A superset of the old element shape: `subtasks` is added and nothing is removed, so
      // grouping, the timeline's bars and the roll-up all keep working untouched.
      const subtasks = (children.get(task.id) ?? []).slice().sort(byCreated)
      return { ...task, subtasks, progress: taskProgress(task, nowMs, timeZone, subtasks) }
    })
    .sort(compareForDisplay)
}

function compareForDisplay(a, b) {
  if (a.progress.scheduled !== b.progress.scheduled) return a.progress.scheduled ? -1 : 1
  if (a.start !== b.start) return a.start < b.start ? -1 : 1
  if (a.end !== b.end) return a.end < b.end ? -1 : 1
  return a.title.localeCompare(b.title)
}

/**
 * The headline. `percent` is the mean of every task's `percent`; `expected` is
 * the mean of every `timePercent`, which is where that fill would sit if nothing
 * had been finished early or late. The gap between the two is the whole point of
 * showing both — ahead of the marker is ahead of schedule.
 *
 * TOP-LEVEL TASKS ONLY, which `withProgress` already guarantees. A subtask must never enter
 * this mean: a parent with ten subtasks would otherwise carry eleven twentieths of a ten-task
 * board — one task outweighing nine — which is duration weighting wearing a different hat, and
 * worse, because decomposing a task is a bookkeeping choice rather than a fact about the
 * wedding. Writing more detail into one task would silently deflate every other.
 *
 * @param {Array} tasks live TOP-LEVEL tasks WITH `progress` attached (`withProgress`)
 */
export function overallProgress(tasks) {
  const counts = { done: 0, overdue: 0, active: 0, upcoming: 0, unscheduled: 0 }
  let percentSum = 0
  let expectedSum = 0

  for (const task of tasks) {
    counts[task.progress.state] += 1
    percentSum += task.progress.percent
    expectedSum += task.progress.timePercent
  }

  const total = tasks.length
  return {
    total,
    percent: total ? percentSum / total : 0,
    expected: total ? expectedSum / total : 0,
    ...counts,
    /**
     * How far the headline sits ahead of where the clock alone would put it.
     *
     * For a task with no subtasks this is still positive-or-zero: `percent` is
     * `done ? 1 : timePercent`, so an expired unfinished window contributes 1 to both sums and
     * cancels out. That is why `paceLabel` needs the overdue count.
     *
     * A parent WITH subtasks breaks that identity, and deliberately: its `percent` is work done
     * while its `timePercent` is time elapsed, so one trailing its own window drives this
     * NEGATIVE — while the window is still open. That is the app's first prospective lateness
     * signal; overdue only ever fires after a deadline has already passed.
     */
    pace: total ? percentSum / total - expectedSum / total : 0,
  }
}

/** Anything past this reads as genuinely ahead or behind rather than rounding. Symmetric. */
export const PACE_DEAD_BAND = 0.02

/**
 * The one-line verdict, and the reason it still needs two arguments.
 *
 * THE OVERDUE BRANCH IS FIRST AND UNCONDITIONAL. For a task with no subtasks, `pace` cannot go
 * negative — an expired unfinished window counts 100% elapsed in the headline AND in the
 * reference, so lateness cancels out of the subtraction. A version taking `pace` alone reported
 * "On schedule" for a board with eight tasks past their date. That branch is not superseded by
 * anything below it: on a board with no subtasks it is still the only evidence there is.
 *
 * THE NEGATIVE BRANCH IS STRICTLY ADDITIVE, and it exists because subtasks gave the app a
 * work-done measurement it never had. A parent 80% through its window with one of five items
 * ticked contributes 0.2 to the headline and 0.8 to the reference — a negative term, and one
 * that does not need the window to have expired. It is the only warning a planner can act on
 * before a deadline rather than after it.
 */
export function paceLabel(pace, overdue = 0) {
  if (overdue > 0) return 'behind'
  if (pace < -PACE_DEAD_BAND) return 'behind'
  if (pace > PACE_DEAD_BAND) return 'ahead'
  return 'ontrack'
}

/**
 * The span the timeline draws, as instants. Derived from the tasks themselves
 * rather than from the wedding date, because a plan legitimately runs past the
 * wedding (thank-you notes, the honeymoon) and a fixed window would clip them.
 *
 * `now` is included so the "today" line is always inside the drawn range — a
 * timeline whose marker sits off the edge reads as broken.
 */
export function planWindow(tasks, nowMs) {
  let min = nowMs
  let max = nowMs
  for (const task of tasks) {
    if (!task.progress.scheduled) continue
    if (task.progress.startMs < min) min = task.progress.startMs
    if (task.progress.endMs > max) max = task.progress.endMs
  }
  // A plan entirely inside one day would otherwise divide by zero downstream.
  if (max - min < 3_600_000) max = min + 3_600_000
  return { min, max, span: max - min }
}

/** 0–1 -> a whole percent, for both display and aria values. */
export function toPercent(fraction) {
  return Math.round(clamp01(fraction) * 100)
}
