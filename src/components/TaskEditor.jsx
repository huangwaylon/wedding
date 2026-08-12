/**
 * Editing a task, in place, inside the card that is already open.
 *
 * THERE IS NO SAVE BUTTON AND NO DIRTY STATE. Every field commits when focus leaves it, or on
 * Return — so there is never a pending edit that a tap on the scrim, a collapse of the card or
 * a reload can throw away, and no "unsaved changes" question anybody has to be asked. The
 * price is one write per field, which is why an unchanged value sends nothing at all. That
 * comparison matters MORE now that a date wheel is one of the three fields: opening the picker
 * and dismissing it is a blur with nothing to report.
 *
 * COMMITTING THE DATE ON BLUR IS LOAD-BEARING, not incidental. iOS fires `change` on every
 * spin of the wheel, so an `onChange` commit would be one round trip per digit.
 *
 * ONE FIELD IS BUFFERED AT A TIME: the one under the finger. Everything else renders straight
 * from `task`, so the optimistic row this component just wrote — and any edit the other person
 * made while the card sat open — appears with no merge step and no stale draft to reconcile.
 * A phone can only focus one control at a time, so that buffer is never bigger than it looks.
 *
 * `onSave` is handed the WHOLE task, never the field that changed: `update` rewrites the row
 * from the payload, so a payload missing `parent_id` blanks the cell and silently promotes a
 * subtask to a task.
 *
 * CLEARING THE DATE IS A LEGAL EDIT and is not confirmed. The receipt is that the row leaves
 * its month and lands in the "No date" group at the foot of the list, which is louder than a
 * dialog and cannot be dismissed by accident.
 *
 * THE DELETE AFFORDANCE IS NOT HERE, and that is a correction. It used to be this component's
 * last row, which put it between the fields and the checklist below them — so it read as
 * belonging to the checklist, and the hairline meant to separate it from the fields separated
 * it from the wrong thing. It belongs to the open row as a whole, so `TaskCard` owns it and
 * renders it last.
 *
 * A viewer never gets here — `TaskCard` renders this only when `canEdit` — and that is a
 * rendering decision, not the security boundary: the endpoint refuses every keyless write.
 */

import { useState } from 'react'
import { taskToRow } from '../schema.js'
import {
  CategoryField,
  DueField,
  TitleField,
  codesFor,
  draftFrom,
  fieldErrors,
  taskFromDraft,
} from './TaskFields.jsx'

/**
 * The row this task would be written as, as one comparable string.
 *
 * "Did the value change" has exactly one honest definition: whether the ROW we are about to
 * write differs from the row already there. Comparing the draft's fields instead would report
 * a change for a trailing space that `taskToRow` trims away, and every blur would then cost a
 * round trip and a toast.
 *
 * `null` for a row `taskToRow` would refuse: somebody can empty a title cell in the
 * spreadsheet, and that row must read as "changed" by whatever is typed over it rather than
 * throwing out of a blur handler. The payload side is always a validated task, so the two can
 * never both be null.
 */
function wireRow(task) {
  if (!task?.id || !task?.title) return null
  return JSON.stringify(taskToRow(task))
}

export default function TaskEditor({ task, categories, onSave, onFieldFocus }) {
  /** The field with focus, as a patch over the stored values. Null between fields. */
  const [pending, setPending] = useState(null)
  const [codes, setCodes] = useState([])

  const draft = { ...draftFrom(task), ...pending }
  const errors = fieldErrors(codes)
  const fieldId = (name) => `edit-${task.id}-${name}`
  const edit = (patch) => setPending((previous) => ({ ...previous, ...patch }))
  /**
   * A SUBTASK IS A TITLE AND A TICK, so it is offered no date at all.
   *
   * `validateTask` returns early for anything with a `parentId` — a date wheel per item would
   * make entering five in a row unusable on a phone, and then no parent's progress would
   * advance, which is the whole point of a checklist. Offering the field anyway would put a
   * control on screen that nothing validates and nothing draws.
   */
  const dated = !task.parentId

  /**
   * One field, committed.
   *
   * `patch` is the value of a control with no useful blur — a picker is done the moment it
   * changes — while a text field's blur commits whatever the buffer holds.
   */
  const commit = (patch) => {
    const next = taskFromDraft({ ...draft, ...patch }, task)
    const failures = codesFor(next)
    setCodes(failures)
    if (failures.length) {
      // The rejected value STAYS on screen to be corrected. Reverting it under somebody's
      // finger would be the one thing worse than refusing the write.
      if (patch) edit(patch)
      return
    }
    setPending(null)
    if (wireRow(next) === wireRow(task)) return
    /**
     * Not awaited, deliberately. A round trip is ~3s, the mutation is optimistic so the row
     * on screen is already right, and `App` reports a failure as a toast — waiting would
     * freeze the field somebody is about to type in next for three seconds per edit.
     */
    onSave(next)
  }

  return (
    <div className="editor">
      <TitleField
        id={fieldId('title')}
        skin="editor"
        value={draft.title}
        error={errors.title}
        onChange={(title) => edit({ title })}
        onCommit={commit}
        onFocusChange={onFieldFocus}
      />

      {/* One column, three rows. The two-track grid this replaced existed to hold two date
          wheels side by side, and its 11rem minimum was measured for exactly that. */}
      {dated ? (
        <DueField
          id={fieldId('due')}
          skin="editor"
          value={draft.due}
          error={errors.due}
          onChange={(due) => edit({ due })}
          onCommit={commit}
          onFocusChange={onFieldFocus}
        />
      ) : null}

      <CategoryField
        id={fieldId('category')}
        skin="editor"
        value={draft.category}
        categories={categories}
        onChange={(category) => commit({ category })}
        onFocusChange={onFieldFocus}
      />
    </div>
  )
}
