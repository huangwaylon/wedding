# Wedding

A static React app for planning a wedding, with a single Google Sheet as the database. A task is
a title, a day it is due, and a tick; a task with a checklist is measured by how much of it is
ticked. One figure rolls that up across the whole plan.

The point of the design is who can do what. **The site is public and looks it.** A wedding
planner opens the URL and gets a read-only board — no sign-in, no password, no prompt, no
dismissable gate. The two people planning the wedding open the same site with a secret in the
URL fragment, which is captured once and never needed again. Nobody ever types a credential.

Setup is in [SETUP.md](SETUP.md) and takes about five minutes; the invariants that fail
silently if broken are in [CLAUDE.md](CLAUDE.md).

## How progress works

**What a task is worth**, decided in one place — [`src/lib/progress.js`](src/lib/progress.js):
done is 100%; otherwise a checklist is how many of its items are ticked ("3 of 5 = 60%" is
checkable by counting); otherwise **0%, whatever the date says.** An unfinished task is
unfinished, and nothing on screen can be mistaken for progress that has not happened.

The tracker shows three things:

| | |
| --- | --- |
| The hero percentage | the mean over **top-level** tasks. Each counts equally — not by how many subtasks it was split into — so "36%" is a number you can check by counting the rows |
| `9 of 52 done` | the same fact as arithmetic anybody can redo. It replaced a one-line verdict, for the reason below |
| The mark on the meter | the share of due dates that have already passed. Where the fill would sit if everything had been finished on its day, so ahead of the mark is ahead of schedule |

**There is no "on schedule" sentence, and that is deliberate.** Work done and dates passed share a
denominator, so subtracting them looks like a pace — but two tasks a month late plus two future
tasks finished early sum to exactly zero, which read "On schedule" with two things late. A graphic
declines to make that claim; the overdue count states the fact on its own, as a button that takes
you to the rows in question.

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

## One screen

**There are no tabs.** The photograph is the header, the tracker is under it, and the plan is
under that — one scroll, and a tap on the status bar returns to the top. A two-tab bar cost 56px
of permanent chrome plus its safe-area inset on every screen to hold, on one side, a photograph
and a single card.

**The hero** (`public/hero.jpg`) carries the wedding date, the couple's names and the days left.
A board that opens on a progress bar reads like a project tracker.

**The plan** is every task as a row, grouped by the month it is due in. A plan is read forwards,
and grouping by state reshuffles the whole board every time something is ticked, which loses the
reader's place — state slicing lives in the filter chips, which are also the only place the
per-state counts appear, because there they are the control that acts on them.

**The month heading is sticky**, which is what lets a row print a bare `18` rather than restating
`APR` forty times. A collapsed row is a check, that day, the title, and — only when there is
something to say — one quiet line: how near the date is, the `3/5` tally, the category. There is no
bar on a row: without a checklist a task is 0% or 100%, which the tick already says.

**Opening a row reveals it. It does not arm it.** An open row starts read-only — the due date
spelled out, and the checklist — behind an **Edit** toggle that also gates every *destructive*
control. Ticking and adding an item stay on the read path, because both are doing the work rather
than changing the task. Tapping a row is the hundred-times-a-week gesture; retitling it happens
once, and the editor has no Save button, so a live text input under the common gesture is a stray
tap from a renamed task.

**Editing is three fields and ONE write.** Title, due date, category, buffered while Edit is on and
sent once on Done — or when the row is closed mid-edit, which flushes rather than discards. Per-field
commits cost one ~3s round trip *each*. Nothing is sent when the row would be unchanged, and every
write carries the *whole* row: the script rewrites a row from the payload it is given, so a partial
one would blank `parent_id` and silently promote a subtask.

**The due date is optional**, and the create sheet leaves it blank. Forcing one forces a wrong one —
during entry the date is exactly what is not yet known — and an invented date lands straight in the
overdue count and the on-schedule mark. A dateless task collects in its own group at the foot of the
list and asks nothing of anybody.

