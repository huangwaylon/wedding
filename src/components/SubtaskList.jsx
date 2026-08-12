/**
 * A task's subtasks: the checklist inside the open card.
 *
 * A subtask is deliberately the lightest thing in the model — a title and a tick, no dates.
 * Two consequences the layout depends on:
 *
 *   NO METER. A dateless item has nothing for a bar to measure, so a meter here would encode
 *   exactly the one bit the tick 8px to its left already encodes. The parent's meter is where
 *   subtask progress shows up, because that is what it now measures.
 *
 *   NO STATE BADGE. A subtask is ticked or it is not.
 *
 * The add row is a form that never unmounts and never moves — new rows insert BEFORE it —
 * which is what keeps the iOS keyboard up while somebody enters five in a row. It does not
 * await the write before clearing: the optimistic update has already landed synchronously,
 * and awaiting would freeze the field for a second per item.
 */

import { useRef, useState } from 'react'
import { isDone } from '../schema.js'
import { useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import { PlusIcon, TrashIcon } from './icons.jsx'

function SubtaskRow({ subtask, canEdit, onToggle, onDelete }) {
  const { t } = useT()
  const done = isDone(subtask)

  return (
    <li className={`subtask${done ? ' subtask--done' : ''}${subtask.pending ? ' subtask--pending' : ''}`}>
      {/* THE WHOLE ROW IS THE TOGGLE, not the circle on its own. A checklist item is tapped by
          aiming at its text, and with only the 44px glyph live that tap did nothing — which is
          how this read as "clicking a subtask does not register it as done". The target is now
          the full width of the row minus the delete button. */}
      <DoneToggle
        done={done}
        title={subtask.title}
        canEdit={canEdit}
        onToggle={() => onToggle(subtask)}
        className="subtask__toggle"
      >
        <span className="subtask__title">{subtask.title}</span>
      </DoneToggle>
      {canEdit ? (
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => onDelete(subtask)}
          aria-label={t('list.deleteTask', { title: subtask.title })}
        >
          <TrashIcon />
        </button>
      ) : null}
    </li>
  )
}

function AddSubtask({ onAdd, onFocusChange }) {
  const { t } = useT()
  const [draft, setDraft] = useState('')
  const field = useRef(null)

  /**
   * Enter on the input, NOT a `<form>` submit.
   *
   * This list renders inside a card that also holds the editor's own fields, and HTML forbids
   * nested forms — the parser silently drops the inner one, so `Enter` here would reach the
   * ENCLOSING form's submit handler and try to save the task instead of adding an item. Found
   * by driving the real app; a static render cannot see it, because the nesting only becomes
   * invalid once a browser parses it.
   */
  const submit = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    // Not awaited: `run`'s optimistic update has already landed, so the row is on screen. The
    // field keeps focus and is ready for the next one.
    onAdd(title)
    // Every add pushes this field down a row, and with the keyboard up it walks underneath.
    // `nearest` will not yank the page when it is already comfortably visible.
    field.current?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <li className="subtask-add">
      <input
        ref={field}
        className="input subtask-add__field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          // Stops the keypress reaching an enclosing form.
          event.preventDefault()
          submit()
        }}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder={t('list.subtaskAdd')}
        aria-label={t('list.subtaskAdd')}
        autoComplete="off"
        enterKeyHint="done"
      />
      {/* A VISIBLE way to commit. Enter alone was the only route, with no button and no hint, so
          typing a subtask and then clicking away discarded it with no sign anything had happened
          — which is exactly how this read as "adding subtasks does not work". Disabled while the
          field is empty so it never looks like the thing to press first.

          `onMouseDown` with preventDefault, not `onClick`: the button would otherwise blur the
          field first, and blur is what closes the keyboard and hides this row on a phone. */}
      <button
        type="button"
        className="btn btn--icon subtask-add__submit"
        onMouseDown={(event) => event.preventDefault()}
        onClick={submit}
        disabled={!draft.trim()}
        aria-label={t('list.subtaskAdd')}
      >
        <PlusIcon />
      </button>
    </li>
  )
}

/**
 * @param {boolean} [props.canAdd] false when the DEPLOYED script has no `parent_id` column, so a
 *   subtask cannot be stored at all. The existing items stay live — they can still be ticked and
 *   deleted, which the old script handles fine — but there is no field, because offering one would
 *   invite somebody to type a checklist that gets thrown away. The banner says why.
 */
export default function SubtaskList({
  subtasks,
  canEdit,
  canAdd = true,
  onToggle,
  onDelete,
  onAdd,
  onFocusChange,
}) {
  return (
    <ul className="subtasks">
      {subtasks.map((subtask) => (
        <SubtaskRow
          key={subtask.id}
          subtask={subtask}
          canEdit={canEdit}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
      {/* Last, always, with a stable key — moving or remounting it drops the keyboard on iOS. */}
      {canEdit && canAdd ? <AddSubtask onAdd={onAdd} onFocusChange={onFocusChange} /> : null}
    </ul>
  )
}

