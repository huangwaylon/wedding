/**
 * Wall-clock time, and the one place a zone is resolved.
 *
 * A task's `start` and `end` are WALL-CLOCK strings — "2027-04-18T14:00", no
 * offset, no Z. They mean that reading of a clock at the wedding, and they are
 * resolved against the board's configured `timezone` (an IANA name like
 * `Asia/Tokyo`). This is deliberate and it is the whole reason this module
 * exists: "the ceremony is at 14:00" has to say 14:00 to a planner working from
 * another country, which a UTC instant rendered in the device's own zone would
 * not. The device's zone is never consulted for a task time.
 *
 * Two rules that a "simplification" would break:
 *
 *   Never `new Date('2027-04-18')`. That parses as UTC midnight and renders as
 *   the 17th anywhere west of Greenwich. Every Date here is built from explicit
 *   parts.
 *
 *   To FORMAT a wall-clock string, build the instant as if the parts were UTC and
 *   format with `timeZone: 'UTC'`. Formatting it in the board's zone would apply
 *   the offset a second time.
 *
 * Progress needs real instants, though — "how far through this window are we
 * right now" is a question about the actual moment — so `wallToInstant` does the
 * conversion properly, DST included.
 */

/** The stored shape. Minutes precision: a wedding schedule has no use for seconds. */
const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Used when the sheet has no `timezone` value and by every default. */
export const FALLBACK_TIME_ZONE = 'Asia/Tokyo'

const MS_PER_DAY = 86_400_000

const offsetFormatters = new Map()
const displayFormatters = new Map()

/**
 * Zone offsets, cached by zone and hour.
 *
 * `formatToParts` is the expensive call in this module and it is made a lot: every task
 * needs two `wallToInstant`s, each of which samples the offset twice, and the whole board
 * is recomputed once a minute as the clock ticks. A fifty-task board is therefore ~400
 * `formatToParts` calls a minute, all of them re-deriving the same handful of answers.
 *
 * Keyed by the HOUR the instant falls in, not the day: DST transitions happen on the hour,
 * so an hour bucket can never straddle one, while a day bucket would return the wrong
 * offset for every lookup on a transition day. Across ticks the same buckets recur, so
 * after the first pass this is nearly all hits.
 */
const offsetCache = new Map()

/** Bounded so a long-lived tab cannot grow this without limit. */
const OFFSET_CACHE_MAX = 4096
const MS_PER_HOUR = 3_600_000

/**
 * `hour12: false` rather than `hourCycle: 'h23'` for reach, which means some
 * engines report midnight as hour 24 — normalised at both call sites.
 */
function offsetFormatter(timeZone) {
  let format = offsetFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    offsetFormatters.set(timeZone, format)
  }
  return format
}

function partsIn(instantMs, timeZone) {
  const found = {}
  for (const part of offsetFormatter(timeZone).formatToParts(new Date(instantMs))) {
    found[part.type] = part.value
  }
  const hour = Number(found.hour) === 24 ? 0 : Number(found.hour)
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour,
    minute: Number(found.minute),
    second: Number(found.second),
  }
}

