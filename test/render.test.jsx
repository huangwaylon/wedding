/**
 * Components rendered to static markup — no DOM, no browser.
 *
 * What this catches: a component that throws on a real prop shape, or silently drops
 * data. What it cannot catch: focus, scrolling, or anything that looks wrong. Do not
 * fake a DOM to try — `scripts/preview.jsx` and a screenshot are the answer to the
 * second, and that is why it exists.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { STATE, overallProgress, withProgress } from '../src/lib/progress.js'
import { wallToInstant } from '../src/lib/time.js'
import { setLocale } from '../src/i18n/index.js'
import { DEFAULT_LOCALE } from '../src/i18n/catalogs.js'
import Controls, { FILTER_ALL, VIEWS } from '../src/components/Controls.jsx'
import { ConfirmDeleteSheet, DeletedList } from '../src/components/Deleted.jsx'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import Header, { coupleTitle } from '../src/components/Header.jsx'
import Meter from '../src/components/Meter.jsx'
import Notice from '../src/components/Notice.jsx'
import OverallCard from '../src/components/OverallCard.jsx'
import StateBadge from '../src/components/StateBadge.jsx'
import TaskList from '../src/components/TaskList.jsx'
import TaskRow from '../src/components/TaskRow.jsx'
import { draftToWindow } from '../src/components/TaskFormSheet.jsx'
import TaskDetailSheet from '../src/components/TaskDetailSheet.jsx'
import Timeline, { monthTicks } from '../src/components/Timeline.jsx'
import Toasts from '../src/components/Toasts.jsx'

const TOKYO = 'Asia/Tokyo'
const NOW = wallToInstant('2027-01-06T00:00', TOKYO)
const NOW_WALL = '2027-01-06T00:00'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

function task(overrides = {}) {
  return {
    id: 'a',
    title: 'Book the venue',
    category: 'Venue',
    start: '2027-01-01T00:00',
    end: '2027-01-11T23:59',
    allDay: true,
    doneAt: '',
    notes: '',
    owner: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: '',
    ...overrides,
  }
}

const rows = (list) => withProgress(list, NOW, TOKYO)

/** A dateless checklist item under `parent`. */
function sub(parent, id, done = false) {
  return task({
    id: `${parent}-${id}`,
    title: `Step ${id}`,
    start: '',
    end: '',
    parentId: parent,
    doneAt: done ? '2027-01-02T00:00:00.000Z' : '',
  })
}
const noop = () => {}

