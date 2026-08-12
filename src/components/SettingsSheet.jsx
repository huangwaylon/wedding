/**
 * Settings. Two kinds of value, kept visibly apart because the distinction matters:
 *
 *   SHARED — written to the sheet, so everyone on the board sees the change: names,
 *   the wedding date and time, the venue, the timezone, the category list.
 *
 *   THIS DEVICE — `localStorage` only: the interface language and the accent. Neither
 *   may ever reach the sheet. The couple and their planners all read the same board
 *   and none of them gets to restyle anybody else's screen, or decide what language
 *   a planner reads. Only that half is labelled, because it is the half nobody would
 *   guess: an editor's own name and venue are obviously shared with the board.
 *
 * A viewer sees only the device half plus the edit-link field, because everything
 * else is a write they cannot make.
 *
 * Three sentences here survive the text pass on purpose, and each one is attached to a
 * control that is ambiguous without it: what the timezone reinterprets, what Purge destroys,
 * and that revoking editing is undone by the link somebody already has.
 */

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { LOCALE_LABELS, SUPPORTED } from '../i18n/catalogs.js'
import { ACCENTS, setAccent, useAccent } from '../lib/theme.js'
import { isValidTimeZone } from '../lib/time.js'
import { parsePastedLink } from '../lib/access.js'
import BottomSheet from './BottomSheet.jsx'

