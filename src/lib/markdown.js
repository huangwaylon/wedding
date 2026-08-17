/**
 * The notes document: the smallest markdown this app can be honest about, plus the transforms its
 * toolbar applies. Pure, like `time.js` and `progress.js` — no React, no catalog.
 *
 * IT PARSES TO DATA, NEVER TO HTML. `Markdown.jsx` maps these blocks onto elements, so no HTML
 * string is ever built and `dangerouslySetInnerHTML` appears in no file: the document is written by
 * anybody holding the edit key and read by everybody, which is a shared credential in front of an
 * injection surface the moment markup is concatenated.
 *
 * FOUR BLOCKS, TWO MARKS AND A LINK, and the omissions are the design. No images (the sheet holds no
 * assets), no tables, no code fences, no block quotes, no rules: each is a shape somebody has to learn
 * and, for most of them, a type size the four-step scale does not have. What is left is what people
 * write down after a decision — a title, a line, a list, and the page a decision was made on.
 *
 * A LINK IS AN ALLOWLIST, NOT A PARSER. `links.js` owns what a URL is and refuses everything but
 * `http`/`https`, because a user-controlled `href` is the one injection route left once markup is out
 * and `javascript:` is a URL. A refused scheme renders as the characters that were typed, exactly like
 * an unmatched `**`.
 *
 * A MARKER THAT MATCHES NOTHING RENDERS AS TYPED. Half-finished emphasis is what a document looks
 * like mid-sentence, so a `**` with no partner is two asterisks rather than a swallowed paragraph.
 */

import { safeHref, urlAt } from './links.js'

/** Heading depth this renders. `###` and deeper map onto 2 — see `parseMarkdown`. */
const MAX_HEADING = 2

/** `#`, `##`, then the words. The space is required, or `#1 dress` is a heading. */
const HEADING = /^(#{1,6})[ \t]+(.+)$/
/** `-` or `*`, up to three spaces of indent, because nesting is not a level this renders. */
const BULLET = /^[ \t]{0,3}[-*][ \t]+(.+)$/
/** `1.` or `1)`. The number itself is dropped: an ordered list numbers itself, and a `3.` typed
    first would otherwise print a 3 that no later edit corrects. */
const NUMBER = /^[ \t]{0,3}\d{1,9}[.)][ \t]+(.+)$/

/**
 * Whether a delimiter can open or close. An opener must be followed by a non-space and a closer
 * preceded by one, which is the part of CommonMark's flanking rule that earns its keep: without it
 * `2 * 3 * 4` is italic and every asterisk swallows the rest of the line.
 */
function isSpace(character) {
  return character === undefined || /\s/.test(character)
}

/** How many asterisks start at `at`. A RUN, not a character: `*`, `**` and `***` are three different
    delimiters, and reading them one asterisk at a time is what makes `***both***` come out as a bold
    run wearing a stray italic. */
function runAt(text, at) {
  let length = 0
  while (text[at + length] === '*') length += 1
  return length
}

/** How many asterisks END at `at`, the mirror of `runAt`, for deciding what a selection sits inside. */
function runBefore(text, at) {
  let length = 0
  while (at - length - 1 >= 0 && text[at - length - 1] === '*') length += 1
  return length
}

/**
 * Where a run of exactly `length` asterisks closes the one opened at `from`, or -1.
 *
 * A candidate must be the START of its own run and exactly `length` long, or the second asterisk of a
 * `**` looks like a run of one and closes an outer `*`: without the `runBefore` half, `*a **b** c*`
 * closes its italic on that asterisk and renders as `<em>a *</em>` plus literal text. The toolbar
 * produces exactly that shape — italicise a phrase, then embolden a word inside it.
 */
function closingRun(text, from, length) {
  if (isSpace(text[from])) return -1
  for (let at = from; at < text.length; at += 1) {
    if (text[at] !== '*') continue
    if (runAt(text, at) !== length || runBefore(text, at) !== 0) continue
    if (isSpace(text[at - 1])) continue
    return at
  }
  return -1
}

