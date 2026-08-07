/**
 * The starter checklists. These are content, but two properties of them are load
 * bearing: the offsets have to produce usable windows for any wedding date, and the two
 * catalogs of titles have to stay in step so a Japanese seed is not half English.
 */

import { describe, expect, it } from 'vitest'
import { CATEGORIES, TEMPLATES, TEMPLATE_IDS, findTemplate, materialize } from '../src/lib/templates.js'
import { isValidWall, wallToInstant } from '../src/lib/time.js'
import { taskToRow, validateTask } from '../src/schema.js'
import en from '../src/i18n/en.js'
import ja from '../src/i18n/ja.js'

const TOKYO = 'Asia/Tokyo'
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

  it('never closes a window before it opens', () => {
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(item.to, `${template.id}: ${item.en}`).toBeGreaterThanOrEqual(item.from)
      }
    }
  })

  it('keeps every offset inside a plausible planning horizon', () => {
    // Two years before to three months after. An offset outside that is a typo, and the
    // symptom would be a timeline stretched flat by one stray bar.
    for (const template of TEMPLATES) {
      for (const item of template.tasks) {
        expect(item.from).toBeGreaterThan(-730)
        expect(item.to).toBeLessThan(120)
      }
    }
  })

  it('is ordered so the seeded board reads forwards', () => {
    for (const template of TEMPLATES) {
      const starts = template.tasks.map((item) => item.from)
      // Not strictly sorted — parallel workstreams legitimately overlap — but a
      // template that jumped from -60 back to -240 would produce a confusing first read.
      expect(Math.max(...starts)).toBe(starts[starts.length - 1])
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
        expect(validateTask(draft, isValidWall)).toEqual([])
        expect(() => taskToRow(draft)).not.toThrow()
      }
    }
  })

  it('counts back from the wedding day in calendar days', () => {
    const template = { id: 't', months: 1, tasks: [{ c: 'Venue', from: -30, to: -20, en: 'x', ja: 'x' }] }
    const [task] = materialize(template, day, { locale: 'en', newId })
    expect(task.start).toBe('2027-03-19T00:00')
    expect(task.end).toBe('2027-03-29T23:59')
  })

  it('makes every window all-day, opening at midnight and closing at 23:59', () => {
    for (const template of TEMPLATES) {
      for (const draft of materialize(template, day, { locale: 'en', newId })) {
        expect(draft.allDay).toBe(true)
        expect(draft.start.endsWith('T00:00')).toBe(true)
        // Not the next midnight: a seeded task due on a day must be overdue the morning
        // after, not 99% complete.
        expect(draft.end.endsWith('T23:59')).toBe(true)
      }
    }
  })

  it('gives a same-day task a real span rather than a zero-length one', () => {
    const template = { id: 't', months: 1, tasks: [{ c: 'Other', from: 0, to: 0, en: 'x', ja: 'x' }] }
    const [task] = materialize(template, day, { locale: 'en', newId })
    expect(wallToInstant(task.end, TOKYO)).toBeGreaterThan(wallToInstant(task.start, TOKYO))
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
    const template = { id: 't', months: 1, tasks: [{ c: 'Venue', from: -1, to: 0, en: 'x', ja: 'x' }] }
    const [task] = materialize(template, '2028-03-01', { locale: 'en', newId })
    expect(task.start).toBe('2028-02-29T00:00')
  })
})
