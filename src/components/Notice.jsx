/**
 * An inline statement about the board's state: view-only, a rejected key, a stale cache, an
 * endpoint that cannot be reached.
 *
 * Never a toast. A problem worth naming is worth leaving on screen until it stops being
 * true, and a toast that has timed out is a message nobody can go back to. That is also why
 * the optional action here is a *retry* — something that can make the notice go away — and
 * never an "OK" that only hides it.
 *
 * This exists because the same title/body/action markup was written out five times in
 * `App.jsx`, and the copies had already started to disagree about whether the body was
 * optional.
 */

export default function Notice({ title, body, tone = 'info', children }) {
  return (
    <section className={`notice${tone === 'warn' ? ' notice--warn' : ''}`}>
      <span className="notice__title">{title}</span>
      {body ? <span className="notice__body">{body}</span> : null}
      {children ? <span className="notice__actions">{children}</span> : null}
    </section>
  )
}
