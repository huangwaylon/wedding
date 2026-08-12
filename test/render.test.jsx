/**
 * Components rendered to static markup — no DOM, no browser.
 *
 * What this catches: a component that throws on a real prop shape, or silently drops
 * data. What it cannot catch: focus, scrolling, or anything that looks wrong. Do not
 * fake a DOM to try — `scripts/preview.jsx` and a screenshot are the answer to the
 * second, and that is why it exists.
 *
 * A STATIC RENDER RUNS NO EFFECT AND NO EVENT HANDLER. Everything asserted here is
 * therefore a DEFAULT: a closed card, an unfocused field, a filter nobody has tapped.
 * That is the point — every default has to be correct on its own, because it is what a
 * first paint shows. Anything that needs a tap (opening a card, committing a field on
 * blur) is pinned by driving the pure function the handler would call instead.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { taskToRow } from '../src/schema.js'
import { STATE, overallProgress, withProgress } from '../src/lib/progress.js'
import { wallToInstant } from '../src/lib/time.js'
import { setLocale } from '../src/i18n/index.js'
import { DEFAULT_LOCALE } from '../src/i18n/catalogs.js'
import { ConfirmDeleteSheet, DeletedList } from '../src/components/Deleted.jsx'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from '../src/components/FilterChips.jsx'
import Hero, { coupleTitle } from '../src/components/Hero.jsx'
import Meter from '../src/components/Meter.jsx'
import Notice from '../src/components/Notice.jsx'
import OverallCard from '../src/components/OverallCard.jsx'
import StateBadge from '../src/components/StateBadge.jsx'
import TabBar, { TABS } from '../src/components/TabBar.jsx'
import TaskCard from '../src/components/TaskCard.jsx'
import { draftFrom, draftToWindow, taskFromDraft } from '../src/components/TaskFields.jsx'
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
    parentId: '',
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

/** The handlers a card needs to render at all. Every one of them is dead in a static render. */
const CARD_HANDLERS = {
  onOpen: noop,
  onToggle: noop,
  onDelete: noop,
  onSave: noop,
  onAddSubtask: noop,
  onFieldFocus: noop,
}

const CATEGORIES = DEFAULT_CONFIG.categories

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

  it('can be built out of spans, for the row that is one button', () => {
    // A card's whole collapsed row is a `<button>`, whose content model is phrasing content,
    // so the three `<div>`s cannot live there. All three swap together — swapping only the
    // wrapper leaves the fill an inline box that ignores its own height.
    const html = renderToStaticMarkup(<Meter tag="span" value={0.5} mark={0.5} label="x" />)
    expect(html).not.toContain('<div')
    expect(html.match(/<span/g)).toHaveLength(3)
  })
})

describe('StateBadge', () => {
  it('renders NOTHING for every state but overdue', () => {
    // A card already carries its state three times over — the node's colour, the percentage
    // beside the meter, the date chip — so four of the five states need no pill, and a badge
    // on every card is fifty of them competing with fifty titles for the same 393px.
    for (const state of Object.values(STATE)) {
      const html = renderToStaticMarkup(<StateBadge state={state} />)
      if (state === STATE.OVERDUE) expect(html).not.toBe('')
      else expect(html, state).toBe('')
    }
  })

  it('states overdue in the WORD, not only in colour', () => {
    // The one state whose figure reads as its own opposite: an expired unfinished window has a
    // `percent` of 100 while being emphatically incomplete, so that card — and only that card —
    // says so in type. A viewer who cannot separate the red from the green reads the same thing.
    const html = renderToStaticMarkup(<StateBadge state={STATE.OVERDUE} />)
    expect(html).toContain('badge--overdue')
    expect(html).toMatch(/>Overdue<\/span>$/)
  })
})

