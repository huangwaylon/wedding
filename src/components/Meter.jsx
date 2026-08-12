/**
 * The progress bar, and the only component that draws one.
 *
 * Three things are deliberate and easy to "clean up" wrongly:
 *
 * IT IS NOT A `<progress>` ELEMENT. Safari's native one cannot be given a second mark, and
 * the on-schedule tick is the whole reason this component exists. It IS `role="progressbar"`,
 * though — not `role="meter"`, which ARIA explicitly reserves for a gauge rather than a value
 * advancing toward completion, and which iOS VoiceOver maps patchily enough that an
 * unrecognised one degrades to a generic and takes the label and value with it.
 *
 * THE VALUE IS ALSO TEXT. Every caller renders the percentage beside the bar, and
 * `aria-valuetext` states it as a sentence, because a fill length is not a value
 * anybody can read off precisely and colour is never the only channel.
 *
 * THE MARK HAS NO COLOUR OF ITS OWN. It is ink with a 2px ring in the surface
 * colour, which is what keeps it legible whether it lands on the fill or on the
 * bare track. See `.meter__mark` in primitives.css.
 *
 * IT CAN BE BUILT OUT OF SPANS. A card's whole collapsed row is one `<button>`, whose
 * content model is phrasing content, so the three `<div>`s this renders by default cannot
 * live there. `tag` swaps all three at once — never just the wrapper, or the fill inside a
 * span wrapper is an inline box that ignores its own height.
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
 * @param {'div'|'span'} [props.tag] `span` inside a control; the caller's CSS gives the
 *   three of them `display: block`
 */
export default function Meter({
  value,
  mark,
  state,
  large = false,
  label,
  valueText,
  tag: Tag = 'div',
}) {
  const percent = toPercent(value)
  return (
    <Tag
      className={`meter${large ? ' meter--lg' : ''}${mark == null ? '' : ' meter--marked'}${
        state ? ` meter--${state}` : ''
      }`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
    >
      <Tag className="meter__fill" style={{ width: `${percent}%` }} />
      {mark == null ? null : (
        // Presentational: the value it marks is already in the parent's text, so a
        // screen reader announcing "97%" again here would only be confusing.
        <Tag className="meter__mark" style={{ left: `${toPercent(mark)}%` }} aria-hidden="true" />
      )}
    </Tag>
  )
}
