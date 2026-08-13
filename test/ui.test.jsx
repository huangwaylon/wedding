/**
 * The stylesheets, as text.
 *
 * These are the rules a green test suite says nothing about: an invisible white-on-white
 * chart passes every render test there is. Each assertion here pins something that is
 * either load-bearing or impossible to notice from a passing suite alone.
 *
 * Reading CSS as a string is crude, and it is the only thing that works without a
 * browser. A screenshot is still required — see `scripts/preview.jsx`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCENTS, ACCENT_HEX, DEFAULT_ACCENT } from '../src/lib/theme.js'
import { STATE } from '../src/lib/progress.js'

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
    // --line on --track measures 1.035:1: the outline it is meant to draw is invisible, which
    // leaves an empty bar held up by the fill step alone. There is exactly one bar in the app,
    // so this is a primitives-only assertion and `.meter` is the only rule that can regress it.
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
    // on `--lg`, so a meter's height and its mark stay independent.
    expect(/\.meter--marked \{([^}]*)\}/.exec(primitives)[1]).toMatch(/overflow: visible/)
  })

  it('does not transition the fill', () => {
    // It advances on its own once a minute; an animation would make it look like a
    // control responding to a tap.
    expect(/\.meter__fill \{([^}]*)\}/.exec(primitives)[1]).not.toContain('transition')
  })
})

/** One state's entry in the table, or `null` where the state takes `.dot`'s own fallback. */
function stateEntry(state) {
  const found = new RegExp(
    `(?:^|\\})\\s*(?:[^{}]*,\\s*)?\\.dot--${state}[^{}]*\\{([^}]*)\\}`,
  ).exec(code(primitives))
  return found ? found[1] : null
}

/** Every state `progress.js` can report. Derived, so adding one fails here first. */
const STATES = Object.values(STATE)

/**
 * The states that earn a rule: the ones whose fill DIFFERS from `.dot`'s fallback. `later` and
 * `nodate` are the neutral pair, the fallback is already --ink-4, and a rule for either would
 * be a no-op restating the base.
 */
const COLOURED = [STATE.DONE, STATE.OVERDUE, STATE.SOON]

describe('the state table', () => {
  it('maps exactly the coloured states, once, in one place', () => {
    // Exact-set equality against the states derived from `progress.js`: a sixth state fails here
    // and forces the decision, a no-op re-added for `later` or `nodate` fails here too, and a
    // subset check would be an assertion that always passes. Nothing else anywhere maps a state
    // to a colour.
    expect(STATES.filter((state) => stateEntry(state) !== null)).toEqual(COLOURED)
    for (const state of COLOURED) {
      expect(stateEntry(state), `${state} sets no fill`).toMatch(/--state-fill:/)
    }
  })

  it('is read through the property, never by naming a colour twice', () => {
    expect(ruleFor(primitives, '.dot')).toMatch(/background-color: var\(--state-fill,/)
    // app.css paints no state colour of its own: a hue hardcoded onto a card mark would be a
    // second palette for the same claim.
    expect(code(app), 'a state hue is painted outside the table').not.toMatch(
      /--state-(fill|wash):/,
    )
  })

  it('falls back rather than painting nothing for a state with no entry', () => {
    // Load-bearing rather than defensive: this fallback is what the two neutral states paint
    // with, and it is why they need no rule of their own.
    expect(ruleFor(primitives, '.dot')).toMatch(/var\(--ink-4\)\)/)
  })

  it('never puts a state colour on type', () => {
    // The hue paints a graphic — a dot — and the meaning always sits in ink beside it. It is
    // also why the day column on a task row is not tinted: a column a third of which is red
    // stops being a column.
    for (const state of COLOURED) {
      expect(stateEntry(state), state).not.toMatch(/[^-]color:/)
    }
    expect(ruleFor(app, '.tcard__day')).toMatch(/color: var\(--ink\)/)
    expect(ruleFor(app, '.due')).toMatch(/color: var\(--ink-2\)/)
  })

  it('gives the one meter a flat accent fill', () => {
    // No meter carries a state class: there is one, it measures the whole board, and a board
    // has no single state.
    expect(ruleFor(primitives, '.meter__fill')).toMatch(/background-color: var\(--accent\)/)
    expect(code(primitives)).not.toMatch(/\.meter--(done|overdue|soon|later|nodate)/)
  })
})

