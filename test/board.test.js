/**
 * `useBoard`'s mutation primitive, and the write queue behind it.
 *
 * There is no DOM here, so this does not render the hook — it pins the property the single
 * `run` wrapper exists for: every mutation, without exception, flags a rejected key. A
 * hand-written copy that forgets to leaves a rotated key still showing edit controls and still
 * failing silently.
 *
 * The first block reads as a source check rather than a behavioural one. That is weaker than
 * calling the hook and it is the strongest thing available without a DOM: the failure it guards
 * is somebody adding another mutation with its own try/catch.
 *
 * A source check cannot test a RULE, though — it can only confirm the code says something, not
 * that it decides correctly. So anything with a rule in it belongs in a callable function, which
 * is what `foldWrite` and `createWriteQueue` are and what the blocks below exercise. THE QUEUE
 * ESPECIALLY: a request dispatched while another is out, or a row left claiming to be unsaved,
 * shows up on screen as a row that un-ticks itself and nowhere else at all.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { serializeConfig } from '../src/config.js'
import { API_ERROR } from '../src/lib/api.js'
import { createWriteQueue, foldWrite, revert } from '../src/state/useBoard.js'

const source = readFileSync('src/state/useBoard.js', 'utf8')

/**
 * Comments discuss the duplication this file forbids, so they have to go first.
 *
 * They are REMOVED, not blanked. Blanking a `//` line leaves an empty line behind, and
 * `declarationOf` splits on blank lines — so a comment inside a mutation would manufacture a
 * false block boundary and the assertion would read only the half above it.
 */
function code(text) {
  return text.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*\n/gm, '')
}

const body = code(source)

/**
 * The block of source declaring one mutation. Blocks rather than a brace-matching regex,
 * because some of these are a single line and some span twenty.
 */
function declarationOf(name) {
  return body
    .split(/\n\s*\n/)
    .find((block) => block.includes(`const ${name} = useCallback`))
}

