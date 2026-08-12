/**
 * The plan: every task as a card on one vertical spine, grouped by the month it starts in.
 *
 * GROUPED BY MONTH, NOT BY STATE, because a plan is read forwards — "what is coming up" —
 * and a state grouping reshuffles the whole board every time something is ticked off, which
 * loses the reader's place. State slicing lives in the filter chips instead.
 *
 * AN ACCORDION IS THE RIGHT SHAPE FOR A PHONE, and the reasoning is about how much of a task
 * fits in 393px. Everything worth scanning — when it starts, what it is, how far along it is
 * — fits one collapsed row; everything worth editing does not fit any row at all. A separate
 * screen or a sheet for the second half costs a navigation each way and puts the fields
 * somewhere the surrounding month is invisible, so the plan and the work on it are never on
 * screen together. Opening in place keeps the neighbouring cards, the month heading and the
 * card's own progress visible while its dates are being changed, and a tap closes it again
 * with nothing to save and nothing to lose. One card is open at a time in practice, so the
 * board's height is the collapsed height plus one.
 *
 * THE SPINE RUNS THROUGH THE NODES. Each card draws its own segment and reaches into the gap
 * below it, so the segments meet and twelve cards read as one sequence of dates rather than
 * twelve separate objects. Drawn per card rather than once per group deliberately: a single
 * line spanning the group would run behind the month heading, and masking it there would
 * depend on the heading's own background matching whatever the tab is painted on.
 *
 * NOTHING HERE DRAWS A SUBTASK AS A BAR. A subtask has a title and a tick and no dates at
 * all, so it has neither a position in time nor an extent, and any bar drawn for one would
 * assert a window the model does not contain. It gets a row in its parent's checklist, and
 * the parent gets a `3/5` tally beside its fill — the honest pair, and the only reason the
 * reader can tell a tallied fill is a count rather than a clock reading.
 */

import { STATE } from '../lib/progress.js'
import { formatWallMonth } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import TaskCard from './TaskCard.jsx'

/**
 * `withProgress` has already sorted, so grouping is a single pass and the groups
 * come out in order — no second sort, and no `Object.keys` ordering assumption.
 *
 * Tasks with no usable window collect in a final group. They sort last, so putting them
 * anywhere else would bury the month in progress.
 */
function groupByMonth(tasks) {
  const groups = []
  let current = null
  for (const task of tasks) {
    const key = task.progress.state === STATE.UNSCHEDULED ? '' : task.start.slice(0, 7)
    if (!current || current.key !== key) {
      current = { key, tasks: [] }
      groups.push(current)
    }
    current.tasks.push(task)
  }
  return groups
}

export default function Timeline({ tasks, expanded, onExpand, ...cardProps }) {
  const { t, locale } = useT()
  const groups = groupByMonth(tasks)

  // Nothing rather than an empty shell: the caller owns what an empty board says.
  if (!groups.length) return null

  return (
    <div className="plan">
      {groups.map((group) => (
        <section className="plan__group" key={group.key || 'unscheduled'}>
          <h2 className="plan__month">
            {group.key
              ? formatWallMonth(`${group.key}-01T00:00`, { locale })
              : t('list.unscheduled')}
          </h2>
          {group.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              open={Boolean(expanded?.has(task.id))}
              onOpen={onExpand}
              {...cardProps}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
