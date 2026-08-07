/**
 * One task, read-only, in a sheet.
 *
 * This exists because on a phone a task's dates, percentage and state were reachable by NO
 * gesture at all in timeline view. Both the label's `title` and the bar's `title` — the
 * latter carrying the range, the percent and the state — are dead on touch, there is no
 * hover, and the label gutter truncates a 240px title into 120px. Tapping a row is the
 * gesture iOS users already have for "tell me about this mark", and it answers the whole
 * question rather than just the title.
 *
 * Read-only on purpose. Editing lives behind the pencil in list view, and putting a
 * destructive control one tap from a chart mark somebody was only trying to read is how a
 * task gets deleted by accident.
 */

import { toPercent } from '../lib/progress.js'
import { formatWallRange } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import Meter from './Meter.jsx'
import StateBadge from './StateBadge.jsx'

export default function TaskDetailSheet({ task, nowWall, onClose }) {
  const { t, locale } = useT()
  const categoryLabel = useCategoryLabel()
  const { state, percent } = task.progress
  const shown = toPercent(percent)

  const range = formatWallRange(task.start, task.end, {
    allDay: task.allDay,
    locale,
    nowWall,
    dash: t('common.dash'),
  })

  return (
    <BottomSheet
      /* The title itself, wrapping and un-truncated — the thing the gutter could not show. */
      title={task.title}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <dl className="detail">
        <dt className="detail__term">{t('detail.state')}</dt>
        <dd className="detail__value">
          <StateBadge state={state} />
        </dd>

        <dt className="detail__term">{t('detail.window')}</dt>
        <dd className="detail__value tnum">{range || t('list.unscheduled')}</dd>

        <dt className="detail__term">{t('detail.progress')}</dt>
        <dd className="detail__value">
          <Meter
            value={percent}
            state={state}
            label={task.title}
            valueText={t('list.percentLabel', { percent: shown })}
          />
          <span className="detail__percent tnum">{shown}%</span>
        </dd>

        {task.category ? (
          <>
            <dt className="detail__term">{t('form.category')}</dt>
            <dd className="detail__value">{categoryLabel(task.category)}</dd>
          </>
        ) : null}

        {task.owner ? (
          <>
            <dt className="detail__term">{t('form.owner')}</dt>
            <dd className="detail__value">{task.owner}</dd>
          </>
        ) : null}

        {task.notes ? (
          <>
            <dt className="detail__term">{t('form.notes')}</dt>
            <dd className="detail__value">{task.notes}</dd>
          </>
        ) : null}
      </dl>
    </BottomSheet>
  )
}
