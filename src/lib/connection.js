/**
 * The token an editor's writes ride on, and the one Apps Script round trip left in the app.
 *
 * Nothing signs in. The web app in `apps-script/Code.gs`, owned by the account that owns the
 * spreadsheet, holds a permanent grant and mints short-lived tokens for anyone presenting the edit
 * key — so there is no consent screen, and a token can be re-issued from a plain `fetch` with no
 * user gesture, which is what lets `sheets.js` recover from a 401 silently.
 *
 * One mint an hour, not one per write: `/exec` costs 1.0–1.6s and `sheets.googleapis.com` ~0.24s.
 *
 * `lib/access.js` owns the key, so this reads it with `readEditKey()` rather than keeping a copy
 * that could disagree, and it does not flag a rejection: it throws `badKey`, and `App` reaches
 * `markKeyRejected`.
 *
 * A planner never reaches here: no key means no mint and no token.
 */

import { SCRIPT_URL, STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { readEditKey } from './access.js'

/**
 * Re-mint this far before expiry, so a request starting near the boundary cannot arrive at Google
 * after it. The cost of being early is one silent fetch.
 */
const REFRESH_MARGIN_MS = 5 * 60_000

/**
 * Assumed rather than reported: reading the real figure would mean giving the script the
 * `script.external_request` scope. Correctness does not rest on it — `sheets.js` re-mints on a 401.
 */
const TOKEN_LIFETIME_MS = 3600_000

/** An Apps Script round trip is ~1.5s, with outliers past 3s. */
const MINT_TIMEOUT_MS = 15_000

let accessToken = null
let expiresAt = 0
let spreadsheetId = readStored(STORAGE_KEYS.spreadsheetId)

/**
 * Bumped whenever the token is deliberately discarded, so a mint that began before the bump cannot
 * satisfy a caller that asked after it. On a 401 the in-flight mint may carry the token Google just
 * rejected, and handing it to the retry — which runs with `allowRetry: false` — turns a blip into a
 * hard failure.
 */
let generation = 0

/** The single in-flight mint, so concurrent callers share one round trip. */
let pending = null

function persistToken() {
  writeStored(
    STORAGE_KEYS.token,
    accessToken ? JSON.stringify({ accessToken, expiresAt }) : null,
  )
}

function discardToken() {
  accessToken = null
  expiresAt = 0
  persistToken()
}

/**
 * Rehydrate at module load. Anything malformed or past the margin is dropped, so a corrupt entry
 * cannot leave the app believing it holds a usable token. No network here: this module also loads
 * under vitest's `node` environment.
 */
function restoreToken() {
  const raw = readStored(STORAGE_KEYS.token)
  if (!raw) return
  let saved = null
  try {
    saved = JSON.parse(raw)
  } catch {
    // A corrupt entry is dropped below, with every other unusable shape: one drop site, so a
    // credential can never survive a check by taking a path that forgot to clear it.
  }
  const usable =
    typeof saved?.accessToken === 'string' &&
    typeof saved?.expiresAt === 'number' &&
    Date.now() < saved.expiresAt - REFRESH_MARGIN_MS
  if (!usable) {
    writeStored(STORAGE_KEYS.token, null)
    return
  }
  accessToken = saved.accessToken
  expiresAt = saved.expiresAt
}

restoreToken()

/**
 * `badKey` is terminal — the key was refused. Everything else is transient: reporting a dead edit
 * link when the network hiccuped is the worse mistake. `api.js` maps these onto `API_ERROR`;
 * nothing else reads the flags.
 */
function mintError(message, { badKey = false, misconfigured = false } = {}) {
  const error = new Error(message)
  if (badKey) error.badKey = true
  if (misconfigured) error.misconfigured = true
  return error
}

/** One POST to the script. Three details below are load-bearing. */
async function mint() {
  if (!SCRIPT_URL) throw mintError('Missing VITE_SCRIPT_URL.', { misconfigured: true })

  const key = readEditKey()
  // A device with no key has no business minting, and `api.js` routes its reads through `doGet`.
  if (!key) throw mintError('No edit key on this device.', { badKey: true })

  let response
  try {
    response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // `text/plain` keeps this a CORS simple request. A preflight would be answered with the 302
      // `/exec` returns and die, which is also why the script has no doOptions. Never "correct"
      // this to application/json.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key }),
      // The method is not forced across the redirect: `fetch` downgrades POST to GET on the hop to
      // script.googleusercontent.com and Apps Script serves the computed reply from there. Forcing
      // POST through it returns "page not found".
      redirect: 'follow',
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    })
  } catch {
    throw mintError('Could not reach the token endpoint.')
  }

  // No `response.ok` check: ContentService always answers HTTP 200, even for a rejection, so the
  // body is the only signal and branching on `ok` would report a rotated key as success.
  const text = await response.text().catch(() => '')

  let body
  try {
    body = JSON.parse(text)
  } catch {
    // Google serves HTML for an exhausted quota, an outage, and any uncaught throw inside doPost.
    // Transient: treating it as a bad key would be wrong.
    throw mintError('The token endpoint did not return JSON.')
  }

  if (body?.error === 'unauthorized') throw mintError('The edit key was refused.', { badKey: true })
  if (body?.error === 'misconfigured') {
    throw mintError('The script is not bound to a spreadsheet.', { misconfigured: true })
  }
  if (typeof body?.token !== 'string' || !body.token) {
    throw mintError('The token endpoint returned no token.')
  }
  // An absent id would persist as the string "null" and every request would go to
  // /spreadsheets/null.
  if (typeof body?.spreadsheetId !== 'string' || !body.spreadsheetId) {
    throw mintError('The token endpoint returned no sheet id.', { misconfigured: true })
  }

  return { accessToken: body.token, spreadsheetId: body.spreadsheetId }
}

