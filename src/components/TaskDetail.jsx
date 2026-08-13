/**
 * What is behind an open row: the facts, the checklist, and — only once somebody asks for it —
 * the fields.
 *
 * OPENING A ROW REVEALS IT. IT DOES NOT ARM IT. Tapping a row is how you read a task and tick
 * its checklist, and those are the two things done a hundred times a week; changing its title or
 * its date is done once. Live fields behind every tap would land a caret in a text input on the
 * common gesture, one stray blur away from retitling a task. The Edit toggle is the confirmation,
 * and it costs one tap on the rare path to protect the frequent one.
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
 * A round trip is ~3s and writes serialise, so committing each field on its own blur costs one
 * per field nose to tail — ten seconds of a row flickering through three optimistic states for one
 * edit. The Edit toggle gives the session a beginning and an end: the draft lives exactly as long
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
 *   always holds the current draft's writer, and the effect's cleanup calls it. An invalid draft —
 *   no title, or no day — is dropped there rather than saved, which keeps the stored values.
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
    /**
     * THE FLUSH IS DISARMED BEFORE THE WRITE, and this line is why the unmount path is safe.
     * Saving a new DATE re-sorts the plan, so the row moves to a different month — a different
     * `<section>` — and React deletes the subtree rather than moving it. That deletion runs this
     * component's cleanup, whose closure still holds the pre-save task and the full draft, so it
     * would resolve the same difference again and send the identical write twice. A ref assignment
     * is immediate, so nulling it here is what the deleted fiber's cleanup sees.
     */
    flush.current = null
    setCodes([])
    setDraft(null)
    if (outcome.next) onSave(outcome.next)
  }

  /**
   * The flush the unmount path uses, kept current on every render.
   *
   * A ref rather than an effect dependency: the cleanup must run exactly once, when the row
   * closes, and it has to see the LAST draft rather than the one from the render that installed
   * it. `done` disarms it — see there for what that costs if it does not.
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
   * DELETING DISARMS THE FLUSH TOO, and for a worse reason than `done`'s.
   *
   * The delete is optimistic: `deletedAt` is stamped synchronously, the row stops being live and
   * drops out of the plan, so this component unmounts and its cleanup runs with a closure still
   * holding the PRE-DELETE task. `taskFromDraft` spreads that task, so the payload carries an
   * empty `deleted_at`, and `update` rewrites the whole row from the payload. The two writes
   * serialise on one chain, so the resurrection lands second and wins: the task somebody just
   * deleted comes back ~3s later, wearing the edit that preceded the delete and missing the
   * subtasks, whose rows the cascade had already tombstoned and which this write does not touch.
   *
   * Only reachable with an edit in the buffer — an unchanged draft resolves to `unchanged` and
   * sends nothing — which is exactly the "fix the title, then decide it can go" path.
   *
   * It ends the SESSION rather than just nulling the ref, because the ref is reassigned on every
   * render and `editing` would arm it again on the next one. What that costs is one honest thing:
   * cancelling the confirmation leaves the row read-only showing its stored title, so a typed
   * edit abandoned in favour of a delete does not survive the cancel. Nothing is written and
   * nothing says otherwise — against a task that comes back from the dead wearing that edit.
   */
  const remove = () => {
    flush.current = null
    setDraft(null)
    onDelete(task)
  }

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
          canAdd={!task.promoted}
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
              onClick={remove}
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
