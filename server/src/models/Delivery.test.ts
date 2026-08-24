import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LIFECYCLE_WRITE, assertLifecycleWrite } from './Delivery'

/**
 * CLAUDE.md section 5: "no route mutates status directly."
 *
 * That was true by discipline until M6 — DeliveryModel is exported, and one
 * `$set: { status }` in a future handler would skip the transition map, the
 * authority check, the Delivered precondition, the appended event and the
 * socket broadcast, all at once. These tests cover the rule that now enforces
 * it, including the operators someone would reach for without meaning any harm.
 */

const MARKED = { [LIFECYCLE_WRITE]: true }

describe('only advanceStatus may write delivery.status', () => {
  it('refuses the obvious $set', () => {
    assert.throws(
      () => assertLifecycleWrite({ $set: { status: 'Delivered' } }, {}),
      /advanceStatus/,
    )
  })

  it('refuses a bare assignment with no operator', () => {
    assert.throws(() => assertLifecycleWrite({ status: 'Delivered' }, {}), /advanceStatus/)
  })

  it('refuses the operators that are easy to forget about', () => {
    for (const update of [
      { $setOnInsert: { status: 'Booked' } },
      { $unset: { status: '' } },
      { $rename: { status: 'state' } },
      { $set: { status: 'Failed' }, $push: { events: {} } },
    ]) {
      assert.throws(
        () => assertLifecycleWrite(update, {}),
        /advanceStatus/,
        `${JSON.stringify(update)} should have been refused`,
      )
    }
  })

  it('allows the marked write advanceStatus itself makes', () => {
    assert.doesNotThrow(() =>
      assertLifecycleWrite(
        { $set: { status: 'Delivered', deliveredAt: new Date() }, $push: { events: {} } },
        MARKED,
      ),
    )
  })

  it('is not satisfied by a truthy-looking marker', () => {
    // `=== true`, so a stray string or a 1 does not open the gate.
    for (const options of [{ [LIFECYCLE_WRITE]: 'yes' }, { [LIFECYCLE_WRITE]: 1 }]) {
      assert.throws(() => assertLifecycleWrite({ $set: { status: 'X' } }, options))
    }
  })

  it('leaves every other field alone', () => {
    // The rule is about one path. Location, proof and failure reasons are
    // written by routes on purpose and must stay writable.
    for (const update of [
      { $set: { lastKnownLocation: { type: 'Point', coordinates: [90, 23] } } },
      { $set: { proofOfDelivery: { method: 'photo' } } },
      { $set: { failureReason: 'nobody home' } },
      { $push: { events: { status: 'Delivered' } } },
      { $set: { 'podOtp.attempts': 2 } },
    ]) {
      assert.doesNotThrow(
        () => assertLifecycleWrite(update, {}),
        `${JSON.stringify(update)} should have been allowed`,
      )
    }
  })

  it('ignores an absent update', () => {
    assert.doesNotThrow(() => assertLifecycleWrite(null, {}))
    assert.doesNotThrow(() => assertLifecycleWrite(undefined, {}))
  })

  it('does not mistake a status-shaped value elsewhere for a status write', () => {
    // `events.0.status` is part of the trail, not the delivery's own status.
    assert.doesNotThrow(() =>
      assertLifecycleWrite({ $push: { events: { status: 'PickedUp' } } }, {}),
    )
  })
})
