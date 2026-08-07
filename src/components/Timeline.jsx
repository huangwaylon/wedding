/**
 * The timeline. A Gantt, because start-and-end across a year is the one thing a list cannot
 * show: whether two things overlap, and where the gaps are.
 *
 * CSS flex plus percentages — no SVG and no chart library. The axis and every row share
 * `--timeline-gutter`, which is why the bars line up with the month ticks;
 * `.timeline__overlay` spans exactly the plot area, so a gridline and a bar at the same date
 * land on the same pixel without either doing arithmetic about the gutter.
 *
 * Four things carry the readability, and every one of them was missing at some point:
 *
 *   MONTH GRIDLINES, from the same tick list as the labels. Without them a bar's position is
 *   unreadable — the axis is at the top and the row you care about is far below it.
 *
 *   A STICKY AXIS AND A PINNED GUTTER. Fifty rows scroll well past the labels, and panning
 *   right used to take the task names with it, leaving fifty anonymous bars.
 *
 *   THE TODAY RULE IN THE ACCENT. In a countdown-driven app "where we are now" is the most
 *   important thing on the chart.
 *
 *   ZOOM. At 1x on a phone the plot is ~240px of visible width for a year: a one-week task is
 *   8px and nine of fifty bars sit on the 4px floor, so bar length stops encoding anything.
 *
 * SUBTASKS ARE NOT BARS. A subtask has a title and a tick and no dates at all, so on a time axis
 * it has neither position nor extent, and any bar drawn for one would assert a window the data
 * does not contain. Two honest things are drawn instead: a `3/5` tally under the parent's title,
 * which is what tells the reader that a tallied parent's fill is a COUNT rather than a clock
 * reading — and once the outline is opened, a 1px rail exactly co-extensive with the parent's
 * bar. The rail states the only date fact the model holds about a subtask, that it happens
 * somewhere inside that window, in a form too thin and too square to be mistaken for a bar.
 *
 * Bars are `--meter-height` with a rounded end, well under the 24px mark cap. Colour follows
 * STATE, not category: state is what somebody scans a timeline for, and a second categorical
 * encoding on the same mark would put two palettes in one chart. Colour is not the only
 * channel — the gutter carries a state dot and the row's accessible name states the state in
 * words, because a `title` tooltip does not exist on touch.
 */

import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { isDone } from '../schema.js'
import { planWindow, toPercent } from '../lib/progress.js'
import {
  formatWallMonthShort,
  formatWallRange,
  instantToWall,
  wallToInstant,
} from '../lib/time.js'
import { useT } from '../i18n/index.js'
import TaskDetailSheet from './TaskDetailSheet.jsx'
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  MinusIcon,
  PlusIcon,
  TargetIcon,
} from './icons.jsx'

/**
 * The zoom ladder. Discrete, not continuous: a slider would relayout fifty rows and a dozen
 * gridlines on every pointermove to reach in one gesture what five taps reach in five
 * layouts, and "0.62 of a timeline" is not a quantity anybody holds in their head.
 *
 * Zoom multiplies the PLOT'S WIDTH and nothing else. Narrowing the plan window instead would
 * clamp out-of-range bars to the edges — so a task running past the edge would look like it
 * ends there — and `min-width: 4px` would then render every out-of-window task as a phantom
 * stub pinned to the edge. Width-only keeps every position a percentage of the same window.
 */
const ZOOM_LADDER = [1, 1.5, 2, 3, 4, 6, 8]

/**
 * The narrowest a month label may sit from its neighbour.
 *
 * This used to be a fixed count of six, which was right for one width and wrong everywhere
 * else: at 8x it drew six gridlines across 2400px — one every 400px — so zooming in lost the
 * date reference at exactly the moment it was needed. A pixel budget is what the constant was
 * always trying to express. 72px covers the widest label the app renders: `2026年11月` at 13px
 * is about 66px, English `Nov 2026` about 50.
 */
const TICK_MIN_PX = 72

/**
 * The plot's width at 1x on a phone, in px: `.timeline__inner`'s 34rem (544) less the 7.5rem
 * label gutter (120) and the right padding (16).
 *
 * This is the FIRST-PAINT value and it has to be right rather than merely close. The measured
 * width only lands in a layout effect, so an optimistic default shows a frame of overlapping
 * month labels before correcting itself — and a static render (the preview harness, the render
 * tests) never runs effects at all, so this is the only number those ever see.
 */
