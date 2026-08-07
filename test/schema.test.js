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
  TRUE_TEXT,
  cellText,
  isDone,
  isLive,
  parseBool,
  rowToTask,
  taskToRow,
  validateTask,
} from '../src/schema.js'
import { isValidWall } from '../src/lib/time.js'

describe('the Code.gs column contract', () => {
  it('matches src/schema.js exactly, in order', () => {
    const source = readFileSync('apps-script/Code.gs', 'utf8')
    const block = /var TASK_COLUMNS = \[([\s\S]*?)\]/.exec(source)
    expect(block, 'TASK_COLUMNS not found in Code.gs').toBeTruthy()

    const columns = [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
    expect(columns).toEqual(TASK_COLUMNS)
  })

  it('agrees on the tab names', () => {
    const source = readFileSync('apps-script/Code.gs', 'utf8')
    expect(source).toContain("var TASKS_SHEET = 'tasks'")
    expect(source).toContain("var CONFIG_SHEET = 'config'")
  })

  it('still escapes a leading formula character on write', () => {
    // If this helper is ever "tidied" away, a note of "=SUM(A:A)" becomes a live
    // formula in somebody's spreadsheet and the cell no longer holds what they typed.
    const source = readFileSync('apps-script/Code.gs', 'utf8')
    expect(source).toMatch(/\/\^\[=\+\\-@\]\/\.test/)
  })
})

describe('rowToTask', () => {
  it('maps every column and trims', () => {
    const task = rowToTask({
      id: ' abc ',
      title: ' Book the venue ',
      category: 'Venue',
      start: '2027-01-01T00:00',
      end: '2027-02-01T23:59',
      all_day: 'TRUE',
      done_at: '',
      notes: 'call first',
      owner: 'Both',
      created_at: '2026-08-07T00:00:00.000Z',
      updated_at: '2026-08-07T00:00:00.000Z',
      deleted_at: '',
    })
    expect(task).toMatchObject({
      id: 'abc',
      title: 'Book the venue',
      category: 'Venue',
      allDay: true,
      doneAt: '',
      notes: 'call first',
      deletedAt: '',
    })
  })

  it('never yields the string "undefined" for a missing cell', () => {
    const task = rowToTask({ id: 'a', title: 'x' })
    expect(task.notes).toBe('')
    expect(task.category).toBe('')
    expect(task.allDay).toBe(false)
  })

  it('survives a null row', () => {
    expect(rowToTask(null).id).toBe('')
  })
})

describe('parseBool', () => {
  it('is lenient on read', () => {
    // Somebody typing any of these into the cell by hand means the same thing.
    for (const truthy of ['TRUE', 'true', 'True', 'yes', '1', 'x']) {
      expect(parseBool(truthy)).toBe(true)
    }
  })

  it('treats everything else as false', () => {
    for (const falsy of ['', 'FALSE', 'no', '0', null, undefined, 'maybe']) {
      expect(parseBool(falsy)).toBe(false)
    }
  })
})

describe('taskToRow', () => {
  const task = {
    id: 'abc',
    title: 'Book the venue',
    category: 'Venue',
    start: '2027-01-01T00:00',
    end: '2027-02-01T23:59',
    allDay: true,
    doneAt: '',
    notes: '',
    owner: '',
    deletedAt: '',
  }

  it('writes exactly one spelling of true', () => {
    expect(taskToRow(task).all_day).toBe(TRUE_TEXT)
    expect(taskToRow({ ...task, allDay: false }).all_day).toBe('')
  })

  it('sends every value as a string', () => {
    for (const value of Object.values(taskToRow(task))) {
      expect(typeof value).toBe('string')
    }
  })

  it('omits the timestamps the script owns', () => {
    // A device with a wrong clock must not be able to backdate a row, and created_at
    // on an update comes from the existing row rather than from the client.
    const row = taskToRow(task)
    expect(row).not.toHaveProperty('created_at')
    expect(row).not.toHaveProperty('updated_at')
  })

  it('refuses a row that cannot be identified or read', () => {
    expect(() => taskToRow({ ...task, id: '' })).toThrow()
    expect(() => taskToRow({ ...task, title: '   ' })).toThrow()
  })

  it('round-trips through rowToTask', () => {
    expect(rowToTask(taskToRow(task))).toMatchObject({
      id: task.id,
      title: task.title,
      start: task.start,
      end: task.end,
      allDay: true,
    })
  })
})

describe('validateTask', () => {
  const ok = { title: 'x', start: '2027-01-01T00:00', end: '2027-02-01T00:00' }

  it('passes a usable task', () => {
    expect(validateTask(ok, isValidWall)).toEqual([])
  })

  it('names what is missing', () => {
    expect(validateTask({ title: '', start: '', end: '' }, isValidWall)).toEqual([
      'MISSING_TITLE',
      'MISSING_START',
      'MISSING_END',
    ])
  })

  it('separates missing from unparseable', () => {
    expect(validateTask({ ...ok, start: '2027-02-31T00:00' }, isValidWall)).toEqual(['BAD_START'])
  })

  it('catches a reversed window', () => {
    expect(
      validateTask({ ...ok, start: '2027-03-01T00:00', end: '2027-01-01T00:00' }, isValidWall),
    ).toEqual(['END_BEFORE_START'])
  })

  it('allows a zero-length window, which is a milestone', () => {
    expect(
      validateTask(
        { ...ok, start: '2027-04-18T14:00', end: '2027-04-18T14:00' },
        isValidWall,
      ),
    ).toEqual([])
  })

  it('does not claim a reversed window when one end is already unreadable', () => {
    // Reporting both would put two errors under one field for one mistake.
    expect(validateTask({ ...ok, start: 'nope' }, isValidWall)).toEqual(['BAD_START'])
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
