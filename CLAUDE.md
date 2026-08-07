# CLAUDE.md

Data model, access model and cost are in `README.md`, the Google walkthrough in `SETUP.md`; do not
restate either here. Every file explains its own reasoning in comments — WHY, not what, at the
existing density, never narrating a refactor. This holds what constrains work elsewhere. Vite +
React 19, plain ESM JavaScript, vitest, no runtime dependency but `react`/`react-dom`; the whole
backend is one container-bound Apps Script web app over one spreadsheet, where `doGet` is anonymous
and read-only and `doPost` needs `APP_KEY` in the body.

`npm test` must pass before any commit; also `npm run dev|build|preview`,
`node scripts/check-contrast.js` after any colour change, `npx vite-node scripts/preview.jsx` for the
visual harness.

## Invariants

Breaking one does not throw; it puts a misleading number on somebody's screen or the wrong thing in
their spreadsheet.

### The sheet contract

- **`src/schema.js` and `apps-script/Code.gs` both hold the column list and must agree.** The
  boundary is a network hop; `test/schema.test.js` fails the build when they drift, nothing else may
  name a column, and new columns are **appended** so no existing index shifts.
- **`taskToRow` must always send `parent_id`**: `update` rewrites the whole row from the payload, so
  omitting it blanks the cell and silently promotes a subtask to a task.
- **Cells are formatted as text BEFORE values are written**, or `setValues` parses a timestamp into
  a Date and the sheet's locale decides what comes back. `textCell` also escapes a leading `=`, `+`,
  `-` or `@`, which `setValue` treats as a formula whatever the format says. Everything crossing the
  wire is a string, and `readCell` recovers a cell somebody hand-edited into a Date.
- **Deletes are soft, confirmed and reversible**, so rows never move. `compact()` is the only hard
  delete and must `deleteRow` **descending**, or it takes the wrong rows.

### Time

- **`start` and `end` are WALL-CLOCK strings resolved against the board's `timezone`** — never
  instants, never the device's zone: "the ceremony is at 14:00" must read 14:00 to a planner abroad.
  Every conversion goes through `src/lib/time.js`, which never writes `new Date('2027-04-18')` (UTC
  midnight, so the 17th west of Greenwich), samples a DST offset twice and round-trips the answer, and
  ends an all-day window at 23:59 so a task due Friday is overdue on Saturday morning.

### Progress

- **`percent` and `timePercent` are different claims and must not be merged.** `percent` is what to
  draw (done → 100, else the tally, else elapsed); `timePercent` is always the clock and rolled up
  it is the on-schedule reference. An expired unfinished window has `percent` of 1 while emphatically
  incomplete — hence the counts beside it.
- **`paceLabel` takes the overdue count AND the signed pace, overdue first**: without subtasks `pace`
  cannot go negative, since an expired window counts 1 in both sums and cancels.
- **Every TOP-LEVEL task counts equally in the roll-up**, never by duration or subtask count —
  decomposing one task more finely must not change what the rest of the board is worth.

### Subtasks

- **Nesting is exactly one level and the READ enforces it.** A row is a subtask iff `parent_id`
  names a LIVE row whose own `parent_id` is empty (`partitionSubtasks`) — depth-1 by construction,
  so it cannot recurse or cycle. Anything unplaceable (grandchild, cycle, orphan) is **promoted,
  never hidden**: a silently hidden task is the worst thing this app could do.
- **Precedence is `done_at` > tally > clock, and nothing is blended** — "3 of 5 = 60%" is checkable
  by counting; `0.5 × elapsed + 0.5 × tally` is not. No live subtasks falls back to the clock.
- **All subtasks done does NOT make a parent done**, or a task would sit in the done count with an
  empty cell in the sheet and no answer to "when was it finished". Nothing prompts for the tick
  either: a 5/5 parent reads 100% and stays open until a person closes it.
- **A subtask is a title and a tick, no dates** — `validateTask` returns early for anything with a
  `parentId`, because two date wheels per item would make entering five unusable on a phone and then
  no parent's progress would advance. No meter, no badge, and the whole row is the toggle. **Deleting
  a parent cascades in the Apps Script**, one lock and one reply; `restore` is its exact inverse.

### The endpoint

`Code.gs` and `api.js` state the two biggest rules in capitals in their own headers: **neither handler
may throw** (Google's HTML page reads as transient, so a throw on the reject path is a silent retry
loop) and **the reply is always HTTP 200**, so the BODY is the only signal. `api.js`'s `TERMINAL`
set decides retryability — only `busy` and `transient` may be retried. Never read `e.parameter` for
the key; a query string reaches Google's logs.

