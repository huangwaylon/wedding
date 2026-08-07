/**
 * The controls row: which state to show, and list or timeline.
 *
 * Filter chips carry their counts, which is what makes them worth the space — "3"
 * next to Overdue is the whole reason somebody taps it. A chip with a count of zero
 * stays visible and disabled rather than disappearing: a row of controls that
 * reshuffles as the board changes is one somebody has to re-read every time.
 */

import { STATE_ORDER } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

export const FILTER_ALL = 'all'

/** `all` plus one per state, in scanning order — problems first. */
export const FILTERS = [FILTER_ALL, ...STATE_ORDER]

export const VIEWS = { LIST: 'list', TIMELINE: 'timeline' }

export default function Controls({ counts, total, filter, onFilter, view, onView }) {
  const { t } = useT()

  return (
    <div className="controls">
      <div className="controls__filters" role="group" aria-label={t('filter.label')}>
        {FILTERS.map((name) => {
          const count = name === FILTER_ALL ? total : (counts[name] ?? 0)
          return (
            <button
              type="button"
              key={name}
              className="chip"
              aria-pressed={filter === name}
              disabled={count === 0 && name !== filter}
              onClick={() => onFilter(name)}
            >
              {name === FILTER_ALL ? t('filter.all') : t(`state.${name}`)}
              <span className="chip__count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="segmented" role="group" aria-label={t('view.label')}>
        <button
          type="button"
          className="segmented__option"
          aria-pressed={view === VIEWS.LIST}
          onClick={() => onView(VIEWS.LIST)}
        >
          {t('view.list')}
        </button>
        <button
          type="button"
          className="segmented__option"
          aria-pressed={view === VIEWS.TIMELINE}
          onClick={() => onView(VIEWS.TIMELINE)}
        >
          {t('view.timeline')}
        </button>
      </div>
    </div>
  )
}
