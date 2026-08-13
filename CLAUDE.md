# CLAUDE.md

`README.md` explains this app to a person. This file states the rules that explanation implies, names
the symbol that enforces each one and the test that pins it, and explains nothing twice. Every source
file carries its own reasoning in comments — WHY, not what, at the existing density, in the present
tense, never narrating a past version.

Vite + React 19, plain ESM JavaScript, vitest, no runtime dependency but `react`/`react-dom`.

**TWO BACKENDS, AND WHICH ONE IS USED DEPENDS ONLY ON WHETHER THE DEVICE HOLDS AN EDIT KEY.** A
container-bound Apps Script web app over one spreadsheet serves the anonymous read (`doGet`, no
credential — that is the feature) and mints a Google access token for anyone presenting `APP_KEY`
in a POST body (`doPost`). An editor mints once an hour and then does every read and write against
`sheets.googleapis.com` directly. Measured: `/exec` costs 1.0–1.6s before the script runs a line —
the 302 hop plus a container start — and the Sheets API costs ~0.24s. `api.js` is the dispatcher,
`connection.js` the token cache, `sheets.js` the REST client.

`npm test` must pass before any commit; also `npm run dev|build|preview`, `npm run contrast` after
any colour change, `npx vite-node scripts/preview.jsx` for the visual harness.

## Invariants

Breaking one does not throw. It puts a misleading number on somebody's screen, or the wrong thing in
their spreadsheet.

### The sheet contract

- **`src/schema.js` and `apps-script/Code.gs` both hold the column list and must agree.** The boundary
  is a network hop, so neither can import the other; `test/schema.test.js` parses the `.gs` file and
  fails the build on drift. Nothing else anywhere may name a column.
- **APPEND only.** Appending is the only change that shifts no existing index. A rename leaves a stale
  deployment holding every other column, including the last.
- **`taskToRow` must always send `parent_id`.** `update` rewrites the whole row from the payload, so
  omitting it blanks the cell and silently promotes a subtask to a task.
- **A TASK IS A TITLE, A DAY AND A TICK.** No start, no clock time, no all-day flag, no owner, no
  memo. Each one costs a control on a 393px screen and a column somebody has to understand in the
  spreadsheet, and a percentage that advances without a tick — see **Progress**.
- **Columns are resolved by NAME on the read and by POSITION on the write, on BOTH sides of the
  wire.** `tasksFrom` exists twice — in `Code.gs` for the anonymous read and in `sheets.js` for the
  editor's — because a planner and an editor must see the same board even when somebody has moved a
  column in the Sheets UI and no editor has written since. `relayout()` in `sheets.js` is the repair:
  on the next write it moves values by name and rewrites the header to `TASK_COLUMNS`. It does NOT
  clear anything past column I and must not start: every range is derived from `TASK_COLUMNS`, so a
  stray column is invisible and cannot shift an index — and wiping it would delete the column a newer
  deployment appends.
- **Every write is `valueInputOption: RAW`, and `schema.js` owns every range.** RAW stores what it is
  given, which is what retired `Code.gs`'s apostrophe escape — `setValues` parsed a leading `=`, `+`,
  `-` or `@` as a formula whatever the number format said, and RAW does not. `ensureStructure` still
  sets the `@` format once per column so the Sheets *UI* cannot coerce a hand-typed date, and
  `readCell` still recovers one that was. Nothing outside `schema.js` may spell a range: a hardcoded
  `tasks!A2:I` is a second place that knows the width and goes stale on the next append.
- **The CLIENT stamps `created_at` and `updated_at` now**, so a device with a wrong clock can
  backdate a row. That guarantee was given up deliberately for a write that costs one hop instead of
  two; neither timestamp is load-bearing for anything the app computes. `created_at` is still read
  off the existing ROW rather than from the payload, so a replayed create cannot restamp it.
  `taskToRow` omits both — that is what makes it usable as `TaskDetail`'s change fingerprint —
  and `taskCells` is what a write uses.
- **Deletes are soft, confirmed and reversible**, so rows never move. `compact()` is the only hard
  delete and its `deleteDimension` requests must go **descending**, or it takes the wrong rows.
- **NO LOCK EXISTS ANY MORE, so a write may touch only the cells its edit is about.** The script held
  a script-wide lock, which is what made rewriting untouched cells with values read a moment earlier
  safe. Without it that is how one editor's save erases the other's. Each gesture is therefore one
  `values:batchUpdate` naming only the affected rows, which Google applies as a unit — a cascade
  delete included. Two people editing different rows now never contend at all.

### Time

- **`due` is a CALENDAR DAY resolved against the board's `timezone`** — never an instant, never the
  device's zone: a task due on the 18th must stop being due on the 19th *at the venue*. Everything
  goes through `src/lib/time.js`, which never writes `new Date('2027-04-18')` (UTC midnight, so the
  17th west of Greenwich) and builds every Date from explicit parts.
