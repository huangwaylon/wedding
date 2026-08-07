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
 * @returns {{percent:number, timePercent:number, state:string,
 *            startMs:number, endMs:number, scheduled:boolean}}
 *   percentages are 0–1
 */
export function taskProgress(task, nowMs, timeZone) {
  const scheduled = isValidWall(task?.start) && isValidWall(task?.end)
  const startMs = scheduled ? wallToInstant(task.start, timeZone) : NaN
  const endMs = scheduled ? wallToInstant(task.end, timeZone) : NaN
  const done = isDone(task)

  if (!scheduled) {
    return {
      percent: done ? 1 : 0,
      timePercent: done ? 1 : 0,
      state: done ? STATE.DONE : STATE.UNSCHEDULED,
      startMs,
      endMs,
      scheduled,
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
    percent: done ? 1 : timePercent,
    timePercent,
    state,
    startMs,
    endMs,
    scheduled,
  }
}

/**
 * Attach progress to every live task, sorted for display.
 *
 * Sorted by start ascending, then by end, then by title — a stable order that
 * matches how the plan is read ("what is coming next"). Unscheduled tasks sort
 * last: they have no place on a timeline, and putting them first would bury the
 * thing happening this week.
 */
export function withProgress(tasks, nowMs, timeZone) {
  return tasks
    .filter(isLive)
    .map((task) => ({ ...task, progress: taskProgress(task, nowMs, timeZone) }))
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
 * @param {Array} tasks live tasks WITH `progress` attached (`withProgress`)
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
     * How far the headline sits ahead of where the clock alone would put it — which is
     * to say, how much was finished EARLY. Only ever positive or zero: finishing late
     * cannot show up here, because a task whose window has run out contributes 1 to
     * both sums. That is why `paceLabel` takes the overdue count as well.
     */
    pace: total ? percentSum / total - expectedSum / total : 0,
  }
}

/** Anything past this reads as genuinely ahead rather than rounding. */
export const PACE_DEAD_BAND = 0.02

/**
 * The one-line verdict, and the reason it needs two arguments.
 *
 * `pace` can only ever be positive: an overdue task counts as 100% elapsed in the
 * headline AND 100% elapsed in the reference, so lateness cancels out of the
 * subtraction entirely. A version of this that took `pace` alone therefore reported
 * "On schedule" for a board with eight tasks past their date, which is the most
 * misleading thing this app could say.
 *
 * So being BEHIND is decided by the only hard evidence of it there is — a window that
 * ran out unfinished. Nothing else can prove it: a task halfway through its window with
 * no work done is not late, and this app never asks anybody how far along a task is.
 */
export function paceLabel(pace, overdue = 0) {
  if (overdue > 0) return 'behind'
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
