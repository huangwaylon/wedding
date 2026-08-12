# CLAUDE.md

Data model, access model and cost are in `README.md`, the Google walkthrough in `SETUP.md`; do not
restate either here. Every file explains its own reasoning in comments — WHY, not what, at the
existing density, never narrating a refactor. This holds what constrains work elsewhere. Vite +
React 19, plain ESM JavaScript, vitest, no runtime dependency but `react`/`react-dom`; the whole
backend is one container-bound Apps Script web app over one spreadsheet, where `doGet` is anonymous
and read-only and `doPost` needs `APP_KEY` in the body.

`npm test` must pass before any commit; also `npm run dev|build|preview`, `npm run contrast` after
any colour change, `npx vite-node scripts/preview.jsx` for the visual harness.

## Invariants

Breaking one does not throw; it puts a misleading number on somebody's screen or the wrong thing in
their spreadsheet.

### The sheet contract

- **`src/schema.js` and `apps-script/Code.gs` both hold the column list and must agree.** The
  boundary is a network hop; `test/schema.test.js` fails the build when they drift, nothing else may
  name a column, and new columns are **appended** so no existing index shifts.
- **`taskToRow` must always send `parent_id`**: `update` rewrites the whole row from the payload, so
  omitting it blanks the cell and silently promotes a subtask to a task.
- **A TASK IS A TITLE, A DAY AND A TICK.** No start, no clock time, no all-day flag, no owner, no
  memo. Adding any of them back is not a feature, it is the elapsed-window progress model coming
  back with it — see **Progress**.
- **Columns are resolved by NAME on the read and by POSITION on the write.** `readTasks` builds its
  index from row 1, which is what lets `doGet` — anonymous, and forbidden from writing — read a
  board still on the previous thirteen-column layout. `relayout()` moves such a board once, on the
  first write, under the lock: values by name, old `end` → `due`, columns past the new width
  cleared. Removing either half breaks a live board silently, in opposite directions.
- **Cells are formatted as text BEFORE values are written**, or `setValues` parses a timestamp into
  a Date and the sheet's locale decides what comes back. `textCell` also escapes a leading `=`, `+`,
  `-` or `@`, which `setValue` treats as a formula whatever the format says. Everything crossing the
  wire is a string, and `readCell` recovers a cell somebody hand-edited into a Date.
- **Deletes are soft, confirmed and reversible**, so rows never move. `compact()` is the only hard
  delete and must `deleteRow` **descending**, or it takes the wrong rows.

### Time

- **`due` is a CALENDAR DAY resolved against the board's `timezone`** — never an instant, never the
  device's zone: a task due on the 18th must stop being due on the 19th *at the venue*. Everything
  goes through `src/lib/time.js`, which never writes `new Date('2027-04-18')` (UTC midnight, so the
  17th west of Greenwich) and builds every Date from explicit parts.
- **THE ZONE IS USED FOR EXACTLY ONE THING: what today's date is** (`todayIn`). Everything downstream
  compares two day strings, so there is no offset sampling, no DST gap solving and no instant cache
  left in the file. Reintroducing any of that means something has started asking a question about a
  moment rather than a date, which the model no longer has an answer for.
- **Overdue is `due < today` on DAY STRINGS.** Never `now >= instantOf(due)`: that is the defect the
  old model needed a 23:59 sentinel to paper over, and it makes every task overdue at 00:01 on the
  morning it is due. `test/progress.test.js` pins both sides of the boundary.
- **`normalizeDay` slices a clock time off, and that is load-bearing rather than lenient.** A board
  written before dates lost their times holds `2027-04-18T23:59` in every row, and `readCell` hands
  back exactly that shape for a cell the Sheets UI coerced to a Date. `draftFrom` normalises on the
  way IN too, or `type=date` renders the value as blank and the first commit clears a date still
  visible on the row.

### Progress

- **AN UNFINISHED TASK IS 0%, WHATEVER THE DATE SAYS.** `percent` is done → 1, else the subtask
  tally, else 0. This is a deliberate correction: the old model drew elapsed time, so a window that
  had merely run out read 100%, and a badge, a mark and an overdue count existed on every screen to
  stop the headline lying. Anything that makes a percentage advance without somebody ticking
  something brings all of that back.