- **THE ZONE IS USED FOR EXACTLY ONE THING: what today's date is** (`todayIn`). Everything downstream
  compares two day strings, so no offset sampling, DST-gap solving or instant cache belongs in that
  file. Reintroducing any of it means something has started asking about a moment rather than a date,
  which this model has no answer for.
- **Overdue is `due < today` on DAY STRINGS.** Never `now >= instantOf(due)`, which makes every task
  overdue at 00:01 on the morning it is due. `test/progress.test.js` pins both sides of the boundary.
- **`normalizeDay` slices a clock time off, and that is load-bearing rather than lenient.** A cell can
  hold `2027-04-18T23:59`, and `type=date` renders anything unparseable as BLANK — so `draftFrom`
  normalises on the way IN too, or the wheel opens empty and the first commit clears a live date.

### Progress

- **AN UNFINISHED TASK IS 0%, WHATEVER THE DATE SAYS.** `percent` is done → 1, else the subtask tally,
  else 0. Nothing may make a percentage advance without somebody ticking something.
- **`percent` and `duePassed` are different claims over the same denominator and must not be merged.**
  `percent` is work done and is countable; `expected` (the mean of `duePassed`) is the share of dates
  that have passed. The gap between them is drawn as a fill against a mark, in the hero's progress
  strip — the one meter in the app.
- **THERE IS NO PACE VERDICT.** Two tasks late plus two future tasks finished early sum to a pace of
  exactly zero, so any single figure subtracting the two reports "on schedule" with two things late.
  The graphic declines to claim it and `overdue` states the fact on its own. `test/progress.test.js`
  has that case and asserts `overallProgress` exposes no `pace`.
- **Every TOP-LEVEL task counts equally in the roll-up**, never by subtask count — decomposing one
  task more finely must not change what the rest of the board is worth.
- **`SOON_DAYS` is part of the meaning of a state**, not a component's constant: it is what "due soon"
  is, and the boundary past which a row prints no urgency at all.

### The plan

- **A MONTH HEADING CARRIES ITS OWN TALLY, AND EVERY WHOLE-MONTH FIGURE IS WITHHELD WHILE A FILTER IS
  ON.** `Plan` receives the FILTERED list, so a tally counted over the overdue slice of April would
  read `0/3` about a month that is nine tasks long and mostly done. The `Today` line goes with it: a
  list with holes cannot claim everything below a line is still ahead.
- **The tally is `aria-hidden` and never coloured.** Every row states its own state and the header strip
  states the same arithmetic, so "3 slash 9" inside a heading is worse than silence; a month in
  `--good` would claim something about the month rather than about its tasks.
- **The `Today` line is a BOUNDARY, so it renders only with rows on both sides of it**, never in the
  undated group, and it lives BETWEEN rows rather than on one — which keeps it outside the
  one-coloured-mark-per-row budget.

### Subtasks

- **Nesting is exactly one level and the READ enforces it.** A row is a subtask iff `parent_id` names
  a LIVE row whose own `parent_id` is empty (`partitionSubtasks`) — depth-1 by construction, so it
  cannot recurse or cycle. Anything unplaceable (grandchild, cycle, orphan) is **promoted, never
  hidden**: a silently hidden task is the worst thing this app can do.
- **A PROMOTED row is where "has a `parentId`" and "is a subtask" stop being the same question, and
  only one of them is fixed.** `withProgress` marks it `promoted` and the client draws, counts and
  rolls it up as a task — but `validateTask` and `taskFromDraft` both read the raw `parentId`, so the
  editor offers it no date (one written there would be neither validated nor stored) and the card
  withholds the add-subtask field (a child of it would be a grandchild, promoted again on the next
  read). **A promoted row can be retitled but not scheduled from the UI; fixing that means teaching
  the schema layer the difference, not widening the component's guard.** Reachable only by
  hand-editing `parent_id` in the spreadsheet.
- **Precedence is `done_at` > tally > nothing, and nothing is blended** — "3 of 5 = 60%" is checkable
  by counting; a weighted blend is not. No live subtasks reads 0%.
- **All subtasks done does NOT make a parent done**, or a task sits in the done count with an empty
  cell in the sheet and no answer to "when was it finished". Nothing prompts for the tick either: a
  5/5 parent reads 100% and stays open until a person closes it.
- **A subtask is a title and a tick, no date.** `validateTask` returns early for anything with a
  `parentId`: a date wheel per item would make entering five unusable on a phone, and then no
  parent's progress would advance. No meter, no urgency label, and the whole row is the toggle. The
  inline editor therefore renders no date field for one and never writes its `due` cell — the early
  return means a date offered there would be stored unvalidated. **Deleting a parent cascades in ONE
  `values:batchUpdate`** — N separate calls can half-fail, leaving some children tombstoned and some
  not; `restore` is its exact inverse.

