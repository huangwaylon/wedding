/**
 * The accent presets, and the one place a preference is reflected onto <html>.
 *
 * An accent is three custom properties — `--accent`, `--accent-hover`, `--accent-wash` — redefined
 * under `[data-accent]` in `tokens.css`. The ring and coloured shadow derive from `--accent` with
 * `color-mix`, so a preset cannot reach into the neutrals or the state colours.
 *
 * Per device, in `localStorage`, never in the sheet: nobody gets to restyle anybody else's screen.
 */

import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

/**
 * `tarn` first: the default, and the swatch order. The default has to be separable from `--good`
 * and `--critical` at 8px, because the accent also paints `.dot--soon`. See `tokens.css`.
 */
export const ACCENTS = ['tarn', 'pine', 'rosehip']

export const DEFAULT_ACCENT = 'tarn'

/**
 * The page background, which `tokens.css` declares as `--bg`, `index.html` as `theme-color`, and
 * the manifest twice. Named here so all four spellings can be pinned against each other. No preset
 * changes it.
 */
export const BG_HEX = '#faf8f3'

/**
 * The same hexes the `[data-accent]` blocks in `tokens.css` declare. Not read at runtime; this
 * exists so `test/ui.test.jsx` can fail when a hex changes in one place and not the other.
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

const listeners = new Set()

export function setAccent(name) {
  const next = ACCENTS.includes(name) ? name : DEFAULT_ACCENT
  writeStored(STORAGE_KEYS.accent, next)
  syncDocumentAccent(next)
  for (const listener of listeners) listener()
  return next
}

function onAccentChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** No-op outside a browser: these modules also load under vitest's `node` env. */
export function syncDocumentAccent(name = getAccent()) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = name
  // The status bar behind an installed app's notch. It tracks --bg, which no preset changes.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', BG_HEX)
}

/**
 * As in `useT`, the third `getServerSnapshot` argument is load-bearing: without it
 * `useSyncExternalStore` throws under `renderToStaticMarkup`, which is how every render test runs.
 */
export function useAccent() {
  return useSyncExternalStore(onAccentChange, getAccent, getAccent)
}
