/**
 * The done toggle, and the only place it is built.
 *
 * Extracted because a subtask needs exactly this and nothing else from a task row. Copied, the
 * two versions would drift on the details that matter least and break hardest: whether a
 * viewer's slot stays occupied (it must, or a planner's rows shift 44px out of line with an
 * editor's) and which of the two aria-labels describes the ACTION rather than the state.
 *
 * The label names what the tap will do and carries the title, so a rotor full of these is
 * navigable — thirty buttons all called "Mark done" is not.
 *
 * IT CAN SWALLOW ITS OWN LABEL. Pass `children` and they render inside the control, which is how
 * a subtask makes its ENTIRE row the target rather than a 44px circle at the end of it. That was
 * reported as "clicking a subtask does not register it as done": tapping the title — the obvious
 * thing to aim at on a checklist — did nothing at all, and a real tap test confirmed it. The
 * `aria-label` still wins over the visible text for a screen reader, and it should: it names the
 * action, where the text only names the item.
 */

import { useT } from '../i18n/index.js'
import { CheckCircleIcon, CircleIcon } from './icons.jsx'

/**
 * @param {object} props
 * @param {boolean} props.done
 * @param {string} props.title the task's own title, for the accessible name
 * @param {boolean} props.canEdit a viewer gets the same slot, as a static glyph
 * @param {() => void} props.onToggle
 * @param {string} [props.className] the caller's own block-scoped class
 * @param {React.ReactNode} [props.children] rendered INSIDE the control, after the glyph, so a
 *   caller can make a whole row the target instead of just the glyph. See the note above.
 */
export default function DoneToggle({ done, title, canEdit, onToggle, className = '', children }) {
  const { t } = useT()
  const Glyph = done ? CheckCircleIcon : CircleIcon
  const state = `${className}${done ? ` ${className}--on` : ''}`

  /**
   * The glyph alone unless a label was passed, so the bare case renders exactly the markup it
   * always did and nothing about the task row changed.
   */
  const body = children ? (
    <>
      <Glyph />
      {children}
    </>
  ) : (
    <Glyph />
  )

  if (!canEdit) {
    /**
     * `role="img"` with a name, not a bare span. The glyph is `aria-hidden` decoration and the
     * only other channel is a line-through, which no screen reader reports — so a viewer's
     * checklist read out as five titles with no way to tell a ticked item from an open one.
     * The name states the STATE rather than an action, because there is nothing here to press.
     */
    return (
      <span
        className={`${state} ${className}--static`}
        role="img"
        aria-label={t(done ? 'list.isDone' : 'list.isNotDone', { title })}
      >
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={state}
      onClick={onToggle}
      aria-pressed={done}
      aria-label={t(done ? 'list.markNotDone' : 'list.markDone', { title })}
    >
      {body}
    </button>
  )
}