### Dates are required

- **EVERY TASK CARRIES A DAY: `validateTask` returns `MISSING_DUE` without one.** The board is a
  schedule, so a task with no place in it is not something this app stores.
- **REQUIRED IS NOT DEFAULTED.** The create sheet opens with the date BLANK and Save refuses until
  somebody picks one; nothing anywhere defaults it to today. An invented date lands straight in the
  overdue count and in the on-schedule mark, so everything typed in a hurry would read overdue
  tomorrow. Refusing asks the question; defaulting answers it wrongly and says nothing.
- **`STATE.NODATE` MUST KEEP WORKING.** A sheet can hold undated rows and anybody can empty the cell
  by hand. Such a row sorts last into its own group and contributes to neither numerator — a row the
  client refuses to SAVE must still be shown. The consequence to know: an undated task cannot be
  renamed until it is given a date, because the whole task goes in one validated write.

### The two backends

`Code.gs`, `connection.js`, `sheets.js` and `api.js` each state their own rules in their headers.
The ones that cost something to rediscover:

- **`doGet` is anonymous and never writes.** Building tabs is a write, so an unbuilt spreadsheet
  answers `needsSetup` and an editor's first write builds them — from the client, through
  `ensureStructure`, which still refuses a spreadsheet that already looks like somebody's work.
- **The `/exec` reply is always HTTP 200**, because `ContentService` cannot set a status, so the
  BODY is the only signal. Branch on the body, never on `response.ok`. **Neither handler may throw**:
  Google's HTML error page reads as transient, so a throw on the reject path is a silent retry loop.
  Never read `e.parameter` for the key — a query string reaches Google's logs.
- **The mint is `text/plain` and its method is never forced through the 302.** `text/plain` keeps it
  a CORS simple request; a preflight would be answered with that redirect and die, which is also why
  there is no `doOptions`. `fetch` downgrades POST to GET across the hop and Apps Script serves the
  computed reply from the echo URL.
- **The Sheets API states its failures properly, and that is what the retry rule reads.**
  `RETRYABLE_STATUS` is 429 and 5xx; every other 4xx is TERMINAL and maps to `misconfigured` — a bad
  range, a scope too narrow, a wrong id. A 401 never reaches `api.js` at all: `sheets.js` re-mints
  and retries it **exactly once**, because a revoked grant would otherwise loop forever.
- **`busy` is gone with the lock that produced it**, and it was never reachable anyway: the script
  waited 25s on that lock while the client abandoned retrying at 20s, so a contended write got one
  attempt and rolled its row back on screen. `test/api.test.js` pins that `TRANSIENT` is now the only
  non-terminal code.
- **`send` retries a non-terminal failure, and what makes that safe is that EVERY op is idempotent** —
  not that a failure proves nothing was written. A write abandoned mid-flight may be committing as it
  is abandoned. `updateTasks`, `setDeleted` and `setConfig` rewrite by id and always did; **`create`
  is an UPSERT on the client's id**, resolving it and rewriting that row rather than appending a twin
  nothing could distinguish from a real second task.
- **A write returns nothing but success.** The old reply carried the whole board, which is how one
  device picked up the other's edits; a Sheets write answers with the ranges it touched. So the
  optimistic state IS the state until the throttled focus refresh re-reads. One round trip per save
  instead of the two a re-read would cost.
- **The token is a write-capable bearer credential in `localStorage`, and it outlives the key.** Up to
  an hour, so `enableEditing` and `revokeEditing` both call `forgetToken()` — otherwise a device just
  demoted to view-only keeps writing, and a device pasting a *different* key keeps using the old
  one's token. `connection.js`'s **generation counter** is why a 401 recovers: a mint that began
  before the 401 may carry the token Google just rejected, and handing it to the no-retry attempt
  turns a blip into a hard failure.
- **Nothing signs in, and no host may be added for it.** The token is the script's own grant, so
  there is no consent screen for either editor and `accounts.google.com` must never appear in the
  CSP. If it does, somebody has replaced the capability link with OAuth.

### Client state

- **Every mutation goes through `run()` in `useBoard` and there is exactly one of it**, pinned by
  `test/board.test.js`. **`fail()` is the one place a failure is classified**, because a READ can also
  be told the key is dead — an editor reads through the Sheets API and a rotated key mints nothing —
  and a second copy is how one of the two stops flagging it. **Writes serialise on a queue**, and
  `refresh` is skipped while a write is pending or overlaps one: a read's board predates an unsaved
  edit, so accepting it wipes the edit off screen.
- **Rows are settled on an EMPTY QUEUE, never by a per-op ledger.** The queue dispatches one request
  at a time, so once it is empty nothing is outstanding and no row may still claim to be pending.
  Tracking ids per op is how a row ends up dimmed forever.
