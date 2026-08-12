/**
 * Wall-clock time and zone resolution.
 *
 * The DST cases are the point of this file. Everything else in the app is correct in
 * `Asia/Tokyo` by accident — Japan has no DST — so a zone that does is the only thing
 * that exercises `wallToInstant`'s two-pass correction.
 */

import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysUntil,
  endOfDay,
  formatWall,
  formatWallChip,
  formatWallMonth,
  formatWallRange,
  instantToWall,
  isValidTimeZone,
  isValidWall,
  normalizeWall,
  offsetMsAt,
  parseWall,
  FALLBACK_TIME_ZONE,
  resolveTimeZone,
  startOfDay,
  wallDay,
  wallToInstant,
} from '../src/lib/time.js'

const TOKYO = 'Asia/Tokyo'
const LA = 'America/Los_Angeles'

describe('parseWall', () => {
  it('accepts the stored shape', () => {
    expect(parseWall('2027-04-18T14:30')).toEqual({
      year: 2027,
      month: 4,
      day: 18,
      hour: 14,
      minute: 30,
    })
  })

  it('rejects a date that matches the pattern but is not a date', () => {
    // The whole reason this is calendar-validated: without the day check, this
    // silently becomes 3 March and a task moves a month.
    expect(parseWall('2027-02-31T00:00')).toBeNull()
    expect(parseWall('2027-13-01T00:00')).toBeNull()
    expect(parseWall('2027-04-18T24:00')).toBeNull()
    expect(parseWall('2027-04-18T12:60')).toBeNull()
  })

  it('knows about leap years', () => {
    expect(isValidWall('2028-02-29T00:00')).toBe(true)
    expect(isValidWall('2027-02-29T00:00')).toBe(false)
    // 2100 is not a leap year: divisible by 100, not by 400.
    expect(isValidWall('2100-02-29T00:00')).toBe(false)
  })

  it('rejects anything else', () => {
    for (const input of ['', null, undefined, 'tomorrow', '2027-04-18', '2027-04-18T14:30:00']) {
      expect(isValidWall(input)).toBe(false)
    }
  })
})

describe('normalizeWall', () => {
  it('reads a bare day as midnight', () => {
    expect(normalizeWall('2027-04-18')).toBe('2027-04-18T00:00')
  })

  it('tolerates what the Sheets UI produces', () => {
    expect(normalizeWall('2027-04-18 14:30')).toBe('2027-04-18T14:30')
    expect(normalizeWall('2027-04-18T14:30:00')).toBe('2027-04-18T14:30')
  })

  it('returns empty rather than a partial', () => {
    expect(normalizeWall('nonsense')).toBe('')
    expect(normalizeWall('')).toBe('')
  })
})

describe('zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone(TOKYO)).toBe(true)
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('falls back rather than throwing', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone('')).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone(TOKYO)).toBe(TOKYO)
  })

  it('caches the offset without letting a DST day poison it', () => {
    // The cache is keyed by hour, not day. 2027-03-14 is the US spring-forward: 01:00 local
    // is still PST and 04:00 local is PDT, on the same calendar day. A day-keyed cache would
    // hand the second lookup the first one's answer and put every task an hour out.
    const before = wallToInstant('2027-03-14T01:00', LA)
    const after = wallToInstant('2027-03-14T04:00', LA)
    expect(offsetMsAt(before, LA)).toBe(-8 * 3_600_000)
    expect(offsetMsAt(after, LA)).toBe(-7 * 3_600_000)
    // And repeated lookups (which is what a ticking clock does) stay correct.
    expect(offsetMsAt(before, LA)).toBe(-8 * 3_600_000)
    expect(offsetMsAt(after, LA)).toBe(-7 * 3_600_000)
  })

  it('reports the offset east of UTC', () => {
    const at = Date.UTC(2027, 3, 18, 0, 0)
    expect(offsetMsAt(at, TOKYO)).toBe(9 * 3_600_000)
    // Los Angeles is on daylight time in April: UTC-7, not UTC-8.
    expect(offsetMsAt(at, LA)).toBe(-7 * 3_600_000)
    expect(offsetMsAt(Date.UTC(2027, 0, 18, 0, 0), LA)).toBe(-8 * 3_600_000)
  })
})

