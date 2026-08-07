# Setup

Everything below happens once, and takes about five minutes. The result is an app nobody
ever signs in to: a small Apps Script web app, bound to the spreadsheet it manages, serves
the board to anyone who asks and accepts changes from whoever presents a shared key.

**No Google Cloud project, no OAuth client, no API key, no consent screen, and no dedicated
Google account.** If you are looking for those, they are genuinely not needed here — the
script talks to its own container through `SpreadsheetApp` rather than to the Sheets REST
API, so there is no API to enable, and therefore no consent screen whose Testing status
quietly expires a week later.

## 1. Create the spreadsheet

1. Create a **new, empty** spreadsheet in Google Drive. Do not add tabs — the app builds
   `tasks` and `config` on its first write.
2. Leave general access **Restricted**. Nobody needs to open the sheet directly; the app is
   the interface, and the script reaches it on its own authority.

Any Google account will do, including your own. The scope in step 3 confines the script to
this one file, which is what removes the usual "use a throwaway account that owns nothing
else" precaution.

> Use an **empty** spreadsheet, not one you already keep something in. The script refuses to
> add its tabs to a file that already has several of its own — see `ensureStructure` — but
> that guard is a backstop, not a reason to point it somewhere awkward.

## 2. Generate the edit key

```sh
openssl rand -hex 32
```

Keep it where both of you can reach it, like a shared password manager. It is the only
credential the app has, and it is the only thing standing in front of a public endpoint. It
is never a build-time value and never goes in the repository.

## 3. Create the script — from the sheet

**This must be done from the spreadsheet, not from `script.new`.** A container-bound script
can use the `spreadsheets.currentonly` scope, which is what makes it *incapable* of opening
any other file. A standalone script cannot: it would need the broad `spreadsheets` scope,
which reaches every spreadsheet the account can see, and `SpreadsheetApp.getActive()` would
return null so every call would answer `misconfigured`.

1. In the spreadsheet: **Extensions › Apps Script**. Rename the project **Wedding board**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear) → tick **Show `appsscript.json` manifest file in editor**.
4. Back in **Editor**, replace `appsscript.json` with
   [`apps-script/appsscript.json`](apps-script/appsscript.json). It pins the scope to
   `spreadsheets.currentonly` and sets the web app to run as the owner with anonymous
   access.
5. **Project Settings** → **Script Properties** → **Add script property**:

   | Property | Value |
   | --- | --- |
   | `APP_KEY` | the key from step 2 |

   A property rather than a literal, so the copy of the script in this repository holds no
   secret and stays diffable. There is no `SHEET_ID` property — the script's container *is*
   the sheet.

## 4. Deploy

1. **Deploy** → **New deployment** → gear → **Web app**.
2. **Execute as: Me**. **Who has access: Anyone** — not "Anyone with a Google Account",
   because a planner opens this with no Google login at all. This is the setting that makes
   the board readable without a credential.
3. **Deploy**, then authorize: pick your account, **Advanced** → **Go to… (unsafe)** →
   **Allow**. It asks to see and edit *this spreadsheet* — that is the
   `spreadsheets.currentonly` scope from step 3, and the wording is narrower than the usual
   "all your spreadsheets" prompt precisely because of it.
4. Copy the **Web app URL**, ending in `/exec`.

Confirm it, which also proves the part most likely to be wrong:

```sh
URL='https://script.google.com/macros/s/…/exec'
KEY='…'

# The public read. No credential — this is what a planner's browser does.
curl -sSL "$URL"

# A write. Builds the two tabs on first call.
curl -sSL "$URL" -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"key\":\"$KEY\",\"op\":\"ensure\"}"
```

The first should answer `{"ok":true,"needsSetup":true,...}` before the tabs exist and
`{"ok":true,"tasks":[],...}` after. `{"ok":false,"error":"misconfigured"}` means the script
is not bound to a spreadsheet — step 3 was done from `script.new`.
`{"ok":false,"error":"unauthorized"}` on the second means `APP_KEY` does not match.

Note `--data` with no `-X POST`: `/exec` answers with a 302 and the redirect has to be
followed as a GET, which is what a browser does and what forcing the method breaks.

## 5. Point the app at it

Local development — `.env` is gitignored:

```sh
cp .env.example .env   # paste the /exec URL
npm run dev            # http://localhost:5173/wedding/
```

