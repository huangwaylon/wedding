/**
 * A task's fields, and the only home for the markup and the draft arithmetic behind them.
 *
 * Two surfaces edit a task and they commit differently — `TaskEditor` sends each field as
 * focus leaves it, `TaskFormSheet` buffers a whole draft and submits once — so every field
 * here is pure value + onChange, and `onCommit` is the optional report that blur or Enter
 * happened. The two must not own separate copies of the rules below: a second copy of the
 * all-day handling is a second chance to get 23:59 wrong.
 *
 * Dates and times are split into separate `date` and `time` inputs rather than one
 * `datetime-local`. Three reasons, and the first is the deciding one: an all-day task has no
 * time at all, and `datetime-local` cannot express that without either inventing a clock
 * reading or swapping the control type mid-form. The second is that iOS Safari's
 * `datetime-local` picker is a combined spinner that is markedly slower to set than the date
 * wheel, and entering a task has to be fast enough to do standing in a venue. The third is
 * that `date` and `time` degrade independently.
 *
 * The stored value is always a full wall-clock string; an all-day task gets 00:00 and 23:59,
 * so progress arithmetic never has to special-case it. That is also why the end time is 23:59
 * rather than the next midnight: a task due Friday must be overdue on Saturday morning, not
 * 99% complete.
 */

import { validateTask } from '../schema.js'
import { endOfDay, isValidWall, normalizeWall, startOfDay, wallDay } from '../lib/time.js'
import { useCategoryLabel, useT } from '../i18n/index.js'

/** Offered when the clock is turned on, so nobody has to spin a wheel from 00:00. */
const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'

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
 * Blur and Enter are ONE path: Enter blurs the control and lets the blur handler commit. Two
 * separate handlers would both fire on a Return keypress, and the second would be reasoning
 * about a draft the first has already cleared. Blurring also drops the iOS keyboard, which is
 * what somebody pressing Return is asking for. `preventDefault` because this markup can sit
 * inside a `<form>`, where Return would submit it.
 *
 * The commit runs BEFORE focus is reported gone: the app holds off a service-worker reload
 * while a field has focus, and that guard has to stay up until the write it is guarding has
 * been handed over.
 *
 * `onFocusChange` is reported by every control, not just the ones that raise a keyboard — the
 * fixed FAB does not travel with the keyboard and would otherwise sit over these fields, and a
 * reload must not land between a keystroke and the blur that saves it. A caller that buffers
 * its own draft passes neither prop and gets no handlers at all.
 *
 * @param {object} handlers
 * @param {boolean} [handlers.enter] false where Return means a newline, or a wheel's own
 *   confirmation, rather than "I am done with this field"
 */
function fieldEvents({ onCommit, onFocusChange, enter = true }) {
  const events = {}
  if (onFocusChange) events.onFocus = () => onFocusChange(true)
  if (onCommit || onFocusChange) {
    events.onBlur = () => {
      onCommit?.()
      onFocusChange?.(false)
    }
  }
  if (onCommit && enter) {
    events.onKeyDown = (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      event.currentTarget.blur()
    }
  }
  return events
}

/** '2027-04-18T14:00' -> '14:00'. '' for anything unusable. */
function timeOf(wall) {
  return isValidWall(wall) ? wall.slice(11, 16) : ''
}

/**
 * A task -> the shape the fields work in, or a blank draft for a new one.
 *
 * There is no `done` here on purpose. Ticking a task is `DoneToggle`'s job in the card head,
 * and a second control for it in the field set would let an edit rewrite `done_at` — the
 * answer to "when was this finished" — as a side effect of fixing a typo.
 */
export function draftFrom(task, defaultDay = '') {
  if (!task) {
    return {
      title: '',
      category: '',
      allDay: true,
      startDay: defaultDay,
      endDay: defaultDay,
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      owner: '',
      notes: '',
    }
  }
  const allDay = Boolean(task.allDay)
  return {
    title: task.title,
    category: task.category,
    allDay,
    startDay: wallDay(task.start),
    endDay: wallDay(task.end),
    /**
     * An all-day task's stored 00:00 and 23:59 are the sentinels its window is built from,
     * not a clock reading anybody chose, so turning the clock back ON offers the working-day
     * default rather than proposing a task that runs from midnight to a minute before it.
     */
    startTime: (allDay ? '' : timeOf(task.start)) || DEFAULT_START_TIME,
    endTime: (allDay ? '' : timeOf(task.end)) || DEFAULT_END_TIME,
    owner: task.owner,
    notes: task.notes,
  }
}

/**
 * The draft -> the two wall-clock strings. An all-day window is the whole of both days, so a
 * single-day all-day task still has a span rather than a zero-length one that would read 0%
 * right up to midnight and then 100%.
 */
