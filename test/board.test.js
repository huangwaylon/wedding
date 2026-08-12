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
 * is what `missingColumnsFor`, `foldWrite` and `createWriteQueue` are and what the blocks below
 * exercise. THE QUEUE ESPECIALLY: a request dispatched while another is out, or a reply accepted
 * after a fresher one, shows up on screen as a row that un-ticks itself for three seconds and
 * nowhere else at all.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_ERROR } from '../src/lib/api.js'
import { TASK_COLUMNS } from '../src/schema.js'
import { createWriteQueue, foldWrite, missingColumnsFor, supports } from '../src/state/useBoard.js'

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
    expect(body.match(/API_ERROR\.TRANSIENT/g)?.length ?? 0).toBeLessThanOrEqual(2)
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

  it('restores the previous tasks on failure', () => {
    expect(body).toMatch(/if \(rollback\) setTasks\(rollback\)/)
  })

  it('leaves the seed and the config writes non-optimistic', () => {
    // Forty rows appearing and then vanishing is worse than a second of a spinner, and a
    // config write has no row to show optimistically in the first place.
    expect(declarationOf('seedTemplate')).toMatch(/run\(\{ op: 'create', tasks: drafts \}\)/)
    expect(declarationOf('seedTemplate')).not.toMatch(/previous/)
    expect(declarationOf('saveConfig')).not.toMatch(/previous/)
  })

  it('hands every write to the ONE queue, and reads the key at dispatch', () => {
    // Two queues would each serialise their own writes and neither would know about the other's
    // replies, which is the out-of-order clobber with extra steps. And the key has to be resolved
    // when a request goes out rather than when it is queued, or one that arrives while something
    // is waiting sends the write it was queued without.
    expect(body.match(/queue\.current = createWriteQueue\(/g)).toHaveLength(1)
    expect(body).toMatch(/REQUESTS\[plan\.op\]\(plan\)\(keyRef\.current\)/)
    expect(body.match(/queue\.current\.push\(/g)).toHaveLength(1)
  })

  it('asks what the deployment can dispatch at PUSH time, from the last reply', () => {
    // Captured once, the queue would decide with what a cold start knew — which is nothing, so it
    // would never fold. Held as state, every reply would re-render the whole board to record
    // something nothing draws.
    expect(body).toMatch(/\(op\) => supports\(opsRef\.current, op\)/)
    expect(declarationOf('accept')).toMatch(/opsRef\.current = board\.ops/)
    expect(body).not.toMatch(/setOps/)
  })

  it('accepts a board only from the caller still entitled to one', () => {
    // Both halves matter: `board` is null for a write folded into a later one, and a non-zero
    // `pending` means a fresher write is still out and this reply predates it.
    expect(body).toMatch(/if \(board && queue\.current\.pending === 0\) accept\(board\)/)
  })

  it('re-checks for a write AFTER the read comes back, not only before it', () => {
    // A read takes seconds. A tick that lands inside that window is a write this board predates,
    // and accepting it un-ticks the row until the write's own reply puts it back.
    const refresh = declarationOf('refresh')
    expect(refresh).toMatch(/queue\.current\.issued/)
    expect(refresh).toMatch(
      /if \(queue\.current\.pending > 0 \|\| queue\.current\.issued !== before\) return/,
    )
  })

  it('declares the outdated-script flag before the mutations that depend on it', () => {
    // A `useCallback` dep array is evaluated during render, so a `const` declared BELOW one is
    // still in its temporal dead zone — a ReferenceError on every render, not a lint nit.
    expect(body.indexOf('const outdatedScript')).toBeLessThan(body.indexOf('const editTask'))
    expect(body.indexOf('const refuseIfOutdated')).toBeLessThan(body.indexOf('const addTask'))
  })

  it('puts the SAME guard in front of every write that touches a row', () => {
    // ONE guard rather than one per operation: a per-op check goes missing from something
    // eventually, and the paths that write a date are the ones that matter.
    for (const name of [
      'addTask',
      'editTask',
      'addSubtask',
      'removeTask',
      'restoreTask',
      'compact',
    ]) {
      expect(declarationOf(name), `${name} is unguarded`).toMatch(/refuseIfOutdated\(\)/)
    }
    // And deliberately NOT on the config, which writes key/value pairs on the other tab: it is
    // how somebody fixes the wedding date while the script is being redeployed.
    expect(declarationOf('saveConfig')).not.toMatch(/refuseIfOutdated/)
  })

  it('refuses rather than letting the script reshape the row', () => {
    // A warning alone would still let somebody make the mess: the write returns {ok:true}, the
    // row is written, and the column it has never heard of is simply dropped.
    expect(declarationOf('refuseIfOutdated')).toMatch(/setError\(API_ERROR\.OUTDATED\)/)
    expect(declarationOf('refuseIfOutdated')).toMatch(/return Promise\.resolve\(false\)/)
  })
})

