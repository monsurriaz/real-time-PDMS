import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deliveryStatusSchema, type DeliveryStatus, type Role } from '@pdms/shared'
import {
  LEGAL_TRANSITIONS,
  TRANSITION_AUTHORITY,
  availableTransitions,
  canTransition,
  isTerminal,
} from './lifecycle'

const ALL = deliveryStatusSchema.options
const ROLES: readonly Role[] = ['customer', 'agent', 'admin']

/** The diagram in CLAUDE.md section 5, transcribed independently of the map. */
const DOCUMENTED_EDGES: ReadonlyArray<[DeliveryStatus, DeliveryStatus]> = [
  ['Booked', 'Assigned'],
  ['Assigned', 'PickedUp'],
  ['PickedUp', 'InTransit'],
  ['InTransit', 'Delivered'],
  // Cancelled before PickedUp only
  ['Booked', 'Cancelled'],
  ['Assigned', 'Cancelled'],
  // Failed from InTransit only
  ['InTransit', 'Failed'],
]

describe('the transition map matches CLAUDE.md section 5', () => {
  it('allows exactly the documented edges and nothing else', () => {
    const actual = new Set<string>()
    for (const from of ALL) {
      for (const to of LEGAL_TRANSITIONS[from]) actual.add(`${from}->${to}`)
    }
    const documented = new Set(DOCUMENTED_EDGES.map(([f, t]) => `${f}->${t}`))

    const extra = [...actual].filter((e) => !documented.has(e))
    const missing = [...documented].filter((e) => !actual.has(e))
    assert.deepEqual(extra, [], `undocumented transitions allowed: ${extra.join(', ')}`)
    assert.deepEqual(missing, [], `documented transitions missing: ${missing.join(', ')}`)
  })

  it('treats Delivered, Cancelled and Failed as terminal', () => {
    for (const s of ['Delivered', 'Cancelled', 'Failed'] as const) {
      assert.equal(isTerminal(s), true, `${s} should be terminal`)
      assert.deepEqual(LEGAL_TRANSITIONS[s], [], `${s} should have no exits`)
    }
    for (const s of ['Booked', 'Assigned', 'PickedUp', 'InTransit'] as const) {
      assert.equal(isTerminal(s), false, `${s} should not be terminal`)
    }
  })

  it('rejects Cancelled once the parcel has been picked up', () => {
    assert.equal(canTransition('Booked', 'Cancelled'), true)
    assert.equal(canTransition('Assigned', 'Cancelled'), true)
    // The section 5 rule: "before PickedUp only".
    assert.equal(canTransition('PickedUp', 'Cancelled'), false)
    assert.equal(canTransition('InTransit', 'Cancelled'), false)
  })

  it('rejects Failed from anywhere but InTransit', () => {
    assert.equal(canTransition('InTransit', 'Failed'), true)
    for (const from of ['Booked', 'Assigned', 'PickedUp'] as const) {
      assert.equal(canTransition(from, 'Failed'), false, `${from} -> Failed must be illegal`)
    }
  })

  it('rejects skipping a step', () => {
    for (const [from, to] of [
      ['Booked', 'PickedUp'],
      ['Booked', 'InTransit'],
      ['Booked', 'Delivered'],
      ['Assigned', 'InTransit'],
      ['Assigned', 'Delivered'],
      ['PickedUp', 'Delivered'],
    ] as const) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`)
    }
  })

  it('rejects going backwards', () => {
    for (const [from, to] of [
      ['Assigned', 'Booked'],
      ['PickedUp', 'Assigned'],
      ['InTransit', 'PickedUp'],
      ['Delivered', 'InTransit'],
    ] as const) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`)
    }
  })

  it('rejects every exit from a terminal state, exhaustively', () => {
    for (const from of ['Delivered', 'Cancelled', 'Failed'] as const) {
      for (const to of ALL) {
        assert.equal(
          canTransition(from, to),
          false,
          `${from} -> ${to} must be illegal`,
        )
      }
    }
  })

  it('never allows a self-transition', () => {
    for (const s of ALL) {
      assert.equal(canTransition(s, s), false, `${s} -> ${s} must be illegal`)
    }
  })

  it('has an authority entry for every status, so nothing defaults open', () => {
    for (const s of ALL) {
      assert.ok(
        Array.isArray(TRANSITION_AUTHORITY[s]),
        `${s} has no authority entry`,
      )
    }
    // Booked is produced by creation, never by a transition.
    assert.deepEqual(TRANSITION_AUTHORITY.Booked, [])
  })
})

describe('who may drive a transition', () => {
  it('lets an agent move a parcel through the physical steps only', () => {
    assert.deepEqual(availableTransitions('Assigned', 'agent'), ['PickedUp'])
    assert.deepEqual(availableTransitions('PickedUp', 'agent'), ['InTransit'])
    assert.deepEqual(availableTransitions('InTransit', 'agent'), ['Delivered', 'Failed'])
    // An agent cannot assign work to themselves.
    assert.deepEqual(availableTransitions('Booked', 'agent'), [])
  })

  it('lets a customer cancel only before pickup, and nothing else', () => {
    assert.deepEqual(availableTransitions('Booked', 'customer'), ['Cancelled'])
    assert.deepEqual(availableTransitions('Assigned', 'customer'), ['Cancelled'])
    assert.deepEqual(availableTransitions('PickedUp', 'customer'), [])
    assert.deepEqual(availableTransitions('InTransit', 'customer'), [])
  })

  it('gives an admin every legal move, but no illegal one', () => {
    for (const from of ALL) {
      assert.deepEqual(
        availableTransitions(from, 'admin'),
        LEGAL_TRANSITIONS[from],
        `admin should have every legal move from ${from}`,
      )
    }
  })

  it('offers no transition out of a terminal state to anyone', () => {
    for (const from of ['Delivered', 'Cancelled', 'Failed'] as const) {
      for (const role of ROLES) {
        assert.deepEqual(
          availableTransitions(from, role),
          [],
          `${role} should have no move from ${from}`,
        )
      }
    }
  })

  it('never offers a transition that the map itself forbids', () => {
    for (const from of ALL) {
      for (const role of ROLES) {
        for (const to of availableTransitions(from, role)) {
          assert.equal(
            canTransition(from, to),
            true,
            `offered illegal ${from} -> ${to} to ${role}`,
          )
        }
      }
    }
  })
})
