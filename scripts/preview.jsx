/**
 * The visual harness. A passing test suite says nothing about whether the board looks
 * right — the sibling app shipped an invisible white-on-white chart with everything
 * green — so this renders the real surfaces to static HTML with the real stylesheets:
 *
 *   npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
 *
 * Then load those in <iframe>s at 320 / 393 / 430 / 768 / 1440 and screenshot: open
 * `scripts/harness.html`, which documents its own query string.
 *
 * USE IFRAMES, NOT A RESIZED WINDOW. An iframe gets its own viewport, so container and
 * media queries resolve honestly; headless Chrome quietly reports a different width than
 * you asked for and every breakpoint reads wrong.
 *
 * A STATIC RENDER RUNS NO EFFECT, so what these files show is every default as it is on
 * first paint — which is the point, and also the limit: an accordion opening, a commit on
 * blur, the native date wheel and the keyboard's effect on a sheet were each verified by
 * driving the built app in a real browser instead.
 */

import { copyFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { mergeConfig } from '../src/config.js'
import { overallProgress, withProgress } from '../src/lib/progress.js'
import { ACCENTS } from '../src/lib/theme.js'
import { setLocale } from '../src/i18n/index.js'
import { findTemplate, materialize } from '../src/lib/templates.js'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from '../src/components/FilterChips.jsx'
import Hero from '../src/components/Hero.jsx'
import Plan from '../src/components/Plan.jsx'
import { PlusIcon } from '../src/components/icons.jsx'

const TOKYO = 'Asia/Tokyo'
const WEDDING_DAY = '2027-04-18'

/**
 * A fixed "today", so a screenshot is comparable to yesterday's. Roughly seven months out:
 * far enough in that some tasks are done, some overdue, some due this fortnight and some
 * months away — which is the only state worth looking at.
 */
const TODAY = '2026-10-02'
const NOW = Date.UTC(2026, 9, 2, 2, 20)

const CONFIG = mergeConfig({
  partner1Name: 'Aoi',
  partner2Name: 'Ren',
  weddingDate: WEDDING_DAY,
  // A long venue name on purpose: this is the string that broke the countdown onto a second
  // line at 393px, and a short fixture never showed it.
  venue: 'The 迎賓館 偕楽園 別邸',
  timezone: TOKYO,
})

/**
 * The photograph, beside the pages that reference it. These files live in `scripts/`, so
 * the app's own absolute `/wedding/hero.jpg` resolves to nothing here and the hero would
 * screenshot as a bare gradient — which is exactly the failure this harness exists to catch,
 * so it must not be the harness's own fault.
 */
const PHOTO = 'preview-hero.jpg'
copyFileSync('public/hero.jpg', `scripts/${PHOTO}`)

let counter = 0

/**
 * The real twelve-month template, with a plausible spread of progress applied: the early
 * items done, several left to run out, one deliberately dateless. Hand-written fixtures
 * would not exercise the month grouping.
 *
 * Seeded in the preview's own locale, because that is what seeding actually does — a
 * template's titles become content at the moment they are written (see templates.js), so
 * the Japanese screenshot has to show Japanese task names, not translated chrome around
 * English rows.
 */
function board(locale) {
  counter = 0
  const seeded = materialize(findTemplate('classic12'), WEDDING_DAY, {
    locale,
    newId: () => `t${counter++}`,
  })

  return seeded.map((task, index) => {
    // The first nine are finished; #10 onwards are left to go overdue, which is what puts an
    // honest gap between the headline figure and the on-schedule mark.
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
 * Subtasks for one parent, so the tally and the checklist inside an open row are both on
 * screen. One parent only: that is the realistic case, and it is what shows that a board
 * without subtasks costs no height.
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

/** One scroll: the photograph is the header and there is no fixed bar but the FAB. */
function Shell({ children, fab = false }) {
  return (
    <div className="app">
      <div className="views">{children}</div>
      {fab ? (
        <span className="fab" aria-hidden="true">
          <PlusIcon style={{ width: '1.5em', height: '1.5em' }} />
        </span>
      ) : null}
    </div>
  )
}

/**
 * The whole board, top to bottom, with the one row that has a checklist opened — so the
 * editor's three fields, the checklist and the add row are all in the screenshot. `open`
 * comes from `App`'s `expanded` set, which no effect populates, so passing it here is the
 * only way to see it.
 *
 * `canEdit` reaches the HERO, not just the body. It was hardcoded true here once, so no
 * fixture could render the View only badge — and that badge sharing the hero's last line
 * with a long venue name is exactly what broke the countdown onto two lines on the live
 * site. A harness that cannot show a case cannot protect the fix for it either.
 */
function BoardView({ locale, canEdit = true, open = true, editing = false }) {
  const { tasks, overall } = surfaces(locale)
  const opened = open ? tasks.find((task) => task.progress.tally) : null
  return (
    <Shell fab={canEdit}>
      <Hero
        config={CONFIG}
        nowMs={NOW}
        canEdit={canEdit}
        overall={overall}
        onOpenSettings={noop}
        photo={PHOTO}
      />
      <div className="view stack">
        <FilterChips
          counts={overall}
          total={overall.total}
          filter={FILTER_ALL}
          onFilter={noop}
        />
        <Plan
          tasks={tasks}
          canEdit={canEdit}
          categories={CONFIG.categories}
          today={TODAY}
          weddingMonth={WEDDING_DAY.slice(0, 7)}
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
 * The rows, on their own, with nothing above them.
 *
 * The board fixtures put the photograph and the tracker first, which is right for judging the
 * whole screen and useless for judging a row — everything worth looking at is a scroll away,
 * and `harness.html`'s `to=` selector does not survive a headless screenshot. This page is one
 * of each state, in order, with the checklist row already open.
 */
function RowsView({ locale, canEdit = true, editing = false }) {
  const fixtures = [
    { id: 'r1', due: '2026-08-20', title: 'Mail the save-the-dates', category: 'Stationery' },
    { id: 'r2', due: '2026-10-01', title: 'Book the photographer and videographer', category: 'Photo' },
    { id: 'r3', due: TODAY, title: 'Compare the two venue quotes', category: 'Venue' },
    { id: 'r4', due: '2026-10-03', title: 'Send the deposit', category: 'Budget' },
    { id: 'r5', due: '2026-10-09', title: 'Choose the invitation paper', category: 'Stationery' },
    { id: 'r6', due: '2027-02-01', title: 'Order signage, vow books and favours', category: 'Gifts' },
    { id: 'r7', due: '2026-09-01', title: 'Agree the budget and who is contributing', category: 'Budget', doneAt: '2026-08-01T00:00:00.000Z' },
    { id: 'r8', due: '', title: 'Decide about a live band', category: 'Music' },
  ]
  const subs = ['Shortlist three venues', 'Visit the shortlist', 'Compare quotes in writing'].map(
    (title, index) => ({
      id: `r3-s${index}`,
      title,
      category: '',
      due: '',
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
          weddingMonth={WEDDING_DAY.slice(0, 7)}
          expanded={new Set(['r3'])}
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
 * The plan around TODAY, and the month the wedding falls in.
 *
 * The board fixtures start in May 2026 and the wedding is in April 2027, so the two things the
 * heading now does — carry a month's tally, and name the one month that is the wedding's — are
 * both eleven screens down, and the `Today` line between the past and the future is with them.
 * `to=` does not survive a headless capture, so a page that cannot be screenshotted is a case
 * nothing protects. This puts all three in the first 400px.
 */
function SignView({ locale, unfiltered = true }) {
  const rows = [
    { id: 's1', due: '2026-09-20', title: 'Mail the save-the-dates', category: 'Stationery', doneAt: '2026-09-02T00:00:00.000Z' },
    { id: 's2', due: '2026-09-28', title: 'Book the band or DJ', category: 'Music' },
    { id: 's3', due: '2026-10-01', title: 'Book the photographer', category: 'Photo', doneAt: '2026-09-30T00:00:00.000Z' },
    { id: 's4', due: TODAY, title: 'Compare the two venue quotes', category: 'Venue' },
    { id: 's5', due: '2026-10-11', title: 'Choose the invitation paper', category: 'Stationery' },
    { id: 's6', due: '2027-04-12', title: 'Final meeting with the planner', category: 'Vendors' },
    { id: 's7', due: WEDDING_DAY, title: 'Wedding day', category: 'Other' },
  ]
  const tasks = withProgress(
    rows.map((row) => ({
      category: '',
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
          weddingMonth={WEDDING_DAY.slice(0, 7)}
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

function EmptyView() {
  return (
    <Shell fab>
      <Hero config={CONFIG} nowMs={NOW} canEdit onOpenSettings={noop} photo={PHOTO} />
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

function emit(name, element, { locale = 'en', accent = 'indigo' } = {}) {
  setLocale(locale)
  const path = `scripts/preview-${name}.html`
  writeFileSync(path, page(renderToStaticMarkup(element), { locale, accent }))
  console.log(path)
}

emit('en', <BoardView locale="en" />)
emit('en-closed', <BoardView locale="en" open={false} />)
emit('en-viewer', <BoardView locale="en" canEdit={false} />)
// Both modes of an open row: reading it, and editing it. A static render fires no click, so
// `editing` is the only way either one reaches a screenshot.
emit('en-rows', <RowsView locale="en" />)
emit('en-rows-editing', <RowsView locale="en" editing />)
emit('en-rows-viewer', <RowsView locale="en" canEdit={false} />)
emit('ja-rows', <RowsView locale="ja" />, { locale: 'ja' })
emit('ja-rows-editing', <RowsView locale="ja" editing />, { locale: 'ja' })
emit('en-empty', <EmptyView />)
/* The sign, the tally, the wedding month and the Today line — plus the FILTERED version, where
   every figure that describes a whole month is deliberately withheld. */
emit('en-sign', <SignView locale="en" />)
emit('en-sign-filtered', <SignView locale="en" unfiltered={false} />)
emit('ja-sign', <SignView locale="ja" />, { locale: 'ja' })
emit('ja', <BoardView locale="ja" />, { locale: 'ja' })
emit('ja-closed', <BoardView locale="ja" open={false} />, { locale: 'ja' })

// One file per accent, so a preset that breaks a contrast pair is visible rather than
// merely measured.
for (const accent of ACCENTS) {
  if (accent === 'indigo') continue
  emit(`en-${accent}`, <BoardView locale="en" open={false} />, { accent })
}

setLocale('en')
