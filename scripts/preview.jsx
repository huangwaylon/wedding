/**
 * The visual harness. A passing test suite says nothing about whether the board looks
 * right — the sibling app shipped an invisible white-on-white chart with everything
 * green — so this renders the real surfaces to static HTML with the real stylesheets:
 *
 *   npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
 *
 * Then load those in <iframe>s at 390 / 430 / 768 / 1440 and screenshot.
 *
 * USE IFRAMES, NOT A RESIZED WINDOW. An iframe gets its own viewport, so container and
 * media queries resolve honestly; headless Chrome quietly reports a different width than
 * you asked for and every breakpoint reads wrong.
 */

import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { mergeConfig } from '../src/config.js'
import { overallProgress, withProgress } from '../src/lib/progress.js'
import { wallToInstant } from '../src/lib/time.js'
import { ACCENTS } from '../src/lib/theme.js'
import { setLocale } from '../src/i18n/index.js'
import { findTemplate, materialize } from '../src/lib/templates.js'
import Controls, { FILTER_ALL, VIEWS } from '../src/components/Controls.jsx'
import { DeletedList } from '../src/components/Deleted.jsx'
import EmptyBoard from '../src/components/EmptyBoard.jsx'
import Header from '../src/components/Header.jsx'
import OverallCard from '../src/components/OverallCard.jsx'
import TaskList from '../src/components/TaskList.jsx'
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
  venue: 'Meguro Gajoen',
  timezone: TOKYO,
})

let counter = 0

/**
 * The real twelve-month template, with a plausible spread of progress applied: the early
 * items done, several left to run out, one deliberately dateless. Hand-written fixtures
 * would not exercise the month grouping or the timeline's span.
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
    // The first nine are finished; #10 onwards are left to go overdue, which is what puts
    // an honest gap between the headline figure and the on-schedule mark.
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

/** Built per locale, for the reason in `board`. */
function surfaces(locale) {
  const tasks = withProgress(board(locale), NOW, TOKYO)
  return { tasks, overall: overallProgress(tasks) }
}

const DELETED = {
  en: [{ id: 'x', title: 'Second-choice venue enquiry', deletedAt: '2026-09-01T00:00:00.000Z' }],
  ja: [{ id: 'x', title: '第二候補の会場に問い合わせ', deletedAt: '2026-09-01T00:00:00.000Z' }],
}

const noop = () => {}

function Shell({ children, wide = false }) {
  return (
    <div className="app">
      <Header config={CONFIG} nowMs={NOW} canEdit onOpenSettings={noop} />
      <main className={`shell${wide ? ' shell--wide' : ''}`}>{children}</main>
      {/* Not in timeline view, matching App: the FAB sits over the bottom-right of the chart. */}
      {wide ? null : (
        <span className="fab" aria-hidden="true">
          <PlusIcon style={{ width: '1.5em', height: '1.5em' }} />
        </span>
      )}
    </div>
  )
}

function ListView({ locale, canEdit = true }) {
  const { tasks, overall } = surfaces(locale)
  return (
    <Shell>
      <div className="shell__aside stack">
        <OverallCard overall={overall} />
        {canEdit ? <DeletedList tasks={DELETED[locale]} onRestore={noop} /> : null}
      </div>
      <div className="shell__main stack">
        <Controls
          counts={overall}
          total={overall.total}
          filter={FILTER_ALL}
          onFilter={noop}
          view={VIEWS.LIST}
          onView={noop}
        />
        <TaskList
          tasks={tasks}
          nowWall={NOW_WALL}
          canEdit={canEdit}
          onToggle={noop}
          onEdit={noop}
          onDelete={noop}
        />
      </div>
    </Shell>
  )
}

function TimelineView({ locale }) {
  const { tasks, overall } = surfaces(locale)
  return (
    <Shell wide>
      <div className="shell__aside stack">
        <OverallCard overall={overall} compact />
      </div>
      <div className="shell__main stack">
        <Controls
          counts={overall}
          total={overall.total}
          filter={FILTER_ALL}
          onFilter={noop}
          view={VIEWS.TIMELINE}
          onView={noop}
        />
        <Timeline tasks={tasks} nowMs={NOW} timeZone={TOKYO} />
      </div>
    </Shell>
  )
}

function EmptyView() {
  return (
    <Shell>
      <div className="shell__aside stack">
        <OverallCard overall={overallProgress([])} />
      </div>
      <div className="shell__main stack">
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

emit('en', <ListView locale="en" />)
emit('en-viewer', <ListView locale="en" canEdit={false} />)
emit('en-timeline', <TimelineView locale="en" />)
emit('en-empty', <EmptyView />)
emit('ja', <ListView locale="ja" />, { locale: 'ja' })
emit('ja-timeline', <TimelineView locale="ja" />, { locale: 'ja' })

// One file per accent, so a preset that breaks a contrast pair is visible rather than
// merely measured.
for (const accent of ACCENTS) {
  if (accent === 'rose') continue
  emit(`en-${accent}`, <ListView locale="en" />, { accent })
}

setLocale('en')
