/**
 * A task's subtasks: the checklist inside the open card. Nesting is one level only, so nothing here
 * renders a checklist of its own. A subtask is a title and a tick, no date: hence no meter — a
 * dateless item has nothing for a bar to measure, and the parent's meter is where subtask progress
 * shows up — and no state badge. The add row never unmounts and never moves, new rows inserting
 * BEFORE it, which keeps the iOS keyboard up while somebody enters five in a row.
 */

import { useEffect, useRef, useState } from 'react'
import { isDone } from '../schema.js'
import { useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import { PlusIcon, TrashIcon } from './icons.jsx'

function SubtaskRow({ subtask, canEdit, canRemove, onToggle, onDelete }) {
  const { t } = useT()
  const done = isDone(subtask)

  return (
    <li className={`subtask${done ? ' subtask--done' : ''}${subtask.pending ? ' subtask--pending' : ''}`}>
      {/* The whole row is the toggle, not the circle alone: an item is tapped by aiming at its
          text, and with only the 44px glyph live that tap did nothing. */}
      <DoneToggle
        done={done}
        title={subtask.title}
        canEdit={canEdit}
        onToggle={() => onToggle(subtask)}
        className="subtask__toggle"
      >
        <span className="subtask__title">{subtask.title}</span>
      </DoneToggle>
      {canEdit && canRemove ? (
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
   * The focus report must balance across an unmount. This is the one per-field producer, sitting
   * outside any edit session, but React fires no blur for a focused input it removes — and closing
   * the card or leaving Edit removes this one. `typing` is a count, so an unreleased "on" hides the
   * FAB for the rest of the session; the ref makes the pair idempotent.
   */
  const focused = useRef(false)
  const report = (on) => {
    if (focused.current === on) return
    focused.current = on
    onFocusChange?.(on)
  }
  useEffect(() => () => report(false), [onFocusChange])

  /**
   * Enter on the input, not a `<form>` submit. This list renders inside a card holding the editor's
   * fields, and HTML forbids nested forms: the parser drops the inner one, so `Enter` would reach
   * the enclosing form's handler and save the task instead of adding an item. Invisible to a static
   * render, the nesting only becoming invalid once parsed.
   */
  const submit = () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    // Not awaited: the optimistic update has landed, so the row is on screen and keeps focus.
    onAdd(title)
    // Every add pushes this field down a row, and with the keyboard up it walks underneath;
    // `nearest` will not yank a page already showing it.
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
        onFocus={() => report(true)}
        onBlur={() => report(false)}
        placeholder={t('list.subtaskAdd')}
        aria-label={t('list.subtaskAdd')}
        autoComplete="off"
        enterKeyHint="done"
      />
      {/* A visible way to commit: with Enter the only route, typing a subtask and clicking away
          discarded it silently. `onMouseDown` with preventDefault, not `onClick`: the button would
          otherwise blur the field, and blur closes the keyboard and hides this row on a phone. */}
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
 * @param {boolean} [props.canAdd] false for a PROMOTED row, whose `parent_id` named something
 *   the read could not place: its items stay live, but a new child would be a grandchild,
 *   promoted again on the next read.
 * @param {boolean} [props.canRemove] false on the read path — ticking and adding are doing the
 *   work, while removing is destructive and sits with the task's delete behind the Edit toggle.
 */
export default function SubtaskList({
  subtasks,
  canEdit,
  canAdd = true,
  canRemove = true,
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
          canRemove={canRemove}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
      {/* Last, always, with a stable key — moving or remounting it drops the keyboard on iOS. */}
      {canEdit && canAdd ? <AddSubtask onAdd={onAdd} onFocusChange={onFocusChange} /> : null}
    </ul>
  )
}

