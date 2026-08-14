/**
 * Build-time configuration, storage keys, and the board defaults.
 *
 * `SCRIPT_URL` is public and has to be: Vite inlines every `VITE_` variable into the shipped
 * bundle, so none may hold a real secret. A view-only visitor reads the board through it with no
 * credential, so nothing may depend on the endpoint being hard to guess; the edit key is the only
 * access control. See README's security model.
 */

import { CATEGORIES } from './lib/templates.js'

export const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? ''
export const STORAGE_KEYS = {
  /**
   * The edit key, captured from the URL fragment (see `lib/access.js`). localStorage is scoped to
   * the ORIGIN, not the path, so every other site published from this GitHub Pages account can read
   * it — accepted knowingly, and the reason nothing untrusted may be published there.
   */
  editKey: 'wd.editKey',
  editKeyRejected: 'wd.editKeyRejected',
  /**
   * The minted Google access token and the id of the spreadsheet it reaches, cached so a relaunch
   * does not spend an Apps Script round trip before its first read. Both derive from the edit key
   * and are worthless without it; `forgetToken` drops them.
   *
   * The token is a write-capable bearer credential with an hour of life. It is here rather than in
   * memory only because a cold launch that had to mint first would pay ~1.5s before painting, and
   * the origin-scoping note above applies to it with more force.
   */
  token: 'wd.token',
  spreadsheetId: 'wd.sheetId',
  /** Last successful read, so a cold launch paints before any network call. */
  snapshot: 'wd.snapshot',
  locale: 'wd.locale',
  accent: 'wd.accent',
  /** Which state filter the device was last using. Per-device, never shared. */
  filter: 'wd.filter',
  /**
   * An editor choosing to see the board the way a guest sees it. Per-device, and purely a view
   * preference: the edit key stays where it is and the endpoint's refusal is untouched.
   */
  readOnly: 'wd.readOnly',
}

/**
 * Every localStorage touch goes through these two, because every one can throw: Safari in private
 * browsing rejects writes. A failure is never fatal — the value just does not survive a reload.
 */
export function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked. Nothing to do: this is a cache, never the source of truth.
  }
}

/**
 * Used when the sheet has no `config` tab yet, or a key is missing from it. These values are
 * written to the shared spreadsheet, so none is localized: the stored data must not depend on whose
 * device seeded it. Interface language and accent colour are per-device and live in `localStorage`.
 */
export const DEFAULT_CONFIG = {
  partner1Name: '',
  partner2Name: '',
  /**
   * 'YYYY-MM-DD', or '' until somebody sets it. The countdown and the templates both need it. No
   * time.
   */
  weddingDate: '',
  venue: '',
  /**
   * The zone today's date is resolved in, which decides whether a due date has passed. Not the
   * device's: a task due on the 18th must stop being due on the 19th at the venue.
   */
  timezone: 'Asia/Tokyo',
  /** One home for this list: `lib/templates.js`, which is what seeds it. */
  categories: CATEGORIES,
}

/**
 * The `config` tab's field list: a kind per key, so `parseConfig` knows whether a value is text or
 * a comma-separated list. A blank or unparseable value is omitted rather than returned empty, so
 * the default wins — an empty `categories` list would leave the picker with nothing in it.
 */
export const CONFIG_FIELDS = [
  { key: 'partner1_name', field: 'partner1Name', kind: 'text' },
  { key: 'partner2_name', field: 'partner2Name', kind: 'text' },
  { key: 'wedding_date', field: 'weddingDate', kind: 'text' },
  { key: 'venue', field: 'venue', kind: 'text' },
  { key: 'timezone', field: 'timezone', kind: 'text' },
  { key: 'categories', field: 'categories', kind: 'list' },
]

export function parseConfig(raw) {
  const parsed = {}
  for (const { key, field, kind } of CONFIG_FIELDS) {
    const value = raw?.[key]
    if (value == null) continue
    const text = String(value).trim()
    if (!text) continue
    if (kind === 'list') {
      const items = text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      // An empty list must never shadow the default.
      if (items.length) parsed[field] = items
    } else {
      parsed[field] = text
    }
  }
  return parsed
}

/** The inverse, for a `setConfig` write. Lists go back as comma-separated text. */
export function serializeConfig(config) {
  const raw = {}
  for (const { key, field, kind } of CONFIG_FIELDS) {
    if (!(field in config)) continue
    const value = config[field]
    raw[key] = kind === 'list' ? (value ?? []).join(', ') : String(value ?? '')
  }
  return raw
}

export function isConfigured() {
  return Boolean(SCRIPT_URL)
}

/**
 * Layer whatever the sheet specified over the defaults. Shared with the snapshot cache, which
 * stores the partial rather than the merged result: a merged copy would freeze the building build's
 * defaults into every future launch.
 */
export function mergeConfig(partial) {
  return {
    ...DEFAULT_CONFIG,
    // Cloned so a caller mutating the array cannot corrupt the shared default.
    categories: [...DEFAULT_CONFIG.categories],
    ...(partial ?? {}),
  }
}

/** The wedding day, or '' — the countdown's and the templates' only input. */
export function weddingDay(config) {
  return String(config?.weddingDate ?? '').trim()
}
