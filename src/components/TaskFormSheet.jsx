/**
 * The add/edit form.
 *
 * Dates and times are split into separate `date` and `time` inputs rather than one
 * `datetime-local`. Three reasons, and the first is the deciding one: an all-day
 * task has no time at all, and `datetime-local` cannot express that without either
 * inventing a clock reading or swapping the control type mid-form. The second is
 * that iOS Safari's `datetime-local` picker is a combined spinner that is markedly
 * slower to set than the date wheel, and this form's whole job is being fast enough
 * to use standing in a venue. The third is that `date` and `time` degrade
 * independently.
 *
 * The stored value is always a full wall-clock string; an all-day task gets 00:00
 * and 23:59, so progress arithmetic never has to special-case it. That is also why
 * the end time is 23:59 rather than the next midnight: a task due Friday must be
 * overdue on Saturday morning, not 99% complete.
 */

import { useState } from 'react'
import { validateTask } from '../schema.js'
import { endOfDay, isValidWall, normalizeWall, startOfDay, wallDay } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import SubtaskList from './SubtaskList.jsx'

/** '2027-04-18T14:00' -> '14:00'. '' for anything unusable. */
function timeOf(wall) {
  return isValidWall(wall) ? wall.slice(11, 16) : ''
}

function draftFrom(task, defaultDay) {
  if (task) {
    return {
      title: task.title,
      category: task.category,
      allDay: task.allDay,
      startDay: wallDay(task.start),
      endDay: wallDay(task.end),
      startTime: timeOf(task.start) || '09:00',
      endTime: timeOf(task.end) || '17:00',
      owner: task.owner,
      notes: task.notes,
      done: Boolean(task.doneAt),
    }
  }
  return {
    title: '',
    category: '',
    allDay: true,
    startDay: defaultDay,
    endDay: defaultDay,
    startTime: '09:00',
    endTime: '17:00',
    owner: '',
    notes: '',
    done: false,
  }
}

/**
 * The draft -> the two wall-clock strings. An all-day window is the whole of both
 * days, so a single-day all-day task still has a span rather than a zero-length one
 * that would read 0% right up to midnight and then 100%.
 */
export function draftToWindow(draft) {
  const start = draft.startDay ? `${draft.startDay}T${draft.allDay ? '00:00' : draft.startTime}` : ''
  const end = draft.endDay ? `${draft.endDay}T${draft.allDay ? '23:59' : draft.endTime}` : ''
  return {
    start: draft.allDay && start ? startOfDay(start) : normalizeWall(start),
    end: draft.allDay && end ? endOfDay(end) : normalizeWall(end),
  }
}

