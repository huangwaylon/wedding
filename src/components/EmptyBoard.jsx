/**
 * The empty board, and the one place a starter checklist is offered.
 *
 * A viewer gets a sentence and nothing else — a planner arriving before the couple
 * has added anything should not be shown two buttons they cannot press.
 *
 * Seeding needs the wedding date, because every template offset is counted backwards
 * from it. Rather than disable the buttons and leave somebody guessing why, the empty
 * state says what is missing and offers the way to fix it.
 */

import { TEMPLATES } from '../lib/templates.js'
import { useT } from '../i18n/index.js'
import { RingsIcon } from './icons.jsx'

export default function EmptyBoard({ canEdit, weddingDay, seeding, onSeed, onOpenSettings }) {
  const { t } = useT()

  return (
    <section className="card empty">
      <p aria-hidden="true">
        <RingsIcon style={{ width: '2rem', height: '2rem', color: 'var(--ink-4)' }} />
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
        <>
          <p className="empty__body">{t('empty.editor')}</p>
          <h3 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
            {t('empty.seedTitle')}
          </h3>
          <div className="templates">
            {TEMPLATES.map((template) => (
              <article className="template" key={template.id}>
                <h4 className="template__title">{t(`template.${template.id}`)}</h4>
                <p className="template__about">{t(`template.${template.id}.about`)}</p>
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
        </>
      )}
    </section>
  )
}