- **The task sheets close before the write lands, and a failure has a toast of its own.** Those
  mutations are optimistic, so waiting buys nothing — but with the panel gone a rolled-back row is
  invisible unless said out loud. Settings WAITS: `saveConfig` has no optimistic half, so closing
  early would show a stale zone and countdown. **`saveConfig`, `compact` and `seedTemplate` each
  force a refresh afterwards**, because none of them can be applied optimistically and a write no
  longer returns a board — without it the sheet is right and the screen is not.
- **ONE WRITE PER EDIT SESSION, and the whole task goes in it.** `TaskDetail` buffers a draft while
  Edit is on and writes once, on Done or on the row closing; per-field commits cost a round trip *each*.
  `update` rewrites the row from its payload, so a partial one blanks a cell — `parent_id` above all —
  and nothing is sent when the ROW it would write is unchanged.
- **AN UNDISPATCHED WRITE IS FOLDED INTO THE ONE BEHIND IT, AND A DISPATCHED ONE NEVER IS.** The queue
  holds plans as DATA so they can be inspected; `foldWrite` merges only the TAIL, so a fold can never
  reorder anything already sent. It never crosses an op boundary — `update`+`delete` is refused, which
  is the resurrection defect arriving by another route. **`create` and `update` each always carry a
  LIST**, which is what retired the `update`/`updateMany` pair and the capability check that decided
  between them: the client is the writer now, so a batch always lands. On failure the callers settle
  newest-first so the OLDEST rollback lands last, that being the only snapshot predating the whole
  batch. A batch is atomic on resolution: one row deleted by hand mid-burst fails all of it, and the
  screen returns to exactly the pre-batch board rather than to a half-applied one nothing can
  describe.
- **`refresh` must re-check for an overlapping write AFTER its await, not only before.** A read takes
  seconds, so a tick landing inside one is a write whose board the read predates; accepting it un-ticks
  the row until the write's own reply puts it back. `pending` cannot see a write that both started and
  finished inside the window, which is what the `issued` counter is for.
- **`done` MUST DISARM THE UNMOUNT FLUSH, AND SO MUST THE DELETE.** Saving a new date re-sorts the
  plan, so the row moves to another month `<section>` and React deletes the subtree rather than moving
  it — running a cleanup whose closure still holds the pre-save task and the whole draft, which sends
  the identical write twice. The delete is the worse half of the same shape: it is optimistic, the row
  stops being live and unmounts, and a flush resolved against the pre-delete task carries an empty
  `deleted_at` into a write that rewrites the whole row, resurrecting it. Nulling the ref alone is not
  enough — it is reassigned every render, so the delete ENDS the session. `scripts/drive.mjs` counts
  the POSTs and prints the defect when the guard is removed.
- **An open edit SESSION is the evidence that unsaved text exists**, and it reports up to `App` as
  `typing` for the whole of itself; a per-field report would drop the guard on every blur between two
  fields, exactly when the buffer is full and nothing has been sent. It holds off a service-worker
  reload and moves the FAB out of the way. The add-a-subtask field reports per-field because it sits
  outside any session — which is why **`typing` is a COUNT, never a flag**: with one boolean and two
  producers, blur is the last writer.
- **TICKING SOMETHING OFF UNDER A FILTER MUST NOT MAKE IT VANISH.** Ticking raises no toast by design,
  so a row that also leaves the list gives no feedback at all for the app's most frequent gesture.
  `App` holds the ids ticked since the filter was chosen and keeps those rows in `shown`; the
  confirmation is the row changing in place while the chip's count drops.
- **Every failed write says so**, `saveConfig`, `compact` and the template seed included. `toast.failed`
  must stand alone and may not point at a notice: only TERMINAL codes get one, and `transient` is
  deliberately excluded from that set — and by the time it reaches a toast, `send` has already spent
  its retries on it.
- **`canEdit` is what renders; `hasKey` is what this device can do.** The read-only view toggle moves
  only the first, so an editor previewing the guest view keeps their key, keeps Settings' revoke
  control rather than being shown a paste field, and gets back with one tap. Enabling or revoking a
  key clears the flag, or a freshly pasted link appears to do nothing.
- **A rejected key is FLAGGED, not deleted**, or the device drops to view-only in silence. And
  **`canEdit` is not the security boundary** — the endpoint refuses every keyless write, so never add
  a client check as enforcement or drop the server one.
- **Which rows are open, and which have just been ticked, is session state, never `localStorage`** —
  relaunching into twelve expanded rows is a board nobody can read. Locale, accent, filter and the
  read-only view ARE per-device.
- **`withProgress` is memoised on TODAY, not on `now`.** The board is day-granular, so nothing it
  computes can change between midnights; keying it on the clock reallocates every task object sixty
  times an hour. The clock still ticks, for the hero's countdown.
