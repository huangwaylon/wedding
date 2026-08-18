/**
 * Contrast check for the palette. Not part of the build: run it when a colour changes, paste the
 * numbers next to the values in tokens.css, and fix anything that FAILs.
 *
 *   node scripts/check-contrast.js
 *
 * It parses `tokens.css` rather than restating it, so a retheme cannot pass while measuring the
 * previous palette, and it discovers the accent list from the `[data-accent]` blocks, so a preset
 * cannot be added without being measured.
 */

import { readFileSync } from 'node:fs'

/** Comments stripped: some values are discussed in prose that also contains hexes. */
const TOKENS = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(TOKENS)[1]

/** One `:root` property. Throws rather than measuring `undefined` as black. */
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

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const BG = token('bg')
const SURFACE = token('surface')
const SUNKEN = token('sunken')
/** The unfilled half of a meter. Darker than --sunken. */
const TRACK = token('track')
/** The hairline around a meter or a timeline bar. Must outline the track, not match it. */
const TRACK_LINE = token('track-line')
/** The boundary that identifies a control. Floor 3:1, measured on all three surfaces. */
const LINE_INPUT = token('line-input')

const INK = Object.fromEntries(
  ['ink', 'ink-2', 'ink-3', 'ink-4'].map((name) => [name, token(name)]),
)

const ACCENTS = Object.fromEntries(PRESETS.map((name) => [name, preset(name, 'accent')]))

/**
 * The two states with a colour of their own. No `warning`: `soon` is the accent and `later` the
 * bare track, so nothing needs a hue that cannot clear 3:1 on white.
 */
const STATUS = { good: token('good'), critical: token('critical') }

const WASHES = { 'critical-wash': token('critical-wash') }

/**
 * Every accent wash, against every ink that can land on it: `.plan__month--day` consumes one, the
 * wedding's month wearing a tinted plaque. The rule this produced is that --ink-3 must not sit on
 * an accent wash — 4.59–4.71:1, no margin at 13px, where --ink-2 is 6.60:1 at worst, and kanji at
 * low contrast is unreadable in a way Latin is not.
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
    // ink-4 is placeholder/disabled only and carries no information: 3:1, not 4.5:1.
    add(`${name} on ${surfaceName}`, contrast(hex, surface), name === 'ink-4' ? 3 : 4.5)
  }
}

// White on the accent (buttons, the FAB), and the accent as a graphic (focus ring, meter fill).
for (const [name, hex] of Object.entries(ACCENTS)) {
  add(`white on ${name}`, contrast('#ffffff', hex), 7.5)
  add(`${name} on bg`, contrast(hex, BG), 6.8)
  add(`${name} on surface`, contrast(hex, SURFACE), 6.8)
}

// Status colours are fills (meter segments, bars), so 3:1 against the surface they sit on.
for (const [name, hex] of Object.entries(STATUS)) {
  add(`${name} fill on surface`, contrast(hex, SURFACE), 3)
}

// A badge is a wash with ink text, never status-coloured text: a colour light enough to fill a
// bar is illegible as type.
for (const [name, hex] of Object.entries(WASHES)) {
  add(`ink on ${name}`, contrast(INK.ink, hex), 4.5)
  add(`ink-2 on ${name}`, contrast(INK['ink-2'], hex), 4.5)
}

// The plaque's label and tally are both --ink-2. --ink-3 is not a row: 4.47:1 on plum, a
// permanent failure for a pairing no rule may write.
for (const [name, hex] of Object.entries(ACCENT_WASHES)) {
  add(`ink on ${name}`, contrast(INK.ink, hex), 4.5)
  add(`ink-2 on ${name}`, contrast(INK['ink-2'], hex), 4.5)
}

/**
 * The control boundary on every surface it meets. --line-input exists only for WCAG 1.4.11's 3:1,
 * and `.chip` and `.btn--secondary` swap their fill to --sunken on hover while keeping it, so all
 * three backdrops are checked: a boundary is only as good as its worst one.
 */
