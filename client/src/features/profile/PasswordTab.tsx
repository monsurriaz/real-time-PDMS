import { useState } from 'react'
import { changePasswordInputSchema } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { ApiError } from '@/lib/api'
import { useChangePassword } from '../auth/useAuth'
import { ProfileBlockHeading } from './ProfileShell'

/**
 * Its own tab, its own endpoint, its own Save button — v3's own note is that
 * this must never share one with a name/phone/email edit, so a slip on the
 * Account tab can never silently also change the password.
 */
export const PasswordTab = () => {
  const change = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)
    setDone(false)
    const parsed = changePasswordInputSchema.safeParse({ currentPassword, newPassword })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check your password')
      return
    }
    change.mutate(parsed.data, {
      onSuccess: () => {
        setDone(true)
        setCurrentPassword('')
        setNewPassword('')
      },
    })
  }

  const serverError = change.error instanceof ApiError ? change.error.message : null

  return (
    <form onSubmit={submit} noValidate>
      <ProfileBlockHeading>Password</ProfileBlockHeading>
      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => {
          setCurrentPassword(e.target.value)
          setDone(false)
        }}
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        value={newPassword}
        onChange={(e) => {
          setNewPassword(e.target.value)
          setDone(false)
        }}
      />

      {(fieldError ?? serverError) ? (
        <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
          {fieldError ?? serverError}
        </p>
      ) : done ? (
        <p className="text-small text-delivered-ink mb-3">Password changed.</p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        disabled={change.isPending || !currentPassword || newPassword.length < 8}
      >
        {change.isPending ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  )
}