- **`doGet` never writes** — it is anonymous, so an anonymous request must not cause one. An unbuilt
  spreadsheet answers `needsSetup` (WITH its `schema`, or a brand-new board warns about itself), and
  an editor's first write builds the tabs. **Every mutation holds a script lock**, or two simultaneous
  appends resolve the same next row, and **no cached row number is ever trusted**. The read carries a
  cache-buster in its query string; the edit key never can, and rides in the POST body.
- **The POST is `text/plain`, and its method is never forced through the 302 that `/exec` returns**;
  `api.js` explains why, and why there is no `doOptions`.
- **A Sheets service call is the unit of cost; arithmetic between them is free.** Each op takes ONE
  read of the grid through `openTasks`, which folds in the header self-heal; the reply then reads it
  again, deliberately, since that read-back is what the client is shown. `stampDeleted` writes two
  whole columns so a cascade costs what one row does, and the LOCK is what makes rewriting untouched
  cells safe — the values came from a read taken inside it.
- **Every read reports `schema: TASK_COLUMNS`, and ABSENCE is the out-of-date signal.** An older
  script sends none, so `[]` means "cannot store the newest column" and `null` means "nothing read
  yet". `addSubtask` and a SUBTASK `editTask` then refuse outright and the add field is withheld,
  rather than let the old script answer `ok` and drop the column. A top-level write is unaffected.

### Client state

- **Every mutation goes through `run()` in `useBoard` and there is exactly one of it**, pinned by
  `test/board.test.js`. **Writes serialise on a chain and only the LAST write in flight may replace
  the board**: every reply carries the whole board as of that write, so an earlier one describes a
  sheet without the later edits and accepting it wipes them off screen. `refresh` is skipped while a
  write is pending — the same clobber from the other direction.
- **The task sheets close before the write lands, and a failure has a toast of its own.** A round trip
  is ~3s and those mutations are optimistic, so waiting buys nothing — but with the panel gone, a
  rolled-back row is invisible unless said out loud. Settings still waits: `saveConfig` has no
  optimistic half, so closing early would show a stale zone and countdown for three seconds.
- **A rejected key is FLAGGED, not deleted**, or the device drops to view-only in silence. And
  **`canEdit` decides what renders; it is not the security boundary** — the endpoint refuses every
  keyless write, so never add a client check as enforcement or drop the server one.
- **Refreshes on focus are throttled** (30s floor); every read spends the owner's quota. **The hash
  is stripped only when standalone**, so *Add to Home Screen* records a URL still carrying the key,
  and `manifest.webmanifest` omits `start_url` for the same reason.
- **The snapshot's version is a DROP marker, never a migration**, and the service worker never
  touches a cross-origin request.
- **Nothing written to the sheet is localized** bar one exception, a seeded template's titles, which
  are content from then on. Locale, accent and filter are per-device; the rest is per-sheet.
- **`sheets.googleapis.com` must not appear in the CSP** — the browser never holds a Google token,
  which is why a view-only visitor needs no credential. **There is no migration code.**

## Conventions

- **One helper, one home.** `readStored`/`writeStored` are the only `localStorage` touches;
  `schema.js` owns column names, `templates.js` owns `CATEGORIES`, `time.js` is the only file that
  resolves a zone, `run()` the only mutation wrapper, `DoneToggle` the only done control, `Notice` the
  only title/body/action block. **Export only what something outside the file uses.**
- **No new npm dependencies** without a clear reason — one is also a CSP decision, and
  `test/lockfile.test.js` pins the list. **Add a host, update the CSP** in `index.html`, and never
  put a real secret in a `VITE_` variable: Vite inlines them into the shipped bundle.

### i18n

English and Japanese, no dependency; `src/i18n/` holds the engine, two catalogs and the registry. It
is a module singleton rather than a context, because render tests mount components bare and non-React
modules need the same `t`.

- **Never hardcode a user-facing string in a component**, including every `aria-label`, `title` and
  `placeholder`. `test/i18n.test.js` fails on an unused key, a missing key and a bare literal in one
  of those attributes; a key built at runtime needs its own coverage test.
- **Plurals go through `Intl.PluralRules`**, never a `count === 1` ternary; `ja` has `other` alone.
  **The pure layers stay pure**: `time.js`, `progress.js`, `schema.js` and `templates.js` never read
  the singleton, and a test that calls `setLocale` must restore it. **An unknown category renders
  exactly as typed** — the sheet is the source of truth, the catalog a courtesy on top.

