# CLAUDE.md

`README.md` explains the app to a person. This file states the rules that explanation implies, names the
symbol enforcing each and the test pinning it, and states nothing twice. Every source file carries its own
mechanism in comments — why, not what, present tense, never narrating an older version — so a rule here
names the constraint and what breaking it costs, and leaves the how to the file.

Vite + React 19, plain ESM JavaScript, vitest, no runtime dependency but `react`/`react-dom`. README's
Architecture has the two-backend split and its latency numbers; what matters for editing is that `api.js`
dispatches, `connection.js` caches the token, and `sheets.js` is the REST client — and that which backend
runs depends only on whether the device holds an edit key.

Before any commit: `npm test`. Also `npm run dev|build|preview`, `npm run contrast` after any colour
change, `npx vite-node scripts/preview.jsx` for the visual harness.

## Invariants

Breaking one does not throw. It puts a wrong number on a screen or the wrong thing in the sheet.

### The sheet contract

- `src/schema.js` and `apps-script/Code.gs` both hold the column list and cannot import each other across a
  network hop; `test/schema.test.js` parses the `.gs` and fails on drift. Nothing else may name a column.
- Columns are append-only: a rename leaves a stale deployment holding every other column.
- A task is a title, a day and a tick — no start, clock time, all-day flag, owner or memo. Each costs a
  control on a 393px screen, a column to understand, and a percentage advancing without a tick.
- Reads resolve columns by name, writes address them by position, on both sides of the wire, so `tasksFrom`
  exists twice. `relayout()` repairs a moved header on the next write and must not clear past column I: a
  stray column shifts no index, and wiping it deletes what a newer deployment appends.
- **`update` rewrites the whole row from its payload.** That is the premise of this rule and of two in
  **Client state**: so `taskToRow` must always send `parent_id`, omitting it blanking the cell and silently
  promoting a subtask to a task.
- Every write is `valueInputOption: RAW` and `schema.js` owns every A1 range; `ensureStructure` sets the `@`
  format per column so the Sheets ui cannot coerce a hand-typed date. A hardcoded `tasks!A2:I` is a second
  place that knows the width.
- Only the anonymous read recovers a hand-reformatted date cell: the editor's `FORMATTED_VALUE` arrives in
  the sheet's locale, `normalizeDay` reads no date, and the row shows under **No date**. Known, not fixed;
  the only place a planner and an editor see different boards.
- The client stamps `created_at` and `updated_at`, so a wrong device clock can backdate a row — traded for a
  one-hop write, and neither is load-bearing. `created_at` is read off the existing row, so a replay cannot
  restamp it. `taskToRow` omits both, which makes it `TaskDetail`'s change fingerprint; writes use
  `taskCells`.
- Deletes are soft, confirmed and reversible, so rows never move. `compact()` is the only hard delete; its
  `deleteDimension` requests must go descending or it takes the wrong rows.
- No lock exists, so a write may touch only the cells its edit is about: rewriting untouched cells with
  values read a moment earlier erases the other editor's save. One `values:batchUpdate` per gesture,
  applied as a unit.

### Time

- `due` is a calendar day resolved against the board's `timezone`, never an instant, never the device's
  zone: a task due on the 18th stops being due on the 19th at the venue. `src/lib/time.js` never writes
  `new Date('2027-04-18')` (UTC midnight, so the 17th west of Greenwich) and builds Dates from parts.
- The zone is used for one thing: what today's date is (`todayIn`). Everything downstream compares day
  strings, so offset sampling, DST solving or an instant cache there means something has started asking
  about a moment rather than a date.
- Overdue is `due < today` on day strings. `now >= instantOf(due)` makes every task overdue at 00:01 on the
  morning it is due; `test/progress.test.js` pins both sides.
- `normalizeDay` slices a clock time off, and that is load-bearing: `type=date` renders an unparseable value
  as blank, so `draftFrom` normalises inbound too or the first commit clears a live date.
- `useToday` is the app's whole clock: today's date in the board's zone, as a day string, polled on a
  15-minute wall-clock boundary — exact, every IANA offset being a whole number of quarter-hours. A
  millisecond timestamp re-rendered `App` and the unmemoised list once a minute for a daily value. `Hero`
  takes `today` and composes `daysBetween(today, weddingDay)`.

### Progress

- An unfinished task is 0%, whatever the date says: `percent` is done → 1, else the subtask tally, else 0.
- `percent` and `duePassed` are different claims over the same denominator and must not be merged: `percent`
  is work done and countable, `expected` (the mean of `duePassed`) the share of dates passed. The gap is a
  fill against a mark in the hero strip, the one meter in the app.
- There is no pace verdict: two tasks late plus two finished early sum to zero, so any single subtracted
  figure reports "on schedule" with two things late. `test/progress.test.js` asserts `overallProgress`
  exposes no `pace`; `overdue` states the fact alone.
- Every top-level task counts equally in the roll-up, never by subtask count: decomposing one task must not
  change what the rest of the board is worth.
- `SOON_DAYS` is part of the meaning of a state, not a component's constant — it is what "due soon" is, and
  the boundary past which a row prints no urgency.

### The plan

- A month heading carries its own tally, and every whole-month figure is withheld under a filter: `Plan`
  gets the filtered list, so a tally over April's overdue slice would read `0/3` about a month nine tasks
  long. The `Today` line goes with it — a list with holes cannot claim everything below it is ahead.
