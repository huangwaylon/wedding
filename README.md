# Wedding

A static React app for planning a wedding, with a single Google Sheet as the database. A task has
a start and an end and its percentage advances on its own as time passes; a task with a checklist
is measured by how much of it is ticked instead. One figure rolls that up across the whole plan.

The point of the design is who can do what. **The site is public and looks it.** A wedding
planner opens the URL and gets a read-only board — no sign-in, no password, no prompt, no
dismissable gate. The two people planning the wedding open the same site with a secret in the
URL fragment, which is captured once and never needed again. Nobody ever types a credential.

Setup is in [SETUP.md](SETUP.md) and takes about five minutes; the invariants that fail
silently if broken are in [CLAUDE.md](CLAUDE.md).

## How progress works

Two numbers, deliberately kept apart, because conflating them would be this app's easiest way
to lie.

**What a task's bar shows** is decided in one place,
[`src/lib/progress.js`](src/lib/progress.js), by a three-step precedence:

1. **Marked done** pins it to 100%. This is the only step a person explicitly asserted, so it
   wins — somebody closing out a task with two items open is saying the rest turned out not to
   be needed.
2. **Otherwise, if it has a checklist**, the bar is how many subtasks are ticked. "3 of 5 = 60%"
   is a sentence you can check by counting.
3. **Otherwise the clock**: how much of the window between start and end has passed. It moves
   with nobody touching anything, which is the feature.

Nothing is blended. `0.5 × elapsed + 0.5 × ticked` would be a number nobody could reconstruct.

**A window that has run out unfinished reads 100% and is labelled Overdue.** Not a bug and not
hidden: the percentage is the clock, and the clock has finished. It is also exactly why the
headline is never alone on screen.

The overall tracker shows three things at once:

| | |
| --- | --- |
| The hero percentage | the mean over **top-level** tasks. Each counts equally — not by duration, not by how many subtasks it was split into — so "36%" is a number you can check by counting the cards |
| The mark on the meter | where that fill would sit if nothing were early or late. A task row with a checklist carries the same pair: the fill is work counted, the mark is where the clock has got to |
| Overdue / In progress / Upcoming / Done | the counts, which is why the verdict line reads "Behind: 8 tasks are past their date" rather than a percentage |

**Lateness has two sources and the verdict needs both.** For a task with no checklist, being
behind cannot be derived from the arithmetic at all: an overdue task counts 100% in the headline
*and* in the reference, so it cancels itself out of the subtraction. The overdue count is the
only evidence there is. A parent *with* a checklist breaks that tie, and usefully — its fill is
real work while its mark is elapsed time, so one trailing its own window pushes the pace
negative **while the deadline is still ahead**. Overdue is retrospective; that is not.

## Subtasks

A task can hold a checklist. One level of nesting, deliberately: a subtask is a title and a tick
with **no dates of its own**, because two date pickers per item would make entering five of them
on a phone unusable, and then nothing would ever get ticked.

**One level is enforced by the read, not by the write.** A row is a subtask if its `parent_id`
names a live row that is not itself a subtask. Anything that rule cannot place — a grandchild, a
cycle, an orphan whose parent was deleted, a `parent_id` naming nothing — is **promoted to a
top-level task, never hidden.** Someone editing the sheet by hand can reach all of those states,
and a task quietly vanishing from a wedding checklist is the worst thing this app could do.

**All-subtasks-done does not mark the parent done**, and nothing prompts for it either: a 5/5
parent reads 100% and stays open until a person closes it. A derived "done" would put a task in
the done count with an empty `done_at` cell and no answer to when it was finished.

Subtasks never enter the overall percentage. A parent with ten of them would otherwise carry
eleven twentieths of a ten-task board, so writing more detail about one task would deflate every
other. They move their parent's single share and nothing else.

## Views

**List**, grouped by the month a task starts in — a plan is read forwards, and grouping by state
reshuffles the whole list every time something is ticked, which loses the reader's place. State
slicing lives in the filter chips instead.

A task with a checklist grows one disclosure row showing `3 of 5 subtasks`, which expands the
list in place; a task without one adds no height at all, so a freshly seeded 52-task board looks
exactly as it did before the feature existed. **The whole subtask row is the tick target**, not
the circle at its end. The first item is added from the edit form, because a permanent add row on
every task would be three screens of height for a rare action.

**Timeline**, a Gantt. This is the view that earns its keep on a planner's large monitor: a list
cannot show whether two things overlap or where the gaps are. Bars are coloured by state with a
partial fill for progress, month gridlines let a bar's date be read off without looking back up
at the axis, and the axis stays put while the rows scroll. "Today" is the one place this chart
raises its voice — an accent rule with a label, because in a countdown-driven app that is the
most important thing on it.

