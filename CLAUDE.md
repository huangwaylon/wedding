# CLAUDE.md

Guidance for Claude Code working in this repository. For the data model, the access model
and the cost, see `README.md`; for the Google walkthrough, see `SETUP.md`. Do not restate
either here.

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Vite on port 5173 |
| `npm test` | vitest, single run. Must pass before any commit |
| `npm run build` | Production bundle into `dist/`, then `scripts/build-sw.js` emits `dist/sw.js` |
| `npm run preview` | Serve the built bundle |
| `npm run icons` | Regenerate `public/icons/*.png` |
| `npx vite-node scripts/preview.jsx` | Render the visual harness to `scripts/preview-*.html` |
| `node scripts/check-contrast.js` | Measure every colour pair. Run after any colour change |

## Invariants

These are the rules that prevent silent wrongness. Breaking one does not throw — it quietly
puts a misleading number on somebody's screen or the wrong thing in their spreadsheet.

**`src/schema.js` and `apps-script/Code.gs` both know the column layout, and they must
agree.** That duplication is unavoidable — the boundary between them is a network hop — and
it is the only such duplication in the repo. `test/schema.test.js` parses the `.gs` file and
fails the build when the two lists drift. Nothing else anywhere may name a column.

**`start` and `end` are WALL-CLOCK strings, resolved against the board's `timezone`.** Never
an instant, never the device's zone. "The ceremony is at 14:00" must read 14:00 to a planner
in another country. Every conversion goes through `src/lib/time.js`; no other file may build
a `Date` from a task's fields.

**Never `new Date('2027-04-18')`.** That parses as UTC midnight and renders as the 17th
anywhere west of Greenwich. Every `Date` in `time.js` is built from explicit parts, and to
*format* a wall clock you build the instant as if the parts were UTC and format with
`timeZone: 'UTC'` — formatting it in the board's zone would apply the offset twice.

**`wallToInstant` takes two offset samples and then verifies the result.** The offset has to
be sampled at the instant being solved for, so it guesses, re-solves, and then round-trips
the answer back to a wall clock. Without that check, a time inside a spring-forward gap
resolves *backwards* — 02:30 becomes 01:30, an hour earlier than anybody typed. Do not
"simplify" this to one lookup.

**An all-day window ends at 23:59, not at the next midnight.** A task due Friday must be
overdue on Saturday morning, not 99% complete. `endOfDay` is the only place this is decided.

**`percent` and `timePercent` are different claims and must not be merged.** `percent` is
what to draw (done → 100, else elapsed); `timePercent` is the elapsed fraction regardless of
done, and rolled up it is the on-schedule reference the meter's mark points at. A task whose
window ran out unfinished has `percent` of 1 while being emphatically incomplete, which is
why the roll-up always ships its counts alongside.

**`paceLabel` takes the overdue count, not just the pace.** `pace` can only ever be positive:
an overdue task counts as 100% elapsed in the headline *and* in the reference, so lateness
cancels out of the subtraction entirely. A version taking `pace` alone reported "On schedule"
for a board with eight tasks past their date. Overdue is the only hard evidence of lateness
there is — a task halfway through its window with no work done is not late, and this app
never asks anybody to estimate progress.

**Every task counts equally in the roll-up — never weighted by duration.** "36% of our tasks"
is a sentence somebody can check by counting. A duration-weighted mean silently makes a
six-month venue hunt worth thirty times the cake tasting and nobody can reconstruct it from
the screen.

**Never trust a cached row number.** Row positions shift whenever anyone edits the sheet
directly in the Sheets UI, so `updateTask` and `stampDeleted` re-resolve id → row immediately
before writing.

**Every mutation holds a script lock.** Two people on two phones can save at the same moment,
and without `LockService` two simultaneous appends resolve the same "next" row and one
silently overwrites the other.

**Cells are formatted as plain text BEFORE values are written, never after.** With the default
format, `setValues` parses `"2027-04-18T14:00"` into a Date and the sheet's locale then decides
what comes back out. `textCell` additionally escapes a leading `=`, `+`, `-` or `@` with an
apostrophe, because `setValue` parses those as formulas whatever the number format says — a
note of `=SUM(A:A)` would otherwise become a live formula.