const BASE_PLOT_PX = 408

/**
 * How to hang a label off its own position. Centred through the middle of the plot; flush at
 * either end, where half a centred label would sit outside it — and on the left that half
 * lands under the opaque sticky gutter and disappears.
 */
function edgeShift(fraction) {
  if (fraction < 0.08) return 'none'
  if (fraction > 0.92) return 'translateX(-100%)'
  return 'translateX(-50%)'
}

/**
 * Month boundaries inside the window, as fractions of it. Used twice — for the axis labels
 * and for the gridlines beneath them — from one list, so the two can never disagree.
 *
 * Each boundary is converted to a real instant through the board's zone, so a tick and the
 * bars beside it are positioned by the same arithmetic. Deriving one from wall-clock string
 * maths and the other from instants is how an axis ends up half a day out of step with its
 * data.
 *
 * @param {number} [plotPx] the plot's rendered width, which decides how many labels fit
 */
export function monthTicks(window, timeZone, plotPx = BASE_PLOT_PX) {
  const opening = instantToWall(window.min, timeZone)
  const [year, month] = opening.split('-').map(Number)
  const found = []

  // From the first boundary AFTER the window opens: a tick sitting exactly on the left edge is
  // half-clipped and says nothing the first bar does not.
  for (let index = 1; index <= 400; index += 1) {
    const boundary = new Date(Date.UTC(year, month - 1 + index, 1))
    const wall = `${boundary.getUTCFullYear()}-${String(boundary.getUTCMonth() + 1).padStart(2, '0')}-01T00:00`
    const instant = wallToInstant(wall, timeZone)
    if (instant >= window.max) break
    if (instant > window.min) found.push({ wall, fraction: (instant - window.min) / window.span })
  }

  const budget = Math.max(2, Math.floor(plotPx / TICK_MIN_PX))
  const step = Math.max(1, Math.ceil(found.length / budget))
  const kept = found.filter((_, index) => index % step === 0)

  return kept.map((tick, index) => ({
    ...tick,
    showYear: index === 0 || tick.wall.slice(0, 4) !== kept[index - 1].wall.slice(0, 4),
  }))
}

