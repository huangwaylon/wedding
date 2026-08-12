/**
 * Adding a task. CREATE ONLY.
 *
 * An existing task is edited in place, inside its own card (`TaskEditor`), so the one job left
 * for a modal is the case where there is nothing on screen to edit yet. That is also why this
 * one keeps a buffered draft and a Save button while the editor has neither: a task that does
 * not exist cannot be written field by field — it needs a title and a window before the sheet
 * has anything to send.
 *
 * The field set, the wall-clock handling and the validation all live in `TaskFields`.
 */

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import {
  AllDayField,
  CategoryField,
  DateField,
  NotesField,
  OwnerField,
  TitleField,
  codesFor,
  draftFrom,
  fieldErrors,
  taskFromDraft,
} from './TaskFields.jsx'

export default function TaskFormSheet({ categories, defaultDay, onSave, onClose }) {
  const { t } = useT()
  const [draft, setDraft] = useState(() => draftFrom(null, defaultDay))
  const [codes, setCodes] = useState([])

  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))
  const errors = fieldErrors(codes)

  const submit = (event) => {
    event.preventDefault()
    const next = taskFromDraft(draft)
    const failures = codesFor(next)
    setCodes(failures)
    if (failures.length) return

    /**
     * CLOSED IMMEDIATELY, AND THE WRITE IS NOT AWAITED.
     *
     * A round trip to the Apps Script endpoint measures ~3s, and this sheet used to sit on
     * screen saying "Saving…" for the whole of it. Nothing is gained by waiting: the mutation
     * is optimistic, so the row is already in the list behind this panel. `onSave` still
     * reports what happened, as a toast, and a failure rolls the row back out — which is why
     * there is a toast for the failure too. Validation above is synchronous and still keeps
     * the sheet open.
     */
    onSave(next)
    onClose()
  }

  return (
    <BottomSheet
      title={t('form.newTitle')}
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
      {/* The submit button lives in the sticky footer, outside this element, which is what the
          `form` attribute is for — moving it inside would put Save under the keyboard. */}
      <form id="task-form" onSubmit={submit} noValidate>
        <TitleField
          id="task-title"
          value={draft.title}
          error={errors.title}
          onChange={(title) => set({ title })}
        />
        <DateField
          id="task-start"
          label={t('form.start')}
          timeLabel={t('form.startTime')}
          day={draft.startDay}
          time={draft.startTime}
          showTime={!draft.allDay}
          error={errors.start}
          onDay={(startDay) => set({ startDay })}
          onTime={(startTime) => set({ startTime })}
        />
        <DateField
          id="task-end"
          label={t('form.end')}
          timeLabel={t('form.endTime')}
          day={draft.endDay}
          time={draft.endTime}
          showTime={!draft.allDay}
          error={errors.end}
          onDay={(endDay) => set({ endDay })}
          onTime={(endTime) => set({ endTime })}
        />
        <AllDayField checked={draft.allDay} onChange={(allDay) => set({ allDay })} />
        <CategoryField
          id="task-category"
          value={draft.category}
          categories={categories}
          onChange={(category) => set({ category })}
        />
        <OwnerField
          id="task-owner"
          value={draft.owner}
          onChange={(owner) => set({ owner })}
        />
        <NotesField
          id="task-notes"
          value={draft.notes}
          onChange={(notes) => set({ notes })}
        />
      </form>
    </BottomSheet>
  )
}