function startMint() {
  const started = generation

  const promise = (async () => {
    try {
      const result = await mint()
      // Superseded in flight: a 401 bumped the generation, so this token may be the dead one. Hand
      // it to whoever is waiting, but do not cache it as current.
      if (started === generation) {
        accessToken = result.accessToken
        expiresAt = Date.now() + TOKEN_LIFETIME_MS
        persistToken()
        if (spreadsheetId !== result.spreadsheetId) {
          spreadsheetId = result.spreadsheetId
          writeStored(STORAGE_KEYS.spreadsheetId, spreadsheetId)
        }
      }
      return result
    } catch (cause) {
      if (cause.badKey) discardToken()
      throw cause
    } finally {
      if (pending?.generation === started) pending = null
    }
  })()

  pending = { promise, generation: started }
  return promise
}

/**
 * Share one mint between concurrent callers, unless the caller needs one newer than the mint
 * running.
 */
async function tokenAtLeast(minGeneration) {
  while (pending && pending.generation < minGeneration) {
    // Wait rather than run two mints at once; the loop exits because the mint clears `pending`
    // before resolving.
    await pending.promise.catch(() => {})
  }
  const result = await (pending ? pending.promise : startMint())
  return result.accessToken
}

/** Every Sheets request goes through this. */
export async function getAccessToken() {
  if (accessToken && Date.now() < expiresAt - REFRESH_MARGIN_MS) return accessToken
  return tokenAtLeast(generation)
}

/**
 * Force a token newer than any in flight. Called from the 401 retry in `sheets.js`, which is what
 * makes the refresh margin a performance choice rather than a correctness one.
 */
export function refreshToken() {
  generation += 1
  discardToken()
  return tokenAtLeast(generation)
}

/**
 * The spreadsheet this device's token reaches, or null before the first mint. Cached across
 * launches so a warm start reads without minting, and re-read from every mint so a re-pointed
 * deployment is picked up.
 */
export async function getSpreadsheetId() {
  if (spreadsheetId) return spreadsheetId
  await tokenAtLeast(generation)
  /* A mint superseded in flight — `forgetToken` or a revoke landing during it — resolves its waiters
     without caching anything, so this can still be empty. Said here rather than passed on: a request
     to `/spreadsheets/null` comes back 404 and reports as `misconfigured` anyway, having spent a round
     trip to be told something this side already knew. */
  if (!spreadsheetId) throw mintError('No spreadsheet for this device yet.', { misconfigured: true })
  return spreadsheetId
}

/**
 * Drop the minted credential, called when an edit key is revoked or replaced. The token outlives
 * the key by up to an hour, so leaving it behind lets a device demoted to view-only keep writing,
 * and a device pasting a different key keep using the old one's token.
 */
export function forgetToken() {
  generation += 1
  discardToken()
  spreadsheetId = null
  writeStored(STORAGE_KEYS.spreadsheetId, null)
}
