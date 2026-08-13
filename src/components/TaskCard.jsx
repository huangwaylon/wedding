/**
 * One task, as a row that opens in place.
 *
 * THE HEAD IS ONE TARGET, and the check is not part of it. A `<button>`'s content model is
 * phrasing content with no interactive descendant, so a control inside the head is a button
 * inside a button and the parser drops it — the same failure as a nested `<form>`. The check
 * is therefore a sibling with its own 44px target, which is also why it LEADS: the head
 * cannot be split around it. Two targets on a row, and everything else — day, title, meta,
 * chevron — belongs to the disclosure.
 *
 * THE DAY IS A COLUMN AND IS NEVER COLOURED. Its job is to line up and be scanned, and a
 * column a third of whose entries are red stops being a column. State lives in exactly one
 * mark on the row — the dot beside `DueLabel`'s words — plus the tick and the strikethrough
 * on a finished task. Nothing here has colour as its only channel.
 *
 * THE MONTH IS NOT ON THE CARD. `Plan` groups on the same slice the day comes from, so a month
 * printed here would restate the sticky heading directly above it on every row in the app.
 *
 * TAPPING THE ROW REVEALS IT, IT DOES NOT ARM IT. What is behind the head is `TaskDetail`,
 * which opens read-only and holds an Edit toggle; see its header for why.
 *
 * A SUBTASK IS NEVER A ROW HERE. It has a title and a tick and no date, so it has neither a
 * position nor an extent; what a checklist contributes is the parent's `3/5` tally on the meta
 * line. The tally is never coloured: `5/5` in the done colour would claim a `done_at` the sheet
 * does not have.
 */

import { STATE } from '../lib/progress.js'
import { dayOfMonth, formatDay } from '../lib/time.js'
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
   * What an open card would hold. A viewer's card with no checklist has NOTHING to reveal — the
   * normal case for a planner on a freshly seeded board — and a card with nothing behind it must
   * not claim to be a disclosure: no chevron, and the tap does not pretend to open anything.
   */
  const expandable = canEdit || subtasks.length > 0

  /**
   * The row's accessible name, and the one place the ABSOLUTE date is spelled out with its
   * year. The visible row leans on a two-digit day plus the sticky month heading above it;
   * neither of those reaches a screen reader, so this cannot lean on them either.
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

  // Nothing at all on a row whose date is months out and which carries no checklist or
  // category, which is most of a freshly seeded board.
  const hasMeta = state === STATE.OVERDUE || state === STATE.SOON || tally || task.category

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
        {/* The dash keeps the slot occupied, so the titles down a month stay in one column
            rather than jumping left on the one task nobody dated. */}
        <span className="tcard__day tnum">
          {dated ? dayOfMonth(task.due) : t('common.dash')}
        </span>

        <span className="tcard__body">
          <span className="tcard__title">{task.title}</span>
          {hasMeta ? (
            <span className="tcard__meta">
              <DueLabel state={state} days={days} />
              {tally ? (
                <span className="tcard__tally tnum">
                  {tally.done}/{tally.total}
                </span>
              ) : null}
              {task.category ? (
                /* The glyph LEADS THE WORD, it does not replace it. Fourteen categories is more
                   than a shape vocabulary anybody learns cold, and a Japanese and an English
                   reader do not learn the same ones — so the word stays and the glyph is what
                   makes the chip findable on the second reading. A known category only: an
                   invented one prints as typed, with no glyph. */
                <span className="chip chip--static">
                  <CategoryIcon name={task.category} className="chip__icon" />
                  {categoryLabel(task.category)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        {/* No chevron on a card that cannot open — a disclosure affordance on a row with
            nothing behind it is a promise the tap does not keep. */}
        {expandable ? <ChevronRightIcon className="tcard__chev" /> : null}
      </button>

      {/* Only when open, and only when there is something to open. Fifty rows' worth of facts,
          fields and checklists mounted behind a closed head is fifty times the DOM for the one
          row anybody is looking at — and unmounting is also what resets `TaskDetail`'s read/edit
          mode when a row closes, with no effect to synchronise. A static render runs no effect,
          so `open` has to be correct on its own. */}
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
