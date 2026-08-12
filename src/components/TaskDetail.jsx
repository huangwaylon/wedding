/**
 * What is behind an open row: the facts, the checklist, and — only once somebody asks for it —
 * the fields.
 *
 * OPENING A ROW REVEALS IT. IT DOES NOT ARM IT. Tapping a row is how you read a task and tick
 * its checklist, and those are the two things done a hundred times a week; changing its title or
 * its date is done once. An earlier version put live fields behind every tap, which meant the
 * common gesture landed a caret in a text input and a stray tap could retitle a task. The Edit
 * toggle is the confirmation, and it costs one tap on the rare path to protect the frequent one.
 *
 * READ MODE holds the due date spelled out — the one fact the collapsed row abbreviates to a bare
 * day number, and the only place the weekday appears, which is a real question about a wedding
 * task — plus the checklist, tickable. EDIT MODE swaps the facts for the three fields and adds the
 * delete. The checklist is in both, because ticking an item is doing the work rather than editing
 * the task — and so is adding one. What the toggle takes with it is every DESTRUCTIVE control: the
 * task's own delete, and the per-item trash icons.
 *
 * ONE WRITE PER EDIT SESSION, AND THAT IS THE POINT OF OWNING THE DRAFT HERE.
 *
 * Every field used to commit on its own blur. That reads well on paper — nothing to save, nothing
 * to lose — and on this endpoint it measured badly: a round trip is ~3s, writes serialise so the
 * order the sheet's lock sees is the order they were made, and changing a title, a date and a
 * category was therefore three of them nose to tail. Ten seconds of a row flickering through
 * three optimistic states, which is what "saving is slow and inconsistent" looked like.
 *
 * The Edit toggle gave the session a beginning and an end, so the draft lives for exactly as long
 * as the mode does and goes out once, when Done is pressed. `draft === null` IS read mode; there
 * is no second flag that can disagree with it.
 *
 * WHAT IT COSTS, and how each part is paid for:
 *
 *   Unsaved text can now exist with nothing focused. So the whole SESSION reports up as `typing`,
 *   which is what holds off a service-worker reload — a per-field focus report cannot, because a
 *   blur between two fields would drop the guard at exactly the moment the buffer is full.
 *
 *   Closing the row mid-session would throw the edit away. So unmounting FLUSHES: the ref below
 *   always holds the current draft's writer, and the effect's cleanup calls it. An invalid draft
 *   — only ever an empty title — is dropped there rather than saved, which keeps the old title
 *   and loses nothing anybody meant to keep.
 *
 *   The other person's edit to a field you are also editing is lost for the session's duration,
 *   where per-field commits narrowed that to the one field under the finger. Two people editing
 *   the same field of the same task inside one session is not a case worth three round trips.
 *
 * `editing` is the INITIAL mode, and it is a prop for exactly one reason: a static render fires
 * no click, so without it neither the test suite nor the screenshot harness could ever see the
 * fields. Same reasoning as `expanded` on `TaskCard`. Nothing in the app passes it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { taskToRow } from '../schema.js'
import { formatDayLong } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import SubtaskList from './SubtaskList.jsx'
import {
  CategoryField,
  DueField,
  TitleField,
  codesFor,
  draftFrom,
  fieldErrors,
  taskFromDraft,
} from './TaskFields.jsx'
import { PencilIcon } from './icons.jsx'

/**
 * The row this task would be written as, as one comparable string.
 *
 * "Did anything change" has exactly one honest definition: whether the ROW we are about to write
 * differs from the row already there. Comparing the draft's fields instead would report a change
 * for a trailing space that `taskToRow` trims away, and every Done would cost a round trip and a
 * toast. It also makes the flush idempotent — the optimistic update lands synchronously, so a
 * Done followed by a close finds nothing left to send.
 *
 * `null` for a row `taskToRow` would refuse: somebody can empty a title cell in the spreadsheet,
 * and that row must read as "changed" by whatever is typed over it rather than throwing out of a
 * handler. The payload side is always a validated task, so the two can never both be null.
 */
function wireRow(task) {
  if (!task?.id || !task?.title) return null
  return JSON.stringify(taskToRow(task))
}

