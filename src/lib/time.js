/**
 * Calendar days, and the only place a zone is resolved.
 *
 * A task's `due` is a wall-clock day — '2027-04-18', no time, no offset. It means that date at the
 * wedding, so whether it has passed is decided against the board's configured IANA zone, never the
 * device's: "due on the 18th" must read as the 18th to a planner in another country.
 *
 * Three rules:
 *
 *   Never `new Date('2027-04-18')`. It parses as UTC midnight and renders as the 17th west of
 *   Greenwich. Every Date here is built from explicit parts.
 *
 *   To format a day, build the instant from its parts as if they were UTC and format with
 *   `timeZone: 'UTC'`. Formatting in the board's zone applies an offset to a value that has none.
 *
 *   The zone decides one thing: what today's date is (`todayIn`). Everything downstream compares
 *   two day strings, so no offset is sampled, no spring-forward gap is solved for and no instant is
 *   cached. Anything needing one of those is asking about a moment rather than a date, which this
 *   model does not represent.
 */

/** The stored shape. */
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Used when the sheet has no `timezone` value and by every default. */
export const FALLBACK_TIME_ZONE = 'Asia/Tokyo'

const MS_PER_DAY = 86_400_000

const dayFormatters = new Map()
const displayFormatters = new Map()

/**
 * Zone-name validity, memoised: `new Intl.DateTimeFormat` costs tens of microseconds and
 * `resolveTimeZone` sits on the path of every date question. Unbounded `Map`, the keys being zone
 * names out of the board config.
 */
const zoneValidity = new Map()

export function isValidTimeZone(name) {
  if (!name || typeof name !== 'string') return false
  const hit = zoneValidity.get(name)
  if (hit !== undefined) return hit
  let valid = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    valid = true
  } catch {
    valid = false
  }
  zoneValidity.set(name, valid)
  return valid
}

export function resolveTimeZone(name) {
  return isValidTimeZone(name) ? name : FALLBACK_TIME_ZONE
}

function dayFormatter(timeZone) {
  let format = dayFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayFormatters.set(timeZone, format)
  }
  return format
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Parse and calendar-validate. '2027-02-31' matches the pattern and is not a date; without the
 * check it would silently land in March.
 *
 * @returns {{year:number,month:number,day:number}|null}
 */
