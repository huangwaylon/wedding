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
- **A PROMOTED row is where "has a `parentId`" and "is a subtask" stop being the same question,
  and only one of them is fixed.** `withProgress` marks such a row `promoted`, and the client
  draws, counts and rolls it up as a task — but `validateTask` and `taskFromDraft` both still
  read the raw `parentId`, so the editor offers it no window (dates written there would be
  neither validated nor stored) and the card withholds the add-subtask field (a child of it
  would be a grandchild, promoted again on the next read). **A promoted row can therefore be
  retitled but not scheduled from the UI; fixing that means teaching the schema layer the
  difference, not widening the component's guard.** It is reachable only by hand-editing
  `parent_id` in the spreadsheet.
- **Precedence is `done_at` > tally > clock, and nothing is blended** — "3 of 5 = 60%" is checkable
  by counting; `0.5 × elapsed + 0.5 × tally` is not. No live subtasks falls back to the clock.
- **All subtasks done does NOT make a parent done**, or a task would sit in the done count with an
  empty cell in the sheet and no answer to "when was it finished". Nothing prompts for the tick
  either: a 5/5 parent reads 100% and stays open until a person closes it.
- **A subtask is a title and a tick, no dates** — `validateTask` returns early for anything with a
  `parentId`, because two date wheels per item would make entering five unusable on a phone and then
  no parent's progress would advance. No meter, no badge, and the whole row is the toggle. **The inline
  editor therefore renders no date fields and no all-day switch for a subtask, and never writes its
  `start`/`end` cells** — the early return means dates offered there would be saved unvalidated, and
  it did save an end before a start. **Deleting a parent cascades in the Apps Script**, one lock and
  one reply; `restore` is its exact inverse.

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
- **Editing commits per FIELD, on blur, and every commit sends the WHOLE task.** `update` rewrites
  the row from its payload, so a partial one blanks a cell — `parent_id` above all. Nothing is sent
  when the value did not change, compared as the ROW each would write, so a trailing space
  `taskToRow` trims costs no round trip.
- **A focused field is the only evidence that unsaved text exists**, which is why `TaskEditor` and
  the add-a-subtask field both report focus up to `App` as `typing`: it holds off a service-worker
  reload (there is no open sheet to infer it from any more) and moves the fixed FAB out from over
  the field. **Which tab is on screen and which cards are open are session state, never
  `localStorage`** — relaunching into twelve expanded cards is a board nobody can read — and the
  two tabs share one document scroller, so a switch resets it deliberately.
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
  only title/body/action block, and `TaskFields` the only task field markup — the inline editor and
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
its children are spans. What reaches beyond CSS:

- **Japanese is a first-class language here.** `letter-spacing: 0`, no `text-transform`, and no
  `line-height` below 1.5 wherever text can be Japanese — which is everywhere but the hero
  percentage, including the couple's names and a `4月` date chip. A month abbreviation is uppercased
  in `formatWallChip` with `toLocaleUpperCase`, never in CSS, because `text-transform` is a no-op on
  kana and would apply to the Latin half alone. **The chip's day does NOT go through `Intl`**: `{ day:
  'numeric' }` in `ja` returns `18日`, which wraps inside a 36px chip. Nothing below 13px; weights
  `400|500|600`.
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
- **The spine is `--track-line`, not `--line`.** Same defect as the meter's hairline: `--line`
  measures 1.2:1 against the card it is drawn on, so the spine was invisible at 390px and the nodes
  read as unrelated dots. It is drawn per card and stitched across the group's gap rather than once
  per group, because one line spanning the group runs behind the month heading.
- **The tab bar is fixed and must stay reachable-around**: `.views` reserves the bar plus the FAB
  below its content, once, and the bar is opaque when `backdrop-filter` is unsupported or the list
  reads straight through it. The selected tab is never colour alone — it also carries a rule on the
  bar's top edge and `aria-current`.
- **A subtask is never drawn on a time axis**: no dates means no position and no extent. It is a row
  in its parent's checklist, and what reaches the parent is a `3/5` tally, never coloured — `5/5` in
  `--good` would claim a `done_at` the sheet does not have. **Colour follows STATE, not category**, or
  one mark carries two palettes, and **no `-webkit-overflow-scrolling: touch` anywhere**: a no-op
  since iOS 13 that broke `position: sticky` inside the same scroller.

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
