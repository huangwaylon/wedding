/**
 * Today's date, in the board's zone, as a day string.
 *
 * The app is day-granular, so this is the whole of its clock. State holds the formatted DAY rather
 * than a millisecond timestamp, so React bails out of all but one render a day: a timestamp
 * re-renders `App` and with it the entire list, since nothing below is memoised, once per poll for
 * a value that changes once a day.
 *
 * The poll is aligned to a 15-minute wall-clock boundary. Every IANA offset is a whole number of
 * quarter-hours, so midnight in any zone lands on one of these boundaries and the timer fires at
 * the moment the date changes, not up to 15 minutes after it. Polling rather than solving for the
 * next midnight is what keeps `time.js` free of offset sampling.
 *
 * `setTimeout`, re-armed each fire, never `setInterval`: an interval drifts and is throttled hard
 * in a background tab, which leaves a resumed app on a stale date. The visibility listener covers
 * the same failure — an installed iOS web app resumed from the app switcher does not navigate and
 * its timers were frozen, so it reads the clock again on return.
 */

import { useEffect, useState } from 'react'
import { todayIn } from '../lib/time.js'

/** A quarter of an hour: the coarsest poll that still lands exactly on every zone's midnight. */
const POLL_MS = 900_000

/**
 * @param {string} timeZone an IANA name; anything unusable falls back inside `todayIn`
 * @returns {string} 'YYYY-MM-DD'
 */
export function useToday(timeZone) {
  const [today, setToday] = useState(() => todayIn(timeZone, Date.now()))

  useEffect(() => {
    let timer = 0

    const check = () => {
      const at = Date.now()
      setToday(todayIn(timeZone, at))
      // The remainder to the next boundary, never 0 — a 0ms timeout on an exact boundary would
      // fire twice in the same millisecond.
      timer = setTimeout(check, POLL_MS - (at % POLL_MS) || POLL_MS)
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      check()
    }

    check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timeZone])

  return today
}