- **`percent` and `duePassed` are different claims over the same denominator and must not be
  merged.** `percent` is work done and is countable; `expected` (the mean of `duePassed`) is the
  share of dates that have passed. The gap between them is drawn as a fill against a mark.
- **THERE IS NO PACE VERDICT, and reintroducing one is a regression.** Two tasks late plus two
  future tasks finished early sum to a pace of exactly zero, so any single figure subtracting the
  two reports "on schedule" with two things late. The graphic declines to claim it and `overdue`
  states the fact on its own. `test/progress.test.js` has that case, and asserts `overallProgress`
  exposes no `pace` at all.
- **Every TOP-LEVEL task counts equally in the roll-up**, never by subtask count — decomposing one
  task more finely must not change what the rest of the board is worth.
- **`SOON_DAYS` is part of the meaning of a state**, not a component's constant: it is what "due
  soon" is, and it is the boundary past which a row prints no urgency at all.
- **A MONTH HEADING CARRIES ITS OWN TALLY, AND EVERY WHOLE-MONTH FIGURE IS WITHHELD WHILE A FILTER
  IS ON.** `Plan` is handed the FILTERED list, so a tally counted over the overdue slice of April
  reads "0/3" about a month that is nine tasks long and mostly done — a misleading number, which is
  the one defect class that matters here. The `Today` line is withheld for the same reason: a list
  with holes cannot claim that everything below a line is still ahead. The tally is `aria-hidden`
  (every row states its own state, and "3 slash 9" inside a heading is worse than silence) and is
  **never coloured**, exactly as a row's tally is not.
- **The `Today` line is a BOUNDARY, so it renders only with rows on both sides of it**, never in the
  undated group, and it lives BETWEEN rows rather than on one — which is what keeps it outside the
  one-coloured-mark-per-row budget.

### Subtasks

- **Nesting is exactly one level and the READ enforces it.** A row is a subtask iff `parent_id`
  names a LIVE row whose own `parent_id` is empty (`partitionSubtasks`) — depth-1 by construction,
  so it cannot recurse or cycle. Anything unplaceable (grandchild, cycle, orphan) is **promoted,
  never hidden**: a silently hidden task is the worst thing this app could do.
- **A PROMOTED row is where "has a `parentId`" and "is a subtask" stop being the same question,
  and only one of them is fixed.** `withProgress` marks such a row `promoted`, and the client
  draws, counts and rolls it up as a task — but `validateTask` and `taskFromDraft` both still
  read the raw `parentId`, so the editor offers it no window (dates written there would be
  neither validated nor stored) and the card withholds the add-subtask field (a child of it
  would be a grandchild, promoted again on the next read). **A promoted row can therefore be
  retitled but not scheduled from the UI; fixing that means teaching the schema layer the
  difference, not widening the component's guard.** It is reachable only by hand-editing
  `parent_id` in the spreadsheet.
- **Precedence is `done_at` > tally > nothing, and nothing is blended** — "3 of 5 = 60%" is
  checkable by counting; `0.5 × elapsed + 0.5 × tally` is not. No live subtasks reads 0%.
- **All subtasks done does NOT make a parent done**, or a task would sit in the done count with an
  empty cell in the sheet and no answer to "when was it finished". Nothing prompts for the tick
  either: a 5/5 parent reads 100% and stays open until a person closes it.
- **A subtask is a title and a tick, no date** — `validateTask` returns early for anything with a
  `parentId`, because a date wheel per item would make entering five unusable on a phone and then no
  parent's progress would advance. No meter, no urgency label, and the whole row is the toggle.
  **The inline editor therefore renders no date field for a subtask and never writes its `due`
  cell** — the early return means a date offered there would be saved unvalidated, and it did once
  save an end before a start. **Deleting a parent cascades in the Apps Script**, one lock and one
  reply; `restore` is its exact inverse.
- **EVERY TASK CARRIES A DAY: `validateTask` returns `MISSING_DUE` without one.** This reverses an
  earlier rule that made the date optional, and it is a product decision — the board is a schedule,
  so a task with no place in it is not something this app stores.
