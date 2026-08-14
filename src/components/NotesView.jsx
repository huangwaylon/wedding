/**
 * The notes tab: one shared markdown document, and the small editor that writes it.
 *
 * IT OPENS READ-ONLY, like a task row. Read mode is also the preview and the Edit toggle is also the
 * preview toggle, which is why there is no third mode and no split view: a side-by-side preview
 * halves a 361px column to ~180px, where a bulleted line wraps every three words. What read mode
 * shows is what everybody else sees.
 *
 * ONE WRITE PER SESSION, on Done, and nothing sent when the text is unchanged. Two divergences from
 * `TaskDetail`, both deliberate:
 *
 * No unmount flush. A row can be re-sorted or closed out from under its session, so its cleanup has
 * to write; a document cannot, because `App` withholds the tab bar for the whole session (the same
 * `typing` report that holds off a service-worker reload and hides the FAB), so Done is the only exit
 * and a half-finished paragraph is never written by a stray tap.
 *
 * No Cancel. A discard control over arbitrarily much of somebody else's text is worse than none, and
 * the real undo is the spreadsheet's own revision history.
 *
 * `onSave` is `saveConfig`, which has no optimistic half and confirms on a forced re-read, so the
 * session closes on a write that has landed rather than on one that might.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTES_MAX_CHARS } from '../config.js'
import { toggleBold, toggleBullets, toggleHeading, toggleItalic } from '../lib/markdown.js'
import { useT } from '../i18n/index.js'
import EditToggle from './EditToggle.jsx'
import Markdown from './Markdown.jsx'
import {
  BoldIcon,
  BulletsIcon,
  HeadingIcon,
  ICON_SIZE,
  ItalicIcon,
  NotebookIcon,
} from './icons.jsx'

/**
 * The toolbar, block-level marks first. Four buttons plus Done fits a 320pt column at the full 44px
 * target. Every one of them is a TOGGLE whose second press is its own inverse — a button that only
 * ever adds leaves no way back except selecting the asterisks by hand.
 */
const TOOLS = [
  { id: 'heading', label: 'notes.heading', Icon: HeadingIcon, apply: toggleHeading },
  { id: 'bullets', label: 'notes.bullets', Icon: BulletsIcon, apply: toggleBullets },
  { id: 'bold', label: 'notes.bold', Icon: BoldIcon, apply: toggleBold },
  { id: 'italic', label: 'notes.italic', Icon: ItalicIcon, apply: toggleItalic },
]

/**
 * The box follows its content: the page is the only scroller, so a fixed height would nest a second
 * one and a `dvh` height would resize under the caret every time the keyboard opens. The border is
 * added back because everything here is `border-box`, where `scrollHeight` covers content and padding
 * only and the box would come out two pixels short — enough for a scrollbar.
 */
function grow(node) {
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`
}

/**
 * @param {string} props.notes the stored document, markdown
 * @param {(notes: string) => Promise<boolean>} props.onSave
 * @param {boolean} [props.editing] the initial mode, a prop only because a static render fires no
 *   click and nothing else could see the editor
 */
export default function NotesView({
  notes,
  canEdit,
  onSave,
  onFieldFocus,
  editing: initiallyEditing = false,
}) {
  const { t } = useT()
  const stored = String(notes ?? '')
  /** `null` is read mode, so no second flag can disagree with it — as in `TaskDetail`. */
  const [draft, setDraft] = useState(() => (initiallyEditing ? stored : null))
  const [tooLong, setTooLong] = useState(false)
  const editing = draft !== null
  const field = useRef(null)

  /** Grown on mount, not in an effect: a ref callback runs in the same commit phase and, unlike
   *  `useLayoutEffect`, does not have to be explained to a server render. */
  const attach = useCallback((node) => {
    field.current = node
    if (node) grow(node)
  }, [])

  /** The session, not the field, reports `typing`: unsaved text exists with nothing focused, and a
   *  per-field report would drop the guard on the blur a toolbar tap does not even cause. */
  useEffect(() => {
    if (!editing) return undefined
    onFieldFocus?.(true)
    return () => onFieldFocus?.(false)
  }, [editing, onFieldFocus])

  const type = (event) => {
    setDraft(event.target.value)
    setTooLong(false)
    grow(event.target)
  }

  /**
   * A toolbar tap, applied to the DOM node as well as to state.
   *
   * React re-renders a controlled textarea from its value and the browser then parks the caret at the
   * end of it, so a transform that returned text alone would send somebody back to the bottom of the
   * document on every tap. Writing the value and the selection here means React's next render finds
   * the node already correct and leaves it — and the caret with it.
   */
  const run = (transform) => {
    const node = field.current
    if (!node) return
    const next = transform(node.value, node.selectionStart, node.selectionEnd)
    node.value = next.text
    node.setSelectionRange(next.start, next.end)
    setDraft(next.text)
    setTooLong(false)
    grow(node)
  }

  /** Not awaited: `App` reports the outcome as a toast. */
  const done = () => {
    // Trimmed, because both read paths trim on the way in: without it the first save after a stray
    // trailing newline would report a change every time.
    const next = draft.trim()
    if (next.length > NOTES_MAX_CHARS) {
      // The text stays on screen to be shortened, and the session stays open.
      setTooLong(true)
      return
    }
    setTooLong(false)
    setDraft(null)
    if (next !== stored) onSave(next)
  }

  return (
    <>
      {canEdit ? (
        <div className="notes__bar">
          {editing
            ? TOOLS.map(({ id, label, Icon, apply }) => (
                <button
                  key={id}
                  type="button"
                  className="btn btn--icon"
                  aria-label={t(label)}
                  title={t(label)}
                  /* Focus never leaves the field: without this the keyboard drops and the layout
                     jumps ~340px on every formatting tap, and the selection the transform needs is
                     gone by the time the click fires. */
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(apply)}
                >
                  <Icon />
                </button>
              ))
            : null}

          {/* One control, shared with a task row — see `EditToggle`. */}
          <EditToggle editing={editing} onToggle={() => (editing ? done() : setDraft(stored))} />
        </div>
      ) : null}

      {editing ? (
        <section className="card">
          <label className="label" htmlFor="notes-field">
            {t('notes.label')}
          </label>
          <textarea
            id="notes-field"
            ref={attach}
            className={`input textarea${tooLong ? ' input--invalid' : ''}`}
            value={draft}
            placeholder={t('notes.placeholder')}
            onChange={type}
            /* No autofocus: the tap that puts the caret chooses where it goes, and a focus() on a
               surface that re-renders per keystroke is how the iOS keyboard drops mid-word. */
          />
          {tooLong ? (
            <span className="field__error">
              {t('error.NOTES_TOO_LONG', { count: NOTES_MAX_CHARS })}
            </span>
          ) : null}
          {/* Here rather than anywhere else: this is the surface somebody is most likely to type a
              vendor's bank details into, and it is world-readable by design. */}
          <p className="hint notes__warning">{t('notes.public')}</p>
        </section>
      ) : stored ? (
        <section className="card">
          <Markdown text={stored} />
        </section>
      ) : (
        <section className="card empty">
          <p aria-hidden="true">
            <NotebookIcon className="empty__mark" style={ICON_SIZE.display} />
          </p>
          <h2 className="empty__title">{t('notes.emptyTitle')}</h2>
          {/* A viewer gets the sentence and nothing else: there is no control above for them, so a
              call to action would name something they cannot do. */}
          <p className="empty__body">{t(canEdit ? 'notes.emptyEditor' : 'notes.emptyViewer')}</p>
        </section>
      )}
    </>
  )
}
