# Wedding

A static React app for planning a wedding, with a single Google Sheet as the database. A task is a
title, a day it is due, and a tick; a task with a checklist is measured by how much of it is ticked,
and one figure rolls that up across the whole plan.

**The site is public and looks it**: a planner opens the URL and gets a read-only board — no sign-in, no
password, no prompt, no dismissable gate. The two people planning the wedding open the same site with a
secret in the URL fragment, captured once and never needed again, so nobody ever types a credential.
[Setup](#setup) takes about five minutes; [CLAUDE.md](CLAUDE.md) holds the invariants that fail silently
when broken.

## How progress works

One place decides it, [`src/lib/progress.js`](src/lib/progress.js): done is 100%; otherwise a checklist
is how many of its items are ticked ("3 of 5 = 60%" is checkable by counting); otherwise **0%, whatever
the date says.**

| The tracker's three figures | |
| --- | --- |
| The hero percentage | the mean over **top-level** tasks, each counting equally — not by how many subtasks it was split into |
| `9 of 52 done` | the same fact as arithmetic anybody can redo |
| The mark on the meter | the share of due dates that have passed: where the fill would sit if everything had been finished on its day, so ahead of the mark is ahead of schedule |

**There is no "on schedule" sentence, and that is deliberate.** Work done and dates passed share a
denominator, so subtracting them looks like a pace — but two tasks a month late plus two future ones
finished early sum to zero, which would read "On schedule" with two things late. The graphic declines to
claim it; the overdue count states the fact alone, as a button that jumps to those rows.

## Subtasks

A task can hold a checklist, one level deep. A subtask is a title and a tick with **no date** — a date
wheel per item would make entering five on a phone unusable — so the editor renders no date field for
one, and none of them enters the overall percentage: a parent with ten would otherwise carry eleven
twentieths of a ten-task board.

**One level is enforced by the read.** A row is a subtask if its `parent_id` names a live row that is not
itself a subtask; anything that rule cannot place — a grandchild, a cycle, an orphan, an id naming
nothing, all reachable by hand-editing the sheet — is **promoted to a top-level task, never hidden**,
because a task vanishing from a wedding checklist is the worst thing this app could do.

**All-subtasks-done does not mark the parent done**, and nothing prompts for it: a derived "done" would
sit in the done count with an empty `done_at` cell and no answer to when it was finished. A 5/5 parent
reads 100% and stays open until a person closes it.

## One screen

**No tabs.** The photograph is the header, the tracker under it, the plan under that — one document
scroller. The FAB is the only fixed chrome, and the list reserves room for it so it can never cover the
last row.

- **The hero** (`public/hero.jpg`) carries the wedding date, the couple's names and the days left, in
  calendar days in the board's zone. A board that opens on a progress bar reads like a project tracker.
- **The plan** groups tasks by the month they are due in, because a plan is read forwards and a state
  grouping reshuffles the board whenever something is ticked. State slicing lives in the filter chips,
  the only place the per-state counts appear — there they are the control that acts on them.
- **The month heading is sticky and opaque**, which lets a row print a bare `18` rather than restating
  `APR` forty times. It also carries that month's own **`3/9` tally**, `aria-hidden`, because "am I done
  with April" is the unit wedding planning is done in and nothing else answers it; the wedding's own
  month says **`the day`**, once.
- **A `Today` line sits between two rows**, one per board and only when there are rows on both sides of
  it. It and both month figures are withheld while a filter is on: a slice of April is not April, and a
  list with holes in it cannot claim that everything below a line is still ahead.
- **A collapsed row** is a check, that day, the title, and — only when there is something to say — one
  quiet line: how near the date is, the `3/5` tally, the category. No bar: without a checklist a task is
  0% or 100%, which the tick already says.
- **Colour follows state, is never the only channel, and there is one coloured mark per row.** Nearness
  reads as words — `3 days ago`, `Today`, `in 5 days` — with a dot beside them taking its hue from one
  table, nothing at all past the fortnight, and never a tint on the day column.
- **Category is a glyph, never a colour** — a wallet for Budget, a pavilion roof for Venue, a steaming
  bowl for Food, monochrome, in front of the word. Category hues would make one mark carry two claims;
  a category the glyph table does not know prints as the bare word, with no fallback glyph.

**Opening a row reveals it. It does not arm it.** An open row starts read-only behind an **Edit** toggle,
which also gates every *destructive* control; ticking and adding an item stay on the read path. Tapping a
row is the hundred-times-a-week gesture and the editor has no Save button, so a live field under it would
be one stray tap from a renamed task.

**Editing is three fields and ONE write** — title, due date, category, buffered while Edit is on and sent
once on Done, or on the row closing mid-edit, which flushes rather than discards. Nothing is sent when the
row would be unchanged, and every write carries the *whole* row: the script rewrites a row from its
payload, so a partial one blanks `parent_id` and silently promotes a subtask.

**A task needs a day, and it is refused rather than defaulted.** The create sheet opens with the date
**blank** and Save refuses until somebody picks one: during entry the date is exactly what is not yet
known, and an invented one lands straight in the overdue count and the on-schedule mark. A subtask needs
none. A row already in the sheet with an empty `due` still renders, in a **No date** group at the foot of
the list — refusing to save a row is no reason to hide it.

**The accent is one of five presets**, indigo by default, per-device rather than in the sheet. The app's
mark is a two-peak ridgeline: `PeaksIcon`, the same shape rasterised into the Home Screen PNGs by
`scripts/make-icons.js` and drawn inline as `index.html`'s favicon. Those PNGs bake indigo in, so
changing the *default* accent means re-running `npm run icons`.

## Data model

One spreadsheet, two tabs — `tasks` and `config` — laid out in exactly one place,
[`src/schema.js`](src/schema.js). Row 1 is the header; data starts at row 2.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `title` | `Book the venue` | Required |
| C | `category` | `Venue` | Free text. A known value is translated for display; anything else renders exactly as typed |
| D | `due` | `2027-02-01` | The day it is due. Required on a task, empty on a subtask. No time — see below |
| E | `done_at` | `2026-06-01T18:02:11.004Z` | A timestamp here means done, and is 100% |
| F | `created_at` | `2026-08-07T…Z` | Stamped by the script, never by the browser |
| G | `updated_at` | `2026-08-07T…Z` | Same |
| H | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |
| I | `parent_id` | *(empty)* | This row's parent. Empty for a task, set for a subtask; see the promotion rule above |

**Row 1 is authoritative on the read, and the write repairs it.** Reads resolve every column by its *name*
in row 1, so an anonymous request can read a board whose header somebody reordered in the Sheets UI — and
an anonymous request must never cause a write. The first write after that puts the header back into the
order above, under the script's lock, carrying each value across by name and clearing the columns past the
list's width. Every write also forces its cells to plain text, so a note of `=SUM(A:A)` stays literal and
a date is never reformatted to the sheet's locale.

**A deployment older than the bundle is refused, not worked around.** A deployment is pinned to a version,
so the browser can be newer than the script — and an older script writes rows by looping its OWN column
list, silently dropping a field it has never heard of. Every read reports the columns the deployed script
knows, the client compares that against its **whole** list, and if anything is missing no write that
touches a task leaves the device. Reads still work, so nobody is locked out meanwhile.

**`due` is a calendar day, with no zone and no time.** It means that date on a calendar *at the wedding*:
whether it has passed is decided against the board's configured `timezone`, never the device's, because
"due on the 18th" must stop being due on the 19th at the venue. Everything downstream compares two day
strings, so the zone is used for exactly one thing — deciding today's date.
[`src/lib/time.js`](src/lib/time.js).

**Deletes are soft** — `deleted_at` is stamped and the row filtered out client-side — because a hard delete
shifts every row below it. Deleting confirms first and is reversible from the **Deleted** list in Settings
› Maintenance, beside the purge that empties it, which is the only hard delete. It **cascades to the
checklist** in the script, under one lock and in one reply: from the browser it would be N requests that
can half-fail. Restore is the exact inverse.

### `config` tab

Key/value pairs in columns A and B; a missing, blank or unparseable value falls back to the default in
[`src/config.js`](src/config.js).

| Key | Example | Notes |
| --- | --- | --- |
| `partner1_name` / `partner2_name` | `Aoi` / `Ren` | Shown over the hero photograph |
| `wedding_date` | `2027-04-18` | The countdown, the marked month in the plan, and what every template offset counts back from |
| `venue` | `Meguro Gajoen` | Free text |
| `timezone` | `Asia/Tokyo` | IANA name. The zone today's date is resolved in, which is what decides whether a due date has passed |
| `categories` | `Venue, Attire, Guests` | Comma-separated; an empty list never shadows the default |

Everything in this tab is shared. The interface **language**, the **accent**, the state **filter** and the
read-only view are per-device, in `localStorage`, and may never be written to the sheet: the couple and
their planners read one board, and none of them restyles anybody else's screen.

## Starter checklists

A fresh board offers two, and they are not translations of each other: a **twelve-month plan**, the
Anglophone countdown from The Knot's timeline — venue and guest list first, then vendors, stationery, the
run-up, 52 tasks — and a **Japanese eight-month plan**, the 結婚式準備 schedule from みんなのウェディング
and ゼクシィ: 両家挨拶 and 会場 first, then 打ち合わせ, 招待状, 引き出物, 席次表, 婚姻届, 38 tasks. Both
live in [`src/lib/templates.js`](src/lib/templates.js) as day offsets from the wedding date, so nothing
can be seeded until that date is set.

Seeding writes ordinary editable tasks, flat and with no checklists, and their titles are written in the
seeding device's language — the one place a per-device preference reaches the sheet, because a seeded
title is content from that moment on rather than a rendering of stored data.

## Access model

- **The security boundary is the endpoint, not the interface.** `doPost` refuses every write that does not
  carry the edit key, so a planner who reaches into the DOM and un-hides the controls gains nothing.
  `canEdit` decides what renders; it is not enforcement, and neither half may be dropped for the other.
- **The edit key is a bearer capability in a URL, and that is the cost of nobody typing a password.**
  `https://…/wedding/#k=<64 hex>` is captured into `localStorage` on first load, so anyone who gets the
  link can edit. [Rotation](#operations) is the only response, and it is one script property away.
- **It is a fragment, never a query string.** A fragment is not sent to the server, does not appear in
  GitHub's access logs and is not forwarded in a `Referer` header; `?k=` would leak into all three. The
  script never reads the key from `e.parameter` either — that lands in Google's own request logs.
- **A rejected key is flagged, not silently discarded**: the device says so and names the recovery, rather
  than dropping to view-only and leaving somebody wondering why saving stopped.
- **An editor can look at the guest's board.** *Switch to the read-only view* in Settings hides every
  editing control on that device and is remembered there; the edit key is untouched, so the way back is
  the same toggle. *Stop editing on this device*, the blunter control beside it, removes the key.
- **The fragment stays in the URL bar until the app is installed**, because an installed iOS web app gets
  its own storage bucket and *Add to Home Screen* has to record a URL still carrying the key.
  `manifest.webmanifest` omits `start_url` for the same reason.
- **The script cannot reach another file.** `spreadsheets.currentonly` is the confinement: unlike a
  standalone script holding the broad `spreadsheets` scope, this one is *incapable* of opening anything
  else, so there is no dedicated Google account and no "must own exactly one spreadsheet" condition.
- **`localStorage` is scoped to the origin, not the path**, so every other site published from the same
  GitHub Pages account can read the edit key. Knowingly accepted, and the reason nothing untrusted may be
  published from that account.
- **No third-party JavaScript runs at all.** `script-src 'self'`, `frame-src 'none'`, and `connect-src`
  naming only the two Apps Script hosts. `sheets.googleapis.com` is deliberately absent: the browser never
  holds a Google token, which is precisely why a view-only visitor needs no credential.
  `script.googleusercontent.com` is not redundant beside `script.google.com` — `/exec` 302s to it.
- **The board is world-readable.** The read endpoint is anonymous by design and the URL ships in a public
  bundle, so treat the guest list and the venue as public information.
- **Quota exhaustion is the one real attack, and it is unfixable.** Anonymous traffic bills the owner's
  Apps Script quota before any of our code runs, and Apps Script exposes no client IP. Impact is
  availability only: reads fail, the app falls back to its cached copy with a notice, and it self-heals
  when the quota resets — written down because every request failing forever as transient is otherwise
  indistinguishable from a bug.

## Cost

$0/month on permanent free tiers — nothing to cancel, no card on file, and no Google Cloud project at all,
because the script uses `SpreadsheetApp` rather than the Sheets REST API. Pages and Actions are free for
public repos, Apps Script is not billed, and the sheet is a rounding error on a Drive quota.

## Setup

Once, and about five minutes. **No Google Cloud project, no OAuth client, no API key, no consent screen
and no dedicated Google account**: the script talks to its own container through `SpreadsheetApp` rather
than to the Sheets REST API, so there is no API to enable and no consent screen to expire.

**1. Create the spreadsheet.** A **new, empty** one — not a file you already keep something in, and do not
add tabs: the app builds `tasks` and `config` on its first write, and `ensureStructure` refuses a file
that already has several of its own. Leave general access **Restricted**. Any Google account will do,
because the scope in step 3 confines the script to this one file.

**2. Generate the edit key.** `openssl rand -hex 32`. Keep it where both of you can reach it, like a
shared password manager: it is the only credential the app has and the only thing in front of a public
endpoint. It is never a build-time value and never goes in the repository.

**3. Create the script — from the sheet, not from `script.new`.** A container-bound script can use the
`spreadsheets.currentonly` scope, which is what makes it *incapable* of opening any other file. A
standalone script needs the broad `spreadsheets` scope, and `SpreadsheetApp.getActive()` would return
null, so every call would answer `misconfigured`.

1. In the spreadsheet: **Extensions › Apps Script**. Rename the project **Wedding board**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear) → tick **Show `appsscript.json` manifest file in editor**.
4. Back in **Editor**, replace `appsscript.json` with
   [`apps-script/appsscript.json`](apps-script/appsscript.json), which pins the scope to
   `spreadsheets.currentonly` and runs the web app as the owner with anonymous access.
5. **Project Settings → Script Properties → Add script property**: `APP_KEY`, with the key from step 2 as
   its value — a property rather than a literal, so the copy of the script in this repository holds no
   secret and stays diffable. There is no `SHEET_ID`: the script's container *is* the sheet.

**4. Deploy.** **Deploy → New deployment** → gear → **Web app**. Set **Execute as: Me** and **Who has
access: Anyone** — not "Anyone with a Google Account", because a planner opens this with no Google login
at all; that setting is what makes the board readable without a credential. **Deploy**, then authorize:
your account, **Advanced** → **Go to… (unsafe)** → **Allow**. It asks to see and edit *this spreadsheet*,
narrower than the usual "all your spreadsheets" prompt because of the scope above. Copy the **Web app
URL**, ending in `/exec`, and confirm it — which also proves what is most likely to be wrong:

```sh
URL='https://script.google.com/macros/s/…/exec'
KEY='…'

# The public read. No credential — this is what a planner's browser does.
curl -sSL "$URL"

# An authenticated write. It builds the two tabs on the first call, and a fresh
# board has nothing to compact, so that is all it does.
curl -sSL "$URL" -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"key\":\"$KEY\",\"op\":\"compact\"}"
```

The first answers `{"ok":true,"needsSetup":true,"tasks":[],"config":{},"schema":[…]}` before the tabs exist
and drops `needsSetup` afterwards; the second answers
`{"ok":true,"tasks":[],"config":{},"schema":[…],"sheetTimeZone":"Asia/Tokyo"}`. Every reply is HTTP 200 and
the body is the only signal — `{"ok":false,"error":"misconfigured"}` means the script is not bound to a
spreadsheet, so step 3 was done from `script.new`, and `{"ok":false,"error":"unauthorized"}` on the second
means `APP_KEY` does not match. Note `--data` with no `-X POST`: `/exec` answers with a 302, the redirect
has to be followed as a GET, and forcing the method breaks exactly that.

**5. Point the app at it.** Locally, `cp .env.example .env` (gitignored), paste the `/exec` URL, and
`npm run dev` serves <http://localhost:5173/wedding/>. For GitHub Pages, **Settings › Secrets and
variables › Actions › Variables** must hold `VITE_SCRIPT_URL`. It is a *variable*, not a secret: Vite
inlines it into the bundle, so it is public either way, and marking it secret would imply a
confidentiality the deployed site cannot provide. **Settings › Pages › Source** must be **GitHub
Actions** — under "Deploy from a branch" Pages publishes the repository tree verbatim and ignores the
artifact, and the tell is a 404 for `/src/main.jsx`.

**6. The two links.** Send the first to your planners: read-only, prompts for nothing, and looks like an
ordinary public page because it is one. Keep the second to yourselves and **treat it like a password** —
opening it once stores the key in that browser, and the edit controls appear from then on.

| Who | Link |
| --- | --- |
| Planners, family, anyone | `https://huangwaylon.github.io/wedding/` |
| You and your partner | `https://huangwaylon.github.io/wedding/#k=<the key from step 2>` |

**7. First run.** As an editor, set in **Settings**: both names, the **wedding date** (every starter
checklist counts its offsets back from it, so nothing can be seeded without it), and the **time zone** if
the wedding is not in `Asia/Tokyo`. Then pick a checklist, or start adding tasks. Tapping a task opens it
read-only; press **Edit** to change anything. **Add a subtask** needs no Edit, nor does ticking an item.

## Installing on a phone

Open the **edit link** (with `#k=…`) in Safari, **Share › Add to Home Screen**, then launch from the icon:
the key is captured, and the app clears the fragment from its own URL bar at that point. The trap is that
an installed web app has **its own storage, separate from Safari's**, so a key entered in the browser does
not carry across — which is why the fragment is deliberately left in the URL bar while you are still in
Safari, and why the manifest has no `start_url`: with one, iOS installs the manifest's URL and the
fragment is lost. A planner installs the plain link the same way and gets a read-only app.

## Operations

**Redeploying after a `Code.gs` change.** A deployment is pinned to a version, so pasting a new `Code.gs`
into the editor and saving changes **nothing** on the live board. Every time `apps-script/Code.gs` changes
here: replace `Code.gs` in **Extensions › Apps Script** and save, then **Deploy → Manage deployments** →
pencil → **Version: New version** → **Deploy**. The URL does not change, so nobody's link breaks. The app
notices when this has not been done and stops rather than guessing: the board says *"Saving is paused: the
spreadsheet's script is out of date"* and refuses every save, ticking included, because an older script
rewrites a row from the columns *it* knows, answers `ok: true`, and silently drops the rest. Reading still
works.

**Rotating the edit key.** The only incident response this design has — do it if a phone is lost, if the
link is forwarded by accident, or on any suspicion at all. Generate one with `openssl rand -hex 32`, edit
`APP_KEY` under Apps Script's **Project Settings → Script Properties**, and both of you open the new
`#k=…` link once: a key in the URL always beats the stored one, which is how a rotation reaches a device
still holding the dead one. No redeployment, because `APP_KEY` is read inside `doPost`. Rotation is
immediate and **total** — no per-device revocation, and a device on the old key drops to view-only and
says so.

**Recovering editing on a device.** If the edit controls are missing where they should not be — after
installing to the Home Screen, or after iOS evicts the storage of an app left unused — open **Settings**
and paste the edit link into **Paste your edit link**. Check first that the device is not simply in the
read-only view, which the same section toggles.

## Deploy

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm ci`, `npm
test`, build, upload a Pages artifact, deploy. It needs the two repository settings in step 5, each with
the tell for when it is wrong. `vite.config.js` sets `base` to `/wedding/`, because a project Pages site
serves from `/<repo>/`; rename the repo without updating it and the page is blank with console 404s for
`/assets/index-*.js`. Build with `VITE_BASE=/` for a user site or a custom domain — `scripts/build-sw.js`
reads the same variable, so the worker's scope follows.

**A round trip is a couple of seconds, and almost all of it is Google's floor**: the 302 that `/exec`
returns, plus script startup. The request is ~280 bytes and the reply about a kilobyte gzipped for a
52-task board, which the browser decodes in well under a millisecond — so the only lever that moves is
**how many round trips a burst of edits costs**, and that is where the work has gone.

Nothing waits for a save: writes are optimistic and the sheet closes at once, a failure rolling the row
back out and saying so in a toast. Settings is the exception, having no optimistic half. **A failure worth
retrying is retried before it becomes that toast** — the endpoint's first request after an idle spell
fails often enough that the alternative was the person holding the phone tapping Save twice, and every op
is written to be replay-safe so that is sound: `create` resolves the id the browser generated and rewrites
that row instead of appending a duplicate. Writes serialise
and **only the last one in flight may replace the board**, since every reply carries the whole board as of
that write — but an undispatched write is folded into the one behind it, so three ticks in a burst cost two
requests rather than three and five subtasks typed in a row cost three rather than five. Folding never
crosses an op boundary and never touches a request already in flight. A refresh is skipped while a write is
pending or overlaps one, and throttled to one per 30s on focus, because every read spends the owner's
quota.

Inside the script, cost is counted in Sheets service calls: one read of each tab per request, **the reply
composed from that read rather than a second one**, a cascade costing what one row does, and a batch
costing one read plus one write per run of consecutive rows. An update is seven calls in all, down from
eleven; a five-field Settings save is seven, down from nineteen. `scripts/stub-endpoint.mjs` prints the
count, and `test/script.test.js` pins it.

**A cold launch does no network work at all.** `scripts/build-sw.js` walks `dist/` and emits a service
worker precaching every file in it, and [`src/lib/snapshot.js`](src/lib/snapshot.js) keeps the last
successful read in `localStorage`, so with no network the real board still appears, behind a "showing saved
data" notice. Updates activate by reloading, which [`src/lib/serviceWorker.js`](src/lib/serviceWorker.js)
only does when no form is open and no write is in flight, and it calls `registration.update()` on
returning to the foreground because an installed iOS web app never navigates.

## Development

Do the Google setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/wedding.git
cd wedding
npm install --registry=https://registry.npmjs.org   # the explicit registry is load-bearing
cp .env.example .env   # paste the /exec URL of your web app
npm run dev
```

Scripts: `dev`, `build` (bundle into `dist/`, then generate `dist/sw.js`), `preview` (serve the built
`dist/`), `test` (vitest, single run), `test:watch`, `icons`, `contrast`. The service worker only exists in
a build, so testing it means `npm run build && npm run preview`.

**A green suite says nothing about whether the page looks right**, so `npx vite-node scripts/preview.jsx`
writes `scripts/preview-*.html` (gitignored) and `npm run contrast` measures every colour pair. Load the
previews through `scripts/harness.html`, which takes files, widths and a scroll-to selector on the query
string; use its iframes rather than a resized window, because headless Chrome reports a width you did not
ask for and every breakpoint reads wrong. Anything behind a click is invisible to a static render, so
`scripts/drive.mjs` drives the running app over the Chrome DevTools Protocol — the accordion, the
read/edit toggle, how many writes an edit session costs, whether the date control stays inside its row —
against `scripts/stub-endpoint.mjs`, a local endpoint that *executes the real `Code.gs`* over an in-memory
grid, so "did the date survive a round trip" has an answer without a deployment.

The hero is a derived crop and the camera original is gitignored. To replace it, drop a new photo in and
re-run the two `sips` passes recorded in [CLAUDE.md](CLAUDE.md).

## File map

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
| `scripts/` | `preview.jsx` + `harness.html` (the static visual harness), `drive.mjs` + `stub-endpoint.mjs` (drive the running app against the real `Code.gs`), `check-contrast.js`, `build-sw.js`, `make-icons.js` (a hand-rolled PNG encoder, so there is no native image dependency) |
