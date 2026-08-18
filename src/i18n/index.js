/**
 * The i18n engine: a module singleton plus a `useSyncExternalStore` hook. A singleton rather than a
 * context, because non-React modules need the same `t` and `test/render.test.jsx` mounts components
 * bare with no provider; one locale per tab, so the multi-tenant argument for context does not
 * apply. The pure layers — `time.js`, `progress.js`, `schema.js`, `templates.js` — never read it.
 * Both catalogs are statically imported: a couple of KB gzipped is cheaper than the round trip and
 * Suspense boundary a dynamic import would cost.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { CATALOGS, DEFAULT_LOCALE, SUPPORTED } from './catalogs.js'

/** `{name}` — the only interpolation syntax. */
const VAR_PATTERN = /\{(\w+)\}/g

const numberFormats = new Map()
const pluralRules = new Map()

function numberFormat(locale) {
  let format = numberFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale)
    numberFormats.set(locale, format)
  }
  return format
}

/**
 * CLDR category for a count, never a `count === 1` ternary: `ja` has `other` alone, and a ternary
 * would put an English plural rule on a Japanese string. The `Intl.PluralRules` instance is memoised
 * because constructing one costs tens of microseconds and every counted string goes through here.
 */
function selectPlural(locale, count) {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules.select(count)
}

const warned = new Set()

function lookup(locale, key) {
  const value = CATALOGS[locale]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key]
  if (value == null) {
    // Never throw: a missing string must not blank the app. Structural guarantees live in
    // test/i18n.test.js.
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return value
}

/**
 * `{name}` substitution, and the one place a value becomes text. A NUMBER is formatted through
 * `Intl.NumberFormat`, which is what makes `{count} days` read correctly in every locale — and is
 * also a trap: it GROUPS, so a year passed as a number renders as '2,026'. Anything that is a string
 * of digits rather than a quantity has to arrive as a string (see `plan.rowYear`).
 *
 * An unknown placeholder is left as typed rather than blanked: a visible `{name}` is a bug report,
 * an empty gap is a sentence with a hole in it.
 */
export function interpolate(template, vars, locale) {
  if (!vars) return template
  return String(template).replace(VAR_PATTERN, (whole, name) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    return typeof value === 'number' ? numberFormat(locale).format(value) : String(value)
  })
}

/**
 * The lookup plus interpolation. A catalog value is a string or, for a counted noun, an object keyed
 * by CLDR category; `?? entry.other` keeps an unexpected category readable rather than rendering
 * `undefined`, which is the one failure a reader could not diagnose.
 */
export function translate(locale, key, vars) {
  const entry = lookup(locale, key)
  if (entry && typeof entry === 'object') {
    const count = Number(vars?.count ?? 0)
    // `?? entry.other` keeps an unexpected category readable rather than undefined.
    const branch = entry[selectPlural(locale, count)] ?? entry.other
    return interpolate(branch, vars, locale)
  }
  return interpolate(entry, vars, locale)
}

function detectLocale() {
  const stored = readStored(STORAGE_KEYS.locale)
  if (SUPPORTED.includes(stored)) return stored
  const preferences =
    (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []
  for (const tag of preferences) {
    const base = String(tag ?? '')
      .toLowerCase()
      .split('-')[0]
    if (SUPPORTED.includes(base)) return base
  }
  return DEFAULT_LOCALE
}

// Runs at module load, under vitest's `node` environment too, so every storage/navigator touch
// above is guarded.
let current = detectLocale()

const listeners = new Set()

export function getLocale() {
  return current
}

function onLocaleChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reflect the locale onto the document. No-op outside a browser. */
export function syncDocumentLocale(tag = current) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = tag
  document.title = translate(tag, 'app.name')
}

export function setLocale(tag) {
  const next = SUPPORTED.includes(tag) ? tag : DEFAULT_LOCALE
  if (next === current) return
  current = next
  writeStored(STORAGE_KEYS.locale, next)
  syncDocumentLocale(next)
  for (const listener of listeners) listener()
}

/** Locale-bound translate. Safe to import from non-React modules. */
export function t(key, vars) {
  return translate(current, key, vars)
}

/**
 * The React face of the singleton: subscribed through `useSyncExternalStore`, so a locale change
 * re-renders every component that reads it without a provider anywhere. Memoised on the locale, or
 * the new object identity re-renders the tree on every parent render instead.
 */
export function useT() {
  const locale = useSyncExternalStore(onLocaleChange, getLocale, getLocale)
  return useMemo(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      setLocale,
    }),
    [locale],
  )
}

/**
 * A category's display name. Categories are stored in the sheet as English words, so somebody
 * editing the spreadsheet reads words rather than codes. A known one is translated; an unknown one
 * renders exactly as typed — the sheet is the source of truth, the catalog a courtesy on top.
 * `category.*` keys are built at runtime, so the i18n scan cannot see them; `test/i18n.test.js`
 * asserts the family against `CATEGORIES`.
 */
export function useCategoryLabel() {
  const { locale } = useT()
  return useMemo(
    () => (category) => {
      const raw = String(category ?? '').trim()
      if (!raw) return ''
      const key = `category.${raw.toLowerCase()}`
      const translated = CATALOGS[locale]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key]
      return typeof translated === 'string' ? translated : raw
    },
    [locale],
  )
}
