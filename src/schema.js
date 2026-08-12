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
 * existing index — and the only one an older deployment can be caught out by cheaply.
 * `useBoard` compares this whole list against the `schema` every read carries, which is
 * what a RENAME taught it to do: `due` replaced `end`, a deployment that predated it still
 * had every other column including the last one, and the guard that only checked the last
 * one let the write through and dropped every date on the board.
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
    /**
     * `end` IS THE FALLBACK, AND IT IS READ-ONLY. A deployment that predates this column list
     * sends no `due` at all, which read every task on the board as undated — the whole plan
     * looked empty rather than out of date. The old closing end of the window is what "due by"
     * meant, so this shows the board correctly until the script is redeployed; the `slice` drops
     * the clock half the same way `normalizeDay` does.
     *
     * Nothing WRITES `end`. `useBoard` refuses every task write against such a deployment
     * (`missingColumns`), because a write there is what silently threw the dates away.
     */
    due: cellText(row?.due) || cellText(row?.end).slice(0, 10),
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
 * A TITLE IS THE ONLY THING REQUIRED. The due date is deliberately optional, and that
 * is not laziness: forcing one forces a WRONG one. During entry the date is exactly
 * what is not yet known — "find a florist" is real, "find a florist by the 12th" is an
 * invention — and under this app's arithmetic an invented date lands straight in the
 * overdue count and in the on-schedule mark. A dateless task sorts to its own group at
 * the foot of the list, counts in the total, and asks nothing of anybody until somebody
 * gives it a day.
 *
 * @param {object} task
 * @param {(day: string) => boolean} isValidDay injected from `lib/time.js` to
 *   keep this module free of date logic
 */
export function validateTask(task, isValidDay) {
  const codes = []
  if (!cellText(task?.title)) codes.push('MISSING_TITLE')

  /**
   * A subtask is a checklist item: a title and a tick. It carries no date at all — not even an
   * optional one — because a date wheel per item would make entering five of them in a row
   * unusable on a phone, and then no parent's progress would ever advance, which is the whole
   * point of the feature. One branch rather than a second function, so the title check cannot
   * drift between them.
   */
  if (isSubtask(task)) return codes

  /**
   * Unreachable from the UI — `taskFromDraft` runs every day through `normalizeDay`, which
   * yields '' for anything unparseable — and kept anyway, because this is also the guard on a
   * cell somebody typed by hand in the spreadsheet. Silently rewriting that to "no date" is
   * the one outcome worse than refusing it.
   */
  const due = cellText(task?.due)
  if (due && !isValidDay(due)) codes.push('BAD_DUE')
  return codes
}
