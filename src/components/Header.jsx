/**
 * The header: who is getting married, where, and how long there is left.
 *
 * The countdown is the one number that belongs above everything else, and it is
 * counted in CALENDAR days in the board's zone (see `daysUntil`) so it flips at
 * midnight rather than at whatever o'clock the page happened to load.
 */

import { weddingWall } from '../config.js'
import { daysUntil } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import { GearIcon } from './icons.jsx'

/** The couple, however much of it has been filled in. */
export function coupleTitle(config, fallback) {
  const names = [config.partner1Name, config.partner2Name].map((name) => name.trim()).filter(Boolean)
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return names[0] || fallback
}

export default function Header({ config, nowMs, canEdit, onOpenSettings }) {
  const { t } = useT()
  const wall = weddingWall(config)
  const days = wall ? daysUntil(wall, config.timezone, nowMs) : null

  let countdown = t('countdown.unset')
  if (days != null) {
    if (days > 0) countdown = t('countdown.days', { count: days })
    else if (days === 0) countdown = t('countdown.today')
    else countdown = t('countdown.past', { count: -days })
  }

  return (
    <header className="app__header">
      <div className="header__inner">
        <div className="header__text">
          <h1 className="header__title">{coupleTitle(config, t('app.name'))}</h1>
          <p className="header__sub">
            <span className="tnum">{countdown}</span>
            {config.venue ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="header__sub-text">{config.venue}</span>
              </>
            ) : null}
            {canEdit ? null : <span className="badge">{t('access.viewOnly')}</span>}
          </p>
        </div>
        <div className="header__actions">
          <button
            type="button"
            className="btn btn--icon"
            onClick={onOpenSettings}
            aria-label={t('common.settings')}
          >
            <GearIcon />
          </button>
        </div>
      </div>
    </header>
  )
}
