/**
 * Calendar days, and the one place a zone is resolved.
 *
 * A task's `due` is a WALL-CLOCK DAY — "2027-04-18", no time, no offset, no Z. It
 * means that date on a calendar at the wedding, and the only question ever asked of
 * it is "has it passed, and by how many days" — answered against the board's
 * configured `timezone` (an IANA name like `Asia/Tokyo`). That is the whole reason
 * this module exists: "due on the 18th" has to say the 18th to a planner working
 * from another country, which a UTC instant rendered in the device's own zone would
 * not. The device's zone is never consulted for a task's date.
 *
 * Three rules that a "simplification" would break:
 *
 *   Never `new Date('2027-04-18')`. That parses as UTC midnight and renders as the
 *   17th anywhere west of Greenwich. Every Date here is built from explicit parts.
 *
 *   To FORMAT a day, build the instant as if the parts were UTC and format with
 *   `timeZone: 'UTC'`. Formatting it in the board's zone would apply an offset to a
 *   value that has none.
 *
 *   The zone is needed for exactly ONE thing: deciding what today's date is. Two
 *   day strings are then compared as arithmetic on their parts, so no offset is ever
 *   sampled, no wall time inside a spring-forward gap is ever solved for, and no
 *   instant is cached. Anything that needs one of those is asking about a moment
 *   rather than a date, which the model has no answer for.
 */

/** The stored shape. */
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Used when the sheet has no `timezone` value and by every default. */
export const FALLBACK_TIME_ZONE = 'Asia/Tokyo'

const MS_PER_DAY = 86_400_000

const dayFormatters = new Map()
const displayFormatters = new Map()

/**
 * Zone-name validity, memoised.
 *
 * `new Intl.DateTimeFormat` is the expensive call in this module — tens of microseconds —
 * and `resolveTimeZone` sits on the path of every date question the app asks. A plain
 * `Map` rather than a bounded cache: the keys are zone names out of the board config,
 * which is a set of one in practice and could never be attacker-controlled.
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
 * Parse and CALENDAR-VALIDATE. "2027-02-31" matches the pattern and is not a date,
 * and a task whose date is nonsense must read as an error rather than silently
 * landing in March.
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
 * The `slice(0, 10)` is not cosmetic: a cell somebody hand-edited in the Sheets UI reaches the
 * anonymous read through `Code.gs`'s `readCell` as "2027-04-18T00:00", and rows out on live
 * boards can carry a clock time of their own. Both mean that day.
 */
export function normalizeDay(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(' ', 'T')
    .slice(0, 10)
  return isValidDay(raw) ? raw : ''
}

function pad(number) {
  return String(number).padStart(2, '0')
}

/**
 * The three ways the app takes a day string apart, and THE ONLY PLACE THAT KNOWS ITS LAYOUT.
 *
 * Nothing outside this module may index into `YYYY-MM-DD`. A `slice(0, 7)` in a component is a
 * second file that knows where the hyphens are, and there is no reason for one to: everything
 * above compares two day strings, prints one, or groups by month. All three go through here, and
 * all three normalise first, so a cell holding `2027-04-18T00:00` behaves like the day it means.
 *
 * `monthOf` returns '' for anything unusable, which is what an undated row wants — `Plan` groups on
 * the empty key, so a bad date lands in the same group as no date rather than in a group of its own.
 */
export function monthOf(day) {
  const normalized = normalizeDay(day)
  return normalized ? normalized.slice(0, 7) : ''
}

/** The day of the month as a NUMBER, for the column a row prints it in. 0 if unusable. */
export function dayOfMonth(day) {
  const parts = parseDay(normalizeDay(day))
  return parts ? parts.day : 0
}

/** A 'YYYY-MM' key back to a real day, so it can be formatted. '' if unusable. */
export function firstOfMonth(monthKey) {
  const candidate = `${String(monthKey ?? '').trim()}-01`
  return isValidDay(candidate) ? candidate : ''
}

/**
 * Calendar-day arithmetic on a day string. Zone-free on purpose: adding a day to a
 * date means the next date on the calendar, which is what a template offset ("90
 * days before the wedding") means, and it stays true across a DST boundary where
 * adding 86,400,000ms to an instant would not.
 */
export function addDays(day, days) {
  const parts = parseDay(normalizeDay(day))
  if (!parts) return ''
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * Whole calendar days from `from` to `to`, signed. Both are day strings, so this is
 * plain arithmetic on their parts — no instants, no offsets, and no 24-hour blocks
 * that a DST transition could make 23 or 25.
 *
 * @returns {number|null} null when either day is unusable
 */
export function daysBetween(from, to) {
  const a = parseDay(normalizeDay(from))
  const b = parseDay(normalizeDay(to))
  if (!a || !b) return null
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  )
}

/**
 * Today's date, as a day string, in the board's zone.
 *
 * THE ONLY PLACE THE ZONE IS USED. Everything downstream compares day strings, so
 * this single call is what makes "overdue" mean overdue at the venue rather than
 * wherever the phone happens to be. `en-CA` yields YYYY-MM-DD directly, which is
 * the stored shape.
 *
 * `nowMs` is required: the clock reaches this module from `useNow` through the render,
 * so nothing here reads `Date.now()` behind React's back.
 */
export function todayIn(timeZone, nowMs) {
  return dayFormatter(resolveTimeZone(timeZone)).format(new Date(nowMs))
}

/**
 * Whole days from now until a day, counted in CALENDAR days in the board's zone
 * rather than in 24-hour blocks. "3 days to go" has to flip at midnight, not at
 * whatever o'clock the countdown started.
 */
export function daysUntil(day, timeZone, nowMs) {
  return daysBetween(todayIn(timeZone, nowMs), day)
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * A Date whose UTC fields hold the day's parts, for formatting with
 * `timeZone: 'UTC'`. See the module header: this is how a zoneless day is rendered
 * without an offset being applied to it.
 */
function asUtcDate(day) {
  const parts = parseDay(normalizeDay(day))
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
 * 'Apr 18' / '4月18日'.
 *
 * @param {string} day
 * @param {object} [opts]
 * @param {string} [opts.locale] undefined means the runtime locale
 * @param {boolean} [opts.year] include the year
 */
export function formatDay(day, { locale, year = false } = {}) {
  const date = asUtcDate(day)
  if (!date) return ''
  return displayFormatter(locale, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  }).format(date)
}

/**
 * 'Sat, 18 April 2027' / '2027年4月18日(土)' — the date spelled out, for an open row.
 *
 * The WEEKDAY is the reason this exists rather than reusing `formatDay`. A collapsed row prints a
 * bare day number under a month heading, which is what it should print; "is that a Saturday" is a
 * real question about a wedding task and the answer is nowhere else on screen.
 */
export function formatDayLong(day, { locale } = {}) {
  const date = asUtcDate(day)
  if (!date) return ''
  return displayFormatter(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/** 'April 2027' / '2027年4月' — the list's group headings. */
export function formatDayMonth(day, { locale } = {}) {
  const date = asUtcDate(day)
  if (!date) return ''
  return displayFormatter(locale, { year: 'numeric', month: 'long' }).format(date)
}
