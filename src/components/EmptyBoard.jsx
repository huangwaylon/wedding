/**
 * The empty board, and the only place a starter checklist is offered. A viewer gets a sentence and
 * nothing else: buttons they cannot press are worse, and "the board is empty" alone would read as a
 * fault.
 *
 * Seeding needs the wedding date, every template offset counting backwards from it, so the empty
 * state says what is missing rather than disabling the buttons. A template is its name, its size
 * and a button; each list appears on the board the moment it is chosen.
 */

import { TEMPLATES } from '../lib/templates.js'
import { useT } from '../i18n/index.js'
import EmptyState from './EmptyState.jsx'
import { RingsIcon } from './icons.jsx'

export default function EmptyBoard({ canEdit, weddingDay, seeding, onSeed, onOpenSettings }) {
  const { t } = useT()

  return (
    <EmptyState mark={RingsIcon} title={t('empty.title')}>
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
    </EmptyState>
  )
}
