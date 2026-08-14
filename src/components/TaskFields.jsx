/**
 * A task's fields, and the only home for the markup and the draft arithmetic behind them. Three
 * fields — a title, a day, a category — and nothing may be added: every extra control makes a task
 * something to fill in rather than write down. Two surfaces edit a task and both buffer a whole
 * draft (`TaskDetail`, `TaskFormSheet`); every field is pure value + onChange, so neither commits
 * on its own. The day is a native `type=date`, whose intrinsic width comes from the platform — see
 * `.input[type="date"]` in primitives.css, which stops it drawing past the edge of its card.
 */

import { validateTask } from '../schema.js'
import { isValidDay, normalizeDay } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'

/** The two homes this field set has: only the wrapper and label class differ, so it is a lookup
    rather than two copies of every field. */
const SKINS = {
  form: { field: 'field', label: 'label' },
  editor: { field: 'editor__field', label: 'editor__label' },
}

function skinOf(name) {
  return SKINS[name] ?? SKINS.form
}

/**
 * The one handler a control here may take. `onEnter` is not `onBlur`, and blur must never be the
 * commit: writes serialise at ~0.5s each, so a commit per blur costs a round trip and a whole-row
 * rewrite per field. A caller buffers a draft and ends the session itself. `preventDefault` because
 * this markup can sit inside a `<form>`; `blur()` to drop the iOS keyboard. Nothing here reports
 * focus: a session reports it once for the whole of itself, and the one per-field case, the
 * add-a-subtask field, implements it in `SubtaskList`.
 */
function fieldEvents({ onEnter }) {
  const events = {}
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

/** A task -> the shape the fields work in, or a blank draft for a new one. No `done`: ticking is
    `DoneToggle`'s job, and a second control would let an edit rewrite `done_at` while fixing a
    typo. */
export function draftFrom(task) {
  // A new task starts with NO day. Nothing may seed one — see `validateTask`.
  if (!task) return { title: '', category: '', due: '' }
  return {
    title: task.title,
    category: task.category,
    /* Normalised on the way IN, not only out: a cell can hold '2027-04-18T23:59' and `type=date`
       renders anything unparseable as BLANK, so the wheel would open empty and the first commit
       clear a live date. */
    due: normalizeDay(task.due),
  }
}

/**
 * The draft plus whatever it was built from -> the WHOLE task to store. `base` spreads before the
 * fields so the id, `parentId`, `doneAt` and `deletedAt` survive: `updateTasks` writes the whole
 * row from this payload, and one built without `parentId` blanks the cell and silently promotes a
 * subtask to a task. A row with a `parentId` keeps its date cell untouched, `validateTask`
 * returning early for anything with one: a day written from an empty draft would blank the cell of
 * a hand-dated row, unvalidated. The raw `parentId` is read rather than `promoted`, so a PROMOTED
 * row can be retitled but not scheduled from the UI; fixing that means teaching the schema layer
 * the difference.
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

/** Codes -> which field says what. A code family collapses to the FIRST match, a field showing one
    message; "give it a date" is the more useful of the two due codes. */
export function fieldErrors(codes) {
  const first = (...wanted) => wanted.find((code) => codes.includes(code)) ?? ''
  return {
    title: first('MISSING_TITLE'),
    due: first('MISSING_DUE', 'BAD_DUE'),
  }
}

function FieldError({ code }) {
  const { t } = useT()
  if (!code) return null
  return <span className="field__error">{t(`error.${code}`)}</span>
}

export function TitleField({ id, skin, value, error, onChange, onEnter }) {
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
        /* Not `autoFocus`: on iOS it raises the keyboard mid-animation, landing the panel half off
           screen. */
        {...fieldEvents({ onEnter })}
      />
      <FieldError code={error} />
    </div>
  )
}

/**
 * The one date, and it is REQUIRED — see `validateTask`. Full width on a row of its own, which is
 * half of why it fits: a two-track grid's per-column minimum is narrower than a `type=date`
 * control's intrinsic width, and that width is a floor. `scrollIntoView` on focus because the wheel
 * is not a keyboard — iOS raises a ~330px inline picker and `interactive-widget=resizes-content`
 * does not fire for it, so a field low in the viewport ends up under the wheel editing it.
 * `nearest` so a visible field is not yanked.
 */
export function DueField({ id, skin, value, error, onChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
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
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
      />
      <FieldError code={error} />
    </div>
  )
}

export function CategoryField({ id, skin, value, categories, onChange }) {
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
      >
        <option value="">{t('form.categoryNone')}</option>
        {/* A category the sheet holds but the configured list does not is still offered, or editing
            that task would silently drop it. */}
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
