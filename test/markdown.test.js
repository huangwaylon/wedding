/**
 * The notes document's grammar and the toolbar's three transforms.
 *
 * Both halves are pure, which is why they live in `lib/`: the parser's job is to decide what a line
 * IS, and the transforms' is to decide where the caret ends up — neither needs a DOM, and the
 * awkward cases (a bare caret, a mixed run of lines, half-finished emphasis) are unreachable from a
 * static render.
 *
 * The renderer is asserted in `test/render.test.jsx`; what matters here is that nothing this
 * produces can carry markup.
 */

import { describe, expect, it } from 'vitest'
import { parseMarkdown, toggleBold, toggleBullets, toggleHeading } from '../src/lib/markdown.js'

/** The blocks' kinds, in order: the quickest way to say what a document became. */
const kinds = (text) => parseMarkdown(text).map((block) => block.kind)

/** One block's plain text, marks dropped. */
function words(block) {
  const runs = block.spans ?? (block.items ?? block.lines ?? []).flat()
  return runs.map((span) => span.text).join('')
}

describe('parseMarkdown: blocks', () => {
  it('reads a heading, a bullet list, a numbered list and text', () => {
    const blocks = parseMarkdown('# Venue\n- Pavilion\n- Garden\n1. Deposit\nBooked it.')
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'bullets', 'numbers', 'text'])
    expect(blocks[0].level).toBe(1)
    expect(blocks[1].items).toHaveLength(2)
    expect(words(blocks[1])).toBe('PavilionGarden')
  })

  it('collapses a deeper heading onto the last level it has a size for', () => {
    // The type scale has four steps and no fifth: a `###` pasted from somebody's notes must render
    // as a heading rather than printing its own hashes.
    expect(parseMarkdown('### Deep').map((block) => block.level)).toEqual([2])
    expect(parseMarkdown('###### Deeper')[0].level).toBe(2)
  })

  it('needs a space after the hash, so a numbered thing is not a heading', () => {
    expect(kinds('#1 dress')).toEqual(['text'])
    expect(words(parseMarkdown('#1 dress')[0])).toBe('#1 dress')
  })

  it('drops a list marker’s own number, since the list numbers itself', () => {
    // `3.` typed first would otherwise print a 3 that no later edit corrects.
    const [list] = parseMarkdown('3. First\n4. Second')
    expect(list.kind).toBe('numbers')
    expect(list.items.map((item) => item[0].text)).toEqual(['First', 'Second'])
  })

  it('takes `*` as a bullet as well as `-`, and an indent of up to three spaces', () => {
    expect(kinds('* One\n   - Two')).toEqual(['bullets'])
    expect(parseMarkdown('* One\n   - Two')[0].items).toHaveLength(2)
  })

  it('KEEPS A SINGLE NEWLINE AS A LINE BREAK, and a blank line as a paragraph', () => {
    // CommonMark reflows consecutive lines into one paragraph. On a phone that means three things
    // typed on three lines arrive as one sentence, which is the commonest surprise in any markdown
    // field — and this document is somebody writing down what was decided.
    const blocks = parseMarkdown('One\nTwo\n\nThree')
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'text'])
    expect(blocks[0].lines).toHaveLength(2)
    expect(blocks[1].lines).toHaveLength(1)
  })

  it('collapses any run of blank lines rather than stacking empty blocks', () => {
    expect(kinds('One\n\n\n\n\nTwo')).toEqual(['text', 'text'])
    expect(parseMarkdown('\n\n \n\t\n')).toEqual([])
  })

  it('runs consecutive items into ONE list, and a change of marker into two', () => {
    expect(kinds('- a\n- b\n- c')).toEqual(['bullets'])
    expect(kinds('- a\n1. b')).toEqual(['bullets', 'numbers'])
  })

  it('survives an empty document, a null and a lone marker', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(null)).toEqual([])
    expect(parseMarkdown(undefined)).toEqual([])
    expect(kinds('-')).toEqual(['text'])
    expect(kinds('#')).toEqual(['text'])
  })

  it('reads CRLF, which is what a paste from Windows carries', () => {
    expect(kinds('# A\r\n- b\r\n')).toEqual(['heading', 'bullets'])
  })
})

