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

/**
 * The diagram in CLAUDE.md section 5, transcribed independently of the map
 * (M8): Booked -> Assigned(offered) -> Accepted -> PickedUp -> InTransit ->
 * Delivered, with Cancelled reachable before PickedUp, Failed only from
 * InTransit, and two M8 additions — Assigned -> Booked (declined or
 * expired) and Accepted -> Assigned (an admin reassigns after acceptance,
 * a fresh offer to someone new).
 */
const DOCUMENTED_EDGES: ReadonlyArray<[DeliveryStatus, DeliveryStatus]> = [
  ['Booked', 'Assigned'],
  ['Assigned', 'Accepted'],
  ['Accepted', 'PickedUp'],
  ['PickedUp', 'InTransit'],
  ['InTransit', 'Delivered'],
  // Cancelled before PickedUp only
  ['Booked', 'Cancelled'],
  ['Assigned', 'Cancelled'],
  ['Accepted', 'Cancelled'],
  // M8: an offer that didn't stick
  ['Assigned', 'Booked'],
  // M8: reassigning after acceptance is a fresh offer
  ['Accepted', 'Assigned'],
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
    for (const s of ['Booked', 'Assigned', 'Accepted', 'PickedUp', 'InTransit'] as const) {
      assert.equal(isTerminal(s), false, `${s} should not be terminal`)
    }
  })

  it('rejects Cancelled once the parcel has been picked up', () => {
    assert.equal(canTransition('Booked', 'Cancelled'), true)
    assert.equal(canTransition('Assigned', 'Cancelled'), true)
    assert.equal(canTransition('Accepted', 'Cancelled'), true)
    // The section 5 rule: "before PickedUp only".
    assert.equal(canTransition('PickedUp', 'Cancelled'), false)
    assert.equal(canTransition('InTransit', 'Cancelled'), false)
  })

  it('rejects Failed from anywhere but InTransit', () => {
    assert.equal(canTransition('InTransit', 'Failed'), true)
    for (const from of ['Booked', 'Assigned', 'Accepted', 'PickedUp'] as const) {
      assert.equal(canTransition(from, 'Failed'), false, `${from} -> Failed must be illegal`)
    }
  })

  it('rejects skipping a step', () => {
    for (const [from, to] of [
      ['Booked', 'Accepted'],
      ['Booked', 'PickedUp'],
      ['Booked', 'InTransit'],
      ['Booked', 'Delivered'],
      ['Assigned', 'InTransit'],
      ['Assigned', 'Delivered'],
      ['Accepted', 'InTransit'],
      ['Accepted', 'Delivered'],
      ['PickedUp', 'Delivered'],
    ] as const) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`)
    }
  })

  it('rejects going backwards, except the two M8 offer-fallthrough edges', () => {
    for (const [from, to] of [
      ['PickedUp', 'Accepted'],
      ['PickedUp', 'Assigned'],
      ['PickedUp', 'Booked'],
      ['InTransit', 'PickedUp'],
      ['InTransit', 'Accepted'],
      ['InTransit', 'Assigned'],
      ['Delivered', 'InTransit'],
      // Accepted can't fall through to Booked directly — only an outstanding
      // OFFER (Assigned) can be declined or expire. An accepted rider who
      // wants out is a cancellation or a reassignment, not a decline.
      ['Accepted', 'Booked'],
    ] as const) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`)
    }
  })

  it('only Assigned (an outstanding offer) can fall through to Booked', () => {
    for (const from of ALL) {
      assert.equal(
        canTransition(from, 'Booked'),
        from === 'Assigned',
        `${from} -> Booked should be ${from === 'Assigned'}`,
      )
    }
  })

  it('only Booked (first offer) or Accepted (reassignment) can reach Assigned', () => {
    for (const from of ALL) {
      const expected = from === 'Booked' || from === 'Accepted'
      assert.equal(canTransition(from, 'Assigned'), expected, `${from} -> Assigned should be ${expected}`)
    }
  })

  it('only an outstanding offer (Assigned) can become Accepted', () => {
    for (const from of ALL) {
      assert.equal(
        canTransition(from, 'Accepted'),
        from === 'Assigned',
        `${from} -> Accepted should be ${from === 'Assigned'}`,
      )
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
    /**
     * M8: Booked is no longer creation-only — a decline or an expired offer
     * also produces it, driven by the agent who was offered it ('system'
     * bypasses this check entirely for the expiry case). Admin is
     * deliberately absent: "only the assigned rider may accept or decline".
     */
    assert.deepEqual(TRANSITION_AUTHORITY.Booked, ['agent'])
  })
})

describe('who may drive a transition', () => {
  it('lets an agent move a parcel through the physical steps, and answer their own offer', () => {
    // M8: an outstanding offer is answered by the agent it was made to —
    // Accepted (yes) or Booked (no, i.e. decline).
    assert.deepEqual(availableTransitions('Assigned', 'agent'), ['Accepted', 'Booked'])
    assert.deepEqual(availableTransitions('Accepted', 'agent'), ['PickedUp'])
    assert.deepEqual(availableTransitions('PickedUp', 'agent'), ['InTransit'])
    assert.deepEqual(availableTransitions('InTransit', 'agent'), ['Delivered', 'Failed'])
    // An agent cannot assign work to themselves.
    assert.deepEqual(availableTransitions('Booked', 'agent'), [])
  })

  it('lets a customer cancel only before pickup, and nothing else', () => {
    assert.deepEqual(availableTransitions('Booked', 'customer'), ['Cancelled'])
    assert.deepEqual(availableTransitions('Assigned', 'customer'), ['Cancelled'])
    assert.deepEqual(availableTransitions('Accepted', 'customer'), ['Cancelled'])
    assert.deepEqual(availableTransitions('PickedUp', 'customer'), [])
    assert.deepEqual(availableTransitions('InTransit', 'customer'), [])
  })

  it('gives an admin every legal move except answering an offer on the rider\'s behalf', () => {
    /**
     * M8's one deliberate carve-out: TRANSITION_AUTHORITY excludes admin
     * from both Accepted and the decline/expiry Booked edge — "only the
     * assigned rider may accept or decline". Admin still gets everything
     * else the map allows from every status, reassignment included
     * (Accepted -> Assigned stays admin's).
     */
    for (const from of ALL) {
      const expected = LEGAL_TRANSITIONS[from].filter((to) => to !== 'Accepted' && to !== 'Booked')
      assert.deepEqual(
        availableTransitions(from, 'admin'),
        expected,
        `admin should have every legal move from ${from} except answering an offer`,
      )
    }
  })

  it('never lets an admin accept or decline an offer on the rider\'s behalf', () => {
    assert.deepEqual(availableTransitions('Assigned', 'admin'), ['Cancelled'])
    assert.deepEqual(availableTransitions('Accepted', 'admin'), ['PickedUp', 'Assigned', 'Cancelled'])
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
