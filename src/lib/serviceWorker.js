/**
 * Service worker registration and its update policy.
 *
 * An installed iOS web app resumed from the app switcher does not navigate, so the browser never
 * rechecks `sw.js` and a worker sitting in `waiting` can stay unactivated for weeks. So: check for
 * an update on foreground, and activate as soon as activating cannot lose anything — never while a
 * task is half-typed or a write is in flight.
 *
 * `public/sw.js` never touches a cross-origin request, as an early `return` in its `fetch` handler
 * rather than by scope: scope decides which clients are controlled, not which requests are seen, so
 * both the token endpoint and the Sheets API arrive there. A worker answering either would be an
 * uncovered proxy in front of a bearer token — a `<meta>` CSP does not cover a worker's context and
 * Pages sends no CSP header.
 */

/** Resume happens constantly; an update check every time would be wasteful. */
const UPDATE_CHECK_FLOOR_MS = 60 * 60_000

let safeToReload = () => true
let reloading = false
let lastCheck = 0

/**
 * Set by the app: false while a form is open or a write has not landed, either of which a reload
 * would discard.
 */
export function setSafeToReload(predicate) {
  safeToReload = predicate
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  // One reload, and only once a new worker has taken over. `reloading` resets with the page, so
  // this cannot loop. It does not fire on a first install: a page that loaded uncontrolled stays
  // uncontrolled.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(
    (registration) => {
      const activateIfSafe = () => {
        if (registration.waiting && safeToReload()) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        activateIfSafe()
        const now = Date.now()
        if (now - lastCheck < UPDATE_CHECK_FLOOR_MS) return
        lastCheck = now
        registration.update().catch(() => {})
      }

      lastCheck = Date.now()
      activateIfSafe()

      registration.addEventListener('updatefound', () => {
        // The new worker installs and then waits; take over when it is safe.
        registration.installing?.addEventListener('statechange', activateIfSafe)
      })

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
    },
    () => {
      // Not worth surfacing: without a worker the app works, just without the instant launch.
    },
  )
}