**A subtask is never drawn as a bar.** It has no dates, so on a time axis it has neither a
position nor an extent, and a bar would assert a window the data does not contain. Two honest
marks instead:

- A parent with a checklist carries `3/5` under its title in the frozen gutter. This is what
  makes the bar readable: for a task with no checklist the fill ends exactly on the today rule by
  construction, so a parent whose fill stops short of that rule is genuinely behind — and the
  tally is what tells you the fill is a count rather than a clock reading.
- One **Subtasks** toggle in the axis corner reveals the items as their own rows, each drawing a
  1px rail spanning the parent's window — the only date fact the model holds about it. Tapping
  one opens the *parent's* detail sheet, where every title is listed in full.

**On a phone the timeline is built around three things a desktop Gantt gets for free.** The label
gutter is pinned, so panning to a later month does not take the task names with it. The axis is
pinned, so row thirty still has dates above it. And there is a **zoom** — at 1x a year compresses
into ~240px of visible plot, where a one-week task is 8px and bar length stops encoding anything,
so −/+ scale the plot from 1x to 8x while holding the date at the centre of the screen. Explicit
buttons rather than pinch: pinch inside an element means fighting Safari's own page zoom with a
non-passive listener, and it would collide with the tap that opens a task.

In timeline view the summary above collapses to a single band — there the chart is the subject,
and the full card pushed the Gantt off the screen.

## Data model

One spreadsheet, two tabs — `tasks` and `config` — laid out in exactly one place,
[`src/schema.js`](src/schema.js). Row 1 is the header; data starts at row 2.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `title` | `Book the venue` | Required |
| C | `category` | `Venue` | Free text. A known value is translated for display; anything else renders exactly as typed |
| D | `start` | `2027-01-04T00:00` | **Wall clock**, no zone — see below. Empty on a subtask |
| E | `end` | `2027-02-01T23:59` | Same. `23:59`, not the next midnight |
| F | `all_day` | `TRUE` | Display only: hides the clock times |
| G | `done_at` | `2026-06-01T18:02:11.004Z` | A timestamp here means done, and pins the task to 100% |
| H | `notes` | `call first` | Free text, stored literally |
| I | `owner` | `Ren` | Free text |
| J | `created_at` | `2026-08-07T…Z` | Stamped by the script, never by the browser |
| K | `updated_at` | `2026-08-07T…Z` | Same |
| L | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |
| M | `parent_id` | *(empty)* | The id of this row's parent. Empty for a task, set for a subtask; see the promotion rule above |

**`start` and `end` are wall-clock strings with no offset and no `Z`.** They mean that reading of
a clock *at the wedding*, resolved against the board's configured `timezone`. This is the one
non-obvious modelling decision and it is load-bearing: "the ceremony is at 14:00" has to say
14:00 to a planner working from another country, which a UTC instant rendered in the device's own
zone would not. The device's zone is never consulted for a task time. All the arithmetic, DST
included, is in [`src/lib/time.js`](src/lib/time.js).

Every write goes through the script with the cell forced to plain-text format, so a note of
`=SUM(A:A)` stays literal text and a date is never reformatted to the sheet's locale.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because a hard
delete shifts every row below it. Deleting asks for confirmation and is reversible from the
collapsed **Deleted** list. **Deleting a task cascades to its checklist**, in the script, under
one lock and in one reply: from the browser it would be N requests that can half-fail, leaving
some items tombstoned and some not. Restore is the exact inverse. The manual **purge** in
Settings is the only hard delete.

### `config` tab

Key/value pairs in columns A and B. A missing, blank or unparseable value falls back to the
default in [`src/config.js`](src/config.js).

| Key | Example | Notes |
| --- | --- | --- |
| `partner1_name` / `partner2_name` | `Aoi` / `Ren` | Shown in the header |
| `wedding_date` | `2027-04-18` | Drives the countdown, and every template offset counts back from it |
| `wedding_time` | `14:00` | Optional |
| `venue` | `Meguro Gajoen` | Free text |
| `timezone` | `Asia/Tokyo` | IANA name. The zone every wall-clock time on the board is read in |
| `categories` | `Venue, Attire, Guests` | Comma-separated; an empty list never shadows the default |

Everything in this tab is shared. The interface **language** and the **accent colour** are
per-device, in `localStorage`, and may never be written to the sheet — the couple and their
planners all read the same board, and none of them gets to restyle anybody else's screen or pick
a planner's language.