For GitHub Pages, **Settings › Secrets and variables › Actions › Variables** must hold
`VITE_SCRIPT_URL`. It is a *variable*, not a secret: Vite inlines it into the bundle, so it
is public either way, and marking it secret would imply a confidentiality the deployed site
cannot provide. **Settings › Pages › Source** must be **GitHub Actions** — under "Deploy
from a branch" Pages publishes the repository tree verbatim and ignores the artifact, and
the tell is a 404 for `/src/main.jsx`.

## 6. The two links

| Who | Link |
| --- | --- |
| Planners, family, anyone | `https://huangwaylon.github.io/wedding/` |
| You and your partner | `https://huangwaylon.github.io/wedding/#k=<the key from step 2>` |

Send the first one to your planners. It is read-only, it prompts for nothing, and it looks
like an ordinary public page — because it is one.

Keep the second to yourselves. Opening it once stores the key in that browser and the edit
controls appear from then on. **Treat it like a password.** Anyone you forward it to can edit, and so can anyone who photographs your
address bar.

## 7. Installing on an iPhone

Worth doing carefully, because iOS has one trap here.

1. Open the **edit link** (with `#k=…`) in Safari.
2. **Share › Add to Home Screen.**
3. Launch from the Home Screen icon. The key is captured, and the app clears the fragment
   from its own URL bar at that point.

The trap: an installed web app has **its own storage, separate from Safari's**, so a key
entered in the browser does not carry across. That is why the fragment is deliberately left
in the URL bar while you are still in Safari, and why the manifest has no `start_url` —
with one, iOS installs the manifest's URL and the fragment is lost.

If editing does not appear after installing — or if iOS evicts the storage of an app left
unused for a long stretch — open **Settings** in the app and paste the edit link into
**Paste your edit link**. That is the documented recovery path.

A planner installs the plain link the same way and gets a read-only app.

## 8. First run

Open the app as an editor and set, in **Settings**:

- both names,
- the **wedding date** — every starter-checklist offset counts back from it, so a checklist
  cannot be seeded without it,
- the **time zone**, if the wedding is not in `Asia/Tokyo`. Every time on the board is read
  in this zone, so `14:00` means 14:00 at the venue for everyone looking, wherever they are.

Then pick a starter checklist, or start adding tasks. Both checklists are ordinary tasks once
seeded, so rename, re-date and delete them freely.

To break a task into a checklist, open it with the pencil and use **Subtasks** at the bottom of
the form — that is the only way to add the *first* one. After that the task grows a `3 of 5
subtasks` row in the list you can add to and tick from directly, and its percentage becomes how
many are ticked rather than how much of its window has passed.

## Updating the script after a code change

A deployment is pinned to a version, so pasting a new `Code.gs` into the editor and saving
changes **nothing** on the live board. Every time `apps-script/Code.gs` changes in this repo:

1. Sheet → **Extensions** → **Apps Script**, replace `Code.gs` with the current file, save.
2. **Deploy** → **Manage deployments** → pencil → **Version: New version** → **Deploy**.

The URL does not change, so nobody's link breaks.

The app notices when you have not done this. Every read carries the deployed script's column
list, and a script older than the bundle sends none — that absence is the signal. A board on
the older script shows *"The spreadsheet's script is out of date"*, offers no add-subtask
field, and refuses to add or tick a subtask: the old script rewrites a row from the columns
it knows, so it would answer `ok: true`, save the row, and drop the `parent_id` that makes
it a subtask. Everything else keeps working normally.

## Rotating the edit key

The only incident response this design has, and it takes about a minute. Do it if a phone is
lost, if the link gets forwarded by accident, or on any suspicion at all.

1. `openssl rand -hex 32`
2. Apps Script → **Project Settings** → **Script Properties** → edit `APP_KEY`.
3. Both of you open the new `#k=…` link once. A key in the URL always beats the stored one,
   which is how a rotation reaches a device still holding the dead key.

No redeployment: `APP_KEY` is read inside `doPost`, so a property change takes effect on the
next request. Editing `Code.gs` is the opposite — see the section above.

Rotation is immediate and total; there is no per-device revocation. A device still holding
the old key drops to view-only and says so — it flags the rejected key rather than silently
downgrading, so whoever is holding it finds out from the app rather than from wondering why
their edits stopped saving.
