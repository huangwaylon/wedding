/**
 * A task's subtasks: the checklist inside the open card. Nesting is one level only, so nothing here
 * renders a checklist of its own. A subtask is a title and a tick, no date: hence no meter — a
 * dateless item has nothing for a bar to measure, and the parent's meter is where subtask progress
 * shows up — and no state badge. The add row never unmounts and never moves, new rows inserting
 * BEFORE it, which keeps the iOS keyboard up while somebody enters five in a row.
 *
 * A TITLE HOLDING A URL SPLITS THE ROW. Normally the whole row is the toggle, because an item is
 * tapped by aiming at its text and with only the 44px circle live that tap did nothing. A link cannot
 * live inside that button — HTML admits no interactive descendant in a `<button>`, and the parser
 * hoists the anchor out — and a URL somebody pasted is there to be followed. So a linked row is the
 * circle plus the link: the tick keeps its full 44px target, the words become the second target, and
 * `hasLink` is what chooses. Everything else keeps the whole row.
 */

import { useEffect, useRef, useState } from 'react'
import { isDone } from '../schema.js'
import { hasLink } from '../lib/links.js'
import { useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import { LinkedText } from './ExternalLink.jsx'
import { PlusIcon, TrashIcon } from './icons.jsx'

function SubtaskRow({ subtask, canEdit, canRemove, onToggle, onDelete }) {
  const { t } = useT()
  const done = isDone(subtask)
  const linked = hasLink(subtask.title)

  /** The same element either way, so the type, the ink and the strikethrough are one rule whether the
      words sit inside the toggle or beside it. */
  const title = (
    <span className="subtask__title">
      {linked ? <LinkedText text={subtask.title} /> : subtask.title}
    </span>
  )

  return (
    <li
      className={`subtask${linked ? ' subtask--linked' : ''}${done ? ' subtask--done' : ''}${
        subtask.pending ? ' subtask--pending' : ''
      }`}
    >
      {/* The whole row is the toggle, not the circle alone: an item is tapped by aiming at its
          text, and with only the 44px glyph live that tap did nothing. A linked row is the one
          exception — see the header. */}
      <DoneToggle
        done={done}
        title={subtask.title}
        canEdit={canEdit}
        onToggle={() => onToggle(subtask)}
        className="subtask__toggle"
      >
        {linked ? null : title}
      </DoneToggle>
      {linked ? title : null}
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
 * @param {boolean} [props.canAdd] whether a new item may be typed here: false on the READ path, so
 *   the field only appears once somebody has said they are editing the task — an always-present input
 *   made every open row look like a form, and the commonest reason to open one is to tick something.
 *   False too for a PROMOTED row, whose `parent_id` named something the read could not place: its
 *   items stay live, but a new child would be a grandchild, promoted again on the next read.
 * @param {boolean} [props.canRemove] false on the read path — ticking is doing the work, while
 *   removing is destructive and sits with the task's delete behind the Edit toggle.
 */
export default function SubtaskList({
  subtasks,
  canEdit,
  canAdd,
  canRemove,
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

