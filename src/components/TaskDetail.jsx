/**
 * What is behind an open row: the day it starts if it has one, the checklist, and the fields once
 * Edit is on.
 *
 * An open row starts READ-ONLY — live fields behind the frequent gesture put a caret in a title one
 * stray blur from renaming a task — and the Edit toggle gates every destructive control, the task's
 * delete and the per-item trash icons, as well as the add-a-subtask field, which is a text field and
 * made every open row read as a form. TICKING is the one thing that stays on the read path: it is the
 * commonest reason to open a row at all. The mode lives here because this component unmounts when the
 * row closes, resetting it with no effect to synchronise; `draft === null` is read mode, so no second
 * flag can disagree.
 *
 * ONE write per edit session, writes serialising at ~0.5s each. Consequences: unsaved text can
 * exist with nothing focused, so the whole session reports `typing` (per-field, a blur between two
 * fields would drop the guard with the buffer full); closing the row mid-session flushes through
 * the ref below, dropping an invalid draft; and the other person's edit to a field being edited
 * here is lost for the session. `editing` is the initial mode, a prop only because a static render
 * fires no click and nothing else could see the fields.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { taskToRow } from '../schema.js'
import { formatDayLong, normalizeDay } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import EditToggle from './EditToggle.jsx'
import SubtaskList from './SubtaskList.jsx'
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

/**
 * The row this task would be written as, as one comparable string: the session's change
 * fingerprint. Comparing the ROW, not the draft's fields, is the only honest definition of "did
 * anything change" — a trailing space `taskToRow` trims would otherwise cost a round trip and a
 * toast on every Done — and it makes the flush idempotent, the optimistic update having landed
 * synchronously. `null` for a row `taskToRow` would refuse, such as a title cell emptied in the
 * spreadsheet: it must read as changed rather than throw out of a handler, and the payload side is
 * always a validated task, so the two can never both be null.
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
  onAddSubtask,
  onFieldFocus,
  editing: initiallyEditing = false,
}) {
  const { t, locale } = useT()
  const [draft, setDraft] = useState(() => (initiallyEditing ? draftFrom(task) : null))
  const [codes, setCodes] = useState([])
  const editing = draft !== null
  const subtasks = task.subtasks ?? []

  /** Touches no state, the unmount path calling it too: setting state on an unmounting component
      drops the write. */
  const resolve = useCallback(
    (candidate) => {
      const next = taskFromDraft(candidate, task)
      const failures = codesFor(next)
      if (failures.length) return { failures }
      return wireRow(next) === wireRow(task) ? { unchanged: true } : { next }
    },
    [task],
  )

  /** Not awaited: the mutation is optimistic and `App` reports a failure as a toast. */
  const done = () => {
    const outcome = resolve(draft)
    if (outcome.failures) {
      // The rejected value stays on screen to be corrected, and the session stays open.
      setCodes(outcome.failures)
      return
    }
    /* The flush is disarmed before the write. Saving a new DATE re-sorts the plan, so the row moves
       to another month `<section>` and React deletes the subtree rather than moving it, running
       this component's cleanup with a closure still holding the pre-save task and draft — the
       identical write, twice. A ref assignment is immediate, so the deleted fiber's cleanup sees
       the null. */
    flush.current = null
    setCodes([])
    setDraft(null)
    if (outcome.next) onSave(outcome.next)
  }

  /** The flush the unmount path uses, kept current on every render. A ref rather than an effect
   *  dependency: the cleanup runs once, when the row closes, and must see the LAST draft. */
  const flush = useRef(null)
  flush.current = editing
    ? () => {
        const outcome = resolve(draft)
        if (outcome.next) onSave(outcome.next)
      }
    : null
  useEffect(() => () => flush.current?.(), [])

  /**
   * The delete disarms the flush too, against a worse defect. It is optimistic: `deletedAt` is
   * stamped synchronously, the row stops being live and unmounts, and the cleanup's closure still
   * holds the PRE-DELETE task. `taskFromDraft` spreads it, so the payload carries an empty
   * `deleted_at` and `update` rewrites the whole row; the resurrection lands second and wins, the
   * task returning with the edit that preceded the delete and missing the subtasks the cascade
   * tombstoned. It ends the session rather than only nulling the ref, which is reassigned every
   * render and would be armed again. Cost: cancelling the confirmation leaves the row read-only
   * showing its stored title.
   */
  const remove = () => {
    flush.current = null
    setDraft(null)
    onDelete(task)
  }

  /** The session, not the field, reports `typing`: a per-field report drops the guard on every blur
   *  between two fields, when the buffer is full and nothing has been sent. */
  useEffect(() => {
    if (!editing) return undefined
    onFieldFocus?.(true)
    return () => onFieldFocus?.(false)
  }, [editing, onFieldFocus])

  const errors = fieldErrors(codes)
  const fieldId = (name) => `edit-${task.id}-${name}`
  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))
  /** No date field for a subtask: `validateTask` returns early for anything with a `parentId`, so
   *  one offered here would be stored unvalidated. Covers both days. */
  const dated = !task.parentId
  /** Whether read mode has a fact to state. `normalizeDay` is `draftFrom`'s business; this asks the
   *  same question of the stored row, and `progress.thisMonth` cannot answer it — a start date in the
   *  future is worth showing and puts the row in no section. */
  const started = Boolean(normalizeDay(task.start))

  return (
    <>
      {editing ? (
        /* No field reports focus: the session reports it for the whole of itself. */
        <div className="editor">
          <TitleField
            id={fieldId('title')}
            skin="editor"
            value={draft.title}
            error={errors.title}
            onChange={(title) => set({ title })}
            /* Return ends the session, not the field: there is one write. */
            onEnter={() => done()}
          />
          {/* Both days or neither, in the order they happen: the day work starts, then the day it is
              due. Each label says whether it is optional or required, which is what the old
              required-day-first ordering was standing in for. */}
          {dated ? (
            <>
              <StartField
                id={fieldId('start')}
                skin="editor"
                value={draft.start}
                onChange={(start) => set({ start })}
              />
              <DueField
                id={fieldId('due')}
                skin="editor"
                value={draft.due}
                error={errors.due}
                onChange={(due) => set({ due })}
              />
            </>
          ) : null}
          <CategoryField
            id={fieldId('category')}
            skin="editor"
            value={draft.category}
            categories={categories}
            onChange={(category) => set({ category })}
          />
        </div>
      ) : started ? (
        /* The one fact an open row shows in read mode, and only when there is one: the day work
           starts. The due date is NOT repeated here — the row's own day column and the words beside
           it already carry it, and a line restating it was the largest thing in an open row for a
           value nobody had to look up. A row with no start date shows nothing at all. */
        <p className="tcard__fact">
          <span className="tcard__factLabel">{t('form.start')}</span>{' '}
          {/* The space is for the accessibility tree: without it "Start" and "Wed" are read as one
              word. */}
          <span>{formatDayLong(task.start, { locale })}</span>
        </p>
      ) : null}

      {/* The list while there is one, the add field only inside an edit session: a text field behind
          the commonest tap made every open row read as a form. `promoted` withholds the field
          outright — a child of a row the read could not place would be a grandchild, promoted again
          on the next read. */}
      {subtasks.length > 0 || (canEdit && editing) ? (
        <SubtaskList
          subtasks={subtasks}
          canEdit={canEdit}
          canAdd={editing && !task.promoted}
          canRemove={editing}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={(title) => onAddSubtask(task, title)}
          onFocusChange={onFieldFocus}
        />
      ) : null}

      {canEdit ? (
        <div className="tcard__foot">
          {/* Edit mode only, and it deletes nothing: it opens the confirm sheet. */}
          {editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--danger-quiet"
              onClick={remove}
            >
              {t('form.deleteThis')}
            </button>
          ) : null}

          {/* One control, shared with the notes document — see `EditToggle`. */}
          <EditToggle editing={editing} onToggle={() => (editing ? done() : setDraft(draftFrom(task)))} />
        </div>
      ) : null}
    </>
  )
}
