/**
 * The notes document, rendered.
 *
 * ELEMENTS, NEVER MARKUP. `parseMarkdown` hands back blocks of `{ text, bold?, italic? }` and this
 * maps them onto React nodes, so no HTML string is built anywhere and `dangerouslySetInnerHTML`
 * appears in no file: the document is written by anybody holding the edit key and read by everybody,
 * which is a shared credential in front of an injection surface if markup is ever concatenated.
 *
 * `h2`/`h3`, not `h1`/`h2`: the `h1` is the couple's names in the pinned header, on both tabs, so
 * the document's own top level is the next one down and the heading order stays legal for a screen
 * reader. `strong`/`em` rather than `b`/`i`, which carry no meaning of their own.
 *
 * Index keys are correct here and only here: a document has no identity to preserve across renders —
 * it is replaced whole on every save, and nothing inside it holds focus or state.
 */

import { Fragment } from 'react'
import { parseMarkdown } from '../lib/markdown.js'

/** One line's runs. Italic inside bold, so `**a *b***` nests rather than choosing. */
function Runs({ spans }) {
  return spans.map((span, index) => {
    let node = span.text
    if (span.italic) node = <em>{node}</em>
    if (span.bold) node = <strong>{node}</strong>
    return <Fragment key={index}>{node}</Fragment>
  })
}

/** A paragraph's lines, `<br>` between: a single newline is a line break here — see `markdown.js`. */
function Lines({ lines }) {
  return lines.map((spans, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      <Runs spans={spans} />
    </Fragment>
  ))
}

function Block({ block }) {
  if (block.kind === 'heading') {
    // Classed for the element it IS, not the document level it came from, so the stylesheet and the
    // DOM agree and nobody has to translate between the two.
    return block.level === 1 ? (
      <h2 className="doc__h2">
        <Runs spans={block.spans} />
      </h2>
    ) : (
      <h3 className="doc__h3">
        <Runs spans={block.spans} />
      </h3>
    )
  }

  if (block.kind === 'bullets' || block.kind === 'numbers') {
    const List = block.kind === 'numbers' ? 'ol' : 'ul'
    return (
      <List className={`doc__list doc__list--${block.kind}`}>
        {block.items.map((spans, index) => (
          <li className="doc__item" key={index}>
            <Runs spans={spans} />
          </li>
        ))}
      </List>
    )
  }

  return (
    <p className="doc__p">
      <Lines lines={block.lines} />
    </p>
  )
}

/**
 * @param {string} props.text the raw markdown
 * @returns the document, or null when there is nothing in it — the empty state is the caller's, who
 *   is the only one who knows whether the reader can do anything about it
 */
export default function Markdown({ text }) {
  const blocks = parseMarkdown(text)
  if (!blocks.length) return null
  return (
    <div className="doc">
      {blocks.map((block, index) => (
        <Block block={block} key={index} />
      ))}
    </div>
  )
}
