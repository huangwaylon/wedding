/**
 * One task, as a row that opens in place. Behind the head is `TaskDetail`, which opens read-only.
 *
 * The head is one target and the check is not part of it: a `<button>` admits no interactive
 * descendant, so a control inside the head is dropped by the parser. The check is a sibling with
 * its own 44px target, which is also why it LEADS — the head cannot be split around it.
 *
 * THE DATE IS ONE COLUMN, month over day, on every dated row and wherever the row is drawn. It does
 * not depend on the heading above it — the two lifted sections name a state rather than a month, so
 * a heading-shaped rule left the rows that matter most as a bare number needing a caption on the
 * meta line, and the same date then read two ways on one screen. The only thing the column omits is
 * the year, which is 67px of a 2rem box in Japanese; it goes on the meta line, and only on the rows
 * nothing else on screen gives one to.
 *
 * The date is never coloured: a column a third of whose entries are red stops being a column. State
 * lives in exactly one mark — the dot beside `DueLabel`'s words — plus the tick and the
 * strikethrough on a finished task, so nothing here has colour as its only channel. The `3/5` tally
 * a checklist contributes is never coloured either: `5/5` in the done colour would claim a `done_at`
 * the sheet does not have.
 */

import { STATE } from '../lib/progress.js'
import { dayOfMonth, formatDay, formatMonth, monthOf, yearOf } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import DueLabel from './DueLabel.jsx'
import TaskDetail from './TaskDetail.jsx'
import { CategoryIcon, ChevronRightIcon } from './icons.jsx'

export default function TaskCard({
  task,
  canEdit,
  open,
  onOpen,
  onToggle,
  onDelete,
  onSave,
  onAddSubtask,
  onFieldFocus,
  categories,
  /**
   * The board's day, 'YYYY-MM-DD', and the month the heading above this row names — '' or `null`
   * where it names none. Together they answer ONE question: whether this row has to state its YEAR,
   * which it does only where nothing else on screen can. A calendar heading says "April 2027" over
   * rows that are all April 2027's, and inside the current year a date needs no year at all — so
   * four digits are worth printing on exactly the rows a section lifted out of another year. Absent
   * — a static render, a caller with no clock — nothing is stated: silence is recoverable, an
   * invented year is not.
   */
  today = '',
  headingMonth = null,
  /** The open row's INITIAL mode. A harness prop; see `TaskDetail`. */
  editing,
}) {
  const { t, locale } = useT()
  const categoryLabel = useCategoryLabel()
  const { state, days, dated, tally } = task.progress
  const done = state === STATE.DONE
  const subtasks = task.subtasks ?? []
  const contentId = `tcard-${task.id}`

  /** There is something behind the head only if a checklist exists or an editor can open one: a
      viewer's row with no items is a plain line of text, and `aria-expanded` on it would promise a
      disclosure that never comes. */
  const expandable = canEdit || subtasks.length > 0

  /** The row IN WORDS, and the one place the date is spelled out in full with its year: the visible
      row splits it across a column and a meta line, and none of that reaches a screen reader as a
      date. The state is a word here too, so the dot's hue is never the only channel. */
  const when = dated ? formatDay(task.due, { locale, year: true }) : t('state.nodate')
  const label = tally
    ? t('plan.cardLabelSubs', {
        title: task.title,
        when,
        state: t(`state.${state}`),
        subs: t('list.subtasks', { count: tally.total, done: tally.done }),
      })
    : t('plan.cardLabel', { title: task.title, when, state: t(`state.${state}`) })

  /**
   * The year, stated only where the reader has it from nowhere else: not from the heading, which
   * names one for every row the calendar still holds, and not from the year they are living in. Both
   * clauses are one idea — print the year nothing else can supply — and `Boolean(headingMonth)`
   * covers '' and null alike, a heading naming no month telling a row nothing either way.
   */
  const headingNamesThisMonth = Boolean(headingMonth) && headingMonth === monthOf(task.due)
  const boardYear = yearOf(today)
  const statesYear =
    dated && !headingNamesThisMonth && boardYear !== null && yearOf(task.due) !== boardYear

  /* Nothing at all on a row months out with no checklist and no category — but a row lifted out of
     another year always has that to state. */
  const hasMeta =
    statesYear || state === STATE.OVERDUE || state === STATE.SOON || tally || task.category

  return (
    <article
      className={`tcard${open ? ' tcard--open' : ''}${done ? ' tcard--done' : ''}${
        task.pending ? ' tcard--pending' : ''
      }`}
    >
      <DoneToggle
        done={done}
        title={task.title}
        canEdit={canEdit}
        onToggle={() => onToggle(task)}
        className="tcard__check"
      />

      <button
        type="button"
        className="tcard__head"
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? contentId : undefined}
        aria-label={label}
        onClick={() => onOpen(task.id)}
      >
        {/* Month over day, one box, so every title in a group starts in the same column and a date
            reads the same way in a section as under a month heading. A plain `<span>` and not a
            `<time>`: the head's `aria-label` spells the date out in full for the one reader who
            cannot see this, and an element that is only sometimes a `<time>` — an undated row holds
            a dash — is two shapes for the one thing this column exists to make consistent. The dash
            keeps the box occupied, with no month line above it: there is no month to print, and an
            empty line would push the dash out of the column it shares with every other day. */}
        <span className="tcard__date">
          {dated ? (
            <span className="tcard__month">{formatMonth(task.due, { locale })}</span>
          ) : null}
          <span className="tcard__day tnum">
            {dated ? dayOfMonth(task.due) : t('common.dash')}
          </span>
        </span>

        <span className="tcard__body">
          <span className="tcard__title">{task.title}</span>
          {hasMeta ? (
            <span className="tcard__meta">
              {/* The year, leading the line: the column beside it has the month and the day, so this
                  is the missing third of the date rather than a second copy of any of it. It renders
                  where nothing above the row supplies it — a section lifted this row out of another
                  year — which is what keeps four digits off four hundred rows. */}
              {statesYear ? (
                <span className="tcard__year">
                  {/* A STRING, not the number: `interpolate` runs a number through
                      `Intl.NumberFormat`, which groups it — the year would read '2,026'. */}
                  {t('plan.rowYear', { year: String(yearOf(task.due)) })}
                </span>
              ) : null}
              <DueLabel state={state} days={days} />
              {tally ? (
                <span className="tcard__tally tnum">
                  {tally.done}/{tally.total}
                </span>
              ) : null}
              {task.category ? (
                /* The glyph LEADS the word, it does not replace it: fourteen shapes is more
                   vocabulary than anybody learns cold, and an English and a Japanese reader do not
                   learn the same ones. A known category only — an invented one prints as typed,
                   with no glyph. */
                <span className="chip chip--static">
                  <CategoryIcon name={task.category} className="chip__icon" />
                  {categoryLabel(task.category)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        {expandable ? <ChevronRightIcon className="tcard__chev" /> : null}
      </button>

      {/* Only when open, and only when there is something to open: fifty rows of fields and
          checklists behind closed heads is fifty times the DOM for one row. Unmounting is also what
          resets `TaskDetail`'s read/edit mode. A static render runs no effect, so `open` has to be
          correct on its own. */}
      {open && expandable ? (
        <div className="tcard__content" id={contentId}>
          <TaskDetail
            task={task}
            canEdit={canEdit}
            categories={categories}
            onToggle={onToggle}
            onDelete={onDelete}
            onSave={onSave}
            onAddSubtask={onAddSubtask}
            onFieldFocus={onFieldFocus}
            editing={editing}
          />
        </div>
      ) : null}
    </article>
  )
}
