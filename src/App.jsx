/**
 * The app shell: access, board state, the ticking clock, and one scroll.
 *
 * ACCESS IS RESOLVED ONCE, AT BOOT, from the URL fragment (see `lib/access.js`), and
 * the fragment is only cleared once running as an installed app — in Safari it has to
 * stay so that "Add to Home Screen" records a URL still carrying the key, because an
 * installed web app gets its own storage bucket.
 *
 * `canEdit` decides what renders, but it is NOT the security boundary. The endpoint
 * refuses any write without the key, so a planner who reaches into the DOM gains
 * nothing — which is why nothing here needs to be defensive beyond hiding controls.
 *
 * ONE SCROLL, AND THE PHOTOGRAPH IS THE HEADER. No tabs and no fixed bar but the FAB: a phone
 * cannot spare a permanent 56px plus its safe-area inset on the vertical axis, the standing
 * notices are global (the out-of-date script is the reason a control is missing from a row, so
 * that warning has to be visible wherever the row is), and there is exactly one document
 * scroller. Returning to the photograph is one tap on the status bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STORAGE_KEYS, isConfigured, readStored, weddingDay, writeStored } from './config.js'
import { isStandalone, markKeyRejected, resolveAccess, writeEditKey } from './lib/access.js'
import { API_ERROR, isTerminal } from './lib/api.js'
import { forgetToken } from './lib/connection.js'
import { overallProgress, withProgress } from './lib/progress.js'
import { resolveTimeZone, todayIn } from './lib/time.js'
import { setSafeToReload } from './lib/serviceWorker.js'
import { STATUS, useBoard } from './state/useBoard.js'
import { useNow } from './state/useNow.js'
import { useToasts } from './state/useToasts.js'
import { useT } from './i18n/index.js'
import { ConfirmDeleteSheet } from './components/Deleted.jsx'
import EmptyBoard from './components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from './components/FilterChips.jsx'
import Hero from './components/Hero.jsx'
import Notice from './components/Notice.jsx'
import Plan from './components/Plan.jsx'
import SettingsSheet from './components/SettingsSheet.jsx'
import TaskFormSheet from './components/TaskFormSheet.jsx'
import Toasts from './components/Toasts.jsx'
import { PlusIcon, RefreshIcon } from './components/icons.jsx'

/**
 * Read the fragment before React renders anything, so the first paint already knows
 * whether the controls belong on screen — resolving it in an effect would flash a
 * view-only board at an editor on every launch.
 */
const boot = resolveAccess({
  hash: typeof window === 'undefined' ? '' : window.location.hash,
  standalone: isStandalone(),
})

if (boot.strip && typeof window !== 'undefined') {
  // replaceState, not a navigation: it leaves the Home Screen shortcut's recorded URL
  // alone and only cleans up what is on screen.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/**
 * The api error codes that carry a second line worth showing. The others state the whole
 * problem in their title, and a hint that repeats the title is noise.
 */
const HINTED = new Set([API_ERROR.UNCONFIGURED, API_ERROR.NOT_EMPTY, API_ERROR.MISCONFIGURED])

/**
 * Terminal codes that already have a better notice of their own.
 *
 * A rejected key sets `error` to `unauthorized` AND calls `onUnauthorized`, so both
 * branches fired and the screen carried "This edit link was rejected" stacked on top of
 * "The edit link was refused". The `access.*` pair wins because it names the recovery.
 */
const SILENCED = new Set([API_ERROR.UNAUTHORIZED])

/** The retry inside a notice. Two of them, identical, so it is one thing. */
function RetryButton({ onRetry, label }) {
  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm"
      onClick={() => onRetry({ force: true })}
    >
      <RefreshIcon style={{ width: '1em', height: '1em' }} />
      {label}
    </button>
  )
}

