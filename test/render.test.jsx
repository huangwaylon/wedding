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
import TaskFormSheet from '../src/components/TaskFormSheet.jsx'
import { draftFrom, fieldErrors, taskFromDraft } from '../src/components/TaskFields.jsx'
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
    start: '',
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

  it('prints the month over the day, and no percentage', () => {
    // The month is the day's other half and sits above it in the same column, on every dated row: the
    // sticky heading names one only for the rows the calendar still holds, and the two sections above
    // it name a state. The percentage went with the per-row meter: it is 0 or 100 for a task with no
    // checklist, which the tick beside it already says.
    const html = render(row)
    expect(html).toContain('Book the venue')
    expect(html).toMatch(/class="tcard__date">.*?<\/span>/)
    expect(html).toContain('<span class="tcard__month">Jan</span>')
    expect(html).toMatch(/class="tcard__day tnum">11</)
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

  it('keeps the day slot occupied for an undated task, with no month above it', () => {
    // A dash rather than an invented date, and the slot stays so the titles down a month stay
    // in one column. No month line: there is no month, and an empty one would push the dash out of
    // the column it shares with every other day.
    const [none] = rows([task({ due: '' })])
    expect(render(none)).toMatch(/class="tcard__day tnum">–</)
    expect(render(none)).not.toContain('tcard__month')
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
    // What it shows instead: the way in, and nothing else at all on a row with no start date. The
    // due date is NOT restated here — the row's own day column and the words beside it carry it,
    // and a line repeating it was the largest thing in an open row.
    expect(html).not.toContain('tcard__fact')
    expect(html).not.toContain('January 11, 2027')
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?Edit</s)
  })

  it('states the day it STARTS, spelled out, and only when it has one', () => {
    // The one fact worth a line of its own: a start date is the only thing that can say a task is
    // already somebody's to do, and it is one of the two reasons a row appears under This month.
    const [started] = rows([task({ start: '2027-01-04' })])
    const html = render(started, { open: true })
    expect(html).toContain('tcard__fact')
    expect(html).toContain('>Start<')
    expect(html).toContain('Mon, January 4, 2027')
  })

  it('offers no delete on the read path either', () => {
    // Two destructive-adjacent controls behind an ordinary tap is one too many.
    expect(render(row, { open: true })).not.toContain('Delete this task')
    expect(render(row, { open: true, editing: true })).toContain('Delete this task')
  })

  it('states no fact at all on an undated row, having none to state', () => {
    // The day column already prints a dash and the head's accessible name says "No date". A fact
    // line saying it a third time is a label on an absence.
    const [none] = rows([task({ due: '' })])
    expect(render(none, { open: true })).not.toContain('tcard__fact')
  })

  it('renders four fields once editing, with no Save button and no form', () => {
    // Every field commits on blur, so there is no dirty state a collapse or a reload can throw
    // away — and therefore nothing to submit.
    const html = render(row, { open: true, editing: true })
    expect(html).toContain('class="editor"')
    expect(html).toContain('>Title<')
    expect(html).toContain('>Category<')
    // The two days carry a note on the label, so the noun is followed by a space rather than by `<`.
    expect(html).toContain('>Start <span class="field__hint">optional</span>')
    expect(html).toContain('>Due <span class="field__hint">required</span>')
    expect(html).not.toContain('<form')
    // Fields the model does not have.
    expect(html).not.toContain('>Owner<')
    expect(html).not.toContain('>Notes<')
    expect(html).not.toContain('>All day<')
    expect(html).not.toContain('type="time"')
    // TWO days, and no more: the optional one it starts and the one it is due. Both are `type=date`,
    // so this count is also what catches a third being added.
    expect(html.match(/type="date"/g)).toHaveLength(2)
    expect(html).toMatch(/id="edit-a-due"/)
    expect(html).toMatch(/id="edit-a-start"/)
    // IN THE ORDER THEY HAPPEN: a task's span, drawn beginning to end. The required day led while
    // nothing on screen said which was which; the labels above say it now.
    expect(html.indexOf('edit-a-start')).toBeLessThan(html.indexOf('edit-a-due'))
    // The claim the label makes, in the accessibility tree, and on the required day only.
    expect(html.match(/aria-required="true"/g)).toHaveLength(1)
    expect(/id="edit-a-due"[^>]*aria-required="true"/.test(html)).toBe(true)
    // And the facts line gives way to the fields rather than stacking above them.
    expect(html).not.toContain('tcard__fact')
    expect(html).toContain('aria-pressed="true"')
  })

  it('offers a subtask a title and no date field', () => {
    // `validateTask` returns early for anything with a parentId, so a date offered here would
    // be saved unvalidated — and it did once save an end before a start.
    const child = rows([task({ id: 'p' }), sub('p', 1)])[0].subtasks[0]
    const html = render(
      {
        ...child,
        progress: { state: STATE.NODATE, days: null, dated: false, thisMonth: false, tally: null },
        subtasks: [],
      },
      { open: true, editing: true },
    )
    expect(html).toContain('class="editor"')
    // Neither day: `taskFromDraft` leaves both cells of a row with a parentId untouched, so a field
    // offered here would write an unvalidated one.
    expect(html).not.toContain('type="date"')
  })

  it('hides the toggle from a viewer, who has nothing to switch to', () => {
    const parent = rows([task({ id: 'p', start: '2027-01-04' }), sub('p', 1)])[0]
    const viewer = render(parent, { open: true, canEdit: false })
    expect(viewer).not.toContain('tcard__foot')
    expect(viewer).not.toContain('Edit')
    // But the fact and the checklist are both there — that is the whole disclosure for them.
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

  it('keeps the checklist tickable on the READ path, and adds no field to type in', () => {
    // Ticking an item is doing the work, not editing the task, so it is on both paths — and it is
    // the reason a row is opened at all. The add field is NOT: a text input behind the commonest
    // tap made every open row read as a form to fill in.
    const html = render(parented([sub('p', 1)]), { open: true })
    expect(html).not.toContain('class="editor"')
    expect(html).toContain('subtask__toggle')
    expect(html).not.toContain('subtask-add__field')

    const editing = render(parented([sub('p', 1)]), { open: true, editing: true })
    expect(editing).toContain('subtask-add__field')
  })

  it('draws no empty list on a row with no checklist and nothing to add to it', () => {
    // With the add field behind Edit, an editor reading a row with no items has nothing to put in the
    // list — and an empty `<ul>` still occupies its own margin.
    expect(render(parented([]), { open: true })).not.toContain('class="subtasks"')
    expect(render(parented([]), { open: true, editing: true })).toContain('class="subtasks"')
  })

  it('leaves the foot as the FIRST child when there is nothing else behind the row', () => {
    // What `.tcard__foot:first-child` hangs off, and the reason it is a CSS rule rather than a class:
    // a task with no start date and no checklist opens on the foot alone, and two hairlines with blank
    // card between them read as a section that failed to render. The DOM condition is asserted here
    // because the stylesheet cannot see it.
    const html = render(parented([]), { open: true })
    expect(html).toMatch(/<div class="tcard__content"[^>]*><div class="tcard__foot"/)
    // Anything real in front of it — the checklist, the start fact, the editor — and it is not.
    expect(render(parented([sub('p', 1)]), { open: true })).not.toMatch(
      /<div class="tcard__content"[^>]*><div class="tcard__foot"/,
    )
    expect(render(parented([]), { open: true, editing: true })).not.toMatch(
      /<div class="tcard__content"[^>]*><div class="tcard__foot"/,
    )
  })

  it('offers no add field on a PROMOTED row, whatever the mode', () => {
    // A row the read could not place is drawn as a task, but a child of it would be a grandchild
    // and the next read would promote that one too — so the field would invite somebody to type a
    // checklist that walks out of the row. The existing items stay fully live.
    const row = parented([sub('p', 1), sub('p', 2)])
    expect(render(row, { open: true, editing: true })).toContain('subtask-add__field')

    const promoted = { ...row, promoted: true }
    const withheld = render(promoted, { open: true, editing: true })
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

  it('makes a URL in a title a link, leaving the tick its own target', () => {
    // A pasted URL is there to be followed, and an anchor cannot live inside the toggle: HTML
    // admits no interactive descendant in a `<button>`, so the parser hoists it out and the row
    // ends up with two overlapping controls. The circle keeps its 44px, the words become the link.
    const linked = parented([sub('p', 1)])
    linked.subtasks[0] = { ...linked.subtasks[0], title: 'Quote: https://venue.example/a?b=1' }
    const html = render(linked, { open: true })

    expect(html).toContain('subtask--linked')
    expect(html).toContain('href="https://venue.example/a?b=1"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    // The anchor is a SIBLING of the toggle, not inside it.
    const anchor = html.indexOf('<a class="link"')
    const closes = html.indexOf('</button>')
    expect(closes).toBeLessThan(anchor)
    // And the title keeps its own class either way, so one rule styles both shapes.
    expect(html).toContain('class="subtask__title"')
  })

  it('leaves a title with no URL as one whole target', () => {
    const html = render(parented([sub('p', 1)]), { open: true })
    expect(html).not.toContain('subtask--linked')
    expect(html).not.toContain('<a class="link"')
    expect(html).toMatch(/<button[^>]*class="subtask__toggle"[\s\S]*?subtask__title/)
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

    const editing = render(parented([sub('p', 1)]), { open: true, editing: true })
    expect(editing).toContain('aria-label="Delete Step 1"')
  })

  it('adds with Enter rather than a nested form', () => {
    // This list renders inside a row that also holds the editor's fields, and HTML forbids
    // nested forms: the parser drops the inner one, so Enter reached the outer submit and
    // tried to save the TASK. A static render cannot catch that — the nesting only becomes
    // invalid once a browser parses it — so the shape is pinned here instead.
    const open = render(parented([sub('p', 1)]), { open: true, editing: true })
    const start = open.indexOf('class="subtasks"')
    const list = open.slice(start, open.indexOf('</ul>', start))
    expect(list).not.toContain('<form')
    expect(open).not.toContain('<form')
    // A visible way to commit as well as the key: Enter alone left somebody who typed an item
    // and clicked away with nothing saved and no sign anything had happened.
    expect(list).toContain('subtask-add__submit')
  })

  it('offers the add row to an editor and not to a viewer', () => {
    expect(render(parented([sub('p', 1)]), { open: true, editing: true })).toContain(
      'subtask-add__field',
    )
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

  /* Every fixture here is dated OFF the current month (2027-01): a row due in it is lifted into This
     month by design, so a month-grouping assertion written against January would be testing the
     section instead. */
  it('groups by the month it is DUE in, and keeps every task', () => {
    const list = rows([
      task({ id: 'a', due: '2027-02-28' }),
      task({ id: 'b', title: 'Order invitations', due: '2027-03-31' }),
    ])
    const html = render(list)
    expect(months(html)).toEqual(['February 2027', 'March 2027'])
    expect(html.match(/class="plan__group"/g)).toHaveLength(2)
    expect(html).toContain('Book the venue')
    expect(html).toContain('Order invitations')
  })

  it('collects undated tasks in their own group, last', () => {
    // They sort last, so putting the group anywhere else would bury the month in progress.
    const list = rows([
      task({ id: 'a', due: '2027-02-11' }),
      task({ id: 'b', title: 'Someday', due: '' }),
    ])
    expect(months(render(list, { canEdit: false }))).toEqual(['February 2027', 'No date'])
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
      task({ id: 'a', due: '2027-02-10', doneAt: '2027-01-02T00:00:00.000Z' }),
      task({ id: 'b', title: 'Second', due: '2027-02-20' }),
      task({ id: 'c', title: 'Third', due: '2027-03-02' }),
    ])
    const html = render(list)
    expect(tallies(html)).toEqual(['1/2', '0/1'])
  })

  it('withholds every whole-group figure while a filter is on', () => {
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

  it('draws no "you are here" line, the sections BEING where you are', () => {
    // It used to sit between the last row that had passed and the first that had not. With the current
    // month hoisted into This month, every group in the calendar below holds either a finished month or
    // a future one — so that boundary always fell exactly at a month heading, which is not "between two
    // rows" and is a line of chrome about chrome. Both halves of the old case, and neither draws one.
    const mixed = rows([
      task({ id: 'past', due: '2026-12-10', doneAt: '2026-12-09T00:00:00.000Z' }),
      task({ id: 'future', title: 'Second', due: '2027-03-20' }),
    ])
    expect(render(mixed, { today: TODAY })).not.toContain('plan__now')
    const lifted = rows([
      task({ id: 'late', due: '2026-12-10' }),
      task({ id: 'future', title: 'Second', due: '2027-03-20' }),
    ])
    const html = render(lifted, { today: TODAY })
    expect(html).toContain('Past deadline')
    expect(html).not.toContain('plan__now')
  })

  it('names the wedding’s own month, once, and leaves the others alone', () => {
    // A plan that runs to one fixed day should say which sign is the last one.
    const list = rows([
      task({ id: 'a', due: '2027-02-10' }),
      task({ id: 'b', title: 'Second', due: '2027-04-12' }),
    ])
    const html = render(list, { weddingMonth: '2027-04' })
    expect(html.match(/plan__month--day/g)).toHaveLength(1)
    expect(html).toContain('the day')
    // On the April heading, not the January one.
    expect(html.indexOf('plan__month--day')).toBeGreaterThan(html.indexOf('January 2027'))
  })

  it('lifts what is past its deadline into its own section, FIRST, and only when there is any', () => {
    // The first question on a phone is what has gone wrong, and the answer was scattered down
    // eleven months of headings. A row is MOVED, never copied: the same task under two headings is
    // two tasks to anybody scanning, and both tallies would then be wrong.
    const clean = rows([task({ id: 'a', due: '2027-03-20' })])
    expect(render(clean, { today: TODAY })).not.toContain('Past deadline')

    const list = rows([
      task({ id: 'late', title: 'Late one', due: '2026-12-10' }),
      task({ id: 'soon', title: 'Second', due: '2027-02-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(months(html)).toEqual(['Past deadline', 'February 2027'])
    expect(html.indexOf('Past deadline')).toBeLessThan(html.indexOf('February 2027'))
    expect(html.match(/class="tcard"/g)).toHaveLength(2)
    expect(html.match(/class="tcard__title">Late one</g)).toHaveLength(1)
  })

  it('gathers this month AND what is running into one section, under the overdue', () => {
    // Two claims, one section: the month somebody is in, plus work begun early whose date is still to
    // come. The heading names the month and says so beside it, because the strays it holds are dated
    // outside it.
    const list = rows([
      task({ id: 'late', title: 'Late one', due: '2026-12-10' }),
      task({ id: 'due', title: 'Due this month', due: '2027-01-20' }),
      task({ id: 'now', title: 'Started one', due: '2027-03-20', start: '2027-01-02' }),
      task({ id: 'later', title: 'Third', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(months(html)).toEqual(['Past deadline', 'This month', 'March 2027'])
    expect(html.match(/class="tcard"/g)).toHaveLength(4)
    // The section says WHICH month it is, the heading naming a state on its own.
    expect(html).toMatch(/This month<span class="plan__aside">January 2027</)
    // The current month never renders twice: every January row is above, in one section or the other.
    expect(months(html)).not.toContain('January 2027')
    // A start date that has not arrived leaves the row in its month.
    const future = rows([task({ id: 'x', due: '2027-03-20', start: '2027-03-01' })])
    expect(months(render(future, { today: TODAY }))).toEqual(['March 2027'])
  })

  it('leaves an undated row in the group that says so, whatever its start date', () => {
    // Anybody can empty the cell by hand, and such a row has to sort last into its own group: lifted
    // into This month it would read as work in hand while the one thing wrong with it — no date at
    // all — is the reason it is there. The absence check is the OLD section name, which no board may
    // print again.
    const list = rows([
      task({ id: 'a', due: '', start: '2027-01-01' }),
      task({ id: 'b', title: 'Second', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(months(html)).toEqual(['March 2027', 'No date'])
    expect(html).not.toContain('Ongoing')
  })

  it('draws an overdue row as overdue even when it has started', () => {
    // Precedence, and the reason a row can only be in one place: both claims are true of a task
    // that began and then ran out of time, and the louder one wins.
    const list = rows([task({ id: 'a', due: '2026-12-10', start: '2026-12-01' })])
    const html = render(list, { today: TODAY })
    expect(months(html)).toEqual(['Past deadline'])
    expect(html.match(/class="tcard"/g)).toHaveLength(1)
  })

  it('counts a month heading over the MONTH, not over the rows left under it', () => {
    // Lifting a row out of April must not change what April is worth: the heading says April, and a
    // figure at its edge that described the remainder would be true about a slice and false about the
    // month — the exact defect the tally is withheld under a filter to avoid.
    const list = rows([
      task({ id: 'a', due: '2027-03-02', doneAt: '2027-02-01T00:00:00.000Z' }),
      task({ id: 'b', title: 'Started', due: '2027-03-10', start: '2027-01-01' }),
      task({ id: 'c', title: 'Started too', due: '2027-03-11', start: '2027-01-01' }),
      task({ id: 'd', title: 'Plain', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(months(html)).toEqual(['This month', 'March 2027'])
    expect(tallies(html)).toEqual(['2', '1/4'])
    // Two rows are drawn under the heading, and the figure is `aria-hidden` precisely because it is
    // not their arithmetic. Counted on the element, not the class: a finished row wears a modifier.
    expect(html.match(/<article/g)).toHaveLength(4)
  })

  it('states month and day in one column on EVERY row, whatever the heading above says', () => {
    // The rule the three-way caption replaced: a date reads the same way in a section as under a
    // month heading, so nothing has to be read against its context. Under "This month · January
    // 2027" a bare `20` used to mean the 20th of January on a row due in March — the one case a
    // reader could be actively misled by, and it is gone by construction rather than by a label.
    const list = rows([
      task({ id: 'late', title: 'Late one', due: '2026-12-10' }),
      task({ id: 'now', title: 'Started', due: '2027-03-20', start: '2027-01-02' }),
      task({ id: 'plain', title: 'Plain', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    expect(html.match(/class="tcard__month">/g)).toHaveLength(3)
    expect(html).toContain('<span class="tcard__month">Dec</span>')
    // Twice: the lifted stray and the plain row are the same date and print it identically.
    expect(html.match(/<span class="tcard__month">Mar<\/span>/g)).toHaveLength(2)
    // The month never carries the year — that is 67px of a 2rem box in Japanese — and never a word.
    expect(html).not.toContain('Dec 2026')
    expect(html).not.toContain('Due')
  })

  it('states a row’s year only where nothing else on screen gives it one', () => {
    // Two clauses, one idea: a calendar heading says "March 2027" over rows that are all March 2027's,
    // and inside the year the reader is living in a date needs no year at all. What is left is a row a
    // section lifted out of another year — the only place four digits are worth a row's width. TODAY
    // is January 2027.
    const list = rows([
      task({ id: 'late', due: '2026-12-10' }),
      task({ id: 'soon', due: '2027-01-20' }),
      task({ id: 'far', due: '2027-03-20' }),
    ])
    const html = render(list, { today: TODAY })
    // Past deadline names no month, and December was last year.
    expect(html).toContain('<span class="tcard__year">2026</span>')
    // Never grouped: `interpolate` runs a NUMBER through `Intl.NumberFormat`, so a year passed as one
    // renders as '2,026' — in every locale, and only ever on the rows that state a year at all.
    expect(html).not.toContain('2,026')
    // Once, and nowhere else: This month is this year, and the March heading names March 2027 itself.
    expect(html.match(/tcard__year/g)).toHaveLength(1)
    // It leads the meta line, ahead of the nearness the dot marks.
    expect(/tcard__year">2026<\/span><span class="due"/.test(html)).toBe(true)
  })

  it('states the year of a row a section lifted out of another year', () => {
    // The case the old "Due Mar 2027" label was for, minus the label: the heading says January and the
    // row is due in April, which its own column now says. The year is what the column cannot hold —
    // 67px of a 2rem box in Japanese — and what nothing above the row supplies.
    const list = rows([task({ id: 'stray', due: '2028-04-12', start: '2027-01-02' })])
    const html = render(list, { today: TODAY })
    expect(html).toContain('This month')
    expect(html).toContain('<span class="tcard__month">Apr</span>')
    expect(html).toContain('<span class="tcard__year">2028</span>')
    // And no word in front of it: the month is on the row, so nothing has to be corrected.
    expect(html).not.toContain('Due')
  })

  it('states no year at all when nothing tells the row what year it is', () => {
    // `TaskCard` alone — a static render, or any caller with no clock and no heading. Silence is
    // recoverable; an invented year is not. The month and the day are unconditional and still there.
    const [row] = rows([task({ due: '2026-12-10' })])
    const bare = renderToStaticMarkup(
      <TaskCard task={row} canEdit open={false} categories={CATEGORIES} {...CARD_HANDLERS} />,
    )
    expect(bare).not.toContain('tcard__year')
    expect(bare).toContain('<span class="tcard__month">Dec</span>')
  })

  it('says nothing about a month or a year on an undated row, there being none to say', () => {
    // The dash holds the column and the meta line stays as it was: a row with no date has no month,
    // and `formatMonth` would return '' into a span nobody can read.
    const list = rows([task({ id: 'a', due: '', start: '2027-01-01' })])
    const html = render(list, { today: TODAY })
    expect(html).not.toContain('tcard__month')
    expect(html).not.toContain('tcard__year')
  })

  it('counts a lifted section rather than tallying it', () => {
    // Every row in one is unfinished by definition, so `done/total` would read `0/2` for ever. The
    // bare count says how much is on fire without anybody counting rows.
    const list = rows([
      task({ id: 'a', due: '2026-12-10' }),
      task({ id: 'b', title: 'Second', due: '2026-12-11' }),
      task({ id: 'c', title: 'Third', due: '2027-02-20' }),
    ])
    expect(tallies(render(list, { today: TODAY }))).toEqual(['2', '0/1'])
  })

  it('puts the wedding plaque on This month when the wedding IS this month', () => {
    // The plaque follows the month a heading NAMES. On the wedding month every row of it is hoisted
    // into This month, so hanging the tint off the calendar's groups alone would lose the one mark the
    // whole plan counts down to — in the month it matters most.
    const list = rows([task({ id: 'a', due: '2027-01-20' })])
    const html = render(list, { today: TODAY, weddingMonth: '2027-01' })
    // Not through `months()`: that helper matches a bare `class="plan__month"`, and a plaqued heading
    // wears the modifier too — which is the thing being asserted.
    expect(html).toMatch(/class="plan__month plan__month--day">This month</)
    expect(html.match(/plan__month--day/g)).toHaveLength(1)
    expect(html).toContain('the day')
    // Both asides, in that order: which month, then what the month is.
    expect(html).toMatch(/January 2027<\/span><span class="plan__aside">the day</)
  })

  it('never puts the wedding plaque on Past deadline, which names no month', () => {
    // The tint says "this month is the wedding", which is a claim about a month. A section is not
    // one, and the wedding's own tasks can be overdue like any others.
    const list = rows([task({ id: 'a', title: 'Late one', due: '2026-12-02' })])
    const html = render(list, { today: TODAY, weddingMonth: '2026-12' })
    expect(months(html)).toEqual(['Past deadline'])
    expect(html).not.toContain('plan__month--day')
    expect(html).not.toContain('the day')
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

  it('names both lifted sections and the Start fact in Japanese', () => {
    // These four keys are reached through a data table rather than a literal `t('…')` call, so the
    // catalog scan cannot see them: an English leak here would ship silently.
    setLocale('ja')
    const html = renderToStaticMarkup(
      <Plan
        tasks={rows([
          task({ id: 'late', due: '2026-12-10' }),
          task({ id: 'now', due: '2027-03-20', start: '2027-01-02' }),
        ])}
        canEdit
        categories={CATEGORIES}
        today={TODAY}
        expanded={new Set(['now'])}
        onExpand={noop}
        {...CARD_HANDLERS}
      />,
    )
    expect(html).toContain('期限切れ')
    expect(html).toContain('今月')
    // The date column in Japanese: the short month is the only form that fits a 2rem box, and the
    // year takes 年 rather than standing alone as four digits.
    expect(html).toContain('<span class="tcard__month">12月</span>')
    expect(html).toContain('<span class="tcard__month">3月</span>')
    expect(html).toContain('<span class="tcard__year">2026年</span>')
    // The aside naming which month it is, which the heading cannot say on its own.
    expect(html).toContain('<span class="plan__aside">2027年1月</span>')
    expect(html).toContain('開始日')
    expect(html).toContain('2027年1月2日')
    expect(html).not.toContain('Past deadline')
    expect(html).not.toContain('This month')
    expect(html).not.toContain('>Start<')
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
 * What `TaskDetail` hands to `onSave`.
 *
 * The editor commits `taskFromDraft({ ...draftFrom(task), ...patch }, task)` and passes the
 * result straight through. A static render runs no blur, so the payload is built here from
 * those same two functions, in that same order — not re-derived, which would be a second
 * implementation of the rule and could agree with itself while disagreeing with the editor.
 */
describe('the payload TaskDetail hands to onSave', () => {
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
    // `TaskDetail` decides "did this change" by comparing the ROW it is about to write with
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

  it('leaves a start cell the FIELD COULD NOT SHOW exactly as it is', () => {
    // An editor reads FORMATTED_VALUE, so a start date somebody retyped in the Sheets UI arrives in
    // the sheet's locale. `draftFrom` normalises that to blank, and nothing validates an optional day
    // — so writing the blank back would destroy the cell on the first Done, silently. `due` is saved
    // from this by `MISSING_DUE`, which refuses the write with a message instead.
    const row = task({ start: '15/01/2027' })
    expect(draftFrom(row).start).toBe('')
    expect(taskFromDraft(draftFrom(row), row).start).toBe('15/01/2027')
    // So the session reads as unchanged and sends nothing at all.
    expect(taskToRow(taskFromDraft(draftFrom(row), row))).toEqual(taskToRow(row))
    // A readable one still clears.
    const dated = task({ start: '2027-01-15' })
    expect(taskFromDraft({ ...draftFrom(dated), start: '' }, dated).start).toBe('')
  })

  it('stores no date at all when none was given, and lets the validator refuse it', () => {
    // The draft never INVENTS a date — not today's — because a defaulted date would make every
    // task typed in a hurry overdue tomorrow, a false number nobody typed. A day is required, so
    // the empty string here is what `validateTask` turns into MISSING_DUE and the sheet reports on
    // the field; see test/schema.test.js. Defaulting and requiring are different things.
    expect(taskFromDraft(draftFrom(null)).due).toBe('')
  })

  it('shows ONE message per field, and the more useful of the two due codes', () => {
    // A code family collapses to the FIRST match: "give it a date" beats "that is not a real date"
    // on the app's commonest refusal. Nothing else can reach this — the codes come from state inside
    // `TaskDetail`, so a render never sees them.
    expect(fieldErrors(['MISSING_TITLE', 'MISSING_DUE'])).toEqual({
      title: 'MISSING_TITLE',
      due: 'MISSING_DUE',
    })
    expect(fieldErrors(['BAD_DUE', 'MISSING_DUE']).due).toBe('MISSING_DUE')
    expect(fieldErrors(['BAD_DUE']).due).toBe('BAD_DUE')
    expect(fieldErrors([])).toEqual({ title: '', due: '' })
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
    expect(html).toContain('<nav class="tabbar" aria-label="Views"')
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
    // keeps a write-capable bearer token in localStorage. Nothing here may become an element — and
    // an `href` is the one attribute a reader controls, so a scheme outside the allowlist stays the
    // characters that were typed rather than becoming a link.
    const html = doc('<img src=x onerror=alert(1)>\n- [click](javascript:alert(1))')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a ')
    expect(html).toContain('&lt;img')
    expect(html).toContain('javascript:alert(1)')
    for (const scheme of ['data:text/html;base64,x', 'file:///etc/passwd', 'mailto:a@b.c', '//x.example']) {
      const refused = doc(`[click](${scheme})`)
      expect(refused, scheme).not.toContain('<a ')
      expect(refused, scheme).toContain(scheme.replace(/&/g, '&amp;'))
    }
  })

  it('makes an http link, in the one shape that survives a standalone app', () => {
    // Installed to the Home Screen there is no address bar and no Back, so a same-window navigation
    // replaces the board with somebody's venue page and the app has to be killed to get back.
    // `target=_blank` is what hands it to a Safari sheet instead; `rel` keeps the opener and the
    // edit key out of it.
    const html = doc('[the venue](https://venue.example/hall)')
    expect(html).toContain('<a class="link" href="https://venue.example/hall"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('>the venue<')
    // It says where it goes: there is nowhere else on this surface to read that from.
    expect(html).toContain('title="Opens in a new tab"')
    expect(html).toContain('link__mark')
  })

  it('links a bare URL too, and hands the sentence back its punctuation', () => {
    // People paste. A document where `[x](y)` works and a pasted URL does not teaches the syntax by
    // failure.
    const html = doc('See https://venue.example/a, then https://caterer.example.')
    expect(html).toContain('href="https://venue.example/a"')
    expect(html).toContain('href="https://caterer.example"')
    expect(html).toMatch(/<\/a>,/)
    expect(html).toMatch(/<\/a>\./)
  })

  it('renders ONE anchor per link, whatever the label holds', () => {
    // `parseMarkdown` marks the label's runs individually, so a label with a mark inside it arrives
    // as three spans carrying the same URL. Wrapped one at a time that is three anchors, three
    // trailing glyphs and three tab stops for one link.
    const html = doc('Quote: [the **pavilion** hall](https://venue.example) ok')
    expect(html.match(/<a class="link"/g)).toHaveLength(1)
    expect(html.match(/link__mark/g)).toHaveLength(1)
    expect(html).toContain('<strong>pavilion</strong>')
    expect(html).toMatch(/<a class="link"[^>]*>the <strong>pavilion<\/strong> hall/)
    // Two links on one line stay two.
    expect(doc('[a](https://a.example) [b](https://b.example)').match(/<a class="link"/g)).toHaveLength(2)
    // And two adjacent bare URLs are two, not one run merged by a shared href.
    expect(doc('https://a.example https://b.example').match(/<a class="link"/g)).toHaveLength(2)
  })

  it('nests the anchor outside the marks, so a bold link is one target', () => {
    const html = doc('**[the venue](https://venue.example)**')
    expect(html).toMatch(/<a class="link"[^>]*><strong>the venue<\/strong>/)
    // And escapes what an href holds, `&` above all.
    expect(doc('https://x.example/?a=1&b=2')).toContain('href="https://x.example/?a=1&amp;b=2"')
  })

  it('renders nothing at all for an empty document, leaving the empty state to its caller', () => {
    expect(doc('')).toBe('')
    expect(doc('   \n\n')).toBe('')
  })

  it('wraps the document in `.doc`, which every rule describing it hangs off', () => {
    // Drop the class and the whole `.doc*` block in app.css becomes dead: the type scale, `strong` at
    // 600, the marker ink, the per-element rhythm and the line-height it shares with the editor.
    expect(doc('# Venue')).toContain('<div class="doc">')
  })
})

describe('NotesView', () => {
  const NOTES = '# Venue\nBooked the pavilion.\n- Deposit paid'
  const notesWith = (extra = {}) =>
    renderToStaticMarkup(
      <NotesView notes="" canEdit onSave={noop} onFieldFocus={noop} {...extra} />,
    )

  it('OPENS READ-ONLY, showing the rendered document and no field', () => {
    // Read mode is also the preview, and the Edit control is also the preview toggle: a split view
    // would halve a 361px column to ~180px, where a bulleted line wraps every three words.
    const html = notesWith({ notes: NOTES })
    expect(html).toContain('doc__h2')
    expect(html).toContain('Booked the pavilion.')
    expect(html).not.toContain('<textarea')
  })

  it('floats the way in and keeps the bar for the SESSION, not for the document', () => {
    // A sticky bar above a document, carrying one button, was a row of chrome over every line of it
    // and never scrolled away. The plan tab already floats its one action where a thumb is; this
    // does the same, and the bar comes back with the four marks and Done.
    const read = notesWith({ notes: NOTES })
    expect(read).not.toContain('notes__bar')
    expect(read).toContain('class="fab"')
    expect(read).toContain('aria-label="Edit the notes"')

    const editing = notesWith({ notes: NOTES, editing: true })
    expect(editing).toContain('notes__bar')
    // And not both at once: a second floating control over an open editor is one mis-tap from
    // leaving it, which is why `App` withholds the tab bar over the same window.
    expect(editing).not.toContain('class="fab"')
  })

  it('gives a viewer no control at all, on either mode', () => {
    const viewer = notesWith({ notes: NOTES, canEdit: false })
    expect(viewer).not.toContain('notes__bar')
    expect(viewer).not.toContain('class="fab"')
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
    // And nothing opens the editor by itself: an auto-focused field on a tab switch raises the keyboard
    // over the control that was just tapped.
    expect(editor).not.toContain('<textarea')
    // The way in is there even with nothing written: it is what writes the first line.
    expect(editor).toContain('class="fab"')
    expect(viewer).not.toContain('class="fab"')
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

  it('wears the SHARED toggle rather than a second copy of it', () => {
    // The control this commit consolidated. Hand-rolling the button again leaves both call sites
    // working and every other assertion green, so the shape is what has to be pinned: one element,
    // and no `aria-pressed` of its own anywhere in either file.
    expect(notesWith({ notes: NOTES, editing: true })).toContain(
      'class="btn btn--secondary btn--sm edit-toggle"',
    )
    for (const file of ['NotesView', 'TaskDetail']) {
      const text = readFileSync(`src/components/${file}.jsx`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*\n/gm, '')
      expect(text, file).toMatch(/<EditToggle/)
      expect(text, `${file} hand-rolls the toggle`).not.toMatch(/aria-pressed/)
    }
  })

  it('waits for the write before leaving edit mode, having no optimistic half', () => {
    // `saveConfig` keeps `notes` at its old value for the write plus the forced re-read, so a session
    // that closed on the unawaited promise put the pre-save document back on screen — and re-entering
    // Edit inside that window loaded the stale text, which the next Done then wrote back over the save.
    const source = readFileSync('src/components/NotesView.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*\n/gm, '')
    expect(source).toMatch(/await onSave\(/)
    expect(source).toMatch(/if \(ok\) setDraft\(null\)/)
    // And the control says so, rather than accepting a second press into the same write.
    expect(source).toMatch(/busy=\{saving\}/)
  })

  it('needs the CAPABILITY as well as a draft, or the editor is stranded', () => {
    // The bar lives behind `canEdit`, so an editor who switches to the read-only view mid-session would
    // otherwise keep the field with no Done, no toolbar and — `typing` still being 1 — no tab bar.
    const html = renderToStaticMarkup(
      <NotesView notes={NOTES} canEdit={false} onSave={noop} onFieldFocus={noop} editing />,
    )
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('notes__bar')
    expect(html).toContain('doc__h2')
  })

  it('carries no unmount flush, unlike a task row', () => {
    // A row can be re-sorted or closed out from under its session, so its cleanup has to write. A
    // document cannot: `App` withholds the tab bar for the whole session, so Done is the only exit
    // and no stray tap writes a half-finished paragraph. Read as text, comments stripped, because
    // the header explains the mechanism it deliberately does NOT have.
    // ONE call site, counted: `not.toMatch(/flush/)` only catches the word, and the file already has a
    // `return () => …` cleanup for the `typing` report, so no regex over the shape can cover the one a
    // flush would take. A second `onSave` anywhere is the thing to catch.
    const source = readFileSync('src/components/NotesView.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*\n/gm, '')
    expect(source.match(/onSave\(/g)).toHaveLength(1)
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

  it('floats ONE Fab, worn by both tabs, rather than two copies of the markup', () => {
    // `.fab` is in the exactly-three list of things allowed a shadow, so a second hand-rolled
    // button drifts on the elevation, the target and — the one that matters — whether it carries an
    // `aria-label` at all, the glyph being its only content.
    const files = ['App', 'components/NotesView']
    for (const file of files) {
      const text = readFileSync(`src/${file}.jsx`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*\n/gm, '')
      expect(text, file).toMatch(/<Fab\b/)
      expect(text, `${file} hand-rolls the FAB`).not.toMatch(/className="fab"/)
    }
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

/**
 * The create sheet. It renders `TaskFieldSet`, the same four fields the row's editor draws — but from
 * the other skin and with its own ids, and it is the surface a first task is typed into, so the rules
 * that live in the ORDER of those fields need pinning on both.
 */
describe('the create sheet', () => {
  const render = () =>
    renderToStaticMarkup(
      <TaskFormSheet categories={CATEGORIES} onSave={noop} onClose={noop} />,
    )

  it('draws the two days in the order they happen, each saying which it is', () => {
    const html = render()
    expect(html).toContain('>Start <span class="field__hint">optional</span>')
    expect(html).toContain('>Due <span class="field__hint">required</span>')
    expect(html.indexOf('task-start')).toBeLessThan(html.indexOf('task-due'))
    // Two days and no more, and the required one alone carries the claim in the a11y tree.
    expect(html.match(/type="date"/g)).toHaveLength(2)
    expect(html.match(/aria-required="true"/g)).toHaveLength(1)
    expect(/id="task-due"[^>]*aria-required="true"/.test(html)).toBe(true)
  })

  it('opens every field BLANK, a defaulted date being an invented one', () => {
    // Required is not defaulted: a date nobody typed lands in the overdue count and the on-schedule
    // mark, so anything entered in a hurry reads overdue tomorrow.
    const html = render()
    expect(/id="task-due"[^>]*value=""/.test(html)).toBe(true)
    expect(/id="task-start"[^>]*value=""/.test(html)).toBe(true)
    expect(/id="task-title"[^>]*value=""/.test(html)).toBe(true)
  })

  it('puts Save in the sticky footer, outside the form it submits', () => {
    // Inside, it sits under the keyboard on iOS; the `form` attribute is what reaches it from there.
    const html = render()
    expect(html).toContain('form="task-form"')
    expect(html).toContain('id="task-form"')
  })
})
