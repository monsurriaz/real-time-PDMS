import { useState } from 'react'
import { updateAccountInputSchema, type SelfUser } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { useUpdateAccount } from '../auth/useAuth'
import { ProfileBlockHeading } from './ProfileShell'

/**
 * Every role's Account tab: name, phone, and email — the first two editable,
 * shared because the fields and the endpoint (PATCH /auth/me) are identical
 * for all three roles and only the tabs around it differ.
 *
 * Email is shown, not editable: it is the account's sign-in identity, and
 * `updateAccountInputSchema` no longer accepts it at all — this is a real
 * read-only field, not a client that merely declines to let you touch it.
 */
export const AccountTab = ({ user }: { user: SelfUser }) => {
  const update = useUpdateAccount()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = name !== user.name || phone !== user.phone

  const reset = (): void => {
    setName(user.name)
    setPhone(user.phone)
    setFieldError(null)
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)
    setJustSaved(false)
    const parsed = updateAccountInputSchema.safeParse({ name, phone })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check your details')
      return
    }
    update.mutate(parsed.data, { onSuccess: () => setJustSaved(true) })
  }

  const serverError = update.error instanceof ApiError ? update.error.message : null

  return (
    <form onSubmit={submit} noValidate>
      <ProfileBlockHeading>Account</ProfileBlockHeading>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <Field
        label="Email"
        type="email"
        value={user.email}
        readOnly
        hint="This is your sign-in address — it cannot be changed here."
      />

      {(fieldError ?? serverError) ? (
        <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
          {fieldError ?? serverError}
        </p>
      ) : justSaved && !dirty ? (
        <p className="text-small text-delivered-ink mb-3">Saved.</p>
      ) : null}

      <div className="flex gap-9px mt-4">
        <Button type="submit" variant="primary" disabled={update.isPending || !dirty}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type="button" onClick={reset} disabled={update.isPending || !dirty}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