/**
 * `[label](url)`, sticky so an inline scanner can ask "here?" without slicing. The label takes no
 * newline and the URL no whitespace or `)`, which is what makes an unclosed bracket fall through to
 * literal text rather than swallowing the rest of the line.
 */
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/y

/**
 * A link starting at `at`: either `[label](url)` or a bare URL, or null.
 *
 * Bare URLs are linked because people paste them — a document where `[x](y)` works and a pasted URL
 * does not teaches the syntax by failure. The label is parsed for marks by recursion, so
 * `[**venue**](url)` is a bold link; an empty label and a refused scheme both return null, and the
 * caller then prints the brackets.
 *
 * @returns {{spans: object[], href: string, length: number}|null}
 */
function linkAt(line, at) {
  if (line[at] === '[') {
    LINK.lastIndex = at
    const match = LINK.exec(line)
    if (!match || !match[1].trim()) return null
    const href = safeHref(match[2])
    return href ? { spans: spansOf(match[1]), href, length: match[0].length } : null
  }

  const url = urlAt(line, at)
  return url ? { spans: [{ text: url }], href: url, length: url.length } : null
}

/**
 * One line's runs: `{ text }`, with `bold`, `italic` and `href` where they apply.
 *
 * One asterisk is italic, two are bold, three are both, and anything longer is read as three: past
 * that it is somebody's decoration, and the alternative is printing it. Nesting works by recursion,
 * so `**a *b* c**` is bold throughout with `b` also italic.
 *
 * @returns {{text: string, bold?: true, italic?: true, href?: string}[]}
 */
function spansOf(line) {
  const spans = []
  let plain = ''
  let at = 0

  const flush = () => {
    if (plain) spans.push({ text: plain })
    plain = ''
  }

  while (at < line.length) {
    /* Links first: the URL is consumed whole, so an asterisk inside a query string is part of the
       address rather than an unmatched italic. */
    const link = linkAt(line, at)
    if (link) {
      flush()
      for (const span of link.spans) spans.push({ ...span, href: link.href })
      at += link.length
      continue
    }

    const length = runAt(line, at)
    const from = at + length
    const close = length ? closingRun(line, from, length) : -1
    if (close < 0) {
      plain += line[at]
      at += 1
      continue
    }
    flush()
    const marks = {}
    if (length >= 2) marks.bold = true
    if (length === 1 || length >= 3) marks.italic = true
    for (const span of spansOf(line.slice(from, close))) spans.push({ ...span, ...marks })
    at = close + length
  }

  flush()
  return spans
}

/**
 * The document as blocks, in order. One pass, line by line: every block is decided by its own first
 * characters, so nothing needs lookahead.
 *
 * A SINGLE NEWLINE IS A LINE BREAK, not a joined paragraph. CommonMark reflows consecutive lines into
 * one, which on a phone means three things typed on three lines arrive as one sentence — the
 * commonest surprise in any markdown field, and this document is somebody writing down what was
 * decided. A blank line still separates paragraphs, so both intents are available.
 *
 * @param {string} text
 * @returns {({kind: 'heading', level: number, spans: object[]}
 *   | {kind: 'bullets'|'numbers', items: object[][]}
 *   | {kind: 'text', lines: object[][]})[]}
 */
export function parseMarkdown(text) {
  const blocks = []
  /** The block still open, so a run of items or lines is one block rather than N. */
  let open = null

  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    // Trailing whitespace only: leading whitespace is how a list item is indented, and markdown's
    // two-trailing-spaces line break is not a mechanism here, every newline already being one.
    const line = raw.replace(/[ \t]+$/, '')
    if (!line) {
      open = null
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      // `###` and deeper collapse onto the last level there is a size for rather than printing their
      // own hashes: pasted notes carry whatever depth they were written at.
      blocks.push({
        kind: 'heading',
        level: Math.min(heading[1].length, MAX_HEADING),
        spans: spansOf(heading[2]),
      })
      open = null
      continue
    }

    const bullet = BULLET.exec(line)
    const number = bullet ? null : NUMBER.exec(line)
    if (bullet || number) {
      const kind = bullet ? 'bullets' : 'numbers'
      if (open?.kind !== kind) {
        open = { kind, items: [] }
        blocks.push(open)
      }
      open.items.push(spansOf((bullet ?? number)[1]))
      continue
    }

    if (open?.kind !== 'text') {
      open = { kind: 'text', lines: [] }
      blocks.push(open)
    }
    open.lines.push(spansOf(line))
  }

  return blocks
}

