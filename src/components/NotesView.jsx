/**
 * The notes tab: one shared markdown document, and the small editor that writes it.
 *
 * IT OPENS READ-ONLY, like a task row. Read mode is also the preview and the Edit toggle is also the
 * preview toggle, which is why there is no third mode and no split view: a side-by-side preview
 * halves a 361px column to ~180px, where a bulleted line wraps every three words.
 *
 * ONE WRITE PER SESSION, and THE SESSION WAITS FOR IT. `saveConfig` has no optimistic half, so
 * `notes` keeps its old value for the write plus the forced re-read; closing on the unawaited promise
 * put the pre-save document back on screen for a second and a half, and re-entering Edit inside that
 * window loaded the stale text — so the next Done wrote it back over the save that had just landed.
 * Settings waits for the same reason. A failure keeps the session open with the text in it, which is
 * better than a toast over a document that has silently reverted.
 *
 * Two divergences from `TaskDetail`, both deliberate:
 *
 * No unmount flush. A row can be re-sorted or closed out from under its session, so its cleanup has
 * to write; a document cannot, because `App` withholds the tab bar for the whole session, so Done is
 * the only exit and a half-finished paragraph is never written by a stray tap.
 *
 * No Cancel. A discard control over arbitrarily much of somebody else's text is worse than none, and
 * the real undo is the spreadsheet's own revision history.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTES_MAX_CHARS, notesError } from '../config.js'
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
  /** The refusal, as a code — `notesError`'s, so the catalog owns the wording. */
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  /**
   * A session needs the capability, not only the draft: the bar lives behind `canEdit`, so an editor
   * who opens Settings mid-session and switches to the read-only view would otherwise be left with the
   * field on screen, no Done, no toolbar and no tab bar — the gear the only way out. Dropping the
   * draft is the right cost of choosing to become a viewer.
   */
  const editing = canEdit && draft !== null
  const field = useRef(null)

  /** Grown on mount, not in an effect: a ref callback runs in the same commit phase and, unlike
   *  `useLayoutEffect`, does not have to be explained to a server render. The caret goes to the END,
   *  because a never-focused textarea reports a selection of 0,0 — so a toolbar tap before the field
   *  is touched would open its pair at the very start and turn the first heading into a paragraph. */
  const attach = useCallback((node) => {
    field.current = node
    if (!node) return
    node.setSelectionRange(node.value.length, node.value.length)
    grow(node)
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
    setError(null)
    grow(event.target)
  }

  /**
   * A toolbar tap, applied to the DOM node as well as to state.
   *
   * React re-renders a controlled textarea from its value and the browser then parks the caret at the
   * end of it, so a transform that returned text alone would send somebody back to the bottom of the
   * document on every tap. Writing the value and the selection here means React's next render finds
   * the node already correct and leaves it — and the caret with it.
   *
   * It focuses first, because `onMouseDown` is prevented and `setSelectionRange` does not focus: without
   * this the mark lands with no caret and no keyboard, so nothing can be typed into the pair it opened.
   */
  const run = (transform) => {
    const node = field.current
    if (!node) return
    node.focus()
    const next = transform(node.value, node.selectionStart, node.selectionEnd)
    node.value = next.text
    node.setSelectionRange(next.start, next.end)
    setDraft(next.text)
    setError(null)
    grow(node)
  }

  /**
   * Awaited, so the session ends on a write that has landed. `App` reports the outcome as a toast; a
   * failure leaves the text on screen to try again, since read mode would show the pre-save document.
   */
  const done = async () => {
    // Trimmed, because both read paths trim on the way in: without it the first save after a stray
    // trailing newline would report a change every time.
    const next = draft.trim()
    const refused = notesError(next)
    // The text stays on screen to be shortened, and the session stays open.
    setError(refused)
    if (refused) return
    if (next === stored) {
      setDraft(null)
      return
    }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok) setDraft(null)
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
          <EditToggle
            editing={editing}
            busy={saving}
            onToggle={() => (editing ? done() : setDraft(stored))}
          />
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
            className={`input textarea${error ? ' input--invalid' : ''}`}
            value={draft}
            placeholder={t('notes.placeholder')}
            onChange={type}
            /* No autofocus: the tap that puts the caret chooses where it goes, and a focus() on a
               surface that re-renders per keystroke is how the iOS keyboard drops mid-word. */
          />
          {error ? (
            <span className="field__error">{t(`error.${error}`, { count: NOTES_MAX_CHARS })}</span>
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
