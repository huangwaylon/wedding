/**
 * The last successful read, kept on the device so a cold launch paints real data before any network
 * call: a read is a round trip to an Apps Script web app, well over a second even warm.
 *
 * Stores the sheet's partial config rather than the merged one (see `mergeConfig`): a merged copy
 * would freeze the building build's defaults into every future launch.
 */

import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

/**
 * A drop marker, never a migration. An unrecognised version means the snapshot is ignored and
 * re-fetched, which is free — the sheet is the source of truth. Bump it whenever the stored shape
 * changes.
 */
const VERSION = 2

/**
 * Roughly 3000 tasks. WebKit charges localStorage in UTF-16 code units, so the stored cost is about
 * twice this string's byte length; the cap keeps a long board from blowing the origin's quota,
 * since `writeStored` swallows the error and the app would just stay slow.
 */
const MAX_CHARS = 800_000

/**
 * @returns {{tasks: object[], config: object}|null}
 */
export function readSnapshot() {
  const raw = readStored(STORAGE_KEYS.snapshot)
  if (!raw) return null

  try {
    const saved = JSON.parse(raw)
    if (saved?.v !== VERSION) return null
    if (!Array.isArray(saved.tasks)) return null
    if (!saved.config || typeof saved.config !== 'object') return null
    return { tasks: saved.tasks, config: saved.config }
  } catch {
    return null
  }
}

/**
 * The last payload written this session, so an unchanged refresh does not pay for a second write.
 */
let lastPayload = null

/**
 * @param {object[]} tasks as returned by a successful read — never optimistic rows, whose `pending`
 *   flag would come back looking like a saved task
 * @param {object} sheetConfig the partial config, pre-merge
 */
export function writeSnapshot(tasks, sheetConfig) {
  const payload = JSON.stringify({
    v: VERSION,
    config: sheetConfig ?? {},
    // `subtasks` is stripped with the other derived fields: it is rebuilt on every read, and
    // persisting it would re-seed a stale percentage on each cold launch and double the payload.
    tasks: tasks.map(({ pending, progress, subtasks, ...task }) => task),
  })
  if (payload === lastPayload) return
  if (payload.length > MAX_CHARS) return
  lastPayload = payload
  writeStored(STORAGE_KEYS.snapshot, payload)
}