- **AN OPEN ROW STARTS READ-ONLY, and `TaskDetail` owns that mode.** Tapping a row is the
  hundred-times-a-week gesture, so live fields behind that tap put a caret in a title one stray blur
  from renaming a task. The Edit toggle also gates every DESTRUCTIVE control — the task's delete and
  the per-item trash icons — while ticking and adding a subtask stay on the read path. **The mode
  lives in `TaskDetail` precisely because that component unmounts when the row closes**, which resets
  it with no effect to synchronise; `editing` is a prop for the same reason `expanded` is, so a static
  render and the harness can see the fields at all.
- **Refreshes on focus are throttled** (30s floor); every read spends the owner's quota. **The hash is
  stripped only when standalone**, so *Add to Home Screen* records a URL still carrying the key, and
  `manifest.webmanifest` omits `start_url` for the same reason.
- **The snapshot's version is a DROP marker, never a migration.** **The service worker never touches a
  cross-origin request**, and that is an explicit early `return` as the first statement of its `fetch`
  handler rather than a property of scope — scope decides which *clients* are controlled, not which
  *requests* are seen, so both the token endpoint and the Sheets API arrive there. A `<meta>` CSP does
  not cover a worker's own context and Pages sends no CSP header, so a worker answering either would
  be an uncovered proxy in front of a bearer token.
- **Nothing written to the sheet is localized** bar one exception, a seeded template's titles, which
  are content from then on.
- **`sheets.googleapis.com` IS in the CSP, and removing it does not make the app safer — it makes
  every write four times slower.** An editor holds a token and reaches that host; a view-only visitor
  holds nothing and never does, which is still why they need no credential. **There is no migration
  code**; the only layout repair is `relayout()` in `sheets.js`.

## Conventions

- **One helper, one home.** `readStored`/`writeStored` are the only `localStorage` touches;
  `schema.js` owns column names AND every A1 range; `templates.js` owns `CATEGORIES`; `time.js`
  resolves every zone and is **the only file that knows the layout of a day string** — `monthOf`,
  `dayOfMonth` and `firstOfMonth` exist so nothing else indexes into `YYYY-MM-DD`; `icons.jsx` owns
  `ICON_SIZE`, so a glyph size is a name rather than a pair of literals at five call sites;
  `theme.js` owns `BG_HEX` and `ACCENT_HEX`; `run()` is the only mutation wrapper and `fail()` the
  only classifier; `DoneToggle` the only done control, `Notice` the only title/body/action block,
  `DueLabel` the only place a date's nearness is worded, and `TaskFields` the only task field markup.
  **No design token may be named in JSX** — the empty board's mark was the last one, and it has a
  class now. **Export only what something outside the file uses.**
- **No new npm dependencies** without a clear reason — one is also a CSP decision, and
  `test/lockfile.test.js` pins the list. **Add a host, update the CSP** in `index.html`, and never put
  a real secret in a `VITE_` variable: Vite inlines them into the shipped bundle.

### i18n

English and Japanese, no dependency; `src/i18n/` holds the engine, two catalogs and the registry. A
module singleton rather than a context, because render tests mount components bare and non-React
modules need the same `t`.

- **Never hardcode a user-facing string in a component**, including every `aria-label`, `title` and
  `placeholder`. `test/i18n.test.js` fails on an unused key, a missing key and a bare literal in one
  of those attributes; a key built at runtime needs its own coverage test.
- **Plurals go through `Intl.PluralRules`**, never a `count === 1` ternary; `ja` has `other` alone.
  **The pure layers stay pure**: `time.js`, `progress.js`, `schema.js` and `templates.js` never read
  the singleton, and a test that calls `setLocale` must restore it. **An unknown category renders
  exactly as typed** — the sheet is the source of truth, the catalog a courtesy on top.

### CSS

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. Single classes, no
IDs, no `!important`. Light theme only, mobile first, and **exactly ONE breakpoint** (48rem) —
`test/ui.test.jsx` pins that as an exact set across every sheet, so prefer a `clamp()`, a container
query or `auto-fit` to a second one. One centred column at every width, capped at `--column-max`: a
large monitor gets a bigger photograph and more air, never a second column. Use the tokens —
`var(--transition-fast|base)` collapse to ~0ms under `prefers-reduced-motion`, so a hardcoded duration
opts out of that silently. Meters are hand-rolled: flex plus percentages, no library. Every rule
carries its constraint as a comment.

- **THERE IS ONE COLOURED MARK PER ROW, IT FOLLOWS STATE, AND IT IS NEVER THE ONLY CHANNEL.** The hue
  lives on the dot beside `DueLabel`'s words and comes from the one `.dot--*` table; a day column a
  third of whose entries are red stops being a column, and a state colour on type is what that table
  exists to avoid. A state earns an entry only where its fill differs from `.dot`'s own fallback.
