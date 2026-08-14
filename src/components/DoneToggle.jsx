/**
 * The done control, and the only place one is built — a subtask needs exactly this from a task row,
 * and a copy would drift on whether a viewer's slot stays occupied (it must, or a planner's rows
 * shift 44px out of line with an editor's) and on which `aria-label` names the ACTION rather than
 * the state.
 *
 * The label names what the tap will do and carries the title, so a rotor full of these is
 * navigable; thirty buttons called "Mark done" is not. `children` render inside the control, so a
 * subtask makes its entire row the target rather than a 44px circle, and the `aria-label` still
 * wins over the visible text.
 */

import { useT } from '../i18n/index.js'
import { CheckCircleIcon, CircleIcon } from './icons.jsx'

/**
 * @param {string} props.title the task's own title, for the accessible name
 * @param {boolean} props.canEdit a viewer gets the same slot, as a static glyph
 * @param {React.ReactNode} [props.children] rendered inside the control, after the glyph, so a
 *   caller can make a whole row the target
 */
export default function DoneToggle({ done, title, canEdit, onToggle, className = '', children }) {
  const { t } = useT()
  const Glyph = done ? CheckCircleIcon : CircleIcon
  const state = `${className}${done ? ` ${className}--on` : ''}`

  const body = children ? (
    <>
      <Glyph />
      {children}
    </>
  ) : (
    <Glyph />
  )

  if (!canEdit) {
    /* `role="img"` with a name, not a bare span: the glyph is `aria-hidden` decoration and the only
       other channel is a line-through, which no screen reader reports. The name states the STATE,
       there being nothing to press. */
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
