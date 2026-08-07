/**
 * The progress bar, and the only component that draws one.
 *
 * Three things are deliberate and easy to "clean up" wrongly:
 *
 * IT IS NOT A `<progress>`. Safari's native progress element cannot be given a
 * second mark, and the on-schedule tick is the whole reason this component exists.
 * The ARIA meter role carries the same semantics to a screen reader.
 *
 * THE VALUE IS ALSO TEXT. Every caller renders the percentage beside the bar, and
 * `aria-valuetext` states it as a sentence, because a fill length is not a value
 * anybody can read off precisely and colour is never the only channel.
 *
 * THE MARK HAS NO COLOUR OF ITS OWN. It is ink with a 2px ring in the surface
 * colour, which is what keeps it legible whether it lands on the fill or on the
 * bare track. See `.meter__mark` in primitives.css.
 */

import { toPercent } from '../lib/progress.js'

/**
 * @param {object} props
 * @param {number} props.value 0–1
 * @param {number} [props.mark] 0–1; the on-schedule reference, omitted on task rows
 * @param {string} [props.state] one of `STATE`, which picks the fill colour
 * @param {boolean} [props.large]
 * @param {string} props.label an accessible name — the bar is never self-explanatory
 * @param {string} [props.valueText] overrides the spoken value
 */
export default function Meter({ value, mark, state, large = false, label, valueText }) {
  const percent = toPercent(value)
  return (
    <div
      className={`meter${large ? ' meter--lg' : ''}${state ? ` meter--${state}` : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
    >
      <div className="meter__fill" style={{ width: `${percent}%` }} />
      {mark == null ? null : (
        // Presentational: the value it marks is already in the parent's text, so a
        // screen reader announcing "97%" again here would only be confusing.
        <div className="meter__mark" style={{ left: `${toPercent(mark)}%` }} aria-hidden="true" />
      )}
    </div>
  )
}