## Starter checklists

A fresh board offers two, and they are not translations of each other:

- **Twelve-month plan** — the Anglophone countdown, from The Knot's timeline: venue and guest
  list first, then vendors, stationery, the run-up. 52 tasks.
- **Japanese eight-month plan** — the 結婚式準備 schedule, from みんなのウェディング and ゼクシィ:
  両家挨拶 and 会場 first, then 打ち合わせ, 招待状, 引き出物, 席次表, 婚姻届. 38 tasks.

Both live in [`src/lib/templates.js`](src/lib/templates.js) as day offsets from the wedding date,
and seeding writes ordinary editable tasks — flat, with no checklists. Titles are written in the
seeding device's language, the one place a per-device preference reaches the sheet, deliberately:
a seeded title is content from that moment on rather than a rendering of stored data.

## Access model

**The security boundary is the endpoint, not the interface.** `doPost` refuses every write that
does not carry the edit key, so a planner who reaches into the DOM and un-hides the controls
gains nothing. Hiding them is a courtesy.

**The edit key is a bearer capability in a URL, and that is the cost of nobody typing a
password.** `https://…/wedding/#k=<64 hex>` is captured into `localStorage` on first load.
Anyone who gets that link can edit: a forwarded message, a screenshot of the address bar, a
shared screen. Rotation is the only response, and it is one script property away — see
[SETUP.md](SETUP.md).

**It is a fragment, never a query string.** A fragment is not sent to the server, does not appear
in GitHub's access logs, and is not forwarded in a `Referer` header. `?k=` would leak into all
three. The same reasoning is why the script never reads the key from `e.parameter`: a key in a
query string is written into Google's own request logs.

**The fragment stays in the URL bar until the app is installed**, because an installed iOS web
app gets its own storage bucket and *Add to Home Screen* has to record a URL that still carries
the key. `manifest.webmanifest` omits `start_url` for the same reason. See SETUP §7.

**The script is bound to the spreadsheet and cannot reach another file.** The
`spreadsheets.currentonly` scope is the confinement: unlike a standalone script holding the broad
`spreadsheets` scope, this one is *incapable* of opening anything else — so there is no standing
"this account must own exactly one spreadsheet" condition and no dedicated Google account.

**`localStorage` is scoped to the origin, not the path.** Every other site published from the
same GitHub Pages account can read the edit key. Knowingly accepted, and it means nothing
untrusted — in particular nothing loading third-party scripts — may be published from that
account.

**No third-party JavaScript runs at all.** `script-src 'self'`, `frame-src 'none'`, and
`connect-src` naming only the two Apps Script hosts. `sheets.googleapis.com` is deliberately
absent: the browser never holds a Google token, which is precisely why a view-only visitor needs
no credential. `script.googleusercontent.com` looks redundant next to `script.google.com` and is
not — `/exec` answers with a 302 to it.

**The board is world-readable.** The read endpoint is anonymous by design and the URL ships in a
public bundle, so treat the guest list and the venue as public information.

**Quota exhaustion is the one real attack, and it is unfixable.** Anonymous traffic bills the
owner's Apps Script quota before any of our code runs, and Apps Script exposes no client IP, so
no in-script throttle can help. Impact is availability only: reads fail, the app falls back to
its cached copy with a notice, and it self-heals when the quota resets. The tell is every request
failing with HTML replies classified as transient forever. Written down because the symptom is
otherwise indistinguishable from a bug.

**A deployment is pinned to a version, so the browser can be newer than the script.** An older
script writes rows by looping its own column list, silently dropping a field it has never heard
of — which is how a subtask once saved successfully and came back a top-level task. So every read
now reports the deployed script's columns, and their **absence** is the signal: the app says the
script is out of date, refuses the writes it cannot make safely, and withholds the add-subtask
field rather than invite a checklist that would be thrown away.

## Cost

$0/month on permanent free tiers — nothing to cancel, no card on file, and no Google Cloud
project at all, because the script uses `SpreadsheetApp` rather than the Sheets REST API. Pages
and Actions are free for public repos, Apps Script is not billed, and the sheet is a rounding
error against the owner's Drive quota.

