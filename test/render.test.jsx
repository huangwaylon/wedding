/**
 * Components rendered to static markup — no DOM, no browser.
 *
 * What this catches: a component that throws on a real prop shape, or silently drops
 * data. What it cannot catch: focus, scrolling, or anything that looks wrong. Do not
 * fake a DOM to try — `scripts/preview.jsx` and a screenshot are the answer to the
 * second, and that is why it exists.
 *
 * A STATIC RENDER RUNS NO EFFECT AND NO EVENT HANDLER. Everything asserted here is
 * therefore a DEFAULT: a closed row, an unfocused field, a filter nobody has tapped.
 * That is the point — every default has to be correct on its own, because it is what a
 * first paint shows. Anything that needs a tap (opening a row, committing a field on
 * blur) is pinned by driving the pure function the handler would call instead.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { taskToRow } from '../src/schema.js'
import { STATE, overallProgress, withProgress } from '../src/lib/progress.js'
import { setLocale } from '../src/i18n/index.js'
import { DEFAULT_LOCALE } from '../src/i18n/catalogs.js'
import { ConfirmDeleteSheet, DeletedList } from '../src/components/Deleted.jsx'
import DueLabel from '../src/components/DueLabel.jsx'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from '../src/components/FilterChips.jsx'
import Hero, { coupleTitle } from '../src/components/Hero.jsx'
import Markdown from '../src/components/Markdown.jsx'
import Meter from '../src/components/Meter.jsx'
import Notice from '../src/components/Notice.jsx'
import NotesView from '../src/components/NotesView.jsx'
import Plan from '../src/components/Plan.jsx'
import SettingsSheet from '../src/components/SettingsSheet.jsx'
import TabBar, { TABS } from '../src/components/TabBar.jsx'
import TaskCard from '../src/components/TaskCard.jsx'
import { draftFrom, taskFromDraft } from '../src/components/TaskFields.jsx'
import Toasts from '../src/components/Toasts.jsx'

/** The board's day. Day-granular everywhere, so no instant is needed. */
const TODAY = '2027-01-06'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

function task(overrides = {}) {
  return {
    id: 'a',
    title: 'Book the venue',
    category: 'Venue',
    due: '2027-01-11',
    doneAt: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: '',
    parentId: '',
    ...overrides,
  }
}

const rows = (list) => withProgress(list, TODAY)

/** A dateless checklist item under `parent`. */
function sub(parent, id, done = false) {
  return task({
    id: `${parent}-${id}`,
    title: `Step ${id}`,
    due: '',
    parentId: parent,
    doneAt: done ? '2027-01-02T00:00:00.000Z' : '',
  })
}
const noop = () => {}

/** The handlers a row needs to render at all. Every one of them is dead in a static render. */
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
      <Meter value={0.42} label="Overall" valueText="6 of 14 done" />,
    )
    expect(html).toContain('role="progressbar"')
    expect(html).not.toContain('role="meter"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('aria-valuetext="6 of 14 done"')
    expect(html).toContain('width:42%')
  })

  it('draws the mark only when one is given', () => {
    expect(renderToStaticMarkup(<Meter value={0.4} label="x" />)).not.toContain('meter__mark')
    const marked = renderToStaticMarkup(<Meter value={0.4} mark={0.6} label="x" />)
    expect(marked).toContain('meter__mark')
    expect(marked).toContain('left:60%')
  })

  it('clamps rather than overflowing its track', () => {
    expect(renderToStaticMarkup(<Meter value={4} label="x" />)).toContain('width:100%')
    expect(renderToStaticMarkup(<Meter value={-1} label="x" />)).toContain('width:0%')
  })
})

describe('DueLabel', () => {
  const render = (state, days) => renderToStaticMarkup(<DueLabel state={state} days={days} />)

  it('says how late something is, in words and with a hue beside them', () => {
    const html = render(STATE.OVERDUE, -3)
    expect(html).toContain('3 days ago')
    // The colour is on the DOT, never on the type: a viewer who cannot separate the red from
    // the green reads exactly the same thing.
    expect(html).toContain('dot dot--overdue')
    expect(html).not.toMatch(/color:/)
  })

  it('names today and tomorrow rather than counting them', () => {
    expect(render(STATE.SOON, 0)).toContain('Today')
    expect(render(STATE.SOON, 1)).toContain('Tomorrow')
    expect(render(STATE.SOON, 5)).toContain('in 5 days')
  })

  it('pluralises through Intl rather than a count === 1 ternary', () => {
    expect(render(STATE.SOON, 2)).toContain('in 2 days')
    expect(render(STATE.OVERDUE, -1)).toContain('1 day ago')
  })

  it('renders NOTHING past the fortnight, or for a finished or undated task', () => {
    // A four-hundred-day board would otherwise carry four hundred labels. Absence is a
    // channel of its own: a mark on a row means act on it this fortnight.
    expect(render(STATE.LATER, 200)).toBe('')
    expect(render(STATE.DONE, -30)).toBe('')
    expect(render(STATE.NODATE, null)).toBe('')
  })
})

