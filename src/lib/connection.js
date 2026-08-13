/**
 * The token an editor's writes ride on, and the one Apps Script round trip left in the app.
 *
 * There is no Google sign-in here. The web app in `apps-script/Code.gs`, owned by the
 * account that owns the spreadsheet, holds a permanent grant and mints short-lived access
 * tokens for anyone presenting the edit key. So no popup, no redirect and no hourly
 * re-consent exists anywhere — and a token can be re-issued from a plain `fetch` with no
 * user gesture behind it, which is what lets `sheets.js` recover from a 401 silently.
 *
 * ONE MINT AN HOUR, NOT ONE PER WRITE. That is the whole point of this module: `/exec`
 * costs 1.0–1.6s and `sheets.googleapis.com` costs ~0.24s, so the endpoint is worth
 * touching once and then not again.
 *
 * THIS MODULE DOES NOT OWN THE KEY. The key is the `#k=` capability captured by
 * `lib/access.js`, which is the one home for reading, writing and flagging it — so this
 * asks for it with `readEditKey()` rather than keeping a second copy that could disagree.
 * It does not flag a rejection either: it throws with `badKey` and the chain from
 * `api.js` -> `useBoard` -> `App` reaches `markKeyRejected`, which is where that decision
 * already lived.
 *
 * A PLANNER NEVER REACHES HERE. No key means no mint and no token, which is exactly why a
 * view-only visitor needs no credential: their board comes from `doGet`.
 */

