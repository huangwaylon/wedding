/**
 * What counts as a link, and the only place a URL is decided safe to follow. Pure, like `time.js`,
 * `progress.js` and `markdown.js` — no React, no catalog.
 *
 * TWO CONSUMERS, ONE GRAMMAR: the notes document (`markdown.js`) and a checklist item's title
 * (`SubtaskList`). The same pasted URL has to be live in both, or somebody learns that a link works
 * in one half of the app.
 *
 * TWO SCHEMES, ALLOWLISTED, tested against the raw characters before anything parses them. An
 * `href` is the one injection route left in a surface written by whoever holds the edit key and read
 * by everybody — `javascript:` is a URL, and so is `java&#10;script:` — so the rule is positive
 * (`http://` or `https://`, no whitespace, no control characters) rather than a blocklist of the
 * schemes thought of today.
 *
 * A REFUSAL IS NOT AN ERROR. Anything rejected here renders as the characters that were typed, which
 * is what `markdown.js` already does with every marker matching nothing: mangled text is worse than
 * literal text.
 */

/** The whole string must be one URL. Anchored both ends, so a trailing quote or bracket refuses. */
const SAFE_URL = /^https?:\/\/[^\s]+$/i

/** Control characters, which no browser agrees about and which are how a scheme is smuggled. */
const CONTROL = /[\x00-\x1f\x7f-\x9f]/

/** A URL starting exactly HERE. Sticky rather than sliced: an inline scanner asks this at every
    character, and `slice(at)` per character is quadratic on a long paragraph. */
const URL_HERE = /https?:\/\/[^\s]+/iy

/**
 * Punctuation a sentence puts AFTER a URL rather than inside one, so "see https://a.example." does
 * not link the full stop. Both alphabets: a Japanese line ends in 。and 、as an English one ends in
 * . and , — and a full-width character inside an href is a 404 nobody can see.
 */
const TRAILING = '.,;:!?\'"”’。、・'

/** Brackets, which belong to the URL only while they are matched inside it: a wiki URL carrying
    `(disambiguation)` keeps its parenthesis, one wrapped in `(…)` by the writer does not. */
const PAIRS = { ')': '(', ']': '[', '}': '{', '）': '（', '」': '「', '』': '『', '】': '【' }

function occurrences(text, character) {
  let found = 0
  for (const candidate of text) if (candidate === character) found += 1
  return found
}

/**
 * A matched run's own end, with the sentence's punctuation handed back to the sentence.
 *
 * The bracket counts are taken ONCE and then decremented, rather than re-counted per step: the loop
 * only ever removes characters from the end, and re-counting made this quadratic in the length of the
 * match — `https://` followed by fifty thousand brackets is one line a spreadsheet cell can hold, and
 * it would have hung the render rather than failing.
 */
function trimTail(url) {
  const closers = new Map()
  for (const [closer, opener] of Object.entries(PAIRS)) {
    const unmatched = occurrences(url, closer) - occurrences(url, opener)
    if (unmatched > 0) closers.set(closer, unmatched)
  }

  let end = url.length
  while (end > 0) {
    const last = url[end - 1]
    if (TRAILING.includes(last)) {
      end -= 1
      continue
    }
    // Unmatched, so the writer's, not the URL's.
    const unmatched = closers.get(last)
    if (unmatched > 0) {
      closers.set(last, unmatched - 1)
      end -= 1
      continue
    }
    break
  }
  return url.slice(0, end)
}

/**
 * A URL safe to put in an `href`, or ''. The one gate; nothing else may build one.
 *
 * @param {string} raw as typed
 * @returns {string} the URL, unchanged, or '' — never a corrected or a defaulted one, a link
 *   somebody did not write being worse than no link
 */
export function safeHref(raw) {
  const url = String(raw ?? '').trim()
  if (!SAFE_URL.test(url) || CONTROL.test(url)) return ''
  return url
}

/**
 * The bare URL starting at `at`, trimmed of the sentence's punctuation, or ''.
 *
 * @param {string} text
 * @param {number} at an index into `text`
 */
export function urlAt(text, at) {
  URL_HERE.lastIndex = at
  const match = URL_HERE.exec(text)
  return match ? safeHref(trimTail(match[0])) : ''
}

/**
 * Plain text -> runs, in order, each `{ text }` plus an `href` where the run IS a URL. The shape
 * `markdown.js`'s spans use, so one renderer draws both.
 *
 * @param {string} text
 * @returns {{text: string, href?: string}[]} always at least one run for non-empty text
 */
export function splitLinks(text) {
  const source = String(text ?? '')
  const runs = []
  let at = 0
  let plainFrom = 0

  while (at < source.length) {
    const url = urlAt(source, at)
    if (!url) {
      at += 1
      continue
    }
    if (at > plainFrom) runs.push({ text: source.slice(plainFrom, at) })
    runs.push({ text: url, href: url })
    at += url.length
    plainFrom = at
  }

  if (plainFrom < source.length) runs.push({ text: source.slice(plainFrom) })
  return runs
}

/** Whether text holds a URL at all. What a checklist row asks, deciding between a title that is one
    tap target and a title carrying its own. */
export function hasLink(text) {
  return splitLinks(text).some((run) => run.href)
}
