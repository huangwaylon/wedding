/**
 * Who may edit, and how that is decided without anyone typing a password.
 *
 * The site is public and looks it. A planner opens the bare URL and gets a
 * read-only board with no prompt, no gate and nothing to dismiss. The two people
 * planning the wedding open a URL with a secret in its FRAGMENT:
 *
 *   https://…/wedding/#k=<64 hex chars>
 *
 * which is captured into `localStorage` on first load and never needed in the
 * URL again. The write endpoint rejects anything without it, so view-only is
 * enforced by the server, not by hiding buttons — a planner poking at the DOM
 * gains nothing.
 *
 * THE FRAGMENT, NEVER A QUERY STRING. A fragment is not sent to the server, does
 * not appear in GitHub's access logs, and is not forwarded in a `Referer` header
 * to anywhere the page might link. `?k=` would leak into all three.
 *
 * The honest cost, stated here and in README's security model: this is a bearer
 * capability in a link. Anyone who gets the link can edit — a forwarded message,
 * a screenshot of the address bar, a shared screen. Rotation is the only
 * response, and it is one script property away.
 */

import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

const EDIT_KEY_PARAM = 'k'

/**
 * What `openssl rand -hex 32` produces. Checked before storing so a mangled link
 * or a stray `#section` never lands in storage and turns into a mystery
 * `unauthorized` later — a rejected key and a truncated one are very different
 * problems and only one of them is worth telling somebody about.
 */
export const KEY_PATTERN = /^[0-9a-f]{32,128}$/i

export const ACCESS = { EDIT: 'edit', VIEW: 'view' }

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
 * Pull a key out of anything somebody pastes into the settings field — a whole
 * edit link, a link with a query string instead of a fragment, or the bare key.
 * This is the recovery path, not the normal one: see `shouldStripHash`.
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
 * A key the endpoint refused is FLAGGED, not deleted. Deleting it would drop the
 * device silently to view-only and the next person to notice would be whoever
 * wondered why their edits stopped saving; the flag lets the app say "this edit
 * link was rejected — it has probably been rotated", which is actionable.
 */
export function markKeyRejected() {
  writeStored(STORAGE_KEYS.editKeyRejected, '1')
}

export function isKeyRejected() {
  return readStored(STORAGE_KEYS.editKeyRejected) === '1'
}

/**
 * Whether the fragment should be cleared from the address bar after capture.
 *
 * Only once running as an installed app. In Safari the fragment has to STAY,
 * because an installed web app gets its own storage bucket — separate from
 * Safari's — so the key captured in the browser does not carry across to the
 * Home Screen app. Leaving the fragment in place is what lets "Add to Home
 * Screen" record a URL that still carries the key, so the installed app captures
 * it on its own first launch. (`public/manifest.webmanifest` deliberately omits
 * `start_url` for the same reason: with it, iOS installs the manifest's URL
 * instead of the one on screen and the fragment is lost.)
 *
 * Once standalone there is nothing left to install and the fragment is only a
 * liability in screenshots, so it goes.
 */
export function shouldStripHash({ standalone }) {
  return Boolean(standalone)
}

/**
 * True when the page is running as an installed app. Both spellings, because iOS
 * shipped `navigator.standalone` years before it supported the display-mode
 * media query and older installs still report only the former.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false
  if (window.navigator?.standalone) return true
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches)
}

/**
 * Resolve access at boot. Pure apart from storage, so the browser-specific bits
 * (reading `location.hash`, rewriting the URL) stay in the caller.
 *
 * @param {object} input
 * @param {string} input.hash `location.hash`
 * @param {boolean} input.standalone
 * @returns {{key: string|null, mode: string, rejected: boolean, strip: boolean}}
 */
export function resolveAccess({ hash, standalone }) {
  const fromHash = parseEditKey(hash)
  // A key in the URL wins over a stored one: opening a fresh edit link is how a
  // rotation is delivered, and it must not be shadowed by the old key.
  const key = fromHash ? writeEditKey(fromHash) : readEditKey()
  return {
    key,
    mode: key ? ACCESS.EDIT : ACCESS.VIEW,
    rejected: Boolean(key) && isKeyRejected(),
    strip: Boolean(fromHash) && shouldStripHash({ standalone }),
  }
}
