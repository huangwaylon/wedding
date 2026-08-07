/**
 * Delete confirmation, and the collapsed list a delete can be undone from.
 *
 * Deletes are soft, confirmed, and reversible. Recovery is this list rather than a
 * toast action: a toast that has timed out is a delete nobody can undo, which is why
 * no toast in this app carries a button.
 */

import { useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import { ChevronRightIcon, UndoIcon } from './icons.jsx'

export function ConfirmDeleteSheet({ task, onConfirm, onClose }) {
  const { t } = useT()
  return (
    <BottomSheet
      title={t('confirm.deleteTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => onConfirm(task)}>
            {t('common.delete')}
          </button>
        </>
      }
    >
      <p className="caption">
        {t('confirm.deleteBody', { title: task.title })}
        {/* The delete cascades server-side under one lock, so saying so is not optional. */}
        {task.progress?.tally ? (
          <> {t('confirm.deleteSubtasks', { count: task.progress.tally.total })}</>
        ) : null}
      </p>
    </BottomSheet>
  )
}

export function DeletedList({ tasks, onRestore }) {
  const { t } = useT()
  if (!tasks.length) return null

  return (
    <details className="card disclosure">
      <summary className="disclosure__summary">
        <ChevronRightIcon className="disclosure__chevron" />
        {t('deleted.title', { count: tasks.length })}
      </summary>
      <ul>
        {tasks.map((task) => (
          <li className="deleted__row" key={task.id}>
            <span className="deleted__title">{task.title}</span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => onRestore(task.id)}
            >
              <UndoIcon style={{ width: '1em', height: '1em' }} />
              {t('common.restore')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