describe('the month sign', () => {
  it('keeps caption ink off the accent wash, which fails AA on one preset', () => {
    // MEASURED, not stylistic: --ink-3 on an accent wash is 4.59–4.71:1, which is no margin at
    // 13px. The plaque's own label and its tally therefore both sit at --ink-2, 6.60:1 at worst.
    // Kanji at low contrast is unreadable in a way Latin is not.
    expect(ruleFor(app, '.plan__tally')).toMatch(/color: var\(--ink-2\)/)
    expect(ruleFor(app, '.plan__day')).toMatch(/color: var\(--ink-2\)/)
    for (const selector of ['.plan__tally', '.plan__day']) {
      expect(ruleFor(app, selector), selector).not.toMatch(/color: var\(--ink-3\)/)
    }
    // And the harness has to be measuring the pairing, or the paragraph above stays true while
    // the app is not. It DERIVES the wash list from the `[data-accent]` blocks rather than listing
    // them, which is why this asserts the derivation and not the names: a hand-kept list is how a
    // preset gets added and never measured.
    const script = readFileSync('scripts/check-contrast.js', 'utf8')
    expect(script).toContain('ACCENT_WASHES')
    expect(script).toMatch(/PRESETS\.map\(\(name\) => \[`\$\{name\}-wash`/)
    expect(script).toMatch(/\[\.\.\.TOKENS\.matchAll\(\/\\\[data-accent=/)
    for (const accent of ACCENTS) {
      expect(tokens, `${accent} declares no wash`).toMatch(
        new RegExp(`\\[data-accent="${accent}"\\][^}]*--accent-wash:`),
      )
    }
  })

  it('never colours a month tally, for the reason a row tally is never coloured', () => {
    // A whole month in --good would claim something about the month rather than about its
    // tasks. This figure is deliberately checkable by counting the rows underneath it.
    expect(ruleFor(app, '.plan__tally')).not.toMatch(/--good|--critical|--accent/)
  })

  it('tints the wedding month with a wash and never with a hue on the type', () => {
    // Once per board. A wash, so it does not become a sixth state colour.
    const plaque = ruleFor(app, '.plan__month--day')
    expect(plaque, '.plan__month--day rule missing').toBeTruthy()
    expect(plaque).toMatch(/background-color: var\(--accent-wash\)/)
    expect(plaque, 'a state or accent hue on type').not.toMatch(/[^-]color: var\(--accent\)/)
    // The negative margin is what keeps every month name in ONE column: padding alone pushes
    // the one month that matters 8px right of all the others.
    expect(plaque).toMatch(/margin-inline: calc\(var\(--space-2\) \* -1\)/)
  })

  it('draws the today line on the LINE, not as a border on a row', () => {
    // It belongs to the list rather than to any task, which is what keeps it outside the
    // one-coloured-mark-per-row budget.
    expect(ruleFor(app, '.plan__now::after')).toMatch(/background-color: var\(--accent\)/)
    expect(ruleFor(app, '.plan__now')).toMatch(/color: var\(--ink-2\)/)
    expect(ruleFor(app, '.plan__now'), 'the line must not tint its own words').not.toMatch(
      /[^-]color: var\(--accent\)/,
    )
  })
})

describe('an unsettled row', () => {
  it('dims the head and never the tick that was just pressed', () => {
    // `opacity: 0.55` on the whole card takes the check with it, so the confirmation of the
    // app's highest-frequency gesture fades for the ~3s the write is in flight — which reads
    // as un-pressed, the exact opposite of what is true.
    expect(ruleFor(app, '.tcard--pending .tcard__head')).toMatch(/opacity/)
    expect(ruleFor(app, '.tcard--pending'), 'the whole card must not be dimmed').toBeNull()
    // Same for a checklist item: the title recedes, the glyph carrying the tick does not.
    expect(ruleFor(app, '.subtask--pending .subtask__title')).toMatch(/opacity/)
    expect(ruleFor(app, '.subtask--pending')).toBeNull()
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

  it('keeps every line-height at or above 1.5, with NO carve-out left', () => {
    expect(tokens).toMatch(/--lh-tight: 1\.5/)
    expect(tokens).toMatch(/--lh-body: 1\.6/)
    // There used to be a `1` carve-out for a 44px percentage. That figure is a caption beside a bar
    // in the pinned header now, so it shares a line with Japanese and the carve-out went with the
    // card. Nothing may DECLARE or USE a sub-1.5 line-height — comments stripped, because the token
    // file explains the removal by naming what was removed.
    expect(code(tokens)).not.toContain('--lh-flat')
    expect(code(all)).not.toContain('--lh-flat')
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

  it('has no display or serif face, and no display type token to reach for', () => {
    expect(tokens).not.toMatch(/font-family:[^;]*serif(?!-)/)
    // A script or serif face on a wedding app is the obvious temptation, and the figure people
    // actually read is a caption now — there is no display step in the scale at all, so adding
    // one means adding a token rather than picking one up.
    expect(tokens).not.toContain('--fs-display')
    expect(/\.hero__percent \{([^}]*)\}/.exec(app)[1]).not.toContain('font-family')
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

  it('lets the select inherit that floor rather than restating it', () => {
    // `.select` is worn WITH `.input`, so the 16px comes from one place. A font-size of its own
    // is how a control ends up under the floor and zooms the viewport on focus.
    const rule = ruleFor(primitives, '.select')
    expect(rule, '.select rule missing').toBeTruthy()
    expect(rule, '.select must not set its own font-size').not.toContain('font-size')
    expect(rule, '.select must not set its own family').not.toContain('font-family')
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

  it('holds the sticky month heading up with a background, not a shadow', () => {
    // Rows scroll UNDER it, so the opaque background is load-bearing rather than decoration. A
    // shadow beneath it would read as a bar of chrome the app does not have.
    const month = ruleFor(app, '.plan__month')
    expect(month, '.plan__month rule missing').toBeTruthy()
    expect(month).toMatch(/position: sticky/)
    expect(month).toMatch(/background-color: var\(--bg\)/)
    expect(month).not.toContain('box-shadow')
    // The rule under it is what makes it read as a sign rather than two labels floating over
    // the first row. A hairline in --line, the same as every card boundary — never a shadow.
    expect(month).toMatch(/border-bottom: 1px solid var\(--line\)/)
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
    // `.tcard` is its own surface rather than `.card` — it has a grid and a two-token
    // asymmetric padding — so the no-shadow rule has to be pinned twice.
    const tcard = ruleFor(app, '.tcard')
    expect(tcard, '.tcard rule missing').toBeTruthy()
    expect(tcard).toMatch(/border: 1px solid var\(--line\)/)
    expect(tcard).not.toContain('box-shadow')
  })
})

describe('touch ergonomics', () => {
  it('separates everything in a view from everything else in it', () => {
    // The one column is a stack of unrelated blocks — hero, summary, chips, cards — and the gap
    // between them is the only thing holding them apart: with the view a plain block, the
    // summary card's bottom hairline and the first filter chip's top edge touch at 0px and the
    // chips read as welded to the card. It is never the chips' own padding.
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
    // reads borderless beside the compliant buttons next to it.
    expect(ruleFor(primitives, '.chip')).toMatch(/border: 1px solid var\(--line-input\)/)
  })

  it('makes a disabled chip look disabled', () => {
    // `.btn[disabled]`'s own opacity does not reach a chip, so without this a dead zero-count
    // filter is pixel-identical to a live one.
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
    // The tightest interactive adjacency in the app, between a checklist item's toggle
    // and its delete button — and 4px between "tick it" and "delete it" is how the wrong one
    // gets pressed on a moving bus.
    expect(ruleFor(app, '.subtask')).toMatch(/gap: var\(--space-2\)/)
  })

  it('gives the check toggle the full target', () => {
    // The primary interaction of the app, so never the 36px secondary tier. It is a SIBLING of
    // the head button, not a child — a button inside a button is dropped by the parser — so it
    // carries its own target.
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

  it('centres the day against the whole row, not against the title’s baseline', () => {
    // Measured over CDP: with `align-items: baseline` the day's optical centre sits 16.7px above
    // the centre of the block beside it on any row carrying a meta line, because the baseline
    // locks it to the TITLE's first line — and what the eye weighs the day against is the whole
    // right-hand column.
    const head = ruleFor(app, '.tcard__head')
    expect(head).toMatch(/align-items: center/)
    expect(head).not.toMatch(/align-items: (baseline|flex-start)/)
    // The day column lines up on its trailing EDGE, which is what alignment must not be asked to
    // do: a fixed width plus `text-align: end`, so one- and two-digit days share a right margin.
    const day = ruleFor(app, '.tcard__day')
    expect(day).toMatch(/width: 2rem/)
    expect(day).toMatch(/text-align: end/)
    // And the chevron carries no correction of its own; a centred head leaves nothing to correct.
    expect(ruleFor(app, '.tcard__chev')).not.toMatch(/margin-top|align-self/)
  })

  it('keeps the sheet footer reachable with the keyboard up', () => {
    // iOS defaults to `resizes-visual`: the keyboard changes neither the layout viewport nor
    // `dvh`, so Save sits under ~340px of keyboard with no way to reach it.
    expect(html).toContain('interactive-widget=resizes-content')
    expect(ruleFor(primitives, '.sheet__foot')).toMatch(/position: sticky/)
  })

  it('contains the overscroll of the sheet body', () => {
    expect(ruleFor(primitives, '.sheet__body')).toMatch(/overscroll-behavior: contain/)
  })

  it('keeps the toast clear of the FAB', () => {
    // --z-toast is above --z-fab, so a full-width toast would hide the button behind every
    // "Saved".
    expect(ruleFor(primitives, '.toasts')).toMatch(/--fab-size/)
  })
})

describe('layout', () => {
  it('reserves clearance for the FAB, the only fixed chrome, so it covers no row', () => {
    // Reserved ONCE, by the views wrapper. Without the reservation the button lands on top of the
    // last row's controls.
    const views = ruleFor(app, '.views')
    expect(views, '.views rule missing').toBeTruthy()
    // [\s\S], not `.`: the calc can wrap across lines, and a `.`-based regex silently stops
    // at the first newline and reports the reservation as missing.
    const clearance = /padding-bottom:([\s\S]*?);/.exec(views)
    expect(clearance, '.views reserves no bottom clearance').toBeTruthy()
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
  })

  it('has no fixed bar to keep clear of', () => {
    // ONE SCREEN, ONE SCROLLER, NO TAB BAR. A tab bar costs 56px plus its safe-area inset of
    // permanent chrome on every screen, to hold one card and a photograph — and it forces the
    // standing notices onto every tab, because the out-of-date-script warning is what explains a
    // control missing from a row.
    expect(code(app)).not.toContain('tabbar')
    expect(code(app)).not.toContain('tabbtn')
    expect(code(tokens)).not.toContain('--tabbar-height')
    expect(code(tokens)).not.toContain('--z-tabbar')
  })

  it('has only the ONE documented breakpoint, across EVERY stylesheet', () => {
    // Exact-set equality, over every sheet rather than `app.css` alone: `primitives.css` has a
    // 48rem block of its own, so a second breakpoint added outside `app.css` has to fail here
    // too. A subset check is an assertion that always passes. `all` is every sheet with comments
    // stripped.
    const widths = new Set([...all.matchAll(/@media \(min-width: ([\d.]+rem)\)/g)].map((m) => m[1]))
    expect([...widths].sort()).toEqual(['48rem'])
  })

  it('makes the sheet a centred dialog at that same breakpoint', () => {
    expect(primitives).toMatch(/@media \(min-width: 48rem\)/)
  })

  it('sizes the hero photo with a clamp rather than a second breakpoint', () => {
    // The photograph is the one thing whose height depends on the viewport, and a stepped height
    // would want breakpoints of its own. A clamp gets the same result — a tenth of a phone, a
    // little more on a monitor — with the single 48rem query doing nothing but the corners.
    expect(tokens).toMatch(/--hero-photo: clamp\(/)
    expect(ruleFor(app, '.hero__title')).toMatch(/font-size: clamp\(/)
  })

  it('ADDS the safe-area inset to the photo band rather than eating into it', () => {
    // Everything is `border-box`, so `height: var(--hero-photo)` with `padding-top:
    // var(--safe-top)` takes the inset OUT of the band. On an iPhone that leaves 26px of content
    // box: the names render under the clock, `overflow: hidden` clips the gear to a sliver, and
    // `--hero-height` — which DOES count the inset — ends up 59px taller than the header really
    // is, so the month heading parks in mid-air with rows scrolling through the gap.
    //
    // This is a weak test on purpose, and it says so: the token composition below already passed
    // while the layout silently disagreed with it, because an iframe reports a 0px inset and no
    // static render can see any of this. The real check is `scripts/drive.mjs`, which fakes an
    // inset and asserts the gear's rect is inside the band's.
    const photo = ruleFor(app, '.hero__photo')
    expect(photo).toMatch(/height: calc\(var\(--safe-top\) \+ var\(--hero-photo\)\)/)
    expect(photo).toMatch(/padding-top: var\(--safe-top\)/)
  })

  it('scroll-pads the document by the pinned header’s height', () => {
    // `scrollIntoView({ block: 'nearest' })` measures against the scrollport and calls anything in
    // the top band already visible, so a focused field there sits behind the photograph. This
    // corrects both callers AND the UA's own focus scrolling, which no JS change can reach.
    expect(ruleFor(base, 'html')).toMatch(/scroll-padding-top: var\(--hero-height\)/)
  })

  it('pins the header and makes the month heading stop BELOW it', () => {
    // Both are sticky and they meet. A month heading still offsetting by `--safe-top` parks
    // itself under the photograph, where it is invisible until you have already scrolled past
    // the month it names — and it has to slide UNDER the header, so its z-index stays lower.
    const hero = ruleFor(app, '.hero')
    expect(hero).toMatch(/position: sticky/)
    expect(hero).toMatch(/top: 0/)
    expect(hero).toMatch(/z-index: var\(--z-header\)/)

    const month = ruleFor(app, '.plan__month')
    expect(month).toMatch(/top: var\(--hero-height\)/)
    expect(month).toMatch(/z-index: 1;/)

    // `--hero-height` is the header's WHOLE occupied height, or the heading lands under the
    // progress strip. Both bands and the safe area have to be in it.
    const height = /--hero-height:([^;]*);/.exec(code(tokens))[1]
    expect(height).toContain('--safe-top')
    expect(height).toContain('--hero-photo')
    expect(height).toContain('--hero-strip')
  })

  it('gives the progress strip a fixed height, because the heading offsets by it', () => {
    // Content that sets its own height would silently desynchronise `--hero-height` from what
    // the header actually occupies, and the month heading would overlap the strip.
    expect(ruleFor(app, '.hero__progress')).toMatch(/height: var\(--hero-strip\)/)
  })

  it('drops -webkit-overflow-scrolling, which breaks sticky in the same scroller', () => {
    // A no-op for momentum since iOS 13, and the legacy implementation creates its own stacking
    // context and breaks `position: sticky` inside the scroller — load-bearing for both the month
    // heading and the sheet's own sticky footer.
    expect(all).not.toContain('-webkit-overflow-scrolling')
  })

  it('spends the left edge on the row, with no rail and no node', () => {
    // A rail at --space-3 forces the row to pad to --space-6 to clear its node's lane: 24px of a
    // 250px row at 320pt, spent implying a continuity the sticky heading states outright. A node
    // also has to be pinned to a magic offset, which only holds for one shape of date chip.
    expect(ruleFor(app, '.tcard::before')).toBeNull()
    expect(ruleFor(app, '.tcard__node')).toBeNull()
    expect(ruleFor(app, '.tcard')).toMatch(/padding: var\(--space-2\) var\(--space-3\)/)
    // A gap between the check and the head, because a thumb aiming at the day to OPEN the row
    // would otherwise land pixels from "mark done". A gap, never a negative margin.
    expect(ruleFor(app, '.tcard')).toMatch(/column-gap: var\(--space-1\)/)
  })

  it('separates the month groups more than the rows inside one', () => {
    // That difference is the only thing saying "next month" rather than "next task".
    const group = /gap: var\(--space-(\d)\)/.exec(ruleFor(app, '.plan__group'))[1]
    const plan = /gap: var\(--space-(\d)\)/.exec(ruleFor(app, '.plan'))[1]
    expect(Number(plan)).toBeGreaterThan(Number(group))
  })

  it('contains only the horizontal overscroll on the chip row', () => {
    // The chips are the one horizontal scroller in the app, and a horizontal pan that chains becomes
    // an iOS back-swipe. But `contain` on BOTH axes swallows the vertical drag that begins on
    // the row — which is the top of the list, where a thumb lands first.
    const chips = ruleFor(app, '.chips')
    expect(chips, '.chips rule missing').toBeTruthy()
    expect(chips).toMatch(/overscroll-behavior-x: contain/)
    expect(chips).not.toMatch(/overscroll-behavior: contain/)
  })

  it('shows that the chip row scrolls, and fades one axis only', () => {
    // Five chips measure ~453px against a 361px card and the overlay scrollbar is hidden, so
    // without the fade two filters sit off the right edge of a 320pt phone with nothing saying
    // they exist. A mask on BOTH axes would clip the focus ring that `padding-block: 2px` exists
    // to keep.
    const chips = ruleFor(app, '.chips')
    expect(chips).toMatch(/mask-image: linear-gradient\(to right/)
    expect(chips).toMatch(/padding-block: 2px/)
    // And it is removed where the row no longer scrolls, or it would dim a fully visible chip.
    const wide = blocksOf(app, 48).find((block) => /\.chips \{/.test(block))
    expect(wide, 'the 48rem block does not touch .chips').toBeTruthy()
    expect(wide).toMatch(/mask-image: none/)
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
  it('allows the Sheets API, which is where an EDITOR reads and writes', () => {
    // The host that carries a credential. It is here because `/exec` costs 1.0–1.6s per request
    // and this costs ~0.24s — removing it does not make the app safer, it makes every write four
    // times slower. A view-only visitor still holds no token and never reaches it.
    expect(csp).toContain('https://sheets.googleapis.com')
  })

  it('allows the two Apps Script hosts and the Sheets API, and nothing else', () => {
    const connect = /connect-src([^;]*);/.exec(csp)[1]
    expect(connect).toContain('https://script.google.com')
    // /exec answers with a 302 to this one, so it is not redundant.
    expect(connect).toContain('https://script.googleusercontent.com')
    expect(connect).toContain('https://sheets.googleapis.com')
    expect(connect.match(/https:\/\//g)).toHaveLength(3)
  })

  it('adds no sign-in host, because there is no sign-in', () => {
    // The token is minted by the script from its OWN grant, so nothing here talks to
    // accounts.google.com and no consent screen is ever shown to either editor. If one of these
    // appears, somebody has replaced the capability link with OAuth.
    for (const host of ['accounts.google.com', 'apis.google.com', 'gstatic.com']) {
      expect(csp, host).not.toContain(host)
    }
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
    // With a long venue name and the View only badge sharing the row, a wrapped "427 days to go"
    // breaks across two lines and pushes the names up on a 393px phone. The countdown is the one
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

    // And scripts/check-contrast.js must be modelling THIS alpha. It now READS the last stop off
    // the token rather than restating it, so the two cannot drift at all — which is the stronger
    // form of what this used to assert by string-matching the number.
    const script = readFileSync('scripts/check-contrast.js', 'utf8')
    expect(script).toMatch(/SCRIM_STOPS = \[\.\.\.token\('photo-scrim'\)/)
    expect(script).toMatch(/SCRIM_ALPHA = Number\(DENSE\[4\]\)/)

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

describe('the open row', () => {
  it('keeps the edit toggle in one place as the mode changes', () => {
    // The delete appears to the toggle's LEFT when editing. `margin-inline-start: auto` is what
    // makes a one-control row and a two-control row put the toggle at the same x — with
    // `justify-content` alone it would slide left the moment the delete appeared, under a thumb
    // that is about to press it again.
    expect(ruleFor(app, '.tcard__edit')).toMatch(/margin-inline-start: auto/)
    expect(ruleFor(app, '.tcard__foot')).toMatch(/border-top: 1px solid var\(--line\)/)
  })

  it('gives the read-mode fact a label that clears AA at 13px', () => {
    // --ink-3 is documented as the lightest ink that does. A label is information, so it does
    // not get the --ink-4 placeholder treatment.
    // The type treatment is shared with `.editor__label` — one quiet label, two places it sits —
    // so it is declared on a group and `ruleFor`, which anchors on a single selector, cannot see
    // it. Read the group instead: a per-class copy is exactly what this consolidated.
    const quietLabel = /\.editor__label,\n\.tcard__factLabel \{([^}]*)\}/.exec(code(app))
    expect(quietLabel, 'the shared quiet-label rule is missing').toBeTruthy()
    expect(quietLabel[1]).toMatch(/color: var\(--ink-3\)/)
    expect(quietLabel[1]).toMatch(/font-size: var\(--fs-caption\)/)
  })
})

describe('the date control', () => {
  it('turns the platform appearance OFF, which is the only way it fits the card', () => {
    // With it on, Safari sizes `input[type=date]` from its own shadow tree and that intrinsic
    // width is a FLOOR — `width: 100%` is a ceiling it ignores, so the control draws past the
    // right edge of a 252px card on a 320pt phone. Nothing clips it either: `.tcard` has to
    // stay `overflow: visible` or the focus ring is cut off.
    const rule = ruleFor(primitives, '.input[type="date"]')
    expect(rule, '.input[type="date"] rule missing').toBeTruthy()
    expect(rule).toMatch(/-webkit-appearance: none/)
    expect(rule).toMatch(/\n  appearance: none/)
    expect(rule).toMatch(/min-width: 0/)
    expect(rule).toMatch(/max-width: 100%/)
  })

  it('puts back the metrics that turning the appearance off takes away', () => {
    // The value loses its box and centres itself; the indicator loses its own.
    const value = ruleFor(primitives, '.input[type="date"]::-webkit-date-and-time-value')
    expect(value, 'the shadow value has no rule').toBeTruthy()
    expect(value).toMatch(/text-align: start/)
    expect(value).toMatch(/min-height: 1\.5em/)

    const indicator = ruleFor(primitives, '.input[type="date"]::-webkit-calendar-picker-indicator')
    expect(indicator, 'the picker indicator has no rule').toBeTruthy()
    // WCAG 2.5.8's graphic floor. It is the whole affordance.
    expect(indicator).toMatch(/min-width: 1\.25rem/)
  })

  it('keeps the 16px floor, which is why the control is wide in the first place', () => {
    // Narrowing the type would narrow the intrinsic width — and zoom the viewport on focus
    // with no way back out. `appearance: none` is the only lever.
    expect(ruleFor(primitives, '.input')).toMatch(/font-size: max\(1rem, var\(--fs-body\)\)/)
    expect(ruleFor(primitives, '.input[type="date"]')).not.toContain('font-size')
  })

  it('offers no clock control anywhere, because nothing on the board is timed', () => {
    expect(code(primitives)).not.toContain('type="time"')
    expect(code(all)).not.toContain('.switch')
  })
})

describe('the checklist and the tally', () => {
  it('never colours the tally', () => {
    // A 5/5 in the done colour would claim a `done_at` the sheet does not have: all subtasks
    // done deliberately does not make a parent done.
    const tally = ruleFor(app, '.tcard__tally')
    expect(tally, '.tcard__tally rule missing').toBeTruthy()
    // --ink-2 rather than the meta line's own --ink-3: it is the only progress figure a task
    // has. Still never a state colour.
    expect(tally).toMatch(/color: var\(--ink-2\)/)
    expect(tally).not.toMatch(/--good|--critical|--accent/)
  })

  it('gives the whole subtask row a target in the list', () => {
    // With only the 44px circle live, a tap on the title — the obvious place to aim on a
    // checklist — does nothing at all.
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
