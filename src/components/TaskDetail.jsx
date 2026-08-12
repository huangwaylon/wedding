/**
 * What is behind an open row: the facts, the checklist, and — only once somebody asks for it —
 * the fields.
 *
 * OPENING A ROW REVEALS IT. IT DOES NOT ARM IT. Tapping a row is how you read a task and tick
 * its checklist, and those are the two things done a hundred times a week; changing its title or
 * its date is done once. An earlier version put live fields behind every tap, which meant the
 * common gesture landed a caret in a text input and a stray tap could retitle a task with no
 * confirmation anywhere — the whole editor commits on blur. The Edit toggle is the confirmation,
 * and it costs one tap on the rare path to protect the frequent one.
 *
 * READ MODE holds the due date spelled out — the one fact the collapsed row abbreviates to a bare
 * day number, and the only place the weekday appears, which is a real question about a wedding
 * task — plus the checklist, tickable. EDIT MODE swaps the facts for the three fields and adds the
 * delete. The checklist is in both, because ticking an item is doing the work rather than editing
 * the task — and so is adding one. What the toggle takes with it is every DESTRUCTIVE control: the
 * task's own delete, and the per-item trash icons, which otherwise sat three-deep under an
 * ordinary tap.
 *
 * THE MODE LIVES HERE, NOT IN `TaskCard`, and that is what makes closing a row reset it. This
 * component only exists while the row is open, so the state goes with it — no effect to
 * synchronise, and a static render sees read mode, which is the correct default on its own.
 *
 * `editing` is the INITIAL mode, and it is a prop for exactly one reason: a static render fires
 * no click, so without it neither the test suite nor the screenshot harness could ever see the
 * fields. Same reasoning as `expanded` on `TaskCard`. Nothing in the app passes it.
 */

import { useState } from 'react'
import { formatDayLong } from '../lib/time.js'
import { useT } from '../i18n/index.js'
import SubtaskList from './SubtaskList.jsx'
import TaskEditor from './TaskEditor.jsx'
import { PencilIcon } from './icons.jsx'

export default function TaskDetail({
  task,
  canEdit,
  categories,
  onToggle,
  onDelete,
  onSave,
  canAddSubtask,
  onAddSubtask,
  onFieldFocus,
  editing: initiallyEditing = false,
}) {
  const { t, locale } = useT()
  const [editing, setEditing] = useState(initiallyEditing)
  const subtasks = task.subtasks ?? []

  return (
    <>
      {editing ? (
        <TaskEditor
          task={task}
          categories={categories}
          onSave={onSave}
          onFieldFocus={onFieldFocus}
        />
      ) : (
        <p className="tcard__fact">
          <span className="tcard__factLabel">{t('form.due')}</span>{' '}
          {/* The space is for a SCREEN READER, not for layout: a flex container drops a
              whitespace-only box, but without it the two run together in the accessibility
              tree and "Due" and "Wed" are read as one word. */}
          <span>{task.progress.dated ? formatDayLong(task.due, { locale }) : t('state.nodate')}</span>
        </p>
      )}

      {/* In BOTH modes. `promoted` is what withholds the add field: a row the read could not
          place is drawn as a task, but a child of it would be a grandchild and the next read
          would promote that one too — so offering the field would invite somebody to type a
          checklist that walks out of the row. */}
      {canEdit || subtasks.length > 0 ? (
        <SubtaskList
          subtasks={subtasks}
          canEdit={canEdit}
          canAdd={canAddSubtask && !task.promoted}
          canRemove={editing}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={(title) => onAddSubtask(task, title)}
          onFocusChange={onFieldFocus}
        />
      ) : null}

      {canEdit ? (
        <div className="tcard__foot">
          {/* Delete is offered in edit mode ALONE, and it deletes nothing: it opens the confirm
              sheet. Two destructive-adjacent controls on the read path is one too many. */}
          {editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--danger-quiet"
              onClick={() => onDelete(task)}
            >
              {t('form.deleteThis')}
            </button>
          ) : null}

          {/* `aria-pressed` rather than two labels for one control: the word changes too, but a
              screen reader is told this is a toggle and which way it is set. */}
          <button
            type="button"
            className="btn btn--secondary btn--sm tcard__edit"
            aria-pressed={editing}
            onClick={() => setEditing((was) => !was)}
          >
            {editing ? t('common.editDone') : <PencilIcon style={{ width: '1em', height: '1em' }} />}
            {editing ? null : t('common.edit')}
          </button>
        </div>
      ) : null}
    </>
  )
}
