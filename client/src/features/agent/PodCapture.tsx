import { useRef, useState } from 'react'
import {
  POD_OTP_LENGTH,
  recordPodInputSchema,
  type DeliveryListItem,
  type PodMethod,
} from '@pdms/shared'
import { Button } from '@/components/Button'
import { ApiError } from '@/lib/api'
import {
  compressImage,
  formatBytes,
  photoUploadConfigured,
  uploadPhoto,
} from '@/lib/cloudinary'
import { useIssueOtp, useRecordPod } from '../deliveries/useDeliveries'

/**
 * The proof-of-delivery block on the rider's card: the three dashed `.pod`
 * tiles from docs/design-system.html, all three live since M5.
 *
 * The tiles are a radio group, not three buttons that each do something: only
 * one proof is recorded, so choosing a method reveals that method's controls
 * underneath rather than opening a third thing next to two others. That keeps
 * the "ONE enormous button" rule intact — the primary action below stays the
 * transition, and nothing here competes with it.
 */

const CAPS = 'text-[11px] font-semibold uppercase tracking-[0.13em] text-muted'

const FIELD = [
  // min-h-12 for the same reason the tiles are min-h-12: this is a phone in a
  // rider's hand, and section 4 puts the floor at 48px.
  'w-full min-h-12 font-sans text-control text-ink px-13px py-11px',
  'border border-hairline-strong rounded-sm bg-surface outline-none',
  'focus:border-accent focus:ring-[3px] focus:ring-accent-tint',
].join(' ')

const ICON = {
  photo: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  otp: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  signature: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 17c3-1 4-8 7-8s2 6 5 6 3-3 6-3" />
    </svg>
  ),
} as const satisfies Record<PodMethod, React.ReactNode>

const LABEL: Record<PodMethod, string> = {
  photo: 'Photo',
  otp: 'OTP',
  signature: 'Signature',
}