**Deletes are soft, confirmed, and reversible.** `deleted_at` is stamped and the client
filters, so rows never change position and a restore is one cell write. Every delete goes
through `ConfirmDeleteSheet`, and recovery is the collapsed `DeletedList` — not a toast,
because a toast that has timed out is a delete nobody can undo. That is why no toast in this
app carries a button. `compact()` is the only hard delete, and it must issue its `deleteRow`
calls in **descending** order or earlier deletions shift the indices of later ones.

**`doGet` never writes.** It is anonymous, so an anonymous request must not be able to cause
a write. A spreadsheet with no `tasks` tab answers `needsSetup: true`; an editor's first
write builds the structure.

**Neither `doGet` nor `doPost` may throw.** An uncaught throw returns Google's HTML error
page, which the client classifies as *transient* and retries — so a throw on the reject path
becomes a silent retry loop. Never read `e.parameter` for the key either: a key in a query
string lands in Google's request logs.

**The endpoint always answers HTTP 200.** `ContentService` cannot set a status, so
`{"ok":false,"error":"unauthorized"}` arrives as a 200 and the body is the only signal.
Branch on the body, never on `response.ok`. `unauthorized` is **terminal**; a non-JSON reply,
a rejection and a timeout are **transient**, because Google's HTML error page is the common
non-JSON case and it recovers. Getting this backwards either logs an editor out over a hiccup
or hides a rotated key behind retries forever.

**The POST is `Content-Type: text/plain`, and the method is never forced through the
redirect.** `text/plain` keeps it a CORS simple request; a preflight would be answered with
the 302 that `/exec` returns and die, which is also why the script has no `doOptions`.
`fetch` downgrades POST to GET across that 302 and Apps Script serves the computed reply from
the echo URL — forcing POST through the hop returns "page not found".

**The read carries a cache-buster in the query string, and the edit key never can.** `/exec`
is served through Google's cache, so a planner reloading after an edit would be handed the
previous board. The two facts are the same fact from opposite ends: a fragment never reaches
the server, which is why the key lives in one and the cache-buster cannot.

**A rejected key is FLAGGED, not deleted.** Deleting it drops the device silently to
view-only and the next person to notice is whoever wondered why their edits stopped saving.

**`canEdit` decides what renders; it is not the security boundary.** The endpoint refuses
every keyless write, so hiding controls is a courtesy. Do not add client-side checks as if
they were enforcement, and do not remove the server-side one because the UI already hides the
button.

**The hash is stripped only when running standalone.** In Safari it must stay, so that *Add to
Home Screen* records a URL still carrying the key — an installed web app has its own storage
bucket. `public/manifest.webmanifest` omits `start_url` for the same reason. Adding one breaks
editor installs on iOS and nothing will fail loudly.

**Refreshes on focus are throttled.** One sheet, no push channel, and every read spends the
owner's Apps Script quota, hence the 30s floor — do not remove it.

**Nothing written to the sheet is localized, with exactly one deliberate exception.** Config
values, column names and timestamps are language-independent, because the couple and their
planners may read the UI in different languages. The exception is a seeded template's task
titles, which are written in the seeding device's language: a seeded title is *content* from
that moment on, editable and never re-rendered, so it is not a localized view of stored data.

**Per-device vs per-sheet.** The locale, the accent and the list filter live in
`localStorage`; the names, dates, venue, timezone and categories live in the sheet's `config`
tab. Neither preference may ever be written to the sheet — nobody gets to restyle anybody
else's screen or choose a planner's language.

**The snapshot's `v` is a drop marker, never a migration.** An unrecognised version is ignored
and re-fetched, which is free — the sheet is the source of truth. It stores the **pre-merge**
config, because a merged copy freezes the building build's defaults into every later launch.
`clearSnapshot` must reset the module's "last payload written" memo, or the next write is
convinced it already saved.

**The service worker never intercepts a cross-origin request**, and that is an explicit early
`return` as the first statement of the `fetch` handler, not a property of scope — scope decides
which *clients* are controlled, not which *requests* are seen, so the Apps Script endpoint
arrives there. A `<meta>` CSP does not cover a worker's own context and Pages sends no CSP
header, so a worker responding to those would be an uncovered proxy in front of the edit key.

