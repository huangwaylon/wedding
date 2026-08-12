/**
 * The tracker: one hero figure, the count behind it, one meter with an on-schedule mark,
 * and — only when there is one — the one thing worth acting on.
 *
 * NO HEADING, NO LEGEND, NO METHOD NOTE. The number is 44px tall and the count is written
 * directly beneath it, so a title saying "Overall progress" only names what is already
 * unmistakable. That label survives as the section's accessible name, where it is the only
 * thing that has to say what this is.
 *
 * "9 of 14 done" RATHER THAN A VERDICT. This replaced a sentence that said "On schedule",
 * "3% ahead" or "Behind: 2 tasks are past their date" — and the sentence could be wrong: two
 * tasks late plus two future tasks finished early sums to a pace of exactly zero. A count
 * cannot be wrong, it makes the percentage above it checkable by arithmetic, and it is four
 * words in either language.
 *
 * THE MARK IS THE PACE SIGNAL AND IT COSTS NO WORDS. It sits where the fill would be if
 * everything had been finished on its date, so ahead of it is ahead of schedule. That is a
 * comparison a graphic makes better than prose, and unlike prose it declines to pick a side.
 *
 * THE FOUR STATE COUNTS ARE NOT HERE. They are on the filter chips below, where the same
 * numbers are also the control that acts on them — a read-only copy of a tappable figure is a
 * second place to keep the same fact correct. What survives of them is the overdue button:
 * the one count that is a call to action rather than a statistic.
 *
 * ONE HERO FIGURE PER SCREEN, and this is it. Proportional figures, not tabular — a
 * standalone number at 44px+ looks loose in tabular digits.
 */

import { toPercent } from '../lib/progress.js'
import { useT } from '../i18n/index.js'
import Meter from './Meter.jsx'
import { ChevronRightIcon } from './icons.jsx'

export default function OverallCard({ overall, onShowOverdue }) {
  const { t } = useT()
  const percent = toPercent(overall.percent)

  /**
   * Nothing rather than a 0% card. An empty board renders `EmptyBoard` instead — a tracker
   * above it would be a hero figure measuring nothing, and "0 of 0 done" is not a fact
   * anybody needs stated.
   */
  if (!overall.total) return null

  return (
    <section className="card overall" aria-label={t('overall.title')}>
      <p className="overall__figure">
        <span className="overall__percent">{percent}</span>
        <span className="overall__unit">%</span>
      </p>

      <p className="overall__count tnum">
        {t('overall.summary', { done: overall.done, count: overall.total })}
      </p>

      <Meter
        value={overall.percent}
        mark={overall.expected}
        large
        label={t('overall.title')}
        /* The mark has no visible label, so its meaning has to be in here — it is the only
           channel a screen reader has for the whole pace signal. */
        valueText={`${t('overall.summary', { done: overall.done, count: overall.total })} — ${t(
          'overall.expected',
          { count: overall.passed, total: overall.total },
        )}`}
      />

      {/* Nothing at all when nothing is late, which is the state a board should mostly be in.
          A button rather than a figure: the useful response to "3 overdue" is to look at them. */}
      {overall.overdue > 0 ? (
        <button type="button" className="btn btn--secondary btn--block overall__alert" onClick={onShowOverdue}>
          {t('overall.overdue', { count: overall.overdue })}
          <ChevronRightIcon style={{ width: '1em', height: '1em' }} />
        </button>
      ) : null}
    </section>
  )
}
