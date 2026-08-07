/**
 * The board: tasks, config, and every mutation.
 *
 * Three things here are load-bearing.
 *
 * IT PAINTS FROM THE SNAPSHOT BEFORE IT ASKS THE NETWORK ANYTHING. A read is a
 * round trip to an Apps Script web app — well over a second even warm — so a
 * launch that waited for it would show a blank board every time.
 *
 * EVERY MUTATION IS OPTIMISTIC AND EVERY MUTATION RETURNS THE WHOLE BOARD. The
 * local edit lands instantly; the reply then replaces state wholesale, which is
 * also how one device picks up the other's changes without a second request. A
 * failure rolls back to the snapshot of state taken before the edit — not to a
 * hand-computed inverse, which is where this kind of code usually goes wrong.
 *
 * REFRESH ON FOCUS IS THROTTLED. Two people and any number of planners share one
 * sheet with no push channel, so the board re-reads when the app comes forward.
 * Window switching is constant and every read spends the owner's Apps Script
 * quota, hence the floor — do not remove it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mergeConfig, serializeConfig } from '../config.js'
import { isLive } from '../schema.js'
import * as api from '../lib/api.js'
import { API_ERROR } from '../lib/api.js'
import { readSnapshot, writeSnapshot } from '../lib/snapshot.js'
import { findTemplate, materialize } from '../lib/templates.js'

/** Focus fires constantly; a read on every one would be wasteful. */
const REFRESH_FLOOR_MS = 30_000

export const STATUS = { LOADING: 'loading', READY: 'ready', ERROR: 'error' }

