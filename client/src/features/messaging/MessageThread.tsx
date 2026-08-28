import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useMe } from '../auth/useAuth'
import { useMessageThread, usePostMessage } from './useMessageThread'

/**
 * The customer <-> rider thread for one delivery (M9).
 *
 * Same component for both sides — the only thing that differs is which
 * senderRole reads as "mine", from the signed-in viewer's own role. Renders
 * for every viewer (customer, rider, admin); which of "post", "read-only
 * history" or "not open yet" applies comes back from the server on every
 * load, never decided here (CLAUDE.md rule 3's spirit applied to a feature
 * that isn't a delivery transition, but is still server-owned).
 */

const INPUT_CLASS =
  'w-full min-h-12 font-sans text-control text-ink px-13px py-11px ' +
  'border border-border-strong rounded-sm bg-surface outline-none ' +
  'focus:border-accent focus:ring-[3px] focus:ring-accent-tint'

export const MessageThread = ({
  deliveryId,
  parcelId,
}: {
  deliveryId: string
  parcelId: string
}) => {
  const me = useMe()
  const thread = useMessageThread(deliveryId, parcelId)
  const post = usePostMessage(deliveryId)
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const messageCount = thread.data?.messages.length ?? 0
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messageCount])

  if (thread.isPending) {
    return <p className="text-small text-muted">Loading messages…</p>
  }

  if (thread.isError) {
    return (
      <p role="alert" className="text-small text-failed-ink">
        {thread.error instanceof ApiError
          ? thread.error.message
          : 'Messages could not be loaded.'}
      </p>
    )
  }

  const { messages, open, readOnly } = thread.data
  const myRole = me.data?.role
  const err = post.error instanceof ApiError ? post.error.message : null

  const submit = (): void => {
    const text = body.trim()
    if (!text || post.isPending) return
    post.mutate({ body: text }, { onSuccess: () => setBody('') })
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="text-eyebrow font-semibold uppercase tracking-[0.13em] text-ink-2 mb-2">
        Messages
      </div>

      <div className="max-h-[280px] overflow-y-auto flex flex-col gap-2">
        {messages.length === 0 ? (
          <p className="text-small text-muted">
            {open
              ? 'No messages yet — say hello.'
              : 'No messages on this delivery.'}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === myRole
            return (
              <div
                key={m._id}
                className={`max-w-[80%] rounded-md px-3 py-2 text-small ${
                  mine
                    ? 'self-end bg-accent-tint text-ink'
                    : 'self-start bg-surface-sunk text-ink-2'
                }`}
              >
                <div className="text-eyebrow text-faint mb-0.5">
                  {m.senderName} · <span className="mono">{formatDateTime(m.createdAt)}</span>
                </div>
                {m.body}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {err ? (
        <p role="alert" className="text-tiny text-failed-ink mt-2">
          {err}
        </p>
      ) : null}

      {readOnly ? (
        <p className="text-tiny text-muted mt-3">
          Admins can read this thread but not send messages.
        </p>
      ) : open ? (
        <div className="flex gap-2 mt-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="Write a message…"
            className={INPUT_CLASS}
          />
          <Button
            onClick={submit}
            disabled={post.isPending || body.trim().length === 0}
          >
            {post.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      ) : (
        <p className="text-tiny text-muted mt-3">
          This thread is closed — messaging is only open between pickup and
          delivery.
        </p>
      )}
    </div>
  )
}