**Precache from a `dist/` walk, and derive the cache name from file contents.**
`.vite/manifest.json` is not emitted without a flag, and when it is, it omits `index.html`
itself and everything copied from `public/`. Hashing names rather than contents would leave
`sw.js` byte-identical after an `index.html`-only change — a CSP edit, for instance — so the
update would never reach the device. `caches.match` needs `ignoreVary: true`: Pages sends
`Vary: Accept-Encoding` and `vite preview` sends `Vary: Origin`, and a mismatch misses and
falls through to the network, which offline means a cache that silently only works online.

**`sheets.googleapis.com` must not appear in the CSP.** The browser never holds a Google
token; that is precisely why a view-only visitor needs no credential. If you find yourself
adding that host, the architecture has changed and README's security model is no longer true.
`test/ui.test.jsx` pins its absence.

**There is no migration code, and no users to need it.** Anything justified only by "keeps an
existing sheet working" has been removed. Do not add a back-compatibility branch for a shape
this app never shipped.

## Conventions

- **Plain modern JavaScript, ESM.** No TypeScript. `.jsx` only for files containing JSX.
- **No new npm dependencies** without a clear reason. The bundle is React plus application
  code; icons are inline SVG in `src/components/icons.jsx`, the Gantt is CSS grid, and the
  PNG encoder in `scripts/make-icons.js` exists so there is no native image dependency. A new
  dependency is also a CSP decision, and `test/lockfile.test.js` pins the dependency list.
- **If you add a host, update the CSP** in `index.html`. It is a deliberate allowlist.
- **Never put a real secret in a `VITE_` variable.** Vite inlines them into the shipped
  bundle. The one existing variable is public by design.
- **Comments explain *why*, not *what*.** Match the existing density — the non-obvious
  constraint gets a comment; the obvious line does not. Do not narrate the history of a
  refactor in a comment.
- **One helper, one home.** `readStored`/`writeStored` in `src/config.js` are the only
  `localStorage` touches; every column name lives in `schema.js`; `CATEGORIES` in
  `templates.js` is the only category list; `time.js` is the only file that resolves a zone.

### i18n

English and Japanese, no dependency. `src/i18n/` holds the engine (`index.js`), the two
catalogs (`en.js`, `ja.js`) and the registry (`catalogs.js`).

- **Never hardcode a user-facing string in a component.** That includes every `aria-label`,
  `title` and `placeholder`. `test/i18n.test.js` scans `src/` and fails on a catalog key
  nothing references, a referenced key no catalog has, and a bare string literal in one of
  those three attributes.
- **A key built at runtime needs its own coverage test.** The scan cannot see
  `` t(`state.${state}`) `` or `` t(`category.${name}`) ``, so each family is asserted against
  its source list (`STATE`, `CATEGORIES`, `TEMPLATE_IDS`, `ACCENTS`) instead.
- **A category the catalog has never heard of renders exactly as typed.** The sheet is the
  source of truth and the catalog is a courtesy on top of it.
- **It is a module singleton, not a context.** `render.test.jsx` renders components bare, and
  non-React modules need the same `t`. A provider would break the first and be unreachable
  from the second.
- **`useT()` uses `useSyncExternalStore` with the third argument.** Omitting
  `getServerSnapshot` throws under `renderToStaticMarkup`, which is how every render test
  runs. `useAccent()` has the same requirement.
- **Plurals go through `Intl.PluralRules`, never a `count === 1` ternary.** A pluralised value
  is an object keyed by CLDR category, and it is the only case where a catalog value is not a
  string. `en` supplies `one`/`other`; `ja` supplies `other` alone, because that is what
  `Intl.PluralRules('ja')` reports.
- **The pure layers stay pure.** `time.js`, `progress.js`, `schema.js` and `templates.js`
  never read the singleton; locale arrives as an argument with an English default.
- **A test that calls `setLocale` must restore it** in `afterEach`, or the state leaks into
  other files.

### Charts

The meter and the Gantt are hand-rolled — no charting library. `Meter` is a track, a fill and
one tick; `Timeline` is CSS grid plus percentages.