- **THE CATEGORY CHANNEL IS SHAPE, NOT COLOUR.** Fourteen hues would make one row's mark carry two
  claims, so a category gets a monochrome glyph from `CATEGORY_ICONS` — **leading the word, never
  replacing it**, since fourteen shapes is more vocabulary than anyone learns cold and an English and
  a Japanese reader do not learn the same ones. An unknown category renders as typed with **no glyph
  at all**: a fallback would put a claim on it nobody made.
- **Japanese is a first-class language here.** `letter-spacing: 0`, no `text-transform`, and no
  `line-height` below 1.5 wherever text can be Japanese — everywhere but the hero percentage,
  including the couple's names. Uppercase belongs in JS with `toLocaleUpperCase`, never in CSS:
  `text-transform` is a no-op on kana and would fire on the Latin half alone. **A row's day does NOT
  go through `Intl`**: `{ day: 'numeric' }` in `ja` returns `18日`, which wraps inside the 2rem
  column. Weights `400|500|600`.
- **FOUR TYPE STEPS: 13 / 16 / 18 / 24, and nothing below 13.** There is deliberately no 14 — 13 and
  14 are not distinguishable in a UI, and everywhere the two met, weight and ink were already carrying
  the difference. Anything reaching for 14 is either a caption or body text; decide which.
- **One value per idea, and the tokens say which.** `--ring-width` and `--dim` each replaced a pair a
  couple of units apart doing the same job in two files; `--space-hair` is the pill's 1px of optical
  padding, the one value deliberately off the 4px scale; `--sheet-height` is both sheet maxima.
  `--fs-label`, `--radius-xs`, `--good-wash`, `--neutral-wash`, `--meter-height-lg`, `--font-mono`,
  `--lh-flat`, `--fs-display` and the whole `--danger` family are gone — a red is a red, and
  `.btn--danger` names a destructive control rather than a colour.
- **`--ink-3` MUST NOT SIT ON AN ACCENT WASH** — 4.59–4.71:1, which is no margin at 13px. The
  wedding month's plaque is the only rule consuming `--accent-wash` and its label and tally are both
  `--ink-2` (6.60:1 at worst). Kanji at low contrast is unreadable in a way Latin is not.
- **`--line-input` IS MEASURED ON ALL THREE SURFACES, and that is not pedantry.** It exists only for
  WCAG 1.4.11's 3:1 control boundary, and `.chip` and `.btn--secondary` both swap their fill to
  `--sunken` on hover while keeping it — so the boundary on the app's primary filter controls is only
  as good as its worst backdrop. It went unmeasured for as long as it existed and was failing:
  2.65:1 on sunken, 2.91:1 on bg. Now 4.00 / 3.77 / 3.38, with a harness row for each.
- **THE OVERDUE CHIP'S COUNT IS `--critical`, THE ONE COUNT THAT IS NOT `--ink-3`.** Everything else
  in that row is a statistic; this is the number somebody has to act on, and at `--ink-3` it was the
  quietest text on the row beside "Later 34", which read louder purely because 34 is bigger than 8.
  Within the one-coloured-mark budget because the word "Overdue" is immediately beside it, and
  withheld at zero — `--empty` marks that — so a clean board carries no red 0.
- **THE DEFAULT ACCENT IS `tarn`, AND IT IS THE ONLY ONE THAT MAY BE.** The accent paints
  `.dot--soon`, an 8px disc carrying a row's whole state, so the default has to be separable at that
  size from BOTH `--good` and `--critical`. Measured in OKLab (0.15 is comfortable at 8px):
  tarn 0.198/0.202, pine 0.134/0.176, rosehip 0.260/0.128. A green default collides with the green
  "done" and a magenta one with the red "overdue"; a cold water blue is the one family clear of both.
  **Whoever picks pine or rosehip accepts a `soon` dot they may not separate** — survivable only
  because the dot is never the only channel. Never add a preset without measuring it, and **never
  mute `--good` to match the neutrals**: at a muted `#35762f` the default falls to 0.155, closer than
  the sage preset that was rejected for exactly this. `--good` and `--critical` are SIGNALS, not
  theme; the neutrals carry the outdoors reading instead.
- **`make-icons.js` and `scripts/check-contrast.js` both PARSE `tokens.css`** rather than restating
  it. Each used to hold its own copy of the palette, which meant a retheme could pass its own
  contrast check while measuring the previous colours, and could ship an app one colour with a Home
  Screen icon another. The icons are committed, so re-run `npm run icons` after changing the default.
  `index.html`'s inline favicon is the one copy that cannot be derived.
- **The app's mark is two peaks.** `PeaksIcon`, `make-icons.js` and `index.html`'s inline favicon all
  draw it and must not drift. A notched fan is not available at this size: a notch deep enough to
  read turns the silhouette into a heart.
- **An unsettled row dims its HEAD, never its tick** — a tick that fades on contact reads as a tap
  that missed. Same for a checklist item: the title recedes, the glyph does not.