/** The `.pod` tile: dashed hairline, 20px icon above a 12.5px label. */
const PodTile = ({
  method,
  hint,
  selected,
  disabled,
  onSelect,
}: {
  method: PodMethod
  hint?: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={disabled}
    onClick={onSelect}
    className={[
      // 48px minimum tap target is a floor, not a target: these are taller.
      'flex-1 min-h-12 border border-dashed rounded-md py-4 px-3 text-center',
      'text-[12.5px] font-medium transition-colors duration-100',
      disabled
        ? 'border-hairline text-muted cursor-not-allowed'
        : selected
          ? 'border-accent bg-accent-tint text-ink cursor-pointer'
          : 'border-hairline-strong text-ink-2 hover:bg-surface-sunk cursor-pointer',
    ].join(' ')}
  >
    <span className="flex justify-center mb-7px">{ICON[method]}</span>
    {LABEL[method]}
    {hint ? <span className="block text-[10.5px] font-normal mt-0.5">{hint}</span> : null}
  </button>
)

interface Props {
  d: DeliveryListItem
}

export const PodCapture = ({ d }: Props) => {
  const pod = useRecordPod()
  const issue = useIssueOtp()
  const fileInput = useRef<HTMLInputElement>(null)

  const [method, setMethod] = useState<PodMethod | null>(null)
  const [receivedBy, setReceivedBy] = useState('')
  const [code, setCode] = useState('')
  const [photo, setPhoto] = useState<{ url: string; bytes: number; from: number } | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const busy = pod.isPending || progress !== null
  const serverError =
    pod.error instanceof ApiError
      ? pod.error.message
      : issue.error instanceof ApiError
        ? issue.error.message
        : null
  const error = localError ?? serverError

  /** Already recorded: the tiles become a statement, not a choice. */
  if (d.hasProofOfDelivery) {
    const recorded = d.podMethod ? LABEL[d.podMethod] : 'Proof'
    return (
      <>
        <div className={`${CAPS} mt-6`}>Proof of delivery</div>
        <div className="flex items-center gap-2 mt-14px p-13px bg-delivered-bg rounded-md">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-delivered-ink flex-none">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
          <span className="text-[12.5px] font-medium text-delivered-ink">
            {recorded} recorded
          </span>
        </div>
      </>
    )
  }

  const choose = (next: PodMethod): void => {
    setLocalError(null)
    pod.reset()
    issue.reset()
    setMethod(method === next ? null : next)
  }

  /**
   * Compress, upload, then submit the URL. Three awaits with distinct failure
   * messages, because "upload failed" is useless when the real problem is an
   * unsigned-preset misconfiguration or a HEIC the browser cannot decode.
   */
  const onPickFile = async (file: File): Promise<void> => {
    setLocalError(null)
    setProgress(0)
    try {
      const compressed = await compressImage(file)
      const uploaded = await uploadPhoto(compressed.blob, setProgress)
      setPhoto({
        url: uploaded.secureUrl,
        bytes: uploaded.bytes,
        from: compressed.originalBytes,
      })
      // Validated with the schema the server uses (rule 4); the server
      // re-validates AND checks the URL names our own Cloudinary cloud.
      const parsed = recordPodInputSchema.safeParse({
        method: 'photo',
        photoUrl: uploaded.secureUrl,
      })
      if (!parsed.success) {
        setLocalError('that upload did not come back with a usable URL')
        return
      }
      pod.mutate({ deliveryId: d._id, ...parsed.data })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'the photo could not be uploaded')
    } finally {
      setProgress(null)
    }
  }

  const submitCode = (): void => {
    setLocalError(null)
    const parsed = recordPodInputSchema.safeParse({ method: 'otp', code })
    if (!parsed.success) {
      setLocalError(`the code is ${POD_OTP_LENGTH} digits`)
      return
    }
    pod.mutate({ deliveryId: d._id, ...parsed.data })
  }

  const submitSignature = (): void => {
    setLocalError(null)
    const parsed = recordPodInputSchema.safeParse({
      method: 'signature',
      receivedBy: receivedBy.trim(),
    })
    if (!parsed.success) {
      setLocalError('a name needs at least two characters')
      return
    }
    pod.mutate({ deliveryId: d._id, ...parsed.data })
  }

  const photoBlocked = !photoUploadConfigured()

  return (
    <>
      <div className={`${CAPS} mt-6`}>Proof of delivery</div>

      <div className="flex gap-10px mt-14px" role="radiogroup" aria-label="Proof of delivery method">
        <PodTile
          method="photo"
          selected={method === 'photo'}
          disabled={photoBlocked || busy}
          {...(photoBlocked ? { hint: 'not configured' } : {})}
          onSelect={() => choose('photo')}
        />
        <PodTile
          method="otp"
          selected={method === 'otp'}
          disabled={busy}
          onSelect={() => choose('otp')}
        />
        <PodTile
          method="signature"
          selected={method === 'signature'}
          disabled={busy}
          onSelect={() => choose('signature')}
        />
      </div>

      {/* ---- photo ---- */}
      {method === 'photo' ? (
        <div className="mt-14px">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            // Opens the camera on a phone rather than the photo library.
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so picking the same file twice still fires a change.
              e.target.value = ''
              if (file) void onPickFile(file)
            }}
          />
          <Button
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {progress !== null
              ? `Uploading… ${Math.round(progress * 100)}%`
              : pod.isPending
                ? 'Saving…'
                : 'Take a photo'}
          </Button>

          {progress !== null ? (
            // A 1px-hairline bar, not a spinner: the rider needs to know it is
            // moving on a slow connection, and a percentage alone reads as stuck.
            <div className="h-1 bg-surface-sunk rounded-pill mt-2 overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}

          {photo ? (
            <p className="text-[11.5px] text-muted mt-2">
              Uploaded{' '}
              <span className="mono">
                {formatBytes(photo.from)} → {formatBytes(photo.bytes)}
              </span>{' '}
              · stored as a link, not an image
            </p>
          ) : (
            <p className="text-[11.5px] text-muted mt-2">
              Compressed on the phone before it is sent.
            </p>
          )}
        </div>
      ) : null}

      {/* ---- OTP ---- */}
      {method === 'otp' ? (
        <div className="mt-14px">
          {issue.data ? (
            <>
              <label
                htmlFor={`otp-${d._id}`}
                className="block text-[12.5px] font-medium text-ink-2 mb-1.5"
              >
                Code the recipient reads out
              </label>
              <div className="flex gap-2">
                <input
                  id={`otp-${d._id}`}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={POD_OTP_LENGTH}
                  placeholder="000000"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={`${FIELD} mono flex-1 min-w-0 tracking-[0.3em] text-[17px]`}
                />
                <Button
                  className="min-h-12"
                  disabled={code.length !== POD_OTP_LENGTH || busy}
                  onClick={submitCode}
                >
                  {pod.isPending ? 'Checking…' : 'Verify'}
                </Button>
              </div>
              <p className="text-[11.5px] text-muted mt-2">
                Sent to the sender&apos;s tracking screen. Expires{' '}
                <span className="mono">
                  {new Date(issue.data.otp.expiresAt).toLocaleTimeString('en-BD', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                . Only the server can check it.
              </p>
            </>
          ) : (
            <>
              <Button
                className="w-full"
                size="lg"
                disabled={issue.isPending}
                onClick={() => issue.mutate(d._id)}
              >
                {issue.isPending ? 'Sending…' : 'Send code'}
              </Button>
              <p className="text-[11.5px] text-muted mt-2">
                The code goes to the sender, never to this screen.
              </p>
            </>
          )}
        </div>
      ) : null}

      {/* ---- signature ---- */}
      {method === 'signature' ? (
        <div className="mt-14px">
          <label
            htmlFor={`rb-${d._id}`}
            className="block text-[12.5px] font-medium text-ink-2 mb-1.5"
          >
            Received by
          </label>
          <div className="flex gap-2">
            <input
              id={`rb-${d._id}`}
              value={receivedBy}
              placeholder={d.recipientName}
              onChange={(e) => setReceivedBy(e.target.value)}
              className={`${FIELD} flex-1 min-w-0`}
            />
            <Button
              className="min-h-12"
              disabled={receivedBy.trim().length < 2 || busy}
              onClick={submitSignature}
            >
              {pod.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mt-3"
        >
          {error}
        </p>
      ) : null}
    </>
  )
}
