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
 */
export default function DoneToggle({ done, title, canEdit, onToggle, className = '' }) {
  const { t } = useT()
  const Glyph = done ? CheckCircleIcon : CircleIcon
  const state = `${className}${done ? ` ${className}--on` : ''}`

  if (!canEdit) {
    return (
      <span className={`${state} ${className}--static`}>
        <Glyph />
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
      <Glyph />
    </button>
  )
}
