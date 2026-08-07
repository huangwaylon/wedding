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

/**
 * The declarations of one rule, matched on a WHOLE selector at the start of a line.
 *
 * An unanchored `.timeline__label {` also matches `.timeline__row:hover .timeline__label {`,
 * so three of these assertions were reading a hover rule and passing for the wrong reason.
 */
function ruleFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Comments stripped for the same reason as `code`: several of these rules explain the thing
  // they are avoiding ("--ink-3, not opacity: 0.75"), and a raw match reads the prose.
  const found = new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm').exec(code(css))
  return found ? found[1] : null
}

/** The bodies of every `@media (min-width: Nrem)` block, brace-counted rather than lazily. */
function blocksOf(css, rem) {
  const opener = `@media (min-width: ${rem}rem) {`
  const blocks = []
  let from = 0
  for (;;) {
    const start = css.indexOf(opener, from)
    if (start < 0) break
    let depth = 0
    let index = start + opener.length - 1
    do {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
      index += 1
    } while (depth > 0 && index < css.length)
    blocks.push(css.slice(start, index))
    from = index
  }
  return blocks
}

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

  it('lets a meter with a mark show it escaping the bar', () => {
    // The tick is taller than the track so its ends sit against the card; clipping it
    // would hide exactly the part that makes it readable. It rides on `--marked` rather than
    // on `--lg` because a task row is 8px tall and now carries one too.
    expect(/\.meter--marked \{([^}]*)\}/.exec(primitives)[1]).toMatch(/overflow: visible/)
  })

  it('does not transition the fill', () => {
    // It advances on its own once a minute; an animation would make it look like a
    // control responding to a tap.
    expect(/\.meter__fill \{([^}]*)\}/.exec(primitives)[1]).not.toContain('transition')
  })
})

/** Every state's entry in the one table, keyed on the state name. */
function stateEntry(state) {
  const found = new RegExp(`\\.badge--${state},[\\s\\S]*?\\{([^}]*)\\}`).exec(code(primitives))
  return found ? found[1] : null
}

