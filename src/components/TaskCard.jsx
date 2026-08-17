/**
 * One task, as a row that opens in place. Behind the head is `TaskDetail`, which opens read-only.
 *
 * The head is one target and the check is not part of it: a `<button>` admits no interactive
 * descendant, so a control inside the head is dropped by the parser. The check is a sibling with
 * its own 44px target, which is also why it LEADS — the head cannot be split around it.
 *
 * The day is a column and is never coloured: a column a third of whose entries are red stops being
 * a column. State lives in exactly one mark — the dot beside `DueLabel`'s words — plus the tick and
 * the strikethrough on a finished task, so nothing here has colour as its only channel. The `3/5`
 * tally a checklist contributes is never coloured either: `5/5` in the done colour would claim a
 * `done_at` the sheet does not have.
 */

import { STATE } from '../lib/progress.js'
import { dayOfMonth, formatDay, formatMonthYear, monthOf } from '../lib/time.js'
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
   * The month the heading above this row names, `''` where it names none (a section, the undated
   * group) and `null` where there is no heading at all — a static render, or a caller with no groups.
   * It decides whether this row states its own date and HOW, which is three cases and not two:
   *
   *   the heading names this month     nothing: the day number plus the heading is the date
   *   the heading names no month       the bare month and year, the other half of the date
   *   the heading names ANOTHER month  the same, behind the DUE label — this is the only case a
   *                                    reader can be actively misled by, a big `10` under
   *                                    "This month · August 2026" reading as the 10th of August
   *                                    when the row is due in December
   */
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

  /**
   */
  const expandable = canEdit || subtasks.length > 0

  /**
   */
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
   * Whether this row states its own month, and whether it has to say that the month is its DEADLINE.
   * Both fall out of one comparison, so a month group can never start restating its own month and the
   * label can only appear where a heading actually contradicts the row.
   */
  const ownMonth = dated && headingMonth !== null && headingMonth !== monthOf(task.due)
  const dueElsewhere = ownMonth && Boolean(headingMonth)

  /* Nothing at all on a row months out with no checklist and no category — but a row stating its own
     month always has that to state. */
  const hasMeta =
    ownMonth || state === STATE.OVERDUE || state === STATE.SOON || tally || task.category

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
        {/* The dash keeps the slot occupied, so titles down a month stay in one column. */}
        <span className="tcard__day tnum">
          {dated ? dayOfMonth(task.due) : t('common.dash')}
        </span>

        <span className="tcard__body">
          <span className="tcard__title">{task.title}</span>
          {hasMeta ? (
            <span className="tcard__meta">
              {/* The month and year the heading above does not name. It leads the line, being the
                  calendar fact the sticky heading carries everywhere else, and it is the day column's
                  other half rather than a second copy of it: `20` up there, `Sep 2026` here. A tile
                  stacking both in the column instead needed 5rem for `2026年10月` and wrapped every
                  title in the two sections that matter most. Under a heading naming a DIFFERENT month
                  it says which date it is: nothing else on the row can, and the label is also the
                  answer to why the row is in that section at all. */}
              {ownMonth ? (
                <span className="tcard__month">
                  {dueElsewhere
                    ? t('plan.dueMonth', { month: formatMonthYear(task.due, { locale }) })
                    : formatMonthYear(task.due, { locale })}
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
