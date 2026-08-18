/**
 * The only glyph-title-body block: a mark, a heading, and whatever the surface has to say under it.
 * Two places say "there is nothing here yet" — an empty board and an empty notes document — and a
 * copy of five lines is where the detail gets lost, the `aria-hidden` on the mark above all: the
 * glyph names nothing a screen reader can use, and the heading under it already says what the
 * surface is.
 *
 * The mark is the caller's, because it is what makes the two distinguishable at a glance: the rings
 * on the board, a notebook on the document. `--fs-display` was deleted, so the size is `ICON_SIZE`'s
 * one display entry rather than a literal.
 */

import { ICON_SIZE } from './icons.jsx'

export default function EmptyState({ mark: Mark, title, children }) {
  return (
    <section className="card empty">
      <p aria-hidden="true">
        <Mark className="empty__mark" style={ICON_SIZE.display} />
      </p>
      <h2 className="empty__title">{title}</h2>
      {children}
    </section>
  )
}