export default function SettingsSheet({
  config,
  canEdit,
  sheetTimeZone,
  deletedCount,
  onSaveConfig,
  onCompact,
  onEnableEditing,
  onRevokeEditing,
  onClose,
}) {
  const { t, locale, setLocale } = useT()
  const accent = useAccent()

  const [draft, setDraft] = useState(() => ({
    partner1Name: config.partner1Name,
    partner2Name: config.partner2Name,
    weddingDate: config.weddingDate,
    weddingTime: config.weddingTime,
    venue: config.venue,
    timezone: config.timezone,
    categories: config.categories.join(', '),
  }))
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (patch) => setDraft((previous) => ({ ...previous, ...patch }))
  const zoneOk = isValidTimeZone(draft.timezone)

  const save = async () => {
    if (!zoneOk) return
    setBusy(true)
    const saved = await onSaveConfig({
      ...draft,
      categories: draft.categories
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    })
    setBusy(false)
    if (saved) onClose()
  }

  const enable = () => {
    const key = parsePastedLink(pasted)
    if (!key) {
      setPasteError(true)
      return
    }
    setPasteError(false)
    setPasted('')
    onEnableEditing(key)
  }

  return (
    <BottomSheet
      title={t('settings.title')}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={busy || !zoneOk}
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      {canEdit ? (
        <>
          <section className="section">
            <h3 className="section__title">{t('settings.couple')}</h3>
            <div className="field__row">
              <div>
                <label className="label" htmlFor="p1">
                  {t('settings.partner1')}
                </label>
                <input
                  id="p1"
                  className="input"
                  value={draft.partner1Name}
                  onChange={(event) => set({ partner1Name: event.target.value })}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label" htmlFor="p2">
                  {t('settings.partner2')}
                </label>
                <input
                  id="p2"
                  className="input"
                  value={draft.partner2Name}
                  onChange={(event) => set({ partner2Name: event.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
          </section>

          <section className="section">
            <h3 className="section__title">{t('settings.wedding')}</h3>
            {/* `.field` supplies the 16px; `.field__row` on its own has none, so this pair
                butted straight into the Venue label below it. */}
            <div className="field field__row">
              <div>
                <label className="label" htmlFor="wdate">
                  {t('settings.weddingDate')}
                </label>
                <input
                  id="wdate"
                  type="date"
                  className="input"
                  value={draft.weddingDate}
                  onChange={(event) => set({ weddingDate: event.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="wtime">
                  {t('settings.weddingTime')}
                </label>
                <input
                  id="wtime"
                  type="time"
                  className="input"
                  value={draft.weddingTime}
                  onChange={(event) => set({ weddingTime: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="venue">
                {t('settings.venue')}
              </label>
              <input
                id="venue"
                className="input"
                value={draft.venue}
                onChange={(event) => set({ venue: event.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="tz">
                {t('settings.timezone')}
              </label>
              <input
                id="tz"
                className={`input${zoneOk ? '' : ' input--invalid'}`}
                value={draft.timezone}
                onChange={(event) => set({ timezone: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              {/* `.hint` is inline, so two of them ran together into one paragraph. Stacked
                  explicitly, and the error replaces the hint rather than shifting it. */}
              {zoneOk ? (
                <p className="hint">
                  {t('settings.timezoneHint')}
                  {/* Only worth saying when the two actually differ: a time typed straight
                      into the spreadsheet is interpreted by the SHEET's zone, not this one. */}
                  {sheetTimeZone && sheetTimeZone !== draft.timezone ? (
                    <>
                      {' '}
                      {t('settings.timezoneMismatch', { zone: sheetTimeZone })}
                    </>
                  ) : null}
                </p>
              ) : (
                <span className="field__error">{t('settings.timezoneBad')}</span>
              )}
            </div>
          </section>

          <section className="section">
            <h3 className="section__title">{t('settings.categories')}</h3>
            <div className="field">
              <input
                className="input"
                value={draft.categories}
                onChange={(event) => set({ categories: event.target.value })}
                aria-label={t('settings.categories')}
                autoComplete="off"
              />
              <span className="hint">{t('settings.categoriesHint')}</span>
            </div>
          </section>
        </>
      ) : (
        <section className="section">
          <div className="notice">
            <span className="notice__title">{t('access.viewOnly')}</span>
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section__title">{t('settings.language')}</h3>
        <p className="section__hint">{t('settings.device')}</p>
        <div className="swatches">
          {SUPPORTED.map((tag) => (
            <button
              type="button"
              key={tag}
              className="chip"
              aria-pressed={locale === tag}
              onClick={() => setLocale(tag)}
            >
              {LOCALE_LABELS[tag]}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">{t('settings.accent')}</h3>
        <div className="swatches">
          {ACCENTS.map((name) => (
            <button
              type="button"
              key={name}
              className="swatch"
              /* The swatch scopes the preset locally, which is why the accent rules
                 in tokens.css are attribute-scoped rather than :root-scoped. */
              data-accent={name}
              aria-pressed={accent === name}
              onClick={() => setAccent(name)}
            >
              <span className="swatch__dot" aria-hidden="true" />
              {t(`accent.${name}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">{t('settings.access')}</h3>
        {canEdit ? (
          <>
            <p className="section__hint">{t('access.revokeHint')}</p>
            <button type="button" className="btn btn--secondary btn--block" onClick={onRevokeEditing}>
              {t('access.revoke')}
            </button>
          </>
        ) : (
          <div className="field">
            <label className="label" htmlFor="editlink">
              {t('access.pasteLabel')}
            </label>
            <input
              id="editlink"
              className={`input${pasteError ? ' input--invalid' : ''}`}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {/* The hint stays: an installed app gets its own storage bucket, which is the only
                explanation for why somebody who HAS the edit link is being shown a paste
                field. Without it the field reads as a demand for a credential they thought
                they already had. */}
            {pasteError ? (
              <span className="field__error">{t('access.pasteBad')}</span>
            ) : (
              <span className="hint">{t('access.pasteHint')}</span>
            )}
            <div className="notice__actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={enable}>
                {t('access.pasteAction')}
              </button>
            </div>
          </div>
        )}
      </section>

      {canEdit && deletedCount > 0 ? (
        <section className="section">
          <h3 className="section__title">{t('settings.maintenance')}</h3>
          <p className="section__hint">{t('settings.compactHint', { count: deletedCount })}</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={onCompact}>
            {t('settings.compact')}
          </button>
        </section>
      ) : null}
    </BottomSheet>
  )
}
