/**
 * The board: tasks, config, and every mutation.
 *
 * Four things here are load-bearing.
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
 * A WRITE COSTS ONE ROUND TRIP AND NOTHING HERE CAN MAKE THAT TRIP CHEAPER. Measured:
 * the request is ~280 bytes, a 52-row reply is ~1KB gzipped, and parsing it takes
 * 0.015ms — so the whole ~3s is Google's, and the only lever left is how MANY trips a
 * burst of edits costs. `createWriteQueue` is that lever: adjacent writes are folded
 * into one request while the previous one is still in flight.
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

export const STATUS = { LOADING: 'loading', READY: 'ready', ERROR: 'error' }

/**
 * Columns the DEPLOYED script has never heard of. Empty means it can store everything this
 * bundle writes.
 *
 * A FUNCTION, AND EXPORTED, because it holds a rule: a rule that cannot be CALLED can only be
 * tested by matching the source text, which proves the code says something rather than that it
 * decides correctly. `test/board.test.js` runs this against real column lists.
 *
 * @param {string[]|null} schema what the read reported. `null` is "nothing read yet" and is
 *   deliberately not out of date, or every cold start would flag itself. `[]` is a deployment
 *   that sends no schema at all, so everything is missing, which is correct.
 */
export function missingColumnsFor(schema) {
  if (schema === null) return []
  return TASK_COLUMNS.filter((column) => !schema.includes(column))
}

/**
 * Whether the DEPLOYED script can dispatch an op. Its columns cannot answer this — a script can
 * hold every column and still have no idea how to batch — so every reply reports `ops` too.
 *
 * IT FALLS THE OPPOSITE WAY TO `missingColumnsFor`, AND THAT IS THE POINT. An unknown SCHEMA must
 * not refuse a write, or every cold start refuses itself before the first read lands; an unknown
 * OP must not be SENT, or that same first write goes out as something the script answers `bad_op`
 * to. So `null` is `[]` is false: not knowing and not having are one answer here, because both mean
 * "use the shape every deployment understands". Being wrong in the other direction is the whole
 * defect — a fold that fails, or a capability nobody ever uses.
 *
 * @param {string[]|null} ops what the last reply advertised. `null` is a deployment that reports
 *   none, and also the state before anything has been read.
 */
export function supports(ops, op) {
  return Array.isArray(ops) && ops.includes(op)
}

