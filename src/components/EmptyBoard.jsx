/**
 * The empty board, and the one place a starter checklist is offered.
 *
 * A viewer gets a sentence and nothing else — a planner arriving before the couple has added
 * anything should not be shown two buttons they cannot press, and "the board is empty" alone
 * would read as a fault.
 *
 * Seeding needs the wedding date, because every template offset is counted backwards from it.
 * Rather than disable the buttons and leave somebody guessing why, the empty state says what is
 * missing and offers the way to fix it.
 *
 * A template is its name, its size and a button. What each list contains is fifty-two rows
 * long and appears on the board the moment it is chosen, so a paragraph describing it here
 * would be read once and never again.
 */

import { TEMPLATES } from '../lib/templates.js'
import { useT } from '../i18n/index.js'
import { PeaksIcon } from './icons.jsx'

export default function EmptyBoard({ canEdit, weddingDay, seeding, onSeed, onOpenSettings }) {
  const { t } = useT()

  return (
    <section className="card empty">
      <p aria-hidden="true">
        <PeaksIcon style={{ width: '2rem', height: '2rem', color: 'var(--ink-4)' }} />
      </p>
      <h2 className="empty__title">{t('empty.title')}</h2>

      {!canEdit ? (
        <p className="empty__body">{t('empty.viewer')}</p>
      ) : !weddingDay ? (
        <>
          <p className="empty__body">{t('empty.needsDate')}</p>
          <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
            {t('empty.setDate')}
          </button>
        </>
      ) : (
        <div className="templates">
          {TEMPLATES.map((template) => (
            <article className="template" key={template.id}>
              <h3 className="template__title">{t(`template.${template.id}`)}</h3>
              <div className="template__foot">
                <span className="hint tnum">
                  {t('template.count', { count: template.tasks.length })}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={seeding}
                  onClick={() => onSeed(template.id)}
                >
                  {seeding ? t('empty.seeding') : t('template.use')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
