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
 * An unanchored `.subtask__title {` also matches `.subtask--done .subtask__title {`, and an
 * unanchored `.meter {` matches `.tcard__bar > .meter {` — so an assertion about the base
 * rule reads a descendant's body instead and passes for the wrong reason.
 */
function ruleFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Comments stripped for the same reason as `code`: several of these rules explain the thing
  // they are avoiding ("--ink-3, not opacity: 0.75"), and a raw match reads the prose.
  const found = new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm').exec(code(css))
  return found ? found[1] : null
}

/**
 * Every block opened by `opener`, brace-counted rather than matched lazily.
 *
 * A `[\s\S]*?` inside a conditional group escapes the group and matches the base rule
 * hundreds of lines further down, which turns a scoped assertion into one that always
 * passes. Both `@media` and `@supports` scopes here are read through this.
 */
function blocksAfter(css, opener) {
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

/** The bodies of every `@media (min-width: Nrem)` block. */
function blocksOf(css, rem) {
  return blocksAfter(css, `@media (min-width: ${rem}rem) {`)
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
    // which left an empty bar held up by the fill step alone. There is exactly one bar in the
    // app now — a task card's is a `Meter` too, rendered as spans — so this is a
    // primitives-only assertion and `.meter` is the only rule that can regress it.
    expect(tokens).toMatch(/--track-line:/)
    expect(ruleFor(primitives, '.meter')).toMatch(/border: 1px solid var\(--track-line\)/)
    // And nothing may outline a track in --line behind its back.
    expect(ruleFor(primitives, '.meter')).not.toMatch(/border: 1px solid var\(--line\)/)
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

/**
 * One state's row in the one table: the rest of its selector list, and its body.
 *
 * Matched from the END of the previous rule, so `.badge--<state>` has to come FIRST in the
 * list. That pins the table's shape as well as its contents: anchoring on a line start
 * instead lets a family be inserted in front of the badge, and then the badge is reading a
 * list it no longer heads.
 */
function stateRow(state) {
  const found = new RegExp(`(?:^|\\})\\s*(\\.badge--${state},[^{}]*)\\{([^}]*)\\}`).exec(
    code(primitives),
  )
  return found ? { selectors: found[1], body: found[2] } : null
}

/** Every state's entry in the one table, keyed on the state name. */
function stateEntry(state) {
  const row = stateRow(state)
  return row ? row.body : null
}

const STATES = ['done', 'overdue', 'active', 'upcoming', 'unscheduled']

describe('the state table', () => {
  it('maps every state exactly once, in one place', () => {
    // Four families — the badge's wash, its dot, the standalone dot, a meter fill — plus the
    // task card, which used to restate this same mapping in nineteen blocks across two files.
    for (const state of STATES) {
      const entry = stateEntry(state)
      expect(entry, `${state} has no entry`).toBeTruthy()
      expect(entry, `${state} sets no fill`).toMatch(/--state-fill:/)
      expect(entry, `${state} sets no wash`).toMatch(/--state-wash:/)
    }
  })

  it('lists the card alongside the other families, from the same row', () => {
    // A card is a mark that carries state: `.tcard--<state>` sets the two properties at the
    // card's root so anything inside it — the node on the spine, the meter in the head —
    // resolves them without a second mapping. A family with its own block is how the two
    // copies drift.
    for (const state of STATES) {
      expect(stateRow(state).selectors, `${state} does not reach the card`).toContain(
        `.tcard--${state}`,
      )
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
    // Every one of them is a primitive, which is the point: app.css paints no state colour of
    // its own. A hue hardcoded onto a card mark would be a second palette for the same claim.
    for (const state of STATES) {
      expect(app, `${state} is painted outside the table`).not.toMatch(
        new RegExp(`\\.tcard--${state}[^{]*\\{[^}]*--state-(fill|wash):`),
      )
    }
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
    for (const state of STATES) {
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

  it('lets the select and the notes field inherit that floor rather than restating it', () => {
    // Both are worn WITH `.input`, so the 16px comes from one place. A font-size of their own
    // is how one control ends up under the floor and zooms the viewport on focus: browsers
    // default a textarea to 13px monospace, which is the value somebody would be "restoring".
    for (const selector of ['.select', '.textarea']) {
      const rule = ruleFor(primitives, selector)
      expect(rule, `${selector} rule missing`).toBeTruthy()
      expect(rule, `${selector} must not set its own font-size`).not.toContain('font-size')
      expect(rule, `${selector} must not set its own family`).not.toContain('font-family')
    }
    // Wrapped prose is the one thing in the app that has to hold Japanese across lines.
    expect(ruleFor(primitives, '.textarea')).toMatch(/line-height: var\(--lh-body\)/)
  })
})

describe('elevation', () => {
  it('uses a shadow in exactly the three places it is allowed', () => {
    // Exact-set equality, not a subset: a shadow added to a fourth thing has to fail here,
    // and `toContain` on a set is an assertion that can only ever pass.
    const users = [...all.matchAll(/([.#][\w-]+)[^{}]*\{[^}]*box-shadow: var\(--shadow-/g)].map(
      (match) => match[1],
    )
    expect(new Set(users)).toEqual(new Set(['.fab', '.sheet__panel', '.toast']))
  })

  it('holds the tab bar up with a hairline and a blur, not a shadow', () => {
    // A fixed bar over scrolling content is the obvious place to reach for elevation. The
    // separation here is the top hairline plus the blur behind it — a shadow under a
    // translucent bar reads as a second, darker bar.
    const tabbar = ruleFor(app, '.tabbar')
    expect(tabbar, '.tabbar rule missing').toBeTruthy()
    expect(tabbar).toMatch(/border-top: 1px solid var\(--line\)/)
    expect(tabbar).toMatch(/backdrop-filter: blur\(/)
    expect(tabbar).not.toContain('box-shadow')
  })

  it('adds no shadow on hover', () => {
    expect(all).not.toMatch(/:hover[^{]*\{[^}]*box-shadow: var\(--shadow-/)
  })

  it('gives the card a hairline instead of an elevation', () => {
    const card = /\n\.card \{([^}]*)\}/.exec(primitives)[1]
    expect(card).toMatch(/border: 1px solid var\(--line\)/)
    expect(card).not.toContain('box-shadow')
  })

  it('gives a task card the same hairline, since it is a card without the class', () => {
    // `.tcard` is its own surface rather than `.card` — it has a grid, a spine and a
    // two-token asymmetric padding — so the no-shadow rule has to be pinned twice.
    const tcard = ruleFor(app, '.tcard')
    expect(tcard, '.tcard rule missing').toBeTruthy()
    expect(tcard).toMatch(/border: 1px solid var\(--line\)/)
    expect(tcard).not.toContain('box-shadow')
  })
})

describe('touch ergonomics', () => {
  it('separates everything in a view from everything else in it', () => {
    // THE reported bug. The one column is a stack of unrelated blocks — hero, summary, chips,
    // cards — and the gap between them is the only thing holding them apart: with the view a
    // plain block, the summary card's bottom hairline and the first filter chip's top edge
    // touched at 0px, which is what made the chips read as welded to the card. It was never
    // the chips' own padding.
    const stack = ruleFor(app, '.stack')
    expect(stack, '.stack rule missing').toBeTruthy()
    expect(stack).toMatch(/display: flex/)
    expect(stack).toMatch(/flex-direction: column/)
    expect(stack).toMatch(/gap: var\(--space-4\)/)
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
    // The tightest interactive adjacency left in the app, between a checklist item's toggle
    // and its delete button — and 4px between "tick it" and "delete it" is how the wrong one
    // gets pressed on a moving bus.
    expect(ruleFor(app, '.subtask')).toMatch(/gap: var\(--space-2\)/)
  })

  it('gives the check toggle the full target', () => {
    // The primary interaction of the app was a 36px square in the corner of a ~110px card. It
    // is a SIBLING of the head button, not a child — a button inside a button is dropped by
    // the parser — so it carries its own target.
    const check = ruleFor(app, '.tcard__check')
    expect(check, '.tcard__check rule missing').toBeTruthy()
    expect(check).toMatch(/width: var\(--tap-target\)/)
    expect(check).toMatch(/min-height: var\(--tap-target\)/)
  })

  it('gives the whole collapsed row a target too', () => {
    // The head is one control for the entire row, so it cannot be shorter than the check
    // beside it: a 28px band of card between two 44px targets is a dead strip in the middle
    // of the one thing on screen worth tapping.
    expect(ruleFor(app, '.tcard__head')).toMatch(/min-height: var\(--tap-target\)/)
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
  it('reserves clearance for the tab bar and the FAB so neither covers the last card', () => {
    // The two fixed things at the bottom of the screen are reserved ONCE, by the views
    // wrapper, and every tab inherits it. Dropping the reservation is exactly how the button
    // once landed on top of a row's delete control in the sibling app.
    const views = ruleFor(app, '.views')
    expect(views, '.views rule missing').toBeTruthy()
    // [\s\S], not `.`: the calc wraps across three lines, and a `.`-based regex silently
    // stops at the first newline and reports the reservation as missing.
    const clearance = /padding-bottom:([\s\S]*?);/.exec(views)
    expect(clearance, '.views reserves no bottom clearance').toBeTruthy()
    expect(clearance[1]).toContain('--tabbar-height')
    expect(clearance[1]).toContain('--fab-size')
    expect(clearance[1]).toContain('--safe-bottom')

    // And no width may take it away again. Scoped to the media block's own body, brace
    // counted: a lazy [\s\S]*? escapes the block and matches the base rule, which is a test
    // that always passes.
    for (const block of blocksOf(app, 48)) {
      expect(block, 'the FAB clearance must not be width-gated').not.toMatch(
        /\.views \{[^}]*padding-bottom/,
      )
    }
  })

  it('keeps the one column capped and centred, at every width', () => {
    // A planner's 27" screen gets more paper on either side, never a second column: at 60rem
    // a card's title and its dates drift apart into a thin strip with a canyon between them.
    expect(tokens).toMatch(/--column-max: 40rem/)
    expect(ruleFor(app, '.views')).toMatch(/max-width: var\(--column-max\)/)
    expect(ruleFor(app, '.views')).toMatch(/margin: 0 auto/)
    // The fixed bar is not inside `.views`, so it has to repeat the cap or its two tabs
    // stretch across a monitor while the content they switch sits in a 40rem column.
    expect(ruleFor(app, '.tabbar__inner')).toMatch(/max-width: var\(--column-max\)/)
  })

  it('has only the ONE documented breakpoint, across EVERY stylesheet', () => {
    // Exact-set equality. `app` alone was scanned once, and `primitives.css` has a 48rem block
    // of its own — so a second breakpoint added anywhere but `app.css` would not have failed
    // the build. A subset check here is an assertion that always passes. `all` is every sheet
    // with comments stripped.
    const widths = new Set([...all.matchAll(/@media \(min-width: ([\d.]+rem)\)/g)].map((m) => m[1]))
    expect([...widths].sort()).toEqual(['48rem'])
  })

  it('makes the sheet a centred dialog at that same breakpoint', () => {
    expect(primitives).toMatch(/@media \(min-width: 48rem\)/)
  })

  it('sizes the hero with a clamp rather than a second breakpoint', () => {
    // The photograph is the one thing whose height depends on the viewport, and a stepped
    // height wanted breakpoints of its own. A clamp gets the same result — a band on a phone,
    // a plate on a monitor — with the single 48rem query doing nothing but the corners.
    expect(ruleFor(app, '.hero')).toMatch(/height: clamp\(/)
    expect(tokens).toMatch(/--fs-display: clamp\(/)
  })

  it('drops -webkit-overflow-scrolling, which breaks sticky in the same scroller', () => {
    // A no-op for momentum since iOS 13, and the legacy implementation created its own
    // stacking context and broke `position: sticky` inside the scroller — still load-bearing
    // for the sheet's own sticky footer.
    expect(all).not.toContain('-webkit-overflow-scrolling')
  })

  it('stitches the spine across exactly the gap it has to cross', () => {
    // The spine is drawn per CARD and reaches into the gap below it, because one line spanning
    // the group would run behind the month heading. The reach and the group's gap are therefore
    // the same token by necessity: shorter and the segments visibly do not meet, longer and the
    // line crosses the heading it was drawn this way to avoid.
    expect(ruleFor(app, '.plan__group')).toMatch(/gap: var\(--space-3\)/)
    expect(ruleFor(app, '.tcard::before')).toMatch(/bottom: calc\(var\(--space-3\) \* -1\)/)
    // And nothing hangs off the last card: a line running past the last node reads as a plan
    // that continues somewhere off screen.
    expect(ruleFor(app, '.tcard:last-of-type::before')).toMatch(/bottom: 0/)
  })

  it('contains only the horizontal overscroll on the chip row', () => {
    // The chips are the one horizontal scroller left, and a horizontal pan that chains becomes
    // an iOS back-swipe. But `contain` on BOTH axes swallows the vertical drag that begins on
    // the row — which is the top of the list, where a thumb lands first.
    const chips = ruleFor(app, '.chips')
    expect(chips, '.chips rule missing').toBeTruthy()
    expect(chips).toMatch(/overscroll-behavior-x: contain/)
    expect(chips).not.toMatch(/overscroll-behavior: contain/)
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
    // Per sheet, never over the joined text: `all` is four files concatenated, so a guard in
    // primitives.css would vouch for an unguarded @keyframes in app.css.
    for (const [name, css] of Object.entries({ tokens, base, primitives, app })) {
      const source = code(css)
      for (const match of source.matchAll(/@keyframes\s+([\w-]+)/g)) {
        const before = source.slice(0, match.index)
        expect(
          before.lastIndexOf('prefers-reduced-motion: no-preference'),
          `@keyframes ${match[1]} in ${name}.css is not guarded`,
        ).toBeGreaterThan(-1)
      }
    }
  })

  it('transitions only cheap, non-layout properties', () => {
    // Every transition in the app names its duration with a token, so a scan that skips those
    // declarations checks nothing at all: `transition: max-height var(--transition-base)` — the
    // exact thrash this forbids — sails straight through it. The PROPERTY is what is being
    // tested, not the timing, so every declaration is read whatever its duration says. The
    // count is the guard against the whole scan finding nothing to look at.
    const declarations = [...all.matchAll(/transition(?:-property)?:\s*([^;]+);/g)]
    expect(declarations.length, 'the transition scan found nothing to scan').toBeGreaterThan(5)
    for (const match of declarations) {
      expect(match[1], 'never transition all/width/height/max-height/box-shadow').not.toMatch(
        /\ball\b|\bwidth\b|\bmax-height\b|\bheight\b|box-shadow/,
      )
    }
  })

  it('does not animate the accordion open on a layout property', () => {
    // An open card mounts its fields; a `height` or `max-height` transition on that is a
    // reflow per frame of every card below it, and it cannot animate to `auto` anyway, so the
    // measured version reads as a jump followed by a slide. The chevron carries the motion.
    // `\bheight\b` matches inside `max-height`, but naming both is what makes the failure
    // message say which one somebody reached for. [^;{}] so the scan cannot run out of the
    // declaration and read the next rule's.
    expect(all, 'no card may transition its own height').not.toMatch(
      /transition[^;{}]*\b(max-)?height\b/,
    )
    expect(ruleFor(app, '.tcard__content')).not.toContain('transition')
    // A keyframe on the same property would be the same reflow with the test looking the
    // other way.
    expect(ruleFor(app, '.tcard__content')).not.toContain('animation')
    expect(ruleFor(app, '.tcard__chev')).toMatch(/transition: transform var\(--transition-fast\)/)
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

describe('the hero', () => {
  it('never lets the countdown wrap or shrink', () => {
    // With a long venue name and the View only badge sharing the row, "427 days to go" broke
    // across two lines and pushed the names up on a 393px phone. The countdown is the one
    // number up here; the venue is what gives way.
    const count = ruleFor(app, '.hero__count')
    expect(count, '.hero__count rule missing').toBeTruthy()
    expect(count).toMatch(/flex: none/)
    expect(count).toMatch(/white-space: nowrap/)

    const venue = ruleFor(app, '.hero__venue')
    expect(venue, '.hero__venue rule missing').toBeTruthy()
    expect(venue).toMatch(/min-width: 0/)
    expect(venue).toMatch(/text-overflow: ellipsis/)
    // A flex item cannot shrink past its content without this on the container.
    expect(ruleFor(app, '.hero__sub')).toMatch(/min-width: 0/)
  })

  it('keeps the scrim a gradient whose dense end is dark enough to read white on', () => {
    // THE contrast mechanism for every word over the photograph. The background there is
    // unknown, so the type is measured against the worst case the scrim allows — its end stop
    // composited over a blown-out white sky. Lighten that stop and the countdown fails AA over
    // a bright photo with nothing on screen saying so: at 0.55 the same case measures 4.07:1.
    const scrim = /--photo-scrim:([^;]*);/.exec(code(tokens))
    expect(scrim, '--photo-scrim missing').toBeTruthy()
    expect(scrim[1], 'a flat fill would darken the faces as much as the type').toContain(
      'linear-gradient',
    )
    expect(scrim[1], 'the dense end must be at the bottom, under the type').toMatch(/to bottom/)

    // The last stop is the one the type sits on, and it is the one the contrast script models.
    const stops = [...scrim[1].matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)\s*([\d.]+)%/g)]
    expect(stops.length, 'the scrim is not a stop list this can read').toBeGreaterThan(1)
    const dense = stops[stops.length - 1]
    expect(Number(dense[5]), 'the dense end must land where the type is').toBe(100)
    expect(Number(dense[4]), 'below 0.7 the measured worst case fails AA').toBeGreaterThanOrEqual(
      0.7,
    )
    // Dark, not a tint: the ink over it is white.
    for (const channel of [1, 2, 3]) {
      expect(Number(dense[channel]), 'the scrim must be dark').toBeLessThan(64)
    }
    expect(tokens).toMatch(/--photo-ink: #ffffff/)

    // And scripts/check-contrast.js must be modelling THIS alpha. The measurement and the
    // token drifting apart is how the paragraph above stays true while the app is not.
    const script = readFileSync('scripts/check-contrast.js', 'utf8')
    expect(script).toContain(`const SCRIM_ALPHA = ${dense[4]}`)

    // And it has to cover the whole photograph. A scrim that loses its `inset: 0` collapses to
    // nothing and takes every measurement above with it, silently: the type is still white and
    // the photo is still there.
    const scrimRule = ruleFor(app, '.hero__scrim')
    expect(scrimRule, '.hero__scrim rule missing').toBeTruthy()
    expect(scrimRule).toMatch(/background: var\(--photo-scrim\)/)
    expect(scrimRule).toMatch(/position: absolute/)
    expect(scrimRule).toMatch(/inset: 0/)
    // The shadow on the type is belt and braces for the sliver above the gradient's dense end,
    // never the mechanism — a text-shadow behind display type is a smudge, not contrast.
    expect(ruleFor(app, '.hero__title')).toMatch(/text-shadow: var\(--photo-shadow\)/)
  })

  it('carries no tracking and no tight line on the names', () => {
    // A name here can be Japanese: tracking inserts a gap between every kana, and anything
    // under 1.5 turns a wrapped 名前 into a solid block. The SIZE is what makes it read as
    // display type — a clamp, so neither of the other two is ever reached for.
    const title = ruleFor(app, '.hero__title')
    expect(title, '.hero__title rule missing').toBeTruthy()
    expect(title).not.toContain('letter-spacing')
    expect(title).not.toContain('text-transform')
    expect(title).toMatch(/line-height: var\(--lh-tight\)/)
    expect(title).toMatch(/font-size: clamp\(/)

    // No rule anywhere may spell a line-height as a bare number, which is how something under
    // 1.5 gets in without touching the tokens the assertions above read.
    const raw = [...all.matchAll(/line-height:\s*([\d.]+)\s*;/g)].map((m) => m[1])
    expect(raw, 'line-height must come from a --lh-* token').toEqual([])
  })
})

describe('the tab bar', () => {
  it('is opaque where the blur is unsupported', () => {
    // The bar is a translucent 82% wash of --bg, which over a scrolling white card is not
    // legible on its own: without this fallback the list reads straight through the two tabs.
    const fallback = blocksAfter(
      code(app),
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {',
    )
    expect(fallback.length, 'no @supports not fallback for the blur').toBe(1)
    expect(fallback[0]).toMatch(/\.tabbar \{[^}]*background-color: var\(--bg\);/)
    // Both spellings in the query, or Safari — the one platform that needs the prefix — is
    // told it has no blur and gets the opaque bar it did not need.
    expect(app).toContain('-webkit-backdrop-filter')
  })

  it('does not mark the selected tab with colour alone', () => {
    // The accent on the label is one channel; a rule on the bar's own top edge is the second,
    // and `aria-current` in TabBar.jsx is the third. Colour alone fails 1.4.1.
    const marker = ruleFor(app, '.tabbtn--on::before')
    expect(marker, '.tabbtn--on::before rule missing').toBeTruthy()
    expect(marker).toMatch(/content: ""/)
    expect(marker).toMatch(/height: 2px/)
    expect(marker).toMatch(/background-color: var\(--accent\)/)
    expect(ruleFor(app, '.tabbtn--on')).toMatch(/color: var\(--accent\)/)
  })

  it('gives each tab the full bar height and a 13px label', () => {
    // Two controls across the whole width, so the height is the only dimension that can be
    // short — and --tabbar-height is what every fixed thing above the bar composes from.
    expect(tokens).toMatch(/--tabbar-height: 3\.5rem/)
    expect(ruleFor(app, '.tabbtn')).toMatch(/min-height: var\(--tabbar-height\)/)
    expect(ruleFor(app, '.tabbtn__label')).toMatch(/font-size: var\(--fs-caption\)/)
    // The bar pads ITSELF with the inset rather than sitting above it, or the blur stops
    // short of the bottom edge of the glass and a strip of list shows under it.
    expect(ruleFor(app, '.tabbar')).toMatch(/padding-bottom: var\(--safe-bottom\)/)
    expect(ruleFor(app, '.tabbar')).toMatch(/z-index: var\(--z-tabbar\)/)
  })
})

describe('the checklist and the tally', () => {
  it('never colours the tally', () => {
    // A 5/5 in the done colour would claim a `done_at` the sheet does not have: all subtasks
    // done deliberately does not make a parent done.
    const tally = ruleFor(app, '.tcard__tally')
    expect(tally, '.tcard__tally rule missing').toBeTruthy()
    expect(tally).toMatch(/color: var\(--ink-3\)/)
    expect(tally).not.toMatch(/--good|--critical|--accent/)
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
    expect(list, '.subtasks rule missing').toBeTruthy()
    expect(list).toMatch(/border-inline-start: 1px solid var\(--line\)/)
    expect(list).not.toMatch(/border-block|border-top|border-bottom/)
  })

  it('keeps a subtask off the meter and off the badge', () => {
    // A subtask is a title and a tick: no dates, so no extent to draw and no state to badge.
    // A meter in a checklist row would be a bar with nothing behind it.
    expect(code(app)).not.toMatch(/\.subtask[\w-]*[^{]*\{[^}]*(--state-fill|\.meter)/)
    expect(ruleFor(app, '.subtask__title')).toMatch(/font-size: var\(--fs-body\)/)
  })
})