describe('OverallCard', () => {
  it('shows the hero figure, the meter and the four counts', () => {
    const overall = overallProgress(rows([task({ id: 'a' }), task({ id: 'b' })]))
    const html = renderToStaticMarkup(<OverallCard overall={overall} />)
    expect(html).toContain('overall__percent')
    expect(html).toContain('role="progressbar"')
    // Exactly these four, in scanning order: problems first.
    const labels = [...html.matchAll(/class="stat__label">([^<]*)</g)].map((m) => m[1])
    expect(labels).toEqual(['Overdue', 'In progress', 'Upcoming', 'Done'])
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

  it('draws the on-schedule mark whether or not the two figures diverge', () => {
    // The mark is NOT optional. The headline counts a task as 100% once its window has run
    // out, whether or not anybody finished it, so on its own that number reads as progress
    // when it is really just the calendar advancing. Dropping the mark on a level board would
    // remove the reference exactly when it is the only thing saying the two figures agree.
    const level = overallProgress(rows([task({ id: 'a' }), task({ id: 'b' })]))
    expect(renderToStaticMarkup(<OverallCard overall={level} />)).toContain('meter__mark')

    const ahead = overallProgress(
      rows([task({ id: 'a', doneAt: '2027-01-02T00:00:00.000Z' }), task({ id: 'b' })]),
    )
    expect(renderToStaticMarkup(<OverallCard overall={ahead} />)).toContain('meter__mark')
  })
})

describe('TaskCard', () => {
  const [row] = rows([task()])
  const render = (task_, extra = {}) =>
    renderToStaticMarkup(
      <TaskCard
        task={task_}
        nowWall={NOW_WALL}
        canEdit
        open={false}
        categories={CATEGORIES}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  it('renders the title, the window and the percentage as TEXT', () => {
    const html = render(row)
    expect(html).toContain('Book the venue')
    expect(html).toContain('In progress')
    // The percentage is beside the bar, not a label on it: at 13px it does not fit
    // inside an 8px fill.
    expect(html).toMatch(/tcard__percent[^>]*>\d+%/)
  })

  it('describes the whole card IN WORDS on the head, so colour is never the only channel', () => {
    // The node's hue is a second channel and a `title` tooltip does not exist on touch, so the
    // disclosure's own accessible name has to carry the state as a word — and the percentage,
    // which a fill length is not a way to read off.
    const html = render(row)
    expect(html).toMatch(
      /class="tcard__head"[^>]*aria-label="Book the venue: [^"]*, \d+% complete, In progress"/,
    )
  })

  it('carries a state dot on the spine', () => {
    // The node is the one mark on the card that carries the state's hue, and it rides on the
    // card rather than in a gutter of its own so the segments meet down the month.
    const [done] = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    expect(render(done)).toMatch(/class="dot dot--done tcard__node"/)
    expect(render(row)).toMatch(/class="dot dot--active tcard__node"/)
  })

  it('splits the date chip into a day and the month under it', () => {
    const [april] = rows([task({ start: '2027-04-18T00:00', end: '2027-04-20T23:59' })])
    const html = render(april)
    expect(html).toMatch(/class="tcard__day tnum">18</)
    expect(html).toMatch(/class="tcard__mon">APR</)
  })

  it('hides every control from a viewer but keeps the row aligned', () => {
    const viewer = render(row, { canEdit: false })
    // The head is still the disclosure — a viewer opens a card to read the notes — but the
    // check is a static glyph, so the slot stays occupied and a planner's cards line up with
    // an editor's instead of shifting 44px.
    expect(viewer.match(/<button/g)).toHaveLength(1)
    expect(viewer).toContain('tcard__check--static')
    expect(render(row).match(/<button/g)).toHaveLength(2)
  })

  it('labels the done toggle by what it will do', () => {
    // The title is interpolated: thirty buttons all called "Mark done" is not navigable by
    // the VoiceOver rotor.
    expect(render(row)).toContain('aria-label="Mark Book the venue done"')

    const [done] = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    const closed = render(done)
    expect(closed).toContain('aria-label="Mark Book the venue not done"')
    expect(closed).toContain('tcard--done')
  })

  it('says so when a task has no usable window, and keeps the chip slot', () => {
    const [none] = rows([task({ start: '', end: '' })])
    const html = render(none)
    expect(html).toContain('No dates set')
    // A dash rather than an invented date, and the slot is still there so the titles down a
    // month stay in one column.
    expect(html).toMatch(/class="tcard__day tnum">–</)
    expect(html).not.toContain('tcard__mon')
  })

  it('shows a viewer the owner and the notes the collapsed row has no room for', () => {
    const [full] = rows([task({ notes: 'call first', owner: 'Aoi' })])
    const html = render(full, { canEdit: false, open: true })
    expect(html).toContain('call first')
    expect(html).toContain('Aoi')
    // And not one field, ever — a control a viewer's writes would be refused by.
    expect(html).not.toContain('<input')

    const bare = render(row, { canEdit: false, open: true })
    expect(bare).not.toContain('caption')
  })

  it('marks an unsaved card without hiding it', () => {
    const [pending] = rows([{ ...task(), pending: true }])
    const html = render(pending)
    expect(html).toContain('tcard--pending')
    expect(html).toContain('Book the venue')
  })

  it('renders the whole editor in place, with no Save button and no form', () => {
    // Editing happens inside the open card: every field commits on blur, so there is no
    // dirty state a collapse or a reload can throw away — and therefore nothing to submit.
    const html = render(row, { open: true })
    expect(html).toContain('class="editor"')
    expect(html).toContain('>Title<')
    expect(html).toContain('>Owner<')
    expect(html).not.toContain('<form')
  })
})

describe('the checklist inside an open card', () => {
  const parented = (subs) => rows([task({ id: 'p' }), ...subs])[0]
  const render = (task_, extra = {}) =>
    renderToStaticMarkup(
      <TaskCard
        task={task_}
        nowWall={NOW_WALL}
        canEdit
        open={false}
        categories={CATEGORIES}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  it('offers no add field when the deployment cannot store a subtask', () => {
    // The banner tells somebody their script is out of date; leaving a live field under it invites
    // them to type a checklist that will be refused. The existing items stay fully live — an old
    // script ticks and deletes them correctly, it just cannot write `parent_id`.
    const row = parented([sub('p', 1), sub('p', 2)])
    const offered = render(row, { open: true })
    expect(offered).toContain('subtask-add__field')

    const withheld = render(row, { open: true, canAddSubtask: false })
    expect(withheld).not.toContain('subtask-add__field')
    expect(withheld.match(/<li class="subtask/g) ?? []).toHaveLength(2)
    expect(withheld).toContain('subtask__toggle')
  })

  it('renders no disclosure content at all while the card is closed', () => {
    // The load-bearing decision: a freshly seeded 52-task board is 52 collapsed rows and
    // nothing else — no fields, no checklists, no height. A static render runs no effect, so
    // this closed default is also all the preview harness will ever see.
    const html = render(parented([sub('p', 1), sub('p', 2)]))
    expect(html).not.toContain('tcard__content')
    expect(html).not.toContain('class="subtasks"')
    expect(html).not.toContain('class="editor"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="tcard-p"')
  })

  it('costs a task with no subtasks no tally and no rail', () => {
    // Nothing to count, so nothing is drawn: no `3/5` in the collapsed row, and — for a viewer,
    // who has no add field to be offered — no empty checklist rail in the opened one either.
    const bare = parented([])
    expect(render(bare)).not.toContain('tcard__tally')
    expect(render(bare, { open: true, canEdit: false })).not.toContain('class="subtasks"')
  })

  it('shows the tally beside the fill and names it in the card’s label', () => {
    // The tally is what tells the reader a tallied fill is a COUNT rather than a clock reading.
    // It is never coloured: `5/5` in the done colour would claim a `done_at` the sheet does
    // not have.
    const html = render(parented([sub('p', 1, true), sub('p', 2), sub('p', 3)]))
    expect(html).toMatch(/class="tcard__tally tnum"[^>]*>1\/3</)
    expect(html).toMatch(/aria-label="[^"]*1 of 3 subtasks"/)
  })

  it('pluralises the tally rather than using a count === 1 ternary', () => {
    expect(render(parented([sub('p', 1)]))).toMatch(/aria-label="[^"]*0 of 1 subtask"/)
  })

  it('wires the open content to the disclosure', () => {
    const open = render(parented([sub('p', 1)]), { open: true })
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('id="tcard-p"')
    expect(open).toContain('tcard--open')
    expect(open).toContain('Step 1')
  })

  it('gives a subtask a check and a delete, but no meter and no badge', () => {
    // A dateless item has nothing for a bar to measure, and a meter would encode exactly the
    // one bit the checkbox beside it already does.
    const open = render(parented([sub('p', 1)]), { open: true })
    // BOUNDED TO THE LIST. Slicing to the end of the document read the PARENT's own meter,
    // which of course has a progressbar, and the assertion passed for the wrong reason — it
    // would have gone on passing with a meter on every subtask. The bound is what makes this
    // a statement about the checklist, whatever order the card renders its parts in.
    const start = open.indexOf('class="subtasks"')
    const list = open.slice(start, open.indexOf('</ul>', start))
    expect(list).toContain('subtask__toggle')
    expect(list).toContain('aria-label="Delete Step 1"')
    expect(list).not.toContain('role="progressbar"')
    expect(list).not.toContain('class="badge')
  })

  it('adds with Enter rather than a nested form', () => {
    // This list renders inside a card that also holds the editor's fields, and HTML forbids
    // nested forms: the parser drops the inner one, so Enter reached the outer submit and
    // tried to save the TASK. A static render cannot catch that — the nesting only becomes
    // invalid once a browser parses it — so the shape is pinned here instead.
    const open = render(parented([sub('p', 1)]), { open: true })
    const start = open.indexOf('class="subtasks"')
    const list = open.slice(start, open.indexOf('</ul>', start))
    expect(list).not.toContain('<form')
    expect(open).not.toContain('<form')
    // A visible way to commit as well as the key: Enter alone left somebody who typed an item
    // and clicked away with nothing saved and no sign anything had happened.
    expect(list).toContain('subtask-add__submit')
  })

  it('offers the add row to an editor and not to a viewer', () => {
    expect(render(parented([sub('p', 1)]), { open: true })).toContain('subtask-add__field')
    const viewer = render(parented([sub('p', 1)]), { open: true, canEdit: false })
    expect(viewer).not.toContain('subtask-add__field')
    // But the check slot stays occupied, so the two lists line up.
    expect(viewer).toContain('subtask__toggle--static')
  })

  it('drives the parent meter from the tally, not the clock', () => {
    // The window is half elapsed; three of four are ticked.
    const row = parented([sub('p', 1, true), sub('p', 2, true), sub('p', 3, true), sub('p', 4)])
    const html = render(row)
    expect(html).toMatch(/tcard__percent[^>]*>75%/)
    expect(html).toContain('width:75%')
  })
})

describe('Timeline', () => {
  const render = (tasks, extra = {}) =>
    renderToStaticMarkup(
      <Timeline
        tasks={tasks}
        nowWall={NOW_WALL}
        canEdit
        categories={CATEGORIES}
        expanded={new Set()}
        onExpand={noop}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  const months = (html) => [...html.matchAll(/class="plan__month">([^<]*)</g)].map((m) => m[1])

  it('groups by month and keeps every task', () => {
    const list = rows([
      task({ id: 'a', start: '2027-01-01T00:00', end: '2027-01-31T23:59' }),
      task({ id: 'b', title: 'Order invitations', start: '2027-03-01T00:00', end: '2027-03-31T23:59' }),
    ])
    const html = render(list)
    expect(months(html)).toEqual(['January 2027', 'March 2027'])
    expect(html.match(/class="plan__group"/g)).toHaveLength(2)
    expect(html).toContain('Book the venue')
    expect(html).toContain('Order invitations')
  })

  it('collects undated tasks in their own group, last', () => {
    // They sort last, so putting the group anywhere else would bury the month in progress.
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Someday', start: '', end: '' })])
    expect(months(render(list, { canEdit: false }))).toEqual(['January 2027', 'No dates set'])
  })

  it('hangs one card per task off the spine', () => {
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Order invitations' })])
    const html = render(list)
    expect(html.match(/class="tcard"/g)).toHaveLength(2)
    expect(html.match(/tcard__node/g)).toHaveLength(2)
  })

  it('renders nothing rather than an empty shell', () => {
    // The caller owns what an empty board says — and it is not the same sentence as
    // "nothing matches this filter".
    expect(render([])).toBe('')
  })

  it('opens only the cards the app has expanded', () => {
    // `expanded` is a Set owned by `App`, session-only: relaunching into twelve expanded
    // cards is a board nobody can read.
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Order invitations' })])
    const html = render(list, { expanded: new Set(['b']) })
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html.match(/tcard--open/g)).toHaveLength(1)
    expect(html.match(/class="editor"/g)).toHaveLength(1)
    // And it is the right one: the editor sits inside b's content, not a's.
    expect(html.indexOf('class="editor"')).toBeGreaterThan(html.indexOf('Order invitations'))
  })
})

describe('TabBar', () => {
  it('gives each of the two tabs a WORD as well as a glyph', () => {
    // A pair of unlabelled icons is a guess, and the two labels cost one line of 13px type.
    const html = renderToStaticMarkup(<TabBar tab={TABS.HOME} onTab={noop} />)
    const labels = [...html.matchAll(/class="tabbtn__label">([^<]*)</g)].map((m) => m[1])
    expect(labels).toEqual(['Home', 'Timeline'])
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  it('marks the current tab once, with aria-current', () => {
    // `<nav>` with `aria-current`, not `role="tablist"`: the ARIA tabs pattern also commits
    // to arrow-key traversal and a focus contract that half-implementing is worse than not
    // claiming at all.
    const html = renderToStaticMarkup(<TabBar tab={TABS.TIMELINE} onTab={noop} />)
    expect(html).toContain('<nav')
    expect(html).not.toContain('role="tab')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html.match(/tabbtn--on/g)).toHaveLength(1)
    // On the second one, not the first.
    expect(html.indexOf('tabbtn--on')).toBeGreaterThan(html.indexOf('Home'))
  })
})

describe('Hero', () => {
  it('shows both names, the countdown and the venue', () => {
    const config = mergeConfig({
      partner1Name: 'Aoi',
      partner2Name: 'Ren',
      weddingDate: '2027-04-18',
      venue: 'Meguro',
    })
    const html = renderToStaticMarkup(
      <Hero config={config} nowMs={NOW} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('Aoi &amp; Ren')
    expect(html).toContain('102 days to go')
    expect(html).toContain('Meguro')
  })

  it('leaves the photograph undescribed, because the h1 beneath it says the same thing', () => {
    const html = renderToStaticMarkup(
      <Hero config={mergeConfig({ partner1Name: 'Aoi' })} nowMs={NOW} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('alt=""')
    expect(html).toContain('<h1')
  })

  it('falls back to the app name with no names set', () => {
    expect(coupleTitle(mergeConfig({}), 'Wedding')).toBe('Wedding')
    expect(coupleTitle(mergeConfig({ partner1Name: 'Aoi' }), 'Wedding')).toBe('Aoi')
  })

  it('says so when there is no wedding date', () => {
    const html = renderToStaticMarkup(
      <Hero config={mergeConfig({})} nowMs={NOW} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('No wedding date set')
    // And no placeholder date in the eyebrow: a made-up date on a wedding hero is worse
    // than a gap.
    expect(html).not.toContain('hero__eyebrow')
  })

  it('marks a viewer’s board view-only, and an editor’s not at all', () => {
    const config = mergeConfig({ weddingDate: '2027-04-18' })
    expect(
      renderToStaticMarkup(
        <Hero config={config} nowMs={NOW} canEdit={false} onOpenSettings={noop} />,
      ),
    ).toContain('View only')
    expect(
      renderToStaticMarkup(<Hero config={config} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).not.toContain('View only')
  })

  it('handles the day itself and the days after', () => {
    const config = mergeConfig({ weddingDate: '2027-01-06' })
    expect(
      renderToStaticMarkup(<Hero config={config} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).toContain('Today is the day')

    const past = mergeConfig({ weddingDate: '2027-01-01' })
    expect(
      renderToStaticMarkup(<Hero config={past} nowMs={NOW} canEdit onOpenSettings={noop} />),
    ).toContain('5 days ago')
  })
})

describe('FilterChips', () => {
  const render = (list, filter = FILTER_ALL) => {
    const overall = overallProgress(rows(list))
    return renderToStaticMarkup(
      <FilterChips counts={overall} total={overall.total} filter={filter} onFilter={noop} />,
    )
  }

  it('carries a count on every filter', () => {
    const html = render([task({ id: 'a' }), task({ id: 'b' })])
    const labels = [...html.matchAll(/class="chip"[^>]*>([^<]*)</g)].map((m) => m[1])
    // `all` plus one per state, in scanning order — problems first.
    expect(labels).toEqual(['All', 'Overdue', 'In progress', 'Upcoming', 'Done'])
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('chip__count')
  })

  it('disables an empty filter but leaves it in place', () => {
    // A control row that reshuffles as the board changes is one somebody has to re-read
    // every time.
    const html = render([task()])
    expect(html).toContain('Overdue')
    expect(html).toContain('disabled')
  })

  it('never disables the filter that is currently on', () => {
    // Disabling the active chip would strand the board on a slice with no way back to it.
    const html = render([task()], 'overdue')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Overdue</)
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
    expect(html).toContain('Nothing added yet.')
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
        <Hero
          config={mergeConfig({ weddingDate: '2027-04-18' })}
          nowMs={NOW}
          canEdit={false}
          onOpenSettings={noop}
        />
        <OverallCard overall={overall} />
        <Timeline
          tasks={rows([task()])}
          nowWall={NOW_WALL}
          canEdit
          categories={CATEGORIES}
          expanded={new Set()}
          onExpand={noop}
          {...CARD_HANDLERS}
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
    // The sheet is the source of truth and the catalog is a courtesy on top of it.
    setLocale('ja')
    const html = renderToStaticMarkup(
      <Timeline
        tasks={rows([task({ category: 'ハネムーン旅費' })])}
        nowWall={NOW_WALL}
        canEdit={false}
        categories={CATEGORIES}
        expanded={new Set()}
        onExpand={noop}
        {...CARD_HANDLERS}
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

/**
 * What `TaskEditor` hands to `onSave`.
 *
 * The editor commits `taskFromDraft({ ...draftFrom(task), ...patch }, task)` and passes the
 * result straight through. A static render runs no blur, so the payload is built here from
 * those same two functions, in that same order — not re-derived, which would be a second
 * implementation of the rule and could agree with itself while disagreeing with the editor.
 */
describe('the payload TaskEditor hands to onSave', () => {
  it('still carries parentId, so a subtask is never silently promoted', () => {
    // THE highest-consequence rule in the editor. `update` rewrites the whole row from the
    // payload, so one built without `parentId` blanks the cell — and a promoted subtask
    // becomes a top-level task, which changes the roll-up's denominator and quietly deflates
    // every other task on the board. Asserted on the WIRE row, which is where the damage is.
    const child = rows([task({ id: 'p' }), sub('p', 1)])[0].subtasks[0]
    const payload = taskFromDraft({ ...draftFrom(child), title: 'Ring the venue' }, child)
    expect(payload.parentId).toBe('p')
    expect(taskToRow(payload).parent_id).toBe('p')
    expect(payload.title).toBe('Ring the venue')
  })

  it('leaves a subtask’s window cells untouched rather than writing an empty one', () => {
    // A subtask is a title and a tick and is offered no date field, so a window written from
    // that empty draft would blank two cells of a row somebody hand-dated in the spreadsheet
    // — and nothing downstream would ever have checked what it wrote.
    const dated = task({ id: 'p-1', parentId: 'p', start: '2027-03-01T00:00', end: '2027-03-02T17:00' })
    const payload = taskFromDraft({ ...draftFrom(dated), title: 'Step 1' }, dated)
    expect(payload.start).toBe('2027-03-01T00:00')
    expect(payload.end).toBe('2027-03-02T17:00')
  })

  it('is the WHOLE task, so an untouched field commits nothing at all', () => {
    // `TaskEditor` decides "did this change" by comparing the ROW it is about to write with
    // the row already there. If the payload dropped a field, or rewrote a window it should
    // not, every blur would differ from the stored row and cost a round trip and a toast.
    const [row] = rows([task({ notes: 'call first', owner: 'Aoi', doneAt: '2027-01-02T00:00:00.000Z' })])
    expect(taskToRow(taskFromDraft(draftFrom(row), row))).toEqual(taskToRow(row))
  })
})
