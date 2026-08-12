/**
 * Adding a task. CREATE ONLY.
 *
 * An existing task is edited in place, inside its own row (`TaskDetail`), so the one job left for
 * a modal is the case where there is nothing on screen to edit yet. Both surfaces buffer a draft
 * and write once — this one's end is Save, the inline one's is Done.
 *
 * THE DATE IS REQUIRED, AND STILL NOT DEFAULTED. Every task carries a day — `validateTask`
 * returns `MISSING_DUE` without one — but the field opens BLANK and Save refuses until somebody
 * picks one, rather than starting on today. Those are two different things: a defaulted date is an
 * invented date, and every task typed in a hurry would be overdue tomorrow, which is the one way
 * this app can put a false number on somebody's screen without anybody typing anything wrong.
 * Refusing asks a question; defaulting answers it wrongly and says nothing.
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
     * A round trip to the endpoint measures ~3s, and nothing is gained by waiting on it: the
     * mutation is optimistic, so the row is already in the list behind this panel. `onSave`
     * reports what happened as a toast, and a failure rolls the row back out — which is why the
     * failure needs a toast of its own. Validation above is synchronous and keeps the sheet open.
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
