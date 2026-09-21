/**
 * The progress bar. One is rendered in the whole app, the overall tracker: a bar per task would
 * read 0% or 100% for anything without a checklist, which the tick beside it already says.
 *
 * It draws ONE series — work done — and carries no reference mark. A second tick over the same
 * track is a second claim about the same length, which is what the percentage beside it and the
 * overdue chip already make separately and in words; the fill is the one thing the eye has to read
 * here, and the accent is what says how far along it is.
 *
 * Hand-rolled rather than `<progress>`: a div plus a percentage takes the app's tokens, where the
 * native element is styled through UA pseudo-elements that differ per engine. It is
 * `role="progressbar"`, never `role="meter"`: ARIA reserves `meter` for a gauge rather than a value
 * advancing toward completion, and iOS VoiceOver maps it patchily enough that an unrecognised one
 * degrades to a generic and takes the label and value.
 *
 * The value is also text: `aria-valuetext` states the count behind the fill, a length being no value
 * anybody can read off precisely and colour never the only channel.
 */

import { toPercent } from '../lib/progress.js'

/**
 * @param {number} props.value 0–1
 * @param {string} props.label an accessible name — the bar is never self-explanatory
 * @param {string} [props.valueText] overrides the spoken value
 */
export default function Meter({ value, label, valueText }) {
  const percent = toPercent(value)
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      /* The ROUNDED percent, the same number the fill's width uses and the same one the figure beside
         it prints: three copies of one value, so the bar cannot disagree with the text. */
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
    >
      <div className="meter__fill" style={{ width: `${percent}%` }} />
    </div>
  )
}
