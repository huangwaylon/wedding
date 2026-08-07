/**
 * The bottom sheet every dialog in the app uses. A sheet on a phone, a centred
 * dialog from 48rem — one component, decided in CSS.
 *
 * Escape closes it and a click on the scrim closes it; a click inside does not,
 * which is why the panel stops propagation rather than the scrim checking its
 * target. Focus moves to the panel on open so a keyboard user is not left behind
 * at the trigger, and `aria-modal` plus the `dialog` role is what tells a screen
 * reader the rest of the page is inert.
 *
 * Body scroll is locked while it is open. Without that, iOS scrolls the page
 * behind the sheet as soon as the panel's own content reaches its end.
 */

import { useEffect, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { CloseIcon } from './icons.jsx'

export default function BottomSheet({ title, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    panel.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="sheet" onClick={onClose}>
      <div
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__foot">{footer}</div> : null}
      </div>
    </div>
  )
}
