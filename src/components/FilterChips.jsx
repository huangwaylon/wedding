/**
 * The filter row: which state to show. The chips carry their counts, which is what makes them worth
 * the space. A chip with a count of zero stays visible and disabled rather than disappearing, a row
 * of controls that reshuffles having to be re-read every time. The overdue count is the one that is
 * not `--ink-3` (`.chip__count--alert`) and is withheld at zero, so a clean board carries no red 0.
 *
 * Every count is over the WHOLE board, never over what is drawn: the Done chip's figure is how many
 * are finished, and a device withholding finished rows has not finished fewer of them.
 */

import { STATE, STATE_ORDER } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

export const FILTER_ALL = 'all'

/** `all` plus one per state, in scanning order — problems first. */
const FILTERS = [FILTER_ALL, ...STATE_ORDER]

/**
 * Which rows the plan draws, as a pure function of the two things that narrow it: the state slice
 * these chips choose, and whether the device is withholding what is finished. It lives here because
 * the chips are what a filter MEANS, and it is exported because every way it can be wrong is
 * invisible to a render — `test/render.test.jsx` is the only place they are pinned.
 *
 * Finished rows are withheld from every slice but the one that asks for them BY NAME: the Done chip
 * is an explicit request, and answering it with an empty list reads as a lost board.
 *
 * `ticked` is the rows ticked since the slice was chosen. They stay put whatever they became: ticking
 * raises no toast, so a row that also left the list would give no feedback at all for the app's most
 * frequent gesture.
 */
export function visibleTasks(tasks, { filter = FILTER_ALL, showDone = false, ticked } = {}) {
  const held = (task) => Boolean(ticked?.has(task.id))
  const sliced =
    filter === FILTER_ALL
      ? tasks
      : tasks.filter((task) => task.progress.state === filter || held(task))
  if (showDone || filter === STATE.DONE) return sliced
  return sliced.filter((task) => task.progress.state !== STATE.DONE || held(task))
}

/**
 * @param {object} props.counts `overallProgress`'s result: one count per state, plus the `total`
 *   the All chip carries — taking it as a second prop would be the same number twice.
 */
export default function FilterChips({ counts, filter, onFilter }) {
  const { t } = useT()

  return (
    <div className="chips" role="group" aria-label={t('filter.label')}>
      {FILTERS.map((name) => {
        const count = name === FILTER_ALL ? counts.total : (counts[name] ?? 0)
        return (
          <button
            type="button"
            key={name}
            className="chip"
            aria-pressed={filter === name}
            /* Never the chip that is on: disabling the active filter strands the board. */
            disabled={count === 0 && name !== filter}
            onClick={() => onFilter(name)}
          >
            {name === FILTER_ALL ? t('filter.all') : t(`state.${name}`)}
            <span
              className={`chip__count tnum${name === STATE.OVERDUE ? ' chip__count--alert' : ''}${
                count === 0 ? ' chip__count--empty' : ''
              }`}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
