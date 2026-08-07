# Wedding

A static React app for planning a wedding, with a single Google Sheet as the database.
Every task has a start and an end, and its percentage advances on its own as time passes;
one figure rolls that up across the whole plan.

The point of the design is who can do what. **The site is public and looks it.** A wedding
planner opens the URL and gets a read-only board — no sign-in, no password, no prompt, no
dismissable gate. The two people planning the wedding open the same site with a secret in
the URL fragment, which is captured once and never needed again. Nobody ever types a
credential.

Google Cloud setup is in [SETUP.md](SETUP.md) and takes about five minutes; the invariants
that fail silently if broken are in [CLAUDE.md](CLAUDE.md).

## How progress works

Two numbers, deliberately kept apart, because conflating them would be this app's easiest
way to lie.

**A task's percentage is where the clock has got to** between its start and its end. It
moves on its own, with nobody touching anything — that is the feature. Marking a task
**Done** pins it to 100%.

**A window that has run out unfinished reads 100% and is labelled Overdue.** That is not a
bug and it is not hidden: the percentage is the clock, and the clock has finished. It is
also exactly why the headline figure is never alone on screen.

The overall tracker therefore shows three things at once:

| | |
| --- | --- |
| The hero percentage | the mean of every task's percentage. Every task counts **equally** — not weighted by duration, so "36%" is a number you can check by counting |
| The mark on the meter | where that fill would sit if nothing had been finished early. The gap between the two is work done ahead of schedule |
| Overdue / In progress / Upcoming / Done | the counts. **Overdue is the only hard evidence of lateness there is**, which is why the verdict line reads "Behind: 8 tasks are past their date" rather than a percentage |

Being *behind* cannot be derived from the arithmetic: an overdue task counts as 100%
elapsed in both the headline and the reference, so lateness cancels itself out of the
subtraction. Nor can it be inferred from an in-flight task — one halfway through its window
with no work done is not late, and this app never asks anybody to estimate how far along
something is. So the overdue count decides it.

## Views

**List**, grouped by the month a task starts in. Grouped by month rather than by state
because a plan is read forwards, and a state grouping reshuffles the whole list every time
something is ticked off, which loses the reader's place. State slicing lives in the filter
chips instead.

**Timeline**, a Gantt. This is the view that earns its keep on a planner's large monitor: a
list cannot show whether two things overlap or where the gaps are. Bars are coloured by
state with a partial fill for progress, month gridlines let a bar's date be read off without
looking back up at the axis, and the axis itself stays put while the rows scroll. "Today" is
the one place this chart raises its voice — an accent rule with a label, because in a
countdown-driven app that is the most important thing on it. It scrolls horizontally on a
phone rather than compressing a year into 280px, and takes the full window width from 768px
up.

In timeline view the summary above it collapses to a single band. There the chart is the
subject and the summary is context, and the full card pushed the Gantt off the screen.

## Data model

One spreadsheet, two tabs — `tasks` and `config` — laid out in exactly one place,
[`src/schema.js`](src/schema.js). Row 1 is the header; data starts at row 2.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `title` | `Book the venue` | Required |
| C | `category` | `Venue` | Free text. A known value is translated for display; anything else renders exactly as typed |
| D | `start` | `2027-01-04T00:00` | **Wall clock**, no zone — see below |
| E | `end` | `2027-02-01T23:59` | Same. `23:59`, not the next midnight |
| F | `all_day` | `TRUE` | Display only: hides the clock times |
| G | `done_at` | `2026-06-01T18:02:11.004Z` | A timestamp here means done, and pins the task to 100% |
| H | `notes` | `call first` | Free text, stored literally |
| I | `owner` | `Ren` | Free text |
| J | `created_at` | `2026-08-07T…Z` | Stamped by the script, never by the browser |
| K | `updated_at` | `2026-08-07T…Z` | Same |
| L | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |

**`start` and `end` are wall-clock strings with no offset and no `Z`.** They mean that
reading of a clock *at the wedding*, and they are resolved against the board's configured
`timezone`. This is the one non-obvious modelling decision and it is load-bearing: "the
ceremony is at 14:00" has to say 14:00 to a planner working from another country, which a
UTC instant rendered in the device's own zone would not. The device's zone is never
consulted for a task time. All the arithmetic is in [`src/lib/time.js`](src/lib/time.js),
DST included.

Every write goes through the script with the cell forced to plain-text format, so a note of
`=SUM(A:A)` stays literal text and a date is never reformatted to the sheet's locale.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because a
hard delete shifts every row below it. Deleting asks for confirmation and is then one cell
write, reversible from the collapsed **Deleted** list. The manual **purge** in Settings is
the only hard delete.

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

Everything in this tab is shared. The interface **language** (English or Japanese) and the
**accent colour** are per-device, in `localStorage`, and may never be written to the sheet —
the couple and their planners all read the same board, and none of them gets to restyle
anybody else's screen or pick a planner's language.

## Starter checklists

