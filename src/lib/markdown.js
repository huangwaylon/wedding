/**
 * The notes document: the smallest markdown this app can be honest about, plus the transforms its
 * toolbar applies. Pure, like `time.js` and `progress.js` — no React, no catalog.
 *
 * IT PARSES TO DATA, NEVER TO HTML. `Markdown.jsx` maps these blocks onto elements, so no HTML
 * string is ever built and `dangerouslySetInnerHTML` appears in no file: the document is written by
 * anybody holding the edit key and read by everybody, which is a shared credential in front of an
 * injection surface the moment markup is concatenated.
 *
 * FOUR BLOCKS AND TWO MARKS, and the omissions are the design. No links (a user-controlled `href` is
 * the one injection route left once markup is out, and `javascript:` is a URL), no images (the sheet
 * holds no assets), no tables, no code fences, no block quotes, no rules: each is a shape somebody
 * has to learn and, for most of them, a type size the four-step scale does not have. What is left is
 * what people write down after a decision — a title, a line, a list.
 *
 * A MARKER THAT MATCHES NOTHING RENDERS AS TYPED. Half-finished emphasis is what a document looks
 * like mid-sentence, so a `**` with no partner is two asterisks rather than a swallowed paragraph.
 */

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
 * Where a run of exactly `length` asterisks closes the one opened at `from`, or -1. Exactly, so a
 * `**` never closes on the first two of a `***`.
 */
function closingRun(text, from, length) {
  if (isSpace(text[from])) return -1
  for (let at = from; at < text.length; at += 1) {
    if (text[at] !== '*' || runAt(text, at) !== length || isSpace(text[at - 1])) continue
    return at
  }
  return -1
}

/**
 * One line's runs: `{ text }`, with `bold` and `italic` where they apply.
 *
 * One asterisk is italic, two are bold, three are both, and anything longer is read as three: past
 * that it is somebody's decoration, and the alternative is printing it. Nesting works by recursion,
 * so `**a *b* c**` is bold throughout with `b` also italic.
 *
 * @returns {{text: string, bold?: true, italic?: true}[]}
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
 * then parks the caret at the end, so a toolbar that returned text alone would send somebody back to
 * the bottom of the document on every tap. Pure, so the awkward cases — a bare caret, a mixed run of
 * lines, a mark already there — are pinned by `test/markdown.test.js` rather than by driving a
 * browser.
 *
 * @typedef {{text: string, start: number, end: number}} Edit
 */

/**
 * `mark` around the selection, or off again.
 *
 * The runs OUTSIDE the selection have to match `mark` exactly, or Italic inside `**bold**` would
 * strip one asterisk from each end and quietly demote it; unequal, it wraps instead, which is how
 * `***both***` is spelled.
 */
function toggleMark(text, start, end, mark) {
  const width = mark.length
  const selected = text.slice(start, end)

  // The marks just outside the selection — where the wrap below leaves them, so a second tap undoes
  // the first.
  if (runBefore(text, start) === width && runAt(text, end) === width) {
    return {
      text: text.slice(0, start - width) + selected + text.slice(end + width),
      start: start - width,
      end: end - width,
    }
  }

  // Or just inside it, which is how a double-tap selects an already-marked word.
  if (
    selected.length > 2 * width &&
    runAt(selected, 0) === width &&
    runBefore(selected, selected.length) === width
  ) {
    const inner = selected.slice(width, -width)
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length }
  }

  return {
    text: `${text.slice(0, start)}${mark}${selected}${mark}${text.slice(end)}`,
    start: start + width,
    end: end + width,
  }
}

/** `**` around the selection, or off. A bare caret opens an empty pair to type inside. */
export function toggleBold(text, start, end) {
  return toggleMark(text, start, end, '**')
}

export function toggleItalic(text, start, end) {
  return toggleMark(text, start, end, '*')
}

/** The full lines the selection touches, as `[from, to]` offsets into `text`. */
function lineSpan(text, start, end) {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const found = text.indexOf('\n', end)
  return [from, found < 0 ? text.length : found]
}

/**
 * Add `prefix` to every line the selection touches, or strip it from all of them if all of them
 * already carry one. The toggle is decided over the WHOLE selection: per line, a mixed run alternates
 * on every tap and never converges.
 *
 * Blank lines are left alone. A bullet on nothing is a stray dash, and it is the one thing the parser
 * would then read as an item.
 *
 * @param {RegExp} carried what counts as already prefixed — anchored, capturing the rest of the line
 */
function togglePrefix(text, start, end, prefix, carried) {
  const [from, to] = lineSpan(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const written = lines.filter((line) => line.trim())
  const strip = written.length > 0 && written.every((line) => carried.test(line))

  const next = lines
    .map((line) => {
      if (!line.trim()) return line
      const bare = carried.exec(line)
      if (strip) return bare[1]
      // Re-prefixing a marked line REPLACES the mark rather than stacking `- - `: the toggle is off
      // only when every line carries one, so a mixed run has to come out uniform.
      return prefix + (bare ? bare[1] : line)
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