export function newId() {
  // Available in every browser this app targets; the fallback exists only so the
  // module can be imported under vitest's `node` environment without a DOM.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A pending write, as DATA rather than as a closure, which is the whole reason folding is
 * possible: a `() => api.updateTask(task, key)` in a queue is opaque, and two of them cannot be
 * recognised as the same row written twice.
 *
 * `create` always carries a LIST, so one row and forty are the same plan and a fold does not
 * change its shape. It still goes out as `create` when there is one of them — `createMany` exists
 * to make a fold possible, not to pad the ordinary case.
 */
const REQUESTS = {
  create: (plan) => (key) =>
    plan.tasks.length === 1
      ? api.createTask(plan.tasks[0], key)
      : api.createTasks(plan.tasks, key),
  update: (plan) => (key) => api.updateTask(plan.task, key),
  updateMany: (plan) => (key) => api.updateTasks(plan.tasks, key),
  delete: (plan) => (key) => api.deleteTask(plan.id, key),
  restore: (plan) => (key) => api.restoreTask(plan.id, key),
  setConfig: (plan) => (key) => api.writeConfig(plan.config, key),
  compact: () => (key) => api.compact(key),
}

/**
 * Two ADJACENT writes as one request, or null when they must stay two.
 *
 * ADJACENCY IS THE ENTIRE SAFETY ARGUMENT. Only the write at the TAIL of the queue is ever offered
 * here, and a write that has been dispatched has already left the queue — so a fold can never move
 * an operation past another one touching the same row, and it can never touch a request already in
 * flight. Everything it does merge is either the same row written twice, where the later payload
 * IS the outcome of both because `update` rewrites the whole row from it, or rows batched into one
 * op that writes them in list order.
 *
 * WHAT IT DELIBERATELY REFUSES: anything across ops. `update` then `delete` on one row is the
 * resurrection defect `TaskDetail`'s unmount flush already cost once — folding it would either
 * write an empty `deleted_at` over the tombstone or drop an edit somebody watched land. `delete`
 * then `restore` must stay two writes for the same reason.
 *
 * @param {object} queued the tail of the queue, undispatched
 * @param {object} incoming
 * @param {(op: string) => boolean} [can] whether the DEPLOYED script can dispatch an op. A batch is
 *   only ever built where it will land: `supports` answers false until a reply says otherwise, so a
 *   pinned deployment gets one request per edit rather than a `bad_op` for all of them.
 * @returns {object|null} the plan that replaces `queued`, or null to leave it alone
 */
export function foldWrite(queued, incoming, can = () => false) {
  if (!queued || !incoming) return null

  // The same row written twice: a tick undone, or a tick on a row whose edit has not gone yet.
  // First, and needing no capability — the later payload IS both writes, so this stays an `update`.
  if (queued.op === 'update' && incoming.op === 'update' && queued.task.id === incoming.task.id) {
    return incoming
  }

  /**
   * DIFFERENT ROWS, WHICH IS THE FOLD THIS APP MOST WANTS. Ticking three subtasks in a row is the
   * highest-frequency gesture there is and each one was its own ~3s round trip.
   *
   * The batch is all-or-nothing on the script's side — it resolves every id before writing any of
   * them — so one row somebody has deleted by hand fails the whole batch rather than half of it.
   * That is the trade, and it is the right way round: every caller rolls back to what it captured
   * and the oldest snapshot lands last, so the screen returns to exactly the pre-batch board. A
   * partial success would leave nothing able to say which half had landed.
   */
  if (queued.op === 'update' && incoming.op === 'update') {
    if (!can('updateMany')) return null
    return { op: 'updateMany', tasks: [queued.task, incoming.task] }
  }

  if (queued.op === 'updateMany' && incoming.op === 'update') {
    if (!can('updateMany')) return null
    const tasks = queued.tasks.slice()
    const at = tasks.findIndex((task) => task.id === incoming.task.id)
    // LAST WRITER WINS PER ROW, in place. A row edited twice inside one batch must appear once —
    // sending both payloads would make the outcome depend on which the script wrote second.
    if (at < 0) tasks.push(incoming.task)
    else tasks[at] = incoming.task
    return { op: 'updateMany', tasks }
  }

  if (queued.op === 'create' && incoming.op === 'create') {
    return { op: 'create', tasks: [...queued.tasks, ...incoming.tasks] }
  }

  /**
   * A row created and then edited before its create was sent — ticking a subtask typed a second
   * ago. Created with the final values, which is what two sequential writes would have left.
   */
  if (queued.op === 'create' && incoming.op === 'update') {
    const at = queued.tasks.findIndex((task) => task.id === incoming.task.id)
    if (at < 0) return null
    const tasks = queued.tasks.slice()
    tasks[at] = incoming.task
    return { op: 'create', tasks }
  }

  return null
}

/**
 * One request at a time, adjacent writes folded, and every caller told what happened.
 *
 * A PLAIN OBJECT RATHER THAN A PROMISE CHAIN IN A REF, because the two rules it holds are the ones
 * a source check cannot verify: that a request is never dispatched while another is out, and that a
 * reply which is no longer the latest may not reach the board. Both are invisible on screen — an
 * out-of-order reply looks like a row briefly un-ticking itself — so both have to be callable.
 * `test/board.test.js` drives this directly.
 *
 * ONLY THE NEWEST CALLER OF A JOB IS HANDED THE BOARD. Every other caller's payload was subsumed
 * by the fold, so accepting on its behalf is the same clobber as accepting a stale reply. Callers
 * are settled newest first for the mirror reason: on a failure each one restores the tasks it
 * captured, and the OLDEST snapshot is the only one that predates the whole batch, so it has to
 * land last.
 *
 * @param {(plan: object) => Promise<object>} send
 * @param {(op: string) => boolean} [can] passed straight to `foldWrite`, and read at PUSH time
 *   rather than captured: the queue is built once, and what the deployment can dispatch is not
 *   known until a reply says so.
 */
export function createWriteQueue(send, can) {
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
        let board = null
        let failure = null
        try {
          board = await send(job.plan)
        } catch (error) {
          failure = error
        }
        // Every caller of this job stops waiting BEFORE any of them is settled, so the one holding
        // the board sees a truthful `pending` and does not race its own siblings to accept.
        waiting -= job.settle.length
        for (let i = job.settle.length - 1; i >= 0; i -= 1) {
          if (failure) job.settle[i].reject(failure)
          else job.settle[i].resolve(i === job.settle.length - 1 ? board : null)
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
    /**
     * @returns {Promise<object|null>} the fresh board for the caller entitled to it, null for one
     *   whose write was folded into another's, and a rejection carrying the failure for everybody
     *   when the request fails.
     */
    push(plan) {
      return new Promise((resolve, reject) => {
        waiting += 1
        issued += 1
        const tail = jobs[jobs.length - 1]
        const folded = tail ? foldWrite(tail.plan, plan, can) : null
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
   * NOT the same as an empty list — a script older than this bundle sends no `schema` field at
   * all, so `[]` is the positive signal that the deployment is out of date. The guard below
   * depends on the two staying distinct.
   */
  const [schema, setSchema] = useState(null)
  const [saving, setSaving] = useState(0)

  const lastRead = useRef(0)
  const reading = useRef(false)
  // Read inside callbacks that must not be re-created when the key changes.
  const keyRef = useRef(editKey)
  keyRef.current = editKey
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized
  /**
   * The ops the last reply advertised. A REF RATHER THAN STATE because nothing renders from it —
   * it decides the SHAPE of the next request, and only the queue asks. `null` until a reply lands,
   * which `supports` reads as "send the shape every deployment understands".
   */
  const opsRef = useRef(null)
  /**
   * Every write, in order, with adjacent ones folded into a single request.
   *
   * The key and the capability are both read at DISPATCH and PUSH rather than when the queue is
   * built, so a key that arrives while something is waiting is the one that goes out, and a fold is
   * only built once a reply has said the script can dispatch it. Built lazily and once: a queue
   * rebuilt on a render would drop whatever was still in it.
   */
  const queue = useRef(null)
  if (!queue.current) {
    queue.current = createWriteQueue(
      (plan) => REQUESTS[plan.op](plan)(keyRef.current),
      (op) => supports(opsRef.current, op),
    )
  }

  const config = useMemo(() => mergeConfig(sheetConfig), [sheetConfig])

  const accept = useCallback((board) => {
    setTasks(board.tasks)
    setSheetConfig(board.config)
    setSheetTimeZone(board.sheetTimeZone)
    setSchema(board.schema)
    // Not state: it shapes the NEXT request rather than anything on screen. See `opsRef`.
    opsRef.current = board.ops
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
    if (queue.current.pending > 0) return
    const at = Date.now()
    if (!force && at - lastRead.current < REFRESH_FLOOR_MS) return
    reading.current = true
    lastRead.current = at
    // AND THE CHECK HAS TO BE MADE AGAIN AFTER THE AWAIT. A read takes seconds, so a tick landing
    // during one is a write this board predates — accepted, it un-ticks the row on screen until the
    // write's own reply puts it back, which reads as the app losing the tap and then finding it.
    // `issued` catches a write that both started AND finished inside the window, which `pending`
    // cannot see. The throttle slot is spent either way; the write's reply is the fresher board.
    const before = queue.current.issued
    try {
      const board = await api.readBoard()
      if (queue.current.pending > 0 || queue.current.issued !== before) return
      accept(board)
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
   * Bump `saving`, queue the write, accept the fresh board, classify the failure, flag a rejected
   * key, decrement `saving`: written out once per mutation, one copy will eventually forget the
   * `unauthorized` callback and a rotated key will leave the app still showing edit controls.
   * One copy cannot drift from itself.
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
   * edits — and accepting it wipes them off the screen, so three subtasks ticked in a row read
   * 3 of 3, then 2 of 3, then 3 again. The queue is what makes dropping the intermediate boards
   * safe: it dispatches one request at a time, so the last reply is the one composed after every
   * earlier write had been applied, and it hands a board only to the caller still entitled to one.
   *
   * @param {object} plan the write, as data — see `REQUESTS` and `foldWrite`
   * @param {(tasks: object[]) => object[]} [optimistic]
   * @returns {Promise<boolean>} whether it landed
   */
  const run = useCallback(
    async (plan, optimistic) => {
      let rollback = null
      if (optimistic) {
        setTasks((previous) => {
          rollback = previous
          return optimistic(previous)
        })
      }
      setSaving((count) => count + 1)
      try {
        const board = await queue.current.push(plan)
        if (board && queue.current.pending === 0) accept(board)
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

  /**
   * COLUMNS THE DEPLOYED SCRIPT HAS NEVER HEARD OF, which is the whole out-of-date signal.
   *
   * A deployment is pinned to a version, so the browser can be running a newer column list than
   * the script — and the script writes rows by looping its OWN list, so one missing a column
   * silently DROPS that field. It answers `ok: true`, the row is written, and the value is simply
   * gone. EVERY WRITE IS THEREFORE REFUSED while the reported schema does not cover
   * `TASK_COLUMNS`.
   *
   * THE COMPARISON IS OVER THE WHOLE LIST, NEVER THE LAST ENTRY. Reading the final column alone
   * is sound only while the list can grow and nothing is renamed; a renamed column leaves a stale
   * deployment holding every other column including the last, so the guard would pass and each
   * write would drop the field it could not store.
   *
   * The rule lives in `missingColumnsFor` so it can be CALLED rather than grepped for.
   */
  const outdatedScript = useMemo(() => missingColumnsFor(schema).length > 0, [schema])

  /**
   * The one guard, in front of every write that touches a TASK ROW.
   *
   * ONE guard rather than one per operation: a per-op check is missing from something eventually,
   * and the paths that write a date are the ones that matter. Anything writing a row goes through
   * here, and `saveConfig` deliberately does not — it writes key/value pairs on the other tab,
   * where no column layout is involved, and it is how somebody fixes the wedding date while the
   * script is being redeployed.
   *
   * @returns {Promise<false>|null} null when the write may proceed
   */
  const refuseIfOutdated = useCallback(() => {
    if (!outdatedScript) return null
    setError(API_ERROR.OUTDATED)
    return Promise.resolve(false)
  }, [outdatedScript])

  const addTask = useCallback(
    (draft) => {
      const refused = refuseIfOutdated()
      if (refused) return refused
      const task = { ...draft, id: draft.id || newId(), pending: true }
      return run(
        { op: 'create', tasks: [task] },
        (previous) => [...previous, task],
      )
    },
    [run, refuseIfOutdated],
  )

  const editTask = useCallback(
    (task) => {
      // EVERY edit, not just a subtask's. `toggleDone` comes through here too, and a mismatched
      // script rewrites the whole row from the columns IT knows — so ticking a task is enough to
      // lose its date.
      const refused = refuseIfOutdated()
      if (refused) return refused
      return run(
        { op: 'update', task },
        (previous) => previous.map((row) => (row.id === task.id ? { ...task, pending: true } : row)),
      )
    },
    [run, refuseIfOutdated],
  )

  /**
   * A subtask is a task with a parent and no date. It goes through the same `run` as
   * everything else — a second write path would be another hand-written try/catch, which is
   * exactly what `run` exists to prevent.
   *
   * ENTERING FIVE IN A ROW IS THE DESIGNED-FOR GESTURE, and each one is a ~3s round trip, so the
   * second onwards are typed while the first is still out. The queue folds them into one
   * `createMany`, which is why five costs two requests rather than five.
   */
  const addSubtask = useCallback(
    (parent, title) => {
      const refused = refuseIfOutdated()
      if (refused) return refused
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
      return run(
        { op: 'create', tasks: [subtask] },
        (previous) => [...previous, subtask],
      )
    },
    [run, refuseIfOutdated],
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

  /**
   * Refused too, and not for the obvious reason. A mismatched script stamps `updated_at` and
   * `deleted_at` by ITS OWN indices — which point at different cells entirely once the grid has
   * been relaid out — so a delete against it can write over a column it was not aiming at. One
   * rule for everything touching the grid.
   */
  const removeTask = useCallback(
    (id) =>
      refuseIfOutdated() ?? run({ op: 'delete', id }, stamp(id, new Date().toISOString())),
    [run, refuseIfOutdated],
  )

  const restoreTask = useCallback(
    (id) => refuseIfOutdated() ?? run({ op: 'restore', id }, stamp(id, '')),
    [run, refuseIfOutdated],
  )

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
      if (refuseIfOutdated()) return 0
      const drafts = materialize(template, weddingDay, { locale, newId })
      if (!drafts.length) return 0
      return (await run({ op: 'create', tasks: drafts })) ? drafts.length : 0
    },
    [run, refuseIfOutdated],
  )

  /**
   * NOT OPTIMISTIC, AND THE ONE MUTATION THE SHEET STILL WAITS FOR. Giving it an optimistic half
   * is cheap and would be wrong: the settings sheet is where somebody changes the zone and the
   * wedding date, and drawing a new countdown that then reverts is a worse three seconds than a
   * spinner on the button. It writes key/value pairs on the other tab, so nothing is queued behind
   * a task write for long either.
   */
  const saveConfig = useCallback(
    (partial) => run({ op: 'setConfig', config: serializeConfig(partial) }),
    [run],
  )

  const compact = useCallback(
    () => refuseIfOutdated() ?? run({ op: 'compact' }),
    [run, refuseIfOutdated],
  )

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
    /** The deployed script is missing a column this bundle writes. See `missingColumnsFor`. */
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