// --------------------------------------------------------------------------- The toolbar
// ---------------------------------------------------------------------------

/**
 * Each transform takes the text and the selection and returns both.
 *
 * The selection is the point: React re-renders a controlled textarea from its value and the browser
 * then parks the caret at the end, so a toolbar that returned text alone would send somebody to the
 * bottom of the document on every tap. Pure, so the awkward cases — a bare caret, a blank line, a
 * selection carrying a trailing space, a run of lines already marked — are pinned by
 * `test/markdown.test.js` rather than by driving a browser.
 *
 * Every one is a toggle whose second press is its own inverse, and every one is decided over the WHOLE
 * selection: per line, a mixed run alternates on each tap and never converges.
 *
 * @typedef {{text: string, start: number, end: number}} Edit
 */

/**
 * Any block marker, whatever family, and any indent. A prefix toggle strips this before adding its
 * own, so Bullet on a heading REPLACES it rather than stacking `# - `; the parser reads only three
 * spaces of indent, so a deeper one is normalised on the way past.
 */
const BLOCK_MARK = /^[ \t]*(?:#{1,6}|[-*]|\d{1,9}[.)])[ \t]+(.*)$/

/** The full lines the selection touches, as `[from, to]` offsets into `text`. */
function lineSpan(text, start, end) {
  // `start === 0` is its own case: `lastIndexOf('\n', -1)` clamps to 0 and FINDS a leading newline,
  // which returns a reversed span and makes the toggle insert newlines instead of prefixing.
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const found = text.indexOf('\n', end)
  return [from, found < 0 ? text.length : found]
}

/** A line split into its indent, its content and its trailing space. */
function parts(line) {
  const lead = line.slice(0, line.length - line.trimStart().length)
  const tail = line.slice(line.trimEnd().length)
  return { lead, core: line.trim(), tail }
}

/** Whether `core` is already wrapped in a run of exactly `mark`. */
function wrapped(core, mark) {
  return (
    core.length > 2 * mark.length &&
    runAt(core, 0) === mark.length &&
    runBefore(core, core.length) === mark.length
  )
}

/**
 * `mark` around one line's selection, or off again.
 *
 * The selection is shrunk to its non-space core first: `** foo **` is bold in no parser — the flanking
 * rule above refuses it — and a double-tap-drag selection on iOS routinely carries a trailing space.
 * The runs OUTSIDE the selection then have to match `mark` EXACTLY, or Italic inside `**bold**` would
 * strip one asterisk from each end and quietly demote it; unequal, it wraps instead, which is how
 * `***both***` is spelled.
 */
function markRun(text, start, end, mark) {
  const width = mark.length
  const raw = text.slice(start, end)
  // An all-whitespace selection collapses to a caret rather than inverting its own bounds.
  const lead = raw.trim() ? raw.length - raw.trimStart().length : 0
  const at = start + lead
  const to = raw.trim() ? end - (raw.length - raw.trimEnd().length) : start
  const core = text.slice(at, to)

  // The marks just outside the selection — where the wrap below leaves them, so a second tap undoes
  // the first.
  if (runBefore(text, at) === width && runAt(text, to) === width) {
    return {
      text: text.slice(0, at - width) + core + text.slice(to + width),
      start: at - width,
      end: to - width,
    }
  }

  // Or just inside it, which is how a double-tap selects an already-marked word.
  if (wrapped(core, mark)) {
    const inner = core.slice(width, -width)
    return { text: text.slice(0, at) + inner + text.slice(to), start: at, end: at + inner.length }
  }

  return {
    text: `${text.slice(0, at)}${mark}${core}${mark}${text.slice(to)}`,
    start: at + width,
    end: to + width,
  }
}

/**
 * `mark` around each touched line's content, or off again.
 *
 * A mark is per LINE, because `spansOf` reads one line at a time: `**one\ntwo**` renders as two lines
 * of literal asterisks, so a select-all plus Bold has to mark each line instead. A blank line is skipped
 * and a block marker is stepped over, so bolding a list gives `- **item**` and not `**- item**`.
 */
function markLines(text, start, end, mark) {
  const [from, to] = lineSpan(text, start, end)
  const lines = text.slice(from, to).split('\n')

  /** A line's content after its block marker, which is what the mark wraps. */
  const body = (line) => {
    const { core } = parts(line)
    const bare = BLOCK_MARK.exec(core)
    return bare ? bare[1] : core
  }

  const written = lines.filter((line) => line.trim())
  const strip = written.length > 0 && written.every((line) => wrapped(body(line), mark))

  const next = lines
    .map((line) => {
      if (!line.trim()) return line
      const { lead, core, tail } = parts(line)
      const inner = body(line)
      // Adding to a line that already carries the mark is a no-op, not a second pair: a mixed run has
      // to come out uniform, and `****one****` is a run of four, which pairs with nothing.
      if (!strip && wrapped(inner, mark)) return line
      const head = core.slice(0, core.length - inner.length)
      const marked = strip ? inner.slice(mark.length, -mark.length) : `${mark}${inner}${mark}`
      return `${lead}${head}${marked}${tail}`
    })
    .join('\n')

  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length }
}

