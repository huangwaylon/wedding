/**
 * The timeline. A Gantt, because start-and-end across a year is the one thing a
 * list cannot show: whether two things overlap, and where the gaps are.
 *
 * This is the view for the planners' large monitors, and it is CSS grid plus
 * percentages — no SVG and no chart library. Every row shares `--timeline-gutter`
 * with the axis, which is why the bars line up with the month ticks; the plot area
 * is `100% - gutter` wide and every position is a fraction of it.
 *
 * Bars are 10px with a 4px-radius end, well under the 24px mark cap, and the band's
 * leftover is air. Colour follows STATE, not category: state is what somebody scans
 * a timeline for, and a second categorical encoding on the same mark would put two
 * palettes in one chart. Category stays in the list, as text.
 *
 * There is no legend, because the fill colours repeat the state that each row's own
 * title-attribute and `aria-label` already state in words — the identity channel is
 * text, throughout.
 */

import { planWindow, toPercent } from '../lib/progress.js'
import {
  formatWallMonthShort,
  formatWallRange,
  instantToWall,
  wallToInstant,
} from '../lib/time.js'
import { useT } from '../i18n/index.js'

/**
 * How many axis labels the narrowest plot area can hold without them touching.
 *
 * Six, and it is a real constraint rather than taste. `.timeline__inner` is 34rem wide at
 * its narrowest, the label gutter takes 7.5rem of that, so the plot is about 425px — and a
 * Japanese month reads '2026年11月'. Eight labels there overlapped into a smear. Six short
 * months fit with air between them at every width this renders at.
 */
const MAX_TICKS = 6

/**
 * Month boundaries inside the window, as fractions of it, for the axis ticks.
 *
 * Each boundary is converted to a real instant through the board's zone, so a tick and the
 * bars beside it are positioned by the same arithmetic — deriving one from wall-clock
 * string maths and the other from instants is how an axis ends up half a day out of step
 * with its data.
 *
 * Thinned to `MAX_TICKS` from the count rather than from a measured pixel width, because
 * this has to work without touching the DOM. `showYear` is set on the first tick and
 * wherever the year rolls over, so a plan spanning a new year says so exactly once.
 */
export function monthTicks(window, timeZone) {
  const opening = instantToWall(window.min, timeZone)
  const [year, month] = opening.split('-').map(Number)
  const found = []

  // From the first boundary AFTER the window opens: a tick sitting exactly on the left
  // edge is half-clipped and says nothing the first bar does not.
  for (let index = 1; index <= 400; index += 1) {
    const boundary = new Date(Date.UTC(year, month - 1 + index, 1))
    const wall = `${boundary.getUTCFullYear()}-${String(boundary.getUTCMonth() + 1).padStart(2, '0')}-01T00:00`
    const instant = wallToInstant(wall, timeZone)
    if (instant >= window.max) break
    if (instant > window.min) found.push({ wall, fraction: (instant - window.min) / window.span })
  }

  const step = Math.ceil(found.length / MAX_TICKS) || 1
  const kept = found.filter((_, index) => index % step === 0)

  return kept.map((tick, index) => ({
    ...tick,
    showYear: index === 0 || tick.wall.slice(0, 4) !== kept[index - 1].wall.slice(0, 4),
  }))
}

export default function Timeline({ tasks, nowMs, timeZone }) {
  const { t, locale } = useT()
  const drawable = tasks.filter((task) => task.progress.scheduled)

  if (!drawable.length) {
    return (
      <section className="card" aria-label={t('timeline.title')}>
        <p className="hint">{t('timeline.empty')}</p>
      </section>
    )
  }

  const window = planWindow(drawable, nowMs)
  const at = (instant) => (instant - window.min) / window.span
  const nowFraction = Math.min(1, Math.max(0, at(nowMs)))
  const nowWall = instantToWall(nowMs, timeZone)

  return (
    <section className="card card--flush" aria-label={t('timeline.title')}>
      <div className="timeline">
        <div className="timeline__inner">
          <div className="timeline__axis">
            <span />
            <div className="timeline__ticks">
              {monthTicks(window, timeZone).map((tick) => (
                <span
                  className="timeline__tick"
                  key={tick.wall}
                  style={{ left: `${tick.fraction * 100}%` }}
                >
                  {formatWallMonthShort(tick.wall, { locale, year: tick.showYear })}
                </span>
              ))}
            </div>
          </div>

          <div className="timeline__plot" style={{ '--now': nowFraction }}>
            {/* One continuous rule across every row, not a segment per row: the
                reader's own position in the plan is a single line. */}
            <div className="timeline__now" aria-hidden="true">
              <span className="timeline__now-label">{t('timeline.today')}</span>
            </div>

            {drawable.map((task) => {
              const left = Math.max(0, at(task.progress.startMs))
              const right = Math.min(1, at(task.progress.endMs))
              const width = Math.max(right - left, 0)
              const percent = toPercent(task.progress.percent)
              const range = formatWallRange(task.start, task.end, {
                allDay: task.allDay,
                locale,
                nowWall,
                dash: t('common.dash'),
              })
              const description = t('timeline.rowLabel', {
                title: task.title,
                range,
                percent,
                state: t(`state.${task.progress.state}`),
              })

              return (
                <div
                  className={`timeline__row timeline__row--${task.progress.state}`}
                  key={task.id}
                >
                  <span className="timeline__label" title={task.title}>
                    {task.title}
                  </span>
                  <div className="timeline__track">
                    <div
                      className="timeline__bar"
                      style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                      title={description}
                      role="img"
                      aria-label={description}
                    >
                      <div
                        className="timeline__bar-fill"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
