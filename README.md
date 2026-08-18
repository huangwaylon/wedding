# Wedding

A static React app for planning a wedding, with a single Google Sheet as the database. Two tabs: a
**Plan** — a task is a title, a day it is due, a tick and optionally the day it starts, and a task can
hold a one-level checklist, with one figure rolling the whole thing up — and **Notes**, one shared
markdown document for what has been decided.

Anyone with the URL gets a read-only board — no sign-in, no prompt. The two people planning open the
same URL with a secret in the fragment (`#k=…`), captured once into `localStorage`, and get editing.
[Setup](#setup) takes about fifteen minutes; [CLAUDE.md](CLAUDE.md) holds the code-level invariants.

## Architecture

| | |
| --- | --- |
| Hosting | GitHub Pages, static bundle, no server of our own |
| Stack | Vite + React 19, plain ESM JavaScript, vitest; no runtime dependency but `react`/`react-dom` |
| Database | one Google Spreadsheet, tabs `tasks` and `config` |
| Backend | a container-bound Apps Script web app over that spreadsheet, plus the Sheets REST API |

Two backends, chosen by whether the device holds an edit key:

- **Read (anonymous)** — `doGet` on the Apps Script `/exec` URL, no credential.
- **Editor** — `doPost` mints a Google access token for a request carrying `APP_KEY`; the browser then
  reads and writes `sheets.googleapis.com` directly, re-minting about once an hour.

The split is latency: `/exec` costs 1.0–1.6s before the script runs a line (a 302 hop plus a container
start), the Sheets API ~0.24s. The read stays in the script because a minted token cannot be made
read-only — `ScriptApp.getOAuthToken()` returns the script's own authorization, which can write.
`src/lib/api.js` dispatches, `connection.js` caches the token, `sheets.js` is the REST client.

## Behaviour

- **Two tabs, one header.** A bottom bar switches between the plan and the notes; the photograph, the
  countdown and the progress strip span both, being facts about the board rather than about a list. A
  launch always opens on the plan. Both the bar and the **+** button get out of the way while anything
  is being typed.
- **Progress** ([`src/lib/progress.js`](src/lib/progress.js)): done is 100%, otherwise a task with a
  checklist is the share of its items ticked, otherwise 0%. The header percentage is the mean over
  top-level tasks, each counting equally; the mark on the meter is the share of due dates that have
  passed. There is no pace figure — the overdue count stands alone, as a button that jumps to those rows.
- **Notes** is one document everybody sees, opening rendered and read-only; the pencil button in the
  corner starts an editing session, which is a plain field plus four buttons — heading, bullet list,
  bold, italic — and Done. Markdown is deliberately small: headings, bullet and numbered lists,
  `**bold**`, `*italic*`, `[label](https://…)`, a pasted URL, a newline being a line break. No images,
  no tables, no HTML, and no scheme but `http`/`https` — anything else is shown as the characters that
  were typed. A link opens in a new tab, which is also how an installed app avoids replacing the board
  with a page it has no Back button from. One write per editing session, on Done. The document lives in
  one `config` cell, so [the access model](#security-model) applies to it unchanged.
- **Subtasks** are one level deep, carry no date, and do not enter the overall percentage; their
  parent's `3/5` tally does. Tapping one ticks it — unless its text holds a URL, where the tick is the
  circle and the words are a link. Adding one is behind the row's **Edit**. A row whose `parent_id`
  cannot be placed one level under a live task is shown as a top-level task, never hidden.
  All-subtasks-done does not mark a parent done.
- **A task needs a day.** Create opens with the date blank and Save refuses without one. A row already
  in the sheet with an empty `due` still renders, in a **No date** group.
- **A start date is optional**, and the one thing that can say a task is already yours to be doing: a
  task whose start day has arrived and which is not finished is lifted into **This month**. It has a
  clear button, because a date wheel on a phone offers no way back to blank.
- **The two dates are edited in the order they happen** — the day it starts, then the day it is due —
  and each label says which it is, `optional` or `required`, rather than leaving it to be discovered
  when Save refuses.
- **An open row is read-only** behind an **Edit** toggle, which also gates the destructive controls and
  the add-a-checklist-item field; ticking does not. Read mode states one thing, the day it starts, and
  only when it has one. One edit session sends one write, on Done or on close.
- **Two sections come before the calendar:** **Past deadline** — anything overdue and unfinished — and
  **This month**, which holds everything dated inside the current month plus anything already begun
  whose date is still to come. Both disappear when empty, and a task is in one place only, the first
  that claims it; the heading says which month it is about. Below them, **tasks are grouped by month**,
  and the current month is never listed twice, every one of its rows being in a section above.
  **Every row carries its own date, month over day, in one column** — the same shape in a section as
  under a month heading, so nothing has to be read against the heading above it. The year is the one
  part it leaves out, and a row adds it wherever nothing else on screen supplies one: not the heading,
  which names a year for every month it heads, and not the calendar the reader is living in. Whole-group
  tallies are withheld while a filter is on.
- **Per-device, in `localStorage`, never in the sheet:** language (English/Japanese), accent (`tarn`
  default, `pine`, `rosehip`), the state filter, the read-only view toggle.
- **A cold launch does no network work:** `scripts/build-sw.js` emits a service worker precaching
  `dist/` and `src/lib/snapshot.js` keeps the last successful read, so the board appears offline behind
  a "showing saved data" notice.
- **Writes are optimistic** and retry 429/5xx before failing with a toast that rolls the row back;
  Settings waits instead. Refresh on focus is throttled to one per 30s.

## Data model

Defined in one place, [`src/schema.js`](src/schema.js). Row 1 is the header, data starts at row 2, and
an editor's first write builds both tabs.

### `tasks`

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `title` | `Book the venue` | Required |
| C | `category` | `Venue` | Free text; a known value is translated for display, anything else renders as typed |
| D | `due` | `2027-02-01` | Calendar day. Required on a task, empty on a subtask. No time |
| E | `done_at` | `2026-06-01T18:02:11.004Z` | A timestamp here means done, and 100% |
| F | `created_at` | `2026-08-07T…Z` | Stamped by the browser on create, then read back off the row so a retried write cannot restamp it |
| G | `updated_at` | `2026-08-07T…Z` | Stamped by the browser on every write |
| H | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |
| I | `parent_id` | *(empty)* | Empty for a task, the parent's `id` for a subtask |
| J | `start` | `2027-01-15` | Optional calendar day work on it begins. Empty on a subtask, and on any task that does not need one |

- **Reads resolve columns by name** in row 1, on both sides of the wire, so a header reordered in the
  Sheets UI still reads correctly; the read never writes. An editor's next write restores the order
  above, carrying each value across by name, and touches nothing past the last column.
- **Appending a column is a Pages deploy, not an Apps Script one:** the browser holds the column list
  and does every write, so a stale script serves only a slightly older read, resolved by name.
  `appsscript.json`'s scope is the exception — see [Operations](#operations). `start` was appended this
  way: a sheet built before it is widened by the next editor write, with the column empty on every
  existing row, and until `Code.gs` is redeployed a reader simply does not see it.
- **Writes use `valueInputOption: RAW`** and both tabs are built with the plain-text number format, so
  `=SUM(A:A)` stays literal and a date is never reformatted to the sheet's locale.
- **`due` is a calendar day**, no zone and no time; whether it has passed is decided against the
  board's configured `timezone`, never the device's. [`src/lib/time.js`](src/lib/time.js).
- **Deletes are soft**, so no row ever moves. Deleting confirms first, cascades to the checklist in one
  `values:batchUpdate`, and is reversible from **Deleted** in Settings › Maintenance. **Purge deleted
  tasks** is the only hard delete.

### `config`

Key/value pairs in columns A and B, shared by every device. A missing, blank or unparseable value
falls back to the default in [`src/config.js`](src/config.js).

| Key | Example | Notes |
| --- | --- | --- |
| `partner1_name` / `partner2_name` | `Aoi` / `Ren` | Shown over the hero photograph |
| `wedding_date` | `2027-04-18` | The countdown, the marked month, and what template offsets count back from |
| `venue` | `Meguro Gajoen` | Free text |
| `timezone` | `Asia/Tokyo` | IANA name; the zone today's date is resolved in |
| `categories` | `Venue, Attire, Guests` | Comma-separated; an empty list falls back to the 14 defaults |
| `notes` | `# Venue⏎- Booked` | The whole Notes document, markdown, in one cell. Multi-line; a Sheets cell holds 50,000 characters and the app refuses a longer one rather than letting the write fail |

One cell per key, and a save writes only the keys it is changing — which is what lets a document share
this tab with the settings without a lock. Emptying `notes` by hand is a legitimate way to clear it.

### Starter checklists

Two, in [`src/lib/templates.js`](src/lib/templates.js), stored as day offsets from the wedding date, so
neither can be seeded until that date is set: `classic12`, a twelve-month Anglophone countdown of 52
tasks, and `japan8`, an eight-month 結婚式準備 schedule of 38. They are not translations of each other.
Seeding writes flat tasks titled in the seeding device's language — the one place a per-device
preference reaches the sheet.

## Security model

- **The boundary is Google, not the interface.** Every write needs a bearer token and a token needs
  `APP_KEY`, so un-hiding the editing controls in the DOM yields nothing to write with. `canEdit`
  decides what renders and is not enforcement; neither half may be dropped for the other.
- **The edit key is a bearer capability in a URL:** anyone who gets the link can edit, and
  [rotation](#operations) is the only response.
- **It is a fragment, never a query string** — not sent to the server, absent from GitHub's access
  logs, not forwarded in a `Referer`. The script never reads the key from `e.parameter` either, which
  would land it in Google's request logs.
- **The minted token reaches every spreadsheet the owning account can see.** The scope must be
  `spreadsheets`; the REST API rejects a token carrying only `spreadsheets.currentonly`. Container
  binding confines the script, not the token. **So the account owning this spreadsheet should own
  nothing else** — a standing condition no code can enforce.
- **The token lives in `localStorage` and outlives the key by up to an hour**, so revoking or replacing
  an edit key discards the token too. `localStorage` is scoped to the origin, not the path, so any
  other site published from the same Pages account can read the key: publish nothing untrusted there.
- **The board is world-readable.** The read endpoint is anonymous by design and the `/exec` URL ships
  in a public bundle. Treat the guest list and the venue as public.
- **A link in the notes or a checklist item is `http`/`https` only.** The document is written by
  whoever holds the edit key and read by everybody, and an `href` is the one attribute a reader
  controls, so the scheme is allowlisted in one place (`src/lib/links.js`) and everything else — a
  `javascript:` URL above all — is shown as text. Every link carries `rel="noopener noreferrer"`, so
  the page it opens can neither reach back into the board nor be told the URL it came from.
- **No third-party JavaScript and no sign-in.** `script-src 'self'`, `frame-src 'none'`, and
  `connect-src` naming three hosts: `script.google.com`, `script.googleusercontent.com` (the 302 target
  of `/exec`) and `sheets.googleapis.com`. `accounts.google.com` must never appear there.
- **Quota exhaustion is the one real attack and is unfixable.** Anonymous reads spend the owner's Apps
  Script quota before any of our code runs, and Apps Script exposes no client IP. Impact is
  availability only: reads fail, the cached snapshot shows with a notice, and it recovers when the
  quota resets.

## Cost

$0/month on permanent free tiers, no card on file. Pages and Actions are free for public repos, Apps
Script is not billed, and the Sheets API's free quota is far beyond two editors. A Google Cloud project
is required — the Sheets API has to be enabled against one — and costs nothing.

## Setup

No OAuth client, no API key, and nobody signs in.

**1. Create the spreadsheet.** New and empty, in **a Google account that owns nothing else** (see the
scope note above). Do not add tabs: the app builds `tasks` and `config` on its first write and refuses
a file that already has several of its own. Leave general access **Restricted**.

**2. Generate the edit key:** `openssl rand -hex 32`. Store it in a shared password manager; it is
never a build-time value and never goes in the repo.

**3. Create the script, from the sheet.** It must be container-bound — `SpreadsheetApp.getActive()` is
what names the spreadsheet, so there is no id to configure, and from `script.new` it returns null and
every call answers `misconfigured`.

1. In the spreadsheet: **Extensions › Apps Script**. Rename the project **Wedding board**.
2. Replace `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear) → tick **Show `appsscript.json` manifest file in editor**.
4. In **Editor**, replace `appsscript.json` with
   [`apps-script/appsscript.json`](apps-script/appsscript.json): scope
   `https://www.googleapis.com/auth/spreadsheets`, web app executed as the deploying user with
   anonymous access. The wide scope is required; `spreadsheets.currentonly` makes every browser write
   fail with 403.
5. **Project Settings → Script Properties → Add script property**: `APP_KEY`, value the key from step
   2. There is no `SHEET_ID` — the script's container is the sheet.

**4. Attach a Cloud project and enable the Sheets API.** Apps Script's own hidden project cannot have
APIs enabled, so a token it mints could not call the REST API.

1. <https://console.cloud.google.com/> → **New Project**, named **Wedding board**. Check the account
   picker; the console silently acts as the wrong account when several are signed in.
2. **APIs & Services › Library** → **Google Sheets API** → **Enable**.
3. **IAM & Admin › Settings** → copy the **Project number**.
4. In Apps Script: **Project Settings → Google Cloud Platform (GCP) Project → Change project** → paste
   the number.

**5. Publish the consent screen.** In **Testing**, authorization expires after 7 days and the symptom
is indistinguishable from a quota problem.

1. **APIs & Services › OAuth consent screen** — newer consoles file these under **Google Auth Platform
   › Branding** and **› Audience**. Fill in an app name and your own address as support and developer
   contact. **Add no scopes here**; `ScriptApp.getOAuthToken()` does not route through this screen.
2. **Publish app**. With one user and a sensitive scope on an unverified app, Google shows a warning
   screen on first authorization; publishing lifts the 7-day expiry.

**6. Deploy the web app.** **Deploy → New deployment** → gear → **Web app**, with **Execute as: Me**
and **Who has access: Anyone** — not "Anyone with a Google Account", which would require a login the
board must not need. **Deploy**, then authorize: your account, **Advanced** → **Go to… (unsafe)** →
**Allow**. It asks to see and edit all your spreadsheets, which is the scope from step 3. Copy the
**Web app URL**, ending in `/exec`, and verify it:

```sh
URL='https://script.google.com/macros/s/…/exec'
KEY='…'

# The public read: no credential, as a visitor's browser does it.
curl -sSL "$URL"

# The mint: the only thing a write needs from the script.
MINT=$(curl -sSL "$URL" -H 'Content-Type: text/plain;charset=utf-8' --data "{\"key\":\"$KEY\"}")
echo "$MINT"

# Does that token reach the REST API?
TOKEN=$(echo "$MINT" | sed 's/.*"token":"\([^"]*\)".*/\1/')
SHEET=$(echo "$MINT" | sed 's/.*"spreadsheetId":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $TOKEN" "https://sheets.googleapis.com/v4/spreadsheets/$SHEET"
```

Expected: `{"ok":true,"needsSetup":true,"tasks":[],"config":{}}` before the tabs exist and without
`needsSetup` after; then `{"ok":true,"token":"ya29.…","spreadsheetId":"…"}`; then JSON containing the
spreadsheet's title. Every `/exec` reply is HTTP 200 whatever happened, because `ContentService` cannot
set a status, so the body is the only signal.

| Symptom | Cause |
| --- | --- |
| `{"ok":false,"error":"misconfigured"}` | the script is not container-bound — step 3 was done from `script.new` |
| `{"ok":false,"error":"unauthorized"}` | `APP_KEY` does not match |
| `403 … insufficient authentication scopes` | `appsscript.json` still says `spreadsheets.currentonly`, or the deployment predates the change; fix it and deploy a new **version** |

`--data` with no `-X POST` is deliberate: `/exec` answers 302, the redirect must be followed as a GET,
and forcing the method breaks that. `text/plain` keeps the mint a CORS simple request; a preflight
would be answered with the redirect.

**7. Point the app at the endpoint.**

- Locally: `cp .env.example .env.local` (gitignored) and paste the `/exec` URL into `VITE_SCRIPT_URL`.
- Pages: **Settings › Secrets and variables › Actions › Variables** must hold `VITE_SCRIPT_URL`. A
  *variable*, not a secret — Vite inlines it into the bundle, so it is public either way.
- **Settings › Pages › Source** must be **GitHub Actions**. Under "Deploy from a branch" Pages
  publishes the repo tree verbatim and ignores the artifact; the tell is a 404 for `/src/main.jsx`.

**8. Share the two links.** Opening the second once stores the key in that browser; treat it like a
password.

| Who | Link |
| --- | --- |
| Planners, family, anyone | `https://huangwaylon.github.io/wedding/` |
| You and your partner | `https://huangwaylon.github.io/wedding/#k=<the key from step 2>` |

**9. First run.** As an editor, open **Settings** and set both names, the **wedding date** (nothing can
be seeded without it) and the **time zone** if the wedding is not in `Asia/Tokyo`. Then seed a
checklist or start adding tasks.

## Installing on a phone

Open the **edit link** in Safari, **Share › Add to Home Screen**, then launch from the icon. The
fragment is cleared from the URL bar only once the app is running standalone, because an installed iOS
web app has its own storage bucket separate from Safari's and must capture the key on its own first
launch. `manifest.webmanifest` omits `start_url` for the same reason: with one, iOS installs the
manifest's URL and the fragment is lost. The plain link installs the same way, read-only.

## Operations

**Redeploying after a `Code.gs` change.** A deployment is pinned to a version, so saving in the editor
changes nothing on the live board. Replace `Code.gs` in **Extensions › Apps Script**, save, then
**Deploy → Manage deployments** → pencil → **Version: New version** → **Deploy**. The URL does not
change. This matters little for `Code.gs`, which only reads and mints; **a change to
`appsscript.json`'s scope does need a new version**, or every write returns 403.

**Rotating the edit key.** The only incident response this design has; do it if a phone is lost or the
link is forwarded. Generate a key with `openssl rand -hex 32`, edit `APP_KEY` under **Project Settings
→ Script Properties**, and have both editors open the new `#k=…` link once — a key in the URL always
beats the stored one. No redeployment: `APP_KEY` is read inside `doPost`. Rotation is immediate and
total; there is no per-device revocation, and a device on the old key drops to view-only and says so.

**Recovering editing on a device.** If the editing controls are missing — after installing to the Home
Screen, or after iOS evicts an unused app's storage — open **Settings** and paste the edit link into
**Paste your edit link**. Check first that the device is not simply in the read-only view, which the
same section toggles. **Stop editing on this device** removes the key.

## Deploy

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm ci`, `npm
test`, build, upload a Pages artifact, deploy. It needs both repository settings from step 7.

`vite.config.js` sets `base` to `/wedding/`, because a project Pages site serves from `/<repo>/`;
rename the repo without updating it and the page is blank with console 404s for `/assets/index-*.js`.
Build with `VITE_BASE=/` for a user site or a custom domain — `scripts/build-sw.js` reads the same
variable, so the service worker's scope follows.

## Development

Do the Google setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/wedding.git
cd wedding
npm install --registry=https://registry.npmjs.org   # the explicit registry is load-bearing
cp .env.example .env.local   # paste the /exec URL
npm run dev                  # http://localhost:5173/wedding/
```

Without `--registry`, npm bakes an internal mirror host into every `resolved` URL in the lockfile,
which then fails everywhere else; `test/lockfile.test.js` verifies. No new npm dependencies without a
clear reason — one is also a CSP decision.

| Script | |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | bundle into `dist/`, then generate `dist/sw.js` |
| `npm run preview` | serve the built `dist/`; the only way to exercise the service worker |
| `npm test` / `npm run test:watch` | vitest, single run / watch |
| `npm run icons` | regenerate the committed Home Screen PNGs; required after changing the default accent |
| `npm run contrast` | measure every colour pair; required after any colour change |

A green suite says nothing about how the page looks.

- `npx vite-node scripts/preview.jsx` writes `scripts/preview-*.html` (gitignored). Load them through
  `scripts/harness.html`, which takes files, widths and a scroll-to selector on the query string. Use
  its iframes, not a resized window: headless Chrome reports a width you did not ask for.
- `scripts/drive.mjs` drives the running app over the Chrome DevTools Protocol for what a static render
  cannot reach — the accordion, the read/edit toggle, how many writes an edit session costs, whether
  the date control stays inside its row.
- `scripts/stub-endpoint.mjs` serves **both** backends over one in-memory grid on `127.0.0.1:5200`: the
  real `Code.gs` for the read and the mint, and a Sheets API stand-in, checking the bearer token, for
  writes. `vite.config.js` proxies `/wedding/__endpoint` and `/wedding/__sheets` to it in dev only.
  Point the app at it with the two commented variables in `.env.example`; `VITE_SHEETS_BASE` must never
  be set in a shipped build.

### Replacing the hero photograph

`public/hero.jpg` is a derived crop, 1280x1600 and ~290KB; the camera original is gitignored. The
header is `position: fixed` at the top of the viewport (the month headings are the sticky elements
below it), and its photograph band is `--hero-photo: clamp(4.5rem, 20vh, 14rem)` — about a fifth of
the viewport, tall enough to hold faces, so compose for them. `object-position: 50% 42%` picks the
vertical crop; check a replacement at 393px wide and at the 48rem layout.

Two constraints on the crop, both from the band being pinned:

- The top of the picture is under the iOS status bar. The page owns that strip
  (`apple-mobile-web-app-status-bar-style: black-translucent`), so the glyphs are white and
  `--photo-scrim-top` darkens the inset behind them — measured at 4.03:1 by `npm run contrast`. The
  wash is scaled by `env(safe-area-inset-top)`, so it is exactly zero on anything without an inset.
  A crop whose top strip is already dark therefore loses that area to the wash twice over; compose
  it light.
- The band is on screen at every scroll position, so it is read for as long as the app is open.

Regenerate with two `sips` passes, never one — combining `-c` with `--resampleHeightWidth` silently
produces the wrong dimensions. Both flags take **height then width**, and the crop must be 4:5 to match
the output.

```sh
sips -c 4190 3352 --cropOffset 427 111 <photo>.JPG --out /tmp/hero-crop.jpg
sips --resampleHeightWidth 1600 1280 --setProperty formatOptions 20 /tmp/hero-crop.jpg \
  --out public/hero.jpg
```

`--cropOffset` is measured from the top-left when non-zero but means "centred" at `0 0`, and an offset
whose rect ends exactly on the image edge produces no crop at all.

## Known limitations

- No per-device revocation of the edit key; rotation is all-or-nothing.
- Anonymous reads spend the owner's Apps Script quota and cannot be rate-limited by IP.
- Any other site on the same GitHub Pages origin can read the stored edit key.
- Changing the `due` column's number format away from plain text in the Sheets UI can leave a date
  unreadable to editors, who then see the row in the **No date** group while readers still see the
  date. Leave the `tasks` tab formatted as plain text. On a board created before the `start` column
  existed, that column is the one the app never formatted — the repair that widens an old sheet writes
  values only — so if you type a start date into the sheet by hand there, set the column to **Format ›
  Number › Plain text** first. A start date typed in the app is always safe.
- Nothing in the sheet is private, and nothing private should go in it.
- Two people editing the Notes document at once is last-writer-wins over the whole document: there is no
  lock and no push channel, and a refresh happens on focus at most once every 30s. Ticking two different
  tasks never collides this way, because each write touches only its own row.
- The spreadsheet's own revision history is the Notes document's only undo; there is no Cancel.

## File map

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `apps-script/` | `Code.gs` (anonymous read, token mint) and its manifest; deployed by hand |
| `src/schema.js` | the sheet contract: columns, row ↔ task mapping, every A1 range, validation |
| `src/config.js` | build-time values, storage keys, the `config` tab's field list and defaults |
| `src/App.jsx` | the shell: access, the clock, which tab is up, the filter, every mutation's toast |
| `src/lib/` | `api` (dispatch, failure taxonomy), `connection` (token cache), `sheets` (every Sheets API call), `access` (the capability URL), `time`, `progress`, `markdown` (the notes grammar and its toolbar transforms), `links` (what counts as a URL, and the only `href` gate), `templates`, `snapshot`, `serviceWorker`, `theme` |
| `src/state/` | `useBoard` (optimistic CRUD, the folding write queue, throttled refresh), `useToday`, `useToasts` |
| `src/components/` | one file per view, with inline-SVG icons in `icons.jsx` |
| `src/i18n/` | the engine, the `en`/`ja` catalogs, the registry |
| `src/styles/` | `tokens`, `base`, `primitives`, `app`, loaded in that order |
| `test/` | vitest specs. `schema.test.js` pins the two column lists against each other, `script.test.js` executes `Code.gs`, `sheets.test.js` drives the REST client against a fake that parses A1 ranges, `connection.test.js` covers the mint, `markdown.test.js` the notes grammar, `links.test.js` every scheme that may not reach an `href` |
| `scripts/` | `preview.jsx` + `harness.html` (static visual harness), `drive.mjs` + `stub-endpoint.mjs` (drive the app against both backends), `check-contrast.js`, `build-sw.js`, `make-icons.js` |