- The tally is `aria-hidden` and never coloured: the row and the header strip already state that
  arithmetic, and a month in `--good` would claim something about the month rather than its tasks.
- The `Today` line is a boundary — only with rows on both sides, never in the undated group, and between
  rows, which keeps it outside the one-coloured-mark-per-row budget.

### Subtasks

- Nesting is exactly one level and the read enforces it: a row is a subtask iff `parent_id` names a live row
  whose own `parent_id` is empty (`partitionSubtasks`). Anything unplaceable — grandchild, cycle, orphan —
  is promoted, never hidden; a silently hidden task is the worst thing this app can do.
- A promoted row is where "has a `parentId`" and "is a subtask" stop being the same question, and only one is
  fixed: `withProgress` marks it `promoted` and the client counts it as a task, but `validateTask` and
  `taskFromDraft` read the raw `parentId`, so the editor offers no date and the card withholds the
  add-subtask field. It can be retitled but not scheduled from the ui; fixing that means teaching the schema
  layer the difference, not widening the component's guard.
- Precedence is `done_at` > tally > nothing, and nothing is blended: "3 of 5 = 60%" is checkable by
  counting, a weighted blend is not. No live subtasks reads 0%.
- All subtasks done does not make a parent done, or a task sits in the done count with an empty cell and no
  answer to "when was it finished". Nothing prompts for the tick: a 5/5 parent reads 100% and stays open.
- A subtask is a title and a tick, no date; `validateTask` returns early for anything with a `parentId`,
  because a date wheel per item makes entering five unusable on a phone. No meter, no urgency label, the
  whole row is the toggle, and the editor never writes its `due` cell — a date offered there would be
  unvalidated.
- Deleting a parent cascades in one `values:batchUpdate`; N calls can half-fail, leaving some children
  tombstoned and some not. `restore` is its exact inverse.

### The notes document

The second tab: one free-form markdown document, shared, holding what has been decided.

- It lives in `config` under the key `notes`, one cell. That is what makes it safe without a lock — a save
  touches one cell, `serializeConfig` emits only the fields it is handed and `setConfig` writes only the rows
  the payload names — and it is why the feature needed no Apps Script redeploy: `doGet` already returns every
  config row, so a viewer reads it on the deployment that was already live. A tab of its own would be a third
  thing that must not drift across a hop neither side can import, and adding its range to `loadBoard`'s batch
  would 400 on every board built before it, which `looksUninitialized` reads as an unbuilt spreadsheet — an
  empty board over a live snapshot.
- **`DEFAULT_CONFIG.notes` is `''` and must stay `''`.** `parseConfig` omits a blank value so the default
  wins, which is right for a category list; give this one any content and "select all, delete, save" restores
  that content on the next read. Emptiness is a legitimate intent here, not a missing value.
- `App`'s `saveNotes` sends `{ notes }` alone, never `{ ...config, notes }`: spreading the merged config would
  write this build's defaults over the sheet and clobber a Settings save landing beside it. Pinned in
  `test/render.test.jsx` and `test/sheets.test.js`.
- Refused before it is sent past `NOTES_MAX_CHARS`: a Sheets cell holds 50,000 characters and the write would
  400, which the taxonomy reads as `misconfigured` — a notice about scopes and spreadsheet ids for a document
  somebody pasted a book into.
- `parseMarkdown` returns DATA, and `Markdown.jsx` maps it onto elements, so no HTML string is built and
  `innerHTML` appears in no file (`test/ui.test.jsx` scans for it, comments stripped). The document is written
  by anybody holding the key and read by everybody, and the device keeps a write-capable bearer token in
  `localStorage`: a renderer that concatenated markup would be an injection surface with a shared credential
  in front of it. Refused for the same reason: links, which is the one injection route left once markup is out
  (`javascript:` is a URL). Refused because the vocabulary has to stay small: images, tables, code fences,
  block quotes, rules, task checkboxes — a second checklist no percentage counts is the worst outcome here.
- Four blocks and two marks. **A single newline is a line break, a blank line a paragraph:** CommonMark
  reflows consecutive lines into one, so three things typed on three lines arrive as one sentence, and this is
  a phone. An unmatched marker renders as typed — half-finished emphasis is what a document looks like
  mid-sentence, and swallowing the rest of it is worse. Delimiters are read as RUNS (`***both***` is one
  three-asterisk run), and an opener needs a non-space after it or `2 * 3 * 4` is italic.
- The parser accepts more than the toolbar produces — `##`, `1.`, single-`*` italic — because people type
  them, and markup rendering as literal punctuation reads as a broken app.
- Read mode IS the preview and the Edit toggle IS the preview toggle: a split view halves a 361px column to
  ~180px, where a bulleted line wraps every three words. So there is no third mode.
- One write per session, on Done, and nothing sent when the text is unchanged. Two divergences from
  `TaskDetail`: no unmount flush, because `App` withholds the tab bar for the whole session so Done is the
  only exit and no stray tap writes a half-finished paragraph; and no Cancel, a discard control over
  arbitrarily much of somebody else's text being worse than none, with the spreadsheet's revision history as
  the real undo.
