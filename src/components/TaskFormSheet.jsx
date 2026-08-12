/**
 * Adding a task. CREATE ONLY.
 *
 * An existing task is edited in place, inside its own card (`TaskEditor`), so the one job left
 * for a modal is the case where there is nothing on screen to edit yet. That is also why this
 * one keeps a buffered draft and a Save button while the editor has neither: a task that does
 * not exist cannot be written field by field.
 *
 * THE DATE IS LEFT BLANK, never defaulted to today. Every task typed in a hurry would
 * otherwise be overdue tomorrow, which is the one way this app can put a false number on
 * somebody's screen without anybody typing anything wrong. A dateless task lands in its own
 * group at the foot of the list and waits.
 *
 * The field set and the validation live in `TaskFields`.
 */

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import BottomSheet from './BottomSheet.jsx'
import {
  CategoryField,
  DueField,
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
        <DueField
          id="task-due"
          value={draft.due}
          error={errors.due}
          onChange={(due) => set({ due })}
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
