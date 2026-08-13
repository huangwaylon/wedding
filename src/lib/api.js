/**
 * The network boundary, and the failure taxonomy everything above it branches on.
 *
 * TWO BACKENDS, ONE INTERFACE, AND WHICH ONE IS USED DEPENDS ONLY ON WHETHER THIS DEVICE
 * HOLDS AN EDIT KEY:
 *
 *   no key    reads through `doGet` on the Apps Script web app. No credential at all —
 *             that is the feature, and it is why a planner needs nothing to open the board.
 *   a key     mints a token once an hour and does every read AND write straight to
 *             `sheets.googleapis.com`, one hop instead of two.
 *
 * An editor therefore never touches `/exec` except to mint. That is the whole speed story:
 * `/exec` costs 1.0–1.6s before any of our code runs, and the Sheets API costs ~0.24s.
 *
 * WHY THE READS SPLIT AT ALL, rather than everyone using one path. A minted token cannot be
 * read-only — `ScriptApp.getOAuthToken()` returns the script's own authorization, which can
 * write — so handing one to an anonymous reader would hand them editing. The anonymous read
 * has to stay behind the script.
 *
 * THE `doGet` REPLY IS ALWAYS HTTP 200 and the body is the only signal, because
 * `ContentService` cannot set a status. Branch on the body, never on `response.ok`. The
 * Sheets API is the opposite and states its failures properly, which is why the retry rule
 * below is a status-code rule rather than the "is this reply even JSON" guesswork the whole
 * of this file used to be.
 *
 * A RETRY IS SAFE BECAUSE EVERY OP IS IDEMPOTENT, not because a failure proves nothing was
 * written. A write abandoned mid-flight may well be committing as it is abandoned, so a
 * replay has to be harmless even then: `updateTasks`, `setDeleted` and `setConfig` rewrite by
 * id and always did, and `createTasks` resolves the client's id and rewrites that row rather
 * than appending a twin.
 */

import { SCRIPT_URL, parseConfig } from '../config.js'
import { rowToTask } from '../schema.js'
import { readEditKey } from './access.js'
import { getSpreadsheetId } from './connection.js'
import * as sheets from './sheets.js'

/** Beyond this something is wrong with the network, not with the request. */
const READ_TIMEOUT_MS = 20_000

/**
 * ATTEMPTS PER REQUEST, INCLUDING THE FIRST.
 *
 * Far less load-bearing than it was. It existed because Apps Script answered a cold
 * container with an HTML error page often enough that the retry loop was a human tapping
 * Save twice; the Sheets API does not do that. What is left is a genuine blip — a dropped
 * connection, a 500, a rate limit — and two of those in a row is a real outage rather than
 * something worth waiting through.
 */
const ATTEMPTS = 3

/** Between attempts. Short: the condition being waited out is a blip, not congestion. */
const BACKOFF_MS = [500, 1_500]

/**
 * Status codes worth a second go. Everything else 4xx is a statement about the request that
 * will be equally true a second later — and 401 never arrives here, because `sheets.js`
 * re-mints and retries it before it can.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * Thrown by everything here. `code` is what the UI branches on, and the class never leaves
 * this module: `useBoard` reads `error.code`.
 */
class ApiError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export const API_ERROR = {
  /** No `VITE_SCRIPT_URL` in the build. Nothing works; the UI says so plainly. */
  UNCONFIGURED: 'unconfigured',
  /** The edit key was refused. Terminal: retrying cannot help. */
  UNAUTHORIZED: 'unauthorized',
  /** The spreadsheet already holds somebody else's work, so nothing was built. */
  NOT_EMPTY: 'not_empty',
  /** The script is not bound to a spreadsheet, or minted no usable id. */
  MISCONFIGURED: 'misconfigured',
  /** The row vanished — someone deleted it in the Sheets UI mid-edit. */
  NOT_FOUND: 'not_found',
  /** Anything else. Assumed transient, and retried before it is ever reported. */
  TRANSIENT: 'transient',
}

/**
 * Terminal codes. Anything not in here is retried by `send` before it reaches the UI.
 *
 * `busy` used to live outside this set and was the one code the taxonomy called worth
 * retrying. It is gone with the script lock that produced it — and it was never reachable
 * anyway: the script waited 25s on that lock and the client abandoned retrying at 20s, so a
 * contended write got exactly one attempt and rolled its row back on screen.
 */
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
 * Anything thrown below the boundary -> our vocabulary.
 *
 * `sheets.js` throws with `.code` for an app-level refusal and `.status` for an HTTP one;
 * `connection.js` throws with `.badKey` / `.misconfigured`. An unrecognised failure is
 * transient, on the same reasoning a 500 is: a code this build has never heard of is more
 * likely a blip than a permanent refusal.
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
    case 'misconfigured':
      return new ApiError(API_ERROR.MISCONFIGURED, error)
    default:
      break
  }

  const status = error?.status
  /**
   * A 4xx the retry list does not name is a statement about the request or the deployment that
   * will be equally true a second later, so it is TERMINAL — retrying one only makes somebody
   * wait longer to be told. All three realistic cases are setup rather than bad luck: 403 is a
   * scope too narrow for the REST API, 404 is the wrong spreadsheet id, and 400 is a range this
   * bundle built wrongly. `sheets.js` has already absorbed the 400/404 that merely means "the
   * tabs do not exist yet", so those never arrive here.
   *
   * A 401 never arrives here either: `sheets.js` re-mints and retries it before it can.
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
 * Run something across the boundary, retrying a non-terminal failure a few times.
 *
 * Everything above this sees a failure only once retrying it has been tried and has not
 * helped, which is what keeps a blip from reaching somebody as "Nothing was saved".
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
    /** The PARTIAL config, pre-merge — see `mergeConfig` and the snapshot. */
    config: parseConfig(config),
    needsSetup: Boolean(needsSetup),
    sheetTimeZone: typeof sheetTimeZone === 'string' ? sheetTimeZone : '',
  }
}

/**
 * The anonymous read, for a device with no key.
 *
 * `t` is a cache-buster, not data the script reads: `/exec` is served through Google's own
 * cache and a planner reloading right after an edit must not be handed the previous board. It
 * goes in the query string because a fragment would not reach the server at all — which is
 * exactly why the edit key lives in one.
 */
async function readPublicBoard(now) {
  if (!SCRIPT_URL) throw new ApiError(API_ERROR.UNCONFIGURED)
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
 * Every write goes through here, which is what keeps "an editor must hold a key" in one place
 * rather than repeated per op.
 *
 * It resolves nothing back: a Sheets write answers with the ranges it touched and nothing
 * about the rest of the board, so `useBoard` keeps its optimistic state and settles the rows
 * it wrote. That is one round trip instead of the two a re-read would cost, and the throttled
 * focus refresh is what picks up the other editor's changes.
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
 * Several rows in ONE request, which is what makes a burst of ticks cost one round trip.
 *
 * ATOMIC ON RESOLUTION: every id is resolved before anything is written, so a batch naming a
 * row somebody has since deleted by hand fails whole and writes none of them. That is why the
 * client may roll the whole batch back — a partial success would leave nothing able to say
 * which half landed.
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
