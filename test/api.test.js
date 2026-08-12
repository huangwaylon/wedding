/**
 * The endpoint's failure taxonomy. This file exists because every failure mode here is
 * INVISIBLE: the endpoint always answers HTTP 200, so a misclassified reply either logs
 * an editor out for no reason or hides a rotated key behind retries forever. Neither
 * shows up in a build or on screen.
 */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_ERROR, isTerminal, readBoard, mutate, updateTasks } from '../src/lib/api.js'
import { SCRIPT_URL } from '../src/config.js'

function reply(body, { asText } = {}) {
  return vi.fn(async () => ({
    ok: true,
    text: async () => (asText ? body : JSON.stringify(body)),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/**
 * A rejection, once the retries behind it have run.
 *
 * EVERY NON-TERMINAL FAILURE IS RETRIED NOW, with a backoff between attempts, so asserting on one
 * means letting those attempts happen — on fake timers, or the suite pays the real backoff for each
 * case below. `runAllTimersAsync` has to interleave with the awaits inside `send`, which is why the
 * promise is started first and settled last.
 */
async function refuses(start, code) {
  vi.useFakeTimers()
  const settled = expect(start()).rejects.toMatchObject({ code })
  await vi.runAllTimersAsync()
  await settled
}

const BOARD = {
  ok: true,
  tasks: [
    {
      id: 'a',
      title: 'Book the venue',
      category: 'Venue',
      due: '2027-02-01',
      done_at: '',
      created_at: '',
      updated_at: '',
      deleted_at: '',
      parent_id: '',
    },
  ],
  config: { wedding_date: '2027-04-18', categories: 'Venue, Attire' },
  sheetTimeZone: 'Asia/Tokyo',
}

describe('readBoard', () => {
  it('decodes tasks and parses the config', () => {
    vi.stubGlobal('fetch', reply(BOARD))
    return readBoard(1).then((board) => {
      expect(board.tasks[0]).toMatchObject({
        id: 'a',
        title: 'Book the venue',
        due: '2027-02-01',
      })
      expect(board.config).toEqual({
        weddingDate: '2027-04-18',
        categories: ['Venue', 'Attire'],
      })
      expect(board.sheetTimeZone).toBe('Asia/Tokyo')
    })
  })

  it('sends no credential at all', async () => {
    // The defining property of the read path: a view-only planner has nothing to send.
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await readBoard(1)
    const [, init] = fetcher.mock.calls[0]
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  it('busts the cache in the query string', async () => {
    // Google serves /exec through its own cache. Without this a planner reloading right
    // after an edit is handed the previous board. It cannot be a fragment — a fragment
    // never reaches the server, which is exactly why the KEY lives in one.
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await readBoard(1234)
    expect(fetcher.mock.calls[0][0]).toBe(`${SCRIPT_URL}?t=1234`)
  })

  it('drops a row with no id rather than rendering a blank task', () => {
    vi.stubGlobal('fetch', reply({ ...BOARD, tasks: [{ title: 'orphan' }] }))
    return readBoard(1).then((board) => expect(board.tasks).toEqual([]))
  })

  it('reads needsSetup as an empty board, not an error', () => {
    // A spreadsheet whose tabs have not been built yet. An editor's first write builds
    // them; a planner just sees nothing.
    vi.stubGlobal('fetch', reply({ ok: true, needsSetup: true, tasks: [], config: {} }))
    return readBoard(1).then((board) => {
      expect(board.needsSetup).toBe(true)
      expect(board.tasks).toEqual([])
    })
  })
})

describe('the advertised ops', () => {
  it('decodes the list a reply reports', () => {
    vi.stubGlobal('fetch', reply({ ...BOARD, ops: ['update', 'updateMany'] }))
    return readBoard(1).then((board) => expect(board.ops).toEqual(['update', 'updateMany']))
  })

  it('reads an ABSENT list as null, not as an empty one', () => {
    // A deployment older than this bundle reports no `ops` at all, and `null` is what carries that
    // through to `supports` — which answers false either way, so the fold is never attempted.
    // Empty and absent must still be distinguishable here: collapsing them in the decoder is how a
    // reply's silence starts looking like a considered answer.
    vi.stubGlobal('fetch', reply(BOARD))
    return readBoard(1).then((board) => expect(board.ops).toBeNull())
  })

  it('sends a batch as updateMany, with every row in the payload', async () => {
    // `updateMany` rewrites each row from its payload, so `parent_id` has to ride along on every
    // one of them — omitted, it blanks the cell and promotes a subtask to a task.
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await updateTasks(
      [
        { id: 'a', title: 'Tick one', parentId: 'p' },
        { id: 'b', title: 'Tick two', parentId: 'p' },
      ],
      'thekey',
    )
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.op).toBe('updateMany')
    expect(body.payload.tasks.map((row) => row.id)).toEqual(['a', 'b'])
    expect(body.payload.tasks.every((row) => row.parent_id === 'p')).toBe(true)
  })

  it('refuses a batch with no key rather than sending a keyless write', async () => {
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await expect(updateTasks([{ id: 'a', title: 'x' }], null)).rejects.toMatchObject({
      code: API_ERROR.UNAUTHORIZED,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('classification', () => {
  it('treats a rejected key as terminal', async () => {
    vi.stubGlobal('fetch', reply({ ok: false, error: 'unauthorized' }))
    await expect(mutate('create', {}, 'k')).rejects.toMatchObject({
      code: API_ERROR.UNAUTHORIZED,
    })
    expect(isTerminal(API_ERROR.UNAUTHORIZED)).toBe(true)
  })

  it('treats Google’s HTML error page as TRANSIENT', async () => {
    // The reasoning that must not be inverted: a non-JSON reply is almost always quota
    // or a cold script, both of which recover. Classifying it as terminal would log
    // somebody out over a hiccup.
    vi.stubGlobal('fetch', reply('<!DOCTYPE html><title>Error</title>', { asText: true }))
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
    expect(isTerminal(API_ERROR.TRANSIENT)).toBe(false)
  })

  it('treats a rejected fetch as transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
  })

  it('maps every code the script can send', async () => {
    const cases = {
      not_empty: API_ERROR.NOT_EMPTY,
      misconfigured: API_ERROR.MISCONFIGURED,
      busy: API_ERROR.BUSY,
      not_found: API_ERROR.NOT_FOUND,
    }
    for (const [sent, expected] of Object.entries(cases)) {
      vi.stubGlobal('fetch', reply({ ok: false, error: sent }))
      await refuses(() => readBoard(1), expected)
    }
  })

  it('treats a code it has never heard of as transient', async () => {
    // A newer script is likelier than a permanent refusal, and retrying is recoverable
    // where locking somebody out is not.
    vi.stubGlobal('fetch', reply({ ok: false, error: 'something_new' }))
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
  })

  it('does not accept a reply that forgot to say ok', async () => {
    vi.stubGlobal('fetch', reply({ tasks: [] }))
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
  })

  it('does not accept a bare JSON null', async () => {
    // `JSON.parse('null')` succeeds, so the try/catch does not fire and the next
    // property access would throw a TypeError instead of a classified error.
    vi.stubGlobal('fetch', reply('null', { asText: true }))
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
  })

  it('marks the terminal codes and nothing else', () => {
    expect(isTerminal(API_ERROR.NOT_EMPTY)).toBe(true)
    expect(isTerminal(API_ERROR.MISCONFIGURED)).toBe(true)
    expect(isTerminal(API_ERROR.NOT_FOUND)).toBe(true)
    // Retrying is exactly the right response to a held lock.
    expect(isTerminal(API_ERROR.BUSY)).toBe(false)
  })

  it('names the ONLY two codes a retry may ever be spent on', () => {
    // The whole vocabulary partitioned, rather than a spot check: `send` retries precisely what is
    // not in `TERMINAL`, so a code landing on the wrong side of this line either hides a rotated
    // key behind three attempts or reports a cold script as a permanent refusal.
    const retryable = Object.values(API_ERROR).filter((code) => !isTerminal(code))
    expect(retryable.sort()).toEqual([API_ERROR.BUSY, API_ERROR.TRANSIENT].sort())
  })
})

/**
 * THE RETRY, which is what the taxonomy above is FOR.
 *
 * The defect it fixes was the app's most visible one: the first save after the board had been idle
 * came back as "Nothing was saved. Try again.", and tapping Save a second time worked. The endpoint's
 * first request after a cold start fails often enough that the person holding the phone was the
 * retry loop. These pin that the loop is in the code, that it stops where it must, and that it is
 * bounded — a retry that never gives up is a spinner that never ends.
 */
describe('retrying', () => {
  /** A fetch that fails `times` times and then answers. */
  function flaky(times, body) {
    let calls = 0
    return vi.fn(async () => {
      calls += 1
      return {
        ok: true,
        text: async () => JSON.stringify(calls <= times ? { ok: false, error: 'server' } : body),
      }
    })
  }

  async function settle(start) {
    vi.useFakeTimers()
    const running = start()
    await vi.runAllTimersAsync()
    return running
  }

  it('rides out a transient failure instead of reporting it', async () => {
    const fetcher = flaky(1, BOARD)
    vi.stubGlobal('fetch', fetcher)
    const board = await settle(() => mutate('update', { task: { id: 'a' } }, 'k'))
    expect(board.tasks).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries a read too, since a failed one leaves a stale board on screen', async () => {
    const fetcher = flaky(2, BOARD)
    vi.stubGlobal('fetch', fetcher)
    const board = await settle(() => readBoard(1))
    expect(board.tasks).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('gives up rather than hammering the endpoint forever', async () => {
    // Every read spends the owner's Apps Script quota, and a save that never resolves is worse than
    // one that says it failed.
    const fetcher = reply({ ok: false, error: 'server' })
    vi.stubGlobal('fetch', fetcher)
    await refuses(() => readBoard(1), API_ERROR.TRANSIENT)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never spends a second attempt on a terminal failure', async () => {
    // A rotated key does not become valid a second later, and three attempts only delay saying so.
    for (const error of ['unauthorized', 'not_found', 'misconfigured', 'not_empty']) {
      const fetcher = reply({ ok: false, error })
      vi.stubGlobal('fetch', fetcher)
      await refuses(() => mutate('update', {}, 'k'), API_ERROR[error.toUpperCase()])
      expect(fetcher, error).toHaveBeenCalledTimes(1)
    }
  })

  it('is only safe because every op is idempotent, `create` included', () => {
    /**
     * The one op a replay could corrupt, pinned where the retry is defined rather than only in the
     * script's own suite: a write abandoned at its deadline may be committing as it is abandoned —
     * that is why the deadline exceeds the lock wait — so a retried `create` can be a second copy
     * of a row that landed. `createTasks` resolves the client's id and rewrites that row, and
     * `test/script.test.js` posts the same create twice to prove it.
     */
    const script = readFileSync('apps-script/Code.gs', 'utf8')
    const create = /function createTasks\(session, tasks\) \{[\s\S]*?\n\}/.exec(script)[0]
    expect(create).toMatch(/rowOfId\(session\.block, tasks\[i\]\.id\)/)
  })
})

describe('mutate', () => {
  it('fails without a key rather than sending a keyless write', async () => {
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await expect(mutate('create', {}, null)).rejects.toMatchObject({
      code: API_ERROR.UNAUTHORIZED,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts the key in the BODY as text/plain', async () => {
    // text/plain keeps this a CORS simple request. An application/json content type
    // triggers a preflight, and the preflight is answered with the 302 that /exec
    // returns, which kills the request — so this is not a style choice.
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await mutate('create', { task: { id: 'a' } }, 'thekey')

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(SCRIPT_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/)
    expect(JSON.parse(init.body)).toEqual({
      key: 'thekey',
      op: 'create',
      payload: { task: { id: 'a' } },
    })
    // Never in the URL: a key in a query string is written to Google's request logs.
    expect(url).not.toContain('thekey')
  })

  it('follows the redirect rather than forcing the method through it', async () => {
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await mutate('create', {}, 'k')
    expect(fetcher.mock.calls[0][1].redirect).toBe('follow')
  })

  it('returns the fresh board, so a save costs one round trip', async () => {
    vi.stubGlobal('fetch', reply(BOARD))
    const board = await mutate('create', {}, 'k')
    expect(board.tasks).toHaveLength(1)
  })

  it('sends exactly ONE header, because a second one may force a preflight', async () => {
    // The preflight would be answered with the 302 that /exec returns and die, and the script has
    // no `doOptions` to answer it with. Only a safelisted Content-Type keeps this a simple request.
    const fetcher = reply(BOARD)
    vi.stubGlobal('fetch', fetcher)
    await mutate('create', {}, 'k')
    expect(Object.keys(fetcher.mock.calls[0][1].headers)).toEqual(['Content-Type'])
  })
})

/**
 * THE TWO DEADLINES, and why they are not one.
 *
 * A write is the only request that can be made to WAIT by another device: `Code.gs` holds a script
 * lock for up to `LOCK_WAIT_MS` before it does any work at all. A client deadline shorter than that
 * aborts a write the script then goes on to commit — the row rolls back on screen, a failure toast
 * goes up for an edit that landed, and the next read contradicts both. It also makes `busy`
 * unreachable, so the one code worth retrying can never arrive.
 *
 * The lock wait is read out of the script rather than typed here, because the two numbers are one
 * constraint: raising it there and not here reintroduces the whole failure.
 */
describe('deadlines', () => {
  const LOCK_WAIT_MS = Number(
    /var LOCK_WAIT_MS = (\d+)/.exec(readFileSync('apps-script/Code.gs', 'utf8'))?.[1],
  )

  it('reads the script’s own lock wait', () => {
    expect(LOCK_WAIT_MS).toBeGreaterThan(0)
  })

  it('gives a write longer than the script can spend waiting for its lock', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', reply(BOARD))
    await readBoard(1)
    await mutate('update', {}, 'k')
    const [[readMs], [writeMs]] = timeout.mock.calls
    expect(writeMs).toBeGreaterThan(LOCK_WAIT_MS)
    // And a read is not made to wait on anything — `doGet` never takes the lock — so it keeps the
    // shorter deadline: a hung read blocks nothing but a refresh.
    expect(readMs).toBeLessThan(writeMs)
    timeout.mockRestore()
  })
})
