import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Note } from '@/components/Card'
import { useDismissWelcome, useMe } from './useAuth'

/**
 * The one-time welcome, shown once per account and never again.
 *
 * The server decides whether it is due (`showWelcome` on /auth/me, backed by
 * `User.welcomeSeenAt`), so it survives a new browser, a different device and a
 * cleared cache — none of which localStorage would.
 *
 * The flag is cleared the moment the notice APPEARS, not when it is dismissed.
 * A rider who closes the tab without clicking has still been told, and the
 * alternative is a "one-time" banner that greets them again tomorrow. Local
 * state keeps it on screen for the rest of this visit, so clearing the flag
 * does not make it vanish as it is being read.
 *
 * Where it renders decides WHICH welcome an account gets: mounted on the rider
 * workspace, which only an approved rider ever reaches (RequireRole sends a
 * pending one to /agent/pending), so a rider's first sight of it is their first
 * visit after approval — never burnt on the pending screen.
 */
export const WelcomeNotice = ({ children }: { children: ReactNode }) => {
  const me = useMe()
  const dismiss = useDismissWelcome()
  const [visible, setVisible] = useState(false)
  // Latched so a re-render, or the mutation's own cache write, cannot fire the
  // request twice or re-open a notice the reader has closed.
  const claimed = useRef(false)

  useEffect(() => {
    if (claimed.current) return
    if (me.data?.showWelcome !== true) return
    claimed.current = true
    setVisible(true)
    dismiss.mutate()
  }, [me.data?.showWelcome, dismiss])

  if (!visible) return null

  return (
    <Note className="mb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">{children}</div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          // 44px of height on a rider's phone, per section 4's tap targets,
          // without the button drawing a box around itself.
          className="text-meta font-medium text-ink-2 underline decoration-ink-2/40 hover:decoration-ink-2 flex-none -my-2 py-2"
        >
          Dismiss
        </button>
      </div>
    </Note>
  )
}