/**
 * The out-of-date rule itself, called rather than grepped for.
 *
 * A deployment is pinned to a version, so the browser can be running a newer column list than
 * the script. The rule has to compare the WHOLE list: checking the last column alone is sound
 * only while the list can grow and nothing is ever renamed, and a rename leaves a stale
 * deployment holding every other column including the last one.
 */
describe('missingColumnsFor', () => {
  /** What a deployment predating the current layout reports. */
  const LEGACY = [
    'id',
    'title',
    'category',
    'start',
    'end',
    'all_day',
    'done_at',
    'notes',
    'owner',
    'created_at',
    'updated_at',
    'deleted_at',
    'parent_id',
  ]

  it('catches a RENAMED column, not just an appended one', () => {
    expect(missingColumnsFor(LEGACY)).toEqual(['due'])
  })

  it('is not fooled by the last column being present', () => {
    // Which is why the rule cannot read the final entry alone: this list has it.
    expect(LEGACY).toContain(TASK_COLUMNS[TASK_COLUMNS.length - 1])
    expect(missingColumnsFor(LEGACY).length).toBeGreaterThan(0)
  })

  it('passes a deployment that knows every column, extras and order notwithstanding', () => {
    expect(missingColumnsFor(TASK_COLUMNS)).toEqual([])
    expect(missingColumnsFor([...TASK_COLUMNS].reverse())).toEqual([])
    expect(missingColumnsFor([...TASK_COLUMNS, 'something_newer'])).toEqual([])
  })

  it('treats an unread schema and an empty one differently', () => {
    // `null` is "nothing read yet" and must not flag, or every cold start would warn about
    // itself. `[]` is a script that sends no schema at all, so everything is missing.
    expect(missingColumnsFor(null)).toEqual([])
    expect(missingColumnsFor([])).toEqual(TASK_COLUMNS)
  })

  it('knows the unauthorized code it branches on', () => {
    // Guards against the string drifting out of step with the api module.
    expect(API_ERROR.UNAUTHORIZED).toBe('unauthorized')
  })
})

/**
 * WHAT THE DEPLOYED SCRIPT CAN DISPATCH, which is a different question from what it can STORE.
 *
 * `schema` reports columns and cannot answer this: a script can hold every column and still have no
 * idea how to batch. The two rules therefore fall OPPOSITE ways on "not known yet", and getting
 * either backwards is a real defect — an unknown schema that refuses writes locks every cold start
 * out, and an unknown op that gets sent anyway comes back `bad_op` and loses the whole batch.
 */
describe('supports', () => {
  it('answers false until a reply says otherwise', () => {
    // The state before the first read, and also what a deployment older than this bundle reports.
    expect(supports(null, 'updateMany')).toBe(false)
    expect(supports(undefined, 'updateMany')).toBe(false)
    expect(supports([], 'updateMany')).toBe(false)
  })

  it('falls the OPPOSITE way to missingColumnsFor, deliberately', () => {
    // Not knowing the schema must not refuse a write; not knowing the ops must not send one. Both
    // land on "use the shape every deployment understands".
    expect(missingColumnsFor(null)).toEqual([])
    expect(supports(null, 'updateMany')).toBe(false)
  })

  it('reads a list that omits the op as a refusal, not as unknown', () => {
    const pinned = ['create', 'createMany', 'update', 'delete', 'restore', 'setConfig', 'compact']
    expect(supports(pinned, 'update')).toBe(true)
    expect(supports(pinned, 'updateMany')).toBe(false)
  })

  it('agrees with the ops the deployed script actually advertises', () => {
    // Read out of `Code.gs` rather than typed here: the client folds on the strength of this list,
    // so a rename there has to fail here rather than at runtime on somebody's phone.
    const advertised = /var OPS = \[([\s\S]*?)\]/
      .exec(readFileSync('apps-script/Code.gs', 'utf8'))[1]
      .match(/'([^']+)'/g)
      .map((quoted) => quoted.slice(1, -1))
    expect(advertised).toContain('updateMany')
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'delete', 'restore', 'setConfig', 'compact']) {
      expect(supports(advertised, op), op).toBe(true)
    }
  })
})

