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
import Meter from './Meter.jsx'
import StateBadge from './StateBadge.jsx'
import { CheckCircleIcon, CircleIcon, PencilIcon, TrashIcon } from './icons.jsx'

export default function TaskRow({ task, nowWall, canEdit, onToggle, onEdit, onDelete }) {
  const { t, locale } = useT()
  const categoryLabel = useCategoryLabel()
  const { state, percent } = task.progress
  const done = state === STATE.DONE
  const shown = toPercent(percent)

  const range =
    state === STATE.UNSCHEDULED
      ? t('list.unscheduled')
      : formatWallRange(task.start, task.end, {
          allDay: task.allDay,
          locale,
          nowWall,
          dash: t('common.dash'),
        })

  const CheckGlyph = done ? CheckCircleIcon : CircleIcon

  return (
    <li
      className={`task${done ? ' task--done' : ''}${task.pending ? ' task--pending' : ''}`}
    >
      {canEdit ? (
        <button
          type="button"
          className={`task__check${done ? ' task__check--on' : ''}`}
          onClick={() => onToggle(task)}
          aria-pressed={done}
          aria-label={done ? t('list.markNotDone') : t('list.markDone')}
        >
          <CheckGlyph />
        </button>
      ) : (
        <span className={`task__check task__check--static${done ? ' task__check--on' : ''}`}>
          <CheckGlyph />
        </span>
      )}

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
