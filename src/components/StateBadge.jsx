/**
 * The one state that needs a WORD, as a tinted chip.
 *
 * A card already carries its state three times over: the node's colour, the percentage
 * beside the meter, and the date chip saying when the window was. For four of the five
 * states that is enough, and a badge on every card is fifty pills competing with fifty
 * titles for the same 393px.
 *
 * OVERDUE IS THE EXCEPTION, and it is not a matter of taste. An expired unfinished window
 * has a `percent` of 100 while being emphatically incomplete — the one place in this app
 * where the number on screen reads as its own opposite — so that card, and only that card,
 * says so in type. Every other state is legible from its own figure.
 *
 * The dot is the icon half of the icon+label pairing: it puts the state's colour on screen
 * while the meaning stays in ink. `--critical` is never used as text colour, so a viewer
 * with any form of colour vision reads the same thing.
 */

import { STATE } from '../lib/progress.js'
import { useT } from '../i18n/index.js'

export default function StateBadge({ state }) {
  const { t } = useT()
  if (state !== STATE.OVERDUE) return null
  return (
    <span className={`badge badge--${state}`}>
      <span className="badge__dot" aria-hidden="true" />
      {t(`state.${state}`)}
    </span>
  )
}
