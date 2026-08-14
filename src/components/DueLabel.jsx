/**
 * The only place a date's nearness is worded, with the row's one spot of colour beside it. It says
 * the relative distance, not the state: "3 days ago" carries the state as a side effect and needs
 * no second pill saying "Overdue".
 *
 * It renders nothing past the fortnight. A board runs four hundred days, so a label on every row
 * would be four hundred labels, and presence is then a third channel on top of the dot's hue and
 * the words: a row with a mark is a row to act on this fortnight. A finished or undated task says
 * nothing either. The dot takes its fill from the one `.dot--*` table, so no state colour touches
 * type.
 */

import { STATE } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

/**
 * @param {string} props.state one of `STATE`
 * @param {number|null} props.days signed calendar days until the due date
 */
export default function DueLabel({ state, days }) {
  const { t } = useT()
  if (days == null) return null

  let key = ''
  if (state === STATE.OVERDUE) key = 'due.ago'
  else if (state === STATE.SOON) key = days === 0 ? 'due.today' : days === 1 ? 'due.tomorrow' : 'due.in'
  if (!key) return null

  return (
    <span className="due">
      <span className={`dot dot--${state}`} aria-hidden="true" />
      {t(key, { count: Math.abs(days) })}
    </span>
  )
}
