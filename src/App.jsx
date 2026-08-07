/**
 * The app shell: access, board state, the ticking clock, and which surface is on
 * screen.
 *
 * ACCESS IS RESOLVED ONCE, AT BOOT, from the URL fragment (see `lib/access.js`), and
 * the fragment is only cleared once running as an installed app — in Safari it has to
 * stay so that "Add to Home Screen" records a URL still carrying the key, because an
 * installed web app gets its own storage bucket.
 *
 * `canEdit` decides what renders, but it is NOT the security boundary. The endpoint
 * refuses any write without the key, so a planner who reaches into the DOM gains
 * nothing — which is why nothing here needs to be defensive beyond hiding controls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { STORAGE_KEYS, isConfigured, readStored, weddingWall, writeStored } from './config.js'
import { isStandalone, markKeyRejected, resolveAccess, writeEditKey } from './lib/access.js'
import { API_ERROR, isTerminal } from './lib/api.js'
import { overallProgress, withProgress } from './lib/progress.js'
import { nowWall as nowWallIn, resolveTimeZone, wallDay } from './lib/time.js'
import { setSafeToReload } from './lib/serviceWorker.js'
import { STATUS, useBoard } from './state/useBoard.js'
import { useNow } from './state/useNow.js'
import { useToasts } from './state/useToasts.js'
import { useT } from './i18n/index.js'
import Controls, { FILTER_ALL, VIEWS } from './components/Controls.jsx'
import { ConfirmDeleteSheet, DeletedList } from './components/Deleted.jsx'
import EmptyBoard from './components/EmptyBoard.jsx'
import Header from './components/Header.jsx'
import Notice from './components/Notice.jsx'
import OverallCard from './components/OverallCard.jsx'
import SettingsSheet from './components/SettingsSheet.jsx'
import TaskFormSheet from './components/TaskFormSheet.jsx'
import TaskList from './components/TaskList.jsx'
import Timeline from './components/Timeline.jsx'
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
  const [view, setView] = useState(VIEWS.LIST)
  /**
   * Which parents are open. Session-only, never `localStorage`: relaunching into twelve
   * expanded parents is the same failure as relaunching into an 8x timeline. It lives here
   * rather than in `TaskList` because that unmounts on a view switch, and it cannot ride on the
   * task because `withProgress` allocates fresh objects every minute.
   */
  const [expanded, setExpanded] = useState(() => new Set())
  /** True while a subtask field has focus, so the fixed FAB stops covering it. */
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const canEdit = Boolean(editKey) && !rejected
  const timeZone = resolveTimeZone(board.config.timezone)

  // Every percentage in the app comes from here, recomputed each tick.
  const tasks = useMemo(() => withProgress(board.tasks, now, timeZone), [board.tasks, now, timeZone])
  const overall = useMemo(() => overallProgress(tasks), [tasks])
  const nowWall = useMemo(() => nowWallIn(timeZone, now), [timeZone, now])

  const shown = useMemo(
    () => (filter === FILTER_ALL ? tasks : tasks.filter((task) => task.progress.state === filter)),
    [tasks, filter],
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
    writeStored(STORAGE_KEYS.filter, next)
  }, [])

  // A reload must not land between a keystroke and a save. Both halves matter: an
  // open form holds text that exists nowhere else, and `saving` covers the window
  // where a write has left the device but not yet reached the sheet.
  const busy = Boolean(editing || pendingDelete || settingsOpen) || board.saving > 0
  useEffect(() => {
    setSafeToReload(() => !busy)
  }, [busy])

  const save = useCallback(
    async (task) => {
      const ok = task.id ? await board.editTask(task) : await board.addTask(task)
      if (ok) show(t('toast.saved'))
      return ok
    },
    [board, show, t],
  )

  const confirmDelete = useCallback(
    async (task) => {
      setPendingDelete(null)
      setEditing(null)
      if (await board.removeTask(task.id)) show(t('toast.deleted'))
    },
    [board, show, t],
  )

  const restore = useCallback(
    async (id) => {
      if (await board.restoreTask(id)) show(t('deleted.restored'))
    },
    [board, show, t],
  )

  const seed = useCallback(
    async (templateId) => {
      const day = wallDay(weddingWall(board.config))
      const count = await board.seedTemplate(templateId, { weddingDay: day, locale })
      if (count) show(t('empty.seeded', { count }))
    },
    [board, locale, show, t],
  )

  const enableEditing = useCallback((key) => {
    writeEditKey(key)
    setEditKey(key)
    setRejected(false)
  }, [])

  const revokeEditing = useCallback(() => {
    writeEditKey(null)
    setEditKey(null)
    setRejected(false)
    setSettingsOpen(false)
  }, [])

  if (!isConfigured()) {
    return (
      <div className="app">
        <main className="shell">
          <Notice tone="warn" title={t('api.unconfigured')} body={t('api.unconfiguredHint')} />
        </main>
      </div>
    )
  }

  const weddingDay = wallDay(weddingWall(board.config))
  const wide = view === VIEWS.TIMELINE

  /**
   * The task being edited, re-read from the live list every render rather than kept as the
   * snapshot `setEditing` captured. Subtasks added from inside the form are immediate writes, so
   * a snapshot meant they did not appear until the sheet was closed and reopened — and the same
   * staleness would hide any change the other person made while the form was open.
   */
  const editingTask = editing?.id ? (tasks.find((row) => row.id === editing.id) ?? editing) : null

  return (
    <div className="app">
      <Header
        config={board.config}
        nowMs={now}
        canEdit={canEdit}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className={`shell${wide ? ' shell--wide' : ''}`}>
        <div className="shell__aside stack">
          {rejected ? (
            <Notice tone="warn" title={t('access.rejected')} body={t('access.rejectedHint')} />
          ) : null}

          {/* A deployment is pinned to a version, so the script can be older than this bundle —
              and an older one drops a column it has never heard of without erroring. */}
          {board.outdatedScript ? (
            <Notice tone="warn" title={t('api.outdated')} body={t('api.outdatedHint')} />
          ) : null}

          {/* A failed read never blanks a board that is already on screen: the cached
              copy is stale, not wrong, and saying so beats an error page. */}
          {board.stale && board.error ? (
            <Notice title={t('status.stale')} body={t('status.staleHint')}>
              <RetryButton onRetry={board.refresh} label={t('status.refresh')} />
            </Notice>
          ) : null}

          {/* Only a TERMINAL failure earns a persistent notice. A transient one — or a
              held lock — is a thing to retry, and the stale banner above already covers
              the case where there is cached data to fall back on. */}
          {board.error && !board.stale && isTerminal(board.error) ? (
            <Notice
              tone="warn"
              title={t(`api.${board.error}`)}
              /* Only these two have a hint worth the extra line; the rest say it all in
                 the title. `HINTED` keeps that list out of the markup. */
              body={HINTED.has(board.error) ? t(`api.${board.error}Hint`) : null}
            />
          ) : null}

          {/* Compact in timeline view: there the chart is the subject and the summary is
              context, and the full card pushed the Gantt off the screen. */}
          <OverallCard overall={overall} compact={wide} />

          {canEdit ? (
            <DeletedList tasks={board.deletedTasks} onRestore={restore} />
          ) : null}
        </div>

        <div className="shell__main stack">
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
              weddingDay={weddingDay}
              seeding={board.saving > 0}
              onSeed={seed}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <>
              <Controls
                counts={overall}
                total={overall.total}
                filter={filter}
                onFilter={chooseFilter}
                view={view}
                onView={setView}
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
              ) : view === VIEWS.TIMELINE ? (
                <Timeline tasks={shown} nowMs={now} timeZone={timeZone} />
              ) : (
                <TaskList
                  tasks={shown}
                  nowWall={nowWall}
                  canEdit={canEdit}
                  expanded={expanded}
                  onToggle={board.toggleDone}
                  onEdit={setEditing}
                  onDelete={setPendingDelete}
                  onExpand={toggleExpanded}
                  onAddSubtask={board.addSubtask}
                  onSubtaskFocus={setAddingSubtask}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Not in timeline view: the FAB is a 56px disc fixed over the bottom-right of the
          chart, which is where the newest months and often the today rule are. The chart's own
          toolbar is its action surface, and adding a task is a list-view job. */}
      {/* Also hidden while a subtask field has focus: the FAB is fixed bottom-right, does not
          move with the keyboard, and would sit over the trailing end of the add field — where a
          tap opens the new-task sheet and discards what was typed. */}
      {canEdit && !wide && !addingSubtask ? (
        <button
          type="button"
          className="fab"
          onClick={() => setEditing({})}
          aria-label={t('form.newTitle')}
        >
          <PlusIcon style={{ width: '1.5em', height: '1.5em' }} />
        </button>
      ) : null}

      {editing ? (
        <TaskFormSheet
          task={editingTask}
          categories={board.config.categories}
          defaultDay={nowWall.slice(0, 10)}
          onSave={save}
          onDelete={(task) => setPendingDelete(task)}
          onAddSubtask={board.addSubtask}
          onToggleSubtask={board.toggleDone}
          onDeleteSubtask={setPendingDelete}
          onClose={() => setEditing(null)}
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
          sheetTimeZone={board.sheetTimeZone}
          deletedCount={board.deletedTasks.length}
          onSaveConfig={async (partial) => {
            const ok = await board.saveConfig(partial)
            if (ok) show(t('settings.saved'))
            return ok
          }}
          onCompact={async () => {
            if (await board.compact()) show(t('settings.compacted'))
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
