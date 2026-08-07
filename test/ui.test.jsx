/**
 * The stylesheets, as text.
 *
 * These are the rules that a green test suite would otherwise say nothing about. The
 * sibling app shipped an invisible white-on-white chart with every test passing; each
 * assertion here corresponds to something that either did go wrong or would be
 * impossible to notice if it did.
 *
 * Reading CSS as a string is crude, and it is the only thing that works without a
 * browser. A screenshot is still required — see `scripts/preview.jsx`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCENTS, ACCENT_HEX, DEFAULT_ACCENT } from '../src/lib/theme.js'

const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const base = readFileSync('src/styles/base.css', 'utf8')
const primitives = readFileSync('src/styles/primitives.css', 'utf8')
const app = readFileSync('src/styles/app.css', 'utf8')
const html = readFileSync('index.html', 'utf8')

/**
 * These stylesheets explain their own constraints at length, and several of those
 * explanations name the thing they are forbidding — "without needing !important
 * anywhere". A scan over the raw text therefore matches the prose rather than the
 * rules, so every "nothing anywhere does X" assertion runs over this instead.
 */
function code(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const all = [tokens, base, primitives, app].map(code).join('\n')

/**
 * The CSP itself, not the paragraph above it explaining which hosts are deliberately
 * absent. Same reasoning as `code`.
 */
const csp = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/.exec(html)[1]

describe('accent presets', () => {
  it('defines every preset the app offers', () => {
    for (const accent of ACCENTS) {
      expect(tokens, `[data-accent="${accent}"] missing`).toContain(`[data-accent="${accent}"]`)
    }
  })

  it('agrees with the hexes the swatches paint with', () => {
    for (const accent of ACCENTS) {
      const block = new RegExp(`\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`).exec(tokens)
      expect(block, accent).toBeTruthy()
      expect(block[1].toLowerCase(), accent).toContain(`--accent: ${ACCENT_HEX[accent]}`)
    }
  })

  it('spells out the default even though :root already carries it', () => {
    // So a settings swatch can scope it locally like any other preset.
    expect(tokens).toContain(`[data-accent="${DEFAULT_ACCENT}"]`)
  })

  it('changes exactly three properties per preset', () => {
    // A preset must not be able to reach the neutrals or the state colours. The ring and
    // the coloured shadow derive from --accent with color-mix instead.
    for (const accent of ACCENTS) {
      const block = new RegExp(`\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`).exec(tokens)[1]
      const declared = [...block.matchAll(/--[a-z-]+:/g)].map((match) => match[0])
      expect(declared.sort(), accent).toEqual(['--accent-hover:', '--accent-wash:', '--accent:'])
    }
  })

  it('derives the ring and the shadow rather than restating channels', () => {
    expect(tokens).toMatch(/--accent-ring: color-mix/)
    expect(tokens).toMatch(/--accent-shadow: color-mix/)
  })
})

describe('the meter', () => {
  it('keeps the hairline that makes an empty bar visible', () => {
    // --track is 1.34:1 against the card and cannot reach 3:1 while staying a warm
    // neutral, so the BOUNDARY is what identifies the bar. Without it, 0% reads as
    // "there is no meter here".
    const meter = /\.meter \{([^}]*)\}/.exec(primitives)
    expect(meter, '.meter rule missing').toBeTruthy()
    expect(meter[1]).toMatch(/border: 1px solid/)
    expect(meter[1]).toMatch(/background-color: var\(--track\)/)
  })

  it('draws that hairline in --track-line, never --line', () => {
    // --line on --track measures 1.035:1: the outline it was supposed to draw is invisible,
    // which left an empty bar held up by the fill step alone. Both the meter and the
    // timeline bar shipped with this.
    expect(tokens).toMatch(/--track-line:/)
    expect(/\.meter \{([^}]*)\}/.exec(primitives)[1]).toMatch(
      /border: 1px solid var\(--track-line\)/,
    )
    expect(/\.timeline__bar \{([^}]*)\}/.exec(app)[1]).toMatch(
      /border: 1px solid var\(--track-line\)/,
    )
  })

  it('gives the on-schedule mark a surface ring rather than a colour of its own', () => {
    // That ring is what keeps it legible whether it lands on the fill or on the bare
    // track. Replacing it with a hue would fail against one or the other.
    const mark = /\.meter__mark \{([^}]*)\}/.exec(primitives)[1]
    expect(mark).toMatch(/box-shadow: 0 0 0 2px var\(--surface\)/)
    expect(mark).toMatch(/background-color: var\(--ink\)/)
  })

  it('lets the large variant show a mark that escapes the bar', () => {
    // The tick is taller than the track so its ends sit against the card; clipping it
    // would hide exactly the part that makes it readable.
    expect(/\.meter--lg \{([^}]*)\}/.exec(primitives)[1]).toMatch(/overflow: visible/)
  })

  it('has a fill colour for every state that gets one', () => {
    for (const state of ['done', 'overdue', 'upcoming']) {
      expect(primitives, state).toContain(`.meter--${state} .meter__fill`)
    }
  })

  it('does not transition the fill', () => {
    // It advances on its own once a minute; an animation would make it look like a
    // control responding to a tap.
    expect(/\.meter__fill \{([^}]*)\}/.exec(primitives)[1]).not.toContain('transition')
  })
})