/**
 * FOLDING TWO WRITES INTO ONE REQUEST, which is the only lever the client has over write speed.
 *
 * Measured: the request is ~280 bytes, a 52-row reply is ~1KB gzipped and costs 0.015ms to parse,
 * so a round trip's ~3s is entirely Google's. What a burst of edits costs is therefore the NUMBER
 * of requests, and every fold is a whole round trip removed.
 *
 * The rule is only ever offered the write at the TAIL of the queue, never one in flight, so a fold
 * can only ever merge ADJACENT writes. Everything below is a case where that adjacency makes two
 * requests provably equal to one, or a case where it does not and the answer must be null.
 */
describe('foldWrite', () => {
  const task = (id, extra = {}) => ({ id, title: id, category: '', due: '', doneAt: '', deletedAt: '', parentId: '', ...extra })
  /** A deployment that advertises the batch, and one that does not. */
  const modern = (op) => op === 'updateMany'
  const pinned = () => false

  it('collapses two writes of the SAME row into the later one', () => {
    // `update` rewrites the whole row from its payload, so the later payload IS the outcome of
    // both. A tick and its undo, or a tick on a row whose edit has not gone out yet. No capability
    // needed: this stays an `update`, which every deployment can dispatch.
    const first = { op: 'update', task: task('a', { title: 'Book the venue' }) }
    const second = { op: 'update', task: task('a', { doneAt: '2026-08-12T00:00:00.000Z' }) }
    expect(foldWrite(first, second, pinned)).toEqual(second)
  })

  it('batches two updates of DIFFERENT rows into one updateMany', () => {
    // The fold worth having: ticking three subtasks is the highest-frequency gesture there is, and
    // each one was its own ~3s round trip.
    expect(
      foldWrite({ op: 'update', task: task('a') }, { op: 'update', task: task('b') }, modern),
    ).toEqual({ op: 'updateMany', tasks: [task('a'), task('b')] })
  })

  it('refuses that batch when the reply advertises ops WITHOUT updateMany', () => {
    // A deployment is pinned to a version, so the script can be older than this bundle and would
    // answer `bad_op` — losing every edit in the batch instead of one round trip.
    const two = [{ op: 'update', task: task('a') }, { op: 'update', task: task('b') }]
    expect(foldWrite(two[0], two[1], pinned)).toBeNull()
    expect(foldWrite(two[0], two[1], (op) => ['create', 'update', 'delete'].includes(op))).toBeNull()
    // And with no capability argument at all, which is what "nothing read yet" looks like.
    expect(foldWrite(two[0], two[1])).toBeNull()
  })

  it('grows a batch, and keeps only the later payload per row', () => {
    // A row edited twice inside one batch must appear ONCE, or the outcome depends on which of the
    // two payloads the script happens to write second.
    const batch = { op: 'updateMany', tasks: [task('a'), task('b')] }
    expect(foldWrite(batch, { op: 'update', task: task('c') }, modern).tasks.map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    const ticked = task('a', { doneAt: '2026-08-12T00:00:00.000Z' })
    expect(foldWrite(batch, { op: 'update', task: ticked }, modern)).toEqual({
      op: 'updateMany',
      tasks: [ticked, task('b')],
    })
  })

  it('batches creates into one request, in the order they were made', () => {
    // Entering five subtasks is a designed-for gesture and each one is a ~3s round trip, so the
    // second onwards are typed while the first is still out. Order matters: `createTasks` appends
    // the list, so a parent typed before its child has to stay before it.
    const folded = foldWrite(
      { op: 'create', tasks: [task('s1')] },
      { op: 'create', tasks: [task('s2')] },
      modern,
    )
    expect(folded).toEqual({ op: 'create', tasks: [task('s1'), task('s2')] })
    expect(
      foldWrite(folded, { op: 'create', tasks: [task('s3')] }, modern).tasks.map((t) => t.id),
    ).toEqual(['s1', 's2', 's3'])
  })

  it('folds an edit of a row whose create has not gone out into the create', () => {
    // Ticking a subtask typed a second ago. Created with the final values, which is exactly what
    // the two sequential writes would have left — and the row keeps its place in the batch.
    const queued = { op: 'create', tasks: [task('s1'), task('s2')] }
    const ticked = task('s1', { doneAt: '2026-08-12T00:00:00.000Z' })
    expect(foldWrite(queued, { op: 'update', task: ticked }, modern)).toEqual({
      op: 'create',
      tasks: [ticked, task('s2')],
    })
  })

  it('refuses an edit of a row the queued create does not carry', () => {
    // Reordering it into the batch would write it before the row existed, and a mixed
    // create-and-update batch is not something any op can express.
    expect(
      foldWrite({ op: 'create', tasks: [task('s1')] }, { op: 'update', task: task('x') }, modern),
    ).toBeNull()
  })

  it('NEVER folds a delete, a restore or a config write, capability or not', () => {
    // `update` then `delete` is the resurrection defect: folded either way it writes an empty
    // `deleted_at` over the tombstone or drops an edit somebody watched land. `delete` then
    // `restore` collapses to nothing at all, which is not what either gesture asked for.
    const cases = [
      [{ op: 'update', task: task('a') }, { op: 'delete', id: 'a' }],
      [{ op: 'updateMany', tasks: [task('a'), task('b')] }, { op: 'delete', id: 'a' }],
      [{ op: 'create', tasks: [task('a')] }, { op: 'delete', id: 'a' }],
      [{ op: 'delete', id: 'a' }, { op: 'restore', id: 'a' }],
      [{ op: 'delete', id: 'a' }, { op: 'delete', id: 'b' }],
      [{ op: 'restore', id: 'a' }, { op: 'update', task: task('a') }],
      [{ op: 'update', task: task('a') }, { op: 'create', tasks: [task('b')] }],
      [{ op: 'setConfig', config: {} }, { op: 'setConfig', config: {} }],
      [{ op: 'compact' }, { op: 'compact' }],
      [{ op: 'update', task: task('a') }, { op: 'compact' }],
      [{ op: 'updateMany', tasks: [task('a')] }, { op: 'compact' }],
    ]
    for (const [queued, incoming] of cases) {
      // `() => true` on purpose: a capability must not be a licence to merge across ops.
      expect(foldWrite(queued, incoming, () => true), `${queued.op} + ${incoming.op}`).toBeNull()
    }
  })

  it('folds nothing into an empty queue', () => {
    expect(foldWrite(null, { op: 'update', task: task('a') }, modern)).toBeNull()
    expect(foldWrite(undefined, { op: 'create', tasks: [task('a')] }, modern)).toBeNull()
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
  function harness({ can = (op) => op === 'updateMany' } = {}) {
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
    }, can)
    return { queue, sent, gates }
  }

  /** Long enough for the pump to settle a job's callers and dispatch the next. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  const task = (id) => ({ id, title: id })

  it('dispatches one request at a time', async () => {
    const { queue, sent, gates } = harness()
    const first = queue.push({ op: 'update', task: task('a') })
    const second = queue.push({ op: 'delete', id: 'b' })
    // The second must not be out yet: two writes in flight contend on the script's lock, and the
    // reply order they come back in is then nobody's to predict.
    expect(sent).toEqual([{ op: 'update', task: task('a') }])
    gates[0].resolve({ tag: 'one' })
    await first
    await flush()
    expect(sent).toHaveLength(2)
    gates[1].resolve({ tag: 'two' })
    await second
  })

  it('lets no reply but the freshest reach the board', async () => {
    // THE STALE-REPLY RULE. Every reply carries the whole board as of that write, so the first
    // one describes a sheet without the second's edit. `pending` is what `run` reads before it
    // accepts, and it must still be non-zero while a later write is outstanding.
    const { queue, gates } = harness()
    const seen = []
    const record = (plan) =>
      queue.push(plan).then((board) => seen.push({ board, pending: queue.pending }))
    const first = record({ op: 'update', task: task('a') })
    const second = record({ op: 'delete', id: 'b' })
    gates[0].resolve({ tag: 'stale' })
    await first
    await flush()
    gates[1].resolve({ tag: 'fresh' })
    await second
    expect(seen[0]).toEqual({ board: { tag: 'stale' }, pending: 1 })
    expect(seen[1]).toEqual({ board: { tag: 'fresh' }, pending: 0 })
  })

  it('turns three ticks in a burst into two requests', async () => {
    // THE HEADLINE. Three subtasks ticked one after another, each ~200ms apart against a ~3s round
    // trip: the first is already out and cannot be recalled, and the second and third leave
    // together as one `updateMany`.
    const { queue, sent, gates } = harness()
    const results = [
      queue.push({ op: 'update', task: task('a') }),
      queue.push({ op: 'update', task: task('b') }),
      queue.push({ op: 'update', task: task('c') }),
    ]
    expect(sent).toEqual([{ op: 'update', task: task('a') }])
    gates[0].resolve({ tag: 'one' })
    await results[0]
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ op: 'updateMany', tasks: [task('b'), task('c')] })
    gates[1].resolve({ tag: 'two' })
    expect(await Promise.all(results)).toEqual([{ tag: 'one' }, null, { tag: 'two' }])
  })

  it('sends three of them where the deployment cannot batch', async () => {
    // A script pinned to an older version answers `bad_op`, which would lose all three edits
    // rather than two round trips. Slower is the correct answer here.
    const { queue, sent, gates } = harness({ can: () => false })
    for (const id of ['a', 'b', 'c']) queue.push({ op: 'update', task: task(id) })
    gates[0].resolve({})
    await flush()
    gates[1].resolve({})
    await flush()
    expect(sent.map((plan) => plan.op)).toEqual(['update', 'update', 'update'])
    gates[2].resolve({})
  })

  it('turns five subtasks typed in a row into two requests', async () => {
    const { queue, sent, gates } = harness()
    const results = []
    for (let i = 1; i <= 5; i += 1) results.push(queue.push({ op: 'create', tasks: [task(`s${i}`)] }))
    // One in flight, four folded behind it. A queue that did not fold would spend five round
    // trips, so the fifth row would reach the sheet fifteen seconds after it was typed.
    expect(sent).toHaveLength(1)
    gates[0].resolve({ tag: 'one' })
    await results[0]
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].tasks.map((t) => t.id)).toEqual(['s2', 's3', 's4', 's5'])
    gates[1].resolve({ tag: 'two' })
    const boards = await Promise.all(results)
    // ONLY THE NEWEST CALLER OF A FOLDED JOB IS HANDED THE BOARD. The other three wrote payloads
    // the survivor subsumes, and accepting on their behalf is the same clobber as a stale reply.
    expect(boards).toEqual([{ tag: 'one' }, null, null, null, { tag: 'two' }])
  })

  it('never folds into a request already in flight', async () => {
    // The in-flight job leaves the queue before it is sent, which is what makes this structural
    // rather than a check somebody has to remember.
    const { queue, sent, gates } = harness()
    queue.push({ op: 'create', tasks: [task('s1')] })
    queue.push({ op: 'create', tasks: [task('s2')] })
    expect(sent[0].tasks.map((t) => t.id)).toEqual(['s1'])
    gates[0].resolve({})
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
    queue.push({ op: 'update', task: task('a') }).catch(catcher('inflight'))
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
    gates[2].resolve({})
  })

  it('counts every write it was ever handed, so a read can tell it overlapped one', async () => {
    // `refresh` compares this across its own await. A write that both starts and finishes inside
    // a read's window is invisible to `pending` and is exactly the one whose board the read would
    // undo.
    const { queue, gates } = harness()
    expect(queue.issued).toBe(0)
    const write = queue.push({ op: 'update', task: task('a') })
    expect(queue.issued).toBe(1)
    gates[0].resolve({})
    await write
    expect(queue.pending).toBe(0)
    expect(queue.issued).toBe(1)
  })
})
