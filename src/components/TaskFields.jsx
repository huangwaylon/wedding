/**
 * A task's fields, and the only home for the markup and the draft arithmetic behind them.
 *
 * THREE FIELDS: a title, a day, a category. That is what a checklist needs — what it is, when it
 * is due, and roughly what kind of thing it is — and nothing may be added to it. Every extra
 * control makes a task something you fill in rather than something you write down.
 *
 * TWO SURFACES EDIT A TASK AND BOTH BUFFER A WHOLE DRAFT: `TaskDetail` for an existing task and
 * `TaskFormSheet` for a new one. Every field here is pure value + onChange, so neither surface
 * commits on its own; `onEnter`/`onFocusChange` are optional reports a caller may ignore.
 *
 * THE DAY IS A NATIVE `type=date` AND THAT IS DELIBERATE. The platform wheel is the fastest
 * date entry on a phone by a wide margin and it is the control people already know; a
 * hand-rolled calendar would be more markup, worse with a screen reader, and slower. What it
 * costs is a control whose intrinsic width comes from the platform rather than from us — see
 * `.input[type="date"]` in primitives.css, which is what stops it drawing past the edge of the
 * card it sits in.
 */

import { validateTask } from '../schema.js'
import { isValidDay, normalizeDay } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'

/**
 * The two homes this field set has. A field is identical in both; only the wrapper and the
 * label class differ — the sheet's fields are a form's, spaced apart, while the editor's sit
 * inside an already-open card — so it is a lookup rather than two copies of every field.
 */
const SKINS = {
  form: { field: 'field', label: 'label' },
  editor: { field: 'editor__field', label: 'editor__label' },
}

function skinOf(name) {
  return SKINS[name] ?? SKINS.form
}

/**
 * The handlers every control in this file shares.
 *
 * `onEnter` IS NOT `onBlur`, and blur must never be the commit: a write is ~0.5s and they
 * serialise, so committing per blur costs one round trip and one whole-row rewrite per field. A
 * caller buffers a draft and ends the session itself, so Return means "I am done with the whole
 * thing" and blur means nothing at all. `preventDefault` because this markup can sit inside a
 * `<form>`, where Return would submit it, and `blur()` because dropping the iOS keyboard is what
 * somebody pressing Return is asking for.
 *
 * `onFocusChange` survives for the ADD-A-SUBTASK field, which is genuinely per-field: it is
 * outside any edit session, so nothing else is holding off a reload while it has text in it.
 * The editor's own fields pass neither prop — the session reports focus for all of them at once.
 */
function fieldEvents({ onEnter, onFocusChange }) {
  const events = {}
  if (onFocusChange) {
    events.onFocus = () => onFocusChange(true)
    events.onBlur = () => onFocusChange(false)
  }
  if (onEnter) {
    events.onKeyDown = (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      event.currentTarget.blur()
      onEnter()
    }
  }
  return events
}

/**
 * A task -> the shape the fields work in, or a blank draft for a new one.
 *
 * There is no `done` here on purpose. Ticking a task is `DoneToggle`'s job in the card head,
 * and a second control for it in the field set would let an edit rewrite `done_at` — the
 * answer to "when was this finished" — as a side effect of fixing a typo.
 */
export function draftFrom(task) {
  // A new task starts with NO day. Nothing may seed one — see `validateTask`.
  if (!task) return { title: '', category: '', due: '' }
  return {
    title: task.title,
    category: task.category,
    /**
     * Normalised on the way IN, not just on the way out. A cell can hold '2027-04-18T23:59' —
     * the Sheets UI coerces a date, and `Code.gs`'s `readCell` hands the anonymous read exactly
     * that shape — and `type=date` renders anything unparseable as BLANK, so without this the
     * wheel opens empty and the first commit clears a date still visible on the row.
     */
    due: normalizeDay(task.due),
  }
}

