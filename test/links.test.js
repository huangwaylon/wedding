/**
 * `src/lib/links.js` — what counts as a URL, and what may reach an `href`.
 *
 * The security half of the notes document and of a checklist item. Every assertion here is about a
 * refusal: the document is written by anybody holding the edit key and read by everybody, so the
 * question is never "does a link work" but "what does this turn into an element". A refusal must come
 * out as the characters that were typed, which is the same rule the markdown grammar follows for a
 * marker matching nothing.
 */

import { describe, expect, it } from 'vitest'
import { hasLink, safeHref, splitLinks, urlAt } from '../src/lib/links.js'

describe('safeHref', () => {
  it('passes http and https through unchanged', () => {
    // Unchanged, not corrected: a link somebody did not write is worse than no link.
    for (const url of [
      'https://venue.example',
      'http://venue.example/hall?a=1&b=2#deposit',
      'HTTPS://VENUE.EXAMPLE',
      'https://例え.example/会場',
    ]) {
      expect(safeHref(url), url).toBe(url)
    }
    expect(safeHref('  https://venue.example  ')).toBe('https://venue.example')
  })

  it('refuses every other scheme, and the ways one is smuggled', () => {
    // THE assertion in this file. `javascript:` is a URL; so is a scheme with a newline in it, which
    // some engines strip before parsing. The rule is a positive allowlist for exactly that reason.
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'mailto:a@b.example',
      'tel:+819012345678',
      'about:blank',
      '//venue.example',
      '/wedding/',
      'venue.example',
      'www.venue.example',
      'https://',
      'https:// venue.example',
      '',
      null,
      undefined,
      {},
    ]) {
      expect(safeHref(url), String(url)).toBe('')
    }
  })

  it('refuses a control character anywhere in the URL', () => {
    expect(safeHref('https://venue.example/\u0000x')).toBe('')
    expect(safeHref('https://venue.example/\u0009x')).toBe('')
  })
})

describe('urlAt', () => {
  it('reads a URL only where one starts', () => {
    const line = 'see https://venue.example now'
    expect(urlAt(line, 4)).toBe('https://venue.example')
    expect(urlAt(line, 0)).toBe('')
    expect(urlAt(line, 5)).toBe('')
  })

  it('hands the sentence back its own punctuation', () => {
    // A trailing stop belongs to the sentence, in both alphabets: a full-width character inside an
    // href is a 404 nobody can see.
    expect(urlAt('https://venue.example.', 0)).toBe('https://venue.example')
    expect(urlAt('https://venue.example,', 0)).toBe('https://venue.example')
    expect(urlAt('https://venue.example。', 0)).toBe('https://venue.example')
    expect(urlAt('https://venue.example)', 0)).toBe('https://venue.example')
    expect(urlAt('https://venue.example」', 0)).toBe('https://venue.example')
  })

  it('keeps a bracket the URL itself opened', () => {
    // A wiki URL carrying `(disambiguation)` is one URL; the same bracket wrapping it is the
    // writer's. Counting is the only way to tell them apart.
    expect(urlAt('https://x.example/a_(b)', 0)).toBe('https://x.example/a_(b)')
    expect(urlAt('https://x.example/a_(b))', 0)).toBe('https://x.example/a_(b)')
  })

  it('trims a pathological run of brackets in linear time', () => {
    // A spreadsheet cell holds 50,000 characters, so this is a line somebody can paste. Re-counting
    // the brackets per step made the trim quadratic, which is a hung render rather than a wrong
    // answer — the assertion is the wall clock as much as the value.
    const url = 'https://x.example/' + ')'.repeat(20_000)
    const started = performance.now()
    expect(urlAt(url, 0)).toBe('https://x.example/')
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('keeps a path that ends in something that is not punctuation', () => {
    expect(urlAt('https://x.example/a/', 0)).toBe('https://x.example/a/')
    expect(urlAt('https://x.example/a-b_c~d', 0)).toBe('https://x.example/a-b_c~d')
  })
})

describe('splitLinks', () => {
  it('returns the text as runs, with an href on the ones that are URLs', () => {
    expect(splitLinks('Quote: https://venue.example/q, then call')).toEqual([
      { text: 'Quote: ' },
      { text: 'https://venue.example/q', href: 'https://venue.example/q' },
      { text: ', then call' },
    ])
  })

  it('finds every URL on the line, not just the first', () => {
    const runs = splitLinks('https://a.example https://b.example')
    expect(runs.filter((run) => run.href).map((run) => run.href)).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('leaves text with no URL as exactly one run', () => {
    expect(splitLinks('Book the venue')).toEqual([{ text: 'Book the venue' }])
    expect(splitLinks('')).toEqual([])
    expect(splitLinks(null)).toEqual([])
  })

  it('never drops or duplicates a character', () => {
    // The whole text has to come back: a checklist row renders these runs and nothing else, so a
    // dropped run is a title with a hole in it.
    for (const text of [
      'https://a.example',
      'a https://b.example c',
      'javascript:alert(1) https://c.example',
      '（https://d.example）',
      'https://e.example。つづき',
    ]) {
      expect(splitLinks(text).map((run) => run.text).join(''), text).toBe(text)
    }
  })
})

describe('hasLink', () => {
  it('is what a checklist row asks before it splits itself in two', () => {
    expect(hasLink('https://venue.example')).toBe(true)
    expect(hasLink('Quote: https://venue.example please')).toBe(true)
    expect(hasLink('Book the venue')).toBe(false)
    // A refused scheme is not a link, so the row stays one tap target.
    expect(hasLink('javascript:alert(1)')).toBe(false)
    expect(hasLink('email a@b.example')).toBe(false)
  })
})
