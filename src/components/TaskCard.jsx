/**
 * One task, as a card on the plan's spine: a collapsed row that opens in place.
 *
 * THE HEAD IS ONE TARGET, and the check is not part of it. A `<button>`'s content model is
 * phrasing content with no interactive descendant, so a control inside the head is a button
 * inside a button and the parser drops it — the same failure as a nested `<form>`. The check
 * is therefore a sibling with its own 44px target, and everything else in the collapsed row
 * — node, date, title, meter, tally, chevron — belongs to the head, which makes the whole
 * ~300px row the disclosure. Two targets on a row, not five.
 *
 * STATE IS READ FROM THREE PLACES AND ONLY ONE OF THEM IS COLOUR. The node carries the hue,
 * the percentage carries the amount, and the date chip says when the window was — so a
 * viewer who cannot separate the red from the green loses nothing. Overdue is the single
 * state that also gets a word, because it is the one whose figure reads as its own opposite:
 * an expired unfinished window is 100% and nowhere near finished. `StateBadge` says why.
 *
 * A SUBTASK IS NEVER A BAR HERE EITHER. It has a title and a tick and no dates, so it has
 * neither a position nor an extent to draw; what a checklist contributes is the parent's
 * `3/5` tally beside the fill, which is what tells the reader that fill is a COUNT rather
 * than a clock reading. The tally is never coloured: `5/5` in the done colour would claim a
 * `done_at` the sheet does not have.
 */

import { STATE, toPercent } from '../lib/progress.js'
import { formatWallChip, formatWallRange } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import DoneToggle from './DoneToggle.jsx'
import Meter from './Meter.jsx'
import StateBadge from './StateBadge.jsx'
import SubtaskList from './SubtaskList.jsx'
import TaskEditor from './TaskEditor.jsx'
import { ChevronRightIcon } from './icons.jsx'

