/**
 * The visual harness. A passing suite says nothing about whether the board looks right, so this
 * renders the real surfaces to static HTML with the real stylesheets:
 *
 *   npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
 *
 * Then load those in <iframe>s at 320 / 393 / 430 / 768 / 1440 and screenshot: open
 * `scripts/harness.html`, which documents its own query string. Iframes, not a resized window —
 * an iframe gets its own viewport, so container and media queries resolve correctly, while
 * headless Chrome reports a different width than asked for.
 *
 * A static render runs no effect, so these files show every default on first paint. The
 * accordion, an edit session's one write, the native date wheel and the keyboard's effect on a sheet are
 * covered by `scripts/drive.mjs` instead — as is the notes field's height, which is driven from
 * `scrollHeight`, so `en-notes-editing` here draws it at its bare `min-height` with the text
 * clipped. That page is for the toolbar and the type, not the box.
 */

import { copyFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { mergeConfig } from '../src/config.js'
import { overallProgress, withProgress } from '../src/lib/progress.js'
import { monthOf } from '../src/lib/time.js'
import { ACCENTS, DEFAULT_ACCENT } from '../src/lib/theme.js'
import { setLocale } from '../src/i18n/index.js'
import { findTemplate, materialize } from '../src/lib/templates.js'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from '../src/components/FilterChips.jsx'
import Hero from '../src/components/Hero.jsx'
import NotesView from '../src/components/NotesView.jsx'
import Plan from '../src/components/Plan.jsx'
import TabBar, { TABS } from '../src/components/TabBar.jsx'
import { ICON_SIZE, PlusIcon } from '../src/components/icons.jsx'

const TOKYO = 'Asia/Tokyo'
const WEDDING_DAY = '2027-04-18'

/** A fixed "today", so a screenshot is comparable to yesterday's. Seven months out. */
const TODAY = '2026-10-02'

const CONFIG = mergeConfig({
  partner1Name: 'Aoi',
  partner2Name: 'Ren',
  weddingDate: WEDDING_DAY,
  // A long venue name: a short one never shows the countdown breaking onto two lines at 393px.
  venue: 'The 迎賓館 偕楽園 別邸',
  timezone: TOKYO,
})

/**
 * The photograph, beside the pages that reference it: these files live in `scripts/`, so the app's
 * absolute `/wedding/hero.jpg` resolves to nothing and the hero would screenshot as a bare
 * gradient — a failure this harness exists to catch, so it must not be its own.
 */
const PHOTO = 'preview-hero.jpg'
copyFileSync('public/hero.jpg', `scripts/${PHOTO}`)

let counter = 0

/**
 * The real twelve-month template with a spread of progress applied: early items done, several left
 * to run out, one dateless. Hand-written fixtures would not exercise the month grouping.
 *
 * Seeded in the preview's own locale, because that is what seeding does: a template's titles become
 * content when written (see templates.js), so the Japanese screenshot shows Japanese task names
 * rather than translated chrome around English rows.
 */
function board(locale) {
  counter = 0
  const seeded = materialize(findTemplate('classic12'), WEDDING_DAY, {
    locale,
    newId: () => `t${counter++}`,
  })

  return seeded.map((task, index) => {
    // The first nine are finished; #10 onwards go overdue, which puts a gap between the headline
    // figure and the on-schedule mark.
    if (index < 9) return { ...task, doneAt: '2026-06-01T00:00:00.000Z' }
    // One dateless task, so the trailing "No date" group is on screen.
    if (index === 14) {
      return {
        ...task,
        due: '',
        title: locale === 'ja' ? '生演奏にするか決める' : 'Decide about a live band',
      }
    }
    return task
  })
}

/**
 * Subtasks for one parent, so the tally and the checklist inside an open row are both on screen.
 * One parent only, which also shows a board without subtasks costing no height.
 */
function withSubtasks(tasks, locale) {
  const parent = tasks[11]
  const titles =
    locale === 'ja'
      ? ['候補を3つに絞る', '候補を見学する', '見積もりを比較する', '契約書に署名する', '手付金を払う']
      : [
          'Shortlist three venues',
          'Visit the shortlist',
          'Compare quotes in writing',
          'Sign the contract',
          'Pay the deposit',
        ]
  return [
    ...tasks,
    ...titles.map((title, index) => ({
      id: `${parent.id}-s${index}`,
      title,
      category: '',
      due: '',
      doneAt: index < 3 ? '2026-08-01T00:00:00.000Z' : '',
      createdAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      updatedAt: '',
      deletedAt: '',
      parentId: parent.id,
    })),
  ]
}

/** Built per locale, for the reason in `board`. */
function surfaces(locale) {
  const tasks = withProgress(withSubtasks(board(locale), locale), TODAY)
  return { tasks, overall: overallProgress(tasks) }
}

const noop = () => {}

/**
 * One scrolling document, with the three pinned things: the header, the FAB and the tab bar. The bar
 * is in every fixture, because what it can get wrong is standing on the last row — and that is only
 * visible with real content behind it.
 */
function Shell({ children, fab = false, tab = TABS.PLAN }) {
  /* Both tabs float one: `+` on the plan, a pencil on the notes. `NotesView` renders its own, so
     this only ever draws the plan's — hence the glyph is not a prop. */
  return (
    <div className="app">
      <div className="views">{children}</div>
      {fab ? (
        <span className="fab" aria-hidden="true">
          <PlusIcon style={ICON_SIZE.fab} />
        </span>
      ) : null}
      <TabBar tab={tab} onTab={noop} />
    </div>
  )
}

/**
 * The whole board, with the checklist row opened so the editor's four fields, the checklist and
 * the add row are all in the screenshot. `open` comes from `App`'s `expanded` set, which no effect
 * populates, so passing it here is the only way to see it.
 *
 * `canEdit` reaches the hero, not just the body: the View only badge shares the hero's last line
 * with the venue name, and a fixture that cannot show a case cannot protect it.
 */
function BoardView({ locale, canEdit = true, open = true, editing = false }) {
  const { tasks, overall } = surfaces(locale)
  const opened = open ? tasks.find((task) => task.progress.tally) : null
  return (
    <Shell fab={canEdit}>
      <Hero
        config={CONFIG}
        today={TODAY}
        canEdit={canEdit}
        overall={overall}
        onOpenSettings={noop}
        photo={PHOTO}
      />
      <div className="view stack">
        <FilterChips counts={overall} filter={FILTER_ALL} onFilter={noop} />
        <Plan
          tasks={tasks}
          canEdit={canEdit}
          categories={CONFIG.categories}
          today={TODAY}
          weddingMonth={monthOf(WEDDING_DAY)}
          expanded={new Set(opened ? [opened.id] : [])}
          onExpand={noop}
          onToggle={noop}
          onSave={noop}
          onDelete={noop}
          onAddSubtask={noop}
          onFieldFocus={noop}
          editing={editing}
        />
      </div>
    </Shell>
  )
}

/**
 * The rows on their own: one of each state, in order, with the checklist row open. In the board
 * fixtures the photograph and the tracker put every row a scroll away, and `harness.html`'s `to=`
 * does not survive a headless screenshot.
 */
function RowsView({ locale, canEdit = true, editing = false }) {
  const fixtures = [
    { id: 'r1', due: '2026-08-20', title: 'Mail the save-the-dates', category: 'Stationery' },
    { id: 'r2', due: '2026-10-01', title: 'Book the photographer and videographer', category: 'Photo' },
    { id: 'r3', due: TODAY, title: 'Compare the two venue quotes', category: 'Venue', start: '2026-09-25' },
    { id: 'r4', due: '2026-10-03', title: 'Send the deposit', category: 'Budget' },
    { id: 'r5', due: '2026-10-09', title: 'Choose the invitation paper', category: 'Stationery' },
    { id: 'r6', due: '2027-02-01', title: 'Order signage, vow books and favours', category: 'Gifts' },
    { id: 'r7', due: '2026-09-01', title: 'Agree the budget and who is contributing', category: 'Budget', doneAt: '2026-08-01T00:00:00.000Z' },
    { id: 'r8', due: '', title: 'Decide about a live band', category: 'Music' },
  ]
  /* The last item holds a URL, so the linked shape — the tick and the link as two targets — is in
     the capture beside three ordinary rows. */
  const subs = [
    'Shortlist three venues',
    'Visit the shortlist',
    'Compare quotes in writing',
    'Quote B: https://venue.example/quotes/2027-04-18',
  ].map(
    (title, index) => ({
      id: `r3-s${index}`,
      title,
      category: '',
      due: '',
      start: '',
      doneAt: index < 1 ? '2026-08-01T00:00:00.000Z' : '',
      createdAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      updatedAt: '',
      deletedAt: '',
      parentId: 'r3',
    }),
  )
  const tasks = withProgress(
    [
      ...fixtures.map((row) => ({
        category: '',
        start: '',
        doneAt: '',
        createdAt: '',
        updatedAt: '',
        deletedAt: '',
        parentId: '',
        ...row,
      })),
      ...subs,
    ],
    TODAY,
  )
  return (
    <Shell fab={canEdit}>
      <div className="view stack">
        <Plan
          tasks={tasks}
          canEdit={canEdit}
          categories={CONFIG.categories}
          today={TODAY}
          weddingMonth={monthOf(WEDDING_DAY)}
          /* Two rows open: the one with a checklist and a start date, and one with NEITHER — which is
             the case where the open content is the foot alone, and where a second hairline used to
             draw 28px of blank card. */
          expanded={new Set(['r3', 'r4'])}
          onExpand={noop}
          onToggle={noop}
          onSave={noop}
          onDelete={noop}
          onAddSubtask={noop}
          onFieldFocus={noop}
          editing={editing}
        />
      </div>
    </Shell>
  )
}

/**
 * The plan around TODAY: the two sections, the month tally and the wedding plaque. The board fixtures
 * start in May 2026 against an April 2027 wedding, so all of those are eleven screens down; `to=` does
 * not survive a headless capture, so a surface only reachable mid-scroll needs a page of its own. This
 * puts them in the first 700px.
 *
 * Every case the sections have to get right is here: rows past their date and unfinished, rows dated
 * inside the current month, a stray begun early and due later — the one row here in another YEAR, so
 * the only one stating one — one past its date and FINISHED, which stays in its own month, and one
 * that starts in the future.
 */
function SignView({ locale, unfiltered = true }) {
  const rows = [
    { id: 's1', due: '2026-09-20', title: 'Mail the save-the-dates', category: 'Stationery' },
    { id: 's2', due: '2026-09-28', title: 'Book the band or DJ', category: 'Music', start: '2026-09-01' },
    { id: 's3', due: '2026-10-01', title: 'Book the photographer', category: 'Photo', doneAt: '2026-09-30T00:00:00.000Z' },
    { id: 's4', due: TODAY, title: 'Compare the two venue quotes', category: 'Venue', start: '2026-09-25' },
    { id: 's5', due: '2026-10-11', title: 'Choose the invitation paper', category: 'Stationery', start: '2026-09-28' },
    { id: 's6', due: '2026-10-14', title: 'Confirm the shuttle bus', category: 'Guests' },
    /* The stray: begun months ago, due in April. It is lifted into This month and is the one row on
       this page in another year, so the only one whose meta line carries one. */
    { id: 's7', due: '2027-04-12', title: 'Final meeting with the planner', category: 'Vendors', start: '2026-09-15' },
    { id: 's8', due: WEDDING_DAY, title: 'Wedding day', category: 'Other' },
  ]
  const tasks = withProgress(
    rows.map((row) => ({
      category: '',
      start: '',
      doneAt: '',
      createdAt: '',
      updatedAt: '',
      deletedAt: '',
      parentId: '',
      ...row,
    })),
    TODAY,
  )
  return (
    <Shell>
      <div className="view stack">
        <Plan
          tasks={tasks}
          canEdit
          categories={CONFIG.categories}
          today={TODAY}
          weddingMonth={monthOf(WEDDING_DAY)}
          unfiltered={unfiltered}
          expanded={new Set()}
          onExpand={noop}
          onToggle={noop}
          onSave={noop}
          onDelete={noop}
          onAddSubtask={noop}
          onFieldFocus={noop}
        />
      </div>
    </Shell>
  )
}

/**
 * The document a couple would actually write, using every block and both marks, so the whole type
 * scale is in one screenshot. Three pages: read, edit and the empty state — a static render fires no
 * click, so `editing` is the only way the toolbar and the field reach a capture.
 */
const NOTES = {
  en: [
    '# Venue',
    'The garden pavilion, **confirmed** for the 18th.',
    'Rain plan is the orangery — no extra charge.',
    'Quote: [the pavilion](https://venue.example/pavilion) and https://maps.example/q/pavilion',
    '',
    '## Still to confirm with them',
    '- Chair covers, ivory',
    '- Access from 9am for the florist',
    '',
    '# Food',
    '1. Tasting menu, five courses',
    '2. Two vegetarian, one *gluten free*',
    '3. Cake cut at 8pm',
  ].join('\n'),
  ja: [
    '# 会場',
    'ガーデンパビリオン。18日で**確定**。',
    '雨天時はオランジェリー。追加料金なし。',
    '見積: [パビリオン](https://venue.example/pavilion) と https://maps.example/q/pavilion',
    '',
    '## 会場に確認すること',
    '- 椅子カバーはアイボリー',
    '- 装花の搬入は9時から',
    '',
    '# 料理',
    '1. コースは5品',
    '2. ベジタリアン2名、*グルテンフリー*1名',
    '3. ケーキ入刀は20時',
  ].join('\n'),
}

function NotesPage({ locale, notes = NOTES[locale], canEdit = true, editing = false }) {
  const { overall } = surfaces(locale)
  return (
    <Shell tab={TABS.NOTES}>
      <Hero
        config={CONFIG}
        today={TODAY}
        canEdit={canEdit}
        overall={overall}
        onOpenSettings={noop}
        photo={PHOTO}
      />
      <div className="view stack">
        <NotesView
          notes={notes}
          canEdit={canEdit}
          onSave={noop}
          onFieldFocus={noop}
          editing={editing}
        />
      </div>
    </Shell>
  )
}

function EmptyView() {
  return (
    <Shell fab>
      <Hero config={CONFIG} today={TODAY} canEdit onOpenSettings={noop} photo={PHOTO} />
      <div className="view stack">
        <EmptyBoard
          canEdit
          weddingDay={WEDDING_DAY}
          seeding={false}
          onSeed={noop}
          onOpenSettings={noop}
        />
      </div>
    </Shell>
  )
}

/** Real stylesheets, in the order main.jsx loads them. */
function page(body, { locale, accent }) {
  return `<!doctype html>
<html lang="${locale}" data-accent="${accent}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../src/styles/tokens.css">
<link rel="stylesheet" href="../src/styles/base.css">
<link rel="stylesheet" href="../src/styles/primitives.css">
<link rel="stylesheet" href="../src/styles/app.css">
<title>preview ${locale} ${accent}</title>
</head>
<body>${body}</body>
</html>
`
}

function emit(name, element, { locale = 'en', accent = DEFAULT_ACCENT } = {}) {
  setLocale(locale)
  const path = `scripts/preview-${name}.html`
  writeFileSync(path, page(renderToStaticMarkup(element), { locale, accent }))
  console.log(path)
}

emit('en', <BoardView locale="en" />)
emit('en-closed', <BoardView locale="en" open={false} />)
emit('en-viewer', <BoardView locale="en" canEdit={false} />)
// A static render fires no click, so `editing` is the only way edit mode reaches a screenshot.
emit('en-rows', <RowsView locale="en" />)
emit('en-rows-editing', <RowsView locale="en" editing />)
emit('en-rows-viewer', <RowsView locale="en" canEdit={false} />)
emit('ja-rows', <RowsView locale="ja" />, { locale: 'ja' })
emit('ja-rows-editing', <RowsView locale="ja" editing />, { locale: 'ja' })
emit('en-empty', <EmptyView />)
emit('en-notes', <NotesPage locale="en" />)
emit('en-notes-editing', <NotesPage locale="en" editing />)
emit('en-notes-empty', <NotesPage locale="en" notes="" />)
emit('en-notes-viewer', <NotesPage locale="en" canEdit={false} />)
emit('ja-notes', <NotesPage locale="ja" />, { locale: 'ja' })
emit('ja-notes-editing', <NotesPage locale="ja" editing />, { locale: 'ja' })
/* Plus the filtered version, where every figure describing a whole month is withheld. */
emit('en-sign', <SignView locale="en" />)
emit('en-sign-filtered', <SignView locale="en" unfiltered={false} />)
emit('ja-sign', <SignView locale="ja" />, { locale: 'ja' })
emit('ja', <BoardView locale="ja" />, { locale: 'ja' })
emit('ja-closed', <BoardView locale="ja" open={false} />, { locale: 'ja' })

// One file per non-default accent, so a preset that breaks a contrast pair is visible rather than
// merely measured. The default is skipped: every page above renders it.
for (const accent of ACCENTS) {
  if (accent === DEFAULT_ACCENT) continue
  emit(`en-${accent}`, <BoardView locale="en" open={false} />, { accent })
}

setLocale('en')