export default function App() {
  const { t, locale } = useT()
  const { toasts, show } = useToasts()

  const [editKey, setEditKey] = useState(boot.key)
  const [rejected, setRejected] = useState(boot.rejected)

  const onUnauthorized = useCallback(() => {
    markKeyRejected()
    setRejected(true)
  }, [])

  const board = useBoard({ editKey, onUnauthorized })
  const now = useNow()

  const [filter, setFilter] = useState(() => readStored(STORAGE_KEYS.filter) || FILTER_ALL)
  /**
   * Which cards are open. Session-only, never `localStorage`: relaunching into twelve
   * expanded cards is a board nobody can read.
   */
  const [expanded, setExpanded] = useState(() => new Set())
  /**
   * Rows that have been ticked since the filter was last chosen, and which therefore stay on
   * screen even though they no longer match it.
   *
   * TICKING SOMETHING OFF MUST NOT MAKE IT VANISH. Filter to Overdue, work down the list, tick a
   * row — and the row left the only list on screen, with no toast (ticking deliberately has
   * none) and nothing to confirm the tap landed. That is the app's highest-frequency gesture
   * meeting its most-used filter, and the feedback was total absence. Held here, the row stays
   * put, wearing its tick and its strikethrough, while the count on the chip beside it drops:
   * the confirmation is the row changing rather than the row leaving.
   *
   * Session state, never `localStorage`, for the same reason `expanded` is.
   */
  const [ticked, setTicked] = useState(() => new Set())
  /**
   * How many things are holding text that exists nowhere else — an open edit SESSION, or the
   * add-a-subtask field while it has focus. Two things ride on it being non-zero: the fixed FAB
   * gets out of the way (it does not move with the keyboard, and it sat over the trailing end of
   * the add field, where a tap opened the new-task sheet and discarded what was typed), and a
   * reload is held off, because the text in an open session exists nowhere else yet.
   *
   * A COUNT, NOT A FLAG, and that is a fix rather than a tidy-up. Both producers wrote one
   * boolean and blur was the last writer, so tapping the subtask field inside an open edit
   * session and then tapping away reported `false` with the session still open and the title
   * buffer still full — dropping the guard at exactly the moment it is load-bearing. Two rows
   * open in Edit at once had the same shape: closing either released both. Every producer calls
   * in balanced pairs (an effect and its cleanup, a focus and its blur); the floor is so an
   * unbalanced one degrades to "the FAB stays hidden" rather than "the guard never releases".
   */
  const [typists, setTypists] = useState(0)
  const reportTyping = useCallback((on) => {
    setTypists((count) => Math.max(0, count + (on ? 1 : -1)))
  }, [])
  const typing = typists > 0
  const [adding, setAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * An editor looking at the board the way a guest sees it.
   *
   * Two different questions, and keeping them apart is the whole of this: `hasKey` is what this
   * device CAN do, and `canEdit` is what it currently shows. Only the second one moves, so nothing
   * is revoked, nothing is re-pasted, and the way back is a toggle rather than a link somebody has
   * to find again — which is what separates this from "Stop editing on this device".
   *
   * Per-device and remembered, like the language and the accent: it is also the way to hand a phone
   * to somebody, or to stop yourself editing a board you only want to read.
   */
  const [readOnly, setReadOnly] = useState(() => readStored(STORAGE_KEYS.readOnly) === '1')
  const toggleReadOnly = useCallback(() => {
    setReadOnly((previous) => {
      const next = !previous
      writeStored(STORAGE_KEYS.readOnly, next ? '1' : null)
      return next
    })
  }, [])

  const hasKey = Boolean(editKey) && !rejected
  const canEdit = hasKey && !readOnly
  const timeZone = resolveTimeZone(board.config.timezone)

  /**
   * TODAY, AS A DAY STRING, AND EVERY FIGURE IN THE APP DERIVES FROM IT.
   *
   * The board is day-granular, so nothing on screen can change between midnights and
   * `withProgress` recomputes at most once a day. The clock still ticks for the hero's
   * countdown; keying this on it would reallocate every task object sixty times an hour.
   */
  const today = useMemo(() => todayIn(timeZone, now), [timeZone, now])
  const tasks = useMemo(() => withProgress(board.tasks, today), [board.tasks, today])
  const overall = useMemo(() => overallProgress(tasks), [tasks])

  const shown = useMemo(
    () =>
      filter === FILTER_ALL
        ? tasks
        : tasks.filter((task) => task.progress.state === filter || ticked.has(task.id)),
    [tasks, filter, ticked],
  )

  const toggleExpanded = useCallback((id) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const chooseFilter = useCallback((next) => {
    setFilter(next)
    // A new slice is a fresh reading, so nothing is held over into it.
    setTicked(new Set())
    writeStored(STORAGE_KEYS.filter, next)
  }, [])

  // A reload must not land between a keystroke and a save. Every half matters: an open
  // sheet and a focused inline field both hold text that exists nowhere else, and `saving`
  // covers the window where a write has left the device but not yet reached the sheet.
  const busy = Boolean(adding || pendingDelete || settingsOpen || typing) || board.saving > 0
  useEffect(() => {
    setSafeToReload(() => !busy)
  }, [busy])

  /**
   * Every optimistic mutation reports through here.
   *
   * A FAILURE NEEDS A TOAST OF ITS OWN. Mutations are optimistic and the sheets close before
   * the write lands, so a failure is a row that quietly rolls back out of a list nobody is
   * looking at — invisible unless it is said out loud. `run` restores the previous tasks, so
   * "nothing was saved" is literally true.
   */
  const report = useCallback(
    async (work, message) => {
      const ok = await work
      show(ok ? message : t('toast.failed'))
      return ok
    },
    [show, t],
  )

  const save = useCallback(
    (task) => report(task.id ? board.editTask(task) : board.addTask(task), t('toast.saved')),
    [board, report, t],
  )

  const confirmDelete = useCallback(
    (task) => {
      setPendingDelete(null)
      return report(board.removeTask(task.id), t('toast.deleted'))
    },
    [board, report, t],
  )

  const restore = useCallback(
    (id) => report(board.restoreTask(id), t('deleted.restored')),
    [board, report, t],
  )

  /**
   * Adding a subtask is the one mutation with NO success toast. A checklist is entered five
   * items at a time, and five "Saved." toasts stacking up over the field somebody is still
   * typing into is worse than silence — the row appearing in the list is the confirmation.
   * A failure still speaks.
   */
  const addSubtask = useCallback(
    async (parent, title) => {
      if (!(await board.addSubtask(parent, title))) show(t('toast.failed'))
    },
    [board, show, t],
  )

  /** Same reasoning: ticking is the highest-frequency action there is, so only a failure talks. */
  const toggleDone = useCallback(
    async (task) => {
      // Before the write, not after: the optimistic update lands synchronously, so a row whose
      // state no longer matches the filter has to be held before it can be dropped.
      setTicked((previous) => new Set(previous).add(task.id))
      if (!(await board.toggleDone(task))) show(t('toast.failed'))
    },
    [board, show, t],
  )

  const seed = useCallback(
    async (templateId) => {
      const count = await board.seedTemplate(templateId, {
        weddingDay: weddingDay(board.config),
        locale,
      })
      // A failure has to speak here too: the template card just flips its button back from
      // "Building the checklist…" over a board that is still empty, which reads as nothing
      // having happened rather than as a write that was refused.
      show(count ? t('empty.seeded', { count }) : t('toast.failed'))
    },
    [board, locale, show, t],
  )

  /**
   * Both of these clear the read-only preview, because otherwise it outlives the thing it was
   * previewing: pasting a fresh edit link while the flag was still set would appear to do nothing
   * at all, which is the one outcome that makes somebody think their link is broken.
   *
   * BOTH ALSO DROP THE MINTED TOKEN. It is derived from the key but outlives it by up to an hour,
   * so a device that has just revoked its key would otherwise keep writing, and a device pasting a
   * DIFFERENT key would keep using the old one's token — which is the same bug wearing a hat.
   */
  const enableEditing = useCallback((key) => {
    forgetToken()
    writeEditKey(key)
    writeStored(STORAGE_KEYS.readOnly, null)
    setReadOnly(false)
    setEditKey(key)
    setRejected(false)
  }, [])

  const revokeEditing = useCallback(() => {
    forgetToken()
    writeEditKey(null)
    writeStored(STORAGE_KEYS.readOnly, null)
    setReadOnly(false)
    setEditKey(null)
    setRejected(false)
    setSettingsOpen(false)
  }, [])

  if (!isConfigured()) {
    return (
      <div className="app">
        <div className="views">
          <div className="view stack">
            <Notice tone="warn" title={t('api.unconfigured')} body={t('api.unconfiguredHint')} />
          </div>
        </div>
      </div>
    )
  }

  const day = weddingDay(board.config)

  return (
    <div className="app">
      <div className="views">
        <Hero
          config={board.config}
          nowMs={now}
          canEdit={canEdit}
          overall={overall}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="view stack">
          {rejected ? (
            <Notice tone="warn" title={t('access.rejected')} body={t('access.rejectedHint')} />
          ) : null}

          {/* A failed read never blanks a board that is already on screen: the cached copy is
              stale, not wrong, and saying so beats an error page. */}
          {board.stale && board.error ? (
            <Notice title={t('status.stale')} body={t('status.staleHint')}>
              <RetryButton onRetry={board.refresh} label={t('status.refresh')} />
            </Notice>
          ) : null}

          {/* Only a TERMINAL failure earns a persistent notice. A transient one — or a held
              lock — is a thing to retry, and the stale banner above already covers the case
              where there is cached data to fall back on. */}
          {board.error && !board.stale && isTerminal(board.error) && !SILENCED.has(board.error) ? (
            <Notice
              tone="warn"
              title={t(`api.${board.error}`)}
              /* Only these two have a hint worth the extra line; the rest say it all in the
                 title. `HINTED` keeps that list out of the markup. */
              body={HINTED.has(board.error) ? t(`api.${board.error}Hint`) : null}
            />
          ) : null}

          {board.status === STATUS.LOADING ? (
            <p className="hint">{t('common.loading')}</p>
          ) : board.status === STATUS.ERROR && !board.tasks.length ? (
            /* A first load that never landed. This must NOT fall through to the empty
               board: "the couple has not added anything yet" is a statement about the
               data, and there is no data — only a failed request. Saying the wrong one
               sends a planner away thinking the board is empty. */
            <Notice tone="warn" title={t(`api.${board.error ?? API_ERROR.TRANSIENT}`)}>
              <RetryButton onRetry={board.refresh} label={t('status.refresh')} />
            </Notice>
          ) : !tasks.length ? (
            <EmptyBoard
              canEdit={canEdit}
              weddingDay={day}
              seeding={board.saving > 0}
              onSeed={seed}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <>
              <FilterChips
                counts={overall}
                total={overall.total}
                filter={filter}
                onFilter={chooseFilter}
              />

              {!shown.length ? (
                <section className="card empty">
                  <p className="empty__body">{t('list.emptyFiltered')}</p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => chooseFilter(FILTER_ALL)}
                  >
                    {t('list.showAll')}
                  </button>
                </section>
              ) : (
                <Plan
                  tasks={shown}
                  canEdit={canEdit}
                  categories={board.config.categories}
                  today={today}
                  /* So the one heading that is the wedding's own month can say so. */
                  weddingMonth={day ? day.slice(0, 7) : ''}
                  unfiltered={filter === FILTER_ALL}
                  expanded={expanded}
                  onExpand={toggleExpanded}
                  onToggle={toggleDone}
                  onSave={save}
                  onDelete={setPendingDelete}
                  onAddSubtask={addSubtask}
                  onFieldFocus={reportTyping}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Hidden while a field has focus — see `typing`. The FAB is fixed, so it sat over the
          trailing end of the add-a-subtask field, where a tap opened the new-task sheet and
          discarded what was typed. */}
      {canEdit && !typing ? (
        <button
          type="button"
          className="fab"
          onClick={() => setAdding(true)}
          aria-label={t('form.newTitle')}
        >
          <PlusIcon style={{ width: '1.5em', height: '1.5em' }} />
        </button>
      ) : null}

      {adding ? (
        <TaskFormSheet
          categories={board.config.categories}
          onSave={save}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDeleteSheet
          task={pendingDelete}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsSheet
          config={board.config}
          canEdit={canEdit}
          /* The capability, not the view. Settings asks "do you hold a key" to decide between
             revoking one and pasting one, and a read-only PREVIEW must not turn that into a demand
             for a credential this device already has. */
          hasKey={hasKey}
          readOnly={readOnly}
          onToggleReadOnly={toggleReadOnly}
          sheetTimeZone={board.sheetTimeZone}
          deletedTasks={board.deletedTasks}
          onRestore={restore}
          onSaveConfig={async (partial) => {
            const ok = await board.saveConfig(partial)
            /* Settings is the one surface that WAITS for its write — it has no optimistic half —
               so somebody is watching this one for ~3s. Without the failure branch it returned to
               "Save" and said nothing at all, and the board's own notice was behind the sheet. */
            show(ok ? t('settings.saved') : t('toast.failed'))
            return ok
          }}
          onCompact={async () => {
            show((await board.compact()) ? t('settings.compacted') : t('toast.failed'))
          }}
          onEnableEditing={(key) => {
            enableEditing(key)
            show(t('access.pasteOk'))
          }}
          onRevokeEditing={() => {
            revokeEditing()
            show(t('access.revoked'))
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <Toasts toasts={toasts} />
    </div>
  )
}