for (const [name, backdrop] of [['surface', SURFACE], ['bg', BG], ['sunken', SUNKEN]]) {
  add(`line-input on ${name}`, contrast(LINE_INPUT, backdrop), 3)
}

add('track on surface', contrast(TRACK, SURFACE), 1.25)

// The track cannot reach 3:1 and stay a warm neutral, so the hairline is what makes an empty bar
// read as a bar: visible against both the track and the card. --line fails at 1.035:1 on the
// track, which is why --track-line exists.
add('track-line on track', contrast(TRACK_LINE, TRACK), 1.35)
add('track-line on surface', contrast(TRACK_LINE, SURFACE), 1.8)

// The fill against the track is the value, so it takes the 3:1 non-text floor with no relief.
for (const [name, hex] of Object.entries(ACCENTS)) {
  add(`${name} fill on track`, contrast(hex, TRACK), 3)
}
for (const [name, hex] of Object.entries(STATUS)) {
  add(`${name} fill on track`, contrast(hex, TRACK), 3)
}

// The on-schedule marker is an ink tick with a 2px surface ring, so the pair that has to pass is
// ink against that ring, not against whatever it crosses.
add('ink tick on its surface ring', contrast(INK.ink, SURFACE), 3)

// ---------------------------------------------------------------------------
// Over the photograph
//
// A photograph cannot be measured against a token, so the hero's ink is measured against the worst
// case the scrim allows: the gradient's dense end over a blown-out white sky. Anything darker in
// the photo only helps. Lightening --photo-scrim's end stop breaks it — at 0.55 alpha the same
// worst case measures 4.07:1.
// ---------------------------------------------------------------------------

/** sRGB compositing of a solid over a backdrop, per channel, as CSS does it. */
function over(top, alpha, backdrop) {
  const [tr, tg, tb] = srgb(top)
  const [br, bg, bb] = srgb(backdrop)
  const mix = [tr * alpha + br * (1 - alpha), tg * alpha + bg * (1 - alpha), tb * alpha + bb * (1 - alpha)]
  return `#${mix.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * --photo-scrim's base colour and alpha, read off the gradient's last stop, the one the type sits
 * on. `test/ui.test.jsx` pins that this file models the alpha the token declares.
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

/**
 * The OS status bar's glyphs, which sit on the photograph: the web view owns that strip, so they are
 * white and --photo-scrim-top is all they have. Its FIRST stop is the one under them, and they are
 * graphics rather than text, so the floor is 3:1.
 */
const TOP_STOP = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(token('photo-scrim-top'))
const TOP = `#${[1, 2, 3].map((i) => Number(TOP_STOP[i]).toString(16).padStart(2, '0')).join('')}`
add(
  'white status-bar glyphs on the top scrim over a white sky',
  contrast('#ffffff', over(TOP, Number(TOP_STOP[4]), '#ffffff')),
  3,
)
// --photo-ink-2 is the countdown and the venue, both --fs-caption: no large-text relief.
const SCRIMMED = over(SCRIM, SCRIM_ALPHA, '#ffffff')
add(
  'photo-ink-2 on the scrim over a white sky',
  contrast(over('#ffffff', 0.92, SCRIMMED), SCRIMMED),
  4.5,
)
// The settings disc: a white glyph on the control's fill over the brightest possible pixel. A
// glyph is a graphic, so 3:1.
add(
  'white glyph on the photo control over a white sky',
  contrast('#ffffff', over(SCRIM, 0.55, '#ffffff')),
  3,
)

console.table(rows)
const failures = rows.filter((row) => row.verdict === 'FAIL')
console.log(failures.length ? `${failures.length} FAILING` : 'all pass')
// A non-zero exit, so `npm run contrast` can gate something and a FAIL is not a line of output
// somebody has to notice in a 47-row table.
process.exitCode = failures.length ? 1 : 0