export default function Timeline({ tasks, nowMs, timeZone }) {
  const { t, locale } = useT()
  const scroller = useRef(null)
  const plot = useRef(null)
  /**
   * Ephemeral, deliberately. A per-device preference would have to go through the
   * `localStorage` wrappers in `config.js`, and relaunching into a stale 8x is worse than
   * relaunching at 1x.
   */
  const [zoomStep, setZoomStep] = useState(0)
  /** The date at the centre of the visible plot, carried across a zoom change. */
  const anchor = useRef(null)
  const [detail, setDetail] = useState(null)
  /**
   * Whether the checklists are open. ONE control for the whole chart, not one per parent:
   * `.timeline__row` is a `<button>`, whose content model is phrasing content, so a disclosure
   * inside a row would be a button inside a button and the parser would drop it — the same
   * failure as the nested `<form>` in `SubtaskList`. It is also fifty controls doing one job.
   *
   * Ephemeral, like `zoomStep`, and `false` has to be right on its own: a static render never
   * runs an effect, so the harness and the render tests only ever see this state.
   */
  const [outline, setOutline] = useState(false)
  /**
   * The plot's rendered width, which is what decides how many month labels fit.
   *
   * Measured, not derived. It is the inner width minus the label gutter minus the right
   * padding, and the gutter is a `clamp()` this component would otherwise have to
   * re-evaluate; feeding `monthTicks` the inner width instead over-estimated the room by
   * 136px at 1x and the first two labels overlapped. The constant is only the first paint.
   */
  const [plotPx, setPlotPx] = useState(BASE_PLOT_PX)

  const zoom = ZOOM_LADDER[zoomStep]
  const drawable = tasks.filter((task) => task.progress.scheduled)
  // No checklists anywhere on the board means no control for opening them.
  const anyTallied = drawable.some((task) => task.progress.tally)

  /**
   * Where the visible plot is centred, as a fraction of the plot's width. Measured rather
   * than derived from `--timeline-gutter`, which is a `clamp()` this component would
   * otherwise have to re-evaluate.
   */
  const readAnchor = useCallback(() => {
    const box = scroller.current
    const area = plot.current
    if (!box || !area || !area.offsetWidth) return null
    return (box.scrollLeft - area.offsetLeft + box.clientWidth / 2) / area.offsetWidth
  }, [])

  const changeZoom = useCallback(
    (delta) => {
      anchor.current = readAnchor()
      setZoomStep((step) => Math.min(ZOOM_LADDER.length - 1, Math.max(0, step + delta)))
    },
    [readAnchor],
  )

  /** Centre the visible plot on today — the one position always worth looking at. */
  const scrollToToday = useCallback(() => {
    const box = scroller.current
    const area = plot.current
    if (!box || !area) return
    const window = planWindow(drawable, nowMs)
    const fraction = Math.min(1, Math.max(0, (nowMs - window.min) / window.span))
    box.scrollLeft = area.offsetLeft + fraction * area.offsetWidth - box.clientWidth / 2
  }, [drawable, nowMs])

  /**
   * Restore the anchored date after a zoom change, and open on today.
   *
   * `useLayoutEffect` runs after the DOM mutation but before paint, so the scroll correction
   * is never visible as a jump. Writing `scrollLeft` mid-momentum is unreliable on iOS, but a
   * button tap means no finger is on the glass.
   *
   * Opening on today also keeps the scroller off `scrollLeft: 0`, where a rightward drag near
   * the left edge can trigger iOS's back-swipe — `overscroll-behavior-x` does not reliably
   * stop an OS-level gesture.
   */
  useLayoutEffect(() => {
    const box = scroller.current
    const area = plot.current
    if (!box || !area) return
    // Re-measured here rather than under a ResizeObserver: the width only changes on a zoom
    // step or a rotation, and a rotation is followed by the clock's own minute tick, which
    // re-renders and corrects it.
    if (area.offsetWidth && area.offsetWidth !== plotPx) setPlotPx(area.offsetWidth)
    if (anchor.current == null) {
      scrollToToday()
      return
    }
    box.scrollLeft = area.offsetLeft + anchor.current * area.offsetWidth - box.clientWidth / 2
    anchor.current = null
    // Only on a zoom change: re-anchoring on every tick would fight a finger mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomStep])

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
  const ticks = monthTicks(window, timeZone, plotPx)

  return (
    <>
      <section className="card card--flush" aria-label={t('timeline.title')}>
        {/* Outside the scroller, or it would pan away with the chart. */}
        <div className="timeline__toolbar">
          <span className="hint">{t('timeline.hint')}</span>
          <div className="timeline__zoom" role="group" aria-label={t('timeline.zoom')}>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => changeZoom(-1)}
              disabled={zoomStep === 0}
              aria-label={t('timeline.zoomOut')}
            >
              <MinusIcon />
            </button>
            {/* The level is announced rather than left to the buttons' disabled state. */}
            <span className="timeline__zoom-level" aria-live="polite">
              {zoom}&times;
            </span>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => changeZoom(1)}
              disabled={zoomStep === ZOOM_LADDER.length - 1}
              aria-label={t('timeline.zoomIn')}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="btn btn--icon"
              onClick={scrollToToday}
              aria-label={t('timeline.today')}
            >
              <TargetIcon />
            </button>
          </div>
        </div>

        <div
          className={`timeline${outline ? ' timeline--outline' : ''}`}
          ref={scroller}
          style={{ '--timeline-zoom': zoom }}
        >
          <div className="timeline__inner">
            <div className="timeline__axis">
              {/* The label column's own header, pinned in BOTH axes — which is where every
                  Gantt puts its outline level, and it costs the toolbar nothing. */}
              <span className="timeline__axis-gutter">
                {anyTallied ? (
                  <button
                    type="button"
                    className="timeline__outline"
                    aria-pressed={outline}
                    onClick={() => setOutline((open) => !open)}
                  >
                    <ChevronRightIcon className="timeline__outline-chevron" />
                    {t('timeline.outline')}
                  </button>
                ) : null}
              </span>
              <div className="timeline__ticks">
                {ticks.map((tick) => (
                  <span
                    className="timeline__tick"
                    key={tick.wall}
                    style={{
                      left: `${tick.fraction * 100}%`,
                      // Centred on its gridline, except near either end: half a centred label
                      // hangs past the plot, and on the left that half lands under the
                      // now-opaque sticky gutter and vanishes.
                      transform: edgeShift(tick.fraction),
                    }}
                  >
                    {formatWallMonthShort(tick.wall, { locale, year: tick.showYear })}
                  </span>
                ))}
                {/* The label belongs to the AXIS, not to the rule it names: in the plot it sat
                    at the top of the scroll content and scrolled out of sight the moment
                    somebody looked at row twenty. */}
                <span
                  className="timeline__now-label"
                  style={{
                    left: `${nowFraction * 100}%`,
                    // Anchored right of the rule, except near the right edge where that would
                    // run the pill off the chart.
                    transform: nowFraction > 0.85 ? 'translateX(calc(-100% + 2px))' : undefined,
                  }}
                >
                  {t('timeline.today')}
                </span>
              </div>
            </div>

            <div className="timeline__plot">
              <div className="timeline__overlay" aria-hidden="true" ref={plot}>
                {ticks.map((tick) => (
                  <span
                    className="timeline__gridline"
                    key={tick.wall}
                    style={{ left: `${tick.fraction * 100}%` }}
                  />
                ))}
                {/* One continuous rule across every row, not a segment per row: the reader's
                    own position in the plan is a single line. */}
                <span className="timeline__now" style={{ left: `${nowFraction * 100}%` }} />
              </div>

              {drawable.map((task) => {
                const left = Math.max(0, at(task.progress.startMs))
                const right = Math.min(1, at(task.progress.endMs))
                const width = Math.max(right - left, 0)
                const percent = toPercent(task.progress.percent)
                const tally = task.progress.tally
                const range = formatWallRange(task.start, task.end, {
                  allDay: task.allDay,
                  locale,
                  nowWall,
                  dash: t('common.dash'),
                })
                const state = t(`state.${task.progress.state}`)
                // A tallied row's fill is a count, so its accessible name has to say the count.
                const description = tally
                  ? t('timeline.rowLabelSubs', {
                      title: task.title,
                      range,
                      percent,
                      state,
                      subs: t('list.subtasks', { count: tally.total, done: tally.done }),
                    })
                  : t('timeline.rowLabel', { title: task.title, range, percent, state })

                // A fragment, so the child rows are the parent's SIBLINGS. Nested inside the
                // row's `<button>` they would be buttons inside a button; see `outline` above.
                return (
                  <Fragment key={task.id}>
                    <button
                      type="button"
                      className={`timeline__row timeline__row--${task.progress.state}`}
                      onClick={() => setDetail(task)}
                      aria-label={description}
                    >
                      <span className="timeline__label">
                        <span
                          className={`dot dot--${task.progress.state} timeline__dot`}
                          aria-hidden="true"
                        />
                        <span className="timeline__label-stack">
                          <span className="timeline__label-text">{task.title}</span>
                          {/* The tally is what makes the fill legible: for a task with no
                              checklist the fill's end lands on the today rule by construction,
                              so a tallied parent's fill sitting short of that rule is the
                              signal — and this is what tells the reader it is a count. */}
                          {tally ? (
                            <span className="timeline__label-tally tnum" aria-hidden="true">
                              {tally.done}/{tally.total}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="timeline__track">
                        <span
                          className="timeline__bar"
                          style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                        >
                          <span
                            className="timeline__bar-fill"
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                      </span>
                    </button>

                    {outline && tally
                      ? task.subtasks.map((subtask) => {
                          const ticked = isDone(subtask)
                          return (
                            <button
                              type="button"
                              key={subtask.id}
                              className={`timeline__row timeline__row--sub${
                                ticked ? ' timeline__row--sub-done' : ''
                              }`}
                              // The PARENT's sheet: it lists every item in full, which is what a
                              // 120px gutter cannot do.
                              onClick={() => setDetail(task)}
                              aria-label={t('timeline.subRowLabel', {
                                tick: t(ticked ? 'list.isDone' : 'list.isNotDone', {
                                  title: subtask.title,
                                }),
                                parent: task.title,
                              })}
                            >
                              <span className="timeline__label timeline__label--sub">
                                <span className="timeline__sub-tick" aria-hidden="true">
                                  {ticked ? <CheckCircleIcon /> : <CircleIcon />}
                                </span>
                                <span className="timeline__label-text">{subtask.title}</span>
                              </span>
                              <span className="timeline__track">
                                {/* The parent's own left/width — no new positional arithmetic,
                                    so zoom still multiplies one thing. */}
                                <span
                                  className="timeline__sub-rail"
                                  style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                                />
                              </span>
                            </button>
                          )
                        })
                      : null}
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {detail ? (
        <TaskDetailSheet task={detail} nowWall={nowWall} onClose={() => setDetail(null)} />
      ) : null}
    </>
  )
}