- **The meter's hairline is load-bearing.** `--track` is 1.34:1 against the card and cannot
  reach 3:1 while staying a warm neutral, so the *boundary* identifies the bar. Delete it and
  an empty meter is invisible — 0% reads as "there is no meter here".
- **The on-schedule mark is ink with a 2px ring in the surface colour**, which is what keeps
  it legible whether it crosses the fill or the bare track. It must never be given a hue of
  its own; no single colour clears both backgrounds.
- **State colour is never the only channel.** A badge is a wash plus an *ink* label and a
  coloured dot; `--good` and `--critical` are fills only. One of them cannot clear 4.5:1 on
  white, and a viewer with any form of colour vision has to read the same thing.
- **There is no `--warning`.** "In progress" is the accent and "upcoming" is the bare track,
  so no state needs a hue that cannot clear 3:1 on white — which is what yellow would have
  forced.
- **The timeline colours by STATE, not by category.** State is what somebody scans a timeline
  for, and a second categorical encoding on the same mark would put two palettes in one
  chart. Category stays in the list, as text.
- **The meter fill is never transitioned.** It advances on its own once a minute, and an
  animation makes it look like a control responding to a tap.
- **Run `node scripts/check-contrast.js` after any colour change.** Every value in
  `tokens.css` carries its measured ratio in a comment; the script is what produced them.

### CSS

Four files, loaded in order by `src/main.jsx`: `tokens.css` (custom properties), `base.css`
(reset, typography), `primitives.css` (generic `.card`, `.btn`, `.input`, `.meter`, `.sheet`,
…), `app.css` (app-specific layout).

- **Light theme only.** There is no dark block. State is stated in words, never in hue alone.
- **An accent preset is three custom properties**, redefined under `[data-accent]` in
  `tokens.css`. `--accent-ring` and `--accent-shadow` derive from `--accent` with
  `color-mix`, so a preset never restates the accent's channels and can never reach the
  neutrals or the state colours. Every preset keeps white text ≥7.5:1 on the accent and
  ≥6.8:1 against `--bg`; measured values sit beside them. The selector is attribute-based
  rather than `:root`-scoped so a settings swatch can paint its own colour.
- **Use the tokens.** In particular use `var(--transition-fast|base)` rather than a hardcoded
  duration — the tokens collapse to ~0ms under `prefers-reduced-motion`, so hardcoding
  silently opts out of that support.
- **`letter-spacing: 0` and no `text-transform`, anywhere text can be Japanese.** Tracking
  inserts a gap between every kana (「このつき」 becomes 「こ の つ き」) and `uppercase` is a
  no-op on kana. The lone carve-out is `.overall__percent`, which renders digits exclusively.
- **No line-height below 1.5** on anything that can hold Japanese; CJK glyphs fill the em box.
  `--lh-flat: 1` is the single carve-out, same element, same reason.
- **Nothing below 13px.** Weights are `400|500|600` only.
- **Tabular figures in columns, proportional for the hero.** `tabular-nums` gives every digit
  the width of a `0`, which makes a large standalone number look loose. `.tnum` is for the
  per-row percentages and the axis, not for `.overall__percent`.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below that and will
  not zoom back out.
- **Shadows appear in exactly four places** (sheet panel, toast, FAB, segmented thumb) and
  never on hover. Cards are a white plane plus one hairline; the temperature step from `--bg`
  to `--surface` is the elevation. The focus ring is also drawn with `box-shadow`, which is a
  ring, not an elevation.
- **`--line-input` is deliberately darker than `--line`.** WCAG 1.4.11 wants 3:1 for the
  boundary identifying a control, and `--line` on white does not come close.
- **`.btn--icon` is not combined with `.btn--ghost`.** They disagree about the border, and the
  glyph at `--ink-2` is itself the 3:1 graphic.
- Mobile-first. One column, capped at `--column-max` from `48rem`, two columns at `62rem`; the
  sheet becomes a centred dialog at `48rem` too. **There is no third breakpoint** and
  `test/ui.test.jsx` pins that.
- **Timeline view opts out of the two-column grid** via `.shell--wide`: a Gantt wants the full
  width, and a 23rem aside beside it leaves the bars unreadable. Its label gutter narrows
  below `48rem`, because 15rem of labels on a 390px screen leaves no room for the bars.
