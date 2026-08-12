/**
 * Calendar days and zone resolution.
 *
 * The zone is now used for exactly ONE thing — deciding what today's date is — so that is
 * what this file leans on: a board in Tokyo and a device in Los Angeles must disagree about
 * "today" by a day for several hours, and everything downstream compares day strings.
 *
 * `formatDayChip`'s Japanese cases and the calendar validation are the other two places a
 * "simplification" has already gone wrong once each.
 */

import { describe, expect, it } from 'vitest'
import {
  FALLBACK_TIME_ZONE,
  addDays,
  daysBetween,
  daysUntil,
  formatDay,
  formatDayChip,
  formatDayMonth,
  isValidDay,
  isValidTimeZone,
  normalizeDay,
  parseDay,
  resolveTimeZone,
  todayIn,
} from '../src/lib/time.js'

const TOKYO = 'Asia/Tokyo'
const LA = 'America/Los_Angeles'

describe('parseDay', () => {
  it('accepts the stored shape', () => {
    expect(parseDay('2027-04-18')).toEqual({ year: 2027, month: 4, day: 18 })
  })

  it('rejects a date that matches the pattern but is not a date', () => {
    // The whole reason this is calendar-validated: without the day check, this silently
    // becomes 3 March and a task moves a month.
    expect(parseDay('2027-02-31')).toBeNull()
    expect(parseDay('2027-13-01')).toBeNull()
    expect(parseDay('2027-00-10')).toBeNull()
  })

  it('knows about leap years', () => {
    expect(isValidDay('2028-02-29')).toBe(true)
    expect(isValidDay('2027-02-29')).toBe(false)
    // 2100 is not a leap year: divisible by 100, not by 400.
    expect(isValidDay('2100-02-29')).toBe(false)
  })

  it('rejects anything else', () => {
    for (const input of ['', null, undefined, 'tomorrow', '2027-4-8', '2027-04-18T00:00']) {
      expect(isValidDay(input)).toBe(false)
    }
  })
})

describe('normalizeDay', () => {
  it('drops a clock time a legacy row or the Sheets UI carries', () => {
    // Every task on a board written before dates lost their times holds one of these, and
    // `readCell` reformats a hand-edited Date cell into exactly this shape.
    expect(normalizeDay('2027-04-18T23:59')).toBe('2027-04-18')
    expect(normalizeDay('2027-04-18 14:30')).toBe('2027-04-18')
    expect(normalizeDay('  2027-04-18  ')).toBe('2027-04-18')
  })

  it('returns empty rather than a partial', () => {
    expect(normalizeDay('nonsense')).toBe('')
    expect(normalizeDay('2027-02-31')).toBe('')
    expect(normalizeDay('')).toBe('')
    expect(normalizeDay(null)).toBe('')
  })
})

describe('zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone(TOKYO)).toBe(true)
    expect(isValidTimeZone(LA)).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('falls back rather than throwing', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone('')).toBe(FALLBACK_TIME_ZONE)
    expect(resolveTimeZone(TOKYO)).toBe(TOKYO)
  })
})

describe('todayIn', () => {
  it('answers in the BOARD zone, not the device one', () => {
    // 2027-04-18 15:00 UTC is the 19th in Tokyo and still the 18th in Los Angeles. This is
    // the one call the whole overdue rule rests on: read in the wrong zone, a task due on
    // the 18th stops being due somewhere between nine and sixteen hours early or late.
    const at = Date.UTC(2027, 3, 18, 15, 0)
    expect(todayIn(TOKYO, at)).toBe('2027-04-19')
    expect(todayIn(LA, at)).toBe('2027-04-18')
  })

  it('returns the stored shape, zero-padded', () => {
    expect(todayIn(TOKYO, Date.UTC(2027, 0, 5, 3, 0))).toBe('2027-01-05')
  })

  it('falls back for a nonsense zone rather than throwing', () => {
    expect(todayIn('Mars/Olympus', Date.UTC(2027, 3, 18, 0, 0))).toBe(
      todayIn(FALLBACK_TIME_ZONE, Date.UTC(2027, 3, 18, 0, 0)),
    )
  })
})