describe('the mutation primitive', () => {
  it('exists exactly once', () => {
    expect(body.match(/const run = useCallback/g)).toHaveLength(1)
  })

  it('is the only place that flags a rejected key', () => {
    // One copy cannot drift from itself; several can.
    expect(body.match(/unauthorizedRef\.current\?\.\(\)/g)).toHaveLength(1)
  })

  it('is the only place that classifies a failure', () => {
    // Exactly one, and no `?? 0`: with the fallback this passed at ZERO occurrences, so deleting the
    // default that classifies an unrecognised failure — leaving `isTerminal(undefined)` to decide
    // whether a notice appears — read as a pass.
    expect(body.match(/API_ERROR\.TRANSIENT/g)).toHaveLength(1)
    expect(body.match(/code === API_ERROR\.UNAUTHORIZED/g)).toHaveLength(1)
  })

  it('is the only place that moves the saving counter', () => {
    // A mutation that bumps `saving` without the matching decrement wedges the service
    // worker's update check forever, because it never looks safe to reload again.
    expect(body.match(/setSaving\(\(count\) => count \+ 1\)/g)).toHaveLength(1)
    expect(body.match(/setSaving\(\(count\) => count - 1\)/g)).toHaveLength(1)
  })

  it('routes every mutation through it', () => {
    // The named mutations the hook exposes, each of which must be a `run` call rather than
    // its own try/catch.
    for (const mutation of [
      'compact',
      'saveConfig',
      'seedTemplate',
      'addTask',
      'addSubtask',
      'editTask',
      'removeTask',
      'restoreTask',
    ]) {
      const declaration = declarationOf(mutation)
      expect(declaration, `${mutation} not found`).toBeTruthy()
      expect(declaration, `${mutation} does not call run`).toMatch(/\brun\(/)
      expect(declaration, `${mutation} has its own try/catch`).not.toMatch(/\btry\b/)
    }
  })

  it('reverts only the rows the failed edit touched, never the whole array', () => {
    // The queue is serial, so a job that fails settles before the next is dispatched — but the
    // next one's optimistic edit has already landed. Tick A, tick B, A fails: restoring the array
    // from before A draws B un-ticked while the sheet has it done, and B's own success only clears
    // its pending flag.
    expect(body).toMatch(/setTasks\(\(current\) => revert\(current, before, after\)\)/)
    expect(body).not.toMatch(/setTasks\(rollback\)/)
  })

  it('refuses an update that would clear a tombstone', () => {
    // `update` rewrites the whole row from its payload, so an empty `deleted_at` in one resurrects
    // a deleted task. `TaskDetail` disarms its unmount flush on its own delete and its own save,
    // but a row also unmounts when a refresh brings back a board in which the OTHER editor deleted
    // it, and neither of those guards can see that.
    const declaration = declarationOf('editTask')
    expect(declaration).toMatch(/tasksRef\.current\.find/)
    expect(declaration).toMatch(/!isLive\(current\) && isLive\(task\)/)
  })

  it('sends the config keys it was handed and NOTHING else', () => {
    // The whole reason a document can share the config tab with the settings and no lock: one gesture
    // writes one cell. `App`'s text scan pins its own call site, `sheets.js` pins the row filter, and
    // this joins them — merging `config` in here would break the property with both still green.
    // Driven through the real `serializeConfig`, since that is what `saveConfig` calls.
    expect(declarationOf('saveConfig')).toMatch(/serializeConfig\(partial\)/)
    expect(declarationOf('saveConfig'), 'the payload must not be widened').not.toMatch(/\.\.\./)
    expect(serializeConfig({ notes: 'x' })).toEqual({ notes: 'x' })
    // And an emptied document is SENT, rather than dropped as absent: the read omits a blank value so
    // the default wins, so the write is the only half that can carry the clearing.
    expect(serializeConfig({ notes: '' })).toEqual({ notes: '' })
  })

  it('leaves the seed and the config writes non-optimistic', () => {
    // Forty rows appearing and then vanishing is worse than a second of a spinner, and a
    // config write has no row to show optimistically in the first place.
    expect(declarationOf('seedTemplate')).toMatch(/run\(\{ op: 'create', tasks: drafts \}\)/)
    expect(declarationOf('seedTemplate')).not.toMatch(/previous/)
    expect(declarationOf('saveConfig')).not.toMatch(/previous/)
  })

  it('hands every write to the ONE queue', () => {
    // Two queues would each serialise their own writes and neither would know about the other's,
    // which is the out-of-order clobber with extra steps. The key is no longer threaded through
    // here at all: `api.js` reads it at dispatch, so there is nothing to capture too early.
    expect(body.match(/queue\.current = createWriteQueue\(/g)).toHaveLength(1)
    expect(body).toMatch(/REQUESTS\[plan\.op\]\(plan\)/)
    expect(body.match(/queue\.current\.push\(/g)).toHaveLength(1)
  })

  it('settles pending rows on an EMPTY queue rather than per op, on both paths', () => {
    // A Sheets write answers with the ranges it touched and nothing about the board, so there is
    // no reply to accept — the optimistic state is the state, and all that is left is clearing the
    // dimming. Keyed on the queue being empty rather than on a per-op list of ids: the queue
    // dispatches one request at a time, so an empty queue means nothing is outstanding. A per-op
    // ledger is how a row ends up dimmed forever.
    //
    // IN `finally`, so it runs on the failure path too. A row dimmed by a write that then failed
    // behind a write that succeeded had nothing else able to clear it, and reads only happen on
    // focus — so on a board left in the foreground it stayed dimmed for good.
    expect(declarationOf('settle')).toMatch(/queue\.current\.pending > 0/)
    expect(declarationOf('settle')).toMatch(/task\.pending \? \{ \.\.\.task, pending: false \}/)
    expect(declarationOf('run')).toMatch(/} finally \{[\s\S]*settle\(\)[\s\S]*}/)
  })

  it('re-checks for a write AFTER the read comes back, not only before it', () => {
    // A read takes seconds. A tick that lands inside that window is a write this board predates,
    // and accepting it un-ticks the row until the write's own reply puts it back.
    const read = declarationOf('readOnce')
    expect(read).toMatch(/queue\.current\.issued/)
    expect(read).toMatch(
      /if \(queue\.current\.pending > 0 \|\| queue\.current\.issued !== before\) return false/,
    )
  })

  it('makes a FORCED refresh wait out a read in flight rather than give up', () => {
    // `saveConfig`, `compact` and the template seed have no optimistic half, so each reports
    // success on the strength of the re-read landing. Returning early because a focus read
    // happened to be open is how "Settings saved" appeared over the old wedding date.
    const refresh = declarationOf('refresh')
    expect(refresh).toMatch(/if \(!force\) return false/)
    expect(refresh).toMatch(/await inFlight\.current/)
  })

  it('knows the unauthorized code it branches on', () => {
    // Guards against the string drifting out of step with the api module.
    expect(API_ERROR.UNAUTHORIZED).toBe('unauthorized')
  })

  it('re-reads when the edit key changes, because that changes which backend is used', () => {
    // A device holding a key reads through the Sheets API and one without reads `doGet`. Without
    // `editKey` in the effect's deps, a freshly pasted link would keep reading the anonymous path
    // until the next focus.
    expect(body).toMatch(/\[refresh, editKey\]/)
  })
})

/**
 * ROLLING BACK ONE FAILED EDIT, driven rather than read.
 *
 * The source check above pins that `run` calls this; only calling it can show that it undoes the
 * failed edit and nothing else. Every case here is a board somebody would be looking at: a tick
 * that failed behind one that landed, a create that never reached the sheet, a row restored to
 * exactly what it held.
 */
describe('revert', () => {
  const TICK = '2026-08-13T00:00:00.000Z'
  const task = (id, extra = {}) => ({ id, title: id, doneAt: '', deletedAt: '', ...extra })

  it('leaves a LATER edit to a different row alone', () => {
    // Tick A, tick B, A fails. The queue is serial, so A settles before B is dispatched — but B's
    // optimistic tick already landed. Putting back the array from before A draws B un-ticked while
    // the sheet has it done, and B's own success only clears its pending flag.
    const a = task('a')
    const b = task('b')
    const before = [a, b]
    const after = [{ ...a, doneAt: TICK, pending: true }, b]
    const current = [after[0], { ...b, doneAt: TICK, pending: true }]

    const reverted = revert(current, before, after)
    expect(reverted[0]).toBe(a)
    expect(reverted[1].doneAt).toBe(TICK)
  })

  it('DROPS a failed create rather than reverting it', () => {
    // The row is absent from `before`, so there is nothing to put back: it exists only because
    // somebody typed it and the write did not land. Reverting it to an earlier version would
    // leave a task on screen that no sheet holds.
    const a = task('a')
    const fresh = task('n1', { pending: true })
    const reverted = revert([a, fresh], [a], [a, fresh])
    expect(reverted.map((row) => row.id)).toEqual(['a'])
  })

  it('drops a failed create without touching an edit made behind it', () => {
    const a = task('a')
    const fresh = task('n1', { pending: true })
    const edited = { ...a, title: 'Edited' }
    const reverted = revert([edited, fresh], [a], [a, fresh])
    expect(reverted).toEqual([edited])
  })

  it('restores the EXACT pre-edit object for the row it touched', () => {
    // Not a hand-computed inverse: the object the board held, so a failed rename cannot leave a
    // half-restored row wearing one field from before the edit and one from after it.
    const a = task('a', { title: 'Book the venue', category: 'Venue' })
    const before = [a]
    const after = [{ ...a, title: 'Book the hall', pending: true }]
    const reverted = revert(after, before, after)
    expect(reverted[0]).toBe(a)
  })

  it('returns the current array unchanged when the edit touched nothing', () => {
    // A non-optimistic write — the template seed, a config write — has no rows to put back, and an
    // update naming a row the board no longer holds changed none. Allocating a new array anyway
    // would re-render the whole list for nothing.
    const rows = [task('a'), task('b')]
    expect(revert(rows, rows, rows)).toBe(rows)
  })

  it('reads which rows were touched off the updater, by identity', () => {
    // An updater that rebuilt a row it did not change would report that row as touched, so B's
    // later tick would be undone by A's failure — the whole-array rollback again, arriving through
    // the updater instead. Every `optimistic` in the hook passes untouched rows through by
    // reference; the check below is what keeps that true.
    const before = [task('a'), task('b')]
    const rebuilt = before.map((row) => ({ ...row }))
    const withBTicked = [rebuilt[0], { ...rebuilt[1], doneAt: TICK }]
    expect(revert(withBTicked, before, rebuilt)).toEqual(before)
  })

  it('is only exact because no updater rebuilds a row it did not change', () => {
    // Each `previous.map` here has to hand the untouched arm the row itself. A `{ ...row }` there
    // reads identically on screen and silently widens every rollback.
    const maps = body.split('previous.map((row) =>').slice(1)
    expect(maps).toHaveLength(2)
    for (const map of maps) {
      const arrow = map.slice(0, 160)
      expect(arrow, arrow).toMatch(/\?[\s\S]*?: row[,)\s]/)
    }
  })
})

/**
 * FOLDING TWO WRITES INTO ONE REQUEST, which is the only lever the client has over write speed.
 *
 * Each round trip is ~0.5s against the Sheets API — two calls, a resolve and a write — so a burst
 * of edits costs the NUMBER of requests and every fold is a whole round trip removed.
 *
 * The rule is only ever offered the write at the TAIL of the queue, never one in flight, so a fold
 * can only ever merge ADJACENT writes. Everything below is a case where that adjacency makes two
 * requests provably equal to one, or a case where it does not and the answer must be null.
 *
 * THERE IS NO CAPABILITY ARGUMENT ANY MORE. The client is the writer, so a batch always lands;
 * `update` and `updateMany` collapsed into one op that always carries a list.
 */
describe('foldWrite', () => {
  const task = (id, extra = {}) => ({ id, title: id, category: '', due: '', doneAt: '', deletedAt: '', parentId: '', ...extra })
  const update = (...tasks) => ({ op: 'update', tasks })
  const create = (...tasks) => ({ op: 'create', tasks })

  it('collapses two writes of the SAME row into the later one', () => {
    // A write rewrites the whole row from its payload, so the later payload IS the outcome of
    // both. A tick and its undo, or a tick on a row whose edit has not gone out yet.
    const ticked = task('a', { doneAt: '2026-08-12T00:00:00.000Z' })
    expect(foldWrite(update(task('a', { title: 'Book the venue' })), update(ticked))).toEqual(
      update(ticked),
    )
  })

  it('batches two updates of DIFFERENT rows into one request', () => {
    // The fold worth having: ticking three subtasks is the highest-frequency gesture there is, and
    // each one was its own round trip. It stays an `update` — the op always carried a list, which
    // is what retired the separate `updateMany` this used to need a capability check for.
    expect(foldWrite(update(task('a')), update(task('b')))).toEqual(update(task('a'), task('b')))
  })

  it('grows a batch, and keeps only the later payload per row', () => {
    // A row edited twice inside one batch must appear ONCE, or the outcome depends on which of the
    // two payloads is written second.
    const batch = update(task('a'), task('b'))
    expect(foldWrite(batch, update(task('c'))).tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    const ticked = task('a', { doneAt: '2026-08-12T00:00:00.000Z' })
    expect(foldWrite(batch, update(ticked))).toEqual(update(ticked, task('b')))
  })

  it('batches creates into one request, in the order they were made', () => {
    // Entering five subtasks is a designed-for gesture, so the second onwards are typed while the
    // first is still out. Order matters: the append writes the list, so a parent typed before its
    // child has to stay before it.
    const folded = foldWrite(create(task('s1')), create(task('s2')))
    expect(folded).toEqual(create(task('s1'), task('s2')))
    expect(foldWrite(folded, create(task('s3'))).tasks.map((t) => t.id)).toEqual(['s1', 's2', 's3'])
  })

  it('folds an edit of a row whose create has not gone out into the create', () => {
    // Ticking a subtask typed a second ago. Created with the final values, which is exactly what
    // the two sequential writes would have left — and the row keeps its place in the batch.
    const ticked = task('s1', { doneAt: '2026-08-12T00:00:00.000Z' })
    expect(foldWrite(create(task('s1'), task('s2')), update(ticked))).toEqual(
      create(ticked, task('s2')),
    )
  })

  it('refuses an edit of a row the queued create does not carry', () => {
    // Reordering it into the batch would write it before the row existed, and a mixed
    // create-and-update batch is not something any op can express.
    expect(foldWrite(create(task('s1')), update(task('x')))).toBeNull()
    // Including when only SOME of a batched update is carried: half a fold is not a fold.
    expect(foldWrite(create(task('s1')), update(task('s1'), task('x')))).toBeNull()
  })

  it('NEVER folds a delete, a restore or a config write', () => {
    // `update` then `delete` is the resurrection defect: folded either way it writes an empty
    // `deleted_at` over the tombstone or drops an edit somebody watched land. `delete` then
    // `restore` collapses to nothing at all, which is not what either gesture asked for.
    const cases = [
      [update(task('a')), { op: 'delete', id: 'a' }],
      [update(task('a'), task('b')), { op: 'delete', id: 'a' }],
      [create(task('a')), { op: 'delete', id: 'a' }],
      [{ op: 'delete', id: 'a' }, { op: 'restore', id: 'a' }],
      [{ op: 'delete', id: 'a' }, { op: 'delete', id: 'b' }],
      [{ op: 'restore', id: 'a' }, update(task('a'))],
      [update(task('a')), create(task('b'))],
      [{ op: 'setConfig', config: {} }, { op: 'setConfig', config: {} }],
      [{ op: 'compact' }, { op: 'compact' }],
      [update(task('a')), { op: 'compact' }],
    ]
    for (const [queued, incoming] of cases) {
      expect(foldWrite(queued, incoming), `${queued.op} + ${incoming.op}`).toBeNull()
    }
  })

  it('folds nothing into an empty queue', () => {
    expect(foldWrite(null, update(task('a')))).toBeNull()
    expect(foldWrite(undefined, create(task('a')))).toBeNull()
  })
})

/**
 * THE QUEUE, DRIVEN. Two rules live here and neither is visible on screen: a request is never
 * dispatched while another is out, and a reply that is no longer the freshest may not reach the
 * board. Break the first and two writes contend on the script's lock; break the second and a row
 * un-ticks itself for three seconds and then ticks again.
 */
describe('createWriteQueue', () => {
  /** A send whose replies are released by hand, so "still in flight" is a state a test can hold. */
  function harness() {
    const sent = []
    const gates = []
    const queue = createWriteQueue((plan) => {
      sent.push(plan)
      let settle
      const promise = new Promise((resolve, reject) => {
        settle = { resolve, reject }
      })
      gates.push(settle)
      return promise
    })
    return { queue, sent, gates }
  }

  /** Long enough for the pump to settle a job's callers and dispatch the next. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  const task = (id) => ({ id, title: id })

  it('dispatches one request at a time', async () => {
    const { queue, sent, gates } = harness()
    const first = queue.push({ op: 'update', tasks: [task('a')] })
    const second = queue.push({ op: 'delete', id: 'b' })
    // The second must not be out yet. Each write resolves id -> row from a read taken immediately
    // before it, so two in flight would have the later one resolving against a grid the earlier
    // one is still changing.
    expect(sent).toEqual([{ op: 'update', tasks: [task('a')] }])
    gates[0].resolve()
    await first
    await flush()
    expect(sent).toHaveLength(2)
    gates[1].resolve()
    await second
  })

  it('reports a truthful `pending` to each caller as it settles', async () => {
    // `run` reads this to decide whether to clear the rows' unsaved dimming, so it must still be
    // non-zero while a later write is outstanding — settling a row while another write is queued
    // would undim it and then dim it again.
    const { queue, gates } = harness()
    const seen = []
    const record = (plan) => queue.push(plan).then((ok) => seen.push({ ok, pending: queue.pending }))
    const first = record({ op: 'update', tasks: [task('a')] })
    const second = record({ op: 'delete', id: 'b' })
    gates[0].resolve()
    await first
    await flush()
    gates[1].resolve()
    await second
    expect(seen[0]).toEqual({ ok: true, pending: 1 })
    expect(seen[1]).toEqual({ ok: true, pending: 0 })
  })

  it('turns three ticks in a burst into two requests', async () => {
    // THE HEADLINE. Three subtasks ticked one after another, each ~200ms apart against a ~500ms
    // round trip: the first is already out and cannot be recalled, and the second and third leave
    // together as one batched `update`.
    const { queue, sent, gates } = harness()
    const results = [
      queue.push({ op: 'update', tasks: [task('a')] }),
      queue.push({ op: 'update', tasks: [task('b')] }),
      queue.push({ op: 'update', tasks: [task('c')] }),
    ]
    expect(sent).toEqual([{ op: 'update', tasks: [task('a')] }])
    gates[0].resolve()
    await results[0]
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ op: 'update', tasks: [task('b'), task('c')] })
    gates[1].resolve()
    expect(await Promise.all(results)).toEqual([true, true, true])
  })

  it('turns five subtasks typed in a row into two requests', async () => {
    const { queue, sent, gates } = harness()
    const results = []
    for (let i = 1; i <= 5; i += 1) results.push(queue.push({ op: 'create', tasks: [task(`s${i}`)] }))
    // One in flight, four folded behind it. A queue that did not fold would spend five round
    // trips, so the fifth row would reach the sheet seconds after it was typed.
    expect(sent).toHaveLength(1)
    gates[0].resolve()
    await results[0]
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].tasks.map((t) => t.id)).toEqual(['s2', 's3', 's4', 's5'])
    gates[1].resolve()
    // Every caller of a folded job succeeds together: the survivor's request carried all their
    // payloads, so there is nothing left for any of them to be told separately.
    expect(await Promise.all(results)).toEqual([true, true, true, true, true])
  })

  it('never folds into a request already in flight', async () => {
    // The in-flight job leaves the queue before it is sent, which is what makes this structural
    // rather than a check somebody has to remember.
    const { queue, sent, gates } = harness()
    queue.push({ op: 'create', tasks: [task('s1')] })
    queue.push({ op: 'create', tasks: [task('s2')] })
    expect(sent[0].tasks.map((t) => t.id)).toEqual(['s1'])
    gates[0].resolve()
    await flush()
    expect(sent[1].tasks.map((t) => t.id)).toEqual(['s2'])
  })

  it('fails every folded caller, newest first, and keeps going', async () => {
    // Each caller rolls back to the tasks it captured, so the OLDEST snapshot has to land last —
    // it is the only one that predates the whole batch. And one rejected request must not wedge
    // the queue for everything behind it.
    const { queue, sent, gates } = harness()
    const order = []
    const failures = []
    const catcher = (name) => (error) => {
      failures.push(error)
      order.push(name)
    }
    queue.push({ op: 'update', tasks: [task('a')] }).catch(catcher('inflight'))
    queue.push({ op: 'create', tasks: [task('s1')] }).catch(catcher('older'))
    queue.push({ op: 'create', tasks: [task('s2')] }).catch(catcher('newer'))
    const boom = new Error('busy')
    gates[0].reject(boom)
    await flush()
    gates[1].reject(boom)
    await flush()
    expect(order).toEqual(['inflight', 'newer', 'older'])
    expect(failures).toEqual([boom, boom, boom])
    // Still alive: a third write goes out.
    queue.push({ op: 'compact' })
    await flush()
    expect(sent).toHaveLength(3)
    gates[2].resolve()
  })

  it('reports `pending` 0 to a caller whose write FAILED, not just to one that landed', async () => {
    // `run` settles the rows in `finally`, and `settle` returns early unless the queue is empty —
    // so a failed write that still counted itself as pending would leave every row it dimmed dimmed
    // for good: nothing else clears them and reads only happen on focus.
    const { queue, gates } = harness()
    let pendingWhenTold = -1
    const write = queue.push({ op: 'update', tasks: [task('a')] }).catch(() => {
      pendingWhenTold = queue.pending
    })
    gates[0].reject(new Error('nope'))
    await write
    expect(pendingWhenTold).toBe(0)
  })

  it('counts every write it was ever handed, so a read can tell it overlapped one', async () => {
    // `refresh` compares this across its own await. A write that both starts and finishes inside
    // a read's window is invisible to `pending` and is exactly the one whose board the read would
    // undo.
    const { queue, gates } = harness()
    expect(queue.issued).toBe(0)
    const write = queue.push({ op: 'update', tasks: [task('a')] })
    expect(queue.issued).toBe(1)
    gates[0].resolve()
    await write
    expect(queue.pending).toBe(0)
    expect(queue.issued).toBe(1)
  })
})