A fresh board offers two, and they are not translations of each other:

- **Twelve-month plan** — the Anglophone countdown, from The Knot's timeline: venue and
  guest list first, then vendors, stationery, the run-up. 52 tasks.
- **Japanese eight-month plan** — the 結婚式準備 schedule, from みんなのウェディング and
  ゼクシィ: 両家挨拶 and 会場 first, then 打ち合わせ, 招待状, 引き出物, 席次表, 婚姻届. 38
  tasks.

Both live in [`src/lib/templates.js`](src/lib/templates.js) as day offsets from the wedding
date, and seeding writes ordinary editable tasks. Titles are written in the seeding device's
language, which is the one place a per-device preference reaches the sheet — deliberately,
because a seeded title is content from that moment on rather than a rendering of stored
data.

## Access model

**The security boundary is the endpoint, not the interface.** `doPost` refuses every write
that does not carry the edit key, so a planner who reaches into the DOM and un-hides the
controls gains nothing. Hiding them is a courtesy.

**The edit key is a bearer capability in a URL, and that is the cost of nobody typing a
password.** `https://…/wedding/#k=<64 hex>` is captured into `localStorage` on first load.
Anyone who gets that link can edit: a forwarded message, a screenshot of the address bar, a
shared screen. Rotation is the only response and it is one script property away — see the
end of [SETUP.md](SETUP.md).

**It is a fragment, never a query string.** A fragment is not sent to the server, does not
appear in GitHub's access logs, and is not forwarded in a `Referer` header. `?k=` would leak
into all three.

**The fragment stays in the URL bar until the app is installed.** An installed iOS web app
gets its own storage bucket, separate from Safari's, so a key captured in the browser does
not carry across. Leaving the fragment in place is what lets *Add to Home Screen* record a
URL that still carries it — and it is why `public/manifest.webmanifest` deliberately has no
`start_url`, since with one iOS installs the manifest's URL instead of what is on screen.
Once running standalone the fragment is cleared. Settings has a paste-the-link field as the
recovery path if any of that fails.

**The script is bound to the spreadsheet and cannot reach another file.** It is created from
the sheet via *Extensions › Apps Script*, which is what makes the
`spreadsheets.currentonly` scope possible. That scope is the confinement: unlike a
standalone script holding the broad `spreadsheets` scope, this one is *incapable* of opening
anything else, so there is no standing "this account must own exactly one spreadsheet"
condition to maintain and no dedicated Google account to create.

**`localStorage` is scoped to the origin, not the path.** Every other site published from
the same GitHub Pages account can read the edit key. Knowingly accepted, and it means
nothing untrusted — in particular nothing loading third-party scripts — may be published
from that account.

**No third-party JavaScript runs at all.** `script-src 'self'`, `frame-src 'none'`, and
`connect-src` naming only the two Apps Script hosts. `sheets.googleapis.com` is deliberately
absent: the browser never holds a Google token, which is precisely why a view-only visitor
needs no credential. `script.googleusercontent.com` looks redundant next to
`script.google.com` and is not — `/exec` answers with a 302 to it.

**The board is world-readable.** The read endpoint is anonymous by design, and the URL ships
in a public bundle, so treat the guest list and the venue as public information. Nothing
here is a place for anything private.

**Quota exhaustion is the one real attack, and it is unfixable.** Anonymous traffic bills the
owner's Apps Script quota before any of our code runs, and Apps Script exposes no client IP,
so no in-script throttle can help. Impact is availability only: reads fail, the app falls
back to its cached copy with a notice, and it self-heals when the quota resets. The tell is
every request failing with HTML replies classified as transient forever. Nobody has a motive
to do this to one couple's checklist, so it is accepted rather than engineered against — but
written down here, because the symptom is otherwise indistinguishable from a bug.

## Cost

$0/month on permanent free tiers — nothing to cancel, no card on file, and no Google Cloud
project at all.

| Thing | Cost |
| --- | --- |
| GitHub Pages, GitHub Actions | Free for public repos |
| Apps Script | Not billed. Quotas are rate limits, and a planning board never approaches them |
| Storage | The sheet counts against the owner's Drive quota — a few hundred rows of text is a rounding error |

No Cloud project is needed because the script uses `SpreadsheetApp` rather than the Sheets
REST API, so there is no API to enable — and therefore no OAuth consent screen to keep
published, which is the step most likely to break a setup like this a week later.

