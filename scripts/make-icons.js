/**
 * Writes the PNG app icons. Run after changing the mark or the default accent:
 *
 *   npm run icons
 *
 * A hand-rolled PNG encoder rather than a dependency: `sharp` and `canvas` both ship native
 * binaries, and Node's `zlib` is all a PNG needs.
 *
 * The mark is a two-peak ridgeline, drawn with signed-distance fields and supersampled 3x3 per
 * pixel: distance fields give antialiasing for free, and hard edges at 192px look wrong on a
 * Retina Home Screen. It has to match `PeaksIcon` in src/components/icons.jsx, or the installed app
 * and the screen it opens carry different logos; that file records why the ginkgo leaf it replaced
 * could not be drawn at glyph size.
 *
 * Every icon is full-bleed and also declared `maskable`, so the mark stays inside the safe zone
 * Android crops a maskable icon to: a circle of 80% width.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIZES = [180, 192, 512]
const OUT = join('public', 'icons')

/**
 * The default accent, read off `tokens.css` rather than retyped, so a retheme cannot leave the app
 * one colour and its Home Screen icon another — `test/ui.test.jsx` checks `tokens.css` against
 * `ACCENT_HEX` in `theme.js`, and this file sits outside both. It parses the stylesheet rather than
 * importing `theme.js`, which reaches `import.meta.env` and cannot run in plain node;
 * `scripts/check-contrast.js` reads the palette the same way. The PNGs are committed, so re-run
 * `npm run icons` after changing the default.
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
 * A 0–1 unit square, so one description scales to every size. The ridge is `PeaksIcon`'s path
 * mapped out of its 24-unit box: that glyph spans x 2.5–21.5, y 8–18.5, wide and shallow, so it is
 * scaled to about half the square and sat a little below centre, where a wordless mark reads best.
 * The furthest point stays inside the 0.4 radius Android crops to.
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
 * The ridge plus the baseline that closes it: `PeaksIcon`'s path ends in `Z`, so the flat bottom
 * belongs to the mark.
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
  // One filter byte per row, as PNG requires. Filter 0 = None; the deflate below does the
  // compressing.
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