export function isValidTimeZone(name) {
  if (!name || typeof name !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

export function resolveTimeZone(name) {
  return isValidTimeZone(name) ? name : FALLBACK_TIME_ZONE
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Parse and CALENDAR-VALIDATE. "2027-02-31" matches the pattern and is not a
 * date, and a task whose start is nonsense must read as an error rather than
 * silently landing in March.
 *
 * @returns {{year:number,month:number,day:number,hour:number,minute:number}|null}
 */
export function parseWall(wall) {
  const match = WALL_PATTERN.exec(String(wall ?? ''))
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59) return null
  return { year, month, day, hour, minute }
}

export function isValidWall(wall) {
  return parseWall(wall) !== null
}

/**
 * Accept what a person or an older row might hold and return the stored shape.
 * A bare "2027-04-18" is a legitimate thing to find in a hand-edited cell; it
 * means midnight that day.
 */
export function normalizeWall(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  if (DAY_PATTERN.test(raw)) return `${raw}T00:00`
  // Tolerate seconds and a space separator, both of which the Sheets UI produces.
  const relaxed = raw.replace(' ', 'T').slice(0, 16)
  return isValidWall(relaxed) ? relaxed : ''
}

function pad(number) {
  return String(number).padStart(2, '0')
}

function formatParts({ year, month, day, hour, minute }) {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

/** The wall-clock day, without its time. */
export function wallDay(wall) {
  return String(wall ?? '').slice(0, 10)
}

export function startOfDay(wall) {
  return `${wallDay(wall)}T00:00`
}

/**
 * 23:59, not the next midnight. An all-day task's window has to END inside the
 * day it names, or a task "due Friday" reads as still running on Saturday
 * morning and the UI calls it 99% rather than overdue.
 */
export function endOfDay(wall) {
  return `${wallDay(wall)}T23:59`
}

/**
 * Calendar-day arithmetic on a wall-clock string. Zone-free on purpose: adding a
 * day to a wall clock means the same clock reading tomorrow, which is what a
 * template offset ("90 days before the wedding") means, and it stays true across
 * a DST boundary where adding 86,400,000ms would not.
 */
export function addDays(wall, days) {
  const parts = parseWall(normalizeWall(wall))
  if (!parts) return ''
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute),
  )
  return formatParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  })
}

/**
 * Wall clock -> the actual instant, in the board's zone.
 *
 * Two offset lookups, not one. The offset has to be sampled at the instant being
 * computed, but that instant is what we are solving for, so: guess with the
 * offset at the naive reading, then re-solve with the offset at the guess. The
 * pair only differ within a DST transition, and one correction settles it.
 *
 * The round-trip check is the non-obvious half. A wall time inside a spring-forward
 * gap does not exist, and for those the second pass lands BEFORE the gap — 02:30 on a
 * US spring-forward day comes back as 01:30, an hour earlier than anybody typed. So
 * the result is verified by converting it back: if it does not reproduce the requested
 * reading, the first pass is used instead, which lands just after the jump. Forward is
 * the right direction for a deadline.
 *
 * An ambiguous fall-back time — one that happens twice — resolves to the first of its
 * two readings, which the round-trip accepts. `Asia/Tokyo`, the default, has no DST at
 * all, so none of this fires there.
 *
 * @returns {number} epoch ms, or NaN when the wall string is unusable
 */
export function wallToInstant(wall, timeZone) {
  const normalized = normalizeWall(wall)
  const parts = parseWall(normalized)
  if (!parts) return NaN
  const zone = resolveTimeZone(timeZone)
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const firstPass = naive - offsetMsAt(naive, zone)
  const secondPass = naive - offsetMsAt(firstPass, zone)
  return instantToWall(secondPass, zone) === normalized ? secondPass : firstPass
}

