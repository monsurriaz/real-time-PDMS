import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  POD_OTP_LENGTH,
  proofOfDeliverySchema,
  recordPodInputSchema,
} from '@pdms/shared'

/**
 * The proof-of-delivery contract, tested at the schema.
 *
 * Worth testing here rather than only through the route: `Delivered` requires
 * proof "already stored on the record", and advanceStatus checks only that the
 * record EXISTS. So the schema is the thing standing between a real proof and
 * an empty object that satisfies the precondition while proving nothing.
 */

describe('proof of delivery records', () => {
  it('requires the evidence its own method claims', () => {
    const capturedAt = new Date()

    // A photo record with no photo is exactly the failure mode described above.
    assert.equal(
      proofOfDeliverySchema.safeParse({ method: 'photo', capturedAt }).success,
      false,
    )
    assert.equal(
      proofOfDeliverySchema.safeParse({ method: 'otp', capturedAt }).success,
      false,
    )
    assert.equal(
      proofOfDeliverySchema.safeParse({ method: 'signature', capturedAt }).success,
      false,
    )
  })

  it('accepts each method with its own evidence', () => {
    const capturedAt = new Date()
    assert.ok(
      proofOfDeliverySchema.safeParse({
        method: 'photo',
        photoUrl: 'https://res.cloudinary.com/demo/image/upload/v1/pod.jpg',
        capturedAt,
      }).success,
    )
    assert.ok(
      proofOfDeliverySchema.safeParse({
        method: 'otp',
        otpVerifiedAt: capturedAt,
        capturedAt,
      }).success,
    )
    assert.ok(
      proofOfDeliverySchema.safeParse({
        method: 'signature',
        receivedBy: 'Nusrat Jahan',
        capturedAt,
      }).success,
    )
  })

  it('refuses a photo hosted anywhere but Cloudinary', () => {
    const capturedAt = new Date()
    for (const photoUrl of [
      'http://res.cloudinary.com/demo/image/upload/v1/pod.jpg', // not https
      'https://example.com/pod.jpg',
      'https://res.cloudinary.com.evil.test/demo/pod.jpg',
    ]) {
      assert.equal(
        proofOfDeliverySchema.safeParse({ method: 'photo', photoUrl, capturedAt }).success,
        false,
        `${photoUrl} should not be accepted`,
      )
    }
  })

  it('never accepts a bare binary in place of a URL', () => {
    // The SRS memory constraint: the image lives on Cloudinary, the record
    // holds a link. A base64 payload must not slip through as a "url".
    assert.equal(
      proofOfDeliverySchema.safeParse({
        method: 'photo',
        photoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        capturedAt: new Date(),
      }).success,
      false,
    )
  })
})

describe('what the rider may submit', () => {
  it('demands a six-digit code on the OTP arm and nothing else', () => {
    assert.ok(recordPodInputSchema.safeParse({ method: 'otp', code: '048213' }).success)
    for (const code of ['12345', '1234567', 'abcdef', '', '12 34 56']) {
      assert.equal(
        recordPodInputSchema.safeParse({ method: 'otp', code }).success,
        false,
        `${code} should not parse`,
      )
    }
    assert.equal(POD_OTP_LENGTH, 6)
  })

  it('carries no verdict about the code — only the digits', () => {
    const parsed = recordPodInputSchema.parse({ method: 'otp', code: '000000' })
    // If a client could send "verified: true", the server's check would be
    // advisory. There is deliberately no such field to send.
    assert.deepEqual(Object.keys(parsed).sort(), ['code', 'method'])
  })

  it('rejects a payload with no method rather than guessing one', () => {
    assert.equal(recordPodInputSchema.safeParse({ receivedBy: 'Someone' }).success, false)
  })

  it('still accepts the signature capture M3 shipped', () => {
    const parsed = recordPodInputSchema.parse({
      method: 'signature',
      receivedBy: 'Rakib Hasan',
    })
    assert.equal(parsed.method, 'signature')
  })
})
