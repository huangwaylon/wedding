/**
 * Writes the PNG app icons. Run once, or after changing the mark:
 *
 *   npm run icons
 *
 * A hand-rolled PNG encoder rather than a dependency. `sharp` and `canvas` both ship
 * native binaries, which is a lot of install surface for three files that change
 * approximately never — and Node's own `zlib` is all a PNG actually needs.
 *
 * The mark is a two-peak ridgeline, drawn with signed-distance fields and
 * supersampled 3x3 per pixel. Distance fields rather than a rasterised path because
 * antialiasing falls out of them for free, and a stroke at 192px with hard edges
 * looks like a mistake on a Retina Home Screen.
 *
 * IT HAS TO MATCH `PeaksIcon` in src/components/icons.jsx — that is the same mark in
 * the empty state, and the two drifting apart means the installed app and the screen
 * it opens carry different logos. That file records why the ginkgo leaf this replaced
 * could not be drawn at glyph size.
 *
 * Every icon is drawn FULL-BLEED and also declared `maskable`, so the mark sits
 * inside the safe zone: Android crops a maskable icon to a circle of 80% width, and
 * a design that fills the square loses its edges.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SIZES = [180, 192, 512]
const OUT = join('public', 'icons')

/**
 * The default accent, READ OFF `tokens.css` rather than retyped as a byte triple.
 *
 * That triple was the one spelling of the accent nothing pinned: `test/ui.test.jsx` checks
 * `tokens.css` against `ACCENT_HEX` in `theme.js`, and this file sat outside both — so a retheme
 * would leave the app one colour and its Home Screen icon another. It parses the stylesheet
 * rather than importing `theme.js` because that module reaches `import.meta.env`, which plain
 * node does not have; `scripts/check-contrast.js` reads the palette the same way.
 *
 * The PNGs are committed, so re-run `npm run icons` after changing the default.
 */
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(
  readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
)[1]
const ACCENT = /--accent:\s*#([0-9a-f]{6})/i.exec(ROOT)[1]
const BG = [0, 2, 4].map((i) => parseInt(ACCENT.slice(i, i + 2), 16))
const FG = [0xff, 0xff, 0xff]

/** 3x3 per pixel. Enough that a 1px stroke at 180px has no visible stair-stepping. */
const SAMPLES = 3

/**
 * Everything below is in a 0–1 unit square, so one description scales to every size.
 *
 * The ridge is `PeaksIcon`'s path mapped out of its 24-unit box and centred. That glyph
 * spans x 2.5–21.5 and y 8–18.5, which is wide and shallow, so it is scaled to about
 * half the square and sat a little below centre, where a wordless mark reads best. The
 * furthest point stays inside the 0.4 radius Android crops a maskable icon to.
 */
const RIDGE = [
  [0.25, 0.655],
  [0.378, 0.36],
  [0.462, 0.535],
  [0.558, 0.4],
  [0.68, 0.655],
]
const STROKE = 0.055

/** Distance from a point to a segment, which is all a stroked polyline needs. */
function distanceToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  // A degenerate segment is a point; clamping keeps the projection on the segment itself.
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/**
 * The ridge, plus the baseline that closes it: `PeaksIcon`'s path ends in `Z`, so the flat
 * bottom belongs to the mark rather than being an addition here.
 */
function inside(x, y) {
  const points = [...RIDGE, RIDGE[0]]
  for (let index = 0; index < points.length - 1; index += 1) {
    if (distanceToSegment(x, y, points[index], points[index + 1]) <= STROKE / 2) return true
  }
  return false
}

/** RGB, no alpha: the icon is opaque, and iOS composites a transparent one onto white. */
export function pixels(size) {
  // One filter byte per row, as PNG requires. Filter 0 = None; the deflate below is
  // what does the compressing, and a solid-ish icon compresses fine without a filter.
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let cursor = 0

  for (let row = 0; row < size; row += 1) {
    raw[cursor] = 0
    cursor += 1
    for (let column = 0; column < size; column += 1) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (column + (sx + 0.5) / SAMPLES) / size
          const y = (row + (sy + 0.5) / SAMPLES) / size
          if (inside(x, y)) hits += 1
        }
      }
      const alpha = hits / (SAMPLES * SAMPLES)
      for (let channel = 0; channel < 3; channel += 1) {
        raw[cursor] = Math.round(BG[channel] + (FG[channel] - BG[channel]) * alpha)
        cursor += 1
      }
    }
  }
  return raw
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      // 0xedb88320 is the reflected CRC-32 polynomial PNG specifies.
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export function encodePng(size, raw) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type 2 = truecolour RGB
  header[10] = 0 // deflate
  header[11] = 0 // filter method 0
  header[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  const path = join(OUT, `icon-${size}.png`)
  writeFileSync(path, encodePng(size, pixels(size)))
  console.log(`${path}: ${size}x${size}`)
}
