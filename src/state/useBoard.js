/**
 * The board: tasks, config, and every mutation.
 *
 * Four things here are load-bearing.
 *
 * IT PAINTS FROM THE SNAPSHOT BEFORE IT ASKS THE NETWORK ANYTHING. Even a REST read is a
 * round trip, so a launch that waited for one would show a blank board every time.
 *
 * EVERY MUTATION IS OPTIMISTIC. The local edit lands instantly and a failure rolls back to the
 * snapshot of state taken before the edit — not to a hand-computed inverse, which is where
 * this kind of code usually goes wrong.
 *
 * A WRITE RETURNS NOTHING BUT SUCCESS. A Sheets write answers with the ranges it touched and
 * nothing about the rest of the board, so the optimistic state IS the state until something
 * re-reads — and the throttled focus refresh is what does that. Reading the board back after
 * every save would make one device pick up the other's edits sooner, at the cost of doubling
 * every write; the refresh already covers it.
 *
 * REFRESH ON FOCUS IS THROTTLED. Two people and any number of planners share one sheet with no
 * push channel, so the board re-reads when the app comes forward — do not remove the floor.
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
  // Available in every browser this app targets; the fallback exists only so the module can be
  // imported under vitest's `node` environment without a DOM.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A pending write, as DATA rather than as a closure, which is the whole reason folding is
 * possible: a `() => api.updateTasks([task])` in a queue is opaque, and two of them cannot be
 * recognised as the same row written twice.
 *
 * `create` and `update` both carry a LIST, always. One row and forty are the same plan, so a
 * fold never changes an op's shape — and a single-row op beside a batched one would be two code
 * paths to keep in step for no gain, since the client is the writer and a batch always lands.
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
 * Two ADJACENT writes as one request, or null when they must stay two.
 *
 * ADJACENCY IS THE ENTIRE SAFETY ARGUMENT. Only the write at the TAIL of the queue is ever
 * offered here, and a write that has been dispatched has already left the queue — so a fold
 * can never move an operation past another one touching the same row, and it can never touch a
 * request already in flight. Everything it does merge is either the same row written twice,
 * where the later payload IS the outcome of both because a write rewrites the whole row from
 * it, or rows batched into one op that writes them in list order.
 *
 * WHAT IT DELIBERATELY REFUSES: anything across ops. `update` then `delete` on one row is the
 * resurrection defect `TaskDetail`'s unmount flush already cost once — folding it would either
 * write an empty `deleted_at` over the tombstone or drop an edit somebody watched land.
 * `delete` then `restore` must stay two writes for the same reason.
 *
 * @param {object} queued the tail of the queue, undispatched
 * @param {object} incoming
 * @returns {object|null} the plan that replaces `queued`, or null to leave it alone
 */
export function foldWrite(queued, incoming) {
  if (!queued || !incoming) return null
  if (queued.op !== incoming.op && !(queued.op === 'create' && incoming.op === 'update')) return null

  /**
   * Rows batched into one op. LAST WRITER WINS PER ROW, in place: a row edited twice inside one
   * batch must appear once, or the outcome would depend on which payload was written second.
   */
  if (queued.op === incoming.op && (queued.op === 'create' || queued.op === 'update')) {
    return { op: queued.op, tasks: mergeById(queued.tasks, incoming.tasks) }
  }

  /**
   * A row created and then edited before its create was sent — ticking a subtask typed a second
   * ago. It stays a `create`, carrying the final values, which is what two sequential writes
   * would have left. Only when the create actually holds that row: an update to anything else
   * has to stay behind it, because the row it names does not exist yet.
   */
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
  for (const task of incoming) {
    const at = merged.findIndex((row) => row.id === task.id)
    if (at < 0) merged.push(task)
    else merged[at] = task
  }
  return merged
}

