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
/** The hairline around a meter or a timeline bar. Must outline the track, not match it. */
const TRACK_LINE = '#c9b7a3'

const INK = { ink: '#1c1a17', 'ink-2': '#56504a', 'ink-3': '#736a61', 'ink-4': '#8c8377' }

const ACCENTS = {
  rose: '#8f2f50',
  sage: '#385844',
  indigo: '#3d4e8b',
  plum: '#6b3a6e',
  gold: '#6b4d17',
}

/**
 * Two states get a colour of their own. There is no `warning`: `soon` is the accent and
 * `later` is the bare track, so nothing needs a hue that cannot clear 3:1 on white.
 */
const STATUS = { good: '#098409', critical: '#c4362f' }

const WASHES = {
  'good-wash': '#e6f4e6',
  'critical-wash': '#fbeae8',
  'neutral-wash': '#f0ece7',
}

/**
 * The five accent washes, which went unmeasured for as long as nothing consumed one.
 * `.plan__month--day` does now — the wedding's own month wears a tinted plaque — so every
 * preset's wash is checked against every ink that can land on it.
 *
 * THE RESULT IS A RULE: --ink-3 MUST NOT SIT ON AN ACCENT WASH. It measures 4.47:1 on plum,
 * which fails AA, and 4.56–4.64:1 on the other four, which is no margin worth having. --ink-2
 * is 6.71:1 at worst. Kanji at low contrast is unreadable in a way Latin is not.
 */
const ACCENT_WASHES = {
  'indigo-wash': '#edeef7',
  'rose-wash': '#fbecf1',
  'sage-wash': '#e8f0ea',
  'plum-wash': '#f2e9f3',
  'gold-wash': '#f4eee0',
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

// The accent washes carry the month plaque's label and its tally, both at --ink-2. --ink-3 is
// deliberately NOT a row here: it measures 4.47:1 on plum and would make this script report a
// permanent failure for a pairing no rule is allowed to write. The rule is in the block above.
for (const [name, hex] of Object.entries(ACCENT_WASHES)) {
  add(`ink on ${name}`, contrast(INK.ink, hex), 4.5)
  add(`ink-2 on ${name}`, contrast(INK['ink-2'], hex), 4.5)
}

// The unfilled meter track has to read as a bar against the card. It cannot reach
// 3:1 and stay a warm neutral, which is why every meter also carries a hairline —
// the boundary, not the fill difference, is what identifies the control.
add('track on surface', contrast(TRACK, SURFACE), 1.25)

// The hairline is the mechanism that makes an EMPTY bar read as a bar, so it has to be
// visible against both the track it outlines and the card it sits on. --line fails this
// (1.035:1 on the track), which is why --track-line exists.
add('track-line on track', contrast(TRACK_LINE, TRACK), 1.35)
add('track-line on surface', contrast(TRACK_LINE, SURFACE), 1.8)

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

// ---------------------------------------------------------------------------
// Over the photograph
//
// The hero's background is a photograph, so its ink cannot be measured against a
// token. It is measured against the WORST CASE the scrim allows: the gradient's
// dense end composited over a blown-out white sky. Anything darker in the photo
// only helps. Lightening --photo-scrim's end stop is what would break this — at
// 0.55 alpha the same worst case measures 4.07:1 and fails.
// ---------------------------------------------------------------------------

/** sRGB compositing of a solid over a backdrop, per channel, as CSS does it. */
function over(top, alpha, backdrop) {
  const [tr, tg, tb] = srgb(top)
  const [br, bg, bb] = srgb(backdrop)
  const mix = [tr * alpha + br * (1 - alpha), tg * alpha + bg * (1 - alpha), tb * alpha + bb * (1 - alpha)]
  return `#${mix.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}

/** --photo-scrim's base colour and the alpha it reaches where the type sits. */
const SCRIM = '#181410'
const SCRIM_ALPHA = 0.78

add(
  'white on the scrim over a white sky',
  contrast('#ffffff', over(SCRIM, SCRIM_ALPHA, '#ffffff')),
  4.5,
)
// --photo-ink-2 is the countdown and the date, which are --fs-label and --fs-caption:
// small text, so no large-text relief.
const SCRIMMED = over(SCRIM, SCRIM_ALPHA, '#ffffff')
add(
  'photo-ink-2 on the scrim over a white sky',
  contrast(over('#ffffff', 0.92, SCRIMMED), SCRIMMED),
  4.5,
)
// The settings disc: a white glyph on the control's own fill over the brightest
// possible pixel. A glyph is a graphic, so the floor is 3:1.
add(
  'white glyph on the photo control over a white sky',
  contrast('#ffffff', over(SCRIM, 0.55, '#ffffff')),
  3,
)

console.table(rows)
const failures = rows.filter((row) => row.verdict === 'FAIL')
console.log(failures.length ? `${failures.length} FAILING` : 'all pass')
