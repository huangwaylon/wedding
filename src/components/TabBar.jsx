/**
 * The bottom tab bar. Two destinations, and the only navigation in the app.
 *
 * `<nav>` with `aria-current`, not `role="tablist"`: the ARIA tabs pattern also commits to roving
 * tabindex and arrow-key traversal, which two thumb targets gain nothing from, and getting half of
 * that pattern right is worse than not claiming it. These are destinations with their own content,
 * not panels of one widget — and `aria-current` survives a static render, which a click-driven
 * selection would not.
 *
 * Each button carries a WORD as well as a glyph. A pair of unlabelled icons is a guess, and the label
 * is also what keeps the selected tab from being carried by the accent alone.
 *
 * `App` withholds the whole bar while anything holds unsaved text: with
 * `interactive-widget=resizes-content` a bottom-fixed bar re-anchors just above the iOS keyboard,
 * where its two ~196px targets sit exactly on the accessory row — one mis-tap away from leaving an
 * open editor. `.views` reserves its height either way, CSS being unable to see the tab.
 */

import { useT } from '../i18n/index.js'
import { ChecklistIcon, ICON_SIZE, NotebookIcon } from './icons.jsx'

export const TABS = { PLAN: 'plan', NOTES: 'notes' }

const ITEMS = [
  { id: TABS.PLAN, label: 'tab.plan', Icon: ChecklistIcon },
  { id: TABS.NOTES, label: 'tab.notes', Icon: NotebookIcon },
]

export default function TabBar({ tab, onTab }) {
  const { t } = useT()

  return (
    <nav className="tabbar" aria-label={t('tab.label')}>
      <div className="tabbar__inner">
        {ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`tabbtn${tab === id ? ' tabbtn--on' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onTab(id)}
          >
            <Icon style={ICON_SIZE.tab} />
            <span className="tabbtn__label">{t(label)}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
