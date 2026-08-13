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
 * parsed at the point of use — `done_at` is the only one that carries meaning as
 * anything but text, and it is decoded here.
 *
 * A TASK IS A TITLE, A DAY AND A TICK. There is no start, no clock time, no
 * all-day flag, no owner and no memo: a wedding checklist is read as "what is due
 * next", every one of those fields was optional in practice, and each one cost a
 * control on a 393px screen and a column somebody had to understand in the
 * spreadsheet. Removing them is what lets a task row be scannable at a glance and
 * the editor be three fields long.
 */

/**
 * Sheet column order. Kept as data rather than as an object so the order is
 * unambiguous and the .gs comparison is a plain array equality.
 *
 * APPEND, never rename or reorder. Appending is the only change that cannot shift an
 * existing index. `useBoard` compares this WHOLE list against the `schema` every read
 * carries — never just the last entry, which a rename leaves in place while breaking
 * everything before it.
 */
export const TASK_COLUMNS = [
  'id',
  'title',
  'category',
  /** The day it is due, 'YYYY-MM-DD'. No time: see the header. */
  'due',
  'done_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'parent_id',
]

export const TASKS_SHEET = 'tasks'
export const CONFIG_SHEET = 'config'

/** 0 -> 'A'. General rather than a lookup table because `TASK_COLUMNS` may only grow. */
function letterAt(index) {
  let letter = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letter = String.fromCharCode(65 + (n % 26)) + letter
  }
  return letter
}

/**
 * A column's position, by name. Throws rather than returning -1: every caller uses the
 * result to build a range, and a `-1` would silently address the column before A.
 */
export function columnIndex(name) {
  const index = TASK_COLUMNS.indexOf(name)
  if (index < 0) throw new Error(`columnIndex: no such column ${name}`)
  return index
}

export function columnLetter(name) {
  return letterAt(columnIndex(name))
}

const LAST_LETTER = letterAt(TASK_COLUMNS.length - 1)

/**
 * The A1 ranges, all derived from `TASK_COLUMNS` so appending a column widens every one of
 * them at once. NOTHING outside this file may spell a range: a hardcoded `tasks!A2:I` is a
 * second place that knows the width, and it goes stale on the very next append.
 */
export const TASKS_RANGE = `${TASKS_SHEET}!A1:${LAST_LETTER}`
export const CONFIG_RANGE = `${CONFIG_SHEET}!A1:B`

/** One whole task row, for a write that rewrites it entirely. */
export function rowRange(row) {
  return `${TASKS_SHEET}!A${row}:${LAST_LETTER}${row}`
}

/**
 * A span of adjacent columns on one row. `updated_at` and `deleted_at` are neighbours, so
 * stamping a delete is one range per affected row rather than two.
 */
export function spanRange(row, firstColumn, lastColumn) {
  return `${TASKS_SHEET}!${columnLetter(firstColumn)}${row}:${columnLetter(lastColumn)}${row}`
}

/** Trim without turning a missing cell into the string "undefined". */
export function cellText(value) {
  return value == null ? '' : String(value).trim()
}

/**
 * A row object from the endpoint -> the shape the app works in.
 *
 * `due` is a WALL-CLOCK DAY ('2027-04-18') with no zone and no time. It means that
 * date on a calendar at the venue, and whether it has passed is decided against
 * the board's configured timezone by `src/lib/time.js` — never against the
 * device's. "Due on the 18th" must read the 18th for a planner in another country.
 */
export function rowToTask(row) {
  return {
    id: cellText(row?.id),
    title: cellText(row?.title),
    category: cellText(row?.category),
    due: cellText(row?.due),
    doneAt: cellText(row?.done_at),
    createdAt: cellText(row?.created_at),
    updatedAt: cellText(row?.updated_at),
    deletedAt: cellText(row?.deleted_at),
    parentId: cellText(row?.parent_id),
  }
}

