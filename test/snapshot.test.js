/**
 * The launch cache and the config parser. Both fail invisibly: a snapshot that seeds
 * tasks without their config renders the countdown against the wrong zone, and a config
 * parser that returns an empty list instead of omitting a key leaves the category picker
 * with nothing in it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSnapshot, writeSnapshot } from '../src/lib/snapshot.js'
import {
  CONFIG_FIELDS,
  DEFAULT_CONFIG,
  STORAGE_KEYS,
  mergeConfig,
  parseConfig,
  serializeConfig,
  weddingDay,
} from '../src/config.js'

let store

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  })
  // The redundant-write memo is module state, so it outlives a test. Writing a payload no test
  // uses and then emptying the store parks it somewhere harmless, which is what a fresh store
  // alone cannot do: without this, the second test to write TASKS/CONFIG would be short-circuited
  // and see an empty store.
  writeSnapshot([{ id: '__memo__' }], {})
  store.clear()
})

const TASKS = [{ id: 'a', title: 'Book the venue', due: '2027-01-01' }]
const CONFIG = { weddingDate: '2027-04-18', timezone: 'Asia/Tokyo' }

describe('snapshot', () => {
  it('round-trips tasks and config', () => {
    writeSnapshot(TASKS, CONFIG)
    expect(readSnapshot()).toEqual({ tasks: TASKS, config: CONFIG })
  })

  it('is null before anything is written', () => {
    expect(readSnapshot()).toBeNull()
  })

  it('stores the PRE-MERGE config', () => {
    // A merged copy would freeze the building build's defaults into every future launch,
    // so a changed default would not take effect until a network read landed.
    writeSnapshot(TASKS, { timezone: 'Europe/Paris' })
    expect(readSnapshot().config).toEqual({ timezone: 'Europe/Paris' })
  })

  it('drops optimistic and derived fields', () => {
    // `pending` would come back looking like a saved task; `progress` and `subtasks` are both
    // rebuilt from the flat rows on every read, and persisting them would re-seed a stale
    // percentage on each cold launch.
    writeSnapshot(
      [{ ...TASKS[0], pending: true, progress: { percent: 0.5 }, subtasks: [{ id: 'x' }] }],
      CONFIG,
    )
    const stored = readSnapshot().tasks[0]
    expect(stored).not.toHaveProperty('pending')
    expect(stored).not.toHaveProperty('progress')
    expect(stored).not.toHaveProperty('subtasks')
  })

  it('ignores an unrecognised version rather than migrating it', () => {
    // A drop marker, never a migration: re-fetching is free, because the sheet is the
    // source of truth and this is only a cache.
    store.set(STORAGE_KEYS.snapshot, JSON.stringify({ v: 999, tasks: [], config: {} }))
    expect(readSnapshot()).toBeNull()
  })

  it('ignores a corrupt or structurally wrong payload', () => {
    for (const bad of [
      'not json',
      JSON.stringify({ v: 2, tasks: 'nope', config: {} }),
      JSON.stringify({ v: 2, tasks: [], config: null }),
    ]) {
      store.set(STORAGE_KEYS.snapshot, bad)
      expect(readSnapshot()).toBeNull()
    }
  })

  it('skips a redundant write', () => {
    writeSnapshot(TASKS, CONFIG)
    const first = store.get(STORAGE_KEYS.snapshot)
    store.delete(STORAGE_KEYS.snapshot)
    // Same payload: the memo short-circuits, so nothing is written back.
    writeSnapshot(TASKS, CONFIG)
    expect(store.has(STORAGE_KEYS.snapshot)).toBe(false)
    // A different payload writes again.
    writeSnapshot([...TASKS, { id: 'b', title: 'x' }], CONFIG)
    expect(store.get(STORAGE_KEYS.snapshot)).not.toBe(first)
  })

  it('survives storage that throws', () => {
    // Safari in private browsing rejects writes outright. This is a cache, so a failure
    // must never be fatal.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
    })
    expect(() => writeSnapshot(TASKS, CONFIG)).not.toThrow()
    expect(readSnapshot()).toBeNull()
  })
})

describe('parseConfig', () => {
  it('maps every declared field', () => {
    const parsed = parseConfig({
      partner1_name: 'Aoi',
      partner2_name: 'Ren',
      wedding_date: '2027-04-18',
      venue: 'Meguro',
      timezone: 'Asia/Tokyo',
      categories: 'Venue, Attire , Guests',
    })
    expect(parsed).toEqual({
      partner1Name: 'Aoi',
      partner2Name: 'Ren',
      weddingDate: '2027-04-18',
      venue: 'Meguro',
      timezone: 'Asia/Tokyo',
      categories: ['Venue', 'Attire', 'Guests'],
    })
  })

  it('OMITS a blank value so the default wins', () => {
    // Returning '' would override the default with nothing; omitting lets mergeConfig
    // supply it. This is the difference between a category picker and an empty dropdown.
    const parsed = parseConfig({ timezone: '   ', categories: '' })
    expect(parsed).not.toHaveProperty('timezone')
    expect(parsed).not.toHaveProperty('categories')
    expect(mergeConfig(parsed).categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('never returns an empty list', () => {
    expect(parseConfig({ categories: ' , , ' })).not.toHaveProperty('categories')
  })

  it('ignores keys it does not know', () => {
    expect(parseConfig({ nonsense: 'x' })).toEqual({})
    expect(parseConfig(null)).toEqual({})
  })

  it('round-trips through serializeConfig', () => {
    const partial = { weddingDate: '2027-04-18', categories: ['Venue', 'Attire'] }
    expect(parseConfig(serializeConfig(partial))).toEqual(partial)
  })

  it('serialises only the fields present', () => {
    expect(serializeConfig({ venue: 'Meguro' })).toEqual({ venue: 'Meguro' })
  })

  it('declares a sheet key and a camelCase field for each entry', () => {
    for (const field of CONFIG_FIELDS) {
      expect(field.key).toMatch(/^[a-z0-9_]+$/)
      expect(field.field).toMatch(/^[a-z][A-Za-z0-9]*$/)
      expect(['text', 'list']).toContain(field.kind)
    }
  })
})

describe('mergeConfig', () => {
  it('clones the default list so a caller cannot corrupt it', () => {
    const first = mergeConfig({})
    first.categories.push('Mutated')
    expect(mergeConfig({}).categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('survives null', () => {
    expect(mergeConfig(null).timezone).toBe(DEFAULT_CONFIG.timezone)
  })
})

describe('weddingDay', () => {
  it('is the stored date, trimmed', () => {
    expect(weddingDay({ weddingDate: ' 2027-04-18 ' })).toBe('2027-04-18')
  })

  it('is empty with no date', () => {
    // '' rather than today: a placeholder date on a wedding hero is worse than a gap, and
    // the templates count backwards from this.
    expect(weddingDay({ weddingDate: '' })).toBe('')
    expect(weddingDay({})).toBe('')
    expect(weddingDay(null)).toBe('')
  })

  it('declares no ceremony TIME, because nothing on the board is timed', () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty('weddingTime')
  })
})
