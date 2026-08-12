/**
 * The clock the whole app reads.
 *
 * The hero counts down to the wedding day, so something has to make "now" change.
 * This is that thing, and it is what keeps a board left open on a planner's monitor
 * moving.
 *
 * Ticks are aligned to the wall clock rather than set to a fixed interval, so the
 * minute display flips when the minute actually changes instead of a fraction of a
 * second later each time. `setTimeout` is re-armed each tick for the same reason —
 * `setInterval` drifts, and it is throttled to once a minute or worse in a
 * background tab, which would leave a resumed app showing a stale figure until the
 * next fire.
 *
 * That is what the visibility listener is for: an installed iOS web app resumed
 * from the app switcher does not navigate and its timers were frozen, so the first
 * thing to do on return is read the clock again.
 */

import { useEffect, useState } from 'react'

/** A minute. Fine enough for a plan measured in months, cheap enough to ignore. */
const TICK_MS = 60_000

export function useNow() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer = 0

    const tick = () => {
      const at = Date.now()
      setNow(at)
      // The remainder to the next boundary, never 0 — a 0ms timeout on an exact
      // boundary would fire twice in the same millisecond.
      timer = setTimeout(tick, TICK_MS - (at % TICK_MS) || TICK_MS)
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      tick()
    }

    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}