/**
 * One request at a time, adjacent writes folded, and every caller told what happened.
 *
 * A PLAIN OBJECT RATHER THAN A PROMISE CHAIN IN A REF, because the two rules it holds are the
 * ones a source check cannot verify: that a request is never dispatched while another is out,
 * and that a caller whose write was folded away does not act as though its own landed
 * separately. Both are invisible on screen, so both have to be callable — `test/board.test.js`
 * drives this directly.
 *
 * Callers are settled newest first: on a failure each one restores the tasks it captured, and
 * the OLDEST snapshot is the only one that predates the whole batch, so it has to land last.
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
        // Every caller of this job stops waiting BEFORE any of them is settled, so the first
        // one to look sees a truthful `pending`.
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
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  /**
   * Every write, in order, with adjacent ones folded into a single request. Built lazily and
   * once: a queue rebuilt on a render would drop whatever was still in it.
   */
  const queue = useRef(null)
  if (!queue.current) queue.current = createWriteQueue((plan) => REQUESTS[plan.op](plan))

  const config = useMemo(() => mergeConfig(sheetConfig), [sheetConfig])

  /**
   * The ONE place a failure is classified, recorded, and reported upward if it is a refused key.
   *
   * Both halves of the app can be told the key is dead: a write obviously, and a READ too, because
   * an editor reads through the Sheets API and a rotated key mints nothing. A second copy of this
   * is how one of those two stops flagging it — and a read that quietly failed would leave a stale
   * board on screen with every edit control still on it.
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
    // `board.needsSetup` is deliberately not tracked: a spreadsheet whose tabs do not exist yet
    // reads as an empty board, and the empty board already says the right thing to an editor
    // and to a viewer. The first write builds the structure.
  }, [])

  const refresh = useCallback(
    async ({ force = false } = {}) => {
      if (reading.current) return
      // A read must never land on top of an unsaved write. Its board was composed before that
      // write reached the sheet, so accepting it would wipe the optimistic edit off the screen.
      if (queue.current.pending > 0) return
      const at = Date.now()
      if (!force && at - lastRead.current < REFRESH_FLOOR_MS) return
      reading.current = true
      lastRead.current = at
      // AND THE CHECK HAS TO BE MADE AGAIN AFTER THE AWAIT. A read takes a moment, so a tick
      // landing during one is a write this board predates — accepted, it un-ticks the row on
      // screen, which reads as the app losing the tap. `issued` catches a write that both
      // started AND finished inside the window, which `pending` cannot see.
      const before = queue.current.issued
      try {
        const board = await api.readBoard()
        if (queue.current.pending > 0 || queue.current.issued !== before) return
        accept(board)
      } catch (failure) {
        fail(failure)
        // A failed refresh must never blank a board that is already on screen. The snapshot is
        // stale, not wrong, and saying so beats an error page.
        setStatus((previous) => (previous === STATUS.LOADING ? STATUS.ERROR : previous))
      } finally {
        reading.current = false
      }
    },
    [accept, fail],
  )

  // Re-read when the key changes: a device that has just been handed one reads through the
  // Sheets API instead of `doGet`, and one that has just given it up must go the other way.
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
   * Every mutation goes through here, and there is exactly one of these on purpose.
   *
   * Bump `saving`, queue the write, settle the rows, classify the failure, flag a rejected key,
   * decrement `saving`: written out once per mutation, one copy will eventually forget the
   * `unauthorized` callback and a rotated key will leave the app still showing edit controls.
   *
   * `optimistic` is the only variable part. With it, the local edit lands immediately and any
   * failure restores exactly what was there before — captured through the updater rather than
   * by closing over `tasks`, so two edits in quick succession cannot resurrect the first one's
   * starting point.
   *
   * SETTLING IS "NOTHING IS IN FLIGHT", NOT A PER-ROW LEDGER. The queue dispatches one request
   * at a time, so once it is empty no write is outstanding and no row may still claim to be
   * pending. That is one rule rather than bookkeeping each op has to get right, and a row left
   * dimmed forever is exactly the bug the bookkeeping version would produce.
   *
   * @param {object} plan the write, as data — see `REQUESTS` and `foldWrite`
   * @param {(tasks: object[]) => object[]} [optimistic]
   * @returns {Promise<boolean>} whether it landed
   */
  const run = useCallback(async (plan, optimistic) => {
    let rollback = null
    if (optimistic) {
      setTasks((previous) => {
        rollback = previous
        return optimistic(previous)
      })
    }
    setSaving((count) => count + 1)
    try {
      await queue.current.push(plan)
      if (queue.current.pending === 0) {
        setTasks((previous) =>
          previous.some((task) => task.pending)
            ? previous.map((task) => (task.pending ? { ...task, pending: false } : task))
            : previous,
        )
      }
      return true
    } catch (failure) {
      if (rollback) setTasks(rollback)
      fail(failure)
      return false
    } finally {
      setSaving((count) => count - 1)
    }
  }, [fail])

  const addTask = useCallback(
    (draft) => {
      const task = { ...draft, id: draft.id || newId(), pending: true }
      return run({ op: 'create', tasks: [task] }, (previous) => [...previous, task])
    },
    [run],
  )

  const editTask = useCallback(
    (task) =>
      run({ op: 'update', tasks: [task] }, (previous) =>
        previous.map((row) => (row.id === task.id ? { ...task, pending: true } : row)),
      ),
    [run],
  )

  /**
   * A subtask is a task with a parent and no date. It goes through the same `run` as everything
   * else — a second write path would be another hand-written try/catch, which is exactly what
   * `run` exists to prevent.
   *
   * ENTERING FIVE IN A ROW IS THE DESIGNED-FOR GESTURE, so the second onwards are typed while
   * the first is still out. The queue folds them into one `create`.
   */
  const addSubtask = useCallback(
    (parent, title) => {
      const subtask = {
        id: newId(),
        title,
        parentId: parent.id,
        category: '',
        due: '',
        doneAt: '',
        deletedAt: '',
        pending: true,
      }
      return run({ op: 'create', tasks: [subtask] }, (previous) => [...previous, subtask])
    },
    [run],
  )

  /**
   * Done is a timestamp, not a boolean, because "when did this get finished" is worth keeping
   * and because a blank cell is the obvious spelling of not-done in a spreadsheet somebody may
   * open by hand.
   */
  const toggleDone = useCallback(
    (task) => editTask({ ...task, doneAt: task.doneAt ? '' : new Date().toISOString() }),
    [editTask],
  )

  /**
   * The write cascades to subtasks in one request, so the optimistic update has to as well —
   * otherwise the children stay on screen for a moment and then vanish when the read lands.
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
   * Seed a starter checklist. Deliberately NOT optimistic: forty rows appearing and then
   * vanishing on a failure is worse than a moment of a spinner, and this runs once in the life
   * of a board. The read afterwards is what puts them on screen.
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
   * NOT OPTIMISTIC, AND THE ONE MUTATION THE SHEET STILL WAITS FOR. Giving it an optimistic
   * half is cheap and would be wrong: Settings is where somebody changes the zone and the
   * wedding date, and drawing a new countdown that then reverts is worse than a spinner on the
   * button. The read afterwards is what the new values arrive by.
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
   * Tombstoned rows worth offering a Restore for.
   *
   * A subtask whose parent is ALSO deleted is excluded: the delete cascaded, so restoring the
   * parent brings it back too. Listing it separately turns one delete into four restore rows,
   * three of which would resurrect an orphan under a still-deleted parent.
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
