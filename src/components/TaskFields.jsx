/**
 * A task's fields, and the only home for the markup and the draft arithmetic behind them. Four
 * fields — a title, an optional day it starts, the day it is due, a category — and nothing may be
 * added: every extra control makes a task something to fill in rather than write down. The start date
 * earns its place by being the only thing that can say a task is ALREADY MINE TO DO, which no due
 * date answers; it is optional, and the rows that do not use it show no trace of it.
 *
 * THE TWO DAYS ARE DRAWN IN THE ORDER THEY HAPPEN, start then due, and each label states whether it
 * is optional or required. Neither half works alone: ordering alone asks for the end of a span before
 * its beginning, and labels alone leave the reader to reorder it. `TaskFieldSet` is where the order
 * lives, so the two surfaces cannot disagree about it.
 *
 * Two surfaces edit a task and both buffer a whole draft (`TaskDetail`, `TaskFormSheet`); every field
 * is pure value + onChange, so neither commits on its own. Both days are native `type=date`, whose
 * intrinsic width comes from the platform — see `.input[type="date"]` in primitives.css, which stops
 * it drawing past the edge of its card.
 */

import { validateTask } from '../schema.js'
import { isValidDay, normalizeDay } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'
import { CloseIcon } from './icons.jsx'

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
  if (!task) return { title: '', category: '', due: '', start: '' }
  return {
    title: task.title,
    category: task.category,
    /* Normalised on the way IN, not only out: a cell can hold '2027-04-18T23:59' and `type=date`
       renders anything unparseable as BLANK, so the wheel would open empty and the first commit
       clear a live date. */
    due: normalizeDay(task.due),
    start: normalizeDay(task.start),
  }
}

/**
 * The draft plus whatever it was built from -> the WHOLE task to store. `base` spreads before the
 * fields so the id, `parentId`, `doneAt` and `deletedAt` survive: `updateTasks` writes the whole
 * row from this payload, and one built without `parentId` blanks the cell and silently promotes a
 * subtask to a task. A row with a `parentId` keeps BOTH its date cells untouched, `validateTask`
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
    start: '',
    ...base,
    title: draft.title,
    category: draft.category,
  }
  if (next.parentId) return next

  /**
   * A start cell the FIELD COULD NOT SHOW is left exactly as it is. An editor reads
   * `FORMATTED_VALUE`, so a cell somebody retyped in the Sheets UI arrives in the sheet's locale
   * ('15/01/2027'); `draftFrom` normalises that to blank, and writing the blank back would destroy it
   * on the first Done — silently, since nothing validates an optional day. `due` is safe from this by
   * accident: blank fails `validateTask` and the save is refused with a message. The cost is that such
   * a cell cannot be cleared from the UI either, which is the same trade as an undated row that cannot
   * be renamed until it is dated.
   */
  const unreadable = Boolean(base?.start) && !normalizeDay(base.start)
  return {
    ...next,
    due: normalizeDay(draft.due),
    start: unreadable ? base.start : normalizeDay(draft.start),
  }
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

/**
 * A label, with the note that its field is optional or required where that is not obvious. The two
 * days are the whole reason it exists: they are adjacent, they look identical, and one refuses the
 * save without a value while the other can be emptied again. It is a note ON the label, separating on
 * WEIGHT alone — it inherits the label's colour, so it reads at the label's tier in both skins.
 *
 * The space before it is for the accessibility tree, not the layout — the label names the input, so
 * without one "Start" and "optional" are announced as one word.
 */
function FieldLabel({ id, className, hint, children }) {
  return (
    <label className={className} htmlFor={id}>
      {children}
      {hint ? (
        <>
          {' '}
          <span className="field__hint">{hint}</span>
        </>
      ) : null}
    </label>
  )
}

