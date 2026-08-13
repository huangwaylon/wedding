/**
 * The hero: the photograph, who is getting married, how long there is left, and how far along
 * the board is. It is the app's only pinned chrome apart from the FAB.
 *
 * IT IS A BAND RATHER THAN A PLATE, AND IT STAYS ON SCREEN. A full-height photograph is the
 * nicer first impression and it costs the whole viewport on the one screen this app has — so
 * the photo is a tenth of the height and it does not scroll away. What that buys is a header
 * that always answers the three questions worth answering without scrolling back up: whose
 * wedding, how many days, how much is done.
 *
 * THE PROGRESS STRIP IS OUTSIDE THE PHOTOGRAPH ON PURPOSE. Every contrast figure for a meter
 * — the fill against `--track`, the hairline that identifies an empty one — is measured
 * against opaque tokens, and a photograph is the one backdrop in this app that cannot be
 * measured. So the strip sits below the image on `--surface`, where those numbers still hold,
 * and only the type over the photo relies on the scrim.
 *
 * The photograph is `alt=""` and not described — the `<h1>` beside it names the couple, so a
 * described photo would say the same thing twice to a screen reader.
 *
 * The countdown is counted in CALENDAR days in the board's zone (see `daysUntil`), so it flips
 * at midnight rather than at whatever o'clock the page happened to load.
 */

import { weddingDay } from '../config.js'
import { toPercent } from '../lib/progress.js'
import { daysUntil } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import Meter from './Meter.jsx'
import { GearIcon } from './icons.jsx'

/**
 * A `public/` asset, so it needs the deployed base — the site serves from `/wedding/` on
 * project Pages and from `/` in dev and under vitest.
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
 * @param {object} props.overall from `overallProgress`. The strip is withheld entirely on an
 *   empty board: a 0% bar measuring nothing is worse than no bar, and `EmptyBoard` is what
 *   that state has to say for itself.
 * @param {string} [props.photo] the photograph's URL. Only the preview harness passes one: its
 *   pages are written into `scripts/`, where the deployed absolute path resolves to nothing and
 *   the hero would screenshot as a bare gradient.
 */
export default function Hero({ config, nowMs, canEdit, overall, onOpenSettings, photo = PHOTO }) {
  const { t } = useT()
  const day = weddingDay(config)
  const days = day ? daysUntil(day, config.timezone, nowMs) : null

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
          /* The largest-contentful-paint element on the tab that opens first;
             `index.html` preloads the same URL. */
          fetchPriority="high"
          decoding="async"
        />
        <span className="hero__scrim" aria-hidden="true" />

        {/* On the photograph rather than in a bar of its own: a header band above the image
            would cost a row of chrome to hold one rarely-pressed control. */}
        <button
          type="button"
          className="hero__gear"
          onClick={onOpenSettings}
          aria-label={t('common.settings')}
        >
          <GearIcon />
        </button>

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
      </div>

      {overall?.total ? (
        <div className="hero__progress">
          <span className="hero__percent tnum">{toPercent(overall.percent)}%</span>
          <Meter
            value={overall.percent}
            mark={overall.expected}
            label={t('overall.title')}
            /* The mark has no visible label, so its meaning has to be in here — it is the only
               channel a screen reader has for the whole pace signal. */
            valueText={`${summary} — ${t('overall.expected', {
              count: overall.passed,
              total: overall.total,
            })}`}
          />
          {/* The count is what makes the percentage checkable by arithmetic. The app claims no
              pace: a single figure for that can be wrong, and a count cannot. */}
          <span className="hero__tally tnum">{summary}</span>
        </div>
      ) : null}
    </header>
  )
}
