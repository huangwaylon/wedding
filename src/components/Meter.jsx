/**
 * The progress bar. One of these is rendered in the whole app — the overall tracker — and
 * that is the point: a bar per task would be 0% or 100% for anything without a checklist,
 * which the tick beside it already says.
 *
 * Three things are deliberate and easy to "clean up" wrongly:
 *
 * IT IS NOT A `<progress>` ELEMENT. Safari's native one cannot be given a second mark, and
 * the on-schedule tick is the whole reason this component exists. It IS `role="progressbar"`,
 * though — not `role="meter"`, which ARIA explicitly reserves for a gauge rather than a value
 * advancing toward completion, and which iOS VoiceOver maps patchily enough that an
 * unrecognised one degrades to a generic and takes the label and value with it.
 *
 * THE VALUE IS ALSO TEXT. The caller renders the count beside the bar, and `aria-valuetext`
 * states both the count and the mark's meaning, because a fill length is not a value anybody
 * can read off precisely and colour is never the only channel.
 *
 * THE MARK HAS NO COLOUR OF ITS OWN. It is ink with a 2px ring in the surface colour, which
 * is what keeps it legible whether it lands on the fill or on the bare track. See
 * `.meter__mark` in primitives.css.
 */

import { toPercent } from '../lib/progress.js'

/**
 * @param {object} props
 * @param {number} props.value 0–1
 * @param {number} [props.mark] 0–1; the on-schedule reference
 * @param {boolean} [props.large]
 * @param {string} props.label an accessible name — the bar is never self-explanatory
 * @param {string} [props.valueText] overrides the spoken value
 */
export default function Meter({ value, mark, large = false, label, valueText }) {
  const percent = toPercent(value)
  return (
    <div
      className={`meter${large ? ' meter--lg' : ''}${mark == null ? '' : ' meter--marked'}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
    >
      <div className="meter__fill" style={{ width: `${percent}%` }} />
      {mark == null ? null : (
        // Presentational: the value it marks is already in `aria-valuetext`, so a screen
        // reader announcing it again here would only be confusing.
        <div className="meter__mark" style={{ left: `${toPercent(mark)}%` }} aria-hidden="true" />
      )}
    </div>
  )
}
