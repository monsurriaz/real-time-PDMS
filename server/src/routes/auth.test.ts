import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { registerInputSchema } from '@pdms/shared'

/**
 * "The server must reject any registration payload claiming the admin role
 * regardless of what the client sends" (CLAUDE.md's M6.5c brief) — tested at
 * the schema, because that is the ENTIRE mechanism: registerInputSchema is a
 * discriminated union with exactly two literal branches, `customer` and
 * `agent`. There is no third branch for `{"role":"admin"}` to match, so it
 * fails to parse rather than being silently downgraded to customer or
 * trusted outright. The route (POST /auth/register) never sees a payload
 * this test does not also cover, since it calls .parse() on the same schema.
 */

const CUSTOMER_FIELDS = {
  name: 'Nusrat Jahan',
  email: 'nusrat@example.com',
  phone: '01711000001',
  password: 'a-real-password',
}

const AGENT_FIELDS = {
  ...CUSTOMER_FIELDS,
  email: 'rakib@example.com',
  vehicle: 'motorcycle',
  zone: 'Mirpur',
  nid: '1990123456',
}

describe('registration cannot claim the admin role', () => {
  it('refuses role: admin outright — there is no branch for it', () => {
    const result = registerInputSchema.safeParse({ ...CUSTOMER_FIELDS, role: 'admin' })
    assert.equal(result.success, false)
  })

  it('refuses a role the enum has never heard of, the same way', () => {
    const result = registerInputSchema.safeParse({
      ...CUSTOMER_FIELDS,
      role: 'superadmin',
    })
    assert.equal(result.success, false)
  })

  it('refuses a payload with no role at all', () => {
    assert.equal(registerInputSchema.safeParse(CUSTOMER_FIELDS).success, false)
  })

  it('accepts the customer branch', () => {
    const result = registerInputSchema.safeParse({ ...CUSTOMER_FIELDS, role: 'customer' })
    assert.equal(result.success, true)
    if (result.success) assert.equal(result.data.role, 'customer')
  })

  it('accepts the agent branch with its own required fields', () => {
    const result = registerInputSchema.safeParse({ ...AGENT_FIELDS, role: 'agent' })
    assert.equal(result.success, true)
    if (result.success) assert.equal(result.data.role, 'agent')
  })

  it('refuses an agent payload missing the rider-only fields', () => {
    const result = registerInputSchema.safeParse({ ...CUSTOMER_FIELDS, role: 'agent' })
    assert.equal(result.success, false)
  })

  it('an agent payload cannot smuggle admin in some other field the union ignores', () => {
    // Zod strips unknown keys on a plain object branch — an extra
    // `isAdmin: true` or `role: 'admin'` nested elsewhere simply does not
    // exist on the parsed result.
    const result = registerInputSchema.safeParse({
      ...AGENT_FIELDS,
      role: 'agent',
      isAdmin: true,
    })
    assert.equal(result.success, true)
    if (result.success) assert.ok(!('isAdmin' in result.data))
  })
})