## Deploy

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm ci`,
`npm test`, build, upload a Pages artifact, deploy. It needs two repository settings, both in
[SETUP.md](SETUP.md) with the tell for each when it is wrong.

`vite.config.js` sets `base` to `/wedding/`, because a project Pages site serves from `/<repo>/`.
Rename the repo without updating it and the page is blank with console 404s for
`/assets/index-*.js`. Build with `VITE_BASE=/` for a user site or a custom domain —
`scripts/build-sw.js` reads the same variable, so the worker's scope follows.

The app installs to an iOS Home Screen (**Share › Add to Home Screen**): the manifest declares
`display: standalone` and the PNG icons, and `index.html` carries the `apple-touch-icon` link and
the `apple-mobile-web-app-*` meta tags Safari still reads. Note the `start_url` omission above —
it matters for editors.

### Speed

**A round trip to the endpoint is ~2.1s for a read and ~3s for a write**, measured, and about
2.1s of that is Google's own floor: the 302 that `/exec` returns, plus script startup, plus one
full read of the sheet. Nothing can make a save fast, so nothing waits for one.

- **Writes are optimistic and the sheet closes immediately** — in 13ms, measured, rather than
  after the round trip. The row is already in the list behind the panel. A failure rolls it back
  out and says so in a toast, because with the panel gone there is nothing else to notice.
- **Writes are serialised, and only the last one still in flight may replace the board.** Every
  reply carries the whole board as of that write, so accepting an earlier one wipes out the later
  edits — ticking three subtasks in a burst measurably showed 3 of 3, then 2 of 3, then 3 again.
- **Two caches mean a cold launch does no network work at all.** `scripts/build-sw.js` walks
  `dist/` and emits a service worker precaching every file in it, and
  [`src/lib/snapshot.js`](src/lib/snapshot.js) keeps the last successful read in `localStorage`
  so `useBoard` paints from it before requesting anything. A launch with no network shows the
  real board with a "showing saved data" notice rather than an error screen.
- **Updates activate by reloading**, which [`src/lib/serviceWorker.js`](src/lib/serviceWorker.js)
  only does when no form is open and no write is in flight. It also calls `registration.update()`
  on returning to the foreground: an installed iOS web app resumed from the app switcher never
  navigates, so without that a new version could wait unactivated for weeks.
- **The script's own share is counted in Sheets service calls**, those being the round trips: a
  delete cascading to four subtasks went from 28 calls to 10 by stamping whole columns.

## Development

Do the Google setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/wedding.git
cd wedding
npm install --registry=https://registry.npmjs.org   # the explicit registry is load-bearing
cp .env.example .env   # paste the /exec URL of your web app
npm run dev
```

Scripts: `dev`, `build` (bundle into `dist/`, then generate `dist/sw.js`), `preview` (serve the
built `dist/`), `test` (vitest, single run), `test:watch`, `icons`. The service worker only exists
in a build, so testing it means `npm run build && npm run preview`.

**A green suite says nothing about whether the page looks right.** This app shipped an overall
tracker that said "On schedule" with eight tasks overdue, and only a screenshot showed it. So:

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
node scripts/check-contrast.js        # every colour pair, measured
```

Load those through `scripts/harness.html`, which takes files, widths, a scroll position and a
scroll-to selector on the query string and documents its own options. Anything behind a click or
a layout effect — the zoom, the pinned gutter, the subtask outline — is invisible to a static
render and has to be verified by driving the built app in a browser.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `apps-script/` | the whole backend: `Code.gs` and its manifest, deployed by hand |
| `src/schema.js` | the sheet contract: columns, row ↔ task mapping, validation |
| `src/config.js` | build-time values, storage keys, the `config` tab's field list, defaults |
| `src/App.jsx` | the shell: access, which surface is on screen, and every mutation's toast |
| `src/lib/` | `api` (every network call and the failure taxonomy), `access` (the capability URL), `time` and `progress` (both pure), `templates`, `snapshot`, `serviceWorker`, `theme` |
| `src/state/` | `useBoard` — one `run()` primitive behind optimistic CRUD, the serialised write chain, the out-of-date-script guard, throttled refresh — plus `useNow` and `useToasts` |
| `src/components/` | one file per view, with inline-SVG icons in `icons.jsx` |
| `src/i18n/` | the engine, the `en`/`ja` catalogs and the registry |
| `src/styles/` | `tokens`, `base`, `primitives`, `app`, loaded in that order |
| `test/` | vitest specs. Two cross the boundary to the backend: `schema.test.js` pins the column lists against each other, and `script.test.js` *executes* `Code.gs` against a fake Sheets service |
| `scripts/` | `preview.jsx` + `harness.html` (the visual harness), `check-contrast.js`, `build-sw.js` (importable, so its silent failure modes are tested), `make-icons.js` (a hand-rolled PNG encoder, so there is no native image dependency) |
