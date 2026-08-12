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
 */
function groupByMonth(tasks) {
  const groups = []
  let current = null
  for (const task of tasks) {
    const key = task.progress.state === STATE.NODATE ? '' : task.due.slice(0, 7)
    if (!current || current.key !== key) {
      current = { key, tasks: [] }
      groups.push(current)
    }
    current.tasks.push(task)
  }
  return groups
}

export default function Plan({ tasks, expanded, onExpand, ...cardProps }) {
  const { t, locale } = useT()
  const groups = groupByMonth(tasks)

  // Nothing rather than an empty shell: the caller owns what an empty board says.
  if (!groups.length) return null

  return (
    <div className="plan">
      {groups.map((group) => (
        <section className="plan__group" key={group.key || 'nodate'}>
          <h2 className="plan__month">
            {group.key ? formatDayMonth(`${group.key}-01`, { locale }) : t('state.nodate')}
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