describe('Meter', () => {
  it('carries the progressbar role and a spoken value', () => {
    // Not a native <progress> element: Safari's cannot take a second mark, and the
    // on-schedule tick is the whole reason the component exists. But it must be
    // `progressbar`, not `meter` — ARIA reserves `meter` for a gauge rather than a value
    // advancing toward completion, and iOS VoiceOver maps it patchily enough that an
    // unrecognised one takes the label and value down with it.
    const html = renderToStaticMarkup(
      <Meter value={0.42} label="Overall" valueText="42% complete" />,
    )
    expect(html).toContain('role="progressbar"')
    expect(html).not.toContain('role="meter"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('aria-valuetext="42% complete"')
    expect(html).toContain('width:42%')
  })

  it('draws the mark only when one is given', () => {
    expect(renderToStaticMarkup(<Meter value={0.4} label="x" />)).not.toContain('meter__mark')
    const marked = renderToStaticMarkup(<Meter value={0.4} mark={0.6} large label="x" />)
    expect(marked).toContain('meter__mark')
    expect(marked).toContain('left:60%')
  })

  it('clamps rather than overflowing its track', () => {
    expect(renderToStaticMarkup(<Meter value={4} label="x" />)).toContain('width:100%')
    expect(renderToStaticMarkup(<Meter value={-1} label="x" />)).toContain('width:0%')
  })
})

describe('StateBadge', () => {
  it('states the state in words, not only in colour', () => {
    // The whole accessibility argument for the badge: a viewer who cannot separate the
    // green from the red reads the same thing.
    for (const state of Object.values(STATE)) {
      const html = renderToStaticMarkup(<StateBadge state={state} />)
      expect(html).toContain(`badge--${state}`)
      expect(html).toMatch(/>[^<]+<\/span>$/)
    }
  })
})

describe('OverallCard', () => {
  it('shows the hero figure, the counts and the method', () => {
    const overall = overallProgress(rows([task({ id: 'a' }), task({ id: 'b' })]))
    const html = renderToStaticMarkup(<OverallCard overall={overall} />)
    expect(html).toContain('overall__percent')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('Every task counts equally')
  })

  it('never shows a bare 100% for a board that is only overdue', () => {
    // The single most dangerous reading in the app. The percentage is the clock, and the
    // overdue count is what stops it being mistaken for a finished plan — so both have
    // to be in the markup.
    const overall = overallProgress(
      rows([
        task({ id: 'a', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
        task({ id: 'b', start: '2026-01-01T00:00', end: '2026-02-01T00:00' }),
      ]),
    )
    const html = renderToStaticMarkup(<OverallCard overall={overall} />)
    expect(overall.percent).toBe(1)
    expect(html).toContain('Overdue')
    expect(html).toMatch(/dot--overdue/)
    // The count itself, not just the label.
    expect(html).toMatch(/dot dot--overdue"[^>]*><\/span>2/)
    // And it must not claim to be on schedule — see paceLabel. Checked on the pace line
    // specifically: the meter's aria-valuetext legitimately names the on-schedule mark.
    const pace = /class="overall__pace">([^<]*)</.exec(html)[1]
    expect(pace).toContain('past their date')
    expect(pace).not.toContain('On schedule')
  })

  it('renders an empty board without dividing by zero', () => {
    const html = renderToStaticMarkup(<OverallCard overall={overallProgress([])} />)
    expect(html).toContain('Nothing to measure yet')
    expect(html).not.toContain('NaN')
  })

  it('explains the mark only once the two figures diverge', () => {
    const level = overallProgress(rows([task({ id: 'a' }), task({ id: 'b' })]))
    expect(renderToStaticMarkup(<OverallCard overall={level} />)).not.toContain(
      'overall__legend-mark',
    )

    const ahead = overallProgress(
      rows([task({ id: 'a', doneAt: '2027-01-02T00:00:00.000Z' }), task({ id: 'b' })]),
    )
    expect(renderToStaticMarkup(<OverallCard overall={ahead} />)).toContain(
      'overall__legend-mark',
    )
  })
})

describe('TaskRow', () => {
  const [row] = rows([task()])

  it('renders the title, the window, the state and the percentage as TEXT', () => {
    const html = renderToStaticMarkup(
      <TaskRow task={row} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).toContain('Book the venue')
    expect(html).toContain('In progress')
    // The percentage is beside the bar, not a label on it: at 13px it does not fit
    // inside an 8px fill.
    expect(html).toMatch(/task__percent[^>]*>\d+%/)
  })

  it('hides every control from a viewer but keeps the row aligned', () => {
    const html = renderToStaticMarkup(
      <TaskRow task={row} nowWall={NOW_WALL} canEdit={false} onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).not.toContain('<button')
    // The check slot is still occupied, so a planner's list lines up with an editor's
    // instead of shifting 36px.
    expect(html).toContain('task__check--static')
  })

  it('labels the toggle by what it will do', () => {
    const open = renderToStaticMarkup(
      <TaskRow task={row} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    // The title is interpolated now: thirty buttons all called "Mark done" is not navigable by
    // the VoiceOver rotor, unlike the Edit/Delete buttons beside them which always carried it.
    expect(open).toContain('aria-label="Mark Book the venue done"')

    const [done] = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    const closed = renderToStaticMarkup(
      <TaskRow task={done} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(closed).toContain('aria-label="Mark Book the venue not done"')
    expect(closed).toContain('task--done')
  })

  it('says so when a task has no usable window', () => {
    const [none] = rows([task({ start: '', end: '' })])
    const html = renderToStaticMarkup(
      <TaskRow task={none} nowWall={NOW_WALL} canEdit={false} onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).toContain('No dates set')
  })

  it('renders notes and an owner when present, and nothing when not', () => {
    const [full] = rows([task({ notes: 'call first', owner: 'Aoi' })])
    const html = renderToStaticMarkup(
      <TaskRow task={full} nowWall={NOW_WALL} canEdit={false} onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).toContain('call first')
    expect(html).toContain('Aoi')

    const bare = renderToStaticMarkup(
      <TaskRow task={row} nowWall={NOW_WALL} canEdit={false} onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(bare).not.toContain('task__notes')
  })

  it('marks an unsaved row without hiding it', () => {
    const [pending] = rows([{ ...task(), pending: true }])
    const html = renderToStaticMarkup(
      <TaskRow task={pending} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).toContain('task--pending')
    expect(html).toContain('Book the venue')
  })
})

describe('subtasks in a task row', () => {
  const parented = (subs) => rows([task({ id: 'p' }), ...subs])[0]
  const render = (row, extra = {}) =>
    renderToStaticMarkup(
      <TaskRow
        task={row}
        nowWall={NOW_WALL}
        canEdit
        expanded={false}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onExpand={noop}
        onAddSubtask={noop}
        onSubtaskFocus={noop}
        {...extra}
      />,
    )

  it('shows no disclosure at all when a task has none', () => {
    // The load-bearing decision: a freshly seeded 52-task board adds zero pixels.
    expect(render(parented([]))).not.toContain('task__subs')
  })

  it('labels the disclosure with the tally', () => {
    const html = render(parented([sub('p', 1, true), sub('p', 2), sub('p', 3)]))
    expect(html).toContain('1 of 3 subtasks')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="subs-p"')
  })

  it('pluralises the tally rather than using a count === 1 ternary', () => {
    expect(render(parented([sub('p', 1)]))).toContain('0 of 1 subtask')
  })

  it('renders the list only when expanded, and wires it to the disclosure', () => {
    expect(render(parented([sub('p', 1)]))).not.toContain('class="subtasks"')
    const open = render(parented([sub('p', 1)]), { expanded: true })
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('id="subs-p"')
    expect(open).toContain('Step 1')
  })

  it('gives a subtask a check and a delete, but no meter and no badge', () => {
    // A dateless item has nothing for a bar to measure, and a meter would encode exactly the
    // one bit the checkbox beside it already does.
    const open = render(parented([sub('p', 1)]), { expanded: true })
    // Bounded to the list: everything after it is the PARENT's own meter, which of course has
    // a progressbar — slicing to the end read that and passed for the wrong reason.
    const start = open.indexOf('class="subtasks"')
    const list = open.slice(start, open.indexOf('</ul>', start))
    expect(list).toContain('subtask__check')
    expect(list).toContain('aria-label="Delete Step 1"')
    expect(list).not.toContain('role="progressbar"')
    expect(list).not.toContain('class="badge')
  })

  it('adds with Enter rather than a nested form', () => {
    // This list also renders inside the task form's own <form>, and HTML forbids nested forms:
    // the parser drops the inner one, so Enter reached the TASK form's submit and tried to save
    // the task. A static render cannot catch that — the nesting only becomes invalid once a
    // browser parses it — so the shape is pinned here instead.
    const open = render(parented([sub('p', 1)]), { expanded: true })
    const start = open.indexOf('class="subtasks"')
    expect(open.slice(start, open.indexOf('</ul>', start))).not.toContain('<form')
  })

  it('offers the add row to an editor and not to a viewer', () => {
    const open = render(parented([sub('p', 1)]), { expanded: true })
    expect(open).toContain('subtask-add__field')
    const viewer = renderToStaticMarkup(
      <TaskRow
        task={parented([sub('p', 1)])}
        nowWall={NOW_WALL}
        canEdit={false}
        expanded
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onExpand={noop}
        onAddSubtask={noop}
        onSubtaskFocus={noop}
      />,
    )
    expect(viewer).not.toContain('subtask-add__field')
    // But the check slot stays occupied, so the two lists line up.
    expect(viewer).toContain('subtask__check--static')
  })

  it('drives the parent meter from the tally, not the clock', () => {
    // The window is half elapsed; three of four are ticked.
    const row = parented([sub('p', 1, true), sub('p', 2, true), sub('p', 3, true), sub('p', 4)])
    const html = render(row)
    expect(html).toMatch(/task__percent[^>]*>75%/)
    expect(html).toContain('width:75%')
  })
})

describe('TaskList', () => {
  it('groups by month and keeps every task', () => {
    const list = rows([
      task({ id: 'a', start: '2027-01-01T00:00', end: '2027-01-31T23:59' }),
      task({ id: 'b', title: 'Order invitations', start: '2027-03-01T00:00', end: '2027-03-31T23:59' }),
    ])
    const html = renderToStaticMarkup(
      <TaskList tasks={list} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html).toContain('January 2027')
    expect(html).toContain('March 2027')
    expect(html).toContain('Book the venue')
    expect(html).toContain('Order invitations')
  })

  it('collects undated tasks in their own group, last', () => {
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Someday', start: '', end: '' })])
    const html = renderToStaticMarkup(
      <TaskList tasks={list} nowWall={NOW_WALL} canEdit={false} onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(html.indexOf('January 2027')).toBeLessThan(html.indexOf('No dates set'))
  })

  it('renders nothing rather than an empty shell', () => {
    expect(
      renderToStaticMarkup(
        <TaskList tasks={[]} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
      ),
    ).toBe('')
  })
})

describe('Timeline', () => {
  it('draws a bar per dated task, positioned as a fraction of the window', () => {
    const list = rows([
      task({ id: 'a', start: '2027-01-01T00:00', end: '2027-02-01T23:59' }),
      task({ id: 'b', title: 'Order invitations', start: '2027-03-01T00:00', end: '2027-04-01T23:59' }),
    ])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    expect(html.match(/timeline__bar"/g)).toHaveLength(2)
    expect(html).toContain('timeline__now')
    expect(html).toContain('Today')
  })

  it('describes every bar in words, so colour is never the only channel', () => {
    const list = rows([task()])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    expect(html).toMatch(/aria-label="Book the venue: [^"]*% complete, In progress"/)
  })

  it('makes every row a button, because touch has no hover and no tooltip', () => {
    // Both the label's and the bar's `title` are dead on touch, so a task's dates, percentage
    // and state were reachable by no gesture at all. The row is the trigger.
    const list = rows([task()])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    expect(html).toMatch(/<button[^>]*class="timeline__row/)
    expect(html).toContain('type="button"')
  })

  it('carries a state dot in the gutter, so state is not colour alone', () => {
    // The bar's colour is the only other state channel and its `title` never renders on a
    // phone, which would leave a filled green bar and a filled red one identical.
    const list = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    expect(html).toMatch(/dot dot--done timeline__dot/)
  })

  it('offers zoom controls outside the scroller', () => {
    const list = rows([task()])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    const toolbar = html.slice(0, html.indexOf('class="timeline"'))
    expect(toolbar).toContain('aria-label="Zoom in"')
    expect(toolbar).toContain('aria-label="Zoom out"')
    // Opens at 1x and cannot zoom out below it.
    expect(toolbar).toMatch(/aria-label="Zoom out"[^>]*disabled|disabled[^>]*aria-label="Zoom out"/)
    expect(html).toContain('--timeline-zoom:1')
  })

  it('skips undated tasks and says so when nothing is drawable', () => {
    const list = rows([task({ start: '', end: '' })])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    expect(html).toContain('Nothing with dates to draw yet')
  })

  it('keeps the today line inside the plot', () => {
    // A marker off the edge reads as broken, which is why planWindow always contains now.
    const list = rows([task({ start: '2027-01-01T00:00', end: '2027-02-01T23:59' })])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    const now = Number(/timeline__now"[^>]*left:([\d.]+)%/.exec(html)[1])
    expect(now).toBeGreaterThanOrEqual(0)
    expect(now).toBeLessThanOrEqual(100)
  })

  it('puts the Today label in the axis, not in the scrolling plot', () => {
    // In the plot it sat at the top of the scroll content and scrolled out of sight the
    // moment somebody looked at row twenty — which is exactly when knowing where today is
    // matters. The axis is sticky, so it belongs there.
    const list = rows([task({ start: '2027-01-01T00:00', end: '2027-09-01T23:59' })])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    const axis = html.slice(html.indexOf('timeline__axis'), html.indexOf('timeline__plot'))
    expect(axis).toContain('timeline__now-label')
    expect(axis).toContain('Today')
    // And the bare rule stays in the plot, spanning the rows.
    const plot = html.slice(html.indexOf('timeline__plot'))
    expect(plot).toContain('timeline__now"')
    expect(plot).not.toContain('timeline__now-label')
  })

  it('draws one gridline per axis tick, from the same list as the labels', () => {
    // Two lists would drift, and a gridline half a month from its own label is worse than
    // no gridline at all.
    const list = rows([task({ start: '2027-01-01T00:00', end: '2027-09-01T23:59' })])
    const html = renderToStaticMarkup(<Timeline tasks={list} nowMs={NOW} timeZone={TOKYO} />)
    const ticks = html.match(/timeline__tick"/g) ?? []
    const lines = html.match(/timeline__gridline"/g) ?? []
    expect(ticks.length).toBeGreaterThan(1)
    expect(lines).toHaveLength(ticks.length)
  })
})

describe('monthTicks', () => {
  const window = (fromWall, toWall) => {
    const min = wallToInstant(fromWall, TOKYO)
    const max = wallToInstant(toWall, TOKYO)
    return { min, max, span: max - min }
  }

  it('lands one tick on each month boundary inside the window', () => {
    const ticks = monthTicks(window('2027-01-15T00:00', '2027-05-15T00:00'), TOKYO)
    expect(ticks.map((tick) => tick.wall)).toEqual([
      '2027-02-01T00:00',
      '2027-03-01T00:00',
      '2027-04-01T00:00',
      '2027-05-01T00:00',
    ])
  })

  it('never emits a tick outside the window', () => {
    for (const tick of monthTicks(window('2027-01-15T00:00', '2028-06-15T00:00'), TOKYO)) {
      expect(tick.fraction).toBeGreaterThan(0)
      expect(tick.fraction).toBeLessThan(1)
    }
  })

  it('thins a long plan to a PIXEL budget, not a fixed count', () => {
    // Three years is thirty-six months. The budget is the plot's width over the widest label
    // the app renders (`2026年11月` at 13px, ~66px), so it has to grow with zoom — a fixed six
    // drew six gridlines across 2400px at 8x, losing the date reference exactly when zooming
    // in was supposed to provide it.
    const span = window('2026-01-01T00:00', '2029-01-01T00:00')
    const narrow = monthTicks(span, TOKYO, 544)
    const wide = monthTicks(span, TOKYO, 544 * 8)
    expect(narrow.length).toBeGreaterThan(1)
    expect(narrow.length).toBeLessThanOrEqual(Math.floor(544 / 72))
    // Zoomed in, every month fits. 35, not 36: the boundaries are those strictly inside the
    // window, so both endpoints are excluded.
    expect(wide.length).toBeGreaterThan(narrow.length)
    expect(wide.length).toBe(35)
  })

  it('never lets two labels land closer than the budget allows', () => {
    const span = window('2026-01-01T00:00', '2029-01-01T00:00')
    for (const plotPx of [400, 544, 1200, 4352]) {
      const ticks = monthTicks(span, TOKYO, plotPx)
      for (let i = 1; i < ticks.length; i += 1) {
        const gapPx = (ticks[i].fraction - ticks[i - 1].fraction) * plotPx
        expect(gapPx, `${plotPx}px plot`).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('spells the year out on the first tick and on each rollover only', () => {
    const ticks = monthTicks(window('2026-11-15T00:00', '2027-04-15T00:00'), TOKYO)
    expect(ticks[0].showYear).toBe(true)
    const rollovers = ticks.filter((tick) => tick.showYear).map((tick) => tick.wall.slice(0, 4))
    // The opening year, then 2027 once — never the same year twice.
    expect(new Set(rollovers).size).toBe(rollovers.length)
  })

  it('is empty when the window is inside one month', () => {
    expect(monthTicks(window('2027-01-05T00:00', '2027-01-25T00:00'), TOKYO)).toEqual([])
  })
})

describe('TaskDetailSheet', () => {
  const [row] = rows([task({ notes: 'call first', owner: 'Aoi' })])

  it('shows the full title, un-truncated — the thing the gutter cannot', () => {
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={row} nowWall={NOW_WALL} onClose={noop} />,
    )
    expect(html).toContain('Book the venue')
    expect(html).toContain('Status')
    expect(html).toContain('When')
    expect(html).toContain('Progress')
    // The dates and the percentage, which on a phone lived only in a dead `title`.
    expect(html).toContain('role="progressbar"')
    expect(html).toMatch(/detail__percent[^>]*>\d+%/)
  })

  it('labels the state row Status, not with the state itself', () => {
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={row} nowWall={NOW_WALL} onClose={noop} />,
    )
    const terms = [...html.matchAll(/class="detail__term">([^<]*)</g)].map((m) => m[1])
    expect(terms[0]).toBe('Status')
  })

  it('lists the subtasks, read-only', () => {
    const parent = rows([task({ id: 'p' }), sub('p', 1, true), sub('p', 2)])[0]
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={parent} nowWall={NOW_WALL} onClose={noop} />,
    )
    expect(html).toContain('Subtasks')
    expect(html).toContain('1 of 2 subtasks')
    expect(html).toContain('Step 1')
    // Read-only: static glyphs, no checkbox buttons, no add row.
    expect(html).toContain('subtask__check--static')
    expect(html).not.toContain('subtask-add__field')
  })

  it('omits a row for every field the task does not have', () => {
    const [bare] = rows([task()])
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={bare} nowWall={NOW_WALL} onClose={noop} />,
    )
    expect(html).not.toContain('Notes')
    expect(html).not.toContain('Who is on it')
  })

  it('is read-only: no delete one tap from a mark somebody was reading', () => {
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={row} nowWall={NOW_WALL} onClose={noop} />,
    )
    expect(html).not.toContain('Delete')
  })

  it('says so rather than showing an empty window for an undated task', () => {
    const [none] = rows([task({ start: '', end: '' })])
    const html = renderToStaticMarkup(
      <TaskDetailSheet task={none} nowWall={NOW_WALL} onClose={noop} />,
    )
    expect(html).toContain('No dates set')
  })
})

describe('Header', () => {
  it('shows both names, the countdown and the venue', () => {
    const config = mergeConfig({
      partner1Name: 'Aoi',
      partner2Name: 'Ren',
      weddingDate: '2027-04-18',
      venue: 'Meguro',
    })
    const html = renderToStaticMarkup(
      <Header config={config} nowMs={NOW} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('Aoi &amp; Ren')
    expect(html).toContain('102 days to go')
    expect(html).toContain('Meguro')
  })

  it('falls back to the app name with no names set', () => {
    expect(coupleTitle(mergeConfig({}), 'Wedding')).toBe('Wedding')
    expect(coupleTitle(mergeConfig({ partner1Name: 'Aoi' }), 'Wedding')).toBe('Aoi')
  })

  it('says so when there is no wedding date', () => {
    const html = renderToStaticMarkup(
      <Header config={mergeConfig({})} nowMs={NOW} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('No wedding date set')
  })

  it('marks a viewer’s board view-only, and an editor’s not at all', () => {
    const config = mergeConfig({ weddingDate: '2027-04-18' })
    expect(
      renderToStaticMarkup(
        <Header config={config} nowMs={NOW} canEdit={false} onOpenSettings={noop} />,
      ),
    ).toContain('View only')
    expect(
      renderToStaticMarkup(<Header config={config} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).not.toContain('View only')
  })

  it('handles the day itself and the days after', () => {
    const config = mergeConfig({ weddingDate: '2027-01-06' })
    expect(
      renderToStaticMarkup(<Header config={config} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).toContain('Today is the day')

    const past = mergeConfig({ weddingDate: '2027-01-01' })
    expect(
      renderToStaticMarkup(<Header config={past} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).toContain('5 days ago')
  })
})

describe('Controls', () => {
  it('carries a count on every filter', () => {
    const overall = overallProgress(rows([task({ id: 'a' }), task({ id: 'b' })]))
    const html = renderToStaticMarkup(
      <Controls
        counts={overall}
        total={overall.total}
        filter={FILTER_ALL}
        onFilter={noop}
        view={VIEWS.LIST}
        onView={noop}
      />,
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('chip__count')
    expect(html).toContain('Timeline')
  })

  it('disables an empty filter but leaves it in place', () => {
    // A control row that reshuffles as the board changes is one somebody has to re-read
    // every time.
    const overall = overallProgress(rows([task()]))
    const html = renderToStaticMarkup(
      <Controls
        counts={overall}
        total={overall.total}
        filter={FILTER_ALL}
        onFilter={noop}
        view={VIEWS.LIST}
        onView={noop}
      />,
    )
    expect(html).toContain('Overdue')
    expect(html).toContain('disabled')
  })
})

describe('EmptyBoard', () => {
  it('offers both checklists to an editor with a date', () => {
    const html = renderToStaticMarkup(
      <EmptyBoard canEdit weddingDay="2027-04-18" seeding={false} onSeed={noop} onOpenSettings={noop} />,
    )
    expect(html).toContain('Twelve-month plan')
    expect(html).toContain('Japanese eight-month plan')
  })

  it('asks for the wedding date first, since a checklist counts back from it', () => {
    const html = renderToStaticMarkup(
      <EmptyBoard canEdit weddingDay="" seeding={false} onSeed={noop} onOpenSettings={noop} />,
    )
    expect(html).toContain('Set the wedding date')
    expect(html).not.toContain('Twelve-month plan')
  })

  it('offers a viewer nothing to press', () => {
    const html = renderToStaticMarkup(
      <EmptyBoard canEdit={false} weddingDay="2027-04-18" seeding={false} onSeed={noop} onOpenSettings={noop} />,
    )
    expect(html).not.toContain('<button')
    expect(html).toContain('has not added anything yet')
  })
})

describe('Deleted', () => {
  it('lists a tombstoned task with a way back', () => {
    const html = renderToStaticMarkup(
      <DeletedList tasks={[task({ deletedAt: '2027-01-02T00:00:00.000Z' })]} onRestore={noop} />,
    )
    expect(html).toContain('Deleted (1)')
    expect(html).toContain('Restore')
  })

  it('renders nothing when nothing is deleted', () => {
    expect(renderToStaticMarkup(<DeletedList tasks={[]} onRestore={noop} />)).toBe('')
  })

  it('names the task in the confirmation', () => {
    // A confirmation that says "Delete task?" for a specific row is how somebody deletes
    // the wrong thing.
    const html = renderToStaticMarkup(
      <ConfirmDeleteSheet task={task()} onConfirm={noop} onClose={noop} />,
    )
    expect(html).toContain('Book the venue')
  })

  it('says the subtasks go with it, because the delete cascades', () => {
    const parent = rows([task({ id: 'p' }), sub('p', 1), sub('p', 2)])[0]
    const html = renderToStaticMarkup(
      <ConfirmDeleteSheet task={parent} onConfirm={noop} onClose={noop} />,
    )
    expect(html).toContain('Its 2 subtasks go with it.')
  })
})

describe('the stat list', () => {
  it('emits dt before dd, which is the only valid order in a dl', () => {
    // The other way round is invalid markup and pairs the four counts wrongly for a screen
    // reader. `.stat` reverses them visually with column-reverse.
    const overall = overallProgress(rows([task()]))
    const html = renderToStaticMarkup(<OverallCard overall={overall} />)
    const group = /<div class="stat[^"]*">([\s\S]*?)<\/div>/.exec(html)[1]
    expect(group.indexOf('<dt')).toBeGreaterThanOrEqual(0)
    expect(group.indexOf('<dt')).toBeLessThan(group.indexOf('<dd'))
  })
})

describe('Notice', () => {
  it('renders a title alone, without an empty body element', () => {
    const html = renderToStaticMarkup(<Notice title="Could not reach the board." />)
    expect(html).toContain('Could not reach the board.')
    expect(html).not.toContain('notice__body')
    expect(html).not.toContain('notice__actions')
  })

  it('adds the body and actions only when given them', () => {
    const html = renderToStaticMarkup(
      <Notice tone="warn" title="Showing saved data" body="Last copy this device saw.">
        <button type="button">Refresh</button>
      </Notice>,
    )
    expect(html).toContain('notice--warn')
    expect(html).toContain('notice__body')
    expect(html).toContain('notice__actions')
    expect(html).toContain('Refresh')
  })

  it('is not a warning unless asked', () => {
    expect(renderToStaticMarkup(<Notice title="x" />)).not.toContain('notice--warn')
  })
})

describe('Toasts', () => {
  it('is a live region and holds no controls', () => {
    const html = renderToStaticMarkup(<Toasts toasts={[{ id: 1, message: 'Saved.' }]} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    // A toast that has timed out is an action nobody can reach.
    expect(html).not.toContain('<button')
  })
})

describe('Japanese', () => {
  it('renders the whole surface without falling back to English', () => {
    setLocale('ja')
    const overall = overallProgress(rows([task()]))
    const html = renderToStaticMarkup(
      <>
        <Header
          config={mergeConfig({ weddingDate: '2027-04-18' })}
          nowMs={NOW}
          canEdit={false}
          onOpenSettings={noop}
        />
        <OverallCard overall={overall} />
        <TaskList
          tasks={rows([task()])}
          nowWall={NOW_WALL}
          canEdit
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
        />
      </>,
    )
    expect(html).toContain('あと102日')
    expect(html).toContain('全体の進捗')
    expect(html).toContain('進行中')
    // The category is translated through the runtime family, with the sheet's own word
    // as the fallback.
    expect(html).toContain('会場')
    expect(html).toContain('閲覧のみ')
    expect(html).not.toContain('View only')
  })

  it('keeps a category the catalog has never heard of exactly as typed', () => {
    setLocale('ja')
    const html = renderToStaticMarkup(
      <TaskList
        tasks={rows([task({ category: 'ハネムーン旅費' })])}
        nowWall={NOW_WALL}
        canEdit={false}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(html).toContain('ハネムーン旅費')
  })
})

describe('defaults', () => {
  it('ships a category list the templates can seed from', () => {
    expect(DEFAULT_CONFIG.categories.length).toBeGreaterThan(0)
  })
})

describe('draftToWindow', () => {
  const base = { startDay: '2027-04-18', endDay: '2027-04-20', startTime: '09:00', endTime: '17:00' }

  it('spans whole days when all-day, ending at 23:59', () => {
    // Not the next midnight: a task due on the 20th has to be overdue on the 21st rather
    // than 99% complete. The clock fields are ignored entirely.
    expect(draftToWindow({ ...base, allDay: true })).toEqual({
      start: '2027-04-18T00:00',
      end: '2027-04-20T23:59',
    })
  })

  it('uses the clock fields when not all-day', () => {
    expect(draftToWindow({ ...base, allDay: false })).toEqual({
      start: '2027-04-18T09:00',
      end: '2027-04-20T17:00',
    })
  })

  it('gives a single all-day task a real span, not a zero-length one', () => {
    // A zero-length window would read 0% all day and then flip to 100% at midnight.
    const { start, end } = draftToWindow({ ...base, endDay: base.startDay, allDay: true })
    expect(wallToInstant(end, TOKYO)).toBeGreaterThan(wallToInstant(start, TOKYO))
  })

  it('returns empty for a missing day rather than inventing one', () => {
    expect(draftToWindow({ ...base, startDay: '', allDay: true }).start).toBe('')
    expect(draftToWindow({ ...base, endDay: '', allDay: false }).end).toBe('')
  })
})
