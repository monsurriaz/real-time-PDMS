import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small, generic centred modal — backdrop overlay, Escape/backdrop-click/
 * Cancel to close. Built for the assign/reassign panel (M6.98) but scoped
 * generically enough to reuse for a future confirmation dialog: no
 * assign-specific content lives here, only the shell.
 *
 * Rendered via a portal straight onto `document.body`, not in place. AppShell's
 * rail is `position: sticky` (M6.98's own follow-up fix found this), which
 * — regardless of z-index — creates its own CSS stacking context; a `fixed`
 * element nested inside it still paints as part of THAT stacking context, not
 * the page's, so a caller mounted under the rail (ShiftRail) had its z-40
 * backdrop painting underneath `<main>`'s content, MapLibre canvas included,
 * no matter how high the z-index read. A portal escapes that ancestor
 * entirely, which is the general fix — not just the one caller that happened
 * to surface it.
 *
 * No shadow, no gradient — separation is the border, same as `Card` (rule 2).
 * The backdrop is `--ink` at reduced opacity: the frozen palette has no
 * dedicated scrim colour, and dimming the one dark, neutral token already in
 * the system reads as "background, pushed back" without inventing one.
 */
interface ModalProps {
  open: boolean
  onClose: () => void
  /** Rendered in the header, left side — usually a title plus context. */
  title: ReactNode
  children: ReactNode
  className?: string
}

export const Modal = ({ open, onClose, title, children, className = '' }: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-ink/45"
      onMouseDown={(e) => {
        // Close only on a genuine backdrop click — a mousedown that started
        // inside the panel and dragged out (text selection) must not count.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={`w-full max-w-[440px] max-h-[85vh] overflow-y-auto bg-surface border border-border rounded-lg ${className}`}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-15px border-b border-border">
          <div className="min-w-0">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-meta text-muted hover:text-ink flex-none"
          >
            Cancel
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