export default function TaskDetail({
  task,
  canEdit,
  categories,
  onToggle,
  onDelete,
  onSave,
  canAddSubtask,
  onAddSubtask,
  onFieldFocus,
  editing: initiallyEditing = false,
}) {
  const { t, locale } = useT()
  /** The session's buffer. `null` is read mode — one piece of state, so nothing can disagree. */
  const [draft, setDraft] = useState(() => (initiallyEditing ? draftFrom(task) : null))
  const [codes, setCodes] = useState([])
  const editing = draft !== null
  const subtasks = task.subtasks ?? []

  /**
   * A draft -> what to do with it, touching no state.
   *
   * Pure because the unmount path calls it too, and setting state on an unmounting component is
   * a warning at best and a dropped write at worst.
   */
  const resolve = useCallback(
    (candidate) => {
      const next = taskFromDraft(candidate, task)
      const failures = codesFor(next)
      if (failures.length) return { failures }
      return wireRow(next) === wireRow(task) ? { unchanged: true } : { next }
    },
    [task],
  )

  /**
   * The one write. Not awaited: the mutation is optimistic so the row on screen is already
   * right, and `App` reports a failure as a toast — waiting would freeze the row for ~3s.
   */
  const done = () => {
    const outcome = resolve(draft)
    if (outcome.failures) {
      // The rejected value STAYS on screen to be corrected, and the session stays open.
      setCodes(outcome.failures)
      return
    }
    setCodes([])
    setDraft(null)
    if (outcome.next) onSave(outcome.next)
  }

  /**
   * The flush the unmount path uses, kept current on every render.
   *
   * A ref rather than an effect dependency: the cleanup must run exactly once, when the row
   * closes, and it has to see the LAST draft rather than the one from the render that installed
   * it.
   */
  const flush = useRef(null)
  flush.current = editing
    ? () => {
        const outcome = resolve(draft)
        if (outcome.next) onSave(outcome.next)
      }
    : null
  useEffect(() => () => flush.current?.(), [])

  /**
   * The SESSION, not the field, is what holds off a reload. A per-field report drops the guard on
   * every blur between two fields — precisely when the buffer is full and nothing has been sent.
   */
  useEffect(() => {
    if (!editing) return undefined
    onFieldFocus?.(true)
    return () => onFieldFocus?.(false)
  }, [editing, onFieldFocus])

  const errors = fieldErrors(codes)
  const fieldId = (name) => `edit-${task.id}-${name}`
  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))
  /**
   * A SUBTASK IS A TITLE AND A TICK, so it is offered no date at all. `validateTask` returns
   * early for anything with a `parentId`, so a field offered here would be saved unvalidated.
   */
  const dated = !task.parentId

  return (
    <>
      {editing ? (
        /* One column, three rows. No `onFocusChange` on any of them: the session reports focus
           for the whole of itself above, and a field doing it too would fight that. */
        <div className="editor">
          <TitleField
            id={fieldId('title')}
            skin="editor"
            value={draft.title}
            error={errors.title}
            onChange={(title) => set({ title })}
            /* Return ends the SESSION rather than the field — there is only one write, and this
               is the keyboard's way of asking for it. */
            onEnter={() => done()}
          />
          {dated ? (
            <DueField
              id={fieldId('due')}
              skin="editor"
              value={draft.due}
              error={errors.due}
              onChange={(due) => set({ due })}
            />
          ) : null}
          <CategoryField
            id={fieldId('category')}
            skin="editor"
            value={draft.category}
            categories={categories}
            onChange={(category) => set({ category })}
          />
        </div>
      ) : (
        <p className="tcard__fact">
          <span className="tcard__factLabel">{t('form.due')}</span>{' '}
          {/* The space is for a SCREEN READER, not for layout: a flex container drops a
              whitespace-only box, but without it the two run together in the accessibility
              tree and "Due" and "Wed" are read as one word. */}
          <span>
            {task.progress.dated ? formatDayLong(task.due, { locale }) : t('state.nodate')}
          </span>
        </p>
      )}

      {/* `promoted` is what withholds the add field: a row the read could not place is drawn as a
          task, but a child of it would be a grandchild and the next read would promote that one
          too — so offering the field would invite somebody to type a checklist that walks out of
          the row. */}
      {canEdit || subtasks.length > 0 ? (
        <SubtaskList
          subtasks={subtasks}
          canEdit={canEdit}
          canAdd={canAddSubtask && !task.promoted}
          canRemove={editing}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={(title) => onAddSubtask(task, title)}
          onFocusChange={onFieldFocus}
        />
      ) : null}

      {canEdit ? (
        <div className="tcard__foot">
          {/* Edit mode ALONE, and it deletes nothing: it opens the confirm sheet. Two
              destructive-adjacent controls on the read path is one too many. */}
          {editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--danger-quiet"
              onClick={() => onDelete(task)}
            >
              {t('form.deleteThis')}
            </button>
          ) : null}

          {/* `aria-pressed` rather than two controls: the word changes too, but a screen reader
              is told this is a toggle and which way it is set. */}
          <button
            type="button"
            className="btn btn--secondary btn--sm tcard__edit"
            aria-pressed={editing}
            onClick={() => (editing ? done() : setDraft(draftFrom(task)))}
          >
            {editing ? (
              t('common.editDone')
            ) : (
              <>
                <PencilIcon style={{ width: '1em', height: '1em' }} />
                {t('common.edit')}
              </>
            )}
          </button>
        </div>
      ) : null}
    </>
  )
}