## Deploy

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm
ci`, `npm test`, build, upload a Pages artifact, deploy. Two things must be set once in the
repository settings.

**Settings › Pages › Source** must be **GitHub Actions**. Under "Deploy from a branch" Pages
publishes the repository tree verbatim and ignores the artifact; the tell is a 404 for
`/src/main.jsx`, the dev-only script tag in the source `index.html`.

**Settings › Secrets and variables › Actions › Variables** must hold `VITE_SCRIPT_URL`. It
is read at build time, so a run predating it ships an empty string and the app reports
itself unconfigured.

`vite.config.js` sets `base` to `/wedding/`, because a project Pages site serves from
`/<repo>/`. Rename the repo without updating it and the page is blank with console 404s for
`/assets/index-*.js`. Build with `VITE_BASE=/` for a user site or a custom domain —
`scripts/build-sw.js` reads the same variable, so the service worker's scope follows.

The app installs to an iOS Home Screen (**Share › Add to Home Screen**):
`public/manifest.webmanifest` declares `display: standalone` and the PNG icons, and
`index.html` carries the `apple-touch-icon` link and the `apple-mobile-web-app-*` meta tags
Safari still reads. Note the `start_url` omission above — it matters for editors.

### Launch speed

Two caches, and between them a cold launch does no network work at all. This matters more
here than in most apps: every read is a round trip to an Apps Script web app, which is well
over a second even warm.

`npm run build` runs `scripts/build-sw.js`, which walks `dist/` and emits a service worker
precaching every file in it. The list comes from the tree rather than Vite's
`.vite/manifest.json`, which omits `index.html` and everything copied from `public/`. The
cache name hashes file *contents*, not names, because `index.html` is not in the JS module
graph — a name-derived id would leave `sw.js` byte-identical after a CSP edit and the change
would never reach the device.

`src/lib/snapshot.js` keeps the last successful read in `localStorage`, and `useBoard` paints
from it before requesting anything. A launch with no network therefore shows the real board
with a "showing saved data" notice rather than an error screen.

Updates activate by reloading, which `src/lib/serviceWorker.js` only does when no form is
open and no write is in flight. It also calls `registration.update()` when the app returns to
the foreground: an installed iOS web app resumed from the app switcher never navigates, so
without that a new version could wait unactivated for weeks.

## Development

Do the Google setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/wedding.git
cd wedding
npm install --registry=https://registry.npmjs.org
cp .env.example .env   # paste the /exec URL of your web app
npm run dev
```

The explicit registry is not decoration: a bare `npm install` behind a private mirror bakes
internal hosts into every `resolved` URL in `package-lock.json`, which works locally and
fails on a GitHub runner. `test/lockfile.test.js` fails the build if it happens.

Scripts: `dev`, `build` (bundle into `dist/`, then generate `dist/sw.js`), `preview` (serve
the built `dist/`), `test` (vitest, single run), `test:watch`, `icons` (regenerate the PNG
app icons). The service worker only exists in a build, so testing it means `npm run build &&
npm run preview`.

**A green suite says nothing about whether the page looks right.** The sibling app shipped an
invisible white-on-white chart with every test passing; this one shipped an overall tracker
that said "On schedule" with eight tasks overdue, and only a screenshot showed it.

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
node scripts/check-contrast.js        # every colour pair, measured
```

Load the preview files through `scripts/harness.html?f=en&w=390,430,768` and screenshot; add
`&scroll=0.35` to see the timeline part-way down its own scroll container. **Use the iframes
it builds, not a resized window** — an iframe gets its own viewport so container and media
queries resolve honestly, while headless Chrome quietly reports a different width than you
asked for and every breakpoint reads wrong.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `vite.config.js` | Pages base path, React plugin, vitest config |
| `apps-script/` | the whole backend: `Code.gs` and its manifest, deployed by hand |
| `public/` | `manifest.webmanifest` and the PNG app icons, copied verbatim into `dist/` |
| `src/schema.js` | the sheet contract: columns, row ↔ task mapping, validation |
| `src/config.js` | build-time values, storage keys, the `config` tab's field list, defaults |
| `src/lib/api.js` | every network call, and the failure taxonomy |
| `src/lib/access.js` | the capability URL: who may edit, and how that is decided |
| `src/lib/time.js` | wall clock ↔ instant in an IANA zone; formatting; pure |
| `src/lib/progress.js` | what a percentage means, and the roll-up; pure |
| `src/lib/templates.js` | the two starter checklists |
| `src/lib/snapshot.js` | the launch cache: last successful read, kept on the device |
| `src/lib/serviceWorker.js` | registration, and when it is safe to activate an update |
| `src/lib/theme.js` | the accent presets |
| `src/state/` | `useBoard` (one `run()` primitive behind optimistic CRUD, throttled refresh), `useNow`, `useToasts` |
| `src/i18n/`, `src/components/`, `src/styles/` | engine and `en`/`ja` catalogs; one file per view with inline-SVG icons; `tokens`/`base`/`primitives`/`app` in that order |
| `test/` | vitest specs, including the `Code.gs` ↔ `schema.js` column pin |
| `scripts/preview.jsx`, `scripts/harness.html` | the static-HTML visual harness; the harness takes files, widths and a scroll position on the query string |
| `scripts/check-contrast.js` | the palette's measured contrast pairs |
| `scripts/build-sw.js` | walks `dist/` and emits the service worker; importable, so its silent failure modes are tested |
| `scripts/make-icons.js` | hand-rolled PNG encoder for the app icons; no native dependency |