/**
 * The draft plus whatever it was built from -> the WHOLE task to store.
 *
 * `base` spreads before the fields so the id, `parentId`, `doneAt` and `deletedAt` survive:
 * `updateTasks` writes the whole row from this payload, and one built without `parentId` blanks
 * the cell and silently promotes a subtask to a task. The three empty strings above it are what
 * a brand-new task needs and an existing one overrides.
 *
 * A SUBTASK KEEPS ITS DATE CELL UNTOUCHED. It is a title and a tick — `validateTask` returns
 * early for anything with a `parentId`, and no caller offers it a date field — so a day written
 * from an empty draft here would blank the cell of a row somebody hand-dated in the
 * spreadsheet, and nothing downstream would ever have checked what it wrote.
 */
export function taskFromDraft(draft, base) {
  const next = {
    doneAt: '',
    deletedAt: '',
    parentId: '',
    ...base,
    title: draft.title,
    category: draft.category,
  }
  return next.parentId ? next : { ...next, due: normalizeDay(draft.due) }
}

/** Structural failures, from the one validator both surfaces use. */
export function codesFor(task) {
  return validateTask(task, isValidDay)
}

/**
 * Codes -> which field says what. A code family collapses to the FIRST match because a field
 * shows one message.
 */
export function fieldErrors(codes) {
  const first = (...wanted) => wanted.find((code) => codes.includes(code)) ?? ''
  return {
    title: first('MISSING_TITLE'),
    /* Mutually exclusive in practice — a blank day cannot also be an unparseable one — and
       ordered anyway, because a field shows one message and "give it a date" is the more useful
       of the two if both ever arrived. */
    due: first('MISSING_DUE', 'BAD_DUE'),
  }
}

function FieldError({ code }) {
  const { t } = useT()
  if (!code) return null
  return <span className="field__error">{t(`error.${code}`)}</span>
}

export function TitleField({ id, skin, value, error, onChange, onEnter, onFocusChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {t('form.title')}
      </label>
      <input
        id={id}
        className={`input${error ? ' input--invalid' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('form.titlePlaceholder')}
        autoComplete="off"
        /* Deliberately not autoFocus: on iOS it raises the keyboard while the sheet is still
           animating in, which lands the panel half off screen. */
        {...fieldEvents({ onEnter, onFocusChange })}
      />
      <FieldError code={error} />
    </div>
  )
}

/**
 * The one date, and it is REQUIRED — see `validateTask`. Full width, on a row of its own,
 * which is half of why it fits: a two-track grid's per-column minimum is narrower than a
 * `type=date` control's own intrinsic width, and that width is a floor.
 *
 * `scrollIntoView` on focus because THE DATE WHEEL IS NOT A KEYBOARD. iOS raises a ~330px
 * inline picker for it, and `interactive-widget=resizes-content` — which is what keeps the
 * keyboard off the sheet's Save button — does not fire for it at all, so a field low in the
 * viewport ends up underneath the wheel that is editing it. `nearest` so a field already
 * comfortably visible is not yanked; the same fix `AddSubtask` needed.
 */
export function DueField({ id, skin, value, error, onChange, onFocusChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  const events = fieldEvents({ onFocusChange })
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {t('form.due')}
      </label>
      <input
        id={id}
        type="date"
        className={`input${error ? ' input--invalid' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...events}
        onFocus={(event) => {
          events.onFocus?.(event)
          event.currentTarget.scrollIntoView({ block: 'nearest' })
        }}
      />
      <FieldError code={error} />
    </div>
  )
}

export function CategoryField({ id, skin, value, categories, onChange, onFocusChange }) {
  const { t } = useT()
  const categoryLabel = useCategoryLabel()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {t('form.category')}
      </label>
      <select
        id={id}
        className="input select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...fieldEvents({ onFocusChange })}
      >
        <option value="">{t('form.categoryNone')}</option>
        {/* A category the sheet holds but the configured list does not — somebody renamed it in
            the spreadsheet — is still offered, or editing that task would silently drop it. */}
        {(value && !categories.includes(value) ? [value, ...categories] : categories).map(
          (name) => (
            <option key={name} value={name}>
              {categoryLabel(name)}
            </option>
          ),
        )}
      </select>
    </div>
  )
}
