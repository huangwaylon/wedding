/**
 * One task. The row every other surface is a frame around.
 *
 * The percentage is TEXT beside the bar, not a label on it: at 13px it does not fit
 * inside an 8px fill, and the dataviz rule is that a label which will not fit moves
 * outside the mark rather than being clipped. The state is a badge with a written
 * word for the same reason — a fill's colour and length are not something anybody
 * reads precisely.
 *
 * A viewer gets the same row, minus the controls, with the check rendered as a
 * static glyph in the same slot. That keeps a planner's list aligned exactly like
 * an editor's instead of shifting 36px when the buttons disappear.
 */

import { STATE, toPercent } from '../lib/progress.js'
import { formatWallRange } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import Meter from './Meter.jsx'
import StateBadge from './StateBadge.jsx'
import SubtaskList from './SubtaskList.jsx'
import { ChevronRightIcon, PencilIcon, TrashIcon } from './icons.jsx'

export default function TaskRow({
  task,
  nowWall,
  canEdit,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onExpand,
  onAddSubtask,
  onSubtaskFocus,
}) {
  const { t, locale } = useT()
  const categoryLabel = useCategoryLabel()
  const { state, percent, tally } = task.progress
  const done = state === STATE.DONE
  const shown = toPercent(percent)
  const subtasks = task.subtasks ?? []

  const range =
    state === STATE.UNSCHEDULED
      ? t('list.unscheduled')
      : formatWallRange(task.start, task.end, {
          allDay: task.allDay,
          locale,
          nowWall,
          dash: t('common.dash'),
        })

  return (
    <li
      className={`task${done ? ' task--done' : ''}${task.pending ? ' task--pending' : ''}`}
    >
      <DoneToggle
        done={done}
        title={task.title}
        canEdit={canEdit}
        onToggle={() => onToggle(task)}
        className="task__check"
      />

      <div className="task__main">
        <p className="task__title">{task.title}</p>
        <p className="task__meta">
          <StateBadge state={state} />
          <span className="tnum">{range}</span>
          {task.category ? (
            <span className="chip chip--static">{categoryLabel(task.category)}</span>
          ) : null}
          {task.owner ? <span className="chip chip--static">{task.owner}</span> : null}
        </p>
        {task.notes ? <p className="task__notes">{task.notes}</p> : null}
      </div>

      {canEdit ? (
        <div className="task__actions">
          <button
            type="button"
            className="btn btn--icon btn--icon-sm"
            onClick={() => onEdit(task)}
            aria-label={t('list.editTask', { title: task.title })}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="btn btn--icon btn--icon-sm"
            onClick={() => onDelete(task)}
            aria-label={t('list.deleteTask', { title: task.title })}
          >
            <TrashIcon />
          </button>
        </div>
      ) : null}

      {/* The disclosure lives on its own grid row spanning from the title column, not as a
          fourth control in row one: at 393px the row already spends 152px on three 44px targets
          and gaps, and a fourth would cut the title to ~130px. Here it is a ~250px target.

          The row only grows when the task actually HAS subtasks, so a freshly seeded 52-task
          board adds no height at all. The first subtask is added from the edit form. */}
      {tally ? (
        <div className="task__subs">
          <button
            type="button"
            className="task__subs-toggle"
            aria-expanded={expanded}
            aria-controls={`subs-${task.id}`}
            onClick={() => onExpand(task.id)}
          >
            <ChevronRightIcon className="task__subs-chevron" />
            {t('list.subtasks', { count: tally.total, done: tally.done })}
          </button>
          {expanded ? (
            <SubtaskList
              id={`subs-${task.id}`}
              subtasks={subtasks}
              canEdit={canEdit}
              onToggle={onToggle}
              onDelete={onDelete}
              onAdd={(title) => onAddSubtask(task, title)}
              onFocusChange={onSubtaskFocus}
            />
          ) : null}
        </div>
      ) : null}

      <div className="task__progress">
        <div className="task__meter">
          <Meter
            value={percent}
            state={state}
            label={task.title}
            valueText={t('list.percentLabel', { percent: shown })}
          />
        </div>
        <span className="task__percent tnum">{shown}%</span>
      </div>
    </li>
  )
}
