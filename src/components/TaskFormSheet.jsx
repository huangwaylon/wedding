/**
 * Adding a task. Create only: an existing task is edited in place inside its own row
 * (`TaskDetail`), so the one job left for a modal is the case where there is nothing on screen to
 * edit. Both surfaces buffer a draft and write once.
 *
 * The date is REQUIRED and still not DEFAULTED. `validateTask` returns `MISSING_DUE` without one,
 * but the field opens BLANK and Save refuses until somebody picks one: a defaulted date is an
 * invented date, and everything typed in a hurry would read overdue tomorrow, in the overdue count
 * and the on-schedule mark. The field set and the validation live in `TaskFields`.
 */

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import {
  CategoryField,
  DueField,
  StartField,
  TitleField,
  codesFor,
  draftFrom,
  fieldErrors,
  taskFromDraft,
} from './TaskFields.jsx'

export default function TaskFormSheet({ categories, onSave, onClose }) {
  const { t } = useT()
  const [draft, setDraft] = useState(() => draftFrom(null))
  const [codes, setCodes] = useState([])

  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))
  const errors = fieldErrors(codes)

  const submit = (event) => {
    event.preventDefault()
    const next = taskFromDraft(draft)
    const failures = codesFor(next)
    setCodes(failures)
    if (failures.length) return

    /* The sheet closes immediately and the write is not awaited: the mutation is optimistic, so the
       row is already in the list behind this panel. `onSave` reports what happened as a toast, and
       a failure rolls the row back out, which is why that failure needs a toast of its own.
       Validation above is synchronous and keeps the sheet open. */
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
          `form` attribute is for: inside, Save would sit under the keyboard. */}
      <form id="task-form" onSubmit={submit} noValidate>
        <TitleField
          id="task-title"
          value={draft.title}
          error={errors.title}
          onChange={(title) => set({ title })}
        />
        <DueField
          id="task-due"
          value={draft.due}
          error={errors.due}
          onChange={(due) => set({ due })}
        />
        {/* After the required day: this is the field most tasks leave blank, and it opens blank
            itself — nothing here may invent a date. */}
        <StartField
          id="task-start"
          value={draft.start}
          onChange={(start) => set({ start })}
        />
        <CategoryField
          id="task-category"
          value={draft.category}
          categories={categories}
          onChange={(category) => set({ category })}
        />
      </form>
    </BottomSheet>
  )
}