- Every toolbar button is a toggle whose second press is its own inverse, and a block mark is decided over the
  WHOLE selection — per line, a mixed run alternates on every tap and never converges. Each transform returns
  the text AND the selection, and `NotesView` writes both to the node: React re-renders a controlled textarea
  from its value and the browser then parks the caret at the end, so a transform returning text alone sends
  somebody to the bottom of the document on every tap. `onMouseDown` is prevented, or focus leaves the field
  and the keyboard drops.
- No autofocus anywhere in it. A `focus()` on a surface that re-renders per keystroke drops the iOS keyboard
  mid-word, and the tap that puts the caret chooses where it goes.
- The last-writer-wins scope is the whole document, unlike a tick: two people editing notes at once is one
  overwriting the other. Accepted — there is no lock and no push channel — which is why the draft is buffered
  and a focus refresh cannot pull text out from under the caret.

### Dates are required

- Every task carries a day: `validateTask` returns `MISSING_DUE` without one. The board is a schedule.
- Required is not defaulted. Create opens blank and Save refuses until somebody picks a date; an invented
  one lands in the overdue count and the on-schedule mark, so anything typed in a hurry reads overdue
  tomorrow.
- `STATE.NODATE` must keep working: anybody can empty the cell by hand, and such a row sorts last into its
  own group and counts toward neither numerator. A row the client refuses to save must still be shown.
  Consequence: an undated task cannot be renamed until it is dated, the whole task going in one write.

### The two backends

`Code.gs`, `connection.js`, `sheets.js` and `api.js` each state their own rules in their headers. The ones
that cost something to rediscover:

- `doGet` is anonymous and never writes. Building tabs is a write, so an unbuilt spreadsheet answers
  `needsSetup` and an editor's first write builds them through `ensureStructure`, which refuses a
  spreadsheet that already looks like somebody's work.
- The `/exec` reply is always HTTP 200, `ContentService` being unable to set a status, so branch on the body
  and never on `response.ok`. Neither handler may throw: Google's HTML error page reads as transient,
  making a throw on the reject path a silent retry loop. Never read `e.parameter` for the key — a query
  string reaches Google's logs.
- The mint is `text/plain`, keeping it a CORS simple request; a preflight would be answered with the 302 and
  die, which is also why there is no `doOptions`. Its method is never forced through the hop.

`RETRYABLE_STATUS` is 429 and 5xx. Everything else is terminal, being equally true a second later.

| Signal | Code | Note |
| --- | --- | --- |
| 429, 5xx, abort, non-JSON body | `transient` | retried by `send`; the only non-terminal code, pinned by `test/api.test.js` |
| any other 4xx | `misconfigured` | a bad range, a scope too narrow, a wrong id |
| `bad_payload` | `misconfigured` | deterministic; as transient it spent two retries and ~2s of backoff |
| 401 | never reaches `api.js` | `sheets.js` re-mints and retries exactly once; a revoked grant would loop forever |
| 400 on a read | `needsSetup` | `looksUninitialized` is 400 only. A 404 is "no such spreadsheet" and must reach `misconfigured`: read as "tabs not built yet" it produced an empty board that overwrote the device snapshot and invited seeding a template over a live board |

- Every network path carries a ceiling — hang-stops, not latency budgets: `sheets.js` 20s per call, `api.js`
  20s on the read, `connection.js` 15s on the mint. `fetch` has no limit of its own and `useBoard` holds
  `reading`/`saving` for the life of a call, so one socket that never closes blocks every later refresh or
  dims a row forever. `test/sheets.test.js` pins the signal. An abort retries as transient, sound only
  because every op is idempotent.
- `send` retries a non-terminal failure, and what makes that safe is that every op is idempotent, not that a
  failure proves nothing was written. `updateTasks`, `setDeleted` and `setConfig` rewrite by id; `create` is
  an upsert on the client's id, rather than appending an indistinguishable twin.
- A write returns nothing but success, so the optimistic state is the state until the throttled focus
  refresh re-reads. One round trip per save instead of two.
- The token is a write-capable bearer credential in `localStorage` outliving the key by up to an hour, so
  `enableEditing` and `revokeEditing` both call `forgetToken()`: otherwise a device demoted to view-only
  keeps writing, and one pasting a different key keeps the old token. `connection.js`'s generation counter
  is why a 401 recovers rather than hard-failing on the token Google just rejected.
- Nothing signs in, and no host may be added for it: the token is the script's own grant, so there is no
  consent screen and `accounts.google.com` must never appear in the CSP.
- `sheets.googleapis.com` is in the CSP; removing it makes every write four times slower, not safer. There
  is no migration code.

### Client state

- Every mutation goes through `run()` in `useBoard`, and there is exactly one of it (`test/board.test.js`).
  `fail()` is the only classifier: a read can also be told the key is dead, an editor reading through the
  Sheets API and a rotated key minting nothing.
- Writes serialise on a queue; `refresh` is skipped while a write is pending or overlaps one, a read's board
  predating an unsaved edit. The overlap check repeats after the await, and `issued` catches a write that
  started and finished inside the window, which `pending` cannot see.
- `readOnce` does one read; `refresh` decides whether to read and returns a boolean.
  `refresh({ force: true })` waits out a read in flight instead of returning early, because `saveConfig`,
  `compact` and `seedTemplate` have no optimistic half and report success on that re-read landing. The early
  return is how "Settings saved" appeared over the old wedding date.
