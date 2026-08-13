/**
 * The accent presets, and the one place a preference is reflected onto <html>.
 *
 * An accent is THREE custom properties — `--accent`, `--accent-hover`,
 * `--accent-wash` — redefined under `[data-accent]` in `tokens.css`. The ring and
 * the coloured shadow derive from `--accent` with `color-mix`, so adding a preset
 * is a three-value change rather than a five-value one, and a preset can never
 * reach into the neutrals or the state colours.
 *
 * Per DEVICE, in `localStorage`, never in the sheet — for the same reason the
 * language is: the couple and their planners all read the same board, and none of
 * them gets to restyle anybody else's screen.
 */

import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

/**
 * `tarn` first: it is the default, and the order is the swatch order.
 *
 * The default has to be separable from `--good` and `--critical` at 8px, because the accent also
 * paints `.dot--soon` — one of the three discs that carry a row's state. See the accent block in
 * `tokens.css`.
 */
export const ACCENTS = ['tarn', 'pine', 'rosehip']

export const DEFAULT_ACCENT = 'tarn'

/**
 * The page background, which `tokens.css` declares as `--bg`, `index.html` as `theme-color`, and
 * the manifest twice. Named here so all four spellings are greppable from one place and can be
 * pinned against each other; no preset changes it, which is why it is a constant of its own
 * rather than part of `ACCENT_HEX`.
 */
export const BG_HEX = '#faf8f3'

/**
 * The same hexes the `[data-accent]` blocks in `tokens.css` declare.
 *
 * Not read at runtime — a swatch paints itself by scoping the preset locally, which is
 * why those blocks are attribute-scoped. This exists so the two can be pinned against
 * each other: `test/ui.test.jsx` parses the stylesheet and fails when a preset's hex is
 * changed in one place and not the other, which is otherwise only visible to the eye.
 */
export const ACCENT_HEX = {
  tarn: '#1c4b74',
  pine: '#23503a',
  rosehip: '#7f2b60',
}

function getAccent() {
  const stored = readStored(STORAGE_KEYS.accent)
  return ACCENTS.includes(stored) ? stored : DEFAULT_ACCENT
}

export function setAccent(name) {
  const next = ACCENTS.includes(name) ? name : DEFAULT_ACCENT
  writeStored(STORAGE_KEYS.accent, next)
  syncDocumentAccent(next)
  for (const listener of listeners) listener()
  return next
}

const listeners = new Set()

function onAccentChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** No-op outside a browser: these modules also load under vitest's `node` env. */
export function syncDocumentAccent(name = getAccent()) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = name
  // The status bar behind an installed app's notch. It tracks --bg, which no
  // preset changes, so this only matters on first paint.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', BG_HEX)
}

/**
 * Like `useT`, the third `getServerSnapshot` argument is load-bearing: without it
 * `useSyncExternalStore` throws "Missing getServerSnapshot" under
 * `renderToStaticMarkup`, which is how every render test runs.
 */
export function useAccent() {
  return useSyncExternalStore(onAccentChange, getAccent, getAccent)
}