describe('parseMarkdown: marks', () => {
  it('marks bold and italic, and nests them', () => {
    expect(parseMarkdown('**a**')[0].lines[0]).toEqual([{ text: 'a', bold: true }])
    expect(parseMarkdown('*a*')[0].lines[0]).toEqual([{ text: 'a', italic: true }])
    expect(parseMarkdown('**a *b***')[0].lines[0]).toEqual([
      { text: 'a ', bold: true },
      { text: 'b', italic: true, bold: true },
    ])
  })

  it('keeps the surrounding text as its own runs', () => {
    expect(parseMarkdown('say **yes** now')[0].lines[0]).toEqual([
      { text: 'say ' },
      { text: 'yes', bold: true },
      { text: ' now' },
    ])
  })

  it('RENDERS AN UNMATCHED MARKER AS TYPED', () => {
    // Half-finished emphasis is what a document looks like mid-sentence. Swallowing the rest of the
    // line — or the rest of the document — is how a notes field loses somebody's paragraph while
    // they are still typing it.
    expect(words(parseMarkdown('**not closed')[0])).toBe('**not closed')
    expect(parseMarkdown('**not closed')[0].lines[0]).toEqual([{ text: '**not closed' }])
  })

  it('needs a non-space inside the marker, so arithmetic survives', () => {
    // `2 * 3 * 4` italicised everything between the asterisks before this rule existed.
    expect(parseMarkdown('2 * 3 * 4')[0].lines[0]).toEqual([{ text: '2 * 3 * 4' }])
    expect(parseMarkdown('a ** b ** c')[0].lines[0]).toEqual([{ text: 'a ** b ** c' }])
  })

  it('does not let a bold marker open an italic one', () => {
    // `**` is tested before `*`, or every bold run opens an italic that closes on its partner.
    const [span] = parseMarkdown('**both**')[0].lines[0]
    expect(span).toEqual({ text: 'both', bold: true })
  })

  it('never produces anything but text and two flags, whatever is in the document', () => {
    // The parser is the reason there is no `dangerouslySetInnerHTML` anywhere: a span carries a
    // string and at most `bold`/`italic`, so markup in the sheet is text on screen.
    const nasty = '<script>alert(1)</script>\n- <img src=x onerror=y>\n# [a](javascript:1)'
    for (const block of parseMarkdown(nasty)) {
      for (const span of block.spans ?? (block.items ?? block.lines).flat()) {
        expect(Object.keys(span).every((key) => ['text', 'bold', 'italic'].includes(key))).toBe(true)
        expect(typeof span.text).toBe('string')
      }
    }
    // And a link is not a block or a mark at all: it stays the characters somebody typed.
    expect(words(parseMarkdown('[a](javascript:1)')[0])).toBe('[a](javascript:1)')
  })
})

describe('toggleBold', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(toggleBold('say yes now', 4, 7)).toEqual({ text: 'say **yes** now', start: 6, end: 9 })
  })

  it('unwraps when the marks sit just outside the selection', () => {
    // Which is exactly where the wrap above leaves them, so a second tap undoes the first.
    const once = toggleBold('say yes now', 4, 7)
    expect(toggleBold(once.text, once.start, once.end)).toEqual({
      text: 'say yes now',
      start: 4,
      end: 7,
    })
  })

  it('unwraps when the marks sit inside the selection, which is how a double-tap selects', () => {
    expect(toggleBold('say **yes** now', 4, 11)).toEqual({ text: 'say yes now', start: 4, end: 7 })
  })

  it('opens an empty pair for a bare caret and puts the caret between them', () => {
    expect(toggleBold('ab', 1, 1)).toEqual({ text: 'a****b', start: 3, end: 3 })
  })

  it('closes that empty pair again if nothing was typed into it', () => {
    const opened = toggleBold('ab', 1, 1)
    expect(toggleBold(opened.text, opened.start, opened.end)).toEqual({
      text: 'ab',
      start: 1,
      end: 1,
    })
  })
})

describe('toggleBullets and toggleHeading', () => {
  it('prefixes every line the selection touches, from anywhere in the first line', () => {
    const edit = toggleBullets('one\ntwo\nthree', 1, 5)
    expect(edit.text).toBe('- one\n- two\nthree')
    // The whole block stays selected, so a second tap toggles exactly what the first one did.
    expect(edit.text.slice(edit.start, edit.end)).toBe('- one\n- two')
  })

  it('strips only when EVERY touched line carries the mark', () => {
    // A mixed run that alternated per line would never converge: each tap would flip half of it.
    expect(toggleBullets('- one\ntwo', 0, 9).text).toBe('- one\n- two')
    expect(toggleBullets('- one\n- two', 0, 11).text).toBe('one\ntwo')
  })

  it('replaces a mark rather than stacking one on top of it', () => {
    expect(toggleBullets('* one\ntwo', 0, 9).text).toBe('- one\n- two')
    expect(toggleHeading('## one\ntwo', 0, 10).text).toBe('# one\n# two')
  })

  it('leaves a blank line alone, since a bullet on nothing is a stray dash', () => {
    // And it is the one thing the parser would then read as an item.
    expect(toggleBullets('one\n\ntwo', 0, 8).text).toBe('- one\n\n- two')
  })

  it('toggles a single line from a bare caret', () => {
    expect(toggleHeading('Venue', 2, 2).text).toBe('# Venue')
    expect(toggleHeading('# Venue', 3, 3).text).toBe('Venue')
  })

  it('works on the first line of a document and on the last, with no trailing newline', () => {
    expect(toggleBullets('only', 0, 0).text).toBe('- only')
    expect(toggleBullets('a\nb', 2, 3).text).toBe('a\n- b')
  })
})
