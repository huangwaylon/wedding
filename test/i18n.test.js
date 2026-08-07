/**
 * Structural i18n checks. The scan is the point: it fails on a catalog key nothing
 * references, a referenced key no catalog has, and a bare user-facing string literal in
 * an `aria-label`, `title` or `placeholder` — the three attributes that are easiest to
 * hardcode and hardest to notice, because they never appear on screen in the language
 * you are reading.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGS, DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED } from '../src/i18n/catalogs.js'
import { getLocale, interpolate, setLocale, t, translate } from '../src/i18n/index.js'
import { STATE, STATE_ORDER } from '../src/lib/progress.js'
import { CATEGORIES, TEMPLATE_IDS } from '../src/lib/templates.js'
import { ACCENTS } from '../src/lib/theme.js'

/** A test that changes the locale must put it back, or the state leaks across files. */
afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

function sources(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (/\.jsx?$/.test(path) && !path.includes(`${join('src', 'i18n')}`)) found.push(path)
  }
  return found
}

const FILES = sources('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const ALL_SOURCE = FILES.map((file) => file.text).join('\n')

/**
 * Keys assembled at runtime, which the literal scan cannot see. Each family is asserted
 * against its own source list below instead, so adding a state or a category without a
 * catalog entry still fails.
 */
const RUNTIME_FAMILIES = [
  ...Object.values(STATE).map((state) => `state.${state}`),
  ...CATEGORIES.map((category) => `category.${category.toLowerCase()}`),
  ...TEMPLATE_IDS.flatMap((id) => [`template.${id}`, `template.${id}.about`]),
  ...ACCENTS.map((accent) => `accent.${accent}`),
  ...['ahead', 'behind', 'ontrack'].map((pace) => `overall.pace.${pace}`),
  ...[
    'MISSING_TITLE',
    'MISSING_START',
    'MISSING_END',
    'BAD_START',
    'BAD_END',
    'END_BEFORE_START',
  ].map((code) => `error.${code}`),
  ...[
    'unconfigured',
    'unauthorized',
    'not_empty',
    'misconfigured',
    'busy',
    'not_found',
    'transient',
  ].map((code) => `api.${code}`),
  'api.unconfiguredHint',
  'api.not_emptyHint',
  'api.misconfiguredHint',
]

describe('the catalogs', () => {
  it('has the same key set in every language', () => {
    const reference = Object.keys(CATALOGS[DEFAULT_LOCALE]).sort()
    for (const locale of SUPPORTED) {
      expect(Object.keys(CATALOGS[locale]).sort(), `${locale} differs`).toEqual(reference)
    }
  })

  it('labels every supported locale in its own language', () => {
    for (const locale of SUPPORTED) {
      expect(LOCALE_LABELS[locale]).toBeTruthy()
    }
  })

  it('agrees on which values are pluralised', () => {
    for (const [key, value] of Object.entries(CATALOGS[DEFAULT_LOCALE])) {
      const isPlural = value !== null && typeof value === 'object'
      for (const locale of SUPPORTED) {
        expect(
          CATALOGS[locale][key] !== null && typeof CATALOGS[locale][key] === 'object',
          `${locale}:${key}`,
        ).toBe(isPlural)
      }
    }
  })

  it('supplies the plural categories each language actually has', () => {
    for (const [key, value] of Object.entries(CATALOGS.en)) {
      if (value === null || typeof value !== 'object') continue
      // `Intl.PluralRules('en')` reports one|other; ja reports other alone. This is not
      // a shortcut for ja, it is what the language has.
      expect(Object.keys(value).sort(), `en:${key}`).toEqual(['one', 'other'])
      expect(Object.keys(CATALOGS.ja[key]), `ja:${key}`).toEqual(['other'])
    }
  })

  it('uses the same placeholders in every language', () => {
    const names = (value) =>
      [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

    for (const [key, value] of Object.entries(CATALOGS[DEFAULT_LOCALE])) {
      const reference = typeof value === 'object' ? names(value.other) : names(value)
      for (const locale of SUPPORTED) {
        const other = CATALOGS[locale][key]
        const found = typeof other === 'object' ? names(other.other) : names(other)
        expect(found, `${locale}:${key}`).toEqual(reference)
      }
    }
  })
})

describe('the scan', () => {
  it('references every key some catalog defines', () => {
    const unused = Object.keys(CATALOGS[DEFAULT_LOCALE]).filter(
      (key) => !RUNTIME_FAMILIES.includes(key) && !ALL_SOURCE.includes(`'${key}'`),
    )
    expect(unused, 'catalog keys nothing uses').toEqual([])
  })

  it('defines every key the source references', () => {
    const referenced = new Set(
      [...ALL_SOURCE.matchAll(/\bt\(\s*'([a-zA-Z0-9._]+)'/g)].map((match) => match[1]),
    )
    const missing = [...referenced].filter((key) => !(key in CATALOGS[DEFAULT_LOCALE]))
    expect(missing, 'keys referenced but not defined').toEqual([])
  })

  it('has no bare string in an aria-label, title or placeholder', () => {
    const offenders = []
    for (const { path, text } of FILES) {
      for (const match of text.matchAll(/\b(aria-label|title|placeholder)=(["'])(.*?)\2/g)) {
        // A single lowercase token is a CSS/DOM value, not prose — `title="button"` is
        // not something anybody reads.
        if (/^[a-z-]+$/.test(match[3])) continue
        offenders.push(`${path}: ${match[0]}`)
      }
    }
    expect(offenders, 'hardcoded user-facing attribute strings').toEqual([])
  })
})

describe('runtime key families', () => {
  it('has a string for every state, in both languages', () => {
    for (const state of Object.values(STATE)) {
      for (const locale of SUPPORTED) {
        expect(CATALOGS[locale][`state.${state}`], `${locale}: ${state}`).toBeTruthy()
      }
    }
  })

  it('has a string for every filter the controls render', () => {
    for (const state of STATE_ORDER) {
      expect(CATALOGS[DEFAULT_LOCALE][`state.${state}`]).toBeTruthy()
    }
  })

  it('has a name and a description for every template', () => {
    for (const id of TEMPLATE_IDS) {
      for (const locale of SUPPORTED) {
        expect(CATALOGS[locale][`template.${id}`]).toBeTruthy()
        expect(CATALOGS[locale][`template.${id}.about`]).toBeTruthy()
      }
    }
  })

  it('has a name for every accent preset', () => {
    for (const accent of ACCENTS) {
      for (const locale of SUPPORTED) {
        expect(CATALOGS[locale][`accent.${accent}`], `${locale}: ${accent}`).toBeTruthy()
      }
    }
  })
})

describe('translate', () => {
  it('interpolates and routes numbers through Intl', () => {
    expect(interpolate('{count} left', { count: 1234 }, 'en')).toBe('1,234 left')
  })

  it('leaves an unknown placeholder visible', () => {
    // Blanking it would hide the bug; leaving it makes the scan's failure obvious.
    expect(interpolate('{a} and {b}', { a: 'x' }, 'en')).toBe('x and {b}')
  })

  it('picks the plural branch by CLDR category, not by count === 1', () => {
    expect(translate('en', 'countdown.days', { count: 1 })).toBe('1 day to go')
    expect(translate('en', 'countdown.days', { count: 2 })).toBe('2 days to go')
    // Japanese has one cardinal category, so both readings are the same string.
    expect(translate('ja', 'countdown.days', { count: 1 })).toBe('あと1日')
    expect(translate('ja', 'countdown.days', { count: 2 })).toBe('あと2日')
  })

  it('falls back to the default locale rather than blanking', () => {
    expect(translate('de', 'app.name')).toBe(CATALOGS.en['app.name'])
  })

  it('returns the key for a string nothing defines, and never throws', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })

  it('binds t to the current locale', () => {
    setLocale('ja')
    expect(getLocale()).toBe('ja')
    expect(t('common.save')).toBe(CATALOGS.ja['common.save'])
  })

  it('ignores an unsupported locale', () => {
    setLocale('de')
    expect(getLocale()).toBe(DEFAULT_LOCALE)
  })
})