describe('state colour is never the only channel', () => {
  it('paints badge text with ink, not with a state colour', () => {
    const badge = /\n\.badge \{([^}]*)\}/.exec(primitives)[1]
    expect(badge).toMatch(/color: var\(--ink-2\)/)
    for (const state of ['done', 'overdue', 'active']) {
      const block = new RegExp(`\\.badge--${state} \\{([^}]*)\\}`).exec(primitives)[1]
      // The modifier may only change the wash. A `color:` here would put a state hue on
      // type, and one of them cannot clear 4.5:1 on white.
      expect(block, state).toMatch(/background-color/)
      expect(block, state).not.toMatch(/[^-]color:/)
    }
  })

  it('has a standalone dot modifier for the stat tiles', () => {
    // Reusing `.badge--done .badge__dot` needs the ancestor and silently paints grey
    // without it, which is how a stat row loses its colour.
    for (const state of ['done', 'overdue', 'active', 'upcoming']) {
      expect(primitives, state).toContain(`.dot--${state}`)
    }
  })
})

describe('typography and Japanese', () => {
  it('has no letter-spacing outside the digits-only hero figure', () => {
    // Tracking inserts a gap between every kana: 「このつき」 becomes 「こ の つ き」.
    const offenders = []
    for (const match of all.matchAll(/([.#][\w-]+[^{}]*)\{[^}]*letter-spacing:\s*([^;]+);/g)) {
      if (/letter-spacing:\s*0/.test(match[0])) continue
      if (match[1].includes('overall__percent')) continue
      offenders.push(match[1].trim())
    }
    expect(offenders, 'letter-spacing outside the hero figure').toEqual([])
  })

  it('has no text-transform anywhere', () => {
    // `uppercase` is a no-op on kana, so it can only ever make the Latin half louder.
    expect(all).not.toMatch(/text-transform:\s*(uppercase|capitalize)/)
  })

  it('keeps every line-height at or above 1.5, bar the one carve-out', () => {
    expect(tokens).toMatch(/--lh-tight: 1\.5/)
    expect(tokens).toMatch(/--lh-body: 1\.6/)
    // --lh-flat is 1, and only the hero percentage uses it, which renders digits only.
    expect(tokens).toMatch(/--lh-flat: 1;/)
    const flatUsers = [...all.matchAll(/([.#][\w-]+)[^{}]*\{[^}]*--lh-flat/g)].map((m) => m[1])
    expect(flatUsers).toEqual(['.overall__percent'])
  })

  it('has no font size below 13px', () => {
    expect(tokens).toMatch(/--fs-caption: 0\.8125rem/)
    const hardcoded = [...all.matchAll(/font-size:\s*(\d*\.?\d+)rem/g)].map((m) => Number(m[1]))
    for (const size of hardcoded) {
      expect(size * 16, `${size}rem is under 13px`).toBeGreaterThanOrEqual(13)
    }
  })

  it('uses only the three reliable weights', () => {
    // 550 and 650 are unreliable outside SF Pro, and Hiragino ships W3/W6 with nothing
    // between.
    for (const match of all.matchAll(/font-weight:\s*(\d+)/g)) {
      expect(['400', '500', '600']).toContain(match[1])
    }
  })

  it('puts the Latin faces before the Japanese ones', () => {
    // So digits resolve from SF Pro / Segoe UI / Roboto, which all ship tabular figures.
    const stack = /--font-sans:([^;]*);/.exec(tokens)[1]
    expect(stack.indexOf('-apple-system')).toBeLessThan(stack.indexOf('Hiragino'))
    // Yu Gothic Regular renders anaemically thin on Windows; Medium is the usable weight.
    expect(stack.indexOf('"Yu Gothic Medium"')).toBeLessThan(stack.indexOf('"Yu Gothic"'))
  })

  it('has no display or serif face, including for the hero figure', () => {
    expect(tokens).not.toMatch(/font-family:[^;]*serif(?!-)/)
    expect(/\.overall__percent \{([^}]*)\}/.exec(app)[1]).not.toContain('font-family')
  })
})

describe('form controls', () => {
  it('never drops a control below 16px', () => {
    // Mobile Safari zooms the viewport on focus below that and will not zoom back out.
    expect(base).toMatch(/font-size: max\(1rem, var\(--fs-body\)\)/)
    expect(/\.input \{([^}]*)\}/.exec(primitives)[1]).toMatch(/font-size: max\(1rem/)
  })

  it('gives a control boundary its own darker line token', () => {
    // WCAG 1.4.11 wants 3:1 for the boundary identifying a control, and --line on white
    // does not come close.
    expect(tokens).toContain('--line-input:')
    expect(/\.input \{([^}]*)\}/.exec(primitives)[1]).toContain('var(--line-input)')
  })

  it('keeps tap targets at 44px, with a 36px floor for secondary controls', () => {
    expect(tokens).toMatch(/--tap-target: 44px/)
    expect(tokens).toMatch(/--tap-target-sm: 36px/)
  })
})

describe('elevation', () => {
  it('uses a shadow in exactly the four places it is allowed', () => {
    const users = [...all.matchAll(/([.#][\w-]+)[^{}]*\{[^}]*box-shadow: var\(--shadow-/g)].map(
      (match) => match[1],
    )
    expect(new Set(users)).toEqual(
      new Set(['.fab', '.sheet__panel', '.toast', '.segmented__option']),
    )
  })

  it('adds no shadow on hover', () => {
    expect(all).not.toMatch(/:hover[^{]*\{[^}]*box-shadow: var\(--shadow-/)
  })

  it('gives the card a hairline instead of an elevation', () => {
    const card = /\n\.card \{([^}]*)\}/.exec(primitives)[1]
    expect(card).toMatch(/border: 1px solid var\(--line\)/)
    expect(card).not.toContain('box-shadow')
  })
})

describe('layout', () => {
  it('reserves clearance for the FAB so it cannot cover the last row', () => {
    // Dropping this reservation in the two-column block is exactly how the button once
    // landed on a row's delete control in the sibling app.
    expect(/\.shell \{([^}]*)\}/.exec(app)[1]).toMatch(/padding-bottom:.*--fab-size/)
  })

  it('has only the two documented breakpoints', () => {
    const widths = new Set([...app.matchAll(/@media \(min-width: ([\d.]+rem)\)/g)].map((m) => m[1]))
    expect([...widths].sort()).toEqual(['48rem', '62rem'])
  })

  it('makes the sheet a centred dialog at the same breakpoint', () => {
    expect(primitives).toMatch(/@media \(min-width: 48rem\)/)
  })

  it('opts the timeline out of the two-column grid', () => {
    // A Gantt wants the full width; a 23rem aside beside it leaves the bars unreadable.
    expect(app).toContain('.shell--wide')
  })

  it('un-stickies the aside in one-column mode', () => {
    // THE bug this app shipped. `--wide` is one column, so the aside and the main are
    // stacked ROWS — and a sticky element in a stack does not sit beside the content, it
    // floats over it. Scrolling the timeline dragged the summary card down across the rows
    // and drew it on top of them, text over text.
    const wide = /\.shell--wide \.shell__aside \{([^}]*)\}/.exec(app)
    expect(wide, '.shell--wide .shell__aside rule is missing').toBeTruthy()
    expect(wide[1]).toMatch(/position: static/)
    // And it must come after the sticky rule, or it loses the cascade.
    expect(app.indexOf('.shell--wide .shell__aside')).toBeGreaterThan(
      app.indexOf('.shell__aside {'),
    )
  })

  it('sizes the timeline gutter fluidly rather than adding a breakpoint', () => {
    // A stepped gutter wanted a third breakpoint; clamp() gets the same result — narrow on
    // a phone where the bars matter more than the labels, wide on a monitor where the
    // labels are read — without one.
    const timeline = /\n\.timeline \{([^}]*)\}/.exec(app)[1]
    expect(timeline).toMatch(/--timeline-gutter: clamp\(/)
    expect(timeline).toMatch(/overflow: auto/)
  })

  it('caps the timeline height so its axis can stick', () => {
    // Sticky resolves against the nearest scrollport. Without a height cap the timeline IS
    // its own content's height, nothing ever scrolls inside it, and the axis never sticks —
    // which leaves row thirty with no axis in sight.
    expect(app).toMatch(/\.timeline \{[^}]*overflow: auto/)
    expect(app).toMatch(/max-height: max\(24rem/)
    const axis = /\.timeline__axis \{([^}]*)\}/.exec(app)[1]
    expect(axis).toMatch(/position: sticky/)
    expect(axis).toMatch(/top: 0/)
    // Opaque, or rows show through it as they pass behind.
    expect(axis).toMatch(/background-color: var\(--surface\)/)
  })

  it('draws month gridlines, solid and one step off the surface', () => {
    // Without these a bar's position is unreadable: the axis is at the top and the row
    // somebody cares about is hundreds of pixels below it.
    const gridline = /\.timeline__gridline \{([^}]*)\}/.exec(app)[1]
    expect(gridline).toMatch(/width: 1px/)
    expect(gridline).toMatch(/background-color: var\(--line\)/)
    expect(gridline).not.toMatch(/dashed/)
  })

  it('gives the today rule the accent, and the gridlines do not compete with it', () => {
    const now = /\.timeline__now \{([^}]*)\}/.exec(app)[1]
    expect(now).toMatch(/background-color: var\(--accent\)/)
    expect(now).toMatch(/width: 2px/)
  })
})

describe('motion', () => {
  it('zeroes the tokens under reduced motion', () => {
    // The authoritative mechanism, which is what lets the app avoid !important.
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(tokens)[1]
    expect(block).toContain('--transition-fast')
    expect(block).toContain('--transition-base')
  })

  it('guards every keyframe animation behind no-preference', () => {
    for (const match of primitives.matchAll(/@keyframes\s+([\w-]+)/g)) {
      const before = primitives.slice(0, match.index)
      expect(
        before.lastIndexOf('prefers-reduced-motion: no-preference'),
        `@keyframes ${match[1]} is not guarded`,
      ).toBeGreaterThan(-1)
    }
  })

  it('transitions only cheap, non-layout properties', () => {
    for (const match of all.matchAll(/transition:\s*([^;]+);/g)) {
      const declaration = match[1]
      if (declaration.includes('var(--transition')) continue
      expect(declaration, 'never transition all/width/height/box-shadow').not.toMatch(
        /\ball\b|\bwidth\b|\bheight\b|box-shadow/,
      )
    }
  })

  it('uses the tokens rather than hardcoding a duration', () => {
    // A hardcoded duration silently opts out of the reduced-motion support above.
    for (const match of all.matchAll(/transition:\s*([^;]+);/g)) {
      expect(match[1], match[0]).toMatch(/var\(--transition-(fast|base)\)/)
    }
  })
})

describe('specificity', () => {
  it('uses no IDs and no !important', () => {
    expect(all).not.toContain('!important')
    expect(all).not.toMatch(/^#[\w-]+\s*\{/m)
  })
})

describe('index.html', () => {
  it('does NOT allow the Sheets API, because the browser never holds a token', () => {
    // The load-bearing consequence of this architecture: reads go through the script, so
    // a view-only visitor needs no credential. Adding this host back means the security
    // model in README is no longer true.
    expect(csp).not.toContain('sheets.googleapis.com')
  })

  it('allows both Apps Script hosts and nothing else', () => {
    const connect = /connect-src([^;]*);/.exec(csp)[1]
    expect(connect).toContain('https://script.google.com')
    // /exec answers with a 302 to this one, so it is not redundant.
    expect(connect).toContain('https://script.googleusercontent.com')
    expect(connect.match(/https:\/\//g)).toHaveLength(2)
  })

  it('runs no third-party script and frames nothing', () => {
    expect(csp).toMatch(/script-src 'self'/)
    expect(csp).toMatch(/frame-src 'none'/)
    expect(csp).not.toMatch(/unsafe-eval/)
  })

  it('opts into the safe areas the tokens expose', () => {
    expect(html).toContain('viewport-fit=cover')
    expect(tokens).toContain('env(safe-area-inset-top')
  })

  it('carries the Home Screen tags Safari still reads', () => {
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('apple-touch-icon')
    expect(html).toContain('rel="manifest"')
  })
})

describe('the manifest', () => {
  it('omits start_url on purpose', () => {
    // With one, iOS installs the manifest's URL instead of what is on screen, and the
    // `#k=…` fragment an editor installed from is lost — see src/lib/access.js.
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
    expect(manifest).not.toHaveProperty('start_url')
    expect(manifest.display).toBe('standalone')
  })

  it('declares both an any and a maskable icon at each size', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
    for (const size of ['192x192', '512x512']) {
      const purposes = manifest.icons
        .filter((icon) => icon.sizes === size)
        .map((icon) => icon.purpose)
      expect(purposes.sort(), size).toEqual(['any', 'maskable'])
    }
  })
})