export default function TaskCard({
  task,
  nowWall,
  canEdit,
  open,
  onOpen,
  onToggle,
  onDelete,
  onSave,
  canAddSubtask,
  onAddSubtask,
  onFieldFocus,
  categories,
}) {
  const { t, locale } = useT()
  const categoryLabel = useCategoryLabel()
  const { state, percent, timePercent, tally } = task.progress
  const done = state === STATE.DONE
  const shown = toPercent(percent)
  const subtasks = task.subtasks ?? []
  const contentId = `tcard-${task.id}`

  const scheduled = state !== STATE.UNSCHEDULED
  /**
   * What an open card would actually hold. A viewer's card with no owner, no notes and no
   * checklist has NOTHING to reveal, and it used to open a padded empty box — which is the
   * default state of every task on a freshly seeded board, so for a planner it was the normal
   * case. A card with nothing behind it does not claim to be a disclosure at all.
   */
  const showEditor = canEdit
  const showChecklist = canEdit || subtasks.length > 0
  const showFacts = Boolean(task.owner || task.notes)
  const expandable = showEditor || showChecklist || showFacts
  const when = scheduled
    ? formatWallRange(task.start, task.end, {
        allDay: task.allDay,
        locale,
        nowWall,
        dash: t('common.dash'),
      })
    : t('list.unscheduled')
  /**
   * `null` for a task with no window, and the chip then prints a dash. Inventing the
   * created-on date, or today, would put a date on the card that is nowhere in the sheet —
   * and the slot stays occupied so the titles down a month stay in one column.
   */
  const chip = scheduled ? formatWallChip(task.start, { locale }) : null

  const label = tally
    ? t('plan.cardLabelSubs', {
        title: task.title,
        when,
        percent: shown,
        state: t(`state.${state}`),
        subs: t('list.subtasks', { count: tally.total, done: tally.done }),
      })
    : t('plan.cardLabel', {
        title: task.title,
        when,
        percent: shown,
        state: t(`state.${state}`),
      })

  return (
    <article
      className={`tcard${open ? ' tcard--open' : ''}${done ? ' tcard--done' : ''}${
        state === STATE.OVERDUE ? ' tcard--overdue' : ''
      }${task.pending ? ' tcard--pending' : ''}`}
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
        /* The whole row's name, and it states the state in WORDS: the node's colour is a
           second channel, never the only one, and a `title` tooltip does not exist on touch. */
        aria-label={label}
        onClick={() => onOpen(task.id)}
      >
        {/* On the spine, and the one mark on the card that carries the state's hue. */}
        <span className={`dot dot--${state} tcard__node`} aria-hidden="true" />

        <span className="tcard__date">
          <span className="tcard__day tnum">{chip ? chip.day : t('common.dash')}</span>
          {chip ? <span className="tcard__mon">{chip.month}</span> : null}
        </span>

        <span className="tcard__body">
          <span className="tcard__title">{task.title}</span>
          <span className="tcard__meta">
            <StateBadge state={state} />
            <span className="tnum">{when}</span>
            {task.category ? (
              <span className="chip chip--static">{categoryLabel(task.category)}</span>
            ) : null}
          </span>
          {/* The percentage is TEXT beside the bar, never a label on it: at 13px it does not
              fit inside an 8px fill, and a label that will not fit moves outside the mark
              rather than being clipped. */}
          <span className="tcard__bar">
            <Meter
              tag="span"
              value={percent}
              /* Only for a parent with a checklist, and it is the honest pair: the fill is
                 work counted, the tick is where the clock has got to. Without a tally the two
                 are the same number by construction — `percent` IS `timePercent` — so a mark
                 would be a tick drawn on top of the fill's own end, every row, meaning
                 nothing. */
              mark={tally ? timePercent : undefined}
              state={state}
              label={task.title}
              valueText={t('list.percentLabel', { percent: shown })}
            />
            <span className="tcard__percent tnum">{shown}%</span>
          </span>
        </span>

        {tally ? (
          <span className="tcard__tally tnum" aria-hidden="true">
            {tally.done}/{tally.total}
          </span>
        ) : null}

        {/* No chevron on a card that cannot open — a disclosure affordance on a row with nothing
            behind it is a promise the tap does not keep. */}
        {expandable ? <ChevronRightIcon className="tcard__chev" /> : null}
      </button>

      {/* Only when open, and only when there is something to open. Fifty cards' worth of fields
          and checklists mounted behind a closed head is fifty times the DOM for one row anybody
          is looking at — and a static render runs no effect, so `open` has to be correct on its
          own. */}
      {open && expandable ? (
        <div className="tcard__content" id={contentId}>
          {showEditor ? (
            <TaskEditor
              task={task}
              categories={categories}
              onSave={onSave}
              onDelete={onDelete}
              onFieldFocus={onFieldFocus}
            />
          ) : (
            /* A viewer gets the same facts and not one field: owner and notes, which the
               collapsed row has no room for, and never a control that would refuse them. */
            <>
              {task.owner ? (
                <p className="tcard__meta">
                  <span className="chip chip--static">{task.owner}</span>
                </p>
              ) : null}
              {task.notes ? <p className="caption">{task.notes}</p> : null}
            </>
          )}

          {/* Withheld from a viewer with nothing to show, rather than an empty rail: an editor
              always gets it, because the add field is now the only way in.

              `promoted` is what withholds the ADD field: a row the read could not place is
              drawn as a task, but a child of it would be a grandchild and the next read would
              promote that one too — so offering the field would invite somebody to type a
              checklist that walks out of the card. Its existing items still tick and delete. */}
          {showChecklist ? (
            <SubtaskList
              subtasks={subtasks}
              canEdit={canEdit}
              canAdd={canAddSubtask && !task.promoted}
              onToggle={onToggle}
              onDelete={onDelete}
              onAdd={(title) => onAddSubtask(task, title)}
              onFocusChange={onFieldFocus}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
