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
import OverallCard from '../src/components/OverallCard.jsx'
import StateBadge from '../src/components/StateBadge.jsx'
import TaskList from '../src/components/TaskList.jsx'
import TaskRow from '../src/components/TaskRow.jsx'
import Timeline from '../src/components/Timeline.jsx'
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
const noop = () => {}

describe('Meter', () => {
  it('carries the ARIA meter role and a spoken value', () => {
    // Not a native <progress>: Safari's cannot take a second mark, and the on-schedule
    // tick is the whole reason the component exists.
    const html = renderToStaticMarkup(
      <Meter value={0.42} label="Overall" valueText="42% complete" />,
    )
    expect(html).toContain('role="meter"')
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
    expect(html).toContain('role="meter"')
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
    expect(open).toContain('aria-label="Mark done"')

    const [done] = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    const closed = renderToStaticMarkup(
      <TaskRow task={done} nowWall={NOW_WALL} canEdit onToggle={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(closed).toContain('aria-label="Mark not done"')
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
