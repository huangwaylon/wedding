/**
 * The app shell: access, board state, the ticking clock, which tab is up, and one scroll.
 *
 * Access is resolved once, at boot, from the URL fragment (`lib/access.js`), and the fragment is
 * stripped only when running as an installed app: in Safari it has to stay, so that "Add to Home
 * Screen" records a URL still carrying the key, an installed web app getting its own storage
 * bucket.
 *
 * `canEdit` decides what renders but is not the security boundary — the endpoint refuses every
 * keyless write — so nothing here need be defensive beyond hiding controls.
 *
 * TWO TABS, AND ONLY ONE IS MOUNTED. The plan is the work; the notes are what has been decided. The
 * header spans both, because whose wedding, how many days and how much is done are facts about the
 * board rather than about a list. The standing notices span both too: a refused edit link and an
 * unreadable board explain a control that is missing wherever somebody is standing.
 *
 * The tab bar and the FAB are the only other pinned chrome, and both are withheld while anything
 * holds unsaved text — see `typing`. Which tab is up is SESSION state: relaunching into the notes
 * with the plan behind them is not what the app is for, so it always opens on the plan. There is one
 * document scroller, so the switch resets it deliberately rather than landing somebody halfway down
 * a list they have not seen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STORAGE_KEYS, isConfigured, readStored, weddingDay, writeStored } from './config.js'
import { isStandalone, markKeyRejected, resolveAccess, writeEditKey } from './lib/access.js'
import { API_ERROR, isTerminal } from './lib/api.js'
import { forgetToken } from './lib/connection.js'
import { overallProgress, withProgress } from './lib/progress.js'
import { monthOf, resolveTimeZone } from './lib/time.js'
import { setSafeToReload } from './lib/serviceWorker.js'
import { STATUS, useBoard } from './state/useBoard.js'
import { useToday } from './state/useToday.js'
import { useToasts } from './state/useToasts.js'
import { useT } from './i18n/index.js'
import { ConfirmDeleteSheet } from './components/Deleted.jsx'
import EmptyBoard from './components/EmptyBoard.jsx'
import FilterChips, { FILTER_ALL } from './components/FilterChips.jsx'
import Hero from './components/Hero.jsx'
import Notice from './components/Notice.jsx'
import NotesView from './components/NotesView.jsx'
import Plan from './components/Plan.jsx'
import SettingsSheet from './components/SettingsSheet.jsx'
import TabBar, { TABS } from './components/TabBar.jsx'
import TaskFormSheet from './components/TaskFormSheet.jsx'
import Toasts from './components/Toasts.jsx'
import { ICON_SIZE, PlusIcon, RefreshIcon } from './components/icons.jsx'

/**
 * Read before React renders, so the first paint knows whether the controls belong on screen;
 * resolved in an effect it would flash a view-only board at an editor on every launch.
 */
const boot = resolveAccess({
  hash: typeof window === 'undefined' ? '' : window.location.hash,
  standalone: isStandalone(),
})