describe('the state table', () => {
  it('maps every state exactly once, in one place', () => {
    // Four families — the badge's wash, its dot, the standalone dot, a meter fill — plus the
    // timeline bar used to restate this same mapping in nineteen blocks across two files.
    for (const state of ['done', 'overdue', 'active', 'upcoming', 'unscheduled']) {
      const entry = stateEntry(state)
      expect(entry, `${state} has no entry`).toBeTruthy()
      expect(entry, `${state} sets no fill`).toMatch(/--state-fill:/)
      expect(entry, `${state} sets no wash`).toMatch(/--state-wash:/)
    }
  })

  it('covers `unscheduled`, which had no rule at all', () => {
    // StateBadge builds `badge--${state}` for EVERY state, so this one was rendered with no
    // matching rule and its dot fell back to currentColor — grey, but a different grey from
    // every other unstarted state.
    expect(stateEntry('unscheduled')).toMatch(/--state-fill: var\(--ink-4\)/)
  })

  it('is read by every mark that carries state', () => {
    expect(ruleFor(primitives, '.badge')).toMatch(/background-color: var\(--state-wash,/)
    expect(ruleFor(primitives, '.badge__dot')).toMatch(/background-color: var\(--state-fill,/)
    expect(ruleFor(primitives, '.dot')).toMatch(/background-color: var\(--state-fill,/)
    expect(ruleFor(primitives, '.meter__fill')).toMatch(/background-color: var\(--state-fill,/)
    expect(ruleFor(app, '.timeline__bar-fill')).toMatch(/background-color: var\(--state-fill,/)
  })

  it('falls back rather than painting nothing for a state it has never heard of', () => {
    // A new state name must degrade to the neutral treatment, not to `transparent`.
    expect(ruleFor(primitives, '.badge')).toMatch(/var\(--neutral-wash\)\)/)
    expect(ruleFor(primitives, '.dot')).toMatch(/var\(--ink-4\)\)/)
    expect(ruleFor(primitives, '.meter__fill')).toMatch(/var\(--accent\)\)/)
  })

  it('never puts a state colour on type', () => {
    // The wash carries the tint; the label stays ink. One of the state colours cannot clear
    // 4.5:1 on white, which is the whole reason the badge pattern exists.
    expect(ruleFor(primitives, '.badge')).toMatch(/color: var\(--ink-2\)/)
    for (const state of ['done', 'overdue', 'active', 'upcoming', 'unscheduled']) {
      expect(stateEntry(state), state).not.toMatch(/[^-]color:/)
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

describe('touch ergonomics', () => {
  it('separates the two stacks below the two-column breakpoint', () => {
    // THE reported bug. `.stack`'s gap applies inside each stack only, and `.shell` was a plain
    // block below 62rem, so the summary card's bottom hairline and the first filter chip's top
    // edge touched at 0px — which is what made the chips read as welded to the card. It was
    // never the chips' own padding.
    const shell = ruleFor(app, '.shell')
    expect(shell).toMatch(/display: flex/)
    expect(shell).toMatch(/flex-direction: column/)
    expect(shell).toMatch(/gap: var\(--space-4\)/)
  })

  it('gives the filter chips the full tap target', () => {
    // 36px is 8px under the platform minimum, and these are the primary controls on a phone.
    expect(ruleFor(primitives, '.chip')).toMatch(/min-height: var\(--tap-target\)/)
  })

  it('draws a control boundary the eye can find', () => {
    // 1.4.11 wants 3:1 for the boundary identifying a control; --line measures ~1.2:1, which
    // left the chips reading borderless beside the compliant buttons next to them.
    expect(ruleFor(primitives, '.chip')).toMatch(/border: 1px solid var\(--line-input\)/)
  })

  it('makes a disabled chip look disabled', () => {
    // `opacity: 0.5` was scoped to `.btn[disabled]`, so a dead zero-count filter was
    // pixel-identical to a live one.
    expect(primitives).toMatch(/\.chip\[disabled\] \{[^}]*opacity/)
  })

  it('does not dim the chip count with opacity', () => {
    // 0.75 of --ink-2 composites to 4.15:1 at 13px, under the 4.5:1 floor every ink in
    // tokens.css is measured against — and the count is the reason the chip earns its space.
    const count = ruleFor(primitives, '.chip__count')
    expect(count).not.toMatch(/opacity/)
    expect(count).toMatch(/color: var\(--ink-3\)/)
  })

  it('keeps the two row icon buttons apart, one of them being destructive', () => {
    // 4px was the tightest interactive adjacency in the app, between Edit and Delete.
    expect(ruleFor(app, '.task__actions')).toMatch(/gap: var\(--space-2\)/)
  })

  it('gives the check toggle the full target', () => {
    // The primary interaction of the app was a 36px square in the corner of a ~110px card.
    const check = ruleFor(app, '.task__check')
    expect(check).toMatch(/width: var\(--tap-target\)/)
    expect(check).toMatch(/min-height: var\(--tap-target\)/)
  })

  it('keeps the sheet footer reachable with the keyboard up', () => {
    // iOS defaults to `resizes-visual`: the keyboard changes neither the layout viewport nor
    // `dvh`, so Save sat under ~340px of keyboard with no way to reach it.
    expect(html).toContain('interactive-widget=resizes-content')
    expect(ruleFor(primitives, '.sheet__foot')).toMatch(/position: sticky/)
  })

  it('contains the overscroll of the sheet body', () => {
    expect(ruleFor(primitives, '.sheet__body')).toMatch(/overscroll-behavior: contain/)
  })

  it('keeps the toast clear of the FAB', () => {
    // --z-toast is above --z-fab, so a full-width toast hid the button behind every "Saved".
    expect(ruleFor(primitives, '.toasts')).toMatch(/--fab-size/)
  })
})

describe('layout', () => {
  it('reserves clearance for the FAB so it cannot cover the last row', () => {
    // Dropping this reservation in the two-column block is exactly how the button once
    // landed on a row's delete control in the sibling app.
    expect(/\.shell \{([^}]*)\}/.exec(app)[1]).toMatch(/padding-bottom:.*--fab-size/)
  })

  it('has only the two documented breakpoints, across EVERY stylesheet', () => {
    // `app` alone was scanned, and `primitives.css` has a 48rem block of its own — so a third
    // breakpoint added anywhere but `app.css` would not have failed the build, while CLAUDE.md
    // claimed this pinned it. `all` is every sheet with comments stripped.
    const widths = new Set([...all.matchAll(/@media \(min-width: ([\d.]+rem)\)/g)].map((m) => m[1]))
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
    const timeline = ruleFor(app, '.timeline')
    expect(timeline).toMatch(/--timeline-gutter: clamp\(/)
    expect(timeline).toMatch(/overflow: auto/)
  })

  it('never fades the chart edge', () => {
    // A mask was added as a "more to the right" hint and it misrepresented the data: a bar
    // ending near the edge faded out, so its end read as further right than it is. And at 1x the
    // plot now fits the container exactly, so a fade would promise content that is not there.
    expect(all).not.toMatch(/mask-image/)
  })

  it('caps the timeline height at every width, so its axis always sticks', () => {
    // Sticky resolves against the nearest scrollport. Without a height cap the timeline IS
    // its own content's height, nothing ever scrolls inside it, and the axis never sticks —
    // which left row thirty with no axis in sight.
    //
    // And the cap must NOT be behind a width breakpoint. 48rem is 768px; an iPhone 15 in
    // landscape is 852px wide, so a width-gated rule gave the phone a 384px nested scroller
    // inside a 393px viewport — the exact trap it was written to avoid — while portrait got
    // no cap at all.
    const timeline = /\n\.timeline \{([^}]*)\}/.exec(app)[1]
    expect(timeline).toMatch(/overflow: auto/)
    expect(timeline).toMatch(/max-height: max\(20rem, 70dvh\)/)

    // Scoped to the media block's own body. A lazy [\s\S]*? here escapes the block and
    // matches the base rule hundreds of lines later, which is a test that always passes.
    for (const block of blocksOf(app, 48)) {
      expect(block, 'the timeline height cap must not be width-gated').not.toMatch(
        /\.timeline \{[^}]*max-height/,
      )
    }

    const axis = /\.timeline__axis \{([^}]*)\}/.exec(app)[1]
    expect(axis).toMatch(/position: sticky/)
    expect(axis).toMatch(/top: 0/)
    // Opaque, or rows show through it as they pass behind.
    expect(axis).toMatch(/background-color: var\(--surface\)/)
  })

  it('pins the label gutter so names survive a horizontal pan', () => {
    // Pan right without this and you are reading fifty anonymous bars.
    for (const selector of ['.timeline__label', '.timeline__axis-gutter']) {
      const rule = ruleFor(app, selector)
      expect(rule, `${selector} rule missing`).toBeTruthy()
      expect(rule, `${selector} is not pinned`).toMatch(/position: sticky/)
      expect(rule, `${selector} has no left edge`).toMatch(/left: 0/)
      // Transparent would let the panning bars show straight through the names.
      expect(rule, `${selector} is not opaque`).toMatch(/background-color: var\(--surface\)/)
    }
  })

  it('uses flex rows, not grid, so the sticky gutter can travel', () => {
    // A sticky element is clamped to its containing block, and a GRID item's containing block
    // is its own grid area — exactly the gutter's width, so nothing to travel within. A flex
    // item's containing block is the flex container's content box.
    for (const selector of ['.timeline__axis', '.timeline__row']) {
      const rule = ruleFor(app, selector)
      expect(rule, `${selector} should be flex`).toMatch(/display: flex/)
      expect(rule, `${selector} must not be grid`).not.toMatch(/grid-template-columns/)
    }
    // The gutter is now a flex-basis, and both sides still resolve the same custom property.
    expect(ruleFor(app, '.timeline__label')).toMatch(/flex: 0 0 var\(--timeline-gutter\)/)
    expect(ruleFor(app, '.timeline__axis-gutter')).toMatch(/flex: 0 0 var\(--timeline-gutter\)/)
  })

  it('drops -webkit-overflow-scrolling, which breaks sticky in the same scroller', () => {
    // A no-op for momentum since iOS 13, and the legacy implementation created its own
    // stacking context and broke `position: sticky` inside the scroller — now load-bearing
    // twice over, for the axis and for the gutter.
    expect(all).not.toContain('-webkit-overflow-scrolling')
  })

  it('contains only the horizontal overscroll on the timeline', () => {
    // A horizontal pan that chains becomes an iOS back-swipe. But `contain` on BOTH axes can
    // swallow a vertical drag that begins on the chart.
    const timeline = /\n\.timeline \{([^}]*)\}/.exec(app)[1]
    expect(timeline).toMatch(/overscroll-behavior-x: contain/)
    expect(timeline).not.toMatch(/overscroll-behavior: contain/)
  })

  it('scales the plot by a zoom multiplier and nothing else', () => {
    // Zoom must change the plot's WIDTH, never the plan window: narrowing the window would
    // clamp out-of-range bars to the edges, so a task running past the edge would look like it
    // ends there, and `min-width: 4px` would render every out-of-window task as a phantom stub.
    expect(ruleFor(app, '.timeline__inner')).toMatch(
      /width: calc\(100% \* var\(--timeline-zoom\)\)/,
    )
    expect(ruleFor(app, '.timeline')).toMatch(/--timeline-zoom: 1/)
  })

  it('scales WIDTH, not just min-width, or the low zoom steps do nothing', () => {
    // A `min-width` floor below the container's own width has no effect, so on a ~1200px window
    // 1x, 1.5x and 2x all rendered identically and 3x was the first step that bound. The floor
    // stays for the narrow case, but the width is what makes each step change.
    const inner = ruleFor(app, '.timeline__inner')
    expect(inner).toMatch(/^\s*width: calc\(100% \* var\(--timeline-zoom\)\);$/m)
    expect(inner).toMatch(/min-width: calc\(34rem \* var\(--timeline-zoom\)\)/)
  })

  it('keeps the zoom toolbar outside the scroller', () => {
    // Inside it, the controls would scroll away with the chart.
    expect(app).toContain('.timeline__toolbar')
    const toolbar = /\.timeline__toolbar \{([^}]*)\}/.exec(app)[1]
    expect(toolbar).not.toMatch(/position: sticky/)
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

describe('the header', () => {
  it('never lets the countdown wrap or shrink', () => {
    // With a long venue name and the View only badge sharing the row, "427 days to go" broke
    // across two lines and grew the header an entire row on a 393px phone. The countdown is the
    // one number up there; the venue is what gives way.
    const count = ruleFor(app, '.header__count')
    expect(count, '.header__count rule missing').toBeTruthy()
    expect(count).toMatch(/flex: none/)
    expect(count).toMatch(/white-space: nowrap/)

    const venue = ruleFor(app, '.header__sub-text')
    expect(venue).toMatch(/min-width: 0/)
    expect(venue).toMatch(/text-overflow: ellipsis/)
    // A flex item cannot shrink past its content without this on the container.
    expect(ruleFor(app, '.header__sub')).toMatch(/min-width: 0/)
  })
})

describe('subtasks on the timeline', () => {
  it('draws a subtask as a 1px rail, never as a bar', () => {
    // A subtask has no dates, so it has no extent of its own to draw. The rail says the one
    // thing the model does hold — that it happens inside its parent's window — and it has to be
    // impossible to mistake for a bar: 1px against the bar's 8px, square against its pill, and
    // no fill at all.
    const rail = ruleFor(app, '.timeline__sub-rail')
    expect(rail, '.timeline__sub-rail rule missing').toBeTruthy()
    expect(rail).toMatch(/height: 1px/)
    expect(rail).not.toMatch(/border-radius/)
    expect(rail).not.toMatch(/--state-fill/)
  })

  it('draws that rail in --track-line, not --line', () => {
    // It is the child row's ONLY mark, and --line measures 1.2:1 on the surface — the same
    // defect that made the meter's hairline draw nothing whatsoever.
    expect(ruleFor(app, '.timeline__sub-rail')).toMatch(/background-color: var\(--track-line\)/)
  })

  it('never colours the tally', () => {
    // A 5/5 in the done colour would claim a `done_at` the sheet does not have: all subtasks
    // done deliberately does not make a parent done.
    const tally = ruleFor(app, '.timeline__label-tally')
    expect(tally, '.timeline__label-tally rule missing').toBeTruthy()
    expect(tally).toMatch(/color: var\(--ink-3\)/)
    expect(tally).not.toMatch(/--good|--critical|--accent/)
  })

  it('keeps the label stack free of block padding', () => {
    // The gutter grows by CONTENT. Block padding there reintroduces the band the plot shows
    // through behind the sticky label, which is the row-gap defect.
    expect(ruleFor(app, '.timeline__label-stack')).not.toMatch(/padding/)
  })

  it('widens the gutter from the same variable rather than a third breakpoint', () => {
    // The titles are the content while the outline is open, so the column holding them earns
    // more room — but as one variable, not a media query. There are exactly two breakpoints.
    expect(ruleFor(app, '.timeline--outline')).toMatch(
      /--timeline-gutter: var\(--timeline-gutter-open\)/,
    )
    expect(ruleFor(app, '.timeline')).toMatch(/--timeline-gutter-open: clamp\(/)
  })

  it('gives the whole subtask row a target in the list', () => {
    // Only the 44px circle was live, so a tap on the title — the obvious place to aim on a
    // checklist — did nothing at all.
    const toggle = ruleFor(app, '.subtask__toggle')
    expect(toggle, '.subtask__toggle rule missing').toBeTruthy()
    expect(toggle).toMatch(/flex: 1/)
    expect(toggle).toMatch(/min-height: var\(--tap-target\)/)
  })

  it('ties the checklist to its parent with one vertical rule and no horizontal ones', () => {
    const list = ruleFor(app, '.subtasks')
    expect(list).toMatch(/border-inline-start: 1px solid var\(--line\)/)
    expect(list).not.toMatch(/border-block|border-top|border-bottom/)
  })
})