describe('daysBetween', () => {
  it('is signed calendar arithmetic', () => {
    expect(daysBetween('2027-04-18', '2027-04-25')).toBe(7)
    expect(daysBetween('2027-04-25', '2027-04-18')).toBe(-7)
    expect(daysBetween('2027-04-18', '2027-04-18')).toBe(0)
  })

  it('counts calendar days across a DST boundary, not 24-hour blocks', () => {
    // 2027-03-14 is the US spring-forward. Any implementation that subtracts instants in a
    // zone with DST reports 0.958 days here and rounds to the wrong side sooner or later.
    expect(daysBetween('2027-03-13', '2027-03-14')).toBe(1)
    expect(daysBetween('2027-11-06', '2027-11-07')).toBe(1)
  })

  it('crosses months, years and leap days', () => {
    expect(daysBetween('2027-12-31', '2028-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1)
  })

  it('tolerates a legacy value on either side', () => {
    expect(daysBetween('2027-04-18T09:00', '2027-04-20')).toBe(2)
  })

  it('is null when either day is unusable', () => {
    expect(daysBetween('', '2027-04-18')).toBeNull()
    expect(daysBetween('2027-04-18', 'nonsense')).toBeNull()
  })
})

describe('daysUntil', () => {
  const wedding = '2027-04-18'

  it('counts calendar days in the board zone', () => {
    expect(daysUntil(wedding, TOKYO, Date.UTC(2027, 3, 11, 14, 0))).toBe(7)
  })

  it('flips at midnight, not at the hour the page loaded', () => {
    // 23:59 and 00:01 either side of the same Tokyo midnight must differ by one, which a
    // difference-in-milliseconds implementation gets wrong.
    expect(daysUntil(wedding, TOKYO, Date.UTC(2027, 3, 17, 14, 59))).toBe(1)
    expect(daysUntil(wedding, TOKYO, Date.UTC(2027, 3, 17, 15, 1))).toBe(0)
  })

  it('goes negative after the wedding', () => {
    expect(daysUntil(wedding, TOKYO, Date.UTC(2027, 3, 20, 0, 0))).toBe(-2)
  })

  it('is null with no date', () => {
    expect(daysUntil('', TOKYO, Date.now())).toBeNull()
  })
})

describe('addDays', () => {
  it('is calendar arithmetic, not 86,400,000ms', () => {
    expect(addDays('2027-04-18', 1)).toBe('2027-04-19')
    expect(addDays('2027-04-18', -365)).toBe('2026-04-18')
    expect(addDays('2027-04-18', 0)).toBe('2027-04-18')
  })

  it('crosses months and leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01')
  })

  it('is unaffected by a DST boundary', () => {
    // The point of doing this in calendar space: the day after 2027-03-13 in Los Angeles is
    // the 14th, whatever happens to the clocks that morning.
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14')
  })

  it('is empty for an unusable day', () => {
    expect(addDays('nonsense', 1)).toBe('')
  })
})

describe('formatting', () => {
  it('formats a day without shifting it', () => {
    // The trap this guards: formatting via `new Date('2027-01-01')` renders 31 December for
    // anybody west of Greenwich, because that string parses as UTC midnight.
    expect(formatDay('2027-01-01', { locale: 'en' })).toBe('Jan 1')
    expect(formatDay('2027-01-01', { locale: 'en', year: true })).toContain('2027')
    expect(formatDayMonth('2027-04-01', { locale: 'en' })).toBe('April 2027')
  })

  it('accepts a legacy value, so an unmigrated row still renders', () => {
    expect(formatDay('2027-01-01T00:00', { locale: 'en' })).toBe('Jan 1')
  })

  it('is empty rather than a plausible-looking wrong date', () => {
    expect(formatDay('', { locale: 'en' })).toBe('')
    expect(formatDay('2027-02-31', { locale: 'en' })).toBe('')
    expect(formatDayMonth('', { locale: 'en' })).toBe('')
  })
})

describe('formatDayChip', () => {
  it('splits a chip into the day and the month', () => {
    expect(formatDayChip('2027-04-18', { locale: 'en' })).toEqual({ day: '18', month: 'APR' })
  })

  it('uppercases the month in JS, not with `text-transform`', () => {
    // CSS `text-transform` is forbidden anywhere Japanese can pass through: it is a no-op on
    // kanji, so a stylesheet holding both languages would silently uppercase the Latin half
    // only. `toLocaleUpperCase` is the locale-aware form and leaves '4月' exactly as it is.
    expect(formatDayChip('2027-04-18', { locale: 'ja' }).month).toBe('4月')
    expect(formatDayChip('2027-04-18', { locale: 'en' }).month).toBe('APR')
  })

  it('keeps the day a bare numeral in Japanese', () => {
    // The one deliberate exception to routing numbers through Intl. `{ day: 'numeric' }` in
    // `ja` returns '18日', which does not fit the chip at --fs-xl and printed the day on two
    // rows. A day is 1–31, so there is no grouping separator for Intl to add.
    expect(formatDayChip('2027-04-18', { locale: 'ja' }).day).toBe('18')
  })

  it('is null rather than a plausible-looking wrong chip', () => {
    // A task with no date has to render no chip at all. Inventing today, or the created-on
    // date, would put a date on the row that is nowhere in the sheet.
    expect(formatDayChip('', { locale: 'en' })).toBeNull()
    expect(formatDayChip('nonsense', { locale: 'en' })).toBeNull()
    // Calendar-invalid, not merely malformed — the same validation as `parseDay`, or this
    // chip would say "31" for a task that silently landed in March.
    expect(formatDayChip('2027-02-31', { locale: 'en' })).toBeNull()
  })
})
