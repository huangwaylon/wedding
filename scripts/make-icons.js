/**
 * Writes the PNG app icons. Run after replacing the source photograph or moving the crop:
 *
 *   npm run icons
 *
 * The Home Screen tile is a photograph of the couple showing their rings — the one place in the app
 * where the mark is not what identifies it. A tile is looked at cold, beside thirty others, and a
 * face is recognised there faster than any geometry is. So the two-rings mark no longer reaches a
 * PNG: `index.html`'s inline favicon and `RingsIcon` in src/components/icons.jsx still draw it, and
 * those two are what must not drift. Nothing here reads `tokens.css`, and the icons no longer follow
 * the accent — a retheme does not need them regenerated, and `npm run contrast` is the only script
 * left that parses the palette.
 *
 * `sips` rather than a dependency: `sharp` and `canvas` both ship native binaries, and decoding a
 * JPEG is the one thing plain node cannot do. macOS only, like README's hero crop — the same trade
 * in the same repository.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The camera original, gitignored beside `IMG_0509.JPG` for the same reason: only the derived PNGs
 * are ever served, and a multi-megabyte source in git would be cloned forever to ship ~100KB. So a
 * fresh clone cannot run this, and says so rather than writing three blank tiles.
 */
const SOURCE = 'IMG_8834.JPG'
const SIZES = [180, 192, 512]
const OUT = join('public', 'icons')

/**
 * The square taken out of the 4618x3464 original, offset from its top-left in source pixels. Both
 * faces and both raised hands sit inside it with room to spare, and that margin is the whole reason
 * the side is 2400 and not the ~1900 the subject alone needs: every icon is declared `maskable` as
 * well as `any`, so Android may crop it to a circle of 80% width, and at 1900 that circle takes the
 * ring fingers off the bottom. Check a new crop by cropping the 512 to its middle 410 — that square
 * is a superset of the circle, so whatever survives it survives a launcher.
 *
 * The top is 20 rather than 0 because `--cropOffset 0 0` means "centred" to `sips`, not "top-left".
 */
const CROP = { side: 2400, top: 20, left: 950 }

if (!existsSync(SOURCE)) {
  console.error(`${SOURCE} is not here. It is gitignored: the committed PNGs are the artifact.`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'wedding-icons-'))
const square = join(scratch, 'square.jpg')

/**
 * Two passes, never one: combining `-c` with `--resampleHeightWidth` silently produces the wrong
 * dimensions. Both flags take HEIGHT then WIDTH, which a square crop hides and README's 4:5 hero
 * crop does not.
 */
try {
  execFileSync(
    'sips',
    [
      '-c', String(CROP.side), String(CROP.side),
      '--cropOffset', String(CROP.top), String(CROP.left),
      SOURCE, '--out', square,
    ],
    { stdio: 'ignore' },
  )

  for (const size of SIZES) {
    const path = join(OUT, `icon-${size}.png`)
    // Opaque RGB, since the source JPEG carries no alpha: iOS composites a transparent tile onto
    // white, and there is nothing here to see through.
    execFileSync(
      'sips',
      [
        '--resampleHeightWidth', String(size), String(size),
        '-s', 'format', 'png',
        square, '--out', path,
      ],
      { stdio: 'ignore' },
    )
    console.log(`${path}: ${size}x${size}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
