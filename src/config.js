/**
 * Build-time configuration, storage keys, and the board defaults.
 *
 * `SCRIPT_URL` is PUBLIC and has to be. Vite inlines it into the shipped bundle,
 * and a view-only visitor reads the board through it with no credential at all —
 * that is the feature. Nothing may depend on the endpoint being hard to guess;
 * the edit key is the only access control. See README's security model.
 */

import { CATEGORIES } from './lib/templates.js'

export const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? ''
export const STORAGE_KEYS = {
  /**
   * The edit key, captured from the URL fragment (see `lib/access.js`). Present
   * only on the two editors' devices; a planner's browser never holds one.
   *
   * NOTE: localStorage is scoped to the ORIGIN, not the path, so every other site
   * published from this GitHub Pages account can read it. Accepted knowingly, and
   * the reason nothing untrusted may be published from the same account.
   */
  editKey: 'wd.editKey',
  editKeyRejected: 'wd.editKeyRejected',
  /** Last successful read, so a cold launch paints before any network call. */
  snapshot: 'wd.snapshot',
  locale: 'wd.locale',
  accent: 'wd.accent',
  /** Which list filter and view the device was last using. Per-device, never shared. */
  filter: 'wd.filter',
}

/**
 * Every localStorage touch goes through these two, because every one of them can
 * throw: Safari in private browsing rejects writes outright. A failure is never
 * fatal — the value just does not survive a reload.
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
 * Used when the sheet has no `config` tab yet, or a key is missing from it.
 *
 * These values are WRITTEN to the shared spreadsheet, so none of them is
 * localized: two people and their planners may read the UI in different
 * languages, and the stored data must not depend on whose device seeded it. The
 * interface language and the accent colour are per-device and live in
 * `localStorage` instead — neither person gets to restyle the other's phone, and
 * a planner's language preference is nobody else's business.
 */
export const DEFAULT_CONFIG = {
  partner1Name: '',
  partner2Name: '',
  /** '' until somebody sets it. The countdown and the templates both need it. */
  weddingDate: '',
  weddingTime: '',
  venue: '',
  /**
   * The zone every wall-clock time in the sheet is read in. Not the device's:
   * "the ceremony is at 14:00" must say 14:00 to a planner in another country.
   */
  timezone: 'Asia/Tokyo',
  /** One home for this list: `lib/templates.js`, which is what seeds it. */
  categories: CATEGORIES,
}

/**
 * The `config` tab's field list: a kind per key, so `parseConfig` knows whether a
 * value is text or a comma-separated list. A key whose value is blank or
 * unparseable is OMITTED from the parse result rather than returned empty, so the
 * default below wins — an empty `categories` list would leave the category picker
 * with nothing in it.
 */
export const CONFIG_FIELDS = [
  { key: 'partner1_name', field: 'partner1Name', kind: 'text' },
  { key: 'partner2_name', field: 'partner2Name', kind: 'text' },
  { key: 'wedding_date', field: 'weddingDate', kind: 'text' },
  { key: 'wedding_time', field: 'weddingTime', kind: 'text' },
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
 * Layer whatever the sheet actually specified over the defaults.
 *
 * Shared with the snapshot cache, which stores the PARTIAL rather than the merged
 * result: a merged copy would freeze the building build's defaults into every
 * future launch, so a changed default would not take effect until a network read
 * landed.
 */
export function mergeConfig(partial) {
  return {
    ...DEFAULT_CONFIG,
    // Cloned so a caller mutating the array cannot corrupt the shared default.
    categories: [...DEFAULT_CONFIG.categories],
    ...(partial ?? {}),
  }
}

/** The wedding as a wall-clock string, or '' — the countdown's only input. */
export function weddingWall(config) {
  const date = String(config?.weddingDate ?? '').trim()
  if (!date) return ''
  const time = String(config?.weddingTime ?? '').trim()
  return `${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '00:00'}`
}
