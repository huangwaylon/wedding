/**
 * The only module that talks to the network, and the failure taxonomy it needs.
 *
 * One endpoint, two shapes:
 *
 *   readBoard()          GET, no credential. What a planner's browser does.
 *   mutate(op, …, key)   POST, edit key in the body. What an editor's does.
 *
 * THE ENDPOINT ALWAYS ANSWERS HTTP 200. `ContentService` cannot set a status, so
 * `{"ok":false,"error":"unauthorized"}` arrives as a 200 and the BODY is the only
 * signal. Branch on the body, never on `response.ok`.
 *
 * A rotated key and a network blip are different failures and must not be
 * confused. Reporting a blip as a bad key sends somebody hunting for their edit
 * link; reporting a bad key as transient hides it behind retries forever. So:
 * `unauthorized` is TERMINAL, and everything else — a non-JSON reply, a rejection,
 * a timeout — is TRANSIENT. Google's HTML error page is the common non-JSON case
 * and it is genuinely transient (quota, a cold script), which is why the default
 * has to fall that way.
 *
 * The POST is `Content-Type: text/plain` and its method is never forced through
 * the redirect. `text/plain` keeps it a CORS *simple* request; a preflight would
 * be answered with the 302 that `/exec` returns and die — which is also why the
 * script has no `doOptions`. `fetch` downgrades POST to GET across that 302 and
 * Apps Script serves the computed reply from the echo URL; forcing POST through
 * the hop returns "page not found".
 *
 * THAT HOP IS A SECOND ROUND TRIP ON EVERY WRITE AND THERE IS NOTHING HERE THAT CAN
 * REMOVE IT: the echo URL is minted per request, `redirect: 'manual'` yields an
 * opaque response whose `Location` a cross-origin caller may not read, and the only
 * other endpoint (`/dev`) requires a Google session, which the anonymous read path
 * cannot have. Letting the browser follow it — one connection, already warm — is the
 * cheapest form it comes in, so the lever that is left is the NUMBER of requests, not
 * the cost of one. See `createWriteQueue` in `useBoard`.
 */

import { SCRIPT_URL, parseConfig } from '../config.js'
import { rowToTask, taskToRow } from '../schema.js'

/** Beyond this something is wrong with the network, not with the request. */
const READ_TIMEOUT_MS = 20_000

/**
 * A WRITE MUST OUTLAST THE SCRIPT'S OWN LOCK WAIT, which is 25s in `Code.gs`.
 *
 * Two phones saving at once means the second request sits on that lock before it does any work,
 * so a client that gave up at 20s aborted a write the script then went on to COMMIT: the row
 * rolled back on screen and a failure toast went up for an edit that had landed, and the next read
 * silently contradicted both. It also made `busy` unreachable — the one code the taxonomy calls
 * worth retrying could never arrive, because the abort always came first.
 *
 * It costs nothing in the ordinary case: a write answers in ~3s, and a queue behind a stalled one
 * FOLDS rather than piles up (see `createWriteQueue`), so a longer ceiling here is not a longer
 * wait for anybody.
 */
const WRITE_TIMEOUT_MS = 35_000

/**
 * Thrown by everything here. `code` is what the UI branches on, and it never leaves
 * this module: `useBoard` reads `error.code`, so nothing outside needs the class.
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
  /** The key was refused. Terminal: retrying cannot help. */
  UNAUTHORIZED: 'unauthorized',
  /** The script is bound to a spreadsheet that already holds somebody's work. */
  NOT_EMPTY: 'not_empty',
  /** The script is not bound to a spreadsheet at all. */
  MISCONFIGURED: 'misconfigured',
  /** Another write held the lock. Retrying is exactly right. */
  BUSY: 'busy',
  /** The row vanished — someone deleted it in the Sheets UI mid-edit. */
  NOT_FOUND: 'not_found',
  /**
   * The DEPLOYED script cannot store a column this bundle writes, so the write is refused
   * here rather than sent. The only code the server never produces: `useBoard` raises it from
   * the `schema` every read carries. See `missingColumnsFor` there for what it prevents.
   */
  OUTDATED: 'outdated',
  /** Anything else. Assumed transient; see the module header. */
  TRANSIENT: 'transient',
}

/** Terminal codes. Anything not in here is worth retrying. */
const TERMINAL = new Set([
  API_ERROR.UNCONFIGURED,
  API_ERROR.UNAUTHORIZED,
  API_ERROR.NOT_EMPTY,
  API_ERROR.MISCONFIGURED,
  API_ERROR.NOT_FOUND,
  // Retrying cannot help: the fix is a redeployment, and the notice names it.
  API_ERROR.OUTDATED,
])

export function isTerminal(code) {
  return TERMINAL.has(code)
}

/**
 * The server's error vocabulary -> ours. An unrecognised code is transient, on
 * the same reasoning as a non-JSON body: a code this build has never heard of is
 * more likely a newer script than a permanent refusal.
 */
