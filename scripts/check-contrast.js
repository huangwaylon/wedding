/**
 * Contrast check for the palette. Not part of the build — run it when a colour changes, paste
 * the numbers next to the values in tokens.css, and fix anything that FAILs.
 *
 *   node scripts/check-contrast.js
 *
 * IT PARSES `tokens.css` RATHER THAN RESTATING IT. Every value here used to be a hand-copied
 * hex, which made this file the largest colour duplication in the repo and meant a retheme could
 * pass while measuring the previous palette. The accent list is discovered from the
 * `[data-accent]` blocks too, so adding or removing a preset needs no edit here at all.
 */

import { readFileSync } from 'node:fs'

/** Comments stripped: several of these values are discussed in prose that also contains hexes. */
const TOKENS = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(TOKENS)[1]

/** One custom property from `:root`. Throws rather than measuring `undefined` as black. */
function token(name) {
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(ROOT)
  if (!found) throw new Error(`check-contrast: no --${name} in :root`)
  return found[1].trim()
}

/** One preset's own value, from its `[data-accent]` block. */
function preset(accent, name) {
  const block = new RegExp(`\\[data-accent="${accent}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(TOKENS)
  if (!block) throw new Error(`check-contrast: no [data-accent="${accent}"] block`)
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(block[1])
  if (!found) throw new Error(`check-contrast: ${accent} declares no --${name}`)
  return found[1].trim()
}

/** Every preset the stylesheet defines, in declaration order. */
const PRESETS = [...TOKENS.matchAll(/\[data-accent="([a-z]+)"\]/g)].map((m) => m[1])

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

const BG = token('bg')
const SURFACE = token('surface')
const SUNKEN = token('sunken')
/** The unfilled half of a meter. Deliberately darker than --sunken. */
const TRACK = token('track')
/** The hairline around a meter or a timeline bar. Must outline the track, not match it. */
const TRACK_LINE = token('track-line')
/** The boundary that identifies a control. Floor 3:1, and it is measured on ALL THREE surfaces. */
const LINE_INPUT = token('line-input')

const INK = Object.fromEntries(
  ['ink', 'ink-2', 'ink-3', 'ink-4'].map((name) => [name, token(name)]),
)

const ACCENTS = Object.fromEntries(PRESETS.map((name) => [name, preset(name, 'accent')]))

/**
 * Two states get a colour of their own. There is no `warning`: `soon` is the accent and
 * `later` is the bare track, so nothing needs a hue that cannot clear 3:1 on white.
 */
const STATUS = { good: token('good'), critical: token('critical') }

const WASHES = { 'critical-wash': token('critical-wash') }

/**
 * Every accent wash, which went unmeasured for as long as nothing consumed one.
 * `.plan__month--day` does — the wedding's own month wears a tinted plaque — so every preset's
 * wash is checked against every ink that can land on it.
 *
 * THE RESULT IS A RULE: --ink-3 MUST NOT SIT ON AN ACCENT WASH. It measures 4.59–4.71:1, which
 * is no margin worth having at 13px; --ink-2 is 6.60:1 at worst. Kanji at low contrast is
 * unreadable in a way Latin is not.
 */
const ACCENT_WASHES = Object.fromEntries(
  PRESETS.map((name) => [`${name}-wash`, preset(name, 'accent-wash')]),
)

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
/**
 * THE CONTROL BOUNDARY, ON EVERY SURFACE IT MEETS — and this is the row that was missing.
 *
 * --line-input exists only to satisfy WCAG 1.4.11's 3:1 for the boundary that identifies a
 * control, and it went unmeasured here for as long as it existed. It was failing: `.chip` and
 * `.btn--secondary` both swap their fill to --sunken on hover while keeping this border, so the
 * boundary on the app's primary filter controls measured 2.65:1 — and 2.91:1 against --bg even at
 * rest. A boundary is only as good as its worst backdrop, so all three are checked.
 */
for (const [name, backdrop] of [['surface', SURFACE], ['bg', BG], ['sunken', SUNKEN]]) {
  add(`line-input on ${name}`, contrast(LINE_INPUT, backdrop), 3)
}

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

/**
 * --photo-scrim's base colour and the alpha it reaches where the type sits, both read off the
 * gradient's LAST stop — the one the type actually sits on. `test/ui.test.jsx` pins that this
 * file models the same alpha the token declares.
 */
const SCRIM_STOPS = [...token('photo-scrim').matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)]
const DENSE = SCRIM_STOPS[SCRIM_STOPS.length - 1]
const SCRIM = `#${[1, 2, 3].map((i) => Number(DENSE[i]).toString(16).padStart(2, '0')).join('')}`
const SCRIM_ALPHA = Number(DENSE[4])

add(
  'white on the scrim over a white sky',
  contrast('#ffffff', over(SCRIM, SCRIM_ALPHA, '#ffffff')),
  4.5,
)
// --photo-ink-2 is the countdown and the venue, both --fs-caption:
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
