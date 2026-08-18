/**
 * The network boundary, and the failure taxonomy everything above it branches on.
 *
 * Two backends, one interface, chosen only by whether this device holds an edit key:
 *
 *   no key    reads through `doGet` on the Apps Script web app, with no credential at all.
 *   a key     mints a token once an hour, then reads and writes straight to `sheets.googleapis.com`.
 *
 * `/exec` costs 1.0–1.6s before any of our code runs and the Sheets API ~0.24s, so an editor
 * touches `/exec` only to mint. The reads cannot share one path: `ScriptApp.getOAuthToken()`
 * returns the script's own authorization, which can write, so a token handed to an anonymous reader
 * would hand them editing.
 *
 * The `doGet` reply is always HTTP 200 — `ContentService` cannot set a status — so the body is the
 * only signal. Branch on the body, never on `response.ok`. The Sheets API states its failures
 * properly, which is why the retry rule below is a status-code rule.
 *
 * Retrying is safe because every op is idempotent, not because a failure proves nothing was
 * written: a write abandoned mid-flight may be committing as it is abandoned. `updateTasks`,
 * `setDeleted` and `setConfig` rewrite by id, and `createTasks` upserts on the client's id.
 */

import { SCRIPT_URL, parseConfig } from '../config.js'
import { rowToTask } from '../schema.js'
import { readEditKey } from './access.js'
import { getSpreadsheetId } from './connection.js'
import * as sheets from './sheets.js'

/**
 * A hang-stop on the anonymous read: `fetch` has no limit of its own and `useBoard` holds `reading`
 * for the life of a read, so one socket that never closes blocks every later refresh. An abort has
 * no `.status`, so it classifies TRANSIENT and is retried — sound because every op is idempotent.
 */
const READ_TIMEOUT_MS = 20_000

/** Between attempts. Short: the condition being waited out is a blip, not congestion. */
const BACKOFF_MS = [500, 1_500]

/**
 * Attempts per request, including the first — so three, and DERIVED, because `send` indexes
 * `BACKOFF_MS[attempt - 1]`: a hand-raised 4 waits `undefined` ms and retries instantly. What is
 * retried is a blip — a dropped connection, a 500, a rate limit — and two in a row is an outage.
 */
const ATTEMPTS = BACKOFF_MS.length + 1

/**
 * Status codes worth a second go. Every other 4xx is a statement about the request that will be
 * equally true a second later. A 401 never arrives here: `sheets.js` re-mints and retries it first.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/** Thrown by everything here. The class never leaves this module; `useBoard` reads `error.code`. */
class ApiError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export const API_ERROR = {
  /** No `VITE_SCRIPT_URL` in the build. Nothing works; the UI says so. */
  UNCONFIGURED: 'unconfigured',
  /** The edit key was refused. Terminal: retrying cannot help. */
  UNAUTHORIZED: 'unauthorized',
  /** The spreadsheet already holds somebody else's work, so nothing was built. */
  NOT_EMPTY: 'not_empty',
  /** The script is not bound to a spreadsheet, or minted no usable id. */
  MISCONFIGURED: 'misconfigured',
  /** The row vanished — deleted in the Sheets UI mid-edit. */
  NOT_FOUND: 'not_found',
  /** Anything else. Assumed transient, and retried before it is ever reported. */
  TRANSIENT: 'transient',
}

/** Terminal codes. Anything not in here is retried by `send` before it reaches the UI. */
const TERMINAL = new Set([
  API_ERROR.UNCONFIGURED,
  API_ERROR.UNAUTHORIZED,
  API_ERROR.NOT_EMPTY,
  API_ERROR.MISCONFIGURED,
  API_ERROR.NOT_FOUND,
])

export function isTerminal(code) {
  return TERMINAL.has(code)
}

/** Whether this device can write at all. The endpoint enforces it; this only routes. */
export function canWrite() {
  return Boolean(readEditKey())
}

/**
 * Anything thrown below the boundary -> our vocabulary. `sheets.js` throws `.code` for an app-level
 * refusal and `.status` for an HTTP one; `connection.js` throws `.badKey` / `.misconfigured`. An
 * unrecognised failure is transient, on the same reasoning a 500 is.
 */
