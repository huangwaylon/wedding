/**
 * The sheet contract, including the one cross-boundary check in the repo: the column
 * list here and the one in `apps-script/Code.gs` must be identical. Nothing imports
 * across that boundary — it is a network hop — so drift is otherwise invisible until a
 * write lands in the wrong column.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TASK_COLUMNS,
  cellText,
  isDone,
  isLive,
  rowToTask,
  taskToRow,
  validateTask,
} from '../src/schema.js'
import { isValidDay } from '../src/lib/time.js'

describe('the Code.gs column contract', () => {
  it('matches src/schema.js exactly, in order', () => {
    const source = readFileSync('apps-script/Code.gs', 'utf8')
    const block = /var TASK_COLUMNS = \[([\s\S]*?)\n\]/.exec(source)
    expect(block, 'TASK_COLUMNS not found in Code.gs').toBeTruthy()

    const columns = [...block[1].matchAll(/^\s*'([a-z_]+)',$/gm)].map((match) => match[1])
    expect(columns).toEqual(TASK_COLUMNS)
  })

  it('agrees on the tab names', () => {
    const source = readFileSync('apps-script/Code.gs', 'utf8')
    expect(source).toContain("var TASKS_SHEET = 'tasks'")
    expect(source).toContain("var CONFIG_SHEET = 'config'")
  })

  it('writes every value RAW, which is what replaced the formula escape', () => {
    // `Code.gs` used to prefix a leading =, +, - or @ with an apostrophe, because Apps Script's
    // `setValues` parsed those as formulas whatever the cell format said. The Sheets API does
    // not: `valueInputOption: RAW` stores what it is given. So the guard is now "RAW, always" —
    // and USER_ENTERED anywhere would make a title of "=SUM(A:A)" a live formula in somebody's
    // spreadsheet and a date get reformatted to the sheet's locale.
    // Comments stripped: the module's header explains this rule by NAMING what it forbids, so a
    // raw search matches the prose and passes whatever the code does.
    const source = readFileSync('src/lib/sheets.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    expect(source).toMatch(/const RAW = 'RAW'/)
    expect(source, 'a write must never be USER_ENTERED').not.toContain('USER_ENTERED')
    // Every valueInputOption in the file has to be the constant, never a literal.
    const options = [...source.matchAll(/valueInputOption: ([^,\s}]+)/g)].map((m) => m[1])
    expect(options.length).toBeGreaterThan(0)
    expect([...new Set(options)]).toEqual(['RAW'])
  })

  it('grows only at the END, because appending is the only safe change', () => {
    // Appending cannot shift an existing column's index, and every range in `schema.js` is
    // derived from the list's length, so an append widens all of them at once. `start` is the one
    // column added since the first deployment, which is why it is last and not beside `due`.
    expect(TASK_COLUMNS[TASK_COLUMNS.length - 1]).toBe('start')
    expect(TASK_COLUMNS.slice(0, 9)).toEqual([
      'id',
      'title',
      'category',
      'due',
      'done_at',
      'created_at',
      'updated_at',
      'deleted_at',
      'parent_id',
    ])
  })

  it('keeps updated_at and deleted_at adjacent, so a cascade is one range per row', () => {
    // `setDeleted` writes them as one span. A column inserted between them doubles every delete
    // into two ranges per row, which is also two chances to half-fail.
    expect(TASK_COLUMNS.indexOf('deleted_at')).toBe(TASK_COLUMNS.indexOf('updated_at') + 1)
  })

  it('carries only the ten columns a task has', () => {
    // A task is a title, a day, a tick and — optionally — the day it starts. None of these others
    // may come back. `notes` here means a MEMO PER TASK — a field that would cost a control on a
    // 393px screen and a column to understand; the shared notes document is one cell in the config
    // tab and nothing to do with a row. `end` stays gone: a second required date is a range, which
    // is what `start` plus `due` deliberately is not — one deadline, one optional beginning.
    for (const gone of ['end', 'all_day', 'notes', 'owner', 'assignee']) {
      expect(TASK_COLUMNS).not.toContain(gone)
    }
    expect(TASK_COLUMNS).toHaveLength(10)
  })
})

describe('rowToTask', () => {
  it('maps every column and trims', () => {
    const task = rowToTask({
      id: ' abc ',
      title: ' Book the venue ',
      category: 'Venue',
      due: ' 2027-02-01 ',
      done_at: '',
      created_at: '2026-08-07T00:00:00.000Z',
      updated_at: '2026-08-07T00:00:00.000Z',
      deleted_at: '',
      parent_id: '',
      start: ' 2027-01-15 ',
    })
    expect(task).toEqual({
      id: 'abc',
      title: 'Book the venue',
      category: 'Venue',
      due: '2027-02-01',
      start: '2027-01-15',
      doneAt: '',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      deletedAt: '',
      parentId: '',
    })
  })

  it('reads each day from its own column and from nowhere else', () => {
    // Two columns, two questions, and a key the layout does not contain is not a fallback for
    // either: `end` names nothing here, and a start date may never stand in for a deadline.
    expect(rowToTask({ id: 'a', title: 'x', due: '2027-03-09' }).due).toBe('2027-03-09')
    expect(rowToTask({ id: 'a', title: 'x', end: '2027-02-01' }).due).toBe('')
    expect(rowToTask({ id: 'a', title: 'x', start: '2027-01-15' }).start).toBe('2027-01-15')
    expect(rowToTask({ id: 'a', title: 'x', start: '2027-01-15' }).due).toBe('')
  })

  it('never yields the string "undefined" for a missing cell', () => {
    const task = rowToTask({ id: 'a', title: 'x' })
    expect(task.due).toBe('')
    expect(task.start).toBe('')
    expect(task.category).toBe('')
    expect(task.parentId).toBe('')
  })

  it('survives a null row', () => {
    expect(rowToTask(null).id).toBe('')
  })
})

describe('taskToRow', () => {
  const task = {
    id: 'abc',
    title: 'Book the venue',
    category: 'Venue',
    due: '2027-02-01',
    start: '',
    doneAt: '',
    deletedAt: '',
    parentId: '',
  }

  it('sends every value as a string', () => {
    for (const value of Object.values(taskToRow(task))) {
      expect(typeof value).toBe('string')
    }
  })

  it('always sends parent_id', () => {
    // `update` rewrites the whole row from this payload, so omitting it blanks the cell and
    // silently promotes a subtask to a task.
    expect(taskToRow({ ...task, parentId: 'p1' }).parent_id).toBe('p1')
    expect(taskToRow(task)).toHaveProperty('parent_id')
  })

  it('always sends start, empty included, so clearing one can reach the cell', () => {
    // Same rule as `parent_id`, for the same reason: the payload is the whole row. Omitted, an
    // optional date could be set but never removed — and it is also part of the fingerprint below,
    // so a session that changed only the start date has to read as changed.
    expect(taskToRow({ ...task, start: '2027-01-15' }).start).toBe('2027-01-15')
    expect(taskToRow(task)).toHaveProperty('start')
    expect(taskToRow(task).start).toBe('')
    expect(JSON.stringify(taskToRow({ ...task, start: '2027-01-15' }))).not.toBe(
      JSON.stringify(taskToRow(task)),
    )
  })

  it('omits both timestamps, which is what makes it a FINGERPRINT', () => {
    // `TaskDetail` stringifies this to decide whether an edit session actually changed the row and
    // skips the write when it did not. `updated_at` in here would move on every call, so every Done
    // would cost a round trip. `taskCells` is what a write uses, and it stamps them.
    const row = taskToRow(task)
    expect(row).not.toHaveProperty('created_at')
    expect(row).not.toHaveProperty('updated_at')
    // And every OTHER cell is in it, or a field this omits would read as unchanged for ever: the
    // fingerprint is only honest if it covers the whole row a write sends.
    expect(Object.keys(row).sort()).toEqual(
      TASK_COLUMNS.filter((name) => !['created_at', 'updated_at'].includes(name)).sort(),
    )
  })

  it('refuses a row that cannot be identified or read', () => {
    expect(() => taskToRow({ ...task, id: '' })).toThrow()
    expect(() => taskToRow({ ...task, title: '   ' })).toThrow()
  })

  it('round-trips through rowToTask', () => {
    expect(rowToTask(taskToRow(task))).toMatchObject({
      id: task.id,
      title: task.title,
      due: task.due,
    })
  })
})

describe('validateTask', () => {
  it('passes a task with a title and a date', () => {
    expect(validateTask({ title: 'x', due: '2027-01-01' }, isValidDay)).toEqual([])
  })

  it('requires a due date on a task', () => {
    // EVERY EVENT CARRIES A DAY. Refused rather than defaulted: a defaulted date is an invented
    // one, and an invented date lands straight in the overdue count and the on-schedule mark. So
    // the create sheet still opens BLANK and Save refuses until somebody picks a day.
    expect(validateTask({ title: 'Find a florist', due: '' }, isValidDay)).toEqual(['MISSING_DUE'])
    expect(validateTask({ title: 'Find a florist' }, isValidDay)).toEqual(['MISSING_DUE'])
  })

  it('names a missing title and a missing date together', () => {
    expect(validateTask({ title: '   ', due: '' }, isValidDay)).toEqual([
      'MISSING_TITLE',
      'MISSING_DUE',
    ])
  })

  it('refuses a hand-typed date that is not a date, and does not also call it missing', () => {
    // Reachable only from the spreadsheet — the UI normalises every value — and silently
    // rewriting it to "no date" is the one outcome worse than refusing it. The two codes are
    // exclusive: a field shows one message.
    expect(validateTask({ title: 'x', due: '2027-02-31' }, isValidDay)).toEqual(['BAD_DUE'])
  })

  it('asks nothing of a subtask but a title', () => {
    // A date wheel per checklist item would make entering five in a row unusable on a phone,
    // and then no parent's progress would ever advance. A subtask is a title and a tick, so
    // requiring a date on a TASK deliberately does not reach it.
    expect(validateTask({ title: 'x', parentId: 'p1', due: '' }, isValidDay)).toEqual([])
    expect(validateTask({ title: '', parentId: 'p1' }, isValidDay)).toEqual(['MISSING_TITLE'])
  })
})

describe('predicates', () => {
  it('reads a tombstone and a completion', () => {
    expect(isLive({ deletedAt: '' })).toBe(true)
    expect(isLive({ deletedAt: '2027-01-01T00:00:00.000Z' })).toBe(false)
    expect(isDone({ doneAt: '2027-01-01T00:00:00.000Z' })).toBe(true)
    expect(isDone({ doneAt: '' })).toBe(false)
  })
})

describe('cellText', () => {
  it('trims and never stringifies nullish', () => {
    expect(cellText(' a ')).toBe('a')
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
    expect(cellText(0)).toBe('0')
  })
})