- **REQUIRED IS NOT DEFAULTED, and the difference is the whole of the old reasoning.** The create
  sheet still opens with the date BLANK and Save refuses until somebody picks one; nothing anywhere
  defaults it to today. An invented date lands straight in the overdue count and in the on-schedule
  mark, so everything typed in a hurry would read overdue tomorrow — a false figure nobody typed.
  Refusing asks the question; defaulting answers it wrongly and says nothing.
- **`STATE.NODATE` MUST KEEP WORKING, and it is no longer reachable from the UI.** A board can
  already hold undated rows and somebody can empty the cell in the spreadsheet at any time. Such a
  row still sorts last into its own group and contributes to neither numerator — a row the client
  refuses to SAVE must still be shown, because hiding one is the worst thing this app can do. The
  consequence to know: a legacy undated task cannot be renamed until it is given a date, since the
  whole task goes in one write and that write is validated.
- **A subtask is exempt.** It is a title and a tick; `validateTask` still returns early for anything
  with a `parentId`, so requiring a date on a task does not reach a checklist item.

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
  read of the grid through `openTasks`, which folds in the layout repair; the reply then reads it
  again, deliberately, since that read-back is what the client is shown. `stampDeleted` writes two
  whole columns so a cascade costs what one row does, and the LOCK is what makes rewriting untouched
  cells safe — the values came from a read taken inside it. **Ask by NAME, not by counting rows**:
  `ensureStructure` returns on two `getSheetByName` lookups rather than spending a `getSheets()` on
  every write, and `readConfig`/`setConfig` use `getDataRange` instead of `getLastRow` plus a sized
  read. An update is four calls on the tasks grid; `scripts/stub-endpoint.mjs` prints the count.
- **Every read reports `schema: TASK_COLUMNS`, and the client compares the WHOLE list** —
  `missingColumnsFor` in `useBoard`, which every write that touches a row goes through. `null`
  means "nothing read yet" and never flags; `[]` is a script that sends no schema at all.
  **Checking only the LAST column is the bug that shipped**: it is sound while the list only
  grows, and `due` replacing `end` left an un-redeployed script holding every other column
  including the last, so every write was allowed and dropped its date. `rowToTask` falls back to
  `end` so such a board still READS — without it the whole plan looked undated — and nothing
  writes `end`. `scripts/stub-endpoint.mjs --legacy` reproduces the whole failure.

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
- **ONE WRITE PER EDIT SESSION, and the whole task goes in it.** `TaskDetail` buffers a draft while
  Edit is on and writes once, on Done or on the row closing; per-field commits on blur cost a ~3s
  round trip *each*. `update` rewrites the row from its payload, so a partial one blanks a cell —
  `parent_id` above all — and nothing is sent when the ROW each would write is unchanged.
- **`done` MUST DISARM THE UNMOUNT FLUSH, AND SO MUST THE DELETE.** A new date re-sorts the plan, so
  the row moves to another month `<section>` and React deletes the subtree rather than moving it —
  running a cleanup whose closure still held the pre-save task and the whole draft, which sent the
  identical write twice. The delete is the worse half of the same shape: it is optimistic, so the row
  stops being live and unmounts, and a flush resolved against the PRE-delete task carries an empty
  `deleted_at` into a write that rewrites the whole row — resurrecting the task ~3s later, wearing
  the edit that preceded the delete and missing the subtasks the cascade had already tombstoned.
  Nulling the ref is not enough on its own: it is reassigned every render, so the delete ENDS the
  session. `scripts/drive.mjs` counts the POSTs and prints the defect when the guard is removed.
- **An open edit SESSION is the evidence that unsaved text exists**, and it reports up to `App` as
  `typing` for the whole of itself — a per-field focus report drops that guard on every blur
  between two fields, which is exactly when the buffer is full and nothing has been sent. It holds
  off a service-worker reload and moves the fixed FAB out of the way. The add-a-subtask field
  still reports per-field, because it is outside any session — which is why **`typing` is a COUNT,
  never a flag**: with one boolean and two producers, blur was the last writer, so touching the
  subtask field inside an open session and tapping away released the guard with the buffer full.
