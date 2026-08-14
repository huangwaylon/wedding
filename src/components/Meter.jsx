/**
 * The progress bar. One is rendered in the whole app, the overall tracker: a bar per task would
 * read 0% or 100% for anything without a checklist, which the tick beside it already says. Not a
 * `<progress>` element — Safari's native one takes no second mark, and the on-schedule mark is why
 * this exists. It is `role="progressbar"`, never `role="meter"`: ARIA reserves `meter` for a gauge
 * rather than a value advancing toward completion, and iOS VoiceOver maps it patchily enough that
 * an unrecognised one degrades to a generic and takes the label and value.
 *
 * The value is also text: `aria-valuetext` states the count and the mark's meaning, a fill length
 * being no value anybody can read off precisely and colour never the only channel. The mark has no
 * colour of its own — ink with a 2px ring in the surface colour, legible on the fill and on the
 * bare track (`.meter__mark`).
 */

import { toPercent } from '../lib/progress.js'

/**
 * @param {number} props.value 0–1
 * @param {number} [props.mark] 0–1; the on-schedule reference
 * @param {string} props.label an accessible name — the bar is never self-explanatory
 * @param {string} [props.valueText] overrides the spoken value
 */
export default function Meter({ value, mark, label, valueText }) {
  const percent = toPercent(value)
  return (
    <div
      className={`meter${mark == null ? '' : ' meter--marked'}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
    >
      <div className="meter__fill" style={{ width: `${percent}%` }} />
      {mark == null ? null : (
        // Presentational: the value it marks is already in `aria-valuetext`.
        <div className="meter__mark" style={{ left: `${toPercent(mark)}%` }} aria-hidden="true" />
      )}
    </div>
  )
}