describe('TaskCard', () => {
  const [row] = rows([task()])
  const render = (task_, extra = {}) =>
    renderToStaticMarkup(
      <TaskCard
        task={task_}
        canEdit
        open={false}
        categories={CATEGORIES}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  it('prints a bare day, no month, and no percentage', () => {
    // The month is in the sticky group heading and was always identical to it. The percentage
    // went with the per-row meter: it is 0 or 100 for a task with no checklist, which the tick
    // beside it already says.
    const html = render(row)
    expect(html).toContain('Book the venue')
    expect(html).toMatch(/class="tcard__day tnum">11</)
    expect(html).not.toContain('tcard__mon')
    expect(html).not.toContain('tcard__percent')
    expect(html).not.toContain('role="progressbar"')
  })

  it('never puts a state colour on the day column', () => {
    // A column a third of whose entries are red stops being a column, and the state hue would
    // then be on type. Overdue and upcoming rows draw the SAME day number.
    const [late] = rows([task({ due: '2026-12-11' })])
    expect(render(late)).toMatch(/class="tcard__day tnum">11</)
    expect(render(late)).not.toMatch(/tcard__day[^>]*--overdue/)
  })

  it('describes the whole row IN WORDS, with the date spelled out', () => {
    // The visible row leans on a two-digit day plus the sticky month heading, and neither of
    // those reaches a screen reader — so this is the one place the full date appears.
    const html = render(row)
    expect(html).toMatch(
      /class="tcard__head"[^>]*aria-label="Book the venue: Jan 11, 2027, Soon"/,
    )
  })

  it('puts the urgency, the tally and the category on one meta line', () => {
    const parent = rows([task({ id: 'p' }), sub('p', 1, true), sub('p', 2)])[0]
    const html = render(parent)
    const meta = /class="tcard__meta">([\s\S]*?)<\/span><\/span>/.exec(html)[1]
    expect(meta).toContain('in 5 days')
    expect(meta).toContain('1/2')
    expect(meta).toContain('Venue')
  })

  it('renders no meta line at all when there is nothing on it', () => {
    // Most of a freshly seeded board: a task months out, no checklist, no category.
    const [quiet] = rows([task({ due: '2027-09-01', category: '' })])
    expect(render(quiet)).not.toContain('tcard__meta')
  })

  it('leads a known category with its glyph and still prints the word', () => {
    // The glyph does not REPLACE the label. Fourteen categories is more than a shape
    // vocabulary anybody learns cold, and an English and a Japanese reader do not learn the
    // same ones — so the word stays and the shape is what makes the chip findable twice.
    const html = render(row)
    expect(html).toContain('chip__icon')
    expect(html).toContain('Venue')
    // aria-hidden, because the word beside it is already the label.
    expect(/class="chip__icon"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="chip__icon"/.test(html)).toBe(
      true,
    )
  })

  it('prints an invented category as typed, with no glyph at all', () => {
    // The spreadsheet is the source of truth for what a category IS. Pinning an unknown one
    // under the Other tag would put a claim on it that nobody made.
    const [odd] = rows([task({ category: 'Campsite' })])
    const html = render(odd)
    expect(html).toContain('Campsite')
    expect(html).not.toContain('chip__icon')
  })

  it('keeps the day slot occupied for an undated task', () => {
    // A dash rather than an invented date, and the slot stays so the titles down a month stay
    // in one column.
    const [none] = rows([task({ due: '' })])
    expect(render(none)).toMatch(/class="tcard__day tnum">–</)
  })

  it('hides every control from a viewer but keeps the row aligned', () => {
    const parent = rows([task({ id: 'p' }), sub('p', 1)])[0]
    const viewer = render(parent, { canEdit: false })
    // The head is still the disclosure — a viewer opens a row to read the checklist — but the
    // check is a static glyph, so the slot stays occupied and a planner's rows line up with
    // an editor's instead of shifting 44px.
    expect(viewer.match(/<button/g)).toHaveLength(1)
    expect(viewer).toContain('tcard__check--static')
    expect(render(parent).match(/<button/g)).toHaveLength(2)
  })

  it('gives a viewer with nothing to reveal no disclosure at all', () => {
    // A row with no checklist and no editor would open a padded empty box, which is the
    // normal case for a planner on a freshly seeded board.
    const viewer = render(row, { canEdit: false })
    expect(viewer).not.toContain('tcard__chev')
    expect(viewer).not.toContain('aria-expanded')
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

  it('marks an unsaved row without hiding it', () => {
    const [pending] = rows([{ ...task(), pending: true }])
    const html = render(pending)
    expect(html).toContain('tcard--pending')
    expect(html).toContain('Book the venue')
  })

  it('OPENS READ-ONLY, with no field armed by the tap that opened it', () => {
    // Tapping a row is how you read it and tick its checklist, a hundred times a week.
    // Live fields behind that tap meant the common gesture put a caret in a text input, and
    // the editor commits on blur — so a stray tap could retitle a task with no confirmation.
    const html = render(row, { open: true })
    expect(html).not.toContain('class="editor"')
    // No TITLE field above all — that is the one a caret lands in, and the one a stray blur
    // would have written. The add-a-subtask field is a different thing and stays; see below.
    expect(html).not.toContain('type="date"')
    expect(html).not.toContain('<select')
    expect(html).not.toMatch(/class="input"/)
    // What it shows instead: the date spelled out, and the way in.
    expect(html).toContain('tcard__fact')
    expect(html).toContain('Mon, January 11, 2027')
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?Edit</s)
  })

  it('offers no delete on the read path either', () => {
    // Two destructive-adjacent controls behind an ordinary tap is one too many.
    expect(render(row, { open: true })).not.toContain('Delete this task')
    expect(render(row, { open: true, editing: true })).toContain('Delete this task')
  })

  it('says so when an open row has no date', () => {
    const [none] = rows([task({ due: '' })])
    expect(render(none, { open: true })).toMatch(/tcard__fact[\s\S]*?No date/)
  })

  it('renders three fields once editing, with no Save button and no form', () => {
    // Every field commits on blur, so there is no dirty state a collapse or a reload can throw
    // away — and therefore nothing to submit.
    const html = render(row, { open: true, editing: true })
    expect(html).toContain('class="editor"')
    expect(html).toContain('>Title<')
    expect(html).toContain('>Due<')
    expect(html).toContain('>Category<')
    expect(html).not.toContain('<form')
    // Fields the model does not have.
    expect(html).not.toContain('>Owner<')
    expect(html).not.toContain('>Notes<')
    expect(html).not.toContain('>All day<')
    expect(html).not.toContain('type="time"')
    expect(html.match(/type="date"/g)).toHaveLength(1)
    // And the facts line gives way to the fields rather than stacking above them.
    expect(html).not.toContain('tcard__fact')
    expect(html).toContain('aria-pressed="true"')
  })

  it('offers a subtask a title and no date field', () => {
    // `validateTask` returns early for anything with a parentId, so a date offered here would
    // be saved unvalidated — and it did once save an end before a start.
    const child = rows([task({ id: 'p' }), sub('p', 1)])[0].subtasks[0]
    const html = render(
      { ...child, progress: { state: STATE.NODATE, days: null, dated: false, tally: null }, subtasks: [] },
      { open: true, editing: true },
    )
    expect(html).toContain('class="editor"')
    expect(html).not.toContain('type="date"')
  })

  it('hides the toggle from a viewer, who has nothing to switch to', () => {
    const parent = rows([task({ id: 'p' }), sub('p', 1)])[0]
    const viewer = render(parent, { open: true, canEdit: false })
    expect(viewer).not.toContain('tcard__foot')
    expect(viewer).not.toContain('Edit')
    // But the facts and the checklist are both there — that is the whole disclosure for them.
    expect(viewer).toContain('tcard__fact')
    expect(viewer).toContain('Step 1')
  })
})

describe('the checklist inside an open row', () => {
  const parented = (subs) => rows([task({ id: 'p' }), ...subs])[0]
  const render = (task_, extra = {}) =>
    renderToStaticMarkup(
      <TaskCard
        task={task_}
        canEdit
        open={false}
        categories={CATEGORIES}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  it('keeps the checklist tickable on the READ path', () => {
    // Ticking an item is doing the work, not editing the task, so it is in both modes — and it
    // is the reason a row is opened at all.
    const html = render(parented([sub('p', 1)]), { open: true })
    expect(html).not.toContain('class="editor"')
    expect(html).toContain('subtask__toggle')
    expect(html).toContain('subtask-add__field')
  })

  it('offers no add field on a PROMOTED row, which is the only thing that withholds it', () => {
    // A row the read could not place is drawn as a task, but a child of it would be a grandchild
    // and the next read would promote that one too — so the field would invite somebody to type a
    // checklist that walks out of the row. The existing items stay fully live.
    const row = parented([sub('p', 1), sub('p', 2)])
    expect(render(row, { open: true })).toContain('subtask-add__field')

    const promoted = { ...row, promoted: true }
    const withheld = render(promoted, { open: true })
    expect(withheld).not.toContain('subtask-add__field')
    expect(withheld.match(/<li class="subtask/g) ?? []).toHaveLength(2)
    expect(withheld).toContain('subtask__toggle')
  })

  it('renders no disclosure content at all while the row is closed', () => {
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
    const bare = parented([])
    expect(render(bare)).not.toContain('tcard__tally')
    expect(render(bare, { open: true, canEdit: false })).not.toContain('class="subtasks"')
  })

  it('shows the tally and names it in the row’s label', () => {
    // It is never coloured: `5/5` in the done colour would claim a `done_at` the sheet does
    // not have.
    const html = render(parented([sub('p', 1, true), sub('p', 2), sub('p', 3)]))
    expect(html).toMatch(/class="tcard__tally tnum">1\/3</)
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

  it('gives a subtask a check, but no meter and no urgency label', () => {
    // A dateless item has nothing for a bar to measure or a distance to count.
    const open = render(parented([sub('p', 1)]), { open: true })
    const start = open.indexOf('class="subtasks"')
    const list = open.slice(start, open.indexOf('</ul>', start))
    expect(list).toContain('subtask__toggle')
    expect(list).not.toContain('role="progressbar"')
    expect(list).not.toContain('class="due"')
  })

  it('holds the per-item delete back until editing, with the task\u2019s own', () => {
    // Three trash icons under every ordinary tap is three chances to lose an item somebody
    // meant to tick. Ticking and ADDING stay on the read path — both are doing the work.
    const read = render(parented([sub('p', 1)]), { open: true })
    expect(read).not.toContain('aria-label="Delete Step 1"')
    expect(read).toContain('subtask__toggle')
    expect(read).toContain('subtask-add__field')

    const editing = render(parented([sub('p', 1)]), { open: true, editing: true })
    expect(editing).toContain('aria-label="Delete Step 1"')
  })

  it('adds with Enter rather than a nested form', () => {
    // This list renders inside a row that also holds the editor's fields, and HTML forbids
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

  it('is the only thing that gives a task a partial figure', () => {
    // Three of four ticked. Without a checklist a task is 0 or 100, which is why the meter
    // left the row — but the tally still reaches the roll-up.
    const row = parented([sub('p', 1, true), sub('p', 2, true), sub('p', 3, true), sub('p', 4)])
    expect(row.progress.percent).toBe(0.75)
    expect(overallProgress([row]).percent).toBe(0.75)
  })
})

describe('Plan', () => {
  const render = (tasks, extra = {}) =>
    renderToStaticMarkup(
      <Plan
        tasks={tasks}
        canEdit
        categories={CATEGORIES}
        expanded={new Set()}
        onExpand={noop}
        {...CARD_HANDLERS}
        {...extra}
      />,
    )

  const months = (html) => [...html.matchAll(/class="plan__month">([^<]*)</g)].map((m) => m[1])
  const tallies = (html) =>
    [...html.matchAll(/class="plan__tally tnum" aria-hidden="true">([^<]*)</g)].map((m) => m[1])

  it('groups by the month it is DUE in, and keeps every task', () => {
    const list = rows([
      task({ id: 'a', due: '2027-01-31' }),
      task({ id: 'b', title: 'Order invitations', due: '2027-03-31' }),
    ])
    const html = render(list)
    expect(months(html)).toEqual(['January 2027', 'March 2027'])
    expect(html.match(/class="plan__group"/g)).toHaveLength(2)
    expect(html).toContain('Book the venue')
    expect(html).toContain('Order invitations')
  })

  it('collects undated tasks in their own group, last', () => {
    // They sort last, so putting the group anywhere else would bury the month in progress.
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Someday', due: '' })])
    expect(months(render(list, { canEdit: false }))).toEqual(['January 2027', 'No date'])
  })

  it('draws one row per task and no spine', () => {
    // The spine's node cost 24px of the left edge on every row to imply a continuity the
    // sticky month heading now states outright.
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Order invitations' })])
    const html = render(list)
    expect(html.match(/class="tcard"/g)).toHaveLength(2)
    expect(html).not.toContain('tcard__node')
  })

  it('renders nothing rather than an empty shell', () => {
    // The caller owns what an empty board says — and it is not the same sentence as
    // "nothing matches this filter".
    expect(render([])).toBe('')
  })

  it('opens only the rows the app has expanded', () => {
    // `expanded` is a Set owned by `App`, session-only: relaunching into twelve expanded
    // rows is a board nobody can read.
    const list = rows([task({ id: 'a' }), task({ id: 'b', title: 'Order invitations' })])
    const html = render(list, { expanded: new Set(['b']) })
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html.match(/tcard--open/g)).toHaveLength(1)
    expect(html.match(/tcard__content/g)).toHaveLength(1)
    // And it is the right one: the content sits inside b's row, not a's.
    expect(html.indexOf('tcard__content')).toBeGreaterThan(html.indexOf('Order invitations'))
  })

  it('gives each month heading its own tally, counted over that month alone', () => {
    // The board's tracker gives one figure for four hundred days and a row gives its own
    // state; "am I finished with January" had no answer anywhere. Checkable by counting the
    // rows underneath it, which is the whole reason it is allowed on screen.
    const list = rows([
      task({ id: 'a', due: '2027-01-10', doneAt: '2027-01-02T00:00:00.000Z' }),
      task({ id: 'b', title: 'Second', due: '2027-01-20' }),
      task({ id: 'c', title: 'Third', due: '2027-03-02' }),
    ])
    const html = render(list)
    expect(tallies(html)).toEqual(['1/2', '0/1'])
  })

  it('withholds every whole-month figure while a filter is on', () => {
    // THE misleading-number case. `Plan` receives the FILTERED list, so a tally counted over
    // the overdue slice of a month would read "0/1 done" about a month that is nine tasks long
    // and mostly finished. The Today line goes with it: a list with holes cannot claim that
    // everything below a line is still ahead.
    const list = rows([
      task({ id: 'a', due: '2026-12-10' }),
      task({ id: 'b', title: 'Second', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY, unfiltered: false })
    expect(tallies(html)).toEqual([])
    expect(html).not.toContain('plan__now')
  })

  it('marks where today falls, once, and only between two rows', () => {
    // The hero counts down and the tracker carries an on-schedule mark; the list — the screen
    // people live in — had no "you are here" at all.
    const list = rows([
      task({ id: 'past', due: '2026-12-10' }),
      task({ id: 'future', title: 'Second', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(html.match(/class="plan__now"/g)).toHaveLength(1)
    // Above the first row that has NOT passed, never above one that has.
    expect(html.indexOf('plan__now')).toBeGreaterThan(html.indexOf('Book the venue'))
    expect(html.indexOf('plan__now')).toBeLessThan(html.indexOf('Second'))
  })

  it('draws no today line when the boundary has nothing on one side of it', () => {
    // A line above the very first row of a board entirely in the future states nothing, and a
    // board entirely in the past has no row for it to sit above.
    const future = rows([task({ id: 'a', due: '2027-03-20' })])
    expect(render(future, { today: TODAY })).not.toContain('plan__now')
    const past = rows([task({ id: 'a', due: '2026-12-20' })])
    expect(render(past, { today: TODAY })).not.toContain('plan__now')
  })

  it('names the wedding’s own month, once, and leaves the others alone', () => {
    // A plan that runs to one fixed day should say which sign is the last one.
    const list = rows([
      task({ id: 'a', due: '2027-01-10' }),
      task({ id: 'b', title: 'Second', due: '2027-04-12' }),
    ])
    const html = render(list, { weddingMonth: '2027-04' })
    expect(html.match(/plan__month--day/g)).toHaveLength(1)
    expect(html).toContain('the day')
    // On the April heading, not the January one.
    expect(html.indexOf('plan__month--day')).toBeGreaterThan(html.indexOf('January 2027'))
  })

  it('puts no plaque on an undated group, whatever the wedding month is', () => {
    // '' is the undated group's key, and `''.slice(0, 7)` would match an empty weddingMonth.
    const list = rows([task({ id: 'a', due: '' })])
    expect(render(list, { weddingMonth: '' })).not.toContain('plan__month--day')
  })
})

describe('the read-only view toggle', () => {
  const render = (extra = {}) =>
    renderToStaticMarkup(
      <SettingsSheet
        config={mergeConfig({})}
        canEdit
        hasKey
        readOnly={false}
        onToggleReadOnly={noop}
        sheetTimeZone=""
        deletedTasks={[]}
        onRestore={noop}
        onSaveConfig={noop}
        onCompact={noop}
        onEnableEditing={noop}
        onRevokeEditing={noop}
        onClose={noop}
        {...extra}
      />,
    )

  it('offers an editor the guest view, as a toggle that names where the tap goes', () => {
    const html = render()
    expect(html).toContain('Switch to the read-only view')
    expect(html).toContain('aria-pressed="false"')
  })

  it('flips the label rather than only the state, so the way back is legible', () => {
    // A toggle that names its state alone is a guess. Same rule as the row's Edit/Done control.
    const html = render({ readOnly: true, canEdit: false })
    expect(html).toContain('Leave the read-only view')
    expect(html).toContain('aria-pressed="true"')
  })

  it('keeps the revoke control while previewing, and never asks for the link again', () => {
    // THE POINT OF SPLITTING `hasKey` FROM `canEdit`. Previewing is not losing the key, so this
    // half of Settings answers "do you hold one" — otherwise an editor is shown a paste field
    // for a credential already on the device, which reads as the link having broken.
    const html = render({ readOnly: true, canEdit: false })
    expect(html).toContain('Stop editing on this device')
    expect(html).not.toContain('Paste your edit link')
  })

  it('shows a real viewer the paste field and no toggle at all', () => {
    // Nothing to preview and nothing to revoke: a guest has no key.
    const html = render({ hasKey: false, canEdit: false })
    expect(html).toContain('Paste your edit link')
    expect(html).not.toContain('read-only view')
  })

  it('hides maintenance while previewing, because a guest cannot restore a row', () => {
    const html = render({ readOnly: true, canEdit: false, deletedTasks: [task({ id: 'gone' })] })
    expect(html).not.toContain('Purge deleted tasks')
  })
})

describe('Hero', () => {
  const overallOf = (list) => overallProgress(rows(list))
  const heroWith = (overall, extra = {}) =>
    renderToStaticMarkup(
      <Hero
        config={mergeConfig({ weddingDate: '2027-04-18' })}
        today={TODAY}
        canEdit
        overall={overall}
        onOpenSettings={noop}
        {...extra}
      />,
    )

  it('carries the percentage, the bar and the countable tally in the strip', () => {
    const html = heroWith(
      overallOf([task({ id: 'a', doneAt: '2027-01-02T00:00:00.000Z' }), task({ id: 'b' })]),
    )
    expect(html).toContain('hero__progress')
    expect(html).toMatch(/class="hero__percent tnum">50%</)
    expect(html).toContain('role="progressbar"')
    // The tally is what makes the percentage beside it checkable by arithmetic. The app claims
    // no pace: a single figure for that can be wrong, and a count cannot.
    expect(html).toMatch(/class="hero__tally tnum">1 of 2 done</)
  })

  it('carries the on-schedule mark, which is the whole pace signal', () => {
    // No words: the distance between the fill and the mark IS the comparison, and unlike a
    // sentence it declines to pick a verdict it could get wrong.
    expect(heroWith(overallOf([task({ id: 'a' }), task({ id: 'b' })]))).toContain('meter__mark')
  })

  it('names the mark in the spoken value, its only other channel', () => {
    const html = heroWith(overallOf([task({ id: 'a', due: '2026-12-01' }), task({ id: 'b' })]))
    expect(html).toMatch(/aria-valuetext="[^"]*1 of 2 dates have passed"/)
  })

  it('never reads as a finished plan when nothing is finished', () => {
    // The old model's most dangerous reading, kept as a regression: every date passed and
    // nothing done must not report 100%.
    const late = overallOf(
      Array.from({ length: 8 }, (_, index) => task({ id: `t${index}`, due: '2026-12-01' })),
    )
    expect(heroWith(late)).toMatch(/class="hero__percent tnum">0%</)
  })

  it('withholds the METER on an empty board but keeps the strip, which is fixed geometry', () => {
    // `EmptyBoard` says what an empty board means; a bar measuring nothing does not. The strip
    // itself stays: the header is `position: fixed`, so it reserves no flow space and `.views` pads
    // by `--hero-height` — a strip that came and went would leave that padding overstating the
    // header by its own height. Empty, the strip is the header's bottom rule.
    const html = heroWith(overallOf([]))
    expect(html).toContain('hero__progress')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('hero__percent')
    // Same when the prop is absent altogether — the preview harness renders it that way.
    const bare = renderToStaticMarkup(
      <Hero config={mergeConfig({})} today={TODAY} canEdit onOpenSettings={noop} />,
    )
    expect(bare).toContain('hero__progress')
    expect(bare).not.toContain('role="progressbar"')
  })

  it('shows both names, the countdown and the venue', () => {
    const config = mergeConfig({
      partner1Name: 'Aoi',
      partner2Name: 'Ren',
      weddingDate: '2027-04-18',
      venue: 'Meguro',
    })
    const html = renderToStaticMarkup(
      <Hero config={config} today={TODAY} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('Aoi &amp; Ren')
    expect(html).toContain('102 days to go')
    expect(html).toContain('Meguro')
  })

  it('leaves the photograph undescribed, because the h1 beneath it says the same thing', () => {
    const html = renderToStaticMarkup(
      <Hero config={mergeConfig({ partner1Name: 'Aoi' })} today={TODAY} canEdit onOpenSettings={noop} />,
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
      <Hero config={mergeConfig({})} today={TODAY} canEdit onOpenSettings={noop} />,
    )
    expect(html).toContain('No wedding date set')
    // The spelled-out date went with the tall band — there is no room for it in a tenth of the
    // viewport, and a made-up one would have been worse than the gap it left.
    expect(html).not.toContain('hero__eyebrow')
  })

  it('marks a viewer’s board view-only, and an editor’s not at all', () => {
    const config = mergeConfig({ weddingDate: '2027-04-18' })
    expect(
      renderToStaticMarkup(
        <Hero config={config} today={TODAY} canEdit={false} onOpenSettings={noop} />,
      ),
    ).toContain('View only')
    expect(
      renderToStaticMarkup(<Hero config={config} today={TODAY} canEdit onOpenSettings={noop} />),
    ).not.toContain('View only')
  })

  it('handles the day itself and the days after', () => {
    const config = mergeConfig({ weddingDate: TODAY })
    expect(
      renderToStaticMarkup(<Hero config={config} today={TODAY} canEdit onOpenSettings={noop} />),
    ).toContain('Today is the day')

    const past = mergeConfig({ weddingDate: '2027-01-01' })
    expect(
      renderToStaticMarkup(<Hero config={past} today={TODAY} canEdit onOpenSettings={noop} />),
    ).toContain('5 days ago')
  })
})

describe('FilterChips', () => {
  const render = (list, filter = FILTER_ALL) => {
    const overall = overallProgress(rows(list))
    return renderToStaticMarkup(<FilterChips counts={overall} filter={filter} onFilter={noop} />)
  }

  it('carries a count on every filter, and is the only place the counts live', () => {
    // No read-only stat tiles on the tracker: the same
    // numbers are here, and here they are also the control that acts on them.
    const html = render([task({ id: 'a' }), task({ id: 'b' })])
    const labels = [...html.matchAll(/class="chip"[^>]*>([^<]*)</g)].map((m) => m[1])
    expect(labels).toEqual(['All', 'Overdue', 'Soon', 'Later', 'Done'])
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
    // A plain disclosure, not a card: it lives inside Settings › Maintenance now, beside the
    // purge that empties it.
    expect(html).not.toContain('class="card')
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
          today={TODAY}
          canEdit={false}
          overall={overall}
          onOpenSettings={noop}
        />
        <Plan
          tasks={rows([task()])}
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
    expect(html).toContain('1件中0件完了')
    // The relative distance, which is the row's only urgency wording.
    expect(html).toContain('あと5日')
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
      <Plan
        tasks={rows([task({ category: 'ハネムーン旅費' })])}
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

  it('leaves a subtask’s date cell untouched rather than writing an empty one', () => {
    // A subtask is a title and a tick and is offered no date field, so a day written from
    // that empty draft would blank the cell of a row somebody hand-dated in the spreadsheet
    // — and nothing downstream would ever have checked what it wrote.
    const dated = task({ id: 'p-1', parentId: 'p', due: '2027-03-01' })
    const payload = taskFromDraft({ ...draftFrom(dated), title: 'Step 1' }, dated)
    expect(payload.due).toBe('2027-03-01')
  })

  it('is the WHOLE task, so an untouched field commits nothing at all', () => {
    // `TaskEditor` decides "did this change" by comparing the ROW it is about to write with
    // the row already there. If the payload dropped a field, every blur would differ from the
    // stored row and cost a round trip and a toast.
    const [row] = rows([task({ doneAt: '2027-01-02T00:00:00.000Z' })])
    expect(taskToRow(taskFromDraft(draftFrom(row), row))).toEqual(taskToRow(row))
  })

  it('repairs a legacy value on the way through, once, rather than blanking it', () => {
    // A board written before dates lost their clock times holds '2027-04-18T23:59' in every
    // row. `type=date` renders an unparseable value as blank, so without normalising on the
    // way IN the first commit would have cleared a date still visible on the row.
    const legacy = task({ due: '2027-04-18T23:59' })
    expect(draftFrom(legacy).due).toBe('2027-04-18')
    expect(taskFromDraft(draftFrom(legacy), legacy).due).toBe('2027-04-18')
  })

  it('stores no date at all when none was given, and lets the validator refuse it', () => {
    // The draft never INVENTS a date — not today's — because a defaulted date would make every
    // task typed in a hurry overdue tomorrow, a false number nobody typed. A day is required, so
    // the empty string here is what `validateTask` turns into MISSING_DUE and the sheet reports on
    // the field; see test/schema.test.js. Defaulting and requiring are different things.
    expect(taskFromDraft(draftFrom(null)).due).toBe('')
  })

  it('would RESURRECT a deleted task, which is why the delete disarms the flush', () => {
    // The mechanism behind a real defect: edit a title, then delete the task. The delete is
    // optimistic, so the row stops being live and `TaskDetail` unmounts — and its unmount flush
    // resolves the buffered draft against the PRE-delete task. `base` spreads first, so the
    // payload carries an empty `deleted_at`; `update` rewrites the whole row from it, and the
    // two writes serialise, so the resurrection lands second and wins. The task came back ~3s
    // later wearing the edit, with its subtasks gone — the cascade had tombstoned their rows and
    // this write does not touch them.
    //
    // This pins the payload, which is what makes the fix necessary: `remove()` in TaskDetail
    // nulls `flush.current` and ends the session so no such payload is ever built. It cannot
    // pin the handler itself — a static render fires no click.
    const live = task({ id: 'x', title: 'Old title' })
    const payload = taskFromDraft({ ...draftFrom(live), title: 'New title' }, live)
    expect(taskToRow(payload).deleted_at).toBe('')

    // And the same payload built from a task already stamped deleted keeps the tombstone, so
    // the ONLY thing standing between the two is that the flush never runs.
    const gone = task({ id: 'x', title: 'Old title', deletedAt: '2027-01-06T00:00:00.000Z' })
    expect(taskToRow(taskFromDraft({ ...draftFrom(gone), title: 'New title' }, gone)).deleted_at)
      .toBe('2027-01-06T00:00:00.000Z')
  })
})

/**
 * THE ONE THING A STATIC RENDER CANNOT SEE AT ALL IS AN EFFECT, so this reads the component as
 * text. Comments are stripped first: its header explains the dependency it must not have, and a
 * raw match would find the prose rather than the code.
 */
describe('BottomSheet’s open effect', () => {
  const source = readFileSync('src/components/BottomSheet.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*\n/gm, '')

  it('runs ON OPEN and never again', () => {
    // `onClose` is an inline arrow at every call site, so a new one arrives on every parent render.
    // With it in the deps the whole body re-ran each time, and `panel.current?.focus()` pulled focus
    // off whatever field was being typed in — on iOS that drops the keyboard and the caret with it.
    const deps = [...source.matchAll(/\}, \[([^\]]*)\]\)/g)].map((match) => match[1].trim())
    expect(deps).toEqual([''])
    expect(source).not.toMatch(/\[onClose\]/)
  })

  it('reads onClose through a ref, so Escape still calls the CURRENT one', () => {
    // What the empty dep array costs: the listener closes over the first `onClose` it ever saw, so
    // without the ref a sheet reopened for a second task would close the first one's state.
    expect(source).toMatch(/close\.current = onClose/)
    expect(source).toMatch(/close\.current\(\)/)
  })
})

describe('TabBar', () => {
  const barWith = (tab) => renderToStaticMarkup(<TabBar tab={tab} onTab={noop} />)

  it('offers both destinations, each with a WORD as well as a glyph', () => {
    // A pair of unlabelled icons is a guess, and the label is also the channel that keeps the
    // selected tab from being carried by the accent alone.
    const html = barWith(TABS.PLAN)
    expect(html).toContain('Plan')
    expect(html).toContain('Notes')
    expect([...html.matchAll(/class="tabbtn__label"/g)]).toHaveLength(2)
    expect([...html.matchAll(/<svg/g)]).toHaveLength(2)
  })

  it('marks the selected tab in the markup as well as in colour, and only one', () => {
    // `aria-current`, not `role="tablist"`: two thumb targets gain nothing from roving tabindex and
    // arrow traversal, and half of that pattern is worse than none of it. It also survives a static
    // render, which a click-driven selection would not.
    const html = barWith(TABS.NOTES)
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1)
    expect([...html.matchAll(/tabbtn--on/g)]).toHaveLength(1)
    expect(html).toContain('<nav class="tabbar" aria-label=')
    expect(html).not.toContain('role="tab')
  })

  it('names itself, and never with a bare literal', () => {
    expect(barWith(TABS.PLAN)).toContain('aria-label="Views"')
  })
})

describe('Markdown', () => {
  const doc = (text) => renderToStaticMarkup(<Markdown text={text} />)

  it('renders the document’s top level as h2, the h1 being the couple’s names', () => {
    // The header carries the one `<h1>` on both tabs, so a document heading at h1 would break the
    // heading order for a screen reader on every screen.
    expect(doc('# Venue')).toContain('<h2 class="doc__h2"')
    expect(doc('## Deposit')).toContain('<h3 class="doc__h3"')
    expect(doc('# Venue')).not.toContain('<h1')
  })

  it('renders emphasis as strong and em, which carry meaning', () => {
    expect(doc('**yes**')).toContain('<strong>yes</strong>')
    expect(doc('*maybe*')).toContain('<em>maybe</em>')
    expect(doc('***both***')).toContain('<strong><em>both</em></strong>')
    expect(doc('**yes**')).not.toMatch(/<b>|<i>/)
  })

  it('renders the two list kinds as the two list elements', () => {
    expect(doc('- a\n- b')).toContain('<ul class="doc__list doc__list--bullets">')
    expect(doc('1. a')).toContain('<ol class="doc__list doc__list--numbers">')
    expect([...doc('- a\n- b').matchAll(/<li class="doc__item">/g)]).toHaveLength(2)
  })

  it('keeps a single newline as a line break inside one paragraph', () => {
    const html = doc('One\nTwo')
    expect([...html.matchAll(/<p class="doc__p">/g)]).toHaveLength(1)
    expect(html).toContain('<br/>')
  })

  it('RENDERS MARKUP AS TEXT, which is why the parser returns data', () => {
    // The document is written by anybody holding the edit key and read by everybody, and this device
    // keeps a write-capable bearer token in localStorage. Nothing here may become an element.
    const html = doc('<img src=x onerror=alert(1)>\n- [click](javascript:alert(1))')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a ')
    expect(html).toContain('&lt;img')
    expect(html).toContain('javascript:alert(1)')
  })

  it('renders nothing at all for an empty document, leaving the empty state to its caller', () => {
    expect(doc('')).toBe('')
    expect(doc('   \n\n')).toBe('')
  })
})

describe('NotesView', () => {
  const NOTES = '# Venue\nBooked the pavilion.\n- Deposit paid'
  const notesWith = (extra = {}) =>
    renderToStaticMarkup(
      <NotesView notes="" canEdit onSave={noop} onFieldFocus={noop} {...extra} />,
    )

  it('OPENS READ-ONLY, showing the rendered document and no field', () => {
    // Read mode is also the preview, and the Edit toggle is also the preview toggle: a split view
    // would halve a 361px column to ~180px, where a bulleted line wraps every three words.
    const html = notesWith({ notes: NOTES })
    expect(html).toContain('doc__h2')
    expect(html).toContain('Booked the pavilion.')
    expect(html).not.toContain('<textarea')
  })

  it('gives an editor the toggle and a viewer no bar at all', () => {
    expect(notesWith({ notes: NOTES })).toContain('notes__bar')
    expect(notesWith({ notes: NOTES })).toMatch(/aria-pressed="false"[^>]*>/)
    const viewer = notesWith({ notes: NOTES, canEdit: false })
    expect(viewer).not.toContain('notes__bar')
    expect(viewer).not.toContain('aria-pressed')
    // The document itself is unchanged: a viewer reads exactly what an editor wrote.
    expect(viewer).toContain('Booked the pavilion.')
  })

  it('invites an editor to write the first thing and tells a viewer there is nothing', () => {
    // Buttons a viewer cannot press are worse than a sentence, which is `EmptyBoard`'s rule.
    const editor = notesWith()
    expect(editor).toContain('Nothing written down yet')
    expect(editor).toContain('the venue, the caterer')
    const viewer = notesWith({ canEdit: false })
    expect(viewer).toContain('has not written anything here yet')
    expect(viewer).not.toContain('the venue, the caterer')
  })

  it('never opens the editor by itself on an empty document', () => {
    // An auto-opened, auto-focused field on a tab switch raises the keyboard over the bar that was
    // just tapped.
    expect(notesWith()).not.toContain('<textarea')
  })

  it('renders the field, four toggles and the warning once editing', () => {
    // A static render fires no click, so `editing` is the only way this mode reaches a test.
    const html = notesWith({ notes: NOTES, editing: true })
    expect(html).toContain('<textarea')
    expect(html).toContain('Booked the pavilion.')
    for (const label of ['Heading', 'Bullet list', 'Bold', 'Italic']) {
      expect(html, label).toContain(`aria-label="${label}"`)
    }
    expect(html).toMatch(/aria-pressed="true"/)
    // The one place the board's own openness is stated, where somebody is about to type.
    expect(html).toContain('Keep bank details and passwords out of it')
  })

  it('wears the 16px input skin and no autofocus', () => {
    // The class is what buys the border, the ink and the no-zoom floor; `.textarea` adds only the
    // prose metrics. Autofocus on a surface that re-renders per keystroke drops the iOS keyboard.
    const html = notesWith({ editing: true })
    expect(html).toContain('class="input textarea"')
    expect(html).not.toContain('autofocus')
    expect(html).toContain('placeholder=')
  })

  it('carries no unmount flush, unlike a task row', () => {
    // A row can be re-sorted or closed out from under its session, so its cleanup has to write. A
    // document cannot: `App` withholds the tab bar for the whole session, so Done is the only exit
    // and no stray tap writes a half-finished paragraph. Read as text, comments stripped, because
    // the header explains the mechanism it deliberately does NOT have.
    const source = readFileSync('src/components/NotesView.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*\n/gm, '')
    expect(source).not.toMatch(/flush/)
    expect(source).not.toMatch(/=> \(\) =>/)
    // And the save payload is the notes key ALONE — see `App`'s `saveNotes`.
    expect(source).toMatch(/onSave\(next\)/)
  })
})

/**
 * `App` as text, for the two rules about the notes document that no render can show: what its save
 * sends, and which chrome is withheld while it is open. Comments stripped, because the file explains
 * both by naming what it must not do.
 */
describe('App’s notes wiring', () => {
  const source = readFileSync('src/App.jsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*\n/gm, '')

  it('saves the notes key ALONE', () => {
    // `serializeConfig` emits only the fields it is handed and `setConfig` writes only the rows the
    // payload names, which is the whole reason a document can share the config tab with no lock.
    // Spreading the merged config here would write this build's defaults over the sheet and clobber
    // a Settings save landing beside it.
    expect(source).toMatch(/saveConfig\(\{ notes \}\)/)
    expect(source).not.toMatch(/saveConfig\(\{[^}]*\.\.\./)
  })

  it('withholds BOTH pieces of bottom chrome while anything holds unsaved text', () => {
    // The FAB does not move with the keyboard, and `interactive-widget=resizes-content` re-anchors
    // the tab bar just above it — two wide targets on the accessory row, one mis-tap from abandoning
    // an open editor. `typing` is the same count both read.
    expect(source).toMatch(/canEdit && tab === TABS\.PLAN && !typing/)
    expect(source).toMatch(/typing \? null : <TabBar/)
  })

  it('keeps the header and the standing notices on both tabs', () => {
    // Whose wedding, how many days and how much is done are facts about the board, not about a list;
    // and a refused edit link is why the notes have no Edit button, so explaining it on the other tab
    // explains nothing. Both appear once, above the tab switch.
    expect(source.match(/<Hero/g)).toHaveLength(1)
    expect(source.match(/\{notices\}/g)).toHaveLength(1)
    expect(source.indexOf('{notices}')).toBeLessThan(source.indexOf('tab === TABS.NOTES'))
  })

  it('opens on the plan and never remembers otherwise', () => {
    // Session state, like `expanded`: launching into the notes puts the board behind a tab nobody
    // asked to be on.
    expect(source).toMatch(/useState\(TABS\.PLAN\)/)
    expect(source).not.toMatch(/STORAGE_KEYS\.tab/)
  })
})