- **TICKING SOMETHING OFF UNDER A FILTER MUST NOT MAKE IT VANISH.** Ticking raises no toast by
  design, so a row that also leaves the list gives no feedback at all for the app's most frequent
  gesture. `App` holds the ids ticked since the filter was chosen and keeps those rows in `shown`;
  the confirmation is the row changing in place while the chip's count drops. Session state, never
  `localStorage`, for the same reason `expanded` is.
- **A control that cannot work is withheld, not left to fail.** Against an out-of-date deployment
  every row write is refused, so the FAB goes with the add-a-subtask field — otherwise the sheet
  takes a title, a date and a category and throws the lot away. The tick and the Edit toggle
  deliberately stay: withholding those too leaves an editor looking at a view-only board with no
  explanation attached to the controls that went missing.
- **Every failed write says so.** `saveConfig`, `compact` and the template seed each had no failure
  branch, and Settings is the one surface that WAITS for its write — it returned to "Save" and said
  nothing for ~3s. `toast.failed` must also stand alone: it may not point at a notice, because only
  TERMINAL codes get one and `busy`/`transient` are deliberately excluded from that set.
- **Which rows are open is session state, never `localStorage`** — relaunching into twelve expanded
  rows is a board nobody can read.
- **ONE SCREEN, ONE SCROLLER, NO TAB BAR.** The photograph is the header. A two-tab bar cost 56px
  plus its safe-area inset of permanent chrome to hold one card and a photograph, and it forced the
  standing notices onto both tabs — the out-of-date-script warning is the reason a control is
  missing from a row on the *other* one.
- **`withProgress` is memoised on TODAY, not on `now`.** The board is day-granular, so nothing it
  computes can change between midnights; keying it on the clock reallocated every task object sixty
  times an hour. The clock still ticks, for the hero's countdown.
- **AN OPEN ROW STARTS READ-ONLY, and `TaskDetail` owns that mode.** Tapping a row is the
  hundred-times-a-week gesture; the editor commits on blur, so live fields behind that tap put a
  caret in a title one stray blur away from renaming a task. The Edit toggle also gates every
  DESTRUCTIVE control — the task's delete and the per-item trash icons — while ticking and adding a
  subtask stay on the read path. **The mode lives in `TaskDetail` precisely because that component
  unmounts when the row closes**, which is what resets it with no effect to synchronise; `editing`
  is a prop for the same reason `expanded` is, so a static render and the harness can see the
  fields at all.
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
  only title/body/action block, `DueLabel` the only place a date's nearness is worded, and
  `TaskFields` the only task field markup — the inline editor and
  the create sheet render the same controls through it, differing by a `skin` prop and by when they
  commit. **Export only what something outside the file uses.**
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

### CSS

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. Single classes,
no IDs, no `!important`. Light theme only, mobile first, and **exactly ONE breakpoint** (48rem) —
`test/ui.test.jsx` pins that as an exact set across every sheet, so prefer a `clamp()`, a container
query or `auto-fit` to a second one. The layout is one centred column at every width, capped at
`--column-max`: a planner's large monitor gets a bigger photograph and more air, not a second
column. Use the tokens: `var(--transition-fast|base)` collapse to ~0ms under
`prefers-reduced-motion`, so a hardcoded duration opts out of that silently. Meters are hand-rolled
— flex plus percentages, no library. Every rule carries its constraint as a comment and
`test/ui.test.jsx` pins the load-bearing ones: state colour is one table and never the only channel,
the meter's hairline is `--track-line`, its mark is ink with a surface ring, a row is a `<button>` so
its children are spans, and `input[type=date]` has its platform appearance off. What reaches beyond
CSS:

- **Japanese is a first-class language here.** `letter-spacing: 0`, no `text-transform`, and no
  `line-height` below 1.5 wherever text can be Japanese — which is everywhere but the hero
  percentage, including the couple's names. A month abbreviation is uppercased in `formatDayChip`
  with `toLocaleUpperCase`, never in CSS, because `text-transform` is a no-op on kana and would apply
  to the Latin half alone. **A row's day does NOT go through `Intl`**: `{ day: 'numeric' }` in `ja`
  returns `18日`, which wraps inside the 2rem column. Nothing below 13px; weights `400|500|600`.
