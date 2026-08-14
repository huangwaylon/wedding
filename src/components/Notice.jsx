/**
 * The only title/body/action block: an inline statement about the board's state — view-only, a
 * rejected key, a stale cache, an unreachable endpoint. Never a toast: a problem worth naming is
 * worth leaving on screen until it stops being true, and a toast that has timed out cannot be gone
 * back to. The optional action is therefore a retry, something that can make the notice go away,
 * never an "OK" that only hides it.
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
