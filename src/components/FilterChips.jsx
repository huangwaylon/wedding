/**
 * The filter row: which state to show. The chips carry their counts, which is what makes them worth
 * the space. A chip with a count of zero stays visible and disabled rather than disappearing, a row
 * of controls that reshuffles having to be re-read every time. The overdue count is the one that is
 * not `--ink-3` (`.chip__count--alert`) and is withheld at zero, so a clean board carries no red 0.
 */

import { STATE, STATE_ORDER } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

export const FILTER_ALL = 'all'

/** `all` plus one per state, in scanning order — problems first. */
const FILTERS = [FILTER_ALL, ...STATE_ORDER]

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