- **`--ink-3` MUST NOT SIT ON AN ACCENT WASH.** Measured: 4.47:1 under `plum`, which fails AA, and
  4.56–4.64:1 on the other four, which is no margin. The wedding month's plaque is the only rule
  consuming `--accent-wash`, and its label and tally are both `--ink-2` (6.71:1 at worst).
  `scripts/check-contrast.js` covers all five washes; kanji at low contrast is unreadable in a way
  Latin is not.
- **The DEFAULT accent is `indigo`, and the default is a legibility decision.** The accent also
  paints `.dot--soon`, one of three 8px discs that carry a row's whole state, so the default has to
  be separable from `--good` and `--critical` at that size — a green default is two mid-dark greens
  of the same hue family. `make-icons.js` hardcodes the same hex for the Home Screen icon and must
  be re-run (`npm run icons`) when it changes.
- **COLOUR FOLLOWS STATE; THE CATEGORY CHANNEL IS SHAPE.** Fourteen category hues would make one
  row's mark carry two claims, so a category gets a monochrome glyph in `CATEGORY_ICONS` instead —
  **leading the word, never replacing it** (fourteen shapes is more vocabulary than anyone learns
  cold, and an English and a Japanese reader do not learn the same ones). An unknown category
  renders as typed with **no glyph at all**: a fallback would put a claim on it nobody made.
- **The app's mark is two peaks, and a ginkgo leaf is not available.** It was drawn and tested
  first — the hero is an 銀杏並木 — and at a 1.75 stroke in a 24 box every notched fan reads as a
  HEART, which is the cliché the mark exists to avoid; dropping the notch leaves a lollipop. Eight
  variants were rendered at 16/20/32/56px. `PeaksIcon` and `make-icons.js` draw the same mark and
  must not drift.
- **An unsettled row dims its HEAD, never its tick.** `opacity` on the whole card faded the
  confirmation of the highest-frequency gesture in the app for the ~3s the write was in flight,
  which reads as un-pressed. Same for a checklist item: the title recedes, the glyph does not.
- **Never a form control below 16px** (mobile Safari zooms on focus and will not zoom back), and
  **`--tap-target` (44px), not `--tap-target-sm`, for anything a thumb aims at.**
  **`role="progressbar"`, never `role="meter"`**: ARIA reserves `meter` for a gauge rather than a
  value advancing toward completion, and VoiceOver maps it patchily enough to lose the label and the
  value with it. **`interactive-widget=resizes-content` is load-bearing** with a sticky
  `.sheet__foot`, or Save sits under the keyboard.
- **The hero's scrim IS the contrast mechanism**, not decoration. Its ink cannot be measured against
  a token because its backdrop is a photograph, so it is measured against the worst case the scrim
  allows — the dense end composited over a blown-out white sky. `scripts/check-contrast.js` computes
  it; lightening `--photo-scrim`'s end stop takes white type from 9.08:1 to 4.07:1 and fails.
- **The card accordion is NOT animated.** `height` and `max-height` are layout properties, a mount
  is not a transition, and `max-height` slips past the "never transition width/height" test while
  being exactly the thrash that test forbids. The chevron carries the motion.
- **`.input[type="date"]` MUST turn the platform appearance off, both spellings, prefixed first.**
  With it on, Safari sizes the control from its own shadow tree and that intrinsic width is a FLOOR
  — `width: 100%` is a ceiling it ignores, so the control drew past the right edge of a 252px row on
  a 320pt phone. Nothing clips it either: `.tcard` has to stay `overflow: visible` or the focus ring
  is cut. The two shadow selectors beside it put back the metrics that turning it off removes, and
  narrowing the type is not an option — 16px is the no-zoom floor and is *why* the control is wide.
- **The month heading is `position: sticky` with an OPAQUE background**, and that background is
  load-bearing rather than decoration: rows scroll under it. It replaced a vertical spine through a
  node on every row, which cost 24px of the left edge to imply what the heading now states — and it
  is what lets a row print a bare day number instead of restating the month forty times. It sticks
  inside `.plan__group`, which is a flex column, so the next month's heading pushes it out. The rule
  beneath it is `--line` and **never a shadow**, and the wedding month's tint bleeds outward on a
  negative margin so every month name stays in ONE column — padding alone pushed the one month that
  matters 8px right of all the others.
