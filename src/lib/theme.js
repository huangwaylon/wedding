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

/** `rose` first: it is the default, and the order is the swatch order. */
export const ACCENTS = ['rose', 'sage', 'indigo', 'plum', 'gold']

export const DEFAULT_ACCENT = 'rose'

/**
 * The same hexes the `[data-accent]` blocks in `tokens.css` declare.
 *
 * Not read at runtime — a swatch paints itself by scoping the preset locally, which is
 * why those blocks are attribute-scoped. This exists so the two can be pinned against
 * each other: `test/ui.test.jsx` parses the stylesheet and fails when a preset's hex is
 * changed in one place and not the other, which is otherwise only visible to the eye.
 */
export const ACCENT_HEX = {
  rose: '#8f2f50',
  sage: '#385844',
  indigo: '#3d4e8b',
  plum: '#6b3a6e',
  gold: '#6b4d17',
}

export function getAccent() {
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
  if (meta) meta.setAttribute('content', '#faf7f4')
}

/**
 * Like `useT`, the third `getServerSnapshot` argument is load-bearing: without it
 * `useSyncExternalStore` throws "Missing getServerSnapshot" under
 * `renderToStaticMarkup`, which is how every render test runs.
 */
export function useAccent() {
  return useSyncExternalStore(onAccentChange, getAccent, getAccent)
}
