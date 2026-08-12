/**
 * The starter checklists. These are content, but two properties of them are load
 * bearing: the offsets have to produce usable due dates for any wedding date, and the two
 * catalogs of titles have to stay in step so a Japanese seed is not half English.
 */

import { describe, expect, it } from 'vitest'
import { CATEGORIES, TEMPLATES, TEMPLATE_IDS, findTemplate, materialize } from '../src/lib/templates.js'
import { isValidDay } from '../src/lib/time.js'
import { taskToRow, validateTask } from '../src/schema.js'
import en from '../src/i18n/en.js'
import ja from '../src/i18n/ja.js'

let counter = 0
const newId = () => `id${counter++}`

describe('the templates themselves', () => {
  it('offers both traditions', () => {
    expect(TEMPLATE_IDS).toEqual(['classic12', 'japan8'])
    expect(findTemplate('nope')).toBeNull()
  })

  it('has a title in both languages for every task', () => {
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(item.en, `${template.id}: missing en`).toBeTruthy()
        expect(item.ja, `${template.id}: missing ja for "${item.en}"`).toBeTruthy()
      }
    }
  })

  it('only uses categories the default config offers', () => {
    // A template that seeds a category the picker does not list leaves somebody unable
    // to reproduce it when they add a task by hand.
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(CATEGORIES, `${template.id}: ${item.c}`).toContain(item.c)
      }
    }
  })

  it('has a catalog entry for every category, in both languages', () => {
    for (const category of CATEGORIES) {
      const key = `category.${category.toLowerCase()}`
      expect(en[key], `en is missing ${key}`).toBeTruthy()
      expect(ja[key], `ja is missing ${key}`).toBeTruthy()
    }
  })

  it('gives every task exactly one offset', () => {
    // The pair this replaced described a window. A task is a deadline now, so a leftover
    // `from` would be data nothing reads — and the symptom of reading the wrong one is a
    // whole board dated months early.
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(typeof item.d, `${template.id}: ${item.en}`).toBe('number')
        expect(item, `${template.id}: ${item.en}`).not.toHaveProperty('from')
        expect(item, `${template.id}: ${item.en}`).not.toHaveProperty('to')
      }
    }
  })

  it('keeps every offset inside a plausible planning horizon', () => {
    // Two years before to three months after. An offset outside that is a typo, and the
    // symptom would be a month group a year away from every other.
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(item.d).toBeGreaterThan(-730)
        expect(item.d).toBeLessThan(120)
      }
    }
  })

  it('is ordered so the seeded board reads forwards', () => {
    for (const template of TEMPLATES) {
      const offsets = template.tasks.map((item) => item.d)
      // Not strictly sorted — parallel workstreams legitimately overlap — but a
      // template that jumped from -60 back to -240 would produce a confusing first read.
      expect(Math.max(...offsets)).toBe(offsets[offsets.length - 1])
    }
  })
})

describe('materialize', () => {
  const day = '2027-04-18'

  it('produces tasks that validate and can be written', () => {
    for (const template of TEMPLATES) {
      const drafts = materialize(template, day, { locale: 'en', newId })
      expect(drafts).toHaveLength(template.tasks.length)
      for (const draft of drafts) {
        expect(validateTask(draft, isValidDay)).toEqual([])
        expect(() => taskToRow(draft)).not.toThrow()
      }
    }
  })

  it('counts back from the wedding day in calendar days', () => {
    const template = { id: 't', tasks: [{ c: 'Venue', d: -20, en: 'x', ja: 'x' }] }
    const [task] = materialize(template, day, { locale: 'en', newId })
    expect(task.due).toBe('2027-03-29')
  })

  it('writes a bare day with no clock time anywhere in it', () => {
    for (const template of TEMPLATES) {
      for (const draft of materialize(template, day, { locale: 'en', newId })) {
        expect(draft.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(draft).not.toHaveProperty('start')
        expect(draft).not.toHaveProperty('allDay')
      }
    }
  })

  it('dates the wedding day itself on the wedding day', () => {
    const template = { id: 't', tasks: [{ c: 'Other', d: 0, en: 'x', ja: 'x' }] }
    expect(materialize(template, day, { locale: 'en', newId })[0].due).toBe(day)
  })

  it('writes the titles in the requested language', () => {
    const [first] = materialize(findTemplate('japan8'), day, { locale: 'ja', newId })
    expect(first.title).toBe('ふたりで結婚式のイメージを固める')
    const [firstEn] = materialize(findTemplate('japan8'), day, { locale: 'en', newId })
    expect(firstEn.title).toBe('Agree on the style of wedding you want')
  })

  it('falls back to English for a language it has no titles in', () => {
    const [first] = materialize(findTemplate('classic12'), day, { locale: 'fr', newId })
    expect(first.title).toBe(findTemplate('classic12').tasks[0].en)
  })

  it('gives every task its own id', () => {
    const drafts = materialize(findTemplate('classic12'), day, { locale: 'en', newId })
    expect(new Set(drafts.map((draft) => draft.id)).size).toBe(drafts.length)
  })

  it('refuses a wedding day it cannot count from', () => {
    for (const bad of ['', '2027-04', 'next spring', null, undefined]) {
      expect(materialize(findTemplate('classic12'), bad, { locale: 'en', newId })).toEqual([])
    }
  })

  it('works across a leap day', () => {
    const template = { id: 't', tasks: [{ c: 'Venue', d: -1, en: 'x', ja: 'x' }] }
    expect(materialize(template, '2028-03-01', { locale: 'en', newId })[0].due).toBe('2028-02-29')
  })
})