function toggleMark(text, start, end, mark) {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  return text.slice(from, to).includes('\n')
    ? markLines(text, from, to, mark)
    : markRun(text, from, to, mark)
}

/** `**` around the selection, or off. A bare caret opens an empty pair to type inside. */
export function toggleBold(text, start, end) {
  return toggleMark(text, start, end, '**')
}

export function toggleItalic(text, start, end) {
  return toggleMark(text, start, end, '*')
}

/**
 * Add `prefix` to every line the selection touches, or strip it from all of them if all of them
 * already carry one.
 *
 * A blank line inside a multi-line selection is left alone — a bullet on nothing is a stray dash, and
 * it is the one thing the parser would then read as an item — but a selection that is ENTIRELY blank
 * takes the prefix, that being the "Enter, then tap the button" gesture, where skipping it makes the
 * button look broken.
 *
 * @param {RegExp} carried what counts as already prefixed with THIS family — anchored, capturing the
 *   rest of the line, and no wider than the parser's own indent, so "already a bullet" means "renders
 *   as one"
 */
function togglePrefix(text, start, end, prefix, carried) {
  const [from, to] = lineSpan(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const written = lines.filter((line) => line.trim())
  const blank = written.length === 0
  const strip = !blank && written.every((line) => carried.test(line))

  const next = lines
    .map((line) => {
      if (!blank && !line.trim()) return line
      if (strip) return carried.exec(line)[1]
      const bare = BLOCK_MARK.exec(line)
      // A blank line contributes nothing but its own whitespace, which the marker replaces.
      return prefix + (bare ? bare[1] : blank ? '' : line)
    })
    .join('\n')

  // The whole block stays selected, so a second tap toggles exactly what the first one did.
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length }
}

/** `- ` on every touched line, or off. */
export function toggleBullets(text, start, end) {
  return togglePrefix(text, start, end, '- ', /^[ \t]{0,3}[-*][ \t]+(.*)$/)
}

/** `# ` on every touched line, or off. One level from the toolbar; `##` still parses if typed. */
export function toggleHeading(text, start, end) {
  return togglePrefix(text, start, end, '# ', /^(?:#{1,6})[ \t]+(.*)$/)
}
