/**
 * The plan: every task as a row. Two sections that answer "what now", then the calendar.
 *
 * PAST DEADLINE and ONGOING come first and are lifted out of their months. Both are hidden when
 * empty, so a board that is on top of itself is a plain calendar and the sections appear only when
 * they have something to say. Precedence is order: a row past its date is drawn as past its date
 * whatever its start says, and a row is in exactly ONE place — the same task under two headings is
 * two tasks to anybody scanning, and it would make the tallies lie.
 *
 * Below them, MONTHS, not states: a state grouping reshuffles the board on every tick and loses the
 * reader's place, and state slicing lives in the filter chips. The sticky month heading names the
 * month, which lets a row print a bare day number, and carries the month's OWN TALLY — `3/9` answers
 * "am I done with April", which neither the board's percentage nor any row can, and it counts the
 * WHOLE month including whatever was lifted out of it: April's heading says April. A lifted section
 * carries a bare COUNT instead: every row in one is unfinished by definition, so `done/total` there
 * would read `0/4` forever.
 *
 * The `Today` line is a BOUNDARY: one line between two rows, where what has passed meets what has
 * not. It is measured over the months alone — everything above them is already past or in progress —
 * and both figures are withheld while a filter is on, a slice of a month not being a month and a list
 * with holes being unable to claim that everything below a line is still ahead.
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

/**
 * The sections drawn ahead of the calendar, in precedence order: the first one that holds a task
 * takes it. Data rather than two `if`s, so the order, the wording and the test that a row lands in
 * one place are all one list.
 */
const LIFTED = [
  { key: 'past', label: 'plan.past', holds: (task) => task.progress.state === STATE.OVERDUE },
  { key: 'ongoing', label: 'plan.ongoing', holds: (task) => task.progress.ongoing },
]

/** `withProgress` has already sorted, so grouping is one pass and the groups come out in order: no
    second sort, no `Object.keys` ordering assumption. Undated tasks collect in a final group,
    sorting last.

    THE MONTH TALLY IS COUNTED OVER THE MONTH, not over the rows drawn under the heading: a lifted row
    is still an April task, and April's heading says April. Counting the visible rows instead made
    `1/2` a true statement about a slice and a false one about the month, which is the exact defect the
    figure is withheld under a filter to avoid — and it would have meant lifting a row changed what
    April was worth. It is `aria-hidden` for the same reason: the arithmetic is not the rows below. */
function groupTasks(tasks) {
  const lifted = LIFTED.map((section) => ({ ...section, tasks: [] }))
  const months = []
  const tallies = new Map()
  let current = null

  for (const task of tasks) {
    const key = task.progress.state === STATE.NODATE ? '' : monthOf(task.due)
    const tally = tallies.get(key) ?? { done: 0, total: 0 }
    tally.total += 1
    if (task.progress.state === STATE.DONE) tally.done += 1
    tallies.set(key, tally)

    const section = lifted.find((candidate) => candidate.holds(task))
    if (section) {
      section.tasks.push(task)
      continue
    }
    if (!current || current.key !== key) {
      current = { key, tasks: [], tally }
      months.push(current)
    }
    current.tasks.push(task)
  }

  return { lifted: lifted.filter((section) => section.tasks.length), months }
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
 * @param {boolean} [props.unfiltered] false while a filter is on, suppressing every whole-group
 *   figure: a tally over the overdue slice of April would read "0/3 done" about a month nine tasks
 *   long and mostly finished.
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
  const { lifted, months } = groupTasks(tasks)
  const marker = unfiltered ? todayMarker(months.flatMap((group) => group.tasks), today) : null

  // Nothing rather than an empty shell: the caller owns what an empty board says.
  if (!lifted.length && !months.length) return null

  return (
    <div className="plan">
      {[...lifted, ...months].map((group) => {
        const isWeddingMonth = !group.label && group.key && group.key === weddingMonth
        return (
          <section className="plan__group" key={group.key || 'nodate'}>
            {/* The rule beneath is what makes this read as a sign rather than a floating label. A
                lifted section takes the same recipe and no colour of its own: the rows under it
                already carry the state, and a red heading would be a second claim about each. */}
            <h2 className={`plan__month${isWeddingMonth ? ' plan__month--day' : ''}`}>
              {group.label
                ? t(group.label)
                : group.key
                  ? formatDayMonth(firstOfMonth(group.key), { locale })
                  : t('state.nodate')}
              {isWeddingMonth ? <span className="plan__day">{t('plan.theDay')}</span> : null}
              {/* `aria-hidden`, and never coloured: every row states its own state and the header
                  strip the same arithmetic, so "3 slash 9" inside a heading is worse than silence. A
                  lifted section carries a bare count — every row in one is unfinished by definition,
                  so `done/total` there would read `0/4` for ever. */}
              {unfiltered ? (
                <span className="plan__tally tnum" aria-hidden="true">
                  {group.label
                    ? group.tasks.length
                    : `${group.tally.done}/${group.tally.total}`}
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
        )
      })}
    </div>
  )
}
