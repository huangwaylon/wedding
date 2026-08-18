/**
 * Settings. Two kinds of value, kept visibly apart:
 *
 *   SHARED, written to the sheet so everyone sees the change: names, the wedding date, the venue,
 *   the timezone, the category list.
 *
 *   this device, `localStorage` only: the interface language, the accent, the read-only view. None
 *   may reach the sheet — nobody restyles anybody else's screen or decides what language a planner
 *   reads. Only this half is labelled, being the half nobody would guess.
 *
 * A viewer sees only the device half plus the edit-link field, everything else being a write they
 * cannot make. `hasKey`, not `canEdit`, decides which of the two the Editing section shows: an
 * editor previewing the guest view still holds a key, and a paste field would read as the link
 * having broken.
 */

import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { LOCALE_LABELS, SUPPORTED } from '../i18n/catalogs.js'
import { ACCENTS, setAccent, useAccent } from '../lib/theme.js'
import { isValidTimeZone } from '../lib/time.js'
import { parsePastedLink } from '../lib/access.js'
import BottomSheet from './BottomSheet.jsx'
import Notice from './Notice.jsx'
import { DeletedList } from './Deleted.jsx'

export default function SettingsSheet({
  config,
  canEdit,
  /** Whether this device holds a usable edit key at all — see `App` for why that is separate. */
  hasKey = canEdit,
  readOnly = false,
  onToggleReadOnly,
  sheetTimeZone,
  deletedTasks,
  onRestore,
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
            {/* One date, alone on its row. Nothing on the board reads a clock time. */}
            <div className="field">
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
              {/* `.hint` is inline, so two run together into one paragraph. Stacked explicitly,
                  and the error replaces the hint rather than shifting it. */}
              {zoneOk ? (
                <p className="hint">
                  {t('settings.timezoneHint')}
                  {/* Only when the two differ: a time typed into the sheet is read in the SHEET's
                      zone. */}
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
          <Notice title={t('access.viewOnly')} />
        </section>
      )}

      <section className="section">
        <h3 className="section__title">{t('settings.language')}</h3>
        <p className="hint section__hint">{t('settings.device')}</p>
        {/* Named, like the filter chips: a row of `aria-pressed` buttons with no group name is read
            as loose controls, the `<h3>` above it being associated with nothing. */}
        <div className="swatches" role="group" aria-label={t('settings.language')}>
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
        <div className="swatches" role="group" aria-label={t('settings.accent')}>
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
        {hasKey ? (
          <>
            {/* Above the revoke, being the one somebody wants. The label names the direction the
                tap goes, the same rule the row's Edit/Done toggle follows. */}
            <p className="hint section__hint">{t('settings.readOnlyHint')}</p>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              aria-pressed={readOnly}
              onClick={onToggleReadOnly}
            >
              {readOnly ? t('settings.readOnlyOff') : t('settings.readOnlyOn')}
            </button>

            <p className="hint section__hint">{t('access.revokeHint')}</p>
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
            {/* The hint stays: an installed app gets its own storage bucket, the only explanation
                for why somebody who HAS the edit link is shown a paste field. */}
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

      {/* Recovery lives here, not on the board: the restore list and the purge are two halves of
          one job, and together it is obvious that Purge empties the list above. */}
      {canEdit && deletedTasks.length > 0 ? (
        <section className="section">
          <h3 className="section__title">{t('settings.maintenance')}</h3>
          <DeletedList tasks={deletedTasks} onRestore={onRestore} />
          <p className="hint section__hint">
            {t('settings.compactHint', { count: deletedTasks.length })}
          </p>
          <button type="button" className="btn btn--secondary btn--block" onClick={onCompact}>
            {t('settings.compact')}
          </button>
        </section>
      ) : null}
    </BottomSheet>
  )
}
