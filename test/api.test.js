/**
 * The network boundary's failure taxonomy, and which backend a request goes to.
 *
 * THIS FILE EXISTS BECAUSE EVERY FAILURE MODE IN IT IS INVISIBLE. `doGet` always answers HTTP
 * 200, so a misclassified reply either logs a planner out for no reason or hides a rotated key
 * behind retries forever; and the dispatch rule decides whether an editor's board takes ~0.24s
 * or ~2s, which nothing on screen states either way.
 *
 * The `sheets` and `connection` modules are mocked throughout: what is under test is the routing
 * and the classification, not the Sheets API. `test/sheets.test.js` covers the requests
 * themselves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCRIPT_URL } from '../src/config.js'

const readEditKey = vi.fn(() => null)
const loadBoard = vi.fn()
const createTasks = vi.fn()
const updateTasks = vi.fn()
const setDeleted = vi.fn()
const setConfig = vi.fn()
const compactSheet = vi.fn()

vi.mock('../src/lib/access.js', () => ({ readEditKey: (...args) => readEditKey(...args) }))
vi.mock('../src/lib/connection.js', () => ({
  getSpreadsheetId: async () => 'SHEET',
  getAccessToken: async () => 'token',
  refreshToken: async () => 'token',
}))
vi.mock('../src/lib/sheets.js', () => ({
  loadBoard: (...args) => loadBoard(...args),
  createTasks: (...args) => createTasks(...args),
  updateTasks: (...args) => updateTasks(...args),
  setDeleted: (...args) => setDeleted(...args),
  setConfig: (...args) => setConfig(...args),
  compact: (...args) => compactSheet(...args),
}))

const api = await import('../src/lib/api.js')
const { API_ERROR, isTerminal, canWrite, readBoard } = api

/** A `doGet` reply. `asText` sends it unparsed, which is what Google's error page looks like. */
function replies(body, { asText } = {}) {
  const fetch = vi.fn(async () => ({
    ok: true,
    text: async () => (asText ? body : JSON.stringify(body)),
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/**
 * A rejection, once the retries behind it have run.
 *
 * Every non-terminal failure is retried with a backoff, so asserting on one means letting those
 * attempts happen — on fake timers, or the suite pays the real backoff for every case below.
 * `runAllTimersAsync` has to interleave with the awaits inside `send`, which is why the promise is
 * started first and settled last.
 */
async function refuses(start, code) {
  vi.useFakeTimers()
  const settled = expect(start()).rejects.toMatchObject({ code })
  await vi.runAllTimersAsync()
  await settled
}

const ROW = {
  id: 'a',
  title: 'Book the venue',
  category: 'Venue',
  due: '2027-02-01',
  done_at: '',
  created_at: '',
  updated_at: '',
  deleted_at: '',
  parent_id: '',
}

const BOARD = {
  tasks: [ROW],
  config: { wedding_date: '2027-04-18', categories: 'Venue, Attire' },
  sheetTimeZone: 'Asia/Tokyo',
}

beforeEach(() => {
  readEditKey.mockReturnValue(null)
  for (const fn of [loadBoard, createTasks, updateTasks, setDeleted, setConfig, compactSheet]) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
  loadBoard.mockResolvedValue({ ...BOARD, needsSetup: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('which backend a request goes to', () => {
  it('reads through doGet with NO credential when this device holds no key', async () => {
    // The whole feature: a planner opens the bare URL and the board renders. A minted token can
    // always write, so an anonymous reader must never be given one.
    const fetch = replies({ ok: true, ...BOARD })
    await readBoard(1234)

    expect(loadBoard).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${SCRIPT_URL}?t=1234`)
    expect(init.method).toBe('GET')
    // No Authorization header anywhere near the anonymous path.
    expect(init.headers).toBeUndefined()
  })

  it('reads through the Sheets API when it does, and never touches /exec', async () => {
    readEditKey.mockReturnValue('a'.repeat(64))
    const fetch = replies({ ok: true, ...BOARD })

    const board = await readBoard(1234)
    expect(loadBoard).toHaveBeenCalledWith('SHEET')
    expect(fetch).not.toHaveBeenCalled()
    expect(board.tasks[0].title).toBe('Book the venue')
  })

  it('busts the cache on the anonymous read, in the QUERY string', async () => {
    // `/exec` is served through Google's own cache, so a planner reloading right after an edit
    // must not be handed the previous board. A fragment would not reach the server at all —
    // which is exactly why the edit key lives in one.
    const fetch = replies({ ok: true, ...BOARD })
    await readBoard(999)
    expect(fetch.mock.calls[0][0]).toContain('t=999')
    expect(fetch.mock.calls[0][0]).not.toContain('#')
  })

  it('refuses every write without a key, before any request goes out', async () => {
    // `canWrite` only routes; the endpoint is what enforces this. But sending a write that cannot
    // possibly land spends a round trip to be told so.
    expect(canWrite()).toBe(false)
    await expect(api.updateTasks([{ id: 'a' }])).rejects.toMatchObject({
      code: API_ERROR.UNAUTHORIZED,
    })
    expect(updateTasks).not.toHaveBeenCalled()
  })

  it('routes each write to its own sheets call, with the resolved spreadsheet id', async () => {
    readEditKey.mockReturnValue('a'.repeat(64))
    const task = { id: 'a', title: 'x' }

    await api.createTasks([task])
    expect(createTasks).toHaveBeenCalledWith('SHEET', [task])

    await api.updateTasks([task])
    expect(updateTasks).toHaveBeenCalledWith('SHEET', [task])

    await api.writeConfig({ venue: 'X' })
    expect(setConfig).toHaveBeenCalledWith('SHEET', { venue: 'X' })

    await api.compact()
    expect(compactSheet).toHaveBeenCalledWith('SHEET')
  })

  it('stamps a delete and clears it on a restore, through the one sheets call', async () => {
    // Two names for one operation, which is why a restore is free: the row never moved.
    readEditKey.mockReturnValue('a'.repeat(64))
    await api.deleteTask('a')
    expect(setDeleted.mock.calls[0][1]).toBe('a')
    expect(setDeleted.mock.calls[0][2]).toMatch(/^\d{4}-\d\d-\d\dT/)

    await api.restoreTask('a')
    expect(setDeleted.mock.calls[1][2]).toBe('')
  })
})

describe('decoding a board', () => {
  it('drops a row with no id rather than rendering a blank task', async () => {
    // A stray Enter in the Sheets UI is a row, not a task.
    loadBoard.mockResolvedValue({ ...BOARD, tasks: [ROW, { ...ROW, id: '' }] })
    readEditKey.mockReturnValue('a'.repeat(64))
    expect((await readBoard()).tasks).toHaveLength(1)
  })

  it('parses the config into the app’s shape and keeps it PARTIAL', async () => {
    // The snapshot stores the pre-merge config: a merged copy would freeze the building build's
    // defaults into every later launch.
    readEditKey.mockReturnValue('a'.repeat(64))
    const board = await readBoard()
    expect(board.config).toEqual({ weddingDate: '2027-04-18', categories: ['Venue', 'Attire'] })
    expect(board.sheetTimeZone).toBe('Asia/Tokyo')
  })

  it('reads needsSetup as an empty board rather than a failure', async () => {
    loadBoard.mockResolvedValue({ tasks: [], config: {}, needsSetup: true, sheetTimeZone: '' })
    readEditKey.mockReturnValue('a'.repeat(64))
    const board = await readBoard()
    expect(board.needsSetup).toBe(true)
    expect(board.tasks).toEqual([])
  })
})

describe('classification', () => {
  it('branches on the BODY of a doGet reply, never on the HTTP status', async () => {
    // `ContentService` cannot set a status, so `{"ok":false}` arrives as a 200. Reading
    // `response.ok` here would report a broken script as a good board.
    replies({ ok: false, error: 'misconfigured' })
    await refuses(() => readBoard(), API_ERROR.MISCONFIGURED)
  })

  it('reads a non-JSON reply as transient, because that is Google’s error page', async () => {
    // A cold container or a spent quota, and both recover. Calling it terminal would strand a
    // planner on an error screen until they reloaded.
    replies('<!DOCTYPE html><title>Error</title>', { asText: true })
    await refuses(() => readBoard(), API_ERROR.TRANSIENT)
  })

  it('maps a refused key to unauthorized, from either backend', async () => {
    // The mint throws with `badKey`; `doGet` has no key to refuse, so this is the editor path.
    readEditKey.mockReturnValue('a'.repeat(64))
    loadBoard.mockRejectedValue(Object.assign(new Error('no'), { badKey: true }))
    await expect(readBoard()).rejects.toMatchObject({ code: API_ERROR.UNAUTHORIZED })
  })

  it('maps the sheets module’s own codes', async () => {
    readEditKey.mockReturnValue('a'.repeat(64))
    for (const [code, expected] of [
      ['not_found', API_ERROR.NOT_FOUND],
      ['not_empty', API_ERROR.NOT_EMPTY],
      ['misconfigured', API_ERROR.MISCONFIGURED],
    ]) {
      updateTasks.mockRejectedValue(Object.assign(new Error(code), { code }))
      await expect(api.updateTasks([{ id: 'a' }])).rejects.toMatchObject({ code: expected })
    }
  })

  it('treats a 5xx and a 429 as transient and a plain 4xx as terminal', async () => {
    readEditKey.mockReturnValue('a'.repeat(64))
    for (const status of [429, 500, 503]) {
      updateTasks.mockRejectedValue(Object.assign(new Error('x'), { status }))
      await refuses(() => api.updateTasks([{ id: 'a' }]), API_ERROR.TRANSIENT)
      // Retried, which is the point of calling it transient.
      expect(updateTasks.mock.calls.length).toBeGreaterThan(1)
      updateTasks.mockClear()
    }

    // A 400 is a range this bundle built wrongly and a 403 is a scope too narrow for the REST
    // API. Both are setup, both are equally true a second later, so neither is retried.
    for (const status of [400, 403, 404]) {
      updateTasks.mockRejectedValue(Object.assign(new Error('x'), { status }))
      await expect(api.updateTasks([{ id: 'a' }])).rejects.toMatchObject({
        code: API_ERROR.MISCONFIGURED,
      })
      expect(updateTasks).toHaveBeenCalledTimes(1)
      updateTasks.mockClear()
    }
  })

  it('names the terminal set, and BUSY is not in it because it no longer exists', async () => {
    // `busy` went with the script lock. It was also never reachable: the script waited 25s on that
    // lock and the client abandoned retrying at 20s, so a contended write got exactly one attempt.
    expect(API_ERROR.BUSY).toBeUndefined()
    expect(Object.values(API_ERROR).filter((code) => !isTerminal(code))).toEqual([
      API_ERROR.TRANSIENT,
    ])
    for (const code of ['unconfigured', 'unauthorized', 'not_empty', 'misconfigured', 'not_found']) {
      expect(isTerminal(code), code).toBe(true)
    }
  })
})

describe('retrying', () => {
  it('rides out a transient failure instead of reporting it', async () => {
    // The one thing above the boundary must never see: a blip reported as "Nothing was saved".
    readEditKey.mockReturnValue('a'.repeat(64))
    let attempts = 0
    updateTasks.mockImplementation(async () => {
      attempts += 1
      if (attempts < 3) throw Object.assign(new Error('blip'), { status: 503 })
    })

    vi.useFakeTimers()
    const settled = api.updateTasks([{ id: 'a' }])
    await vi.runAllTimersAsync()
    expect(await settled).toBe(true)
    expect(attempts).toBe(3)
  })

  it('never spends a second attempt on a terminal failure', async () => {
    // A rotated key and a row somebody deleted do not become true a second later, and retrying
    // one hides it behind a longer wait.
    readEditKey.mockReturnValue('a'.repeat(64))
    updateTasks.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not_found' }))
    await expect(api.updateTasks([{ id: 'a' }])).rejects.toMatchObject({
      code: API_ERROR.NOT_FOUND,
    })
    expect(updateTasks).toHaveBeenCalledTimes(1)
  })

  it('spends no retry on a payload this bundle built wrongly', async () => {
    // `sheets.js` throws `bad_payload` from four guards — an empty task list, a missing id — and a
    // guard is as false a second later. Left out of the switch it fell through to TRANSIENT, so a
    // deterministic refusal cost three attempts and two seconds of backoff before it was reported.
    readEditKey.mockReturnValue('a'.repeat(64))
    updateTasks.mockRejectedValue(
      Object.assign(new Error('updateTasks: nothing to update'), { code: 'bad_payload' }),
    )
    await expect(api.updateTasks([])).rejects.toMatchObject({ code: API_ERROR.MISCONFIGURED })
    expect(updateTasks).toHaveBeenCalledTimes(1)
    // And it arrives above the boundary in this module's vocabulary, so the UI has a notice for it.
    expect(isTerminal(API_ERROR.MISCONFIGURED)).toBe(true)
  })

  it('gives up after a bounded number of attempts rather than never resolving', async () => {
    // A save that never resolves is worse than one that admits it failed.
    readEditKey.mockReturnValue('a'.repeat(64))
    updateTasks.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }))
    await refuses(() => api.updateTasks([{ id: 'a' }]), API_ERROR.TRANSIENT)
    expect(updateTasks.mock.calls.length).toBeLessThanOrEqual(4)
  })
})
