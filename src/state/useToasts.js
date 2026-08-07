/**
 * Toasts. Short, non-blocking, and deliberately WITHOUT actions.
 *
 * A toast with a button in it is a promise the app cannot keep: one that has
 * already timed out is an action nobody can reach. Recovery lives in the
 * interface instead — a deleted task is restored from the Deleted list, not from
 * a toast — so everything here is a statement, never a control.
 */

import { useCallback, useRef, useState } from 'react'

const DEFAULT_MS = 4000

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
    (message, { tone = 'info', durationMs = DEFAULT_MS } = {}) => {
      const id = ++nextId.current
      setToasts((previous) => [...previous, { id, message, tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), durationMs),
      )
      return id
    },
    [dismiss],
  )

  return { toasts, show, dismiss }
}