export default function TaskFormSheet({
  task,
  categories,
  defaultDay,
  onSave,
  onDelete,
  canAddSubtask,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onClose,
}) {
  const { t } = useT()
  const categoryLabel = useCategoryLabel()
  const [draft, setDraft] = useState(() => draftFrom(task, defaultDay))
  const [codes, setCodes] = useState([])

  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))

  const submit = (event) => {
    event.preventDefault()
    const window = draftToWindow(draft)
    const next = {
      // Spread first so `parentId` survives: `updateTask` writes the WHOLE row, and a payload
      // without it blanks the cell and silently promotes a subtask to a task.
      ...(task ?? {}),
      title: draft.title,
      category: draft.category,
      allDay: draft.allDay,
      owner: draft.owner,
      notes: draft.notes,
      ...window,
      // Preserve the original timestamp when a task is edited while already done,
      // so ticking a box does not silently rewrite when it was finished.
      doneAt: draft.done ? task?.doneAt || new Date().toISOString() : '',
      deletedAt: task?.deletedAt ?? '',
    }

    const failures = validateTask(next, isValidWall)
    setCodes(failures)
    if (failures.length) return

    /**
     * CLOSED IMMEDIATELY, AND THE WRITE IS NOT AWAITED.
     *
     * A round trip to the Apps Script endpoint measures ~3s, and this sheet used to sit on
     * screen saying "Saving…" for the whole of it — on every single add and edit, which is what
     * "saving takes many seconds" was. Nothing is gained by waiting: the mutation is optimistic,
     * so the row is already in the list behind this panel. `onSave` still reports what happened,
     * as a toast, and a failure rolls the row back out — which is why there is a toast for the
     * failure too. Validation above is synchronous and still keeps the sheet open.
     */
    onSave(next)
    onClose()
  }

  const has = (code) => codes.includes(code)
  const firstOf = (...wanted) => wanted.find(has)

  const startError = firstOf('MISSING_START', 'BAD_START')
  const endError = firstOf('MISSING_END', 'BAD_END', 'END_BEFORE_START')

  return (
    <BottomSheet
      title={task ? t('form.editTitle') : t('form.newTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="task-form" className="btn btn--primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="task-title">
            {t('form.title')}
          </label>
          <input
            id="task-title"
            className={`input${has('MISSING_TITLE') ? ' input--invalid' : ''}`}
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder={t('form.titlePlaceholder')}
            autoComplete="off"
            /* Deliberately not autoFocus: on iOS it raises the keyboard as the
               sheet is still animating in, which lands the panel half off screen. */
          />
          {has('MISSING_TITLE') ? (
            <span className="field__error">{t('error.MISSING_TITLE')}</span>
          ) : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="task-category">
            {t('form.category')}
          </label>
          <select
            id="task-category"
            className="input"
            value={draft.category}
            onChange={(event) => set({ category: event.target.value })}
          >
            <option value="">{t('form.categoryNone')}</option>
            {/* A category the sheet holds but the configured list does not — someone
                renamed it in the spreadsheet — is still offered, or editing that task
                would silently drop it. */}
            {(draft.category && !categories.includes(draft.category)
              ? [draft.category, ...categories]
              : categories
            ).map((name) => (
              <option key={name} value={name}>
                {categoryLabel(name)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="switch">
            <input
              type="checkbox"
              className="switch__input"
              checked={draft.allDay}
              onChange={(event) => set({ allDay: event.target.checked })}
            />
            <span className="switch__text">{t('form.allDay')}</span>
          </label>
          <span className="hint">{t('form.allDayHint')}</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="task-start">
            {t('form.start')}
          </label>
          <div className="field__row">
            <input
              id="task-start"
              type="date"
              className={`input${startError ? ' input--invalid' : ''}`}
              value={draft.startDay}
              onChange={(event) => set({ startDay: event.target.value })}
            />
            {draft.allDay ? null : (
              <input
                type="time"
                className="input"
                value={draft.startTime}
                onChange={(event) => set({ startTime: event.target.value })}
                aria-label={t('form.startTime')}
              />
            )}
          </div>
          {startError ? <span className="field__error">{t(`error.${startError}`)}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="task-end">
            {t('form.end')}
          </label>
          <div className="field__row">
            <input
              id="task-end"
              type="date"
              className={`input${endError ? ' input--invalid' : ''}`}
              value={draft.endDay}
              onChange={(event) => set({ endDay: event.target.value })}
            />
            {draft.allDay ? null : (
              <input
                type="time"
                className="input"
                value={draft.endTime}
                onChange={(event) => set({ endTime: event.target.value })}
                aria-label={t('form.endTime')}
              />
            )}
          </div>
          {endError ? <span className="field__error">{t(`error.${endError}`)}</span> : null}
        </div>

        <div className="field">
          <label className="label" htmlFor="task-owner">
            {t('form.owner')} <span className="label__aside">{t('common.optional')}</span>
          </label>
          <input
            id="task-owner"
            className="input"
            value={draft.owner}
            onChange={(event) => set({ owner: event.target.value })}
            placeholder={t('form.ownerPlaceholder')}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="task-notes">
            {t('form.notes')} <span className="label__aside">{t('common.optional')}</span>
          </label>
          <textarea
            id="task-notes"
            className="input input--textarea"
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
            placeholder={t('form.notesPlaceholder')}
          />
        </div>

        {/* Only when editing: a new task has no id yet, so there is nothing to parent to. And
            these adds are IMMEDIATE writes rather than part of the draft — hence the hint,
            because Cancel will not undo them. The alternative was a permanent "add a subtask"
            row on all fifty-two parents, three phone screens of height for a rare action. */}
        {task ? (
          <div className="field">
            <span className="label">{t('form.subtasks')}</span>
            <SubtaskList
              canAdd={canAddSubtask}
              subtasks={task.subtasks ?? []}
              canEdit
              onToggle={onToggleSubtask}
              onDelete={onDeleteSubtask}
              onAdd={(title) => onAddSubtask(task, title)}
              onFocusChange={() => {}}
            />
            <span className="hint">{t('form.subtasksHint')}</span>
          </div>
        ) : null}

        <div className="field">
          <label className="switch">
            <input
              type="checkbox"
              className="switch__input"
              checked={draft.done}
              onChange={(event) => set({ done: event.target.checked })}
            />
            <span className="switch__text">{t('form.done')}</span>
          </label>
        </div>

        {task ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => onDelete(task)}
          >
            {t('form.deleteThis')}
          </button>
        ) : null}
      </form>
    </BottomSheet>
  )
}