/**
 * The stored fields of a task, as strings, WITHOUT either timestamp.
 *
 * OMITTING THE TIMESTAMPS IS WHAT MAKES THIS A FINGERPRINT. `TaskDetail` stringifies the
 * result to decide whether an edit session actually changed the row, and skips the write
 * when it did not — so anything in here that moves on its own, `updated_at` above all,
 * would make every Done cost a round trip. `taskCells` is what a write uses.
 */
export function taskToRow(task) {
  if (!task?.id) throw new Error('taskToRow: id is required')
  if (!cellText(task.title)) throw new Error('taskToRow: title is required')
  return {
    id: task.id,
    title: cellText(task.title),
    category: cellText(task.category),
    due: cellText(task.due),
    done_at: cellText(task.doneAt),
    deleted_at: cellText(task.deletedAt),
    /**
     * Never omit this. A write rewrites the WHOLE row from this, so a task object built
     * without `parentId` blanks the cell and silently promotes a subtask to a task.
     */
    parent_id: cellText(task.parentId),
  }
}

/**
 * One task as the CELLS of its row, in `TASK_COLUMNS` order — what the Sheets API wants.
 *
 * THE CLIENT STAMPS BOTH TIMESTAMPS, so a device with a wrong clock can backdate a row. That
 * is accepted rather than overlooked: only a server can stamp a trustworthy time, and reaching
 * one costs a second hop on every write. Neither timestamp is load-bearing for anything the app
 * computes — `due` decides every date question and `done_at` is only ever tested for emptiness —
 * so the exposure is a wrong number in a column nobody reads. Wanting trustworthy timestamps
 * means wanting a server on the write path, which is the decision to revisit, not this line.
 *
 * `createdAt` is passed in rather than read off the task so the caller can preserve what the
 * row already holds: a create that is replaying must not restamp a row somebody made
 * yesterday.
 *
 * @param {object} task
 * @param {{createdAt?: string, updatedAt: string}} stamps
 * @returns {string[]} one cell per column, in order
 */
export function taskCells(task, { createdAt, updatedAt }) {
  const row = taskToRow(task)
  return TASK_COLUMNS.map((column) => {
    if (column === 'created_at') return cellText(createdAt) || updatedAt
    if (column === 'updated_at') return updatedAt
    return cellText(row[column])
  })
}

/** A task nobody has tombstoned. The client filters; the sheet keeps the row. */
export function isLive(task) {
  return !task.deletedAt
}

export function isDone(task) {
  return Boolean(task.doneAt)
}

/** A row that names a parent. Whether that parent is USABLE is decided by `partitionSubtasks`. */
function isSubtask(task) {
  return Boolean(task?.parentId)
}

/**
 * Structural problems that must stop a save, as codes rather than sentences so
 * the catalog owns the wording.
 *
 * A TASK NEEDS A TITLE AND A DAY. A subtask needs only a title.
 *
 * @param {object} task
 * @param {(day: string) => boolean} isValidDay injected from `lib/time.js` to
 *   keep this module free of date logic
 */
export function validateTask(task, isValidDay) {
  const codes = []
  if (!cellText(task?.title)) codes.push('MISSING_TITLE')

  /**
   * A subtask is a checklist item: a title and a tick, with no date at all. A date wheel per item
   * would make entering five in a row unusable on a phone, and then no parent's progress would
   * advance, which is the point of the feature. One branch rather than a second function, so the
   * title check cannot drift between them.
   */
  if (isSubtask(task)) return codes

  /**
   * A DAY IS REQUIRED, AND REFUSED RATHER THAN DEFAULTED. Nothing may invent a date: an invented
   * one lands straight in the overdue count and in the on-schedule mark, so the create sheet opens
   * BLANK and Save refuses until somebody picks a day.
   *
   * `STATE.NODATE` still has to render. A sheet can hold undated rows and anybody can empty the
   * cell by hand, and a row this refuses to SAVE must still be shown — hiding one is the worst
   * thing this app can do.
   */
  const due = cellText(task?.due)
  if (!due) codes.push('MISSING_DUE')
  else if (!isValidDay(due)) codes.push('BAD_DUE')
  return codes
}
