/**
 * The board: tasks, config, and every mutation.
 *
 * It paints from the snapshot before touching the network: even a REST read is a round trip, so a
 * launch that waited for one would show a blank board. Every mutation is optimistic; a failure
 * reverts the rows it touched (`revert`). A write returns nothing but success — a Sheets write
 * answers with the ranges it touched — so the optimistic state IS the state until the focus refresh
 * re-reads, throttled to `REFRESH_FLOOR_MS`: one sheet, several editors, no push channel.
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
  // `randomUUID` exists in every targeted browser; the fallback is for vitest's `node` environment.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A pending write, as data rather than a closure: two queued `() => api.updateTasks([task])` cannot
 * be recognised as the same row written twice, and `foldWrite` needs the plan inspectable. `create`
 * and `update` always carry a list, so one row and forty are the same plan, a fold never changes
 * an op's shape, and there is no single-row path to keep in step.
 */
const REQUESTS = {
  create: (plan) => api.createTasks(plan.tasks),
  update: (plan) => api.updateTasks(plan.tasks),
  delete: (plan) => api.deleteTask(plan.id),
  restore: (plan) => api.restoreTask(plan.id),
  setConfig: (plan) => api.writeConfig(plan.config),
  compact: () => api.compact(),
}

/**
 * Two adjacent writes as one request, or null when they must stay two.
 *
 * Adjacency is the whole safety argument: only the undispatched tail is offered here, so a fold
 * cannot reorder writes to one row and cannot touch a request in flight. It merges the same row
 * written twice — the later payload is the outcome of both, a write rewriting the whole row from
 * it — or rows batched into one op, written in list order.
 *
 * Never across ops: `update` then `delete` would write an empty `deleted_at` over the tombstone or
 * drop an edit somebody watched land, and `delete` then `restore` is that reversed.
 *
 * @param {object} queued the tail of the queue, undispatched
 * @returns {object|null} the plan replacing `queued`, or null to leave it alone
 */
export function foldWrite(queued, incoming) {
  if (!queued || !incoming) return null
  if (queued.op !== incoming.op && !(queued.op === 'create' && incoming.op === 'update')) return null

  // Rows batched into one op, last writer wins per row and in place: a row edited twice in one
  // batch must appear once, or the outcome depends on payload order.
  if (queued.op === incoming.op && (queued.op === 'create' || queued.op === 'update')) {
    return { op: queued.op, tasks: mergeById(queued.tasks, incoming.tasks) }
  }

  // A row created then edited before its create was sent stays a `create` carrying the final
  // values, which two sequential writes would also leave — but only if the create holds that row,
  // an update to anything else having to wait for the row to exist.
  if (queued.op === 'create' && incoming.op === 'update') {
    const known = incoming.tasks.every((task) => queued.tasks.some((held) => held.id === task.id))
    if (!known) return null
    return { op: 'create', tasks: mergeById(queued.tasks, incoming.tasks) }
  }

  return null
}

/** Append, replacing in place anything already present under the same id. */
function mergeById(held, incoming) {
  const merged = held.slice()
  const at = new Map(merged.map((row, index) => [row.id, index]))
  for (const task of incoming) {
    const found = at.get(task.id)
    if (found === undefined) {
      at.set(task.id, merged.push(task) - 1)
    } else {
      merged[found] = task
    }
  }
  return merged
}

/**
 * Undo one optimistic edit without undoing anybody else's.
 *
 * Restoring the whole pre-edit array would undo any later edit that has already landed
 * optimistically: the queue is serial, but the next job's edit lands at push time. So only the rows
 * this edit touched are reverted, against the current array, identified by comparing `after` to
 * `before` by reference — exact because every `optimistic` here passes untouched rows through
 * unchanged, so identity cannot fall out of step with the updater. A row absent from `before` was a
 * failed create and is dropped.
 */
export function revert(current, before, after) {
  const was = new Map(before.map((row) => [row.id, row]))
  const touched = new Set()
  for (const row of after) if (was.get(row.id) !== row) touched.add(row.id)
  if (!touched.size) return current
  return current
    .filter((row) => !touched.has(row.id) || was.has(row.id))
    .map((row) => (touched.has(row.id) ? was.get(row.id) : row))
}