- `revert(current, before, after)` reverts only the rows the failed edit touched, against the current array.
  Restoring the whole array undoes what landed after: tick A, tick B, A fails, and the pre-A array draws B
  un-ticked while the sheet has it done. Touched rows are found by reference against `before`, valid because
  every `optimistic` updater passes untouched rows through unchanged. A failed create is dropped.
- Rows settle on an empty queue, never a per-op ledger — one request is in flight at a time, and per-op ids
  dim a row forever. `settle()` runs in `finally` so it covers the failure path: a row dimmed by a write
  that failed behind one that succeeded has nothing else to clear it, and reads only happen on focus.
- `run` clears `error` on a successful write unless the board is `stale`, or a terminal failure's notice sits
  above the board until a read happens to succeed. While `stale` the notice is about the board's origin,
  which a write does not change.
- `editTask` refuses an update clearing a tombstone (`!isLive(current) && isLive(task)`) or naming a row the
  board no longer holds: an empty `deleted_at` would resurrect a deleted task with its subtasks still
  tombstoned. It is the only guard covering the route `TaskDetail` cannot see — a refresh brings back a board
  where the other editor deleted the row, and the flush still holds the pre-delete task. `restore` clears
  the cell legitimately and does not pass through here.
- `done` and the delete both disarm the unmount flush. Saving a new date re-sorts the plan, so React deletes
  the subtree rather than moving it and the cleanup re-sends the identical write. The delete ends the
  session, nulling the ref being insufficient when it is reassigned every render. `scripts/drive.mjs` counts
  the POSTs.
- `foldWrite` merges only the queue's tail, so a fold cannot reorder anything dispatched, and never across
  ops — `update`+`delete` is refused, being the resurrection defect by another route. Plans are held as data
  so they can be inspected, and `create`/`update` always carry a list, so there is no single-row path to
  keep in step. Callers settle newest-first, the oldest rollback landing last as the only pre-batch
  snapshot; a batch is atomic, so one row deleted by hand mid-burst fails all of it.
- One write per edit session, the whole task in it: `TaskDetail` buffers a draft while Edit is on and writes
  on Done or on close. A partial payload blanks a cell, `parent_id` above all, and nothing is sent when the
  row is unchanged.
- The task sheets close before the write lands, so a failure needs its own toast — with the panel gone a
  rolled-back row is invisible. Settings waits: `saveConfig` has no optimistic half, and closing early
  shows a stale zone and countdown.
- Every failed write says so, `saveConfig`, `compact` and the seed included. `toast.failed` stands alone and
  never points at a notice: only terminal codes get one, `transient` is excluded, and `send` has already
  spent its retries.
- An open edit session is the evidence of unsaved text and reports `typing` for the whole of itself, a
  per-field report dropping the guard on every blur between fields. It holds off a service-worker reload and
  withholds both the FAB and the tab bar. The add-a-subtask field reports per-field, being outside any
  session — hence `typing` is a count, not a flag — and must release on unmount, React firing no blur for a
  focused input it removes.
- Ticking under a filter must not make a row vanish: ticking raises no toast, so a row that also leaves the
  list gives no feedback for the commonest gesture. `App` keeps the ids ticked since the filter was chosen
  in `shown`.
- `canEdit` is what renders, `hasKey` what the device can do. The read-only view toggle moves only the
  first, so an editor previewing the guest view keeps their key and the revoke control rather than a paste
  field; enabling or revoking clears the flag, or a freshly pasted link appears to do nothing. A rejected
  key is flagged, not deleted, or the device drops to view-only in silence. Neither is the security
  boundary — the endpoint refuses every keyless write, so never add a client check as enforcement or drop
  the server one.
- Open rows, just-ticked ids and which tab is up are session state, never `localStorage` — relaunching into
  twelve expanded rows is unreadable, and launching into the notes puts the board behind a tab nobody asked to
  be on. Locale, accent, filter and the read-only view are per-device.
- `withProgress` is memoised on today: the board is day-granular, and there is no millisecond clock to key
  it on.
- An open row starts read-only, `TaskDetail` owning the mode: live fields behind the commonest tap put a
  caret in a title one stray blur from a rename. Edit also gates every destructive control, while ticking
  and adding a subtask stay on the read path. The mode lives there because the component unmounts on close,
  so nothing has to reset it; `editing` is a prop, like `expanded`, so a static render sees the fields. The
  notes tab is the same shape, `NotesView` owning the mode and taking `editing` for the same reason.
- Notices are rendered once, above the tab switch, so they reach both destinations: a refused edit link is why
  the notes have no Edit button, and explaining that on the other tab explains nothing. So is the header —
  whose wedding, how many days and how much is done are facts about the board, not about a list.
- `BottomSheet`'s effect has an empty dep array and reads `onClose` through a ref. With `[onClose]` and
  inline arrows it re-ran on every parent render, and its `focus()` pulled focus off the field being typed
  in — on iOS that drops the keyboard mid-word.
- Refreshes on focus are throttled (30s floor); every read spends the owner's quota. The hash is stripped
  only when standalone, so *Add to Home Screen* records a URL still carrying the key, and
  `manifest.webmanifest` omits `start_url` for the same reason.