- **Never a form control below 16px** (mobile Safari zooms on focus and will not zoom back), and
  **`--tap-target` (44px), not `--tap-target-sm`, for anything a thumb aims at.**
  **`role="progressbar"`, never `role="meter"`**: ARIA reserves `meter` for a gauge rather than a
  value advancing toward completion, and VoiceOver maps it patchily enough to lose the label and the
  value with it. **`interactive-widget=resizes-content` is load-bearing** with a sticky
  `.sheet__foot`, or Save sits under the keyboard.
- **The hero's scrim IS the contrast mechanism**, not decoration. Its ink cannot be measured against a
  token because the backdrop is a photograph, so it is measured against the worst case the scrim
  allows — the dense end composited over a blown-out white sky. Lightening `--photo-scrim`'s end stop
  takes white type from 9.08:1 to 4.07:1 and fails.
- **THE HEADER IS PINNED, AND IT IS TWO BANDS.** The photograph is `--hero-photo` (a clamp around
  10vh — a bare `10vh` gives 60px in a short landscape window, which cannot hold a name and a
  countdown), and the progress strip sits BELOW it on `--surface`. The strip is outside the
  photograph on purpose: every measured meter figure — the fill against `--track`, the hairline that
  identifies an empty one — is against opaque tokens, and a photograph is the one backdrop that
  cannot be measured. **`--hero-height` is the header's whole occupied height and `.plan__month`
  offsets its `sticky` top by it**; anything added to the header has to go into that token, or the
  month heading lands under the strip. The strip therefore takes a FIXED height rather than letting
  content set it. `.plan__month`'s `z-index` stays below `--z-header` so it slides under.
- **`object-position: 50% 42%` is no longer holding faces in frame** — at a tenth of the viewport the
  band is too short for that at any offset. It chooses the part of the picture that reads best as
  texture behind two lines of type. Do not restate the old faces-at-40-45% reasoning; it stopped
  being true when the band shrank.
- **The card accordion is NOT animated.** `height` and `max-height` are layout properties, a mount is
  not a transition, and `max-height` slips past the "never transition width/height" test while being
  exactly the thrash that test forbids. The chevron carries the motion.
- **`.input[type="date"]` MUST turn the platform appearance off, both spellings, prefixed first.**
  With it on, Safari sizes the control from its own shadow tree and that intrinsic width is a FLOOR —
  `width: 100%` is a ceiling it ignores, so the control draws past the right edge of a 252px row on a
  320pt phone. Nothing clips it either: `.tcard` has to stay `overflow: visible` or the focus ring is
  cut. The two shadow selectors beside it put back the metrics that turning it off removes, and
  narrowing the type is not an option — 16px is the no-zoom floor and is *why* the control is wide.
- **The month heading is `position: sticky` with an OPAQUE background**, and that background is
  load-bearing: rows scroll under it. It sticks inside `.plan__group`, which is a flex column, so the
  next month's heading pushes it out, and it parks at `--hero-height` rather than at `--safe-top`. The rule beneath it is `--line` and **never a shadow**, and the
  wedding month's tint bleeds outward on a negative margin so every month name stays in ONE column.
- **The FAB and the header are the only pinned chrome**, and `.views` reserves `--fab-size` below its
  content, once, so the button can never cover the last row.
- **A subtask is never drawn in the sequence of dates**: no date means no position. It is a row in its
  parent's checklist, and what reaches the parent is a `3/5` tally. **No
  `-webkit-overflow-scrolling: touch` anywhere**: a no-op since iOS 13 that breaks `position: sticky`
  inside the same scroller, which the month heading depends on.

## Testing

`ui.test.jsx` reads the stylesheets as TEXT, so its helpers strip comments, anchor whole selectors and
brace-count media blocks — each of those mistakes makes a test that always passes.

**ANY ASSERTION ABOUT AN ABSENCE MUST STRIP COMMENTS FIRST.** Every file here explains its rules by
NAMING what it forbids — "never `USER_ENTERED`", "no `--lh-flat`", "never `e.parameter`" — so a raw
search matches the prose and passes whatever the code does. `code()` in `ui.test.jsx` and `CODE` in
`script.test.js` exist for exactly that, and three assertions were written wrong this way before the
rule was worth stating.

`script.test.js` EXECUTES `Code.gs` and `sheets.test.js` drives the REST client against a fake that
parses A1 ranges for real, because both are the kind of code that succeeds while writing the wrong
cell. `connection.test.js` covers the mint, where every failure is invisible: `/exec` always answers
200, so a rotated key reported as a blip hides behind retries forever and a blip reported as a bad key
sends somebody hunting for their edit link.

- **A static render never runs an effect and never fires a blur**, so opening a card and every
  commit-on-blur path are invisible to `render.test.jsx` and to the harness. Every default must be
  correct alone — which is why `expanded` and `editing` are props the harness can set — and the
  accordion, each commit path, the validation refusals and the keyboard's effect on a sheet are
  verified by driving the built app in a real browser.