/** How far the zone is ahead of UTC at a given instant, in ms. */
export function offsetMsAt(instantMs, timeZone) {
  const zone = resolveTimeZone(timeZone)
  const key = `${zone}|${Math.floor(instantMs / MS_PER_HOUR)}`
  const hit = offsetCache.get(key)
  if (hit !== undefined) return hit

  const parts = partsIn(instantMs, zone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  // Round to the second: the formatter drops sub-second detail, and a raw difference
  // would otherwise carry the instant's own milliseconds.
  const offset = asUtc - Math.floor(instantMs / 1000) * 1000

  // Clear rather than evict one entry: the cache is a pure function of its key, so
  // dropping all of it costs one recompute and keeps this branch free of bookkeeping.
  if (offsetCache.size >= OFFSET_CACHE_MAX) offsetCache.clear()
  offsetCache.set(key, offset)
  return offset
}

/** The instant -> the wall clock a person in that zone is reading. */
export function instantToWall(instantMs, timeZone) {
  if (!Number.isFinite(instantMs)) return ''
  return formatParts(partsIn(instantMs, resolveTimeZone(timeZone)))
}

export function nowWall(timeZone, nowMs = Date.now()) {
  return instantToWall(nowMs, timeZone)
}

/**
 * Whole days from now until a wall-clock moment, counted in CALENDAR days in the
 * board's zone rather than in 24-hour blocks. "3 days until the wedding" has to
 * flip at midnight, not at whatever o'clock the countdown started.
 */
export function daysUntil(wall, timeZone, nowMs = Date.now()) {
  const target = parseWall(normalizeWall(wall))
  if (!target) return null
  const today = partsIn(nowMs, resolveTimeZone(timeZone))
  const targetDay = Date.UTC(target.year, target.month - 1, target.day)
  const todayDay = Date.UTC(today.year, today.month - 1, today.day)
  return Math.round((targetDay - todayDay) / MS_PER_DAY)
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * A Date whose UTC fields hold the wall-clock parts, for formatting with
 * `timeZone: 'UTC'`. See the module header: this is how a wall clock is rendered
 * without the offset being applied twice.
 */
function asUtcDate(wall) {
  const parts = parseWall(normalizeWall(wall))
  if (!parts) return null
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute))
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
 * @param {string} wall
 * @param {object} [opts]
 * @param {string} [opts.locale] undefined means the runtime locale
 * @param {boolean} [opts.time] include the clock time
 * @param {boolean} [opts.year] include the year
 */
export function formatWall(wall, { locale, time = false, year = false } = {}) {
  const date = asUtcDate(wall)
  if (!date) return ''
  return displayFormatter(locale, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}

/** 'April 2027' / '2027年4月' — the list's group headings. */
export function formatWallMonth(wall, { locale } = {}) {
  const date = asUtcDate(wall)
  if (!date) return ''
  return displayFormatter(locale, { year: 'numeric', month: 'long' }).format(date)
}

/**
 * 'Apr' / '4月', and with the year only when asked — the timeline's axis.
 *
 * The long form does not fit there. '2026年11月' is nine characters wide, and eight of
 * those on a phone's plot area overlap into an unreadable smear; the axis therefore
 * carries the short month and spells the year out only when it changes.
 */
export function formatWallMonthShort(wall, { locale, year = false } = {}) {
  const date = asUtcDate(wall)
  if (!date) return ''
  return displayFormatter(locale, {
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  }).format(date)
}

/** '14:00'. Always 24-hour: a schedule read at a glance has no room for am/pm. */
function formatWallTime(wall, { locale } = {}) {
  const date = asUtcDate(wall)
  if (!date) return ''
  return displayFormatter(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/**
 * The window as one string. Collapses whatever the two ends share, because a row
 * on a 320px phone cannot afford "Apr 18, 2027 – Apr 18, 2027".
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allDay] omit clock times
 * @param {string} [opts.locale]
 * @param {string} [opts.nowWall] the current wall clock, so the year is shown
 *   only when the window is not in the current one
 * @param {string} [opts.dash] the separator, from the catalog
 */
export function formatWallRange(start, end, { allDay, locale, nowWall: reference, dash = '–' } = {}) {
  const from = normalizeWall(start)
  const to = normalizeWall(end)
  if (!from && !to) return ''
  if (!to) return formatWall(from, { locale, time: !allDay })
  if (!from) return formatWall(to, { locale, time: !allDay })

  const thisYear = reference ? reference.slice(0, 4) : ''
  const showYear = from.slice(0, 4) !== thisYear || to.slice(0, 4) !== thisYear
  const sameDay = wallDay(from) === wallDay(to)

  if (sameDay) {
    const day = formatWall(from, { locale, year: showYear })
    if (allDay) return day
    return `${day} ${formatWallTime(from, { locale })}${dash}${formatWallTime(to, { locale })}`
  }

  const left = formatWall(from, { locale, time: !allDay, year: showYear })
  const right = formatWall(to, { locale, time: !allDay, year: showYear })
  return `${left} ${dash} ${right}`
}