### CSS and charts

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. Single classes,
no IDs, no `!important`. Light theme only, mobile first, and **exactly two breakpoints** (48rem,
62rem) — `test/ui.test.jsx` pins that across every sheet, so prefer a `clamp()` or a query. Use
the tokens: `var(--transition-fast|base)` collapse to ~0ms under `prefers-reduced-motion`, so a
hardcoded duration opts out of that silently. Meter and Gantt are hand-rolled — flex plus
percentages, no library. Every rule carries its constraint as a comment and `test/ui.test.jsx` pins
the load-bearing ones: state colour is one table and never the only channel, the meter's hairline is
`--track-line`, its mark is ink with a surface ring, a row is a `<button>` so its children are spans.
What reaches beyond CSS:

- **Japanese is a first-class language here.** `letter-spacing: 0`, no `text-transform`, and no
  `line-height` below 1.5 wherever text can be Japanese. Nothing below 13px; weights `400|500|600`.
- **Never a form control below 16px** (mobile Safari zooms on focus and will not zoom back), and
  **`--tap-target` (44px), not `--tap-target-sm`, for anything a thumb aims at.**
  **`role="progressbar"`, never `role="meter"`**: ARIA reserves `meter` for a gauge rather than a
  value advancing toward completion, and VoiceOver maps it patchily enough to lose the label and the
  value with it. **`interactive-widget=resizes-content` is load-bearing** with a sticky
  `.sheet__foot`, or Save sits under the keyboard.
- **The timeline's rows and axis are FLEX, not grid**, because the sticky gutter must travel and a
  grid item's containing block is its own grid area. Rows are `align-items: stretch` so the opaque
  label covers the full row height, and the height cap is NOT width-gated — without it nothing
  scrolls inside the chart and the axis never sticks.
- **A subtask is never drawn as a bar**: no dates means no position and no extent. It gets a 1px rail
  spanning the parent's window, and the parent a `3/5` tally, never coloured — `5/5` in `--good`
  would claim a `done_at` the sheet does not have. **Colour follows STATE, not category**, or one mark
  carries two palettes, and **no `-webkit-overflow-scrolling: touch` anywhere**: a no-op since iOS 13
  that broke `position: sticky` inside the same scroller.

## Testing

`ui.test.jsx` reads the stylesheets as TEXT, so its helpers strip comments, anchor whole selectors and
brace-count media blocks — each of those mistakes makes a test that always passes. `script.test.js`
EXECUTES `Code.gs` against a fake Sheets service, because the write path is exactly the kind that
answers `ok: true` while writing the wrong cell.
- **A static render never runs an effect**, so the measured plot width, the scroll position and an
  opened outline are invisible to `render.test.jsx` and to the harness. Every default must be correct
  alone, and zoom, panning, the detail sheet and the outline were each verified by driving the built
  app in a real browser.
- **When fixing a bug, add the regression test** — for progress arithmetic, the misleading case: all
  overdue and nothing done must report 100% *and* say it is behind.
- **A passing suite does not mean it looks right.** Screenshot through `scripts/harness.html`'s
  iframes rather than a resized window — an iframe gets an honest viewport, while headless Chrome
  reports a different width and every breakpoint reads wrong; that file documents its own options.

## Gotchas

- **Never run a bare `npm install`.** `NPM_CONFIG_REGISTRY` here points at an internal mirror and npm
  bakes that host into every `resolved` URL — fine locally, `ENOTFOUND` everywhere else, reported
  only as "Exit handler never called!", and a repo `.npmrc` cannot outrank an env var. Use
  `npm install --registry=https://registry.npmjs.org`; `test/lockfile.test.js` verifies.
- **A deployment is pinned to a version.** Editing `Code.gs` changes nothing on the live board until
  **Deploy → Manage deployments → New version**; the app detects this and refuses unsafe writes.
- **The script must stay container-bound.** `spreadsheets.currentonly` only works for a script
  created from the sheet via *Extensions › Apps Script*; from `script.new`, `getActive()` returns
  null and everything answers `misconfigured`.
- **`vite.config.js` defaults `base` to `/wedding/`** because project Pages sites serve from
  `/<repo>/`, and sets `test.env.VITE_SCRIPT_URL`, which `config.js` captures at module load.
- **The board is world-readable and that is the design.** Do not put anything private in it.
