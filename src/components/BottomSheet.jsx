/**
 * The bottom sheet every dialog uses. A sheet on a phone, a centred dialog from 48rem; one
 * component, decided in CSS.
 *
 * Escape and a click on the scrim close it; a click inside does not, which is why the panel stops
 * propagation rather than the scrim checking its target. Focus moves to the panel on open so a
 * keyboard user is not left at the trigger, and `aria-modal` with the `dialog` role tells a screen
 * reader the rest of the page is inert.
 *
 * The effect runs ONCE and reads `onClose` through a ref. `onClose` is an inline arrow at every
 * call site, so as a dependency it re-runs the body on every parent render, and each re-run pulls
 * focus off the field being typed in — on iOS that drops the keyboard and loses the caret mid-word.
 * Body scroll is locked while it is open, or iOS scrolls the page behind the sheet as soon as the
 * panel's content reaches its end.
 */

import { useEffect, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { CloseIcon } from './icons.jsx'

export default function BottomSheet({ title, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close.current()
    }
    document.addEventListener('keydown', onKeyDown)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    panel.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [])

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
