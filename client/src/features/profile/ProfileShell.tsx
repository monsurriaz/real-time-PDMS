import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { Avatar } from '@/components/Table'
import { ApiError } from '@/lib/api'
import { compressAvatar, formatBytes, photoUploadConfigured, uploadPhoto } from '@/lib/cloudinary'
import { useRemoveAvatar, useUploadAvatar } from '../auth/useAuth'

/**
 * v3's Profile section: "one layout, three variants. Tabs rather than a
 * second sidebar, since the rail is already the navigation."
 *
 * The identity block (avatar, name, role line, an approval badge for a
 * rider) sits ABOVE the tabs and stays fixed while they switch — the
 * reference screenshot only shows the Account tab, where that block and the
 * account fields share one card, but repeating avatar/name/badge inside
 * every tab's own card would be the wrong read of a single screenshot. One
 * identity, three swappable bodies underneath it.
 */

export interface ProfileTab {
  key: string
  label: string
  content: ReactNode
}

interface Props {
  name: string
  roleLine: string
  avatarUrl?: string | null
  badge?: ReactNode
  tabs: ProfileTab[]
}

/**
 * A locally-compressed, not-yet-uploaded photo — the "preview before save"
 * step. Nothing has touched the network at this point: `compressAvatar` ran
 * entirely on this device, and the object URL just points at that in-memory
 * blob. Saving is the moment it actually leaves the browser.
 */
interface PendingAvatar {
  blob: Blob
  previewUrl: string
  originalBytes: number
  bytes: number
}

/**
 * The identity block's "Change photo" — real now, per M9.6. Its own
 * component rather than inline in ProfileShell: the pick -> preview -> save
 * flow has enough state (a pending blob, an upload progress, an error) that
 * it earns being read on its own.
 *
 * Reuses the POD path wholesale (CLAUDE.md section 2, and the M9.6 brief's
 * own instruction not to build a second one): the same unsigned Cloudinary
 * preset, the same `uploadPhoto`, the same "server checks it names our
 * cloud" validation on save. The one real difference is `compressAvatar`
 * instead of `compressImage` — square-cropped and capped at 256px rather
 * than POD's full-aspect 1280px, because a face crop needs far less than a
 * doorstep photo does.
 */
const AvatarEditor = ({
  name,
  roleLine,
  badge,
  avatarUrl,
}: {
  name: string
  roleLine: string
  badge?: ReactNode
  avatarUrl?: string | null
}) => {
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const fileInput = useRef<HTMLInputElement>(null)

  const [pending, setPending] = useState<PendingAvatar | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const busy = upload.isPending || remove.isPending || progress !== null
  const serverError =
    upload.error instanceof ApiError
      ? upload.error.message
      : remove.error instanceof ApiError
        ? remove.error.message
        : null
  const error = localError ?? serverError
  const photoBlocked = !photoUploadConfigured()

  const discardPending = (): void => {
    if (pending) URL.revokeObjectURL(pending.previewUrl)
    setPending(null)
  }

  const onPickFile = async (file: File): Promise<void> => {
    setLocalError(null)
    upload.reset()
    try {
      const compressed = await compressAvatar(file)
      setPending({
        blob: compressed.blob,
        previewUrl: URL.createObjectURL(compressed.blob),
        originalBytes: compressed.originalBytes,
        bytes: compressed.bytes,
      })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'that photo could not be processed')
    }
  }

  const save = async (): Promise<void> => {
    if (!pending) return
    setLocalError(null)
    setProgress(0)
    try {
      const uploaded = await uploadPhoto(pending.blob, setProgress)
      setProgress(null)
      // Awaited, not fire-and-forget: `upload.isPending` covers the gap
      // between the Cloudinary upload finishing and this PATCH resolving
      // (see the "Saving…" branch below), and discardPending only runs
      // once the server has actually confirmed the save.
      await upload.mutateAsync(uploaded.secureUrl)
      discardPending()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'the photo could not be uploaded')
      setProgress(null)
    }
  }

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void onPickFile(file)
      }}
    />
  )

  // ---- preview-before-save: a pending, not-yet-uploaded photo ----
  if (pending) {
    return (
      <>
        <img
          src={pending.previewUrl}
          alt=""
          className="w-15 h-15 rounded-full object-cover border border-border flex-none"
        />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold tracking-[-0.025em] truncate">{name}</div>
          <p className="text-tiny text-muted mt-0.5">
            {progress !== null ? (
              `Uploading… ${Math.round(progress * 100)}%`
            ) : upload.isPending ? (
              /*
               * The gap between the Cloudinary upload finishing and this
               * PATCH resolving. Without its own state here, `progress`
               * going back to null while `pending` is still set fell
               * through to the "not saved yet" branch below — a real
               * flicker back to "not saved" for however long the save
               * request takes, exactly the moment it's actually closest to
               * done. Found by a test that raced past "Uploading…" and
               * moved on before the save had actually landed server-side.
               */
              'Saving…'
            ) : (
              <>
                Preview only, not saved yet ·{' '}
                <span className="mono">
                  {formatBytes(pending.originalBytes)} → {formatBytes(pending.bytes)}
                </span>
              </>
            )}
          </p>
          {error ? <p role="alert" className="text-tiny text-failed-ink mt-1">{error}</p> : null}
        </div>
        <div className="flex gap-9px flex-none">
          <Button size="sm" onClick={discardPending} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
            {progress !== null ? 'Uploading…' : upload.isPending ? 'Saving…' : 'Save photo'}
          </Button>
        </div>
      </>
    )
  }

  // ---- idle: the current photo (or initials), name/role/badge, Change / Remove ----
  return (
    <>
      <Avatar url={avatarUrl} name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold tracking-[-0.025em] truncate">{name}</div>
        <div className="text-sm text-muted truncate">{roleLine}</div>
        {badge ? <div className="mt-6px">{badge}</div> : null}
        {error ? <p role="alert" className="text-tiny text-failed-ink mt-1">{error}</p> : null}
      </div>
      {fileInputEl}
      <div className="flex gap-9px flex-none">
        {avatarUrl ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => remove.mutate()}
            className="text-small font-medium text-muted hover:text-ink disabled:text-faint cursor-pointer"
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </button>
        ) : null}
        <Button
          size="sm"
          disabled={busy || photoBlocked}
          title={photoBlocked ? 'Photo upload is not configured' : undefined}
          onClick={() => fileInput.current?.click()}
        >
          Change photo
        </Button>
      </div>
    </>
  )
}

export const ProfileShell = ({ name, roleLine, avatarUrl, badge, tabs }: Props) => {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const current = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="max-w-[660px]">
      <div className="flex items-center gap-15px bg-surface border border-border rounded-t-lg px-22px py-5">
        <AvatarEditor name={name} roleLine={roleLine} badge={badge} avatarUrl={avatarUrl} />
      </div>

      <nav className="flex bg-surface border-x border-border px-22px" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={[
              'px-1 mr-6 py-11px text-body font-medium border-b-2 -mb-px cursor-pointer',
              t.key === active
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="bg-surface border border-border rounded-b-lg px-22px py-5">
        {current?.content}
      </div>
    </div>
  )
}

/** The `.blockh` label above each tab's fields — "Account", "Password", etc. */
export const ProfileBlockHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-base font-semibold tracking-[-0.015em] mb-4">{children}</h3>
)