describe('wallToInstant', () => {
  it('round-trips through instantToWall', () => {
    for (const zone of [TOKYO, LA, 'Europe/London', 'UTC']) {
      for (const wall of ['2027-04-18T14:30', '2027-01-01T00:00', '2027-12-31T23:59']) {
        expect(instantToWall(wallToInstant(wall, zone), zone)).toBe(wall)
      }
    }
  })

  it('resolves a Tokyo wall clock nine hours behind UTC', () => {
    // 14:00 JST is 05:00 UTC. If this is off by nine hours, every percentage in the
    // app is off by nine hours.
    expect(wallToInstant('2027-04-18T14:00', TOKYO)).toBe(Date.UTC(2027, 3, 18, 5, 0))
  })

  it('uses the offset in force at the instant, not at UTC midnight', () => {
    // 2027-03-14 is the US spring-forward. 12:00 on the 13th is PST (-8); 12:00 on the
    // 15th is PDT (-7). A single-pass conversion gets one of these wrong.
    expect(wallToInstant('2027-03-13T12:00', LA)).toBe(Date.UTC(2027, 2, 13, 20, 0))
    expect(wallToInstant('2027-03-15T12:00', LA)).toBe(Date.UTC(2027, 2, 15, 19, 0))
  })

  it('pushes a nonexistent spring-forward time forward, never backward', () => {
    // 02:30 on 2027-03-14 does not exist in Los Angeles: the clocks go 02:00 -> 03:00.
    // The naive two-pass solve maps it to 01:30, an hour EARLIER than anybody typed,
    // which would silently start a task before its own window. It has to land after
    // the jump instead.
    const instant = wallToInstant('2027-03-14T02:30', LA)
    expect(Number.isFinite(instant)).toBe(true)
    expect(instant).toBeGreaterThan(wallToInstant('2027-03-14T01:59', LA))
    expect(instantToWall(instant, LA)).toBe('2027-03-14T03:30')
  })

  it('resolves an ambiguous fall-back time to its first reading', () => {
    // 01:30 on 2027-11-07 happens twice in Los Angeles. Either is defensible; the
    // first is what this picks, and pinning it stops that changing silently.
    const instant = wallToInstant('2027-11-07T01:30', LA)
    expect(offsetMsAt(instant, LA)).toBe(-7 * 3_600_000)
  })

  it('is NaN for an unusable wall string', () => {
    expect(wallToInstant('2027-02-31T00:00', TOKYO)).toBeNaN()
    expect(wallToInstant('', TOKYO)).toBeNaN()
  })
})

describe('addDays', () => {
  it('is calendar arithmetic, not 86,400,000ms', () => {
    expect(addDays('2027-04-18T14:00', 1)).toBe('2027-04-19T14:00')
    expect(addDays('2027-04-18T14:00', -365)).toBe('2026-04-18T14:00')
  })

  it('crosses months and leap days', () => {
    expect(addDays('2028-02-28T00:00', 1)).toBe('2028-02-29T00:00')
    expect(addDays('2027-12-31T00:00', 1)).toBe('2028-01-01T00:00')
  })

  it('keeps the clock reading across a DST boundary', () => {
    // The point of doing this in wall-clock space: adding a day to 12:00 the day
    // before a transition must give 12:00, not 11:00 or 13:00.
    expect(addDays('2027-03-13T12:00', 1)).toBe('2027-03-14T12:00')
  })
})

describe('day edges', () => {
  it('starts at midnight and ends at 23:59', () => {
    expect(startOfDay('2027-04-18T14:00')).toBe('2027-04-18T00:00')
    // NOT the next midnight: a task due Friday has to be overdue on Saturday
    // morning rather than 99% complete.
    expect(endOfDay('2027-04-18T14:00')).toBe('2027-04-18T23:59')
    expect(wallDay('2027-04-18T14:00')).toBe('2027-04-18')
  })
})

describe('daysUntil', () => {
  const wedding = '2027-04-18T14:00'

  it('counts calendar days in the board zone', () => {
    const now = wallToInstant('2027-04-11T23:00', TOKYO)
    expect(daysUntil(wedding, TOKYO, now)).toBe(7)
  })

  it('flips at midnight, not at the hour the page loaded', () => {
    // 23:59 and 00:01 either side of the same midnight must differ by one, which a
    // difference-in-milliseconds implementation gets wrong.
    const before = wallToInstant('2027-04-17T23:59', TOKYO)
    const after = wallToInstant('2027-04-18T00:01', TOKYO)
    expect(daysUntil(wedding, TOKYO, before)).toBe(1)
    expect(daysUntil(wedding, TOKYO, after)).toBe(0)
  })

  it('goes negative after the wedding', () => {
    expect(daysUntil(wedding, TOKYO, wallToInstant('2027-04-20T09:00', TOKYO))).toBe(-2)
  })

  it('is null with no date', () => {
    expect(daysUntil('', TOKYO, Date.now())).toBeNull()
  })
})

