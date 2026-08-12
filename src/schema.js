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
 * The inverse, for the wire. Every value is a string.
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
    due: cellText(task.due),
    done_at: cellText(task.doneAt),
    deleted_at: cellText(task.deletedAt),
    /**
     * Never omit this. `updateTask` writes the WHOLE row from the payload, so a task object
     * built without `parentId` blanks the cell and silently promotes a subtask to a task.
     */
    parent_id: cellText(task.parentId),
  }
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
