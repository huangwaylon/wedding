/**
 * Writes the PNG app icons. Run once, or after changing the mark:
 *
 *   npm run icons
 *
 * A hand-rolled PNG encoder rather than a dependency. `sharp` and `canvas` both ship
 * native binaries, which is a lot of install surface for three files that change
 * approximately never — and Node's own `zlib` is all a PNG actually needs.
 *
 * The mark is two interlocking rings, drawn with signed-distance fields and
 * supersampled 3x3 per pixel. Distance fields rather than a rasterised path because
 * antialiasing falls out of them for free, and a ring at 192px with hard edges looks
 * like a mistake on a Retina Home Screen.
 *
 * Every icon is drawn FULL-BLEED and also declared `maskable`, so the mark sits
 * inside the safe zone: Android crops a maskable icon to a circle of 80% width, and
 * a design that fills the square loses its edges.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIZES = [180, 192, 512]
const OUT = join('public', 'icons')

/** --accent (rose) and --accent-text from tokens.css. */
const BG = [0x8f, 0x2f, 0x50]
const FG = [0xff, 0xff, 0xff]

/** 3x3 per pixel. Enough that a 1px stroke at 180px has no visible stair-stepping. */
const SAMPLES = 3

/**
 * Everything below is in a 0–1 unit square, so one description scales to every size.
 * The rings sit inside the maskable safe zone: centre 0.5, and the furthest point of
 * either ring is 0.5 + 0.155 + 0.055 + half the stroke, which stays inside the 0.4
 * radius Android crops to.
 */
const RINGS = [
  { x: 0.5 - 0.115, y: 0.545, r: 0.215 },
  { x: 0.5 + 0.115, y: 0.545, r: 0.215 },
]
const STROKE = 0.052
/** The band above the rings, which reads as the stone setting. */
const GEM = { x: 0.5, y: 0.2, halfWidth: 0.085, halfHeight: 0.075 }

function ringCoverage(x, y) {
  for (const ring of RINGS) {
    const distance = Math.hypot(x - ring.x, y - ring.y)
    if (Math.abs(distance - ring.r) <= STROKE / 2) return true
  }
  return false
}

/** A diamond: |dx| / w + |dy| / h <= 1. */
function gemCoverage(x, y) {
  const dx = Math.abs(x - GEM.x) / GEM.halfWidth
  const dy = Math.abs(y - GEM.y) / GEM.halfHeight
  return dx + dy <= 1
}

function inside(x, y) {
  return ringCoverage(x, y) || gemCoverage(x, y)
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