- **When fixing a bug, add the regression test** — for progress arithmetic, the misleading case: all
  overdue and nothing done must report 0% *and* say it is behind.
- **A passing suite does not mean it looks right.** Screenshot through `scripts/harness.html`'s
  iframes rather than a resized window: an iframe gets an honest viewport, while headless Chrome
  reports a different width and every breakpoint reads wrong. **`to=` does not survive a headless
  capture**, so a surface that only appears mid-scroll needs a preview PAGE of its own — `en-sign` is
  that, for the month tally, the wedding plaque and the `Today` line. A case the harness cannot show
  is a case nothing protects.
- **`scripts/drive.mjs` covers what no static render can**, over CDP: the accordion, the read/edit
  toggle, commit-on-blur, whether the date control stays inside its row, that ticking under a filter
  keeps the row on screen, and that deleting a just-edited task sends one `delete` and no resurrecting
  `update`. Its header records three ways it can silently verify NOTHING — headless Chrome fires no
  focus event without `Emulation.setFocusEmulationEnabled`, a leftover Chrome on the debugging port
  makes a second run report the first one's board, and the fixture replies in milliseconds, so **no
  optimistic state survives long enough to be measured** and anything about it must be pinned
  elsewhere. Its fixture is `public/__dev-board.json`, gitignored under that name because the service
  worker precaches whatever reaches `dist/`, and its `config` is keyed the way the SHEET is
  (`wedding_date`), not the way the client's config object is.

## Gotchas

- **Never run a bare `npm install`.** `NPM_CONFIG_REGISTRY` here points at an internal mirror and npm
  bakes that host into every `resolved` URL — fine locally, `ENOTFOUND` everywhere else, reported only
  as "Exit handler never called!", and a repo `.npmrc` cannot outrank an env var. Use
  `npm install --registry=https://registry.npmjs.org`; `test/lockfile.test.js` verifies.
- **A deployment is pinned to a version.** Editing `Code.gs` changes nothing on the live board until
  **Deploy → Manage deployments → New version**; the app detects this and refuses unsafe writes.
- **The script must stay container-bound**, or `getActive()` returns null and everything answers
  `misconfigured`. It has to be created from the sheet via *Extensions › Apps Script*.
- **THE SCOPE IS `spreadsheets`, NOT `spreadsheets.currentonly`, AND THAT IS THE PRICE OF THE SPEED.**
  `currentonly` is an Apps-Script-runtime scope: the REST API rejects a bearer token carrying only
  it, so a usable token means the wide scope — and the wide scope reaches **every spreadsheet the
  owning account can see**. Container binding still confines the SCRIPT; it no longer confines the
  TOKEN. So the account owning this sheet should own nothing else, which is a standing condition the
  code cannot enforce (README's security model states it). It also means an attached Cloud project
  with a **published** consent screen: in Testing, authorization expires after 7 days and the symptom
  is indistinguishable from a quota problem.
- **`vite.config.js`** defaults `base` to `/wedding/` because project Pages sites serve from
  `/<repo>/`; sets `test.env.VITE_SCRIPT_URL`, which `config.js` captures at module load; and in DEV
  ONLY proxies **two** routes to `127.0.0.1:5200` — `/wedding/__endpoint` for `/exec` and
  `/wedding/__sheets` for the Sheets API. Both are needed because the app has two backends, and
  `scripts/stub-endpoint.mjs` now serves both over one in-memory grid: it applies REST writes and
  serves `doGet` from the same rows, so "was it stored" finally has an answer without a deployment.
  `VITE_SHEETS_BASE` is the only reason `sheets.js`'s base URL is overridable, and it must never be
  set in a shipped build.
- **The board is world-readable and that is the design.** Do not put anything private in it.
- **The hero is a derived crop and the camera original is not kept.** `public/hero.jpg` is 1280x1600
  at ~290KB; regenerate it from a new photo with two `sips` passes, not one — combining `-c` with
  `--resampleHeightWidth` silently produces the wrong dimensions:

  ```sh
  sips -c 4190 3352 --cropOffset 427 111 <photo>.JPG --out /tmp/hero-crop.jpg
  sips --resampleHeightWidth 1600 1280 --setProperty formatOptions 20 /tmp/hero-crop.jpg \
    --out public/hero.jpg
  ```

  `--cropOffset` is measured from the top-left when non-zero but means "centred" at `0 0`, and an
  offset whose rect ends exactly on the image edge silently produces no crop at all.

  **DO NOT COMPOSE FOR FACES.** The band is a tenth of the viewport, so no `object-position` holds
  them in it at any offset — the picture is texture behind two lines of type. Compose for what reads
  at 90px tall, then LOOK at it at 393px and at the 48rem plate, because that is the only way to
  choose the percentage. (These four lines used to say the opposite, and both halves of this file
  were true of different versions of the hero.)
