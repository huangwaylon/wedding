/**
 * The bottom tab bar. Two destinations, and the only navigation in the app.
 *
 * `<nav>` with `aria-current`, not `role="tablist"`: the ARIA tabs pattern also
 * commits to arrow-key traversal and a focus contract that a two-item bar at the
 * bottom of a phone screen gains nothing from, and getting half of that pattern
 * right is worse than not claiming it.
 *
 * Each button carries a WORD as well as a glyph. A pair of unlabelled icons is a
 * guess, and the two labels cost one line of 13px type at the bottom of the screen.
 */

import { useT } from '../i18n/index.js'
import { ListIcon, RingsIcon } from './icons.jsx'

export const TABS = { HOME: 'home', TIMELINE: 'timeline' }

const ITEMS = [
  { id: TABS.HOME, label: 'tab.home', Icon: RingsIcon },
  { id: TABS.TIMELINE, label: 'tab.timeline', Icon: ListIcon },
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
            <Icon style={{ width: '1.375rem', height: '1.375rem' }} />
            <span className="tabbtn__label">{t(label)}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
