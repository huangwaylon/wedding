/**
 * A task's state, as a tinted chip with a written label.
 *
 * The dot is the icon half of the dataviz icon+label pairing: it puts the state's
 * colour on screen while the meaning stays in type. `--good` and `--critical` are
 * never used as text colour — one of them cannot clear 4.5:1 on white — so a
 * viewer with any form of colour vision reads the same thing.
 */

import { useT } from '../i18n/index.js'

export default function StateBadge({ state }) {
  const { t } = useT()
  return (
    <span className={`badge badge--${state}`}>
      <span className="badge__dot" aria-hidden="true" />
      {t(`state.${state}`)}
    </span>
  )
}
