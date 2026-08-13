/**
 * The filter row: which state to show.
 *
 * The chips carry their counts, which is what makes them worth the space — "3" next to
 * Overdue is the whole reason somebody taps it. A chip with a count of zero stays visible
 * and disabled rather than disappearing: a row of controls that reshuffles as the board
 * changes is one somebody has to re-read every time.
 */

import { STATE, STATE_ORDER } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

export const FILTER_ALL = 'all'

/** `all` plus one per state, in scanning order — problems first. */
const FILTERS = [FILTER_ALL, ...STATE_ORDER]

export default function FilterChips({ counts, total, filter, onFilter }) {
  const { t } = useT()

  return (
    <div className="chips" role="group" aria-label={t('filter.label')}>
      {FILTERS.map((name) => {
        const count = name === FILTER_ALL ? total : (counts[name] ?? 0)
        return (
          <button
            type="button"
            key={name}
            className="chip"
            aria-pressed={filter === name}
            /* Never the chip that is currently on: disabling the active filter would strand
               the board on a slice with no way back to it. */
            disabled={count === 0 && name !== filter}
            onClick={() => onFilter(name)}
          >
            {name === FILTER_ALL ? t('filter.all') : t(`state.${name}`)}
            <span
              className={`chip__count${name === STATE.OVERDUE ? ' chip__count--alert' : ''}${
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
