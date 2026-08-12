/**
 * Editing a task, in place, inside the card that is already open.
 *
 * THERE IS NO SAVE BUTTON AND NO DIRTY STATE. Every field commits when focus leaves it, or on
 * Return — so there is never a pending edit that a tap on the scrim, a collapse of the card or
 * a reload can throw away, and no "unsaved changes" question anybody has to be asked. The
 * price is one write per field, which is why an unchanged value sends nothing at all.
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
 * A viewer never gets here — `TaskCard` renders this only when `canEdit` — and that is a
 * rendering decision, not the security boundary: the endpoint refuses every keyless write.
 */

import { useState } from 'react'
import { taskToRow } from '../schema.js'
import { useT } from '../i18n/index.js'
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

/**
 * The row this task would be written as, as one comparable string.
 *
 * "Did the value change" has exactly one honest definition: whether the ROW we are about to
 * write differs from the row already there. Comparing the draft's fields instead would report
 * a change for a trailing space that `taskToRow` trims away, and every blur would then cost a
 * round trip and a toast.
 *
 * A row somebody hand-edited in the spreadsheet is the one case where this reports a change
 * nobody typed: a bare `2027-04-18`, or an all-day window ending at 17:00, is rewritten to the
 * stored shape by the first field anybody leaves. That is a repair toward the invariant — an
 * all-day task has to end at 23:59 or it reads 99% complete on the morning it is overdue — and
 * it only ever happens to a task somebody has deliberately opened.
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

export default function TaskEditor({ task, categories, onSave, onDelete, onFieldFocus }) {
  const { t } = useT()
  /** The field with focus, as a patch over the stored values. Null between fields. */
  const [pending, setPending] = useState(null)
  const [codes, setCodes] = useState([])

  const draft = { ...draftFrom(task), ...pending }
  const errors = fieldErrors(codes)
  const fieldId = (name) => `edit-${task.id}-${name}`
  const edit = (patch) => setPending((previous) => ({ ...previous, ...patch }))
  /**
   * A SUBTASK IS A TITLE AND A TICK, so it is offered no window at all.
   *
   * `validateTask` returns early for anything with a `parentId` — two date wheels per item
   * would make entering five in a row unusable on a phone, and then no parent's progress would
   * advance, which is the whole point of a checklist. Offering the fields anyway would put
   * three controls on screen that nothing validates and nothing draws.
   */
  const dated = !task.parentId

  /**
   * One field, committed.
   *
   * `patch` is the value of a control with no useful blur — a checkbox and a picker are done
   * the moment they change — while a text field's blur commits whatever the buffer holds.
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

      {/* The window, two-up where the column is wide enough to hold two date wheels and
          one-up where it is not — no breakpoint, because the card is narrower than the
          viewport by an amount that depends on which tab it is in. */}
      {dated ? (
        <div className="editor__grid">
          <DateField
            id={fieldId('start')}
            skin="editor"
            label={t('form.start')}
            timeLabel={t('form.startTime')}
            day={draft.startDay}
            time={draft.startTime}
            showTime={!draft.allDay}
            error={errors.start}
            onDay={(startDay) => edit({ startDay })}
            onTime={(startTime) => edit({ startTime })}
            onCommit={commit}
            onFocusChange={onFieldFocus}
          />
          <DateField
            id={fieldId('end')}
            skin="editor"
            label={t('form.end')}
            timeLabel={t('form.endTime')}
            day={draft.endDay}
            time={draft.endTime}
            showTime={!draft.allDay}
            error={errors.end}
            onDay={(endDay) => edit({ endDay })}
            onTime={(endTime) => edit({ endTime })}
            onCommit={commit}
            onFocusChange={onFieldFocus}
          />
        </div>
      ) : null}

      {dated ? (
        <AllDayField
          skin="editor"
          checked={draft.allDay}
          onChange={(allDay) => commit({ allDay })}
          onFocusChange={onFieldFocus}
        />
      ) : null}

      {/* The quieter half. Neither is needed to describe a task, so they share a row and stay
          out of the way of the three fields above them. */}
      <div className="editor__row">
        <CategoryField
          id={fieldId('category')}
          skin="editor"
          value={draft.category}
          categories={categories}
          onChange={(category) => commit({ category })}
          onFocusChange={onFieldFocus}
        />
        <OwnerField
          id={fieldId('owner')}
          skin="editor"
          value={draft.owner}
          onChange={(owner) => edit({ owner })}
          onCommit={commit}
          onFocusChange={onFieldFocus}
        />
      </div>

      <NotesField
        id={fieldId('notes')}
        skin="editor"
        value={draft.notes}
        onChange={(notes) => edit({ notes })}
        onCommit={commit}
        onFocusChange={onFieldFocus}
      />

      {/* One quiet destructive affordance, and it does not delete anything: it opens the
          confirm sheet, because a delete inside a card somebody opened to fix a typo is a
          tap away from the fields above it. */}
      <div className="editor__foot">
        <button
          type="button"
          className="btn btn--ghost editor__danger"
          onClick={() => onDelete(task)}
        >
          {t('form.deleteThis')}
        </button>
      </div>
    </div>
  )
}
