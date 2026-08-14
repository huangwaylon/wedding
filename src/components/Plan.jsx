/**
 * The plan: every task as a row, grouped by the month it is due in. Grouped by month, not state — a
 * state grouping reshuffles the board on every tick and loses the reader's place, and state slicing
 * lives in the filter chips.
 *
 * The sticky month heading names the month, which lets a row print a bare day number, and carries
 * the month's OWN TALLY — `3/9` answers "am I done with April", which neither the board's
 * percentage nor any row can. The `Today` line is a BOUNDARY: one line between two rows, where what
 * has passed meets what has not. Both are withheld while a filter is on, a slice of a month not
 * being a month and a list with holes being unable to claim that everything below a line is still
 * ahead.
 *
 * An accordion suits a phone, opening in place keeping the neighbouring rows and the heading
 * visible while a date is changed. Nothing here draws a subtask — no date means no position in a
 * sequence of dates, so a checklist reaches its parent as a `3/5` tally.
 */

import React from 'react'
import { STATE } from '../lib/progress.js'
import { firstOfMonth, formatDayMonth, monthOf } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import TaskCard from './TaskCard.jsx'

/** `withProgress` has already sorted, so grouping is one pass and the groups come out in order: no
    second sort, no `Object.keys` ordering assumption. Undated tasks collect in a final group,
    sorting last, and the tally accumulates here, this pass already walking every task. */
function groupByMonth(tasks) {
  const groups = []
  let current = null
  for (const task of tasks) {
    const key = task.progress.state === STATE.NODATE ? '' : monthOf(task.due)
    if (!current || current.key !== key) {
      current = { key, tasks: [], done: 0 }
      groups.push(current)
    }
    current.tasks.push(task)
    if (task.progress.state === STATE.DONE) current.done += 1
  }
  return groups
}

/** The id of the row the `Today` line goes above: the first dated task due today or later. `null`
    unless there are tasks on BOTH sides, which is what makes it a boundary — above the first row of
    an all-future board it states nothing, and an all-past board has nothing for it to sit above. */
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
 * @param {boolean} [props.unfiltered] false while a filter is on, suppressing both whole-month
 *   figures: a tally over the overdue slice of April would read "0/3 done" about a month nine
 *   tasks long and mostly finished.
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
          {/* The rule beneath is what makes this read as a sign rather than a floating label. */}
          <h2
            className={`plan__month${group.key && group.key === weddingMonth ? ' plan__month--day' : ''}`}
          >
            {group.key ? formatDayMonth(firstOfMonth(group.key), { locale }) : t('state.nodate')}
            {group.key && group.key === weddingMonth ? (
              <span className="plan__day">{t('plan.theDay')}</span>
            ) : null}
            {/* `aria-hidden`, and never coloured: every row states its own state and the header
                strip the same arithmetic, so "3 slash 9" inside a heading is worse than silence. */}
            {unfiltered ? (
              <span className="plan__tally tnum" aria-hidden="true">
                {group.done}/{group.tasks.length}
              </span>
            ) : null}
          </h2>
          {group.tasks.map((task) => (
            <React.Fragment key={task.id}>
              {/* One per board, BETWEEN rows rather than on one, so the one-coloured-mark-per-row
                  rule is untouched. */}
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
