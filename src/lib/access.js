/**
 * Who may edit, decided without anyone typing a password.
 *
 * A planner opens the bare URL and gets a read-only board. The two people planning the wedding open
 * a URL with a
 * secret in its fragment — `https://…/wedding/#k=<64 hex chars>` — captured into `localStorage` on first load and
 * never needed in the URL again. The write endpoint rejects anything without it, so view-only is
 * enforced by the server rather than by hiding buttons.
 *
 * The fragment, never a query string: a fragment is not sent to the server, does not appear in
 * GitHub's access logs, and is not forwarded in a `Referer` header. `?k=` would leak into all
 * three.
 *
 * The cost, also in README's security model: a bearer capability in a link, so anyone holding the
 * link can edit. Rotation is the only response, one script property away.
 */

import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

const EDIT_KEY_PARAM = 'k'

/**
 * What `openssl rand -hex 32` produces. Checked before storing, so a mangled link never lands in
 * storage and surfaces later as a mystery `unauthorized`.
 */
export const KEY_PATTERN = /^[0-9a-f]{32,128}$/i

/** Pure: '#k=abc&x=1' -> 'abc'. Anything unusable is null, never a partial. */
export function parseEditKey(hash) {
  const raw = String(hash ?? '')
  const body = raw.startsWith('#') ? raw.slice(1) : raw
  if (!body) return null
  let found = null
  try {
    found = new URLSearchParams(body).get(EDIT_KEY_PARAM)
  } catch {
    return null
  }
  if (!found) return null
  const key = found.trim()
  return KEY_PATTERN.test(key) ? key : null
}

/**
 * The recovery path: a whole edit link, one with a query string instead of a fragment, or the bare
 * key.
 */
export function parsePastedLink(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const direct = raw.replace(/^#/, '')
  if (KEY_PATTERN.test(direct)) return direct

  const hashAt = raw.indexOf('#')
  if (hashAt >= 0) {
    const found = parseEditKey(raw.slice(hashAt))
    if (found) return found
  }
  const queryAt = raw.indexOf('?')
  if (queryAt >= 0) {
    const found = parseEditKey(raw.slice(queryAt + 1))
    if (found) return found
  }
  return null
}

export function readEditKey() {
  const stored = readStored(STORAGE_KEYS.editKey)
  return stored && KEY_PATTERN.test(stored) ? stored : null
}

export function writeEditKey(key) {
  if (key == null) {
    writeStored(STORAGE_KEYS.editKey, null)
    writeStored(STORAGE_KEYS.editKeyRejected, null)
    return null
  }
  if (!KEY_PATTERN.test(key)) return null
  writeStored(STORAGE_KEYS.editKey, key)
  writeStored(STORAGE_KEYS.editKeyRejected, null)
  return key
}

/**
 * A key the endpoint refused is flagged, not deleted. Deleting it drops the device silently to
 * view-only; the flag lets the app say the link was rejected and has probably been rotated.
 */
export function markKeyRejected() {
  writeStored(STORAGE_KEYS.editKeyRejected, '1')
}

export function isKeyRejected() {
  return readStored(STORAGE_KEYS.editKeyRejected) === '1'
}

/**
 * Whether the fragment should be cleared from the address bar after capture. Only once standalone.
 *
 * In Safari it has to stay: an installed web app gets its own storage bucket, so a key captured in
 * the browser does not carry across. Leaving the fragment is what lets "Add to Home Screen" record
 * a URL still carrying the key, so the installed app captures it on its first launch.
 * (`public/manifest.webmanifest` omits `start_url` for the same reason: with it, iOS installs the
 * manifest's URL and the fragment is lost.)
 *
 * Once standalone there is nothing left to install and the fragment is only a liability in
 * screenshots.
 */
export function shouldStripHash({ standalone }) {
  return Boolean(standalone)
}

/**
 * True when running as an installed app. Both spellings: iOS shipped `navigator.standalone` years
 * before the display-mode media query, and older installs report only it.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false
  if (window.navigator?.standalone) return true
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches)
}

/**
 * Resolve access at boot. Pure apart from storage, so reading `location.hash` and rewriting the URL
 * stay in the caller.
 *
 * @param {string} input.hash `location.hash`
 * @returns {{key: string|null, rejected: boolean, strip: boolean}} holding a `key` is what edit
 *   rights are; `rejected` says the endpoint refused it
 */
export function resolveAccess({ hash, standalone }) {
  const fromHash = parseEditKey(hash)
  // A key in the URL wins over a stored one: a fresh edit link is how a rotation is delivered.
  const key = fromHash ? writeEditKey(fromHash) : readEditKey()
  return {
    key,
    rejected: Boolean(key) && isKeyRejected(),
    strip: Boolean(fromHash) && shouldStripHash({ standalone }),
  }
}
