/**
 * The overall tracker: one hero figure, one meter with an on-schedule mark, and
 * four counts.
 *
 * WHY THE MARK IS NOT OPTIONAL. The headline percentage counts a task as 100% once
 * its window has run out, whether or not anybody finished it — that is what "time
 * elapsed" means, and it is what was asked for. On its own that number would read
 * as progress when it is really just the calendar advancing. The mark says where
 * the fill would sit if everything were exactly on schedule, and the overdue count
 * sits directly beneath: between the three, a board that is 78% "complete" with
 * nine overdue tasks cannot be mistaken for one that is 78% done.
 *
 * ONE HERO FIGURE PER VIEW, and this is it. Proportional figures, not tabular — a
 * standalone number at 44px+ looks loose in tabular digits.
 */

import { PACE_DEAD_BAND, paceLabel, toPercent } from '../lib/progress.js'
import { useT } from '../i18n/index.js'
import Meter from './Meter.jsx'

/** The four counts, in the order somebody scans them: problems first. */
const STATS = ['overdue', 'active', 'upcoming', 'done']

/**
 * @param {object} props
 * @param {object} props.overall from `overallProgress`
 * @param {boolean} [props.compact] one horizontal band instead of a tall card. Used in
 *   timeline view, where the full card pushed a thirty-row Gantt off the screen — there the
 *   summary is context, not the subject.
 */
export default function OverallCard({ overall, compact = false }) {
  const { t } = useT()
  const percent = toPercent(overall.percent)
  const expected = toPercent(overall.expected)

  if (!overall.total) {
    return (
      <section className="card overall" aria-labelledby="overall-title">
        <div className="card__head">
          <h2 className="card__title" id="overall-title">
            {t('overall.title')}
          </h2>
        </div>
        <p className="hint">{t('overall.empty')}</p>
      </section>
    )
  }

  const pace = paceLabel(overall.pace, overall.overdue)
  // The magnitude, not the signed value: the direction is already in the wording.
  const gap = Math.round(Math.abs(overall.pace) * 100)
  const paceText =
    pace === 'ontrack'
      ? t('overall.pace.ontrack')
      : pace === 'behind'
        ? t('overall.pace.behind', { count: overall.overdue })
        : t('overall.pace.ahead', { percent: gap })

  const meter = (
    <Meter
      value={overall.percent}
      mark={overall.expected}
      large
      label={t('overall.title')}
      valueText={`${percent}% — ${t('overall.expected', { percent: expected })}`}
    />
  )

  const stats = (
    /* dt BEFORE dd inside each group: the other order is invalid in a `dl` and pairs the four
       counts wrongly for a screen reader. `.stat` reverses them visually with
       `column-reverse`, so the number still reads above its label. */
    <dl className="overall__stats">
      {STATS.map((state) => (
        <div key={state} className={`stat${overall[state] ? '' : ' stat--zero'}`}>
          <dt className="stat__label">{t(`state.${state}`)}</dt>
          <dd className="stat__value tnum">
            <span className={`dot dot--${state}`} aria-hidden="true" />
            {overall[state]}
          </dd>
        </div>
      ))}
    </dl>
  )

  if (compact) {
    return (
      <section className="card overall overall--compact" aria-labelledby="overall-title">
        <div className="overall__lead">
          <h2 className="card__title" id="overall-title">
            {t('overall.title')}
          </h2>
          <p className="overall__figure">
            <span className="overall__percent">{percent}</span>
            <span className="overall__unit">%</span>
          </p>
          <p className="overall__pace">{paceText}</p>
        </div>
        <div className="overall__band">
          <div className="overall__meter">{meter}</div>
          {stats}
        </div>
      </section>
    )
  }

  return (
    <section className="card overall" aria-labelledby="overall-title">
      <div className="card__head">
        <h2 className="card__title" id="overall-title">
          {t('overall.title')}
        </h2>
        <span className="caption tnum">{t('overall.tasks', { count: overall.total })}</span>
      </div>

      <p className="overall__figure">
        <span className="overall__percent">{percent}</span>
        <span className="overall__unit">%</span>
      </p>

      <p className="overall__pace">{paceText}</p>

      <div className="overall__meter">{meter}</div>

      {/* The legend shows the mark rather than describing where it is, and it is
          only worth the line once the two numbers have actually diverged. */}
      {Math.abs(overall.pace) > PACE_DEAD_BAND ? (
        <p className="overall__legend">
          <span className="overall__legend-mark" aria-hidden="true" />
          {t('overall.expectedHint')}
        </p>
      ) : null}

      {stats}

      <p className="hint overall__method">{t('overall.method')}</p>
    </section>
  )
}
