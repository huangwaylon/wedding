/**
 * The floating action button. One of the app's three pieces of pinned chrome, and one component:
 * both tabs put their single most likely action here, and two copies of the markup would drift on
 * which of them carries a label a screen reader can read.
 *
 * ONE CLASS, `.fab`. It is in the exactly-three list of things allowed a shadow (`ui.test.jsx`), so a
 * per-tab variant with a shadow of its own is a fourth and fails there — the tab decides the glyph and
 * the label, never the elevation.
 *
 * The label is required, not optional: the glyph is the only visible content, so without it the
 * control has no accessible name at all.
 */

export default function Fab({ label, onClick, children }) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={label}>
      {children}
    </button>
  )
}