export function TitleField({ id, skin, value, error, onChange, onEnter }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <FieldLabel id={id} className={classes.label}>
        {t('form.title')}
      </FieldLabel>
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
 * The optional day, first of the two — see the header for why the span reads in the order it happens.
 *
 * It is the only field in the app that can be emptied again, and it carries its own clear button
 * because the platform does not: iOS's date wheel offers no way back to blank, so without one a start
 * date picked by mistake is permanent and the row is stuck in This month for good. The button renders
 * only when there is something to clear, so an unused field is still one control.
 *
 * No validation of its own — the control yields a real day or nothing, and `taskFromDraft` normalises
 * on the way out, so there is no third refusal to word. A start after the due date is left alone
 * deliberately: it is somebody rescheduling, and refusing the save would be a lecture.
 */
export function StartField({ id, skin, value, onChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <FieldLabel id={id} className={classes.label} hint={t('form.optional')}>
        {t('form.start')}
      </FieldLabel>
      <div className="field__pair">
        <input
          id={id}
          type="date"
          className="input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
        />
        {value ? (
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => onChange('')}
            aria-label={t('form.startClear')}
            title={t('form.startClear')}
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The day the task is due, and the only date this app REQUIRES — `validateTask` returns `MISSING_DUE`
 * without one, and the label says so rather than leaving it to be discovered when Save refuses.
 *
 * Full width on a row of its own, which is half of why it fits: a two-track grid's per-column minimum
 * is narrower than a `type=date` control's intrinsic width, and that width is a floor.
 * `scrollIntoView` on focus because the wheel is not a keyboard — iOS raises a ~330px inline picker
 * and `interactive-widget=resizes-content` does not fire for it, so a field low in the viewport ends
 * up under the wheel editing it. `nearest` so a visible field is not yanked.
 */
export function DueField({ id, skin, value, error, onChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <FieldLabel id={id} className={classes.label} hint={t('form.required')}>
        {t('form.due')}
      </FieldLabel>
      <input
        id={id}
        type="date"
        className={`input${error ? ' input--invalid' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
        /* The claim the label makes, in the accessibility tree. The form is `noValidate` and
           `validateTask` is the only judge, so this changes no behaviour: the browser's own bubble
           would say what `error.MISSING_DUE` says, in the wrong place and without the field's ink. */
        aria-required="true"
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
      <FieldLabel id={id} className={classes.label}>
        {t('form.category')}
      </FieldLabel>
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

/**
 * THE FOUR FIELDS, in the one order they may be drawn: a title, the day it starts, the day it is due,
 * a category. Both surfaces render this rather than a copy of it — the create sheet had its own
 * assembly and no test at all, so the ordering rule and the two label hints were pinned on the
 * editor's copy alone and the other was free to drift.
 *
 * `dated` is false for a subtask: `validateTask` returns early for anything with a `parentId`, so a
 * day offered there would be stored unvalidated. `idFor` is a function rather than a prefix because
 * the two surfaces number their controls differently — one per task, one per sheet — and a duplicate
 * `id` breaks the `htmlFor` that names every field.
 */
export function TaskFieldSet({
  idFor,
  skin,
  draft,
  errors,
  categories,
  dated = true,
  onChange,
  onEnter,
}) {
  return (
    <>
      <TitleField
        id={idFor('title')}
        skin={skin}
        value={draft.title}
        error={errors.title}
        onChange={(title) => onChange({ title })}
        onEnter={onEnter}
      />
      {dated ? (
        <>
          <StartField
            id={idFor('start')}
            skin={skin}
            value={draft.start}
            onChange={(start) => onChange({ start })}
          />
          <DueField
            id={idFor('due')}
            skin={skin}
            value={draft.due}
            error={errors.due}
            onChange={(due) => onChange({ due })}
          />
        </>
      ) : null}
      <CategoryField
        id={idFor('category')}
        skin={skin}
        value={draft.category}
        categories={categories}
        onChange={(category) => onChange({ category })}
      />
    </>
  )
}