export function newId() {
  // Available in every browser this app targets; the fallback exists only so the
  // module can be imported under vitest's `node` environment without a DOM.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @param {object} input
 * @param {string|null} input.editKey null for a view-only visitor
 * @param {() => void} input.onUnauthorized called once when the endpoint refuses
 *   the key, so the caller can flag it and drop to view-only
 */
export function useBoard({ editKey, onUnauthorized }) {
  const seeded = useRef(readSnapshot())

  const [tasks, setTasks] = useState(() => seeded.current?.tasks ?? [])
  const [sheetConfig, setSheetConfig] = useState(() => seeded.current?.config ?? null)
  const [status, setStatus] = useState(() => (seeded.current ? STATUS.READY : STATUS.LOADING))
  const [error, setError] = useState(null)
  /** True while the only data on screen came from the device, not the sheet. */
  const [stale, setStale] = useState(() => Boolean(seeded.current))
  const [sheetTimeZone, setSheetTimeZone] = useState('')
  const [saving, setSaving] = useState(0)

  const lastRead = useRef(0)
  const inFlight = useRef(false)
  // Read inside callbacks that must not be re-created when the key changes.
  const keyRef = useRef(editKey)
  keyRef.current = editKey
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  const config = useMemo(() => mergeConfig(sheetConfig), [sheetConfig])

  const accept = useCallback((board) => {
    setTasks(board.tasks)
    setSheetConfig(board.config)
    setSheetTimeZone(board.sheetTimeZone)
    setStatus(STATUS.READY)
    setError(null)
    setStale(false)
    writeSnapshot(board.tasks, board.config)
    // `board.needsSetup` is deliberately not tracked: a spreadsheet whose tabs do not
    // exist yet reads as an empty board, and the empty board already says the right
    // thing to an editor and to a viewer. The first write builds the structure.
  }, [])

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (inFlight.current) return
    const at = Date.now()
    if (!force && at - lastRead.current < REFRESH_FLOOR_MS) return
    inFlight.current = true
    lastRead.current = at
    try {
      accept(await api.readBoard())
    } catch (failure) {
      const code = failure?.code ?? API_ERROR.TRANSIENT
      setError(code)
      // A failed refresh must never blank a board that is already on screen. The
      // snapshot is stale, not wrong, and saying so beats an error page.
      setStatus((previous) => (previous === STATUS.LOADING ? STATUS.ERROR : previous))
    } finally {
      inFlight.current = false
    }
  }, [accept])

  useEffect(() => {
    refresh({ force: true })
  }, [refresh])

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== 'visible') return
      refresh()
    }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    return () => {
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [refresh])

  /**
   * Every mutation goes through here, and there is exactly one of these on purpose.
   *
   * This block — bump `saving`, call, accept the fresh board, classify the failure, flag a
   * rejected key, decrement `saving` — was written out four times, and the fourth copy
   * (`compact`) had quietly dropped the `unauthorized` callback. So a rotated key plus a
   * Purge left the app looking like it still had edit rights. One copy cannot drift from
   * itself.
   *
   * `optimistic` is the only variable part. With it, the local edit lands immediately and
   * any failure restores exactly what was there before — captured through the updater
   * rather than by closing over `tasks`, so two edits in quick succession cannot resurrect
   * the first one's starting point. Without it the call just waits, which is right when a
   * partial result would be worse than a spinner.
   *
   * @param {(key: string) => Promise<object>} call
   * @param {(tasks: object[]) => object[]} [optimistic]
   * @returns {Promise<boolean>} whether it landed
   */
  const run = useCallback(
    async (call, optimistic) => {
      let rollback = null
      if (optimistic) {
        setTasks((previous) => {
          rollback = previous
          return optimistic(previous)
        })
      }
      setSaving((count) => count + 1)
      try {
        accept(await call(keyRef.current))
        return true
      } catch (failure) {
        if (rollback) setTasks(rollback)
        const code = failure?.code ?? API_ERROR.TRANSIENT
        setError(code)
        if (code === API_ERROR.UNAUTHORIZED) unauthorizedRef.current?.()
        return false
      } finally {
        setSaving((count) => count - 1)
      }
    },
    [accept],
  )

  const addTask = useCallback(
    (draft) => {
      const task = { ...draft, id: draft.id || newId(), pending: true }
      return run(
        (key) => api.createTask(task, key),
        (previous) => [...previous, task],
      )
    },
    [run],
  )

  const editTask = useCallback(
    (task) =>
      run(
        (key) => api.updateTask(task, key),
        (previous) => previous.map((row) => (row.id === task.id ? { ...task, pending: true } : row)),
      ),
    [run],
  )

  /**
   * A subtask is a task with a parent and no window. It goes through the same `run` as
   * everything else — a second write path would be the fifth try/catch `run` exists to prevent.
   */
  const addSubtask = useCallback(
    (parent, title) => {
      const subtask = {
        id: newId(),
        title,
        parentId: parent.id,
        category: '',
        start: '',
        end: '',
        allDay: false,
        doneAt: '',
        notes: '',
        owner: '',
        deletedAt: '',
        pending: true,
      }
      return run(
        (key) => api.createTask(subtask, key),
        (previous) => [...previous, subtask],
      )
    },
    [run],
  )

  /**
   * Done is a timestamp, not a boolean, because "when did this get finished" is worth
   * keeping and because a blank cell is the obvious spelling of not-done in a spreadsheet
   * somebody may open by hand.
   */
  const toggleDone = useCallback(
    (task) => editTask({ ...task, doneAt: task.doneAt ? '' : new Date().toISOString() }),
    [editTask],
  )

  /**
   * The server cascades to subtasks under one lock, so the optimistic update has to as well —
   * otherwise the children stay on screen for a second and then vanish when the reply lands.
   */
  const stamp = (id, deletedAt) => (previous) =>
    previous.map((row) =>
      row.id === id || row.parentId === id ? { ...row, deletedAt, pending: true } : row,
    )

  const removeTask = useCallback(
    (id) => run((key) => api.deleteTask(id, key), stamp(id, new Date().toISOString())),
    [run],
  )

  const restoreTask = useCallback((id) => run((key) => api.restoreTask(id, key), stamp(id, '')), [run])

  /**
   * Seed a starter checklist. Deliberately NOT optimistic: forty rows appearing and then
   * vanishing on a failure is worse than a second of a spinner, and this runs once in the
   * life of a board.
   *
   * @returns {Promise<number>} how many tasks were seeded, or 0 on any failure
   */
  const seedTemplate = useCallback(
    async (templateId, { weddingDay, locale }) => {
      const template = findTemplate(templateId)
      if (!template) return 0
      const drafts = materialize(template, weddingDay, { locale, newId })
      if (!drafts.length) return 0
      return (await run((key) => api.createTasks(drafts, key))) ? drafts.length : 0
    },
    [run],
  )

  const saveConfig = useCallback(
    (partial) => run((key) => api.writeConfig(serializeConfig(partial), key)),
    [run],
  )

  const compact = useCallback(() => run((key) => api.compact(key)), [run])

  /**
   * Tombstoned rows worth offering a Restore for.
   *
   * A subtask whose parent is ALSO deleted is excluded: the delete cascaded, so restoring the
   * parent brings it back too. Listing it separately turns one delete into four restore rows,
   * three of which would resurrect an orphan under a still-deleted parent.
   *
   * A subtask deleted on its own still appears — its parent is live, so restoring it alone is
   * exactly what somebody wants.
   */
  const deletedTasks = useMemo(() => {
    const gone = new Set(tasks.filter((task) => !isLive(task)).map((task) => task.id))
    return tasks.filter((task) => !isLive(task) && !gone.has(task.parentId))
  }, [tasks])

  return {
    tasks,
    deletedTasks,
    config,
    /** The spreadsheet's OWN zone, only used to warn when it disagrees with config. */
    sheetTimeZone,
    status,
    error,
    stale,
    /** Non-zero while anything is unsaved — the service worker waits on this. */
    saving,
    refresh,
    addTask,
    addSubtask,
    editTask,
    toggleDone,
    removeTask,
    restoreTask,
    seedTemplate,
    saveConfig,
    compact,
  }
}
