/**
 * The sheet contract: the only file on this side that knows the layout, and the owner of every
 * column name and every A1 range.
 *
 * `apps-script/Code.gs` holds the same column list because the boundary is a network hop and
 * neither can import the other. The lists must stay identical and in the same order;
 * `test/schema.test.js` parses the .gs file and fails the build on drift. Nothing else anywhere may
 * name a column.
 *
 * Everything crossing the wire is a string: the sheet stores text (`ensureStructure` sets the '@'
 * number format on every column it builds), so fields are strings here too and are parsed at the
 * point of use.
 *
 * A task is a title, a day and a tick, with an OPTIONAL day it starts. No clock time, no all-day
 * flag, no owner, no memo: each costs a control on a 393px screen and a column somebody has to
 * understand in the spreadsheet. `start` earns its column by answering a question the board could not
 * — which of these am I supposed to be doing now — and it is optional precisely so it costs nothing
 * on the rows that do not need it.
 */

/**
 * Sheet column order, as data so the .gs comparison is array equality.
 *
 * Append, never rename or reorder. Appending is the only change that cannot shift an existing
 * index: every write addresses cells by position, so a rename leaves every value under the old
 * label unreachable while looking correct in the Sheets UI.
 */
export const TASK_COLUMNS = [
  'id',
  'title',
  'category',
  /** The day it is due, 'YYYY-MM-DD'. No time. */
  'due',
  'done_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'parent_id',
  /**
   * The day work on it starts, 'YYYY-MM-DD', or empty. Optional, and last because appending is the
   * one change that shifts no index: a deployment predating it reads every other column by name and
   * serves a board without this one, rather than a board of shifted cells.
   */
  'start',
]

export const TASKS_SHEET = 'tasks'
export const CONFIG_SHEET = 'config'

/** 0 -> 'A'. General rather than a lookup table because `TASK_COLUMNS` may grow. */
function letterAt(index) {
  let letter = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letter = String.fromCharCode(65 + (n % 26)) + letter
  }
  return letter
}

/**
 * A column's position, by name. Throws rather than returning -1: callers build ranges from the
 * result, and -1 would address the column before A.
 */
export function columnIndex(name) {
  const index = TASK_COLUMNS.indexOf(name)
  if (index < 0) throw new Error(`columnIndex: no such column ${name}`)
  return index
}

function columnLetter(name) {
  return letterAt(columnIndex(name))
}

const LAST_LETTER = letterAt(TASK_COLUMNS.length - 1)

/**
 * The A1 ranges, derived from `TASK_COLUMNS` so an append widens every one at once. Nothing outside
 * this file may spell a range: a hardcoded `tasks!A2:I` is a second place that knows the width and
 * goes stale on the next append.
 */
export const TASKS_RANGE = `${TASKS_SHEET}!A1:${LAST_LETTER}`
export const CONFIG_RANGE = `${CONFIG_SHEET}!A1:B`

/** One whole task row, for a write that rewrites it entirely. */
export function rowRange(row) {
  return `${TASKS_SHEET}!A${row}:${LAST_LETTER}${row}`
}

/**
 * A span of adjacent columns on one row. `updated_at` and `deleted_at` are neighbours, so stamping
 * a delete is one range per affected row rather than two.
 */
export function spanRange(row, firstColumn, lastColumn) {
  return `${TASKS_SHEET}!${columnLetter(firstColumn)}${row}:${columnLetter(lastColumn)}${row}`
}

/** Trim without turning a missing cell into the string "undefined". */
export function cellText(value) {
  return value == null ? '' : String(value).trim()
}

/**
 * A row object from the endpoint -> the shape the app works in. `due` is a wall-clock day, no zone
 * and no time; whether it has passed is decided against the board's configured timezone by
 * `src/lib/time.js`.
 */
export function rowToTask(row) {
  return {
    id: cellText(row?.id),
    title: cellText(row?.title),
    category: cellText(row?.category),
    due: cellText(row?.due),
    start: cellText(row?.start),
    doneAt: cellText(row?.done_at),
    createdAt: cellText(row?.created_at),
    updatedAt: cellText(row?.updated_at),
    deletedAt: cellText(row?.deleted_at),
    parentId: cellText(row?.parent_id),
  }
}

/**
 * The stored fields of a task, as strings, without either timestamp — which is what makes it a
 * fingerprint. `TaskDetail` stringifies it to decide whether an edit session changed the row and
 * skips the write when it did not, so anything in here that moves on its own would make every Done
 * cost a round trip. `taskCells` is what a write uses.
 */
export function taskToRow(task) {
  if (!task?.id) throw new Error('taskToRow: id is required')
  if (!cellText(task.title)) throw new Error('taskToRow: title is required')
  return {
    id: task.id,
    title: cellText(task.title),
    category: cellText(task.category),
    due: cellText(task.due),
    /** Optional, so '' is a value here and not an omission: a write rewrites the whole row, and
        clearing a start date has to be able to reach the cell. */
    start: cellText(task.start),
    done_at: cellText(task.doneAt),
    deleted_at: cellText(task.deletedAt),
    /**
     * Never omit this. A write rewrites the whole row from here, so a task object built without
     * `parentId` blanks the cell and promotes a subtask to a task.
     */
    parent_id: cellText(task.parentId),
  }
}

/**
 * One task as the cells of its row, in `TASK_COLUMNS` order.
 *
 * The client stamps both timestamps, so a device with a wrong clock can backdate a row. Accepted: a
 * trustworthy stamp needs a server on the write path, and neither timestamp is load-bearing — `due`
 * decides every date question and `done_at` is only tested for emptiness.
 *
 * `createdAt` is passed in so the caller can preserve what the row already holds: a replayed create
 * must not restamp a row made yesterday.
 *
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

/** A row that names a parent. Whether that parent is usable is decided by `partitionSubtasks`. */
function isSubtask(task) {
  return Boolean(task?.parentId)
}

/**
 * Structural problems that must stop a save, as codes so the catalog owns the wording. A task needs
 * a title and a day; a subtask needs only a title.
 *
 * @param {(day: string) => boolean} isValidDay injected from `lib/time.js`, to keep this module
 *   free of date logic
 */
export function validateTask(task, isValidDay) {
  const codes = []
  if (!cellText(task?.title)) codes.push('MISSING_TITLE')

  /**
   * A subtask is a title and a tick, no date: a date wheel per item would make entering five in a
   * row unusable on a phone. One branch rather than a second function, so the title check cannot
   * drift.
   */
  if (isSubtask(task)) return codes

  /**
   * A day is required and refused rather than defaulted: an invented date lands straight in the
   * overdue count and in the on-schedule mark, so the create sheet opens blank and Save refuses
   * until somebody picks one.
   *
   * `STATE.NODATE` still has to render: a sheet can hold undated rows, anybody can empty the cell
   * by hand, and a row this refuses to save must still be shown.
   */
  const due = cellText(task?.due)
  if (!due) codes.push('MISSING_DUE')
  else if (!isValidDay(due)) codes.push('BAD_DUE')
  return codes
}
