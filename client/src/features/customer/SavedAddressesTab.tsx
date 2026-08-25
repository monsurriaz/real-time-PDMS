import { useState } from 'react'
import { savedAddressInputSchema, type ZoneName } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Field, SelectField } from '@/components/Field'
import { ProfileBlockHeading } from '../profile/ProfileShell'
import { useZones } from '../pricing/usePricing'
import {
  useAddSavedAddress,
  useDeleteSavedAddress,
  useSavedAddresses,
} from '../auth/useAuth'
import { ApiError } from '@/lib/api'

/**
 * The customer profile's role-specific tab — v3's note: "Customer swaps
 * Rider details for saved addresses." CRUD on the list itself; wiring these
 * into the booking form's autofill is a separate piece of work, tracked in
 * DEFERRED.md rather than built into this tab.
 */

const EMPTY = {
  label: '',
  line1: '',
  area: '',
  zone: '' as ZoneName | '',
  contactName: '',
  contactPhone: '',
}

export const SavedAddressesTab = () => {
  const addresses = useSavedAddresses()
  const zones = useZones()
  const add = useAddSavedAddress()
  const del = useDeleteSavedAddress()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setFieldError(null)
    const parsed = savedAddressInputSchema.safeParse(form)
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'check the address')
      return
    }
    add.mutate(parsed.data, {
      onSuccess: () => {
        setForm(EMPTY)
        setOpen(false)
      },
    })
  }

  const serverError = add.error instanceof ApiError ? add.error.message : null

  return (
    <div>
      <ProfileBlockHeading>Saved addresses</ProfileBlockHeading>

      {addresses.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : addresses.isError ? (
        <p role="alert" className="text-small text-failed-ink">
          {addresses.error instanceof ApiError
            ? addresses.error.message
            : 'Saved addresses could not be loaded.'}
        </p>
      ) : addresses.data.length === 0 && !open ? (
        <p className="text-body text-muted mb-4">
          Nothing saved yet. Add a home or office address once and skip typing
          it again next time you book.
        </p>
      ) : (
        <div className="grid gap-2 mb-4">
          {addresses.data.map((a) => (
            <div
              key={a._id}
              className="flex items-center justify-between gap-3 bg-surface-sunk border border-border rounded-sm px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium block truncate">{a.label}</span>
                <span className="text-tiny text-muted truncate block">
                  {a.line1}, {a.area}, {a.zone} · {a.contactName}
                </span>
              </div>
              <Button
                size="sm"
                disabled={del.isPending}
                onClick={() => del.mutate(a._id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <form onSubmit={submit} noValidate className="border-t border-border pt-4">
          <Field
            label="Label"
            placeholder="Home, Office…"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-x-3">
            <Field
              label="Road / house"
              value={form.line1}
              onChange={(e) => set('line1', e.target.value)}
            />
            <Field
              label="Area"
              value={form.area}
              onChange={(e) => set('area', e.target.value)}
            />
          </div>
          <SelectField
            label="Zone"
            value={form.zone}
            onChange={(e) => set('zone', e.target.value as ZoneName | '')}
          >
            <option value="">Select a zone</option>
            {(zones.data ?? []).map((z) => (
              <option key={z.name} value={z.name}>
                {z.label}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-x-3">
            <Field
              label="Contact name"
              value={form.contactName}
              onChange={(e) => set('contactName', e.target.value)}
            />
            <Field
              label="Contact phone"
              type="tel"
              placeholder="01XXXXXXXXX"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
            />
          </div>

          {(fieldError ?? serverError) ? (
            <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
              {fieldError ?? serverError}
            </p>
          ) : null}

          <div className="flex gap-9px">
            <Button type="submit" variant="primary" disabled={add.isPending}>
              {add.isPending ? 'Saving…' : 'Save address'}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setOpen(false)
                setForm(EMPTY)
                setFieldError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setOpen(true)}>Add an address</Button>
      )}
    </div>
  )
}
