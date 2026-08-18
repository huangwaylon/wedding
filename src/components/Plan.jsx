/**
 * The plan: every task as a row. Two sections that answer "what now", then the calendar.
 *
 * PAST DEADLINE and THIS MONTH come first and are lifted out of the calendar. Both are hidden when
 * empty, so a board that is on top of itself is a plain calendar and the sections appear only when
 * they have something to say. Precedence is order: a row past its date is drawn as past its date
 * whatever its start says, and a row is in exactly ONE place — the same task under two headings is
 * two tasks to anybody scanning, and it would make the tallies lie.
 *
 * Below them, MONTHS, not states: a state grouping reshuffles the board on every tick and loses the
 * reader's place, and state slicing lives in the filter chips. The sticky month heading names the
 * month in full, where a row's own date column abbreviates it, and carries the month's OWN TALLY —
 * `3/9` answers "am I done with April", which neither the board's percentage nor any row can, and it
 * counts the WHOLE month including whatever was lifted out of it: April's heading says April. A
 * lifted section carries a bare COUNT instead: every row in one is unfinished by definition, so
 * `done/total` there would read `0/4` forever.
 *
 * There is no "you are here" line any more, and there is no room for one: the two sections ARE where
 * you are, and with the current month hoisted every calendar group below holds either finished months
 * or future ones — so the boundary between past and future always fell exactly at a group heading,
 * which is not "between two rows" and was a line of chrome about chrome. Every whole-group figure is
 * still withheld while a filter is on, a slice of a month not being a month.
 *
 * An accordion suits a phone, opening in place keeping the neighbouring rows and the heading
 * visible while a date is changed. Nothing here draws a subtask — no date means no position in a
 * sequence of dates, so a checklist reaches its parent as a `3/5` tally.
 */

import { STATE } from '../lib/progress.js'
import { firstOfMonth, formatDayMonth, monthOf } from '../lib/time.js'

import { useT } from '../i18n/index.js'
import TaskCard from './TaskCard.jsx'

/**
 * The sections drawn ahead of the calendar, in precedence order: the first one that holds a task
 * takes it. Data rather than two `if`s, so the order, the wording and the test that a row lands in
 * one place are all one list.
 *
 * `month` is the month a section's heading NAMES, and it decides three things: whether the wedding
 * plaque belongs on it, what the heading says beside the state, and whether the rows under it have to
 * state their year — a heading naming a month names its year with it. **Past deadline** names none,
 * its rows spanning whatever months are behind; **This month** names the current one. It decides
 * nothing about a row's month and day: those are the row's own, in the row's own column, so a section
 * is not a context a date has to be read against.
 */
const LIFTED = [
  { key: 'past', label: 'plan.past', month: () => '', holds: (task) => task.progress.state === STATE.OVERDUE },
  {
    key: 'thisMonth',
    label: 'plan.thisMonth',
    month: (today) => monthOf(today),
    holds: (task) => task.progress.thisMonth,
  },
]

/** `withProgress` has already sorted, so grouping is one pass and the groups come out in order: no
    second sort, no `Object.keys` ordering assumption. Undated tasks collect in a final group,
    sorting last.

    THE MONTH TALLY IS COUNTED OVER THE MONTH, not over the rows drawn under the heading: a lifted row
    is still an April task, and April's heading says April. Counting the visible rows instead made
    `1/2` a true statement about a slice and a false one about the month, which is the exact defect the
    figure is withheld under a filter to avoid — and it would have meant lifting a row changed what
    April was worth. It is `aria-hidden` for the same reason: the arithmetic is not the rows below.

    THE TALLY OBJECT IS SHARED WITH THE MAP BY REFERENCE, and that is the whole mechanism: a lifted row
    of a month whose group already exists increments it AFTER the group was built, so the heading keeps
    counting April while drawing a subset of it. Copying it here (`tally: { ...tally }`) reads as the
    tidier line and silently turns every heading into a figure about the rows below it. */
function groupTasks(tasks, today) {
  const lifted = LIFTED.map((section) => ({ ...section, month: section.month(today), tasks: [] }))
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
      current = { key, month: key, tasks: [], tally }
      months.push(current)
    }
    current.tasks.push(task)
  }

  return { lifted: lifted.filter((section) => section.tasks.length), months }
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
  const { lifted, months } = groupTasks(tasks, today)

  // Nothing rather than an empty shell: the caller owns what an empty board says.
  if (!lifted.length && !months.length) return null

  return (
    <div className="plan">
      {[...lifted, ...months].map((group) => {
        /* The plaque follows the MONTH a heading names, not the kind of section it is: on the wedding
           month itself every one of its rows is hoisted into This month, so hanging this off the
           calendar's groups alone would have lost the one mark the whole plan counts down to. */
        const isWeddingMonth = Boolean(group.month) && group.month === weddingMonth
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
              {/* A section names a state, so it says which month that is beside it — otherwise the
                  only date on screen would be the one on each row. A month group needs no aside: its
                  heading IS the month. */}
              {group.label && group.month ? (
                <span className="plan__aside">
                  {formatDayMonth(firstOfMonth(group.month), { locale })}
                </span>
              ) : null}
              {isWeddingMonth ? <span className="plan__aside">{t('plan.theDay')}</span> : null}
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
              <TaskCard
                key={task.id}
                /* FIRST, so nothing a caller happens to pass can overwrite what this component
                   decides below: `cardProps` is everything `Plan` did not destructure, and spread
                   last it would let a stray `today` or `headingMonth` — the two props that decide
                   whether a row states its year — win over the values computed here. */
                {...cardProps}
                task={task}
                open={Boolean(expanded?.has(task.id))}
                onOpen={onExpand}
                /* Neither decides how the row draws its DATE — month and day are its own, in its own
                   column, whatever is above it. Between them they decide one thing: whether the row
                   also states its year, which it does only where neither this heading nor the
                   calendar the reader is living in supplies one. See `TaskCard`. */
                today={today}
                headingMonth={group.month}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}
