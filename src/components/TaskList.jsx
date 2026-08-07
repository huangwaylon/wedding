/**
 * The list, grouped by the month a task starts in.
 *
 * Grouped by month rather than by state because a plan is read forwards — "what is
 * coming up" — and because a state grouping reshuffles the whole list every time
 * something is ticked off, which loses the reader's place. The filter chips are
 * where state slicing lives instead.
 *
 * Tasks with no usable window collect in a final group. They sort last (see
 * `withProgress`), so putting them anywhere else would bury the month in progress.
 */

import { STATE } from '../lib/progress.js'
import { formatWallMonth } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import TaskRow from './TaskRow.jsx'

/**
 * `withProgress` has already sorted, so grouping is a single pass and the groups
 * come out in order — no second sort, and no `Object.keys` ordering assumption.
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

export default function TaskList({ tasks, nowWall, canEdit, expanded, ...handlers }) {
  const { t, locale } = useT()
  const groups = groupByMonth(tasks)

  if (!groups.length) return null

  return (
    <div>
      {groups.map((group) => (
        <section className="group" key={group.key || 'unscheduled'}>
          <div className="group__head">
            <h3 className="group__title">
              {group.key
                ? formatWallMonth(`${group.key}-01T00:00`, { locale })
                : t('list.unscheduled')}
            </h3>
            <span className="group__rule" aria-hidden="true" />
          </div>
          <ul className="tasks">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                nowWall={nowWall}
                canEdit={canEdit}
                expanded={Boolean(expanded?.has(task.id))}
                {...handlers}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