**Colour is never the only channel, and there is one coloured mark per row.** How near the date is
reads as words — `3 days ago`, `Today`, `in 5 days` — with a dot beside them taking its hue from one
table, and nothing at all past the fortnight. The day column is never tinted: a column a third of
whose entries are red stops being a column.

There is no Gantt chart. It earned its keep on a large monitor and cost a zoom ladder, a pinned
axis, a pinned label gutter and ~950 lines of CSS and component code to be usable on the phone this
app is actually read on.

## Data model

One spreadsheet, two tabs — `tasks` and `config` — laid out in exactly one place,
[`src/schema.js`](src/schema.js). Row 1 is the header; data starts at row 2.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `title` | `Book the venue` | Required, and the only required field |
| C | `category` | `Venue` | Free text. A known value is translated for display; anything else renders exactly as typed |
| D | `due` | `2027-02-01` | The day it is due. No time — see below. Optional; empty on a subtask |
| E | `done_at` | `2026-06-01T18:02:11.004Z` | A timestamp here means done, and is 100% |
| F | `created_at` | `2026-08-07T…Z` | Stamped by the script, never by the browser |
| G | `updated_at` | `2026-08-07T…Z` | Same |
| H | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |
| I | `parent_id` | *(empty)* | The id of this row's parent. Empty for a task, set for a subtask; see the promotion rule above |

There used to be a `start`, an `end`, an `all_day` flag, an `owner` and a `notes` column. Every one
of them was optional in practice and left empty on almost every row, and between them they made a
task something you filled in rather than something you wrote down — seven controls on a 393pt
screen, and a percentage that could read 100% for work nobody had done.

**A deployment older than the bundle is refused, not worked around.** A deployment is pinned to a
version, so the browser can be newer than the script — and an older script writes rows by looping
its OWN column list, silently dropping a field it has never heard of. Every read therefore reports
the columns the deployed script knows, the client compares that against its whole list, and if
anything is missing no write that touches a task leaves the device.

That check used to look at the **last** column only, which is sound while a list can only grow and
wrong the moment one is renamed: `due` replaced `end`, an un-redeployed script still had every other
column including the last, and so every write went through and dropped the date it was handed.
Reads from such a script fall back to `end`, so the board stays readable while it is redeployed.

**Moving an existing board onto this layout is automatic and happens once.** The read resolves
columns by NAME rather than position, so a board still on the old thirteen-column layout is read
correctly by anyone — including an anonymous planner, whose request must not cause a write. The
first *write* after that rewrites the grid in the new order under the script's lock, taking each
value by name, mapping the old `end` (the closing end of the window, which is what "due by" meant)
to `due`, and clearing the columns past the new width. `test/script.test.js` executes both halves.

**`due` is a calendar day with no zone and no time.** It means that date on a calendar *at the
wedding*, and whether it has passed is decided against the board's configured `timezone` — never
the device's. That is the one non-obvious modelling decision left and it is still load-bearing:
"due on the 18th" has to stop being due on the 19th at the venue, not at midnight wherever a
planner happens to be. Because everything downstream compares two day strings, the zone is used
for exactly one thing — deciding today's date — and there is no DST arithmetic left anywhere.
[`src/lib/time.js`](src/lib/time.js).

Every write goes through the script with the cell forced to plain-text format, so a note of
`=SUM(A:A)` stays literal text and a date is never reformatted to the sheet's locale.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because a hard
delete shifts every row below it. Deleting asks for confirmation and is reversible from the
collapsed **Deleted** list in Settings › Maintenance, beside the purge that empties it. **Deleting a task cascades to its checklist**, in the script, under
one lock and in one reply: from the browser it would be N requests that can half-fail, leaving
some items tombstoned and some not. Restore is the exact inverse. The manual **purge** in
Settings is the only hard delete.