- **Every layout keeps `--fab-size` of clearance below its content.** Dropping that reservation
  is how the FAB lands on top of the last row's delete button.
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`. Twelve files: `time`, `progress`, `schema`,
`templates`, `access`, `api`, `snapshot`, `sw-build`, `i18n`, `render`, `ui`, `lockfile`.

`api`, `snapshot`, `sw-build` and `access` all exist for the same reason: their failure modes
are invisible. A misclassified endpoint reply logs an editor out or hides a rotated key; a
snapshot that seeds tasks without their config renders the countdown against the wrong zone;
an incomplete precache list makes `install` reject so no worker ever activates and the app is
simply never fast; a truncated edit key stored as if valid produces an `unauthorized` that
looks exactly like a rotation. None of that shows up in a build or on screen.

`schema.test.js` holds the only cross-boundary check in the repo — the `Code.gs` column list
against `schema.js` — and it is the one test most worth keeping green.

`render.test.jsx` and `ui.test.jsx` render components to static markup and read the
stylesheets as text — no DOM, no browser. They catch components that throw on a real prop
shape or silently drop data, and CSS invariants a build cannot see. A focus trap or a
`scrollIntoView` call cannot be tested this way; do not fake a DOM to try.

Note that both stylesheets and the generated worker are heavily commented, and several
comments *name the thing they forbid*. Any "nothing anywhere does X" assertion must strip
comments first — `test/ui.test.jsx` has `code()` and `test/sw-build.test.js` has
`withoutComments()` for exactly that.

When fixing a bug, add the regression test. When changing progress arithmetic, the test that
matters most is the misleading case: a board where every task is overdue and nothing is done
must report 100% *and* say it is behind.

**A passing suite does not mean it looks right.** This app shipped an overall tracker reading
"On schedule" with eight tasks overdue, and a timeline whose Japanese month labels overlapped
into a smear. Both suites were green; only a screenshot showed either.

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
```

Load those through `scripts/harness.html?f=preview-en.html&w=390,430,768` and screenshot;
`scripts/accents.html` shows all five presets side by side. **Use iframes, not a resized
window** — an iframe gets its own viewport so container and media queries resolve honestly,
while headless Chrome quietly reports a different width than you asked for and every
breakpoint reads wrong. Note that the FAB is `position: fixed`, so inside a short iframe it
floats over the middle of the list; that is a harness artifact, not a layout bug.

## Gotchas

- **Never run a bare `npm install` on a machine with a private registry.** This repo is
  developed where `NPM_CONFIG_REGISTRY` points at an internal Apple mirror, and `npm install`
  bakes that host into every `resolved` URL in `package-lock.json`. The result works locally
  and fails everywhere else with `getaddrinfo ENOTFOUND`, which npm reports only as the
  useless "Exit handler never called!". A repo `.npmrc` cannot prevent it — npm ranks env vars
  higher. Always regenerate with an explicit override, which `test/lockfile.test.js` then
  verifies:

  ```sh
  rm -rf node_modules package-lock.json
  npm install --registry=https://registry.npmjs.org
  ```
- **The script must stay container-bound.** `spreadsheets.currentonly` only works for a script
  created from the spreadsheet via *Extensions › Apps Script*. From `script.new` it fails and
  `SpreadsheetApp.getActive()` returns null, so every call answers `misconfigured`. Going
  standalone means widening the scope to `spreadsheets`, which reaches every sheet the account
  can see, and README's security model would need rewriting.
- **`vite.config.js` defaults `base` to `/wedding/`** to match the repo name, because project
  Pages sites serve from `/<repo>/`. Renaming the repo without updating it produces a blank
  page. Build with `VITE_BASE=/` for a custom domain; `scripts/build-sw.js` reads the same
  variable.
- **`vite.config.js` sets `test.env.VITE_SCRIPT_URL`.** `config.js` captures it at module
  load, so a test cannot stub it afterwards, and without it `test/api.test.js` would only ever
  exercise the "no endpoint" branch.
- **The board is world-readable and that is the design.** Do not put anything private in it,
  and do not add a feature that assumes otherwise.
