/**
 * The plan: every task as a row, grouped by the month it is due in.
 *
 * GROUPED BY MONTH, NOT BY STATE, because a plan is read forwards — "what is coming up" — and
 * a state grouping reshuffles the whole board every time something is ticked off, which loses
 * the reader's place. State slicing lives in the filter chips instead.
 *
 * THE MONTH HEADING IS STICKY, AND IT IS WHAT REPLACED THE SPINE. An earlier version drew a
 * vertical line through a node on every card to make twelve rows read as one sequence. It cost
 * 24px of the left edge — on a 320pt screen, a tenth of the row — and pinned the node to a
 * magic offset tuned to the date chip's optical centre. A heading that stays on screen says
 * more (it names the month rather than implying continuity), costs nothing horizontally, and is
 * what lets a card print a bare day number instead of restating APR forty times.
 *
 * SO THE HEADING IS ALSO WHERE A MONTH'S OWN FIGURE GOES. It is already the one thing on screen
 * while a month's rows scroll past it, and it was carrying one word. A `3/9` at its trailing edge
 * answers "am I done with April" — which is the unit wedding planning is actually done in, and
 * the one question neither the board's single percentage nor any individual row could answer. The
 * month the wedding falls in says so, once, because a plan that runs to one fixed day should name
 * its last sign.
 *
 * AND THE LIST SAYS WHERE TODAY IS. One line, between two rows, at the boundary between what has
 * passed and what has not. The hero counts down and the tracker carries an on-schedule mark, but
 * the list is the screen people live in and it had no "you are here" at all. Both figures are
 * withheld while a filter is on: a slice of a month is not a month, and a list with holes in it
 * cannot claim that everything below a line is still ahead.
 *
 * AN ACCORDION IS THE RIGHT SHAPE FOR A PHONE, and the reasoning is about how much of a task
 * fits in 393pt. Everything worth scanning — when it is due, what it is, how far along it is —
 * fits one collapsed row; everything worth editing does not fit any row at all. A separate
 * screen or a sheet for the second half costs a navigation each way and puts the fields
 * somewhere the surrounding month is invisible. Opening in place keeps the neighbouring rows,
 * the month heading and the checklist visible while a date is being changed, and a tap closes
 * it again with nothing to save and nothing to lose.
 *
 * NOTHING HERE DRAWS A SUBTASK. A subtask has a title and a tick and no date at all, so it has
 * no position in a sequence of dates; it gets a row in its parent's checklist, and the parent
 * gets a `3/5` tally on its meta line.
 */

import React from 'react'
import { STATE } from '../lib/progress.js'
import { formatDayMonth } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import TaskCard from './TaskCard.jsx'

/**
 * `withProgress` has already sorted, so grouping is a single pass and the groups
 * come out in order — no second sort, and no `Object.keys` ordering assumption.
 *
 * Tasks with no date collect in a final group. They sort last, so putting them anywhere else
 * would bury the month in progress.
 *
 * The tally is accumulated HERE rather than derived later, because this pass is already walking
 * every task and a second one over each group would be the same work done twice.
 */
function groupByMonth(tasks) {
  const groups = []
  let current = null
  for (const task of tasks) {
    const key = task.progress.state === STATE.NODATE ? '' : task.due.slice(0, 7)
    if (!current || current.key !== key) {
      current = { key, tasks: [], done: 0 }
      groups.push(current)
    }
    current.tasks.push(task)
    if (task.progress.state === STATE.DONE) current.done += 1
  }
  return groups
}

/**
 * The id of the row the "Today" line goes above: the first dated task due today or later.
 *
 * `null` unless the boundary has tasks on BOTH sides of it, which is what makes it a boundary. A
 * line above the very first row of a board that is entirely in the future states nothing — and on
 * a board entirely in the past there is nothing for it to sit above at all.
 */
function todayMarker(tasks, today) {
  let past = false
  let next = null
  for (const task of tasks) {
    if (!task.progress.dated) continue
    if (task.due < today) past = true
    else if (!next) next = task.id
  }
  return past ? next : null
}

/**
 * @param {string} props.today the board's day, 'YYYY-MM-DD' — see `App`
 * @param {string} [props.weddingMonth] 'YYYY-MM' of the wedding, so one heading can say so
 * @param {boolean} [props.unfiltered] false while a filter is on, which suppresses both figures
 *   that describe a WHOLE month. A tally counted over the overdue slice of April would read
 *   "0/3 done" about a month that is nine tasks long and mostly finished — a misleading number on
 *   somebody's screen, which is the one defect class this app treats as unacceptable. The Today
 *   line goes with it: a filtered list has holes, so "everything below this is still ahead" stops
 *   being true.
 */
export default function Plan({
  tasks,
  expanded,
  onExpand,
  today,
  weddingMonth,
  unfiltered = true,
  ...cardProps
}) {
  const { t, locale } = useT()
  const groups = groupByMonth(tasks)
  const marker = unfiltered ? todayMarker(tasks, today) : null

  // Nothing rather than an empty shell: the caller owns what an empty board says.
  if (!groups.length) return null

  return (
    <div className="plan">
      {groups.map((group) => (
        <section className="plan__group" key={group.key || 'nodate'}>
          {/* THE SIGN. It names the stretch, and — because it is already the one element that
              stays on screen while the rows pass under it — it is also where a month's own
              progress belongs. The board's tracker gives one figure for four hundred days and a
              row gives its own state; "am I finished with April" is the actual unit of wedding
              planning and nothing answered it. The rule beneath is what makes it read as a sign
              rather than as a floating label. */}
          <h2
            className={`plan__month${group.key && group.key === weddingMonth ? ' plan__month--day' : ''}`}
          >
            {group.key ? formatDayMonth(`${group.key}-01`, { locale }) : t('state.nodate')}
            {group.key && group.key === weddingMonth ? (
              <span className="plan__day">{t('plan.theDay')}</span>
            ) : null}
            {/* aria-hidden: every row states its own state, the tracker states the same
                arithmetic for the board, and "3 slash 9" read out inside a heading is worse than
                silence. It is a scanning aid for the eye. */}
            {unfiltered ? (
              <span className="plan__tally tnum" aria-hidden="true">
                {group.done}/{group.tasks.length}
              </span>
            ) : null}
          </h2>
          {group.tasks.map((task) => (
            <React.Fragment key={task.id}>
              {/* YOU ARE HERE. The hero counts down and the tracker carries an on-schedule mark;
                  the list — the screen people actually live in — had nothing saying where today
                  falls in it. One per board, and it sits BETWEEN rows rather than on one, so the
                  one-coloured-mark-per-row rule is untouched. */}
              {task.id === marker ? (
                <p className="plan__now">
                  <span className="plan__nowLabel">{t('due.today')}</span>
                </p>
              ) : null}
              <TaskCard
                task={task}
                open={Boolean(expanded?.has(task.id))}
                onOpen={onExpand}
                {...cardProps}
              />
            </React.Fragment>
          ))}
        </section>
      ))}
    </div>
  )
}
