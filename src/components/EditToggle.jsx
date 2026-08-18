/**
 * The read/edit toggle. One control, two surfaces: a task row and the notes document.
 *
 * `aria-pressed` rather than two controls, so a screen reader is told this is a toggle and which way
 * it is set, and TWO WORDS rather than one — a toggle that does not say which way it will go is a
 * guess. The glyph is on Edit alone: Done is the commitment, and a pencil beside it would read as
 * "edit again".
 *
 * `margin-inline-start: auto` lives in its rule rather than at each call site, which is what makes it
 * the same control in both places: it sits last in a flex row and stays at the same x whether or not
 * a destructive control has appeared beside it.
 *
 * @param {boolean} [props.busy] the notes document waits for its write, having no optimistic half, so
 *   the control says so and refuses a second press; a task row's write is optimistic and never does
 */

import { useT } from '../i18n/index.js'
import { ICON_SIZE, PencilIcon } from './icons.jsx'

export default function EditToggle({ editing, busy = false, onToggle }) {
  const { t } = useT()

  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm edit-toggle"
      aria-pressed={editing}
      disabled={busy}
      onClick={onToggle}
    >
      {busy ? (
        t('common.saving')
      ) : editing ? (
        t('common.editDone')
      ) : (
        <>
          <PencilIcon style={ICON_SIZE.inline} />
          {t('common.edit')}
        </>
      )}
    </button>
  )
}
