/**
 * The only anchor in the app, and the only place plain text becomes links.
 *
 * `target="_blank"` IS LOAD-BEARING, not a preference. Installed to the Home Screen the app runs
 * standalone, with no address bar and no Back: a same-window navigation replaces the board with
 * somebody's venue page and the only way back is to kill the app. With the target, iOS hands the URL
 * to a Safari sheet over the app, which has its own Done button, and the board is still there behind
 * it. `rel` goes with it — `noopener` so the opened page cannot reach `window.opener` and drive this
 * one, `noreferrer` so a board URL carrying an edit key never leaves in a `Referer`.
 *
 * The href is already refused-or-safe: `links.js` allowlists `http` and `https` and everything else
 * arrives here as text. Nothing may build an anchor without going through it.
 *
 * The glyph trails the words and never replaces them: on this tab a link is the one thing that leaves
 * the app, and in a standalone app that is a bigger step than a tap usually is.
 */

import { splitLinks } from '../lib/links.js'
import { useT } from '../i18n/index.js'
import { ExternalLinkIcon, ICON_SIZE } from './icons.jsx'

export default function ExternalLink({ href, children }) {
  const { t } = useT()
  return (
    <a
      className="link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      /* A description, not the name: the words inside are the name, and a `title` is the only place
         to say where the tap goes on a surface with no status bar. */
      title={t('link.newTab')}
    >
      {children}
      <ExternalLinkIcon className="link__mark" style={ICON_SIZE.inline} />
    </a>
  )
}

/**
 * Plain text with its URLs made live. For text that carries no grammar of its own — a checklist
 * item's title — where the notes document goes through `Markdown` instead.
 *
 * Index keys are correct here: the runs are derived from the text and have no identity to preserve,
 * and nothing inside one holds focus or state.
 */
export function LinkedText({ text }) {
  return splitLinks(text).map((run, index) =>
    run.href ? (
      <ExternalLink key={index} href={run.href}>
        {run.text}
      </ExternalLink>
    ) : (
      run.text
    ),
  )
}
