/**
 * Statements, never controls. See `useToasts` for why nothing here has a button.
 *
 * `role="status"` with `aria-live="polite"` so a screen reader hears the
 * confirmation without being interrupted mid-sentence; `pointer-events: none` on the
 * container in CSS so a toast can never swallow a tap meant for the FAB underneath.
 */

export default function Toasts({ toasts }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <p className="toast" key={toast.id}>
          {toast.message}
        </p>
      ))}
    </div>
  )
}
