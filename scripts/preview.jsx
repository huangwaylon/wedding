/**
 * The visual harness. A passing test suite says nothing about whether the board looks
 * right — the sibling app shipped an invisible white-on-white chart with everything
 * green — so this renders the real surfaces to static HTML with the real stylesheets:
 *
 *   npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
 *
 * Then load those in <iframe>s at 390 / 430 / 768 / 1440 and screenshot: open
 * `scripts/harness.html`, which documents its own query string.
 *
 * USE IFRAMES, NOT A RESIZED WINDOW. An iframe gets its own viewport, so container and
 * media queries resolve honestly; headless Chrome quietly reports a different width than
 * you asked for and every breakpoint reads wrong.
 *
 * A STATIC RENDER RUNS NO EFFECT, so what these files show is every default as it is on
 * first paint — which is the point, and also the limit: the tab switch, an accordion
 * opening, a commit on blur and the keyboard's effect on a sheet were each verified by
 * driving the built app in a real browser instead.
 */

import { copyFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { mergeConfig } from '../src/config.js'
import { overallProgress, withProgress } from '../src/lib/progress.js'
import { wallToInstant } from '../src/lib/time.js'
import { ACCENTS } from '../src/lib/theme.js'
import { setLocale } from '../src/i18n/index.js'
import { findTemplate, materialize } from '../src/lib/templates.js'
import { DeletedList } from '../src/components/Deleted.jsx'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from '../src/components/FilterChips.jsx'
import Hero from '../src/components/Hero.jsx'
import OverallCard from '../src/components/OverallCard.jsx'
import TabBar, { TABS } from '../src/components/TabBar.jsx'
import Timeline from '../src/components/Timeline.jsx'
import { PlusIcon } from '../src/components/icons.jsx'

const TOKYO = 'Asia/Tokyo'
const WEDDING_DAY = '2027-04-18'

/**
 * A fixed "now", so a screenshot is comparable to yesterday's. Roughly seven months out:
 * far enough in that some tasks are done, some overdue and some not started, which is the
 * only state worth looking at.
 */
const NOW_WALL = '2026-10-02T11:20'
const NOW = wallToInstant(NOW_WALL, TOKYO)

const CONFIG = mergeConfig({
  partner1Name: 'Aoi',
  partner2Name: 'Ren',
  weddingDate: WEDDING_DAY,
  weddingTime: '14:00',
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
 * would not exercise the month grouping or the spine.
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
    if (index === 12) {
      return {
        ...task,
        owner: locale === 'ja' ? 'れん' : 'Ren',
        notes: locale === 'ja' ? '見積もりは月末まで有効。' : 'Quote expires end of the month.',
      }
    }
    if (index === 14) {
      return {
        ...task,
        start: '',
        end: '',
        title: locale === 'ja' ? '生演奏にするか決める' : 'Decide about a live band',
      }
    }
    return task
  })
}

/**
 * Subtasks for one in-progress parent, so the tally, the tally-driven meter and the
 * checklist inside an open card are all on screen. One parent only: that is the realistic
 * case, and it is what shows that a board without subtasks costs no height.
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
      start: '',
      end: '',
      allDay: false,
      doneAt: index < 3 ? '2026-08-01T00:00:00.000Z' : '',
      notes: '',
      owner: '',
      createdAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      updatedAt: '',
      deletedAt: '',
      parentId: parent.id,
    })),
  ]
}

/** Built per locale, for the reason in `board`. */
function surfaces(locale) {
  const tasks = withProgress(withSubtasks(board(locale), locale), NOW, TOKYO)
  return { tasks, overall: overallProgress(tasks) }
}

const DELETED = {
  en: [{ id: 'x', title: 'Second-choice venue enquiry', deletedAt: '2026-09-01T00:00:00.000Z' }],
  ja: [{ id: 'x', title: '第二候補の会場に問い合わせ', deletedAt: '2026-09-01T00:00:00.000Z' }],
}

const noop = () => {}

/** The tab bar is fixed, so it belongs to the shell rather than to either tab. */
function Shell({ children, tab, fab = false }) {
  return (
    <div className="app">
      <div className="views">{children}</div>
      {fab ? (
        <span className="fab" aria-hidden="true">
          <PlusIcon style={{ width: '1.5em', height: '1.5em' }} />
        </span>
      ) : null}
      <TabBar tab={tab} onTab={noop} />
    </div>
  )
}

/**
 * `canEdit` reaches the HERO, not just the body. It was hardcoded true here once, so no
 * fixture could render the View only badge — and that badge sharing the hero's last line
 * with a long venue name is exactly what broke the countdown onto two lines on the live
 * site. A harness that cannot show a case cannot protect the fix for it either.
 */
function HomeView({ locale, canEdit = true }) {
  const { overall } = surfaces(locale)
  return (
    <Shell tab={TABS.HOME}>
      <Hero config={CONFIG} nowMs={NOW} canEdit={canEdit} onOpenSettings={noop} photo={PHOTO} />
      <div className="view stack">
        <OverallCard overall={overall} />
        {canEdit ? <DeletedList tasks={DELETED[locale]} onRestore={noop} /> : null}
      </div>
    </Shell>
  )
}

/**
 * The plan, with the one card that has a checklist opened — so the editor's fields, the
 * checklist and the add row are all in the screenshot. `open` comes from `App`'s `expanded`
 * set, which no effect populates, so passing it here is the only way to see it.
 */
function PlanView({ locale, canEdit = true }) {
  const { tasks, overall } = surfaces(locale)
  const opened = tasks.find((task) => task.progress.tally)
  return (
    <Shell tab={TABS.TIMELINE} fab={canEdit}>
      <div className="view view--plan stack">
        <FilterChips
          counts={overall}
          total={overall.total}
          filter={FILTER_ALL}
          onFilter={noop}
        />
        <Timeline
          tasks={tasks}
          nowWall={NOW_WALL}
          canEdit={canEdit}
          categories={CONFIG.categories}
          expanded={new Set(opened ? [opened.id] : [])}
          onExpand={noop}
          onToggle={noop}
          onSave={noop}
          onDelete={noop}
          canAddSubtask
          onAddSubtask={noop}
          onFieldFocus={noop}
        />
      </div>
    </Shell>
  )
}

function EmptyView() {
  return (
    <Shell tab={TABS.TIMELINE} fab>
      <div className="view view--plan stack">
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

function emit(name, element, { locale = 'en', accent = 'rose' } = {}) {
  setLocale(locale)
  const path = `scripts/preview-${name}.html`
  writeFileSync(path, page(renderToStaticMarkup(element), { locale, accent }))
  console.log(path)
}

emit('en-home', <HomeView locale="en" />)
emit('en-home-viewer', <HomeView locale="en" canEdit={false} />)
emit('en', <PlanView locale="en" />)
emit('en-viewer', <PlanView locale="en" canEdit={false} />)
emit('en-empty', <EmptyView />)
emit('ja-home', <HomeView locale="ja" />, { locale: 'ja' })
emit('ja', <PlanView locale="ja" />, { locale: 'ja' })

// One file per accent, so a preset that breaks a contrast pair is visible rather than
// merely measured. Home, because that is where the accent is loudest: the tab bar's
// selected rule and the summary meter's fill.
for (const accent of ACCENTS) {
  if (accent === 'rose') continue
  emit(`en-${accent}`, <HomeView locale="en" />, { accent })
}

setLocale('en')