- The snapshot's version is a drop marker, never a migration. The service worker never touches a
  cross-origin request, as an explicit early `return` first in its `fetch` handler: scope decides which
  *clients* are controlled, not which *requests* are seen, so the token endpoint and the Sheets API both
  arrive there, and a worker answering either is an uncovered proxy in front of a bearer token.
- Nothing written to the sheet is localized, bar a seeded template's titles, content from then on.

## Conventions

One helper, one home. Export only what something outside the file uses. No design token may be named in
JSX.

| Owns | File |
| --- | --- |
| every `localStorage` touch (`readStored`/`writeStored`) | `config.js` |
| column names and every A1 range | `schema.js` |
| `CATEGORIES` | `templates.js` |
| every zone, and the layout of a day string — `monthOf`, `dayOfMonth`, `firstOfMonth` exist so nothing else indexes into `YYYY-MM-DD` | `time.js` |
| `ICON_SIZE`, so a glyph size is a name rather than literals at five call sites | `icons.jsx` |
| `BG_HEX`, `ACCENT_HEX` | `theme.js` |
| `run()`, the only mutation wrapper, and `fail()`, the only classifier | `useBoard.js` |
| the markdown grammar AND the toolbar's text transforms, both pure | `markdown.js` |
| the only done control / title-body-action block / wording of a date's nearness / task field markup / markdown → elements | `DoneToggle`, `Notice`, `DueLabel`, `TaskFields`, `Markdown` |

No new npm dependencies without a clear reason — one is also a CSP decision, and `test/lockfile.test.js`
pins the list. Add a host, update the CSP in `index.html`. Never put a real secret in a `VITE_` variable:
Vite inlines them into the shipped bundle.

### i18n

English and Japanese, no dependency; `src/i18n/` holds the engine, two catalogs and the registry. A module
singleton rather than a context, because render tests mount components bare and non-React modules need the
same `t`.

- Never hardcode a user-facing string in a component, `aria-label`, `title` and `placeholder` included.
  `test/i18n.test.js` fails on an unused key, a missing key and a bare literal in one of those attributes;
  a key built at runtime needs its own coverage test.
- Plurals go through `Intl.PluralRules`, never a `count === 1` ternary; `ja` has `other` alone.
- The pure layers stay pure: `time.js`, `progress.js`, `schema.js`, `templates.js` and `markdown.js` never
  read the
  singleton, and a test calling `setLocale` must restore it.
- An unknown category renders exactly as typed: the sheet is the source of truth, the catalog a courtesy.

### CSS

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. Single classes, no IDs,
no `!important`. Light theme only, mobile first, exactly one breakpoint (48rem) — `test/ui.test.jsx` pins
that as an exact set, so prefer a `clamp()`, a container query or `auto-fit` to a second. One centred column
at every width, capped at `--column-max`. Use the tokens; `var(--transition-fast|base)` collapse to ~0ms
under `prefers-reduced-motion`, so a hardcoded duration opts out silently. Meters are hand-rolled: flex plus
percentages, no library. Every rule carries its constraint as a comment.

**Colour**

- one coloured mark per row, following state, never the only channel. The hue is the dot beside `DueLabel`'s
  words, from the one `.dot--*` table, which has exactly two entries: `DueLabel` composes `dot--${state}`
  for `overdue` and `soon` alone, a state earning an entry only where its fill differs from `.dot`'s
  fallback.
- The category channel is shape, not colour: fourteen hues would make one row's mark carry two claims, so a
  category gets a monochrome glyph from `CATEGORY_ICONS`, leading the word and never replacing it —
  fourteen shapes is more vocabulary than anyone learns cold, and an English and a Japanese reader do not
  learn the same ones. An unknown category renders as typed with no glyph.
- The overdue chip's count is `--critical`, the one count that is not `--ink-3` (everything else there is a
  statistic), and is withheld at zero (`.chip__count--empty`) so a clean board carries no red 0.

Measured, and `npm run contrast` re-checks every pair:

| Pair | Measured | Rule |
| --- | --- | --- |
| `--ink-3` on an accent wash | not measured | forbidden — ~4.6:1 is no margin at 13px, and kanji at low contrast is unreadable in a way Latin is not. `check-contrast` measures `--ink` and `--ink-2` on every preset's wash and not `--ink-3`, because nothing may use it. The wedding plaque is the only rule consuming `--accent-wash` and its label and tally are `--ink-2` (6.74:1 worst case) |
| `--line-input` on surface / bg / sunken | 4.00 / 3.77 / 3.38 | WCAG 1.4.11's 3:1 on all three, `.chip` and `.btn--secondary` swapping their fill to `--sunken` on hover while keeping it |
| white type over `--photo-scrim`'s dense end, on a blown-out sky | 8.98:1 | the scrim is the contrast mechanism, the backdrop being unmeasurable; lightening the end stop fails AA |
| white OS status-bar glyphs over `--photo-scrim-top`, on a blown-out sky | 4.03:1 | the page owns that strip, so its glyphs are ours to make legible; 3:1, they being graphics |
| accent vs `--good` / `--critical`, in OKLab | tarn 0.198/0.202, pine 0.134/0.176, rosehip 0.260/0.128 | 0.15 is comfortable on `.dot--soon`'s 8px disc, so `tarn` is the only possible default |

