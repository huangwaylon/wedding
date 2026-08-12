/**
 * The hero: the photograph, who is getting married, and how long there is left.
 *
 * The photograph is the first thing on screen and the reason the Home tab exists —
 * a planning board that opens on a progress bar reads like a project tracker. It is
 * `alt=""` and not described: the `<h1>` directly beneath it names the couple, so a
 * described photo would say the same thing twice to a screen reader while adding
 * nothing to it.
 *
 * The countdown is counted in CALENDAR days in the board's zone (see `daysUntil`),
 * so it flips at midnight rather than at whatever o'clock the page happened to load.
 */

import { weddingDay } from '../config.js'
import { daysUntil, formatDay } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import { GearIcon } from './icons.jsx'

/**
 * A `public/` asset, so it needs the deployed base — the site serves from
 * `/wedding/` on project Pages and from `/` in dev and under vitest.
 */
const PHOTO = `${import.meta.env.BASE_URL ?? '/'}hero.jpg`

/** The couple, however much of it has been filled in. */
export function coupleTitle(config, fallback) {
  const names = [config.partner1Name, config.partner2Name].map((name) => name.trim()).filter(Boolean)
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return names[0] || fallback
}

/**
 * @param {object} props
 * @param {string} [props.photo] the photograph's URL. Only the preview harness passes one:
 *   its pages are written into `scripts/`, where the deployed absolute path resolves to
 *   nothing and the hero would screenshot as a bare gradient.
 */
export default function Hero({ config, nowMs, canEdit, onOpenSettings, photo = PHOTO }) {
  const { t, locale } = useT()
  const day = weddingDay(config)
  const days = day ? daysUntil(day, config.timezone, nowMs) : null

  let countdown = t('countdown.unset')
  if (days != null) {
    if (days > 0) countdown = t('countdown.days', { count: days })
    else if (days === 0) countdown = t('countdown.today')
    else countdown = t('countdown.past', { count: -days })
  }

  return (
    <header className="hero">
      <img
        className="hero__img"
        src={photo}
        alt=""
        /* The largest-contentful-paint element on the tab that opens first;
           `index.html` preloads the same URL. */
        fetchPriority="high"
        decoding="async"
      />
      <span className="hero__scrim" aria-hidden="true" />

      {/* Over the photograph rather than in a bar of its own: a header band above a
          full-bleed image costs a row of chrome to hold one rarely-pressed control. */}
      <button
        type="button"
        className="hero__gear"
        onClick={onOpenSettings}
        aria-label={t('common.settings')}
      >
        <GearIcon />
      </button>

      <div className="hero__text">
        {/* The date, spelled out, above the names — the eyebrow slot Seattle puts its
            region in. Nothing at all until somebody sets it; a placeholder date on a
            wedding hero is worse than a gap. */}
        {day ? <p className="hero__eyebrow">{formatDay(day, { locale, year: true })}</p> : null}
        <h1 className="hero__title">{coupleTitle(config, t('app.name'))}</h1>
        <p className="hero__sub">
          <span className="hero__count tnum">{countdown}</span>
          {config.venue ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="hero__venue">{config.venue}</span>
            </>
          ) : null}
          {canEdit ? null : <span className="badge">{t('access.viewOnly')}</span>}
        </p>
      </div>
    </header>
  )
}