function codeFor(serverError) {
  switch (serverError) {
    case 'unauthorized':
      return API_ERROR.UNAUTHORIZED
    case 'not_empty':
      return API_ERROR.NOT_EMPTY
    case 'misconfigured':
      return API_ERROR.MISCONFIGURED
    case 'busy':
      return API_ERROR.BUSY
    case 'not_found':
      return API_ERROR.NOT_FOUND
    default:
      return API_ERROR.TRANSIENT
  }
}

async function send(url, init, timeout) {
  if (!SCRIPT_URL) throw new ApiError(API_ERROR.UNCONFIGURED)

  let response
  try {
    response = await fetch(url, {
      ...init,
      // A redirect that has to be followed as a GET is the whole reason the
      // request shape above is what it is.
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new ApiError(API_ERROR.TRANSIENT, error)
  }

  const text = await response.text().catch(() => '')

  let body
  try {
    body = JSON.parse(text)
  } catch (error) {
    // Google's HTML error page. Transient by default — see the module header.
    throw new ApiError(API_ERROR.TRANSIENT, error)
  }

  if (!body || typeof body !== 'object') throw new ApiError(API_ERROR.TRANSIENT)
  if (body.ok !== true) throw new ApiError(codeFor(body.error))
  return body
}

/**
 * Decode a board reply. `needsSetup` is not an error: it is a spreadsheet whose
 * tabs have not been built yet, which reads as an empty board plus a flag the UI
 * uses to explain why an editor sees a seeding prompt and a planner sees nothing.
 */
function decodeBoard(body) {
  return {
    tasks: Array.isArray(body.tasks) ? body.tasks.map(rowToTask).filter((task) => task.id) : [],
    /** The PARTIAL config, pre-merge — see `mergeConfig` and the snapshot. */
    config: parseConfig(body.config),
    needsSetup: Boolean(body.needsSetup),
    sheetTimeZone: typeof body.sheetTimeZone === 'string' ? body.sheetTimeZone : '',
    /**
     * The columns the deployed script understands. A deployment older than this bundle sends no
     * `schema` at all, which is itself the signal — see `missingColumnsFor` in `useBoard`.
     */
    schema: Array.isArray(body.schema) ? body.schema.map(String) : [],
    /**
     * The ops the deployed script can DISPATCH, which its columns cannot imply: a script can hold
     * every column and still answer `bad_op` to a batch. ABSENT rather than empty is what a
     * deployment older than this bundle sends, and `null` says so — see `supports` in `useBoard`,
     * where not knowing and not having fall the same way.
     */
    ops: Array.isArray(body.ops) ? body.ops.map(String) : null,
  }
}

/**
 * The public read. No credential, and deliberately a GET so it is the cheapest
 * possible thing for a planner refreshing a page on a large monitor.
 *
 * `t` is a cache-buster, not data the script reads. `/exec` is served through
 * Google's own cache and a planner reloading right after an edit must not be
 * handed the previous board. It goes in the query string because a fragment
 * would not reach the server at all — the edit key's reason for living there is
 * exactly why a cache-buster cannot.
 *
 * @param {number} [now] injectable so a test can pin the URL
 */
export async function readBoard(now = Date.now()) {
  const separator = SCRIPT_URL.includes('?') ? '&' : '?'
  return decodeBoard(
    await send(`${SCRIPT_URL}${separator}t=${now}`, { method: 'GET' }, READ_TIMEOUT_MS),
  )
}

/**
 * @param {string} op one of the script's operations
 * @param {object} payload
 * @param {string} key the edit key
 * @returns {Promise<object>} the fresh board — every write returns one, so a save
 *   costs a single round trip
 */
export async function mutate(op, payload, key) {
  if (!key) throw new ApiError(API_ERROR.UNAUTHORIZED)
  const body = await send(
    SCRIPT_URL,
    {
      method: 'POST',
      // text/plain keeps this a CORS simple request. Do not "correct" it to
      // application/json: the preflight that would trigger dies on the 302.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key, op, payload }),
    },
    WRITE_TIMEOUT_MS,
  )
  return decodeBoard(body)
}

export function createTask(task, key) {
  return mutate('create', { task: taskToRow(task) }, key)
}

export function createTasks(tasks, key) {
  return mutate('createMany', { tasks: tasks.map(taskToRow) }, key)
}

export function updateTask(task, key) {
  return mutate('update', { task: taskToRow(task) }, key)
}

/**
 * Several rows in ONE request, which is what makes a burst of ticks cost one round trip.
 *
 * ATOMIC ON RESOLUTION: the script resolves every id before it writes anything, so a batch naming a
 * row somebody has since deleted by hand answers `not_found` and writes none of them. That is why
 * the client may roll the whole batch back — a partial success would leave it with no way to know
 * which half landed. Only send it where `ops` advertises it; an older deployment answers `bad_op`.
 */
export function updateTasks(tasks, key) {
  return mutate('updateMany', { tasks: tasks.map(taskToRow) }, key)
}

export function deleteTask(id, key) {
  return mutate('delete', { id }, key)
}

export function restoreTask(id, key) {
  return mutate('restore', { id }, key)
}

export function writeConfig(raw, key) {
  return mutate('setConfig', { config: raw }, key)
}

export function compact(key) {
  return mutate('compact', {}, key)
}
