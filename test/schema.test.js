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

  it('keeps parent_id last, because appending is the only safe change', () => {
    // Appending cannot shift an existing column's index, and every range in `schema.js` is
    // derived from the list's length, so an append widens all of them at once.
    expect(TASK_COLUMNS[TASK_COLUMNS.length - 1]).toBe('parent_id')
  })

  it('carries only the nine columns a task has', () => {
    // A task is a title, a day and a tick. None of these may come back. `notes` here means a MEMO
    // PER TASK — a field that would cost a control on a 393px screen and a column to understand; the
    // shared notes document is one cell in the config tab and nothing to do with a row.
    for (const gone of ['start', 'end', 'all_day', 'notes', 'owner']) {
      expect(TASK_COLUMNS).not.toContain(gone)
    }
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
    })
    expect(task).toEqual({
      id: 'abc',
      title: 'Book the venue',
      category: 'Venue',
      due: '2027-02-01',
      doneAt: '',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      deletedAt: '',
      parentId: '',
    })
  })

  it('reads the day from `due` and from nowhere else', () => {
    // One column carries the date. A key the layout does not contain is not a fallback.
    expect(rowToTask({ id: 'a', title: 'x', due: '2027-03-09' }).due).toBe('2027-03-09')
    expect(rowToTask({ id: 'a', title: 'x', end: '2027-02-01' }).due).toBe('')
  })

  it('never yields the string "undefined" for a missing cell', () => {
    const task = rowToTask({ id: 'a', title: 'x' })
    expect(task.due).toBe('')
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

  it('omits both timestamps, which is what makes it a FINGERPRINT', () => {
    // `TaskDetail` stringifies this to decide whether an edit session actually changed the row and
    // skips the write when it did not. `updated_at` in here would move on every call, so every Done
    // would cost a round trip. `taskCells` is what a write uses, and it stamps them.
    const row = taskToRow(task)
    expect(row).not.toHaveProperty('created_at')
    expect(row).not.toHaveProperty('updated_at')
    expect(JSON.stringify(taskToRow(task))).toBe(JSON.stringify(taskToRow({ ...task })))
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
