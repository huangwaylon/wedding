/**
 * `src/lib/connection.js` — the mint, and the token cache behind it.
 *
 * THIS FILE EXISTS BECAUSE EVERY FAILURE HERE IS INVISIBLE AND EXPENSIVE. `/exec` always answers
 * HTTP 200, so the body is the only signal: a rotated key reported as a network blip hides behind
 * retries forever, and a network blip reported as a rotated key sends somebody hunting for their
 * edit link. And a cache that mints too eagerly puts a 1.5s Apps Script round trip in front of
 * every write, which is the entire cost this module was written to avoid.
 *
 * `localStorage` is stubbed rather than mocked away: the token is persisted so a relaunch does not
 * mint before painting, and "is a stale entry trusted" is exactly the question worth asking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'a'.repeat(64)
let editKey = KEY

vi.mock('../src/lib/access.js', () => ({ readEditKey: () => editKey }))

/** A `localStorage` that behaves, so `readStored`/`writeStored` have something to talk to. */
function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed))
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  })
  return store
}

/** Whatever `start()` threw. `rejects.toMatchObject` cannot express "this flag is absent". */
async function thrownBy(start) {
  try {
    await start()
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

/** A mint reply. `asText` sends it unparsed, which is what Google's error page looks like. */
function replies(...bodies) {
  const fetch = vi.fn(async () => {
    const next = bodies.length > 1 ? bodies.shift() : bodies[0]
    if (next instanceof Error) throw next
    return {
      ok: true,
      status: 200,
      text: async () => (typeof next === 'string' ? next : JSON.stringify(next)),
    }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const GOOD = { ok: true, token: 'TOKEN', spreadsheetId: 'SHEET_ID' }

/**
 * A fresh module instance per test. The cache is module state — deliberately, so concurrent callers
 * share one mint — so it has to be rebuilt rather than reset.
 */
async function load(seed) {
  installStorage(seed)
  vi.resetModules()
  return import('../src/lib/connection.js')
}

beforeEach(() => {
  editKey = KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('minting', () => {
  it('posts the key as text/plain and follows the redirect as a GET', async () => {
    // `text/plain` keeps it a CORS *simple request*. A preflight would be answered with the 302
    // that `/exec` returns and die, which is also why the script has no doOptions. And the method
    // is never forced across that hop: `fetch` downgrades POST to GET and Apps Script serves the
    // already-computed reply, while forcing POST through returns "page not found".
    const fetch = replies(GOOD)
    const connection = await load()
    expect(await connection.getAccessToken()).toBe('TOKEN')

    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    expect(init.redirect).toBe('follow')
    expect(JSON.parse(init.body)).toEqual({ key: KEY })
  })

  it('sends the key in the BODY, never in the query string', async () => {
    // A key in a query string is written into Google's request logs.
    const fetch = replies(GOOD)
    const connection = await load()
    await connection.getAccessToken()
    expect(fetch.mock.calls[0][0]).not.toContain(KEY)
  })

  it('reports the spreadsheet id the script named', async () => {
    const connection = await load()
    replies(GOOD)
    expect(await connection.getSpreadsheetId()).toBe('SHEET_ID')
  })

  it('does not mint at module load, so a test environment needs no network', async () => {
    const fetch = replies(GOOD)
    await load()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('classifying a reply', () => {
  it('treats `unauthorized` as TERMINAL — a refused key', async () => {
    // Retrying cannot help, and hiding it behind retries means somebody's edits stop saving with
    // nothing on screen saying why.
    replies({ ok: false, error: 'unauthorized' })
    const connection = await load()
    await expect(connection.getAccessToken()).rejects.toMatchObject({ badKey: true })
  })

  it('treats a non-JSON reply as transient, because that is Google’s error page', async () => {
    // Served when the quota is spent, during an outage, and for any uncaught throw inside doPost.
    // Calling it a bad key would send somebody to retype 64 characters for a blip.
    replies('<!DOCTYPE html><title>Error</title>')
    const connection = await load()
    const error = await thrownBy(() => connection.getAccessToken())
    expect(error.badKey).toBeFalsy()
    expect(error.misconfigured).toBeFalsy()
  })

  it('never branches on the HTTP status, which is always 200', async () => {
    // `ContentService` cannot set one, so reading `response.ok` would report a rotated key as
    // success. A rejection arrives as a 200 with `{"ok":false}` in the body.
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: false, error: 'unauthorized' }),
    }))
    vi.stubGlobal('fetch', fetch)
    const connection = await load()
    await expect(connection.getAccessToken()).rejects.toMatchObject({ badKey: true })
  })

  it('reports a reply with no token as transient rather than as success', async () => {
    replies({ ok: true, spreadsheetId: 'SHEET_ID' })
    const connection = await load()
    const error = await thrownBy(() => connection.getAccessToken())
    expect(error.badKey).toBeFalsy()
  })

  it('refuses a reply with no sheet id, which would request /spreadsheets/null', async () => {
    replies({ ok: true, token: 'TOKEN' })
    const connection = await load()
    await expect(connection.getAccessToken()).rejects.toMatchObject({ misconfigured: true })
  })

  it('reports `misconfigured` when the script is bound to nothing', async () => {
    replies({ ok: false, error: 'misconfigured' })
    const connection = await load()
    await expect(connection.getAccessToken()).rejects.toMatchObject({ misconfigured: true })
  })

  it('never mints for a device with no key, and does not spend a round trip finding out', async () => {
    // A planner reads through `doGet`. There is nothing to mint with and nothing to ask.
    editKey = null
    const fetch = replies(GOOD)
    const connection = await load()
    await expect(connection.getAccessToken()).rejects.toMatchObject({ badKey: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the cache', () => {
  it('mints ONCE and reuses the token', async () => {
    // The whole point of the module: `/exec` costs ~1.5s and the Sheets API costs ~0.24s, so the
    // endpoint is worth touching once an hour rather than once a write.
    const fetch = replies(GOOD)
    const connection = await load()
    await connection.getAccessToken()
    await connection.getAccessToken()
    await connection.getAccessToken()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shares ONE mint between concurrent callers', async () => {
    // A burst of writes on a cold launch would otherwise each start their own round trip.
    const fetch = replies(GOOD)
    const connection = await load()
    const all = await Promise.all([
      connection.getAccessToken(),
      connection.getAccessToken(),
      connection.getAccessToken(),
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(all).toEqual(['TOKEN', 'TOKEN', 'TOKEN'])
  })

  it('persists the token, so a relaunch paints without minting first', async () => {
    const store = installStorage()
    vi.resetModules()
    replies(GOOD)
    const first = await import('../src/lib/connection.js')
    await first.getAccessToken()
    expect(JSON.parse(store.get('wd.token')).accessToken).toBe('TOKEN')

    // A second launch with the same storage: no mint at all.
    vi.resetModules()
    const fetch = replies(GOOD)
    const second = await import('../src/lib/connection.js')
    expect(await second.getAccessToken()).toBe('TOKEN')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('DROPS a stored token already inside the refresh margin', async () => {
    // Trusting one would send a request that arrives at Google after it has expired, and the 401
    // retry would then be doing work the margin exists to avoid.
    const nearlyDead = JSON.stringify({ accessToken: 'OLD', expiresAt: Date.now() + 60_000 })
    const fetch = replies(GOOD)
    const connection = await load({ 'wd.token': nearlyDead })
    expect(await connection.getAccessToken()).toBe('TOKEN')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('DROPS a malformed stored entry rather than trusting it', async () => {
    // A corrupt entry must not wedge the app into believing it holds a usable token.
    for (const raw of ['not json', '{}', JSON.stringify({ accessToken: 5, expiresAt: 'soon' })]) {
      const fetch = replies(GOOD)
      const connection = await load({ 'wd.token': raw })
      expect(await connection.getAccessToken(), raw).toBe('TOKEN')
      expect(fetch, raw).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    }
  })

  it('survives storage that throws, because Safari private mode rejects writes', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    vi.resetModules()
    replies(GOOD)
    const connection = await import('../src/lib/connection.js')
    expect(await connection.getAccessToken()).toBe('TOKEN')
  })
})

describe('refreshing', () => {
  it('discards the current token and mints a new one', async () => {
    const fetch = replies({ ...GOOD }, { ...GOOD, token: 'TOKEN-2' })
    const connection = await load()
    expect(await connection.getAccessToken()).toBe('TOKEN')
    expect(await connection.refreshToken()).toBe('TOKEN-2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('guarantees a token NEWER than a mint that was already in flight', async () => {
    /**
     * THE GENERATION COUNTER, AND WHY IT IS NOT A TIDY-UP. On a 401 the in-flight mint may well be
     * carrying the very token Google just rejected. Handing it to the retry — which runs with
     * `allowRetry: false` — turns a recoverable blip into a hard failure.
     */
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) await gate
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ...GOOD, token: `TOKEN-${call}` }),
        }
      }),
    )
    const connection = await load()

    const stale = connection.getAccessToken()
    const fresh = connection.refreshToken()
    release()

    expect(await stale).toBe('TOKEN-1')
    // The refresh must NOT be satisfied by the mint that started before it.
    expect(await fresh).toBe('TOKEN-2')
  })

  it('does not cache a token that was superseded while in flight', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) await gate
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ...GOOD, token: `TOKEN-${call}` }),
        }
      }),
    )
    const connection = await load()
    const stale = connection.getAccessToken()
    const fresh = connection.refreshToken()
    release()
    await Promise.all([stale, fresh])

    // The next caller gets the survivor, not the one that resolved first.
    expect(await connection.getAccessToken()).toBe('TOKEN-2')
  })
})

describe('forgetting', () => {
  it('drops the token and the sheet id, because both outlive a revoked key', async () => {
    // The token is derived from the key but lives up to an hour longer, so a device that has just
    // been demoted to view-only would otherwise keep writing.
    const store = installStorage()
    vi.resetModules()
    replies(GOOD)
    const connection = await import('../src/lib/connection.js')
    await connection.getAccessToken()
    expect(store.get('wd.token')).toBeTruthy()

    connection.forgetToken()
    expect(store.get('wd.token')).toBeUndefined()
    expect(store.get('wd.sheetId')).toBeUndefined()
  })

  it('mints again on the next request rather than staying dead', async () => {
    const fetch = replies(GOOD)
    const connection = await load()
    await connection.getAccessToken()
    connection.forgetToken()
    await connection.getAccessToken()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