describe('formatting', () => {
  it('formats the wall clock without shifting it', () => {
    // The trap this guards: formatting via a plain Date in the runtime's own zone
    // renders 2027-01-01T00:00 as 31 December for anybody west of Greenwich.
    expect(formatWall('2027-01-01T00:00', { locale: 'en' })).toBe('Jan 1')
    expect(formatWall('2027-01-01T00:00', { locale: 'en', time: true })).toContain('00:00')
    expect(formatWallMonth('2027-04-01T00:00', { locale: 'en' })).toBe('April 2027')
  })

  it('collapses what the two ends of a range share', () => {
    const sameDay = formatWallRange('2027-04-18T14:00', '2027-04-18T15:30', {
      locale: 'en',
      nowWall: '2027-04-01T00:00',
    })
    expect(sameDay).toBe('Apr 18 14:00–15:30')

    expect(
      formatWallRange('2027-04-18T00:00', '2027-04-18T23:59', {
        allDay: true,
        locale: 'en',
        nowWall: '2027-04-01T00:00',
      }),
    ).toBe('Apr 18')
  })

  it('shows the year only when the window leaves the current one', () => {
    const thisYear = formatWallRange('2027-04-18T00:00', '2027-05-02T23:59', {
      allDay: true,
      locale: 'en',
      nowWall: '2027-01-01T00:00',
    })
    expect(thisYear).not.toContain('2027')

    const nextYear = formatWallRange('2028-04-18T00:00', '2028-05-02T23:59', {
      allDay: true,
      locale: 'en',
      nowWall: '2027-01-01T00:00',
    })
    expect(nextYear).toContain('2028')
  })

  it('survives a half-open range', () => {
    expect(formatWallRange('', '', {})).toBe('')
    expect(formatWallRange('2027-04-18T00:00', '', { allDay: true, locale: 'en' })).toContain('18')
  })
})

describe('formatWallChip', () => {
  it('splits a card chip into the day and the month above it', () => {
    // Two values rather than one string, because the card sets them at completely different
    // sizes — the day is what somebody scans a month of cards for.
    expect(formatWallChip('2027-04-18T00:00', { locale: 'en' })).toEqual({
      day: '18',
      month: 'APR',
    })
  })

  it('uppercases the month in JS, not with `text-transform`', () => {
    // CSS `text-transform` is forbidden anywhere Japanese can pass through: it is a no-op on
    // kanji, so a stylesheet holding both languages would silently uppercase the Latin half
    // only. `toLocaleUpperCase` is the locale-aware form and leaves '4月' exactly as it is.
    expect(formatWallChip('2027-04-18T00:00', { locale: 'ja' }).month).toBe('4月')
    expect(formatWallChip('2027-04-18T00:00', { locale: 'en' }).month).toBe('APR')
  })

  it('keeps the day a bare numeral in Japanese', () => {
    // The one deliberate exception to routing numbers through Intl. `{ day: 'numeric' }` in
    // `ja` returns '18日', which does not fit a 36px chip at --fs-xl and printed the day as
    // '18' / '日' on two rows with '4月' under it. A day is 1–31, so there is no grouping
    // separator for Intl to add and the suffix repeats the month directly beneath.
    expect(formatWallChip('2027-04-18T00:00', { locale: 'ja' })).toEqual({
      day: '18',
      month: '4月',
    })
  })

  it('is null rather than a plausible-looking wrong chip', () => {
    // A task with no dates has to render no chip at all. Inventing today, or the created-on
    // date, would put a date on the card that is nowhere in the sheet.
    expect(formatWallChip('', { locale: 'en' })).toBeNull()
    expect(formatWallChip('nonsense', { locale: 'en' })).toBeNull()
    // Calendar-invalid, not merely malformed — the same validation as `parseWall`, or this
    // chip would say "31" for a task that silently landed in March.
    expect(formatWallChip('2027-02-31T00:00', { locale: 'en' })).toBeNull()
  })
})