- Whoever picks pine or rosehip accepts a `soon` dot they may not separate. Never add a preset without
  measuring it, and never mute `--good` to match the neutrals — at a muted `#35762f` the default falls to
  0.155. `--good` and `--critical` are signals, not theme.
- `make-icons.js` and `scripts/check-contrast.js` both parse `tokens.css` rather than restating it, or a
  retheme passes its own contrast check while measuring the previous colours. The icons are committed, so
  re-run `npm run icons` after changing the default. `index.html`'s inline favicon is the one copy that
  cannot be derived, and it, `RingsIcon` and `make-icons.js` all draw the two-rings mark — two
  interlocking rings under a diamond setting — and must not drift. The favicon and `RingsIcon` share the
  24-unit box, so those two are the same numbers; `make-icons.js` maps them into a 0–1 square and must
  keep every point inside the 0.4 radius Android crops a maskable icon to.

**Type**

- Four steps: 13 / 16 / 18 / 24, nothing below 13, and deliberately no 14 — the two are not distinguishable
  in a ui. Anything reaching for 14 is either a caption or body text; decide which.
- The notes document lives in 18 / 16 and never reaches `--fs-xl`, which is the hero title's and a row day's
  step and would compete with the header; its two heading levels separate on weight, ink and space instead,
  and there is no third because there is no fifth size. It is also the one place list markers are restored,
  `base.css` stripping them globally because a task list is structure — here a bullet is a bullet.
- Japanese is a first-class language here: `letter-spacing: 0`, no `text-transform`, and no `line-height`
  below 1.5 wherever text can be Japanese, everywhere but the hero percentage and including the couple's
  names. Uppercase belongs in js with `toLocaleUpperCase`, `text-transform` being a no-op on kana that
  would fire on the Latin half alone. A row's day does not go through `Intl` — `{ day: 'numeric' }` in `ja`
  returns `18日`, which wraps inside the 2rem column. Weights `400|500|600`.

**Tokens and controls**

- One value per idea. `--ring-width` and `--dim` each replaced a pair doing the same job in two files;
  `--space-hair` is the pill's 1px of optical padding, the one value off the 4px scale; `--sheet-height` is
  both sheet maxima. `--fs-label`, `--radius-xs`, `--good-wash`, `--neutral-wash`, `--meter-height-lg`,
  `--font-mono`, `--lh-flat`, `--fs-display` and the whole `--danger` family are gone: a red is a red, and
  `.btn--danger` names a destructive control.
- one tap target size, `--tap-target` (44px); `--tap-target-sm` is deleted. `.btn--sm` and `.swatch` both
  take the full 44px — smaller in type and padding is what makes them secondary. Every user of the old 36px
  floor was a thumb target.
- Never a form control below 16px: mobile Safari zooms on focus and will not zoom back. `textarea` has to be
  named in `base.css`'s two selector lists explicitly — WebKit's own default for one is ~13.3px monospace,
  under the type floor, in a face whose token was deleted, and under the zoom floor as well.
- `.textarea` owns no scroller and takes no `dvh` height: there is one document scroller, and
  `interactive-widget=resizes-content` shrinks `dvh` when the keyboard opens, which would resize the box under
  the caret on every focus. `NotesView` drives the height from `scrollHeight`, adding the border back because
  everything is `border-box`; the token is only the floor. Consequence: `preview.jsx` draws that field clipped,
  and `drive.mjs` is what checks it.
- `role="progressbar"`, never `role="meter"`: ARIA reserves `meter` for a gauge rather than a value
  advancing toward completion, and VoiceOver maps it patchily enough to lose the label and the value.
- `interactive-widget=resizes-content` is load-bearing with a sticky `.sheet__foot`, or Save sits under the
  keyboard.
- `overscroll-behavior-y: contain` on `html`: installed on iOS, pull-to-refresh is a reload, and a reload
  lands between a keystroke and a save. `setSafeToReload` covers the swap, not the gesture.
- `.input[type="date"]` must turn the platform appearance off, both spellings, prefixed first, or Safari
  sizes it from its own shadow tree and that intrinsic width is a floor `width: 100%` cannot lower — it
  draws past the right edge of a 252px row on a 320pt phone. `.tcard` must stay `overflow: visible` or the
  focus ring is cut; the two shadow selectors beside it restore the metrics removed; and 16px is the
  no-zoom floor, so narrowing the type is not an option.
- The card accordion is not animated: `height` and `max-height` are layout properties, a mount is not a
  transition, and `max-height` slips past the "never transition width/height" test while being exactly the
  thrash it forbids. The chevron carries the motion.
- An unsettled row dims its HEAD, never its tick — a tick that fades on contact reads as a tap that missed.
  Same for a checklist item: the title recedes, the glyph does not.

**The header, the tab bar and the FAB**