- **The FAB is the only fixed chrome**, and `.views` reserves `--fab-size` below its content, once,
  so it can never cover the last row. There is no tab bar to compose around any more.
- **A subtask is never drawn in the sequence of dates**: no date means no position. It is a row in
  its parent's checklist, and what reaches the parent is a `3/5` tally, never coloured — `5/5` in
  `--good` would claim a `done_at` the sheet does not have. **Colour follows STATE, not category**, or
  one mark carries two palettes, and **no `-webkit-overflow-scrolling: touch` anywhere**: a no-op
  since iOS 13 that broke `position: sticky` inside the same scroller — which the month heading now
  depends on.
- **THERE IS ONE COLOURED MARK PER ROW and the day column is not it.** The hue lives on the dot
  beside `DueLabel`'s words; a day column a third of whose entries are red stops being a column, and
  a state colour on type is the thing the whole state table exists to avoid.

## Testing

`ui.test.jsx` reads the stylesheets as TEXT, so its helpers strip comments, anchor whole selectors and
brace-count media blocks — each of those mistakes makes a test that always passes. `script.test.js`
EXECUTES `Code.gs` against a fake Sheets service, because the write path is exactly the kind that
answers `ok: true` while writing the wrong cell.
- **A static render never runs an effect and never fires a blur**, so switching tabs, opening a card
  and every commit-on-blur path are invisible to `render.test.jsx` and to the harness. Every default
  must be correct alone — which is why `expanded` is a prop the harness can set — and the tab switch,
  the accordion, each commit path, the validation refusals and the keyboard's effect on a sheet were
  each verified by driving the built app in a real browser.
- **When fixing a bug, add the regression test** — for progress arithmetic, the misleading case: all
  overdue and nothing done must report 100% *and* say it is behind.
- **A passing suite does not mean it looks right.** Screenshot through `scripts/harness.html`'s
  iframes rather than a resized window — an iframe gets an honest viewport, while headless Chrome
  reports a different width and every breakpoint reads wrong; that file documents its own options.
- **`scripts/drive.mjs` covers what no static render can**, over CDP: the accordion, the read/edit
  toggle, commit-on-blur, whether the date control stays inside its row, that ticking under a filter
  keeps the row on screen, and that deleting a just-edited task sends one `delete` and no
  resurrecting `update`. Its header records the two ways it silently verified NOTHING — headless
  Chrome fires no focus event unless `Emulation.setFocusEmulationEnabled` is on, and a leftover
  Chrome on the debugging port makes a second run report the first one's board — plus a third: the
  fixture replies with the pre-write board in milliseconds, so **no optimistic state survives long
  enough to be measured** and anything about it must be pinned elsewhere. Its board fixture is
  `public/__dev-board.json`, gitignored under that name because the service worker precaches
  whatever reaches `dist/`, and its `config` is keyed the way the SHEET is (`wedding_date`), not the
  way the client's config object is.
- **`to=` in `scripts/harness.html` does not survive a headless capture**, so a surface that only
  appears mid-scroll needs a preview PAGE of its own — `en-sign` is that, for the month tally, the
  wedding plaque and the `Today` line. A case the harness cannot show is a case nothing protects.

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
- **The hero is a derived crop and the camera original is gitignored.** `public/hero.jpg` is
  1280x1600 at ~290KB; regenerate it from a new photo with two `sips` passes, not one — combining
  `-c` with `--resampleHeightWidth` silently produces the wrong dimensions:

  ```sh
  sips -c 4190 3352 --cropOffset 427 111 IMG_0509.JPG --out /tmp/hero-crop.jpg
  sips --resampleHeightWidth 1600 1280 --setProperty formatOptions 20 /tmp/hero-crop.jpg \
    --out public/hero.jpg
  ```

  `--cropOffset` is measured from the top-left when non-zero but means "centred" at `0 0`, and an
  offset whose rect ends exactly on the image edge silently produces no crop at all. The faces must
  land at 40-45% of the frame's height, because `object-position: 50% 42%` is what keeps them in the
  band at every viewport. Bump nothing else — the service worker precaches whatever is in `dist/`.
