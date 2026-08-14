/**
 * Toasts: short, non-blocking, and without actions.
 *
 * A toast that has timed out is an action nobody can reach, so recovery lives in the interface
 * instead — a deleted task is restored from the Deleted list. Everything here is a statement.
 *
 * `show(message)` takes nothing else: one duration, no severity. Severity belongs to `Notice`,
 * which stays on screen long enough to be read twice.
 */

import { useCallback, useRef, useState } from 'react'

/** Long enough to read a short sentence, short enough not to sit over the FAB. */
const DURATION_MS = 4000

export function useToasts() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const nextId = useRef(0)

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (message) => {
      const id = ++nextId.current
      setToasts((previous) => [...previous, { id, message }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS),
      )
    },
    [dismiss],
  )

  return { toasts, show }
}