export function parseDay(day) {
  const match = DAY_PATTERN.exec(String(day ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  if (month < 1 || month > 12) return null
  if (date < 1 || date > daysInMonth(year, month)) return null
  return { year, month, day: date }
}

export function isValidDay(day) {
  return parseDay(day) !== null
}

/**
 * Accept what a person or a long-lived row might hold and return the stored shape.
 *
 * The `slice(0, 10)` is load-bearing: a hand-edited cell reaches the anonymous read through
 * `Code.gs`'s `readCell` as '2027-04-18T00:00', and live rows carry clock times of their own. Both
 * mean that day.
 */
export function normalizeDay(text) {
  const raw = String(text ?? '')
    .trim()
    .slice(0, 10)
  return isValidDay(raw) ? raw : ''
}

function pad(number) {
  return String(number).padStart(2, '0')
}

/**
 * A day's parts, tolerating the clock time a hand-edited cell arrives with — the composition every
 * accessor and every formatter below needs. `isValidDay` deliberately does NOT go through it:
 * `normalizeDay` is built on `isValidDay`, so a lenient one would be circular, and what it answers is
 * "may this be written", not "what does this cell mean".
 */
function partsOf(day) {
  return parseDay(normalizeDay(day))
}

/**
 * The four ways a day string is taken apart, and the only place that knows its layout. Nothing
 * outside this module may index into 'YYYY-MM-DD'. All of them normalise first, so a cell holding
 * '2027-04-18T00:00' behaves like the day it means; `yearOf` sits below with the formatters, being a
 * display question, and obeys the same rule.
 *
 * `monthOf` returns '' for anything unusable, so a bad date groups with the undated rows rather
 * than forming a group of its own.
 */
export function monthOf(day) {
  const normalized = normalizeDay(day)
  return normalized ? normalized.slice(0, 7) : ''
}

/** The day of the month as a number, for the column a row prints it in. 0 if unusable. */
export function dayOfMonth(day) {
  return partsOf(day)?.day ?? 0
}

/** A 'YYYY-MM' key back to a real day, so it can be formatted. '' if unusable. */
export function firstOfMonth(monthKey) {
  const candidate = `${String(monthKey ?? '').trim()}-01`
  return isValidDay(candidate) ? candidate : ''
}

/**
 * Calendar-day arithmetic, zone-free: adding a day means the next date on the calendar, which is
 * what a template offset ('90 days before the wedding') means and stays true across a DST boundary
 * where adding 86,400,000ms to an instant would not.
 */
export function addDays(day, days) {
  const parts = partsOf(day)
  if (!parts) return ''
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * Whole calendar days from `from` to `to`, signed. Arithmetic on the parts, so no offsets and no
 * 24-hour blocks a DST transition could make 23 or 25.
 *
 * @returns {number|null} null when either day is unusable
 */
export function daysBetween(from, to) {
  const a = partsOf(from)
  const b = partsOf(to)
  if (!a || !b) return null
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  )
}

/**
 * Today's date, as a day string, in the board's zone. The only use of the zone, and what makes
 * "overdue" mean overdue at the venue. `en-CA` yields YYYY-MM-DD, the stored shape.
 *
 * `nowMs` is required so nothing here reads `Date.now()` behind React's back; the clock arrives
 * from `useToday` through the render.
 */
export function todayIn(timeZone, nowMs) {
  return dayFormatter(resolveTimeZone(timeZone)).format(new Date(nowMs))
}

// --------------------------------------------------------------------------- Display
// ---------------------------------------------------------------------------

/** A Date whose UTC fields hold the day's parts, for the header's second rule. */
function asUtcDate(day) {
  const parts = partsOf(day)
  if (!parts) return null
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

function displayFormatter(locale, options) {
  const cacheKey = `${locale}|${JSON.stringify(options)}`
  let format = displayFormatters.get(cacheKey)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
    displayFormatters.set(cacheKey, format)
  }
  return format
}

/**
 * Every display below is this: parts to a UTC instant, formatted in UTC, '' for a day that is not
 * one. The four exports differ only in their options, and each is a NAME for a place in the ui —
 * which is why they are four exports rather than one with a shape argument at the call site.
 */
function formatted(day, locale, options) {
  const date = asUtcDate(day)
  return date ? displayFormatter(locale, options).format(date) : ''
}

/**
 * 'Apr 18' / '4月18日'.
 *
 * @param {string} day
 * @param {object} [opts]
 * @param {string} [opts.locale] undefined means the runtime locale
 * @param {boolean} [opts.year] include the year
 */
export function formatDay(day, { locale, year = false } = {}) {
  return formatted(day, locale, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  })
}

/**
 * 'Sat, 18 April 2027' / '2027年4月18日(土)' — for an open row. The weekday is why this exists rather
 * than reusing `formatDay`: a collapsed row prints a month and a day and no weekday, so "is that a
 * Saturday" is answered nowhere else on screen.
 */
export function formatDayLong(day, { locale } = {}) {
  return formatted(day, locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * 'Oct' / '10月' — the month line of a row's date column, and the one thing there that is NOT the
 * year: the year is what does not fit that box, and `.tcard__date` in app.css holds the figures. A
 * row states its year on the meta line instead, and only where nothing else on screen gives it one
 * — see `TaskCard`.
 */
export function formatMonth(day, { locale } = {}) {
  return formatted(day, locale, { month: 'short' })
}

/**
 * The calendar year, as a number, so nothing outside this module compares years by slicing. null
 * for anything unusable, which is what stops an undated row claiming to be in year zero.
 */
export function yearOf(day) {
  return partsOf(day)?.year ?? null
}

/** 'April 2027' / '2027年4月' — the list's group headings. */
export function formatDayMonth(day, { locale } = {}) {
  return formatted(day, locale, { year: 'numeric', month: 'long' })
}
