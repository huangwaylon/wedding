/**
 * Contrast check for the palette. Not part of the build — run it when a colour
 * changes, paste the numbers next to the values in tokens.css, and fix anything
 * that FAILs.
 *
 *   node scripts/check-contrast.js
 */

function srgb(hex) {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
}

function luminance(hex) {
  const [r, g, b] = srgb(hex).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const BG = '#faf7f4'
const SURFACE = '#ffffff'
const SUNKEN = '#f3ece7'
/** The unfilled half of a meter. Deliberately darker than --sunken. */
const TRACK = '#e7ddd3'

const INK = { ink: '#1c1a17', 'ink-2': '#56504a', 'ink-3': '#736a61', 'ink-4': '#8c8377' }

const ACCENTS = {
  rose: '#8f2f50',
  sage: '#385844',
  indigo: '#3d4e8b',
  plum: '#6b3a6e',
  gold: '#6b4d17',
}

/**
 * Two states get a colour of their own. There is no `warning`: the third and
 * fourth states — in progress and upcoming — are the accent and the bare track,
 * so nothing needs a hue that cannot clear 3:1 on white.
 */
const STATUS = { good: '#098409', critical: '#c4362f' }

const WASHES = {
  'good-wash': '#e6f4e6',
  'critical-wash': '#fbeae8',
  'neutral-wash': '#f0ece7',
}

const rows = []
const add = (label, ratio, floor) =>
  rows.push({
    pair: label,
    ratio: Number(ratio.toFixed(2)),
    floor,
    verdict: ratio >= floor ? 'pass' : 'FAIL',
  })

// Body and secondary ink on all three surfaces. 4.5:1 — nothing here is large text.
for (const [name, hex] of Object.entries(INK)) {
  for (const [surfaceName, surface] of Object.entries({ bg: BG, surface: SURFACE, sunken: SUNKEN })) {
    // ink-4 is placeholder/disabled only and never carries information, so it is
    // held to the 3:1 non-text floor rather than to 4.5:1.
    add(`${name} on ${surfaceName}`, contrast(hex, surface), name === 'ink-4' ? 3 : 4.5)
  }
}

// White text on the accent (buttons, the FAB), and the accent as a graphic
// against the page (focus ring, meter fill).
for (const [name, hex] of Object.entries(ACCENTS)) {
  add(`white on ${name}`, contrast('#ffffff', hex), 7.5)
  add(`${name} on bg`, contrast(hex, BG), 6.8)
  add(`${name} on surface`, contrast(hex, SURFACE), 6.8)
}

// Status colours are FILLS — meter segments and timeline bars — so the 3:1
// non-text floor applies, against the card surface they sit on.
for (const [name, hex] of Object.entries(STATUS)) {
  add(`${name} fill on surface`, contrast(hex, SURFACE), 3)
}

// A badge is a wash with INK text on it, never status-coloured text: a status
// colour light enough to fill a bar is illegible as type.
for (const [name, hex] of Object.entries(WASHES)) {
  add(`ink on ${name}`, contrast(INK.ink, hex), 4.5)
  add(`ink-2 on ${name}`, contrast(INK['ink-2'], hex), 4.5)
}

// The unfilled meter track has to read as a bar against the card. It cannot reach
// 3:1 and stay a warm neutral, which is why every meter also carries a hairline —
// the boundary, not the fill difference, is what identifies the control.
add('track on surface', contrast(TRACK, SURFACE), 1.25)

// The fill against the track: this one IS the value, so it takes the 3:1
// non-text floor with no relief.
for (const [name, hex] of Object.entries(ACCENTS)) {
  add(`${name} fill on track`, contrast(hex, TRACK), 3)
}
for (const [name, hex] of Object.entries(STATUS)) {
  add(`${name} fill on track`, contrast(hex, TRACK), 3)
}

// The on-schedule marker is an ink tick with a 2px surface ring, so the pair that
// has to pass is ink against that ring — not ink against whatever it crosses.
add('ink tick on its surface ring', contrast(INK.ink, SURFACE), 3)

console.table(rows)
const failures = rows.filter((row) => row.verdict === 'FAIL')
console.log(failures.length ? `${failures.length} FAILING` : 'all pass')