import { SCRIPT_URL, STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { readEditKey } from './access.js'

/**
 * Re-mint this far before expiry, so a request that starts near the boundary cannot arrive
 * at Google after it. Generous because phone data is slow: the cost of being early is one
 * silent fetch.
 */
const REFRESH_MARGIN_MS = 5 * 60_000

/**
 * Assumed rather than reported. Asking the script for the real figure would mean giving it
 * the `script.external_request` scope to call `tokeninfo` — widening its grant to learn a
 * constant. Correctness does not rest on this being right: `sheets.js` re-mints on a 401,
 * which is what actually guarantees freshness.
 */
const TOKEN_LIFETIME_MS = 3600_000

/** An Apps Script round trip is ~1.5s, with outliers past 3s. */
const MINT_TIMEOUT_MS = 15_000

let accessToken = null
let expiresAt = 0
let spreadsheetId = readStored(STORAGE_KEYS.spreadsheetId)

/**
 * Bumped whenever the token is deliberately discarded. A mint that began before the bump
 * cannot satisfy a caller that asked afterwards: on a 401 the in-flight mint may well be
 * carrying the very token Google just rejected, and handing it to the retry — which runs
 * with `allowRetry: false` — turns a recoverable blip into a hard failure.
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
 * Rehydrate at module load. Anything malformed or already past the margin is dropped
 * rather than trusted, so a corrupt entry cannot wedge the app into believing it has a
 * usable token.
 *
 * No network happens here: this module also loads under vitest's `node` environment.
 */
function restoreToken() {
  const raw = readStored(STORAGE_KEYS.token)
  if (!raw) return
  try {
    const saved = JSON.parse(raw)
    if (typeof saved?.accessToken !== 'string' || typeof saved?.expiresAt !== 'number') {
      writeStored(STORAGE_KEYS.token, null)
      return
    }
    if (Date.now() >= saved.expiresAt - REFRESH_MARGIN_MS) {
      writeStored(STORAGE_KEYS.token, null)
      return
    }
    accessToken = saved.accessToken
    expiresAt = saved.expiresAt
  } catch {
    writeStored(STORAGE_KEYS.token, null)
  }
}

restoreToken()

/**
 * A failure carrying the one distinction that matters here.
 *
 * `badKey` is TERMINAL — the key was refused and retrying cannot help. Everything else is
 * transient, because telling somebody their edit link is dead when the network merely
 * hiccuped is the worse mistake of the two. `api.js` maps these onto `API_ERROR`; nothing
 * outside it reads these flags.
 */
function mintError(message, { badKey = false, misconfigured = false } = {}) {
  const error = new Error(message)
  if (badKey) error.badKey = true
  if (misconfigured) error.misconfigured = true
  return error
}

/**
 * One POST to the script. Three details here are load-bearing, and each has broken this
 * endpoint at least once.
 */
async function mint() {
  if (!SCRIPT_URL) throw mintError('Missing VITE_SCRIPT_URL.', { misconfigured: true })

  const key = readEditKey()
  // Not a network failure and not worth a round trip: a device with no key has no business
  // minting, and `api.js` routes its reads through `doGet` instead.
  if (!key) throw mintError('No edit key on this device.', { badKey: true })

  let response
  try {
    response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // `text/plain` keeps this a CORS *simple request*. A preflight would be answered with
      // the 302 that `/exec` returns and die, which is also why the script has no
      // doOptions. Never "correct" this to application/json.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key }),
      // The method is deliberately NOT forced across the redirect. `/exec` answers 302 to
      // script.googleusercontent.com, `fetch` downgrades POST to GET, and Apps Script
      // serves the already-computed reply from there. Forcing POST through the hop returns
      // "page not found".
      redirect: 'follow',
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    })
  } catch {
    throw mintError('Could not reach the token endpoint.')
  }

  // Deliberately no `response.ok` check: ContentService always answers HTTP 200, even for a
  // rejection, so the status carries no information and the body is the only thing worth
  // reading. Branching on `ok` here would report a rotated key as success.
  const text = await response.text().catch(() => '')

  let body
  try {
    body = JSON.parse(text)
  } catch {
    // Google serves an HTML page when the quota is exhausted, during an outage, and for any
    // uncaught throw inside doPost. Transient: retrying is right, and treating it as a bad
    // key would be wrong.
    throw mintError('The token endpoint did not return JSON.')
  }

  if (body?.error === 'unauthorized') throw mintError('The edit key was refused.', { badKey: true })
  if (body?.error === 'misconfigured') {
    throw mintError('The script is not bound to a spreadsheet.', { misconfigured: true })
  }
  if (typeof body?.token !== 'string' || !body.token) {
    throw mintError('The token endpoint returned no token.')
  }
  // An absent id would otherwise be persisted as the string "null" and every request would
  // go to /spreadsheets/null.
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
      // Superseded while in flight: a 401 arrived and bumped the generation, so this token
      // may be the dead one. Hand it to whoever is waiting, but do not cache it as current.
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
 * Share one mint between concurrent callers, unless the caller needs one newer than the
 * mint already running.
 */
async function tokenAtLeast(minGeneration) {
  while (pending && pending.generation < minGeneration) {
    // Wait it out rather than running two mints at once; the loop exits because the mint
    // clears `pending` before resolving its awaiters.
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
 * Force a token newer than any currently in flight. Called from the 401 retry in
 * `sheets.js`, which is what makes the refresh margin a performance choice rather than a
 * correctness one.
 */
export function refreshToken() {
  generation += 1
  discardToken()
  return tokenAtLeast(generation)
}

/**
 * The spreadsheet this device's token reaches, or null before the first mint.
 *
 * Cached across launches so a warm start can read without minting first, and re-read from
 * every mint so a re-pointed deployment is picked up rather than remembered wrongly.
 */
export async function getSpreadsheetId() {
  if (spreadsheetId) return spreadsheetId
  await tokenAtLeast(generation)
  return spreadsheetId
}

/**
 * Drop the minted credential. Called when an edit key is revoked or replaced: the token
 * outlives the key by up to an hour, so leaving it behind would let a device that has just
 * been demoted to view-only keep writing.
 */
export function forgetToken() {
  generation += 1
  discardToken()
  spreadsheetId = null
  writeStored(STORAGE_KEYS.spreadsheetId, null)
}