### `config` tab

Key/value pairs in columns A and B. A missing, blank or unparseable value falls back to the
default in [`src/config.js`](src/config.js).

| Key | Example | Notes |
| --- | --- | --- |
| `partner1_name` / `partner2_name` | `Aoi` / `Ren` | Shown over the hero photograph |
| `wedding_date` | `2027-04-18` | Drives the countdown, and every template offset counts back from it |
| `venue` | `Meguro Gajoen` | Free text |
| `timezone` | `Asia/Tokyo` | IANA name. The zone today's date is resolved in, which is what decides whether a due date has passed |
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
- **One write per edit SESSION, not per field.** Committing each field as focus left it cost a full
  round trip each; three fields was ten seconds of the row flickering. The Edit toggle gave the
  session an end, so the draft goes out once.
- **The script's own share is counted in Sheets service calls**, those being the round trips: a
  delete cascading to four subtasks went from 28 calls to 10 by stamping whole columns, and an
  update is four — `ensureStructure` stopped spending a `getSheets()` on every save to learn
  something two name lookups answer. `scripts/stub-endpoint.mjs` prints the count per request.

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
built `dist/`), `test` (vitest, single run), `test:watch`, `icons`, `contrast`. The service worker only exists
in a build, so testing it means `npm run build && npm run preview`.

**A green suite says nothing about whether the page looks right.** This app shipped an overall
tracker that said "On schedule" with eight tasks overdue, and only a screenshot showed it. So:

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
npm run contrast                      # every colour pair, measured
```

Load those through `scripts/harness.html`, which takes files, widths and a scroll-to selector on
the query string and documents its own options.

Anything behind a click is invisible to a static render, so `scripts/drive.mjs` drives the running
app over the Chrome DevTools Protocol: the accordion, the read/edit toggle, how many writes an edit
session costs, and whether the date control stays inside its row. `scripts/stub-endpoint.mjs` gives
it a local endpoint by *executing the real `Code.gs`* over an in-memory grid — so "did the date
survive a round trip" has an answer without a deployment, and `--legacy` reproduces an
un-redeployed script. Both headers record the ways they silently verified nothing before they
worked.

The hero is a derived crop; the camera original is gitignored. To replace it, drop a new photo in
and re-run the two `sips` passes recorded in [CLAUDE.md](CLAUDE.md).

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `apps-script/` | the whole backend: `Code.gs` and its manifest, deployed by hand |
| `src/schema.js` | the sheet contract: columns, row ↔ task mapping, validation |
| `src/config.js` | build-time values, storage keys, the `config` tab's field list, defaults |
| `src/App.jsx` | the shell: access, the ticking clock, the filter, and every mutation's toast |
| `src/lib/` | `api` (every network call and the failure taxonomy), `access` (the capability URL), `time` and `progress` (both pure), `templates`, `snapshot`, `serviceWorker`, `theme` |
| `src/state/` | `useBoard` — one `run()` primitive behind optimistic CRUD, the serialised write chain, the out-of-date-script guard, throttled refresh — plus `useNow` and `useToasts` |
| `src/components/` | one file per view, with inline-SVG icons in `icons.jsx` |
| `src/i18n/` | the engine, the `en`/`ja` catalogs and the registry |
| `src/styles/` | `tokens`, `base`, `primitives`, `app`, loaded in that order |
| `test/` | vitest specs. Two cross the boundary to the backend: `schema.test.js` pins the column lists against each other, and `script.test.js` *executes* `Code.gs` against a fake Sheets service |
| `scripts/` | `preview.jsx` + `harness.html` (the static visual harness), `drive.mjs` + `stub-endpoint.mjs` (drive the running app against the real `Code.gs`), `check-contrast.js`, `build-sw.js` (importable, so its silent failure modes are tested), `make-icons.js` (a hand-rolled PNG encoder, so there is no native image dependency) |
