/**
 * How near a task's due date is, in words, with the row's one spot of colour beside them.
 *
 * IT SAYS THE RELATIVE DISTANCE, NOT THE STATE. "3 days ago" and "in 5 days" are the two
 * questions somebody scanning a checklist actually has, and they carry the state as a
 * side effect: nothing that reads "3 days ago" needs a second pill saying "Overdue". The
 * badge this replaced existed because a percentage of 100 could mean "finished" or "ran
 * out of time"; an unfinished task now reads 0% whatever the calendar says, so the word
 * has nothing left to disambiguate.
 *
 * IT RENDERS NOTHING PAST THE FORTNIGHT, and that is the point. A wedding board runs
 * four hundred days, so a label on every row would be four hundred labels — and presence
 * then becomes a third channel on top of the dot's hue and the words themselves: a row
 * with a mark on it is a row to act on this fortnight. A finished task and an undated one
 * say nothing either; their tick and their empty day column have already said it.
 *
 * The dot takes its fill from the one state table, so no state colour ever touches type —
 * the same rule the meters and the stat tiles follow.
 */

import { STATE } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

/**
 * @param {object} props
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