- `.hero` is `position: fixed`, not `sticky`: WebKit does not promote a sticky element to its own layer, so
  a later promoted element (`.chips`'s `mask-image`, row images) composites above it and the list draws over
  the photograph mid-flick. `.plan__month` is still sticky; the pairing is gone. The containing block is the
  viewport, so the horizontal safe-area insets repeat here. `.hero` also carries an opaque
  `background-color` as a backstop: the two bands fill its box between them, so it is never seen, and it is
  what guarantees no row can appear inside the header's own rectangle.
- `apple-mobile-web-app-status-bar-style` is `black-translucent`, and `position: fixed` is not sufficient
  without it. Under `default`, iOS owns the status-bar strip in an installed app and draws its own backdrop
  over the scrolling document there, so the list shows through above the photograph and no fixed element can
  cover it — the strip is not the web view's to paint. `black-translucent` hands it to the page,
  `env(safe-area-inset-top)` then reports the inset, and `--hero-photo`'s band already composes it.
- The glyphs are white as a consequence, and they sit on the picture. `--photo-scrim-top` is the wash that
  keeps them legible, at the alpha `--photo-control` is held to. Its extent is a multiple of `--safe-top`,
  so it is exactly zero without an inset; any constant added to it puts a dark band across the top of the
  photograph on every desktop and in every harness screenshot. `.hero__scrim` lists it above
  `--photo-scrim`, because one gradient reaching both ends darkens the middle, where the picture is.
- `--hero-height` is the header's whole occupied height and must be exact, a fixed header reserving no flow
  space. Four things offset by it: `.views`'s padding, `.plan__month`'s sticky `top`, `html`'s
  `scroll-padding-top` (or `scrollIntoView` leaves a focused field behind the photograph) and the notes bar's
  sticky `top`. Anything added to the header goes in that token.
- `--tabbar-height` is its mirror at the other end, named the same way — `--tabbar-row` is the row of buttons,
  the total adds `--safe-bottom` — and four things offset by that: `.views`'s bottom padding, the FAB, the
  toast stack and `html`'s `scroll-padding-bottom` (or a focused field behind the bar counts as visible).
  **Nothing else may compose `--safe-bottom`**, or the inset is counted twice and a dead strip appears under
  the last row. `test/ui.test.jsx` pins both compositions as exact strings.
- `.hero__progress` therefore renders always, even empty, or the padding overstates the header by the
  strip's height. What is withheld on an empty board is the meter; empty, the strip is the header's bottom
  rule, at a fixed `--hero-strip`.
- The strip sits outside the photograph because every measured meter figure is against opaque tokens, and a
  photograph is the one backdrop that cannot be measured; over the photograph the scrim carries the type
  instead (see the contrast table).
- `--hero-photo` is `clamp(4.5rem, 20vh, 14rem)`, about a fifth of the viewport, and at a fifth the band
  does hold faces — so `object-position: 50% 42%` frames them, and a change has to be looked at, at 393px
  and at the 48rem plate. The floor is deliberately small, two lines of type plus the inset, a `9rem` floor
  having given 44% of a landscape phone to the header. The inset is inside `.hero__photo`'s `height` calc.
- `.hero__gear` is anchored to the top of the picture, a centred control reading as floating at this
  height, and `.hero__text` reserves no clearance for it.
- The month heading is `position: sticky` with an opaque background, load-bearing because rows scroll under
  it. It sticks inside `.plan__group`, a flex column, so the next heading pushes it out; parks at
  `--hero-height`; keeps `z-index: 1` below `--z-header`; and its rule is `--line`, never a shadow. The
  wedding month's tint bleeds outward on a negative margin so month names stay in one column. `.notes__bar`
  is the same recipe, and sticky at the top rather than the bottom because a bottom-sticky bar lands on iOS's
  own keyboard accessory row.
- The header, the tab bar and the FAB are the only pinned chrome, and `.views` reserves all three below and
  above its content. The header and the bar share `--z-header`: they are at opposite ends and cannot overlap,
  so a `--z-tabbar` at the same number would be two names for one idea. Both sit under `--z-fab`, so a
  floating control wins wherever it does overlap, and under `--z-sheet`, so a modal scrim covers the bar
  rather than leaving it tappable.
- The bar is OPAQUE, with no wash and no `backdrop-filter`: every measured figure in `tokens.css` is against
  an opaque token and the two exceptions are the two places where a scrim IS the mechanism, a blur promotes a
  compositing layer (which is what cost `.hero` its `sticky`), and an `@supports` fallback is a second
  appearance nobody screenshots. Its inner column carries the horizontal insets, the bar itself being
  full-bleed: a fixed element's containing block is the viewport, so `body`'s insets do not reach it and a
  landscape notch would sit on the first tab.
- The selected tab has three channels — accent ink, a rule on the bar's own top edge, `aria-current` — and
  the word beside the glyph is a fourth. `<nav>` and `aria-current`, never `role="tablist"`: two thumb
  targets gain nothing from roving tabindex and arrow traversal, half that pattern is worse than none of it,
  and `aria-current` survives a static render.
- The FAB is on the plan tab only, and keeps the right-hand corner. Over two `flex: 1` tabs on a 393px screen
  a centred button covers the seam and a left-aligned one covers a tab's centre, so a reach for the second
  destination would open the new-task sheet; and a `+` on a document means nothing.
- Both are withheld while `typing` — the FAB does not move with the keyboard, and
  `interactive-widget=resizes-content` re-anchors the bar just above it, putting two ~196px targets on the
  accessory row, one mis-tap from abandoning an open editor. `.views` reserves their space regardless, CSS
  being unable to see the tab.
- `.view--bare` carries the top safe-area inset itself, the unconfigured screen rendering no header.
- No `-webkit-overflow-scrolling: touch` anywhere: a no-op since iOS 13 that breaks `position: sticky`
  inside the same scroller, which the month heading depends on.
- A subtask is never drawn in the sequence of dates — no date means no position. It is a row in its parent's
  checklist, reaching the parent as a `3/5` tally.

## Testing

`ui.test.jsx` reads the stylesheets as text, so its helpers strip comments, anchor whole selectors and
brace-count media blocks; each of those mistakes makes a test that always passes. More generally, **any
assertion about an absence must strip comments first** — every file here explains its rules by naming what
it forbids ("never `USER_ENTERED`", "no `--lh-flat`", "never `e.parameter`"), so a raw search matches the
prose and passes whatever the code does. `code()` in `ui.test.jsx` and `CODE` in `script.test.js` exist for
that.

`script.test.js` executes `Code.gs` and `sheets.test.js` drives the REST client against a fake that parses
A1 ranges for real, because both are the kind of code that succeeds while writing the wrong cell.
`connection.test.js` covers the mint, where every failure is invisible: `/exec` always answers 200, so a
rotated key reported as a blip hides behind retries forever, and the reverse sends somebody hunting for
their edit link. `markdown.test.js` covers the grammar and the three toolbar transforms, both pure, because
what they get wrong — a bare caret, a mixed run of lines, an unclosed `**` — is unreachable from a render.

- A static render never runs an effect and never fires a blur, so opening a card and every commit-on-blur
  path are invisible to `render.test.jsx` and to the harness. Every default must be correct alone — which is
  why `expanded` and `editing` are props — and the accordion, each commit path, the validation refusals and
  the keyboard's effect on a sheet are verified by driving the built app in a real browser.
- When fixing a bug, add the regression test. For progress arithmetic, the misleading case: all overdue and
  nothing done must report 0% and say it is behind.
- A passing suite does not mean it looks right. Screenshot through `scripts/harness.html`'s iframes, not a
  resized window: an iframe gets an honest viewport, headless Chrome reports a width you did not ask for.
  `to=` does not survive a headless capture, so a surface that only appears mid-scroll needs a preview page
  — `en-sign` is that, for the month tally, the wedding plaque and the `Today` line.
- `scripts/drive.mjs` covers what no static render can, over CDP: the accordion, the read/edit toggle,
  commit-on-blur, whether the date control stays inside its row, that ticking under a filter keeps the row
  on screen, that deleting a just-edited task sends one `delete` and no resurrecting `update`, and the notes
  tab — the switch, the field's grown height, a toolbar tap keeping its selection, the bar leaving while the
  keyboard is up, and one `config!B` write per session with none for an unchanged one. Its header records the
  three ways it can silently verify nothing, and that no optimistic state survives its millisecond fixture —
  so anything about that window must be pinned elsewhere. The fixture is `public/__dev-board.json`, gitignored
  under that name because the service worker precaches whatever reaches `dist/`, and its `config` is keyed the
  way the sheet is (`wedding_date`). Restart the stub between runs: it keeps its grid for the life of the
  process and the run deletes the only task with a checklist, so a second run comes back half zeroes that read
  exactly like a regression.
- The two safe-area insets are the only geometry no harness can show, both reporting 0px in an iframe and in a
  headless viewport: `drive.mjs` fakes each and asserts the band's and the bar's rects against them.

## Gotchas

README covers the Google setup, key rotation, deploying and the hero crop as procedure. These are the ones
that bite while editing code.

- Never run a bare `npm install`: `NPM_CONFIG_REGISTRY` points at an internal mirror, npm bakes that host
  into every `resolved` URL, and a repo `.npmrc` cannot outrank an env var. The result works locally and is
  `ENOTFOUND` everywhere else, reported only as "Exit handler never called!". Use
  `npm install --registry=https://registry.npmjs.org`; `test/lockfile.test.js` verifies.
- A deployment is pinned to a version, so editing `Code.gs` changes nothing live until a new one is
  deployed. Nothing detects that and nothing needs to, the script only reading and minting —
  `appsscript.json`'s scope is the exception, a stale one failing every write with a 403.
- The script must stay container-bound, or `getActive()` returns null and everything answers
  `misconfigured`.
- The scope must be `spreadsheets`, not `spreadsheets.currentonly`, and that is the price of the speed: the
  REST API rejects a token carrying only `currentonly`. The wide scope reaches every spreadsheet the owning
  account can see, container binding confining the script and not the token — so that account should own
  nothing else, a standing condition no code can enforce. It also needs a published consent screen: in
  Testing, authorization expires after 7 days and looks exactly like a quota problem.
- `vite.config.js` defaults `base` to `/wedding/` for project Pages; sets `test.env.VITE_SCRIPT_URL`, which
  `config.js` captures at module load; and in DEV only proxies two routes to `127.0.0.1:5200` —
  `/wedding/__endpoint` for `/exec` and `/wedding/__sheets` for the Sheets API, both needed because the app
  has two backends. `scripts/stub-endpoint.mjs` serves both over one in-memory grid, applying REST writes
  and serving `doGet` from the same rows. `VITE_SHEETS_BASE` is the only reason `sheets.js`'s base URL is
  overridable and must never be set in a shipped build.
- The board is world-readable by design. Nothing private goes in it.
