/**
 * The sheet contract, and the ONLY file on this side that knows the layout.
 *
 * `apps-script/Code.gs` holds the same column list because the boundary between
 * them is a network hop and neither can import the other. Those two lists must
 * stay identical and in the same order; `test/schema.test.js` parses the .gs file
 * and fails the build when they drift. Nothing else anywhere may name a column.
 *
 * Everything crossing the wire is a STRING. The sheet stores text (the script
 * forces the '@' number format), so a task's fields are strings here too and are
 * parsed at the point of use — `all_day` and `done_at` are the only two that
 * carry meaning as anything but text, and both are decoded here.
 */

/**
 * Sheet column order. Kept as data rather than as an object so the order is
 * unambiguous and the .gs comparison is a plain array equality.
 */
export const TASK_COLUMNS = [
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
]

export const TASKS_SHEET = 'tasks'
export const CONFIG_SHEET = 'config'

/**
 * The one truthy spelling written to the sheet. Read is deliberately lenient —
 * somebody typing TRUE, true, yes or 1 into the cell by hand means the same
 * thing — but write is exactly this, so the column never accumulates variants.
 */
export const TRUE_TEXT = 'TRUE'

const TRUTHY = new Set(['true', 'TRUE', 'True', 'yes', 'YES', '1', 'x', 'X'])

export function parseBool(text) {
  return TRUTHY.has(String(text ?? '').trim())
}

/** Trim without turning a missing cell into the string "undefined". */
export function cellText(value) {
  return value == null ? '' : String(value).trim()
}

/**
 * A row object from the endpoint -> the shape the app works in.
 *
 * `start` and `end` are WALL-CLOCK strings ("2027-04-18T14:00") with no zone —
 * they mean that reading of a clock at the venue, and are resolved against the
 * board's configured timezone by `src/lib/time.js`. They are deliberately not
 * instants: "the ceremony is at 14:00" must read 14:00 for a planner in another
 * country, which a UTC timestamp rendered locally would not.
 */
export function rowToTask(row) {
  return {
    id: cellText(row?.id),
    title: cellText(row?.title),
    category: cellText(row?.category),
    start: cellText(row?.start),
    end: cellText(row?.end),
    allDay: parseBool(row?.all_day),
    doneAt: cellText(row?.done_at),
    notes: cellText(row?.notes),
    owner: cellText(row?.owner),
    createdAt: cellText(row?.created_at),
    updatedAt: cellText(row?.updated_at),
    deletedAt: cellText(row?.deleted_at),
  }
}

/**
 * The inverse, for the wire. Every value is a string — `all_day` becomes 'TRUE'
 * or '' rather than a boolean, because a boolean would arrive at the sheet as a
 * checkbox-shaped value and read back as the string "true" on some locales and
 * "TRUE" on others.
 *
 * `created_at` and `updated_at` are omitted deliberately: the script stamps both,
 * so a device with a wrong clock cannot backdate a row, and `created_at` on an
 * update is taken from the existing row rather than from the client.
 */
export function taskToRow(task) {
  if (!task?.id) throw new Error('taskToRow: id is required')
  if (!cellText(task.title)) throw new Error('taskToRow: title is required')
  return {
    id: task.id,
    title: cellText(task.title),
    category: cellText(task.category),
    start: cellText(task.start),
    end: cellText(task.end),
    all_day: task.allDay ? TRUE_TEXT : '',
    done_at: cellText(task.doneAt),
    notes: cellText(task.notes),
    owner: cellText(task.owner),
    deleted_at: cellText(task.deletedAt),
  }
}

/** A task nobody has tombstoned. The client filters; the sheet keeps the row. */
export function isLive(task) {
  return !task.deletedAt
}

export function isDone(task) {
  return Boolean(task.doneAt)
}

/**
 * Structural problems that must stop a save, as codes rather than sentences so
 * the catalog owns the wording. Time validity is checked here too, because an
 * unparseable date silently becomes "unscheduled" rather than an error.
 *
 * @param {object} task
 * @param {(wall: string) => boolean} isValidWall injected from `lib/time.js` to
 *   keep this module free of date logic
 */
export function validateTask(task, isValidWall) {
  const codes = []
  if (!cellText(task?.title)) codes.push('MISSING_TITLE')

  const start = cellText(task?.start)
  const end = cellText(task?.end)
  if (!start) codes.push('MISSING_START')
  else if (!isValidWall(start)) codes.push('BAD_START')
  if (!end) codes.push('MISSING_END')
  else if (!isValidWall(end)) codes.push('BAD_END')

  // Only meaningful once both parsed; wall-clock strings in this format sort
  // lexicographically, which is why no date objects are needed to compare them.
  if (start && end && isValidWall(start) && isValidWall(end) && end < start) {
    codes.push('END_BEFORE_START')
  }
  return codes
}