function classify(error) {
  if (error instanceof ApiError) return error
  if (error?.badKey) return new ApiError(API_ERROR.UNAUTHORIZED, error)
  if (error?.misconfigured) return new ApiError(API_ERROR.MISCONFIGURED, error)

  switch (error?.code) {
    case 'not_found':
      return new ApiError(API_ERROR.NOT_FOUND, error)
    case 'not_empty':
      return new ApiError(API_ERROR.NOT_EMPTY, error)
    // A payload this bundle built wrongly — an empty task list, a missing id. Terminal: it is as
    // false a second later, so it must not spend two retries and two seconds of backoff before
    // saying so.
    case 'bad_payload':
    case 'misconfigured':
      return new ApiError(API_ERROR.MISCONFIGURED, error)
  }

  const status = error?.status
  /**
   * A 4xx the retry list does not name is terminal: 403 a scope too narrow, 404 the wrong
   * spreadsheet id, 400 a range this bundle built wrongly. `sheets.js` absorbs the 400 meaning
   * "tabs not built yet"; a 404 reaches here, no such spreadsheet being a different fact from an
   * unbuilt one.
   */
  if (typeof status === 'number' && status >= 400 && !RETRYABLE_STATUS.has(status)) {
    return new ApiError(API_ERROR.MISCONFIGURED, error)
  }
  return new ApiError(API_ERROR.TRANSIENT, error)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a non-terminal failure a few times, so a blip never reaches somebody as "Nothing was
 * saved".
 */
async function send(work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (raw) {
      const error = classify(raw)
      if (isTerminal(error.code) || attempt >= ATTEMPTS) throw error
      await wait(BACKOFF_MS[attempt - 1])
    }
  }
}

/** The shape `useBoard` consumes, from either backend. */
function decodeBoard({ tasks, config, needsSetup, sheetTimeZone }) {
  return {
    tasks: Array.isArray(tasks) ? tasks.map(rowToTask).filter((task) => task.id) : [],
    /** The partial config, pre-merge — see `mergeConfig` and the snapshot. */
    config: parseConfig(config),
    needsSetup: Boolean(needsSetup),
    sheetTimeZone: typeof sheetTimeZone === 'string' ? sheetTimeZone : '',
  }
}

/**
 * The anonymous read, for a device with no key.
 *
 * `t` is a cache-buster, not data the script reads: `/exec` is served through Google's own cache,
 * and a planner reloading after an edit must not get the previous board. It goes in the query
 * string because a fragment would not reach the server — which is why the edit key lives in one.
 */
async function readPublicBoard(now) {
  const separator = SCRIPT_URL.includes('?') ? '&' : '?'

  let response
  try {
    response = await fetch(`${SCRIPT_URL}${separator}t=${now}`, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new ApiError(API_ERROR.TRANSIENT, cause)
  }

  const text = await response.text().catch(() => '')
  let body
  try {
    body = JSON.parse(text)
  } catch (cause) {
    // Google's HTML error page. Transient by default — a cold container or a spent quota.
    throw new ApiError(API_ERROR.TRANSIENT, cause)
  }
  if (!body || typeof body !== 'object') throw new ApiError(API_ERROR.TRANSIENT)
  if (body.ok !== true) {
    throw new ApiError(body.error === 'misconfigured' ? API_ERROR.MISCONFIGURED : API_ERROR.TRANSIENT)
  }
  return body
}

/**
 * The board. REST for an editor, `doGet` for everybody else.
 *
 * @param {number} [now] injectable so a test can pin the cache-buster
 */
export function readBoard(now = Date.now()) {
  if (!SCRIPT_URL) return Promise.reject(new ApiError(API_ERROR.UNCONFIGURED))
  return send(async () =>
    decodeBoard(
      canWrite() ? await sheets.loadBoard(await getSpreadsheetId()) : await readPublicBoard(now),
    ),
  )
}

/**
 * Every write goes through here, which keeps "an editor must hold a key" in one place.
 *
 * It resolves nothing back: a Sheets write answers with the ranges it touched and nothing about the
 * rest of the board, so `useBoard` keeps its optimistic state and settles the rows it wrote. One
 * round trip instead of two, and the throttled focus refresh picks up the other editor's changes.
 */
function write(work) {
  if (!canWrite()) return Promise.reject(new ApiError(API_ERROR.UNAUTHORIZED))
  return send(async () => {
    await work(await getSpreadsheetId())
    return true
  })
}

export function createTasks(tasks) {
  return write((id) => sheets.createTasks(id, tasks))
}

/**
 * Several rows in one request, so a burst of ticks costs one round trip. Atomic on resolution: a
 * batch naming a row somebody has since deleted by hand writes none of them, so the client may roll
 * the whole batch back.
 */
export function updateTasks(tasks) {
  return write((id) => sheets.updateTasks(id, tasks))
}

export function deleteTask(taskId) {
  return write((id) => sheets.setDeleted(id, taskId, new Date().toISOString()))
}

export function restoreTask(taskId) {
  return write((id) => sheets.setDeleted(id, taskId, ''))
}

export function writeConfig(raw) {
  return write((id) => sheets.setConfig(id, raw))
}

export function compact() {
  return write((id) => sheets.compact(id))
}
