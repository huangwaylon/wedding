/**
 * The header: photograph, couple, countdown, board progress. It and the FAB are the only pinned
 * chrome.
 *
 * `position: fixed`, not `sticky`: WebKit gives a sticky element no layer of its own, so a later
 * promoted element composites above it and the list draws over the photograph mid-flick.
 * Consequence: `.hero__progress` renders always — see below.
 *
 * The progress strip sits OUTSIDE the photograph, on `--surface`. Every measured meter figure (the
 * fill against `--track`, the hairline identifying an empty one) is against opaque tokens, and a
 * photograph cannot be measured; only the type over the photo relies on the scrim.
 *
 * `alt=""` because the `<h1>` beside it names the couple. `today` is a day string in the board's
 * zone, so the countdown is in calendar days and flips at midnight there.
 */

import { weddingDay } from '../config.js'
import { toPercent } from '../lib/progress.js'
import { daysBetween } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import Meter from './Meter.jsx'
import { GearIcon } from './icons.jsx'

/** A `public/` asset, so it needs the deployed base: `/wedding/` on project Pages, `/` in dev and
    under vitest. */
const PHOTO = `${import.meta.env.BASE_URL ?? '/'}hero.jpg`

/** The couple, however much of it has been filled in. */
export function coupleTitle(config, fallback) {
  const names = [config.partner1Name, config.partner2Name].map((name) => name.trim()).filter(Boolean)
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return names[0] || fallback
}

/**
 * @param {string} props.today today's date in the board's zone, from `useToday`
 * @param {object} props.overall from `overallProgress`; falsy `total` withholds the meter, not
 *   the strip
 * @param {string} [props.photo] only the preview harness passes one: its pages live in
 *   `scripts/`, where the deployed absolute path resolves to nothing
 */
export default function Hero({ config, today, canEdit, overall, onOpenSettings, photo = PHOTO }) {
  const { t } = useT()
  const day = weddingDay(config)
  const days = day ? daysBetween(today, day) : null

  let countdown = t('countdown.unset')
  if (days != null) {
    if (days > 0) countdown = t('countdown.days', { count: days })
    else if (days === 0) countdown = t('countdown.today')
    else countdown = t('countdown.past', { count: -days })
  }

  const summary = overall?.total
    ? t('overall.summary', { done: overall.done, count: overall.total })
    : ''

  return (
    <header className="hero">
      <div className="hero__photo">
        <img
          className="hero__img"
          src={photo}
          alt=""
          /* The largest-contentful-paint element on the tab that opens first; `index.html` preloads
             the same URL. */
          fetchPriority="high"
          decoding="async"
        />
        <span className="hero__scrim" aria-hidden="true" />

        <div className="hero__text">
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

        {/* On the photograph rather than in a bar of its own, which would cost a row of chrome for
            one rarely-pressed control. It follows `.hero__text` in the DOM because neither carries
            a z-index, so paint order — and hit-testing — is document order. */}
        <button
          type="button"
          className="hero__gear"
          onClick={onOpenSettings}
          aria-label={t('common.settings')}
        >
          <GearIcon />
        </button>
      </div>

      {/* Rendered ALWAYS, even empty, at a FIXED height: the header reserves no flow space, so
          `.views` pads by `--hero-height` and a strip that came and went would overstate the header
          by its own height. An empty board withholds the METER instead — a 0% bar measures nothing,
          and `EmptyBoard` is what that state says. */}
      <div className="hero__progress">
        {overall?.total ? (
          <>
            <span className="hero__percent tnum">{toPercent(overall.percent)}%</span>
            <Meter
              value={overall.percent}
              mark={overall.expected}
              label={t('overall.title')}
              /* The mark has no visible label, so its meaning goes here: a screen reader's only
                 channel for it. */
              valueText={`${summary} — ${t('overall.expected', {
                count: overall.passed,
                total: overall.total,
              })}`}
            />
            {/* The count makes the percentage checkable by arithmetic. No pace is claimed: one
                figure for that can be wrong, a count cannot. */}
            <span className="hero__tally tnum">{summary}</span>
          </>
        ) : null}
      </div>
    </header>
  )
}
