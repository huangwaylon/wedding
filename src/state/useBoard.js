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
import { TASK_COLUMNS, isLive } from '../schema.js'
import * as api from '../lib/api.js'
import { API_ERROR } from '../lib/api.js'
import { readSnapshot, writeSnapshot } from '../lib/snapshot.js'
import { findTemplate, materialize } from '../lib/templates.js'

/** Focus fires constantly; a read on every one would be wasteful. */
const REFRESH_FLOOR_MS = 30_000

/**
 * The column this bundle needs the script to know about. Named from `TASK_COLUMNS` rather than
 * written as a literal, so it cannot drift from the schema it is checking.
 */
const REQUIRED_COLUMN = TASK_COLUMNS[TASK_COLUMNS.length - 1]

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
  /**
   * The columns the DEPLOYED script understands. `null` means no read has landed yet, which is
   * NOT the same as an empty list — an older script sends no `schema` field at all, so `[]` is
   * the positive signal that the deployment is out of date. Conflating the two is what let the
   * guard below miss the only case it exists for.
   */
  const [schema, setSchema] = useState(null)
  const [saving, setSaving] = useState(0)

  const lastRead = useRef(0)
  const reading = useRef(false)
  /**
   * Writes, and the two refs that keep them from fighting each other.
   *
   * `chain` serialises them: each call waits for the previous one, so the order they were made
   * in is the order the script's lock sees and the order the replies come back in. Fired
   * concurrently they would contend on that lock anyway — the queue costs nothing and buys
   * ordering.
   *
   * `writes` counts what is still outstanding, and it is what decides whether a reply may
   * replace the board. See `run`.
   */
  const chain = useRef(Promise.resolve())
  const writes = useRef(0)
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
    setSchema(board.schema)
    setStatus(STATUS.READY)
    setError(null)
    setStale(false)
    writeSnapshot(board.tasks, board.config)
    // `board.needsSetup` is deliberately not tracked: a spreadsheet whose tabs do not
    // exist yet reads as an empty board, and the empty board already says the right
    // thing to an editor and to a viewer. The first write builds the structure.
  }, [])

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (reading.current) return
    // A read must never land on top of an unsaved write. Its board was composed before that
    // write reached the sheet, so accepting it would wipe the optimistic edit off the screen —
    // the same clobber `run` guards against, arriving from the other direction. The write's own
    // reply carries a fresh board anyway, so nothing is lost by skipping.
    if (writes.current > 0) return
    const at = Date.now()
    if (!force && at - lastRead.current < REFRESH_FLOOR_MS) return
    reading.current = true
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
      reading.current = false
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
   * ONLY THE LAST WRITE STILL IN FLIGHT MAY REPLACE THE BOARD, and that rule is what makes a
   * burst of edits survivable. Every reply carries the WHOLE board as it stood when that write
   * committed, so an earlier one's reply describes a sheet that does not yet contain the later
   * edits — and accepting it wipes them off the screen. Ticking three subtasks in a row
   * measurably did that: 3 of 3, then back to 2 of 3 for a second and a half, then 3 again.
   * Dropping the intermediate boards is safe because `chain` guarantees the last reply is the
   * one composed after every earlier write had already been applied.
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
      writes.current += 1
      setSaving((count) => count + 1)
      // Queued behind whatever is already going, and the chain swallows failures so one
      // rejected write cannot break the queue for everything after it.
      const mine = chain.current.then(() => call(keyRef.current))
      chain.current = mine.catch(() => {})
      try {
        const board = await mine
        if (writes.current === 1) accept(board)
        return true
      } catch (failure) {
        if (rollback) setTasks(rollback)
        const code = failure?.code ?? API_ERROR.TRANSIENT
        setError(code)
        if (code === API_ERROR.UNAUTHORIZED) unauthorizedRef.current?.()
        return false
      } finally {
        writes.current -= 1
        setSaving((count) => count - 1)
      }
    },
    [accept],
  )

  /**
   * True when the deployed Apps Script predates a column this bundle relies on.
   *
   * A deployment is pinned to a version, so the browser can be running newer code than the
   * script — and the script writes rows by looping its OWN column list, so an older one silently
   * DROPS a field it has never heard of. That is what happened with subtasks: the write returned
   * `{ok: true}`, the row was created, and `parent_id` was thrown away, so the subtask arrived as
   * a stray top-level task with no error anywhere. Refusing the write is the only honest answer;
   * a warning alone would still let somebody make the mess.
   *
   * An older script sends no `schema` at all, so an EMPTY list is the signal. `null` — nothing
   * read yet — is deliberately not outdated, or every cold start would flag itself.
   */
  const outdatedScript = schema !== null && !schema.includes(REQUIRED_COLUMN)

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
    (task) => {
      // A SUBTASK edit is refused on an out-of-date script for the same reason a new one is, and
      // this is the path that matters most in practice: `toggleDone` comes through here, so ticking
      // a checklist item would have been written by a script that has never heard of `parent_id`,
      // dropping it and promoting the item to a task of its own. A top-level edit is unaffected —
      // its `parent_id` is empty, so losing it changes nothing.
      if (task.parentId && outdatedScript) {
        setError(API_ERROR.NOT_FOUND)
        return Promise.resolve(false)
      }
      return run(
        (key) => api.updateTask(task, key),
        (previous) => previous.map((row) => (row.id === task.id ? { ...task, pending: true } : row)),
      )
    },
    [run, outdatedScript],
  )

  /**
   * A subtask is a task with a parent and no window. It goes through the same `run` as
   * everything else — a second write path would be the fifth try/catch `run` exists to prevent.
   */

  const addSubtask = useCallback(
    (parent, title) => {
      // Refused rather than silently reshaped. `not_found` is the closest existing code for
      // "the endpoint cannot do this"; the UI names the real problem from `outdatedScript`.
      if (outdatedScript) {
        setError(API_ERROR.NOT_FOUND)
        return Promise.resolve(false)
      }
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
    [run, outdatedScript],
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
    /** The deployed script is missing a column this bundle writes. See above. */
    outdatedScript,
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