if (boot.strip && typeof window !== 'undefined') {
  // replaceState, not a navigation: it leaves the Home Screen shortcut's recorded URL alone.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** The api error codes with a second line worth showing; the rest say it all in their title. */
const HINTED = new Set([API_ERROR.UNCONFIGURED, API_ERROR.NOT_EMPTY, API_ERROR.MISCONFIGURED])

/**
 * Terminal codes with a better notice of their own. A rejected key sets `error` to `unauthorized`
 * and calls `onUnauthorized`, so both branches fire; `access.*` wins because it names the recovery.
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
      <RefreshIcon style={ICON_SIZE.inline} />
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
  const timeZone = resolveTimeZone(board.config.timezone)
  /**
   * A day string; every figure derives from it, the countdown included, and it keys `withProgress`,
   * so nothing recomputes more than once a day. See `useToday`.
   */
  const today = useToday(timeZone)

  const [filter, setFilter] = useState(() => readStored(STORAGE_KEYS.filter) || FILTER_ALL)
  /**
   * Which destination is up. Session state, never `localStorage`, like `expanded`: the plan is what
   * the app is for, and launching into the notes puts it behind a tab nobody asked to be on.
   */
  const [tab, setTab] = useState(TABS.PLAN)
  /** Which cards are open. Never `localStorage`: twelve open cards on relaunch cannot be read. */
  const [expanded, setExpanded] = useState(() => new Set())
  /**
   * Rows ticked since the filter was last chosen, kept on screen though they no longer match it.
   * Ticking raises no toast, so a row that also left the only list would give no feedback at all
   * for the app's most frequent gesture; held here it stays put wearing its tick while the chip's
   * count drops. Session state, never `localStorage`, like `expanded`.
   */
  const [ticked, setTicked] = useState(() => new Set())
  /**
   * How many things hold text that exists nowhere else: an open edit session, or the add-a-subtask
   * field while focused. Non-zero moves the fixed FAB out of the way — it does not move with the
   * keyboard and sits over the trailing end of the add field, where a tap opens the new-task sheet
   * and discards what was typed — and holds off a service-worker reload.
   *
   * A count, not a flag: with one boolean and two producers, blur is the last writer, so tapping
   * the subtask field inside an open session and then away would report `false` with the session's
   * buffer still full, and two rows open in Edit would release the guard when either closed. Every
   * producer calls in balanced pairs (an effect and its cleanup, a focus and its blur); the floor
   * keeps an unbalanced one to "the FAB stays hidden" rather than "the guard never releases".
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
   * An editor looking at the board the way a guest sees it. `hasKey` is what this device can do,
   * `canEdit` what it currently shows; only the second moves, so nothing is revoked, nothing is
   * re-pasted, and the way back is a toggle. Per-device and remembered, like the language and the
   * accent: it is also how to hand a phone to somebody.
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

  // A reload must not land between a keystroke and a save: an open sheet and a focused inline field
  // both hold text that exists nowhere else, and `saving` covers a write in flight.
  const busy = Boolean(adding || pendingDelete || settingsOpen || typing) || board.saving > 0
  useEffect(() => {
    setSafeToReload(() => !busy)
  }, [busy])

  /**
   * Every optimistic mutation reports through here, because a failure needs a toast of its own: the
   * sheets close before the write lands, so a failure is a row quietly rolling back out of a list
   * nobody is looking at. `run` restores the previous tasks, so "nothing was saved" is true.
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
   * The one mutation with no success toast: a checklist is entered five items at a time, and five
   * "Saved." toasts over the field somebody is typing into are worse than silence — the row
   * appearing is the confirmation. A failure still speaks.
   */
  const addSubtask = useCallback(
    async (parent, title) => {
      if (!(await board.addSubtask(parent, title))) show(t('toast.failed'))
    },
    [board, show, t],
  )

  /** Same reasoning: ticking is the most frequent action there is, so only a failure talks. */
  const toggleDone = useCallback(
    async (task) => {
      // Before the write, not after: the optimistic update lands synchronously, so a row whose
      // state no longer matches the filter has to be held before it can be dropped.
      setTicked((previous) => new Set(previous).add(task.id))
      if (!(await board.toggleDone(task))) show(t('toast.failed'))
    },
    [board, show, t],
  )

  /**
   * The notes document. `{ notes }` ALONE, never `{ ...config, notes }`: `serializeConfig` emits only
   * the fields it is handed and `setConfig` writes only the rows the payload names, which is the whole
   * reason a document can share the config tab without a lock — one gesture, one cell. Spreading the
   * merged config here would write this build's defaults over the sheet and clobber a Settings save
   * landing beside it.
   *
   * It waits for the write, as Settings does: `saveConfig` has no optimistic half, so the toast is
   * the only confirmation there is.
   */
  const saveNotes = useCallback(
    async (notes) => {
      show((await board.saveConfig({ notes })) ? t('toast.saved') : t('toast.failed'))
    },
    [board, show, t],
  )

  const seed = useCallback(
    async (templateId) => {
      const count = await board.seedTemplate(templateId, {
        weddingDay: weddingDay(board.config),
        locale,
      })
      // A failure has to speak here too: the card otherwise just flips its button back over a board
      // that is still empty, which reads as nothing having happened rather than a refused write.
      show(count ? t('empty.seeded', { count }) : t('toast.failed'))
    },
    [board, locale, show, t],
  )

  /**
   * Both clear the read-only preview, or it outlives what it was previewing: pasting a fresh edit
   * link with the flag still set would appear to do nothing at all. Both also drop the minted
   * token, derived from the key but outliving it by up to an hour — a device that has just revoked
   * its key would otherwise keep writing, and one pasting a different key would keep using the old
   * token.
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
        <div className="view view--bare stack">
          <Notice tone="warn" title={t('api.unconfigured')} body={t('api.unconfiguredHint')} />
        </div>
      </div>
    )
  }

  const day = weddingDay(board.config)

  /**
   * The board's standing problems, on whichever tab is up rather than on the plan alone: a refused
   * edit link is why the notes have no Edit button, and a notice explaining that on the other tab
   * explains nothing.
   */
  const notices = (
    <>
      {rejected ? (
        <Notice tone="warn" title={t('access.rejected')} body={t('access.rejectedHint')} />
      ) : null}

      {/* A failed read never blanks a board on screen: the copy is stale, not wrong. */}
      {board.stale && board.error ? (
        <Notice title={t('status.stale')} body={t('status.staleHint')}>
          <RetryButton onRetry={board.refresh} label={t('status.refresh')} />
        </Notice>
      ) : null}

      {/* Only a terminal failure earns a persistent notice: a transient one is a thing to
          retry, and the stale banner covers the case with cached data to fall back on. */}
      {board.error && !board.stale && isTerminal(board.error) && !SILENCED.has(board.error) ? (
        <Notice
          tone="warn"
          title={t(`api.${board.error}`)}
          /* `HINTED` keeps the list of codes with a useful second line out of the markup. */
          body={HINTED.has(board.error) ? t(`api.${board.error}Hint`) : null}
        />
      ) : null}
    </>
  )

  return (
    <div className="app">
      <div className="views">
        <Hero
          config={board.config}
          today={today}
          canEdit={canEdit}
          overall={overall}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="view stack">
          {notices}

          {tab === TABS.NOTES ? (
            <NotesView
              notes={board.config.notes}
              canEdit={canEdit}
              onSave={saveNotes}
              onFieldFocus={reportTyping}
            />
          ) : board.status === STATUS.LOADING ? (
            <p className="hint">{t('common.loading')}</p>
          ) : board.status === STATUS.ERROR && !board.tasks.length ? (
            /* A first load that never landed must not fall through to the empty board: "the couple
               has not added anything yet" is a statement about data, and there is none — only a
               failed request. It would send a planner away thinking the board is empty. */
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
                  weddingMonth={monthOf(day)}
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

      {/* Adding a task is a plan job. Hidden while a field has focus — see `typing`. */}
      {canEdit && tab === TABS.PLAN && !typing ? (
        <button
          type="button"
          className="fab"
          onClick={() => setAdding(true)}
          aria-label={t('form.newTitle')}
        >
          <PlusIcon style={ICON_SIZE.fab} />
        </button>
      ) : null}

      {/* Withheld while anything holds unsaved text: `interactive-widget=resizes-content` re-anchors
          a bottom-fixed bar just above the iOS keyboard, putting two wide targets on the accessory
          row, one mis-tap from abandoning an open editor. `.views` reserves its height regardless. */}
      {typing ? null : <TabBar tab={tab} onTab={setTab} />}

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
          /* The capability, not the view: Settings asks "do you hold a key" to decide between
             revoking one and pasting one, and a preview must not demand a credential this device
             already has. */
          hasKey={hasKey}
          readOnly={readOnly}
          onToggleReadOnly={toggleReadOnly}
          sheetTimeZone={board.sheetTimeZone}
          deletedTasks={board.deletedTasks}
          onRestore={restore}
          onSaveConfig={async (partial) => {
            const ok = await board.saveConfig(partial)
            /* Settings is the one surface that waits for its write, having no optimistic half, so
               somebody is watching the button for the write plus the read after it. Without the
               failure branch it returns to "Save" saying nothing, its notice behind the sheet. */
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