/**
 * One request at a time, adjacent writes folded, every caller told what happened.
 *
 * A plain object rather than a promise chain in a ref: its two rules are invisible on screen and
 * unverifiable by a source check — a request is never dispatched while another is out, and a caller
 * whose write was folded away does not act as though its own landed separately — so both have to be
 * callable, and `test/board.test.js` drives them. Callers settle newest first: each restores the
 * tasks it captured, and the oldest snapshot, the only one predating the batch, lands last.
 *
 * @param {(plan: object) => Promise<unknown>} send
 */
export function createWriteQueue(send) {
  /** Undispatched jobs. `shift` before dispatch is what makes an in-flight job unfoldable. */
  const jobs = []
  let waiting = 0
  let issued = 0
  let running = false

  async function pump() {
    if (running) return
    running = true
    try {
      while (jobs.length) {
        const job = jobs.shift()
        let failure = null
        try {
          await send(job.plan)
        } catch (error) {
          failure = error
        }
        // All callers stop waiting before any is settled, so `pending` stays truthful.
        waiting -= job.settle.length
        for (let i = job.settle.length - 1; i >= 0; i -= 1) {
          if (failure) job.settle[i].reject(failure)
          else job.settle[i].resolve(true)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    /** Callers still waiting. Non-zero means a write is queued or in flight. */
    get pending() {
      return waiting
    },
    /** Every write ever queued. A read that saw this change overlapped one — see `refresh`. */
    get issued() {
      return issued
    },
    push(plan) {
      return new Promise((resolve, reject) => {
        waiting += 1
        issued += 1
        const tail = jobs[jobs.length - 1]
        const folded = tail ? foldWrite(tail.plan, plan) : null
        if (folded) {
          tail.plan = folded
          tail.settle.push({ resolve, reject })
        } else {
          jobs.push({ plan, settle: [{ resolve, reject }] })
        }
        pump()
      })
    },
  }
}

/**
 * @param {object} input
 * @param {string|null} input.editKey null for a view-only visitor
 * @param {() => void} input.onUnauthorized called once when the endpoint refuses the key, so
 *   the caller can flag it and drop to view-only
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
  const reading = useRef(false)
  /** The read in flight, so a forced refresh can wait it out instead of giving up. */
  const inFlight = useRef(null)
  /** The rows on screen now, for guards that must not be a render behind. */
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  /** Read inside `run` without making every mutation callback depend on it. */
  const staleRef = useRef(true)
  staleRef.current = stale
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  // Every write, in order, adjacent ones folded. Built once: a queue rebuilt on a render would
  // drop whatever was still in it.
  const queue = useRef(null)
  if (!queue.current) queue.current = createWriteQueue((plan) => REQUESTS[plan.op](plan))

  const config = useMemo(() => mergeConfig(sheetConfig), [sheetConfig])

  /**
   * The only place a failure is classified, recorded, and reported upward when the key is refused.
   * A read can be told the key is dead too — an editor reads through the Sheets API and a rotated
   * key mints nothing — so a second copy is how one of the two stops flagging it, leaving a stale
   * board on screen with every edit control on it.
   */
  const fail = useCallback((failure) => {
    const code = failure?.code ?? API_ERROR.TRANSIENT
    setError(code)
    if (code === API_ERROR.UNAUTHORIZED) unauthorizedRef.current?.()
    return code
  }, [])

  const accept = useCallback((board) => {
    setTasks(board.tasks)
    setSheetConfig(board.config)
    setSheetTimeZone(board.sheetTimeZone)
    setStatus(STATUS.READY)
    setError(null)
    setStale(false)
    writeSnapshot(board.tasks, board.config)
    // `needsSetup` is not tracked: a spreadsheet without its tabs reads as an empty board, which
    // says the right thing to an editor and to a viewer. The first write builds the structure.
  }, [])

  /**
   * Split from `refresh` so `refresh` holds only the rules about whether to read, and so a forced
   * caller has a promise to wait on.
   *
   * @returns {Promise<boolean>} whether a board was accepted
   */
  const readOnce = useCallback(async () => {
    reading.current = true
    // Re-checked after the await: a tick landing during a read is a write this board predates, and
    // accepting it un-ticks the row on screen. `issued` catches a write that started and finished
    // inside the window, which `pending` cannot see.
    const before = queue.current.issued
    try {
      const board = await api.readBoard()
      if (queue.current.pending > 0 || queue.current.issued !== before) return false
      accept(board)
      return true
    } catch (failure) {
      fail(failure)
      // A failed refresh must never blank a board already on screen: the snapshot is stale, not
      // wrong.
      setStatus((previous) => (previous === STATUS.LOADING ? STATUS.ERROR : previous))
      return false
    } finally {
      reading.current = false
    }
  }, [accept, fail])

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.force] skip the throttle floor and wait out a read in flight.
   *   `saveConfig`, `compact` and the seed have no optimistic half, so each reports success on this
   *   re-read landing; returning early because a focus read was open confirms a save over stale
   *   values on screen.
   * @returns {Promise<boolean>} whether a board was accepted
   */
  const refresh = useCallback(
    async ({ force = false } = {}) => {
      if (reading.current) {
        if (!force) return false
        await inFlight.current
      }
      // A read must never land on an unsaved write: its board was composed before that write
      // reached the sheet, so accepting it wipes the optimistic edit off the screen.
      if (queue.current.pending > 0) return false
      const at = Date.now()
      if (!force && at - lastRead.current < REFRESH_FLOOR_MS) return false
      lastRead.current = at
      inFlight.current = readOnce()
      return inFlight.current
    },
    [readOnce],
  )

  // Re-read when the key changes: a device handed one reads through the Sheets API instead of
  // `doGet`, and one that gave it up goes the other way.
  useEffect(() => {
    refresh({ force: true })
  }, [refresh, editKey])

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
   * Nothing is in flight, so no row may still claim to be pending. Keyed on an empty queue rather
   * than a per-op ledger, which is how a row ends up dimmed forever: the queue dispatches one
   * request at a time. `run` calls it in `finally`, so it covers the failure path — reads happen
   * only on focus, so nothing else clears a row dimmed by a write that failed behind one that
   * landed.
   */
  const settle = useCallback(() => {
    if (queue.current.pending > 0) return
    setTasks((previous) =>
      previous.some((task) => task.pending)
        ? previous.map((task) => (task.pending ? { ...task, pending: false } : task))
        : previous,
    )
  }, [])

  /**
   * The only mutation wrapper: bump `saving`, queue the write, settle the rows, classify the
   * failure, flag a rejected key, decrement `saving`. Written out per mutation, one copy eventually
   * forgets the `unauthorized` callback and a rotated key leaves the app showing edit controls.
   * `optimistic` is the only variable part, and the rows a failure reverts to are captured through
   * the updater rather than by closing over `tasks`.
   *
   * @param {object} plan the write, as data — see `REQUESTS` and `foldWrite`
   * @param {(tasks: object[]) => object[]} [optimistic]
   * @returns {Promise<boolean>} whether it landed
   */
  const run = useCallback(
    async (plan, optimistic) => {
      let before = null
      let after = null
      if (optimistic) {
        setTasks((previous) => {
          before = previous
          after = optimistic(previous)
          return after
        })
      }
      setSaving((count) => count + 1)
      try {
        await queue.current.push(plan)
        // A landed write proves the endpoint and the key are fine, so an earlier failure's notice
        // comes down; otherwise it sits there until a read happens to succeed. Not while `stale`,
        // where the notice is about the board coming from the device, which a write does not
        // change.
        if (!staleRef.current) setError(null)
        return true
      } catch (failure) {
        if (before) setTasks((current) => revert(current, before, after))
        fail(failure)
        return false
      } finally {
        setSaving((count) => count - 1)
        settle()
      }
    },
    [fail, settle],
  )

  const addTask = useCallback(
    (draft) => {
      const task = { ...draft, id: draft.id || newId(), pending: true }
      return run({ op: 'create', tasks: [task] }, (previous) => [...previous, task])
    },
    [run],
  )

  /**
   * An update may not clear a tombstone, and this is the only guard covering every route to it.
   *
   * `update` rewrites the whole row from its payload, so an empty `deleted_at` resurrects a deleted
   * task, wearing whatever edit preceded the delete and with its subtasks still tombstoned, the
   * cascade's rows not being in this write. `TaskDetail` disarms its unmount flush on its own
   * delete and save, but a row also unmounts when a refresh brings back a board in which the other
   * editor deleted it, and that flush still holds the pre-delete task. Deciding it against the row
   * the board holds now covers both. A row absent altogether was compacted out; `restore`
   * legitimately clears the cell and does not come through here.
   */
  const editTask = useCallback(
    (task) => {
      const current = tasksRef.current.find((row) => row.id === task.id)
      if (!current || (!isLive(current) && isLive(task))) return Promise.resolve(false)
      return run({ op: 'update', tasks: [task] }, (previous) =>
        previous.map((row) => (row.id === task.id ? { ...task, pending: true } : row)),
      )
    },
    [run],
  )

  /**
   * A subtask is a task with a parent and no date, written through the same `run`; a second write
   * path would be another hand-written try/catch. Five in a row is the designed-for gesture, so the
   * second onwards are typed while the first is out and the queue folds them into one `create`.
   */
  const addSubtask = useCallback(
    (parent, title) => {
      const subtask = {
        id: newId(),
        title,
        parentId: parent.id,
        category: '',
        due: '',
        start: '',
        doneAt: '',
        deletedAt: '',
        pending: true,
      }
      return run({ op: 'create', tasks: [subtask] }, (previous) => [...previous, subtask])
    },
    [run],
  )

  /**
   * Done is a timestamp, not a boolean: when it was finished is worth keeping, and a blank cell is
   * the obvious spelling of not-done in a spreadsheet somebody may open by hand.
   */
  const toggleDone = useCallback(
    (task) => editTask({ ...task, doneAt: task.doneAt ? '' : new Date().toISOString() }),
    [editTask],
  )

  /**
   * The write cascades to subtasks in one request, so the optimistic update must too, or children
   * linger for a moment and vanish when the read lands.
   */
  const stamp = (id, deletedAt) => (previous) =>
    previous.map((row) =>
      row.id === id || row.parentId === id ? { ...row, deletedAt, pending: true } : row,
    )

  const removeTask = useCallback(
    (id) => run({ op: 'delete', id }, stamp(id, new Date().toISOString())),
    [run],
  )

  const restoreTask = useCallback((id) => run({ op: 'restore', id }, stamp(id, '')), [run])

  /**
   * Seed a starter checklist. Not optimistic: forty rows appearing and then vanishing on a failure
   * is worse than a moment of a spinner, and this runs once in the life of a board. The read
   * afterwards puts them on screen.
   *
   * @returns {Promise<number>} how many tasks were seeded, or 0 on any failure
   */
  const seedTemplate = useCallback(
    async (templateId, { weddingDay, locale }) => {
      const template = findTemplate(templateId)
      if (!template) return 0
      const drafts = materialize(template, weddingDay, { locale, newId })
      if (!drafts.length) return 0
      if (!(await run({ op: 'create', tasks: drafts }))) return 0
      await refresh({ force: true })
      return drafts.length
    },
    [run, refresh],
  )

  /**
   * Not optimistic either, and the one mutation the sheet waits for: Settings is where the zone and
   * the wedding date change, and a new countdown that then reverts is worse than a spinner on the
   * button. The read afterwards is how the new values arrive.
   */
  const saveConfig = useCallback(
    async (partial) => {
      if (!(await run({ op: 'setConfig', config: serializeConfig(partial) }))) return false
      await refresh({ force: true })
      return true
    },
    [run, refresh],
  )

  /** Rows leave the sheet, so nothing on screen describes it until it is read again. */
  const compact = useCallback(
    async () => {
      if (!(await run({ op: 'compact' }))) return false
      await refresh({ force: true })
      return true
    },
    [run, refresh],
  )

  /**
   * Tombstoned rows worth a Restore. A subtask whose parent is also deleted is excluded: the delete
   * cascaded, so restoring the parent brings it back. Listing it separately turns one delete into
   * four restore rows, three of which resurrect an orphan under a still-deleted parent.
   */
  const deletedTasks = useMemo(() => {
    const gone = new Set(tasks.filter((task) => !isLive(task)).map((task) => task.id))
    return tasks.filter((task) => !isLive(task) && !gone.has(task.parentId))
  }, [tasks])

  return {
    tasks,
    deletedTasks,
    config,
    /** The spreadsheet's own zone, used only to warn when it disagrees with config. */
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