export function draftToWindow(draft) {
  const start = draft.startDay ? `${draft.startDay}T${draft.allDay ? '00:00' : draft.startTime}` : ''
  const end = draft.endDay ? `${draft.endDay}T${draft.allDay ? '23:59' : draft.endTime}` : ''
  return {
    start: draft.allDay && start ? startOfDay(start) : normalizeWall(start),
    end: draft.allDay && end ? endOfDay(end) : normalizeWall(end),
  }
}

/**
 * The draft plus whatever it was built from -> the WHOLE task to store.
 *
 * `base` spreads before the fields so the id, `parentId`, `doneAt` and `deletedAt` survive:
 * `updateTask` writes the whole row from this payload, and one built without `parentId`
 * blanks the cell and silently promotes a subtask to a task. The three empty strings above it
 * are what a brand-new task needs and an existing one overrides.
 *
 * A SUBTASK KEEPS ITS CELLS UNTOUCHED. It is a title and a tick — `validateTask` returns early
 * for anything with a `parentId`, and no caller offers it a date field — so a window written
 * from an empty draft here would blank the two cells of a row somebody hand-dated in the
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
    allDay: draft.allDay,
    owner: draft.owner,
    notes: draft.notes,
  }
  return next.parentId ? next : { ...next, ...draftToWindow(draft) }
}

/** Structural failures, from the one validator both surfaces use. */
export function codesFor(task) {
  return validateTask(task, isValidWall)
}

/**
 * Codes -> which field says what. A code family collapses to the FIRST match because a field
 * shows one message: "not a real date" and "before the start" describe the same input, and
 * stacking both under one wheel just pushes the wheel off screen.
 */
export function fieldErrors(codes) {
  const first = (...wanted) => wanted.find((code) => codes.includes(code)) ?? ''
  return {
    title: first('MISSING_TITLE'),
    start: first('MISSING_START', 'BAD_START'),
    end: first('MISSING_END', 'BAD_END', 'END_BEFORE_START'),
  }
}

function FieldError({ code }) {
  const { t } = useT()
  if (!code) return null
  return <span className="field__error">{t(`error.${code}`)}</span>
}

export function TitleField({ id, skin, value, error, onChange, onCommit, onFocusChange }) {
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
        {...fieldEvents({ onCommit, onFocusChange })}
      />
      <FieldError code={error} />
    </div>
  )
}

/**
 * One end of the window: a day, and a clock reading only when the task is timed.
 *
 * `label` and `timeLabel` arrive already translated. The time input carries no visible label
 * because the day beside it already names the field, but it still needs one for a screen
 * reader — "09:00" alone does not say which end it is.
 */
export function DateField({
  id,
  skin,
  label,
  timeLabel,
  day,
  time,
  showTime,
  error,
  onDay,
  onTime,
  onCommit,
  onFocusChange,
}) {
  const classes = skinOf(skin)
  /* A date and a time wheel are one field with one commit: moving between them fires a blur
     that has nothing to report, which `TaskEditor` drops as an unchanged value. */
  const events = fieldEvents({ onCommit, onFocusChange })
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {label}
      </label>
      <div className="field__row">
        <input
          id={id}
          type="date"
          className={`input${error ? ' input--invalid' : ''}`}
          value={day}
          onChange={(event) => onDay(event.target.value)}
          {...events}
        />
        {showTime ? (
          <input
            type="time"
            className="input"
            value={time}
            onChange={(event) => onTime(event.target.value)}
            aria-label={timeLabel}
            {...events}
          />
        ) : null}
      </div>
      <FieldError code={error} />
    </div>
  )
}

/**
 * The switch that decides whether the window has clock times at all.
 *
 * A checkbox has nothing to buffer — the value IS the gesture — so it reports through
 * `onChange` and a commit-on-blur caller commits from there.
 */
export function AllDayField({ skin, checked, onChange, onFocusChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <label className="switch">
        <input
          type="checkbox"
          className="switch__input"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          {...fieldEvents({ onFocusChange, enter: false })}
        />
        <span className="switch__text">{t('form.allDay')}</span>
      </label>
    </div>
  )
}

/** Same as the switch: a picker commits the moment it changes, so `onChange` is the commit. */
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
        {...fieldEvents({ onFocusChange, enter: false })}
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

export function OwnerField({ id, skin, value, onChange, onCommit, onFocusChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {t('form.owner')}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('form.ownerPlaceholder')}
        autoComplete="off"
        {...fieldEvents({ onCommit, onFocusChange })}
      />
    </div>
  )
}

/**
 * Notes commit on blur ALONE. Return has to insert a newline here — it is the one field that
 * holds more than a line — so the Enter half of `fieldEvents` would eat the only way to write
 * a second paragraph.
 */
export function NotesField({ id, skin, value, onChange, onCommit, onFocusChange }) {
  const { t } = useT()
  const classes = skinOf(skin)
  return (
    <div className={classes.field}>
      <label className={classes.label} htmlFor={id}>
        {t('form.notes')}
      </label>
      <textarea
        id={id}
        className="input textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...fieldEvents({ onCommit, onFocusChange, enter: false })}
      />
    </div>
  )
}
