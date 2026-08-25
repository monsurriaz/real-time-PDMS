import { useQuery } from '@tanstack/react-query'
import type { Role } from '@pdms/shared'
import { api } from '@/lib/api'
import { useParcels } from '@/features/booking/useBooking'
import { useDeliveries } from '@/features/deliveries/useDeliveries'
import { useCodReconciliation } from '@/features/payments/usePayments'

/**
 * The numbers beside the rail's nav items.
 *
 * v3's rule for what a count means: "an admin sees what needs attention
 * without opening anything — that's what a console does and a stack of pages
 * doesn't." So a count is never a total for its own sake, it is the number of
 * things on that screen still asking for something:
 *
 *   My parcels        parcels still moving, not everything ever sent
 *   Live board        deliveries in flight
 *   Cash on delivery  riders holding cash, not the amount they hold
 *   Riders            applications waiting on a decision
 *   Today's runs      what the rider is carrying
 *
 * Every one reuses an existing query key, so opening the screen the count
 * refers to costs no extra request — TanStack serves both from one fetch.
 */

const ACTIVE = ['Booked', 'Assigned', 'PickedUp', 'InTransit']

export interface RailCounts {
  /** Parcels or deliveries in flight, depending on the role asking. */
  active: number | null
  /** Rider-side only: runs already finished today. */
  finished: number | null
  /** Admin only: riders holding unsettled cash. */
  codRiders: number | null
  /** Admin only: rider applications awaiting approval. Zero until M6.5c. */
  pendingRiders: number | null
}

interface AgentCounts {
  total: number
  onShift: number
  pendingApproval: number
}

/** Admin-only, so it is never fetched for the other two roles. */
const useAgentCounts = (enabled: boolean) =>
  useQuery({
    queryKey: ['agents', 'counts'],
    queryFn: () => api.get<AgentCounts>('/agents/counts'),
    enabled,
    staleTime: 60_000,
  })

export const useRailCounts = (role: Role | undefined): RailCounts => {
  const isCustomer = role === 'customer'
  const isAgent = role === 'agent'
  const isAdmin = role === 'admin'

  /**
   * `enabled` on each query rather than a branch around the hooks: a hook
   * cannot be called conditionally, and a customer must not be firing the
   * admin's reconciliation query just to render their own rail.
   */
  const parcels = useParcels({ enabled: isCustomer })
  const deliveries = useDeliveries(undefined, { enabled: isAgent || isAdmin })
  const cod = useCodReconciliation({ enabled: isAdmin })
  const agents = useAgentCounts(isAdmin)

  if (isCustomer) {
    const rows = parcels.data ?? null
    return {
      active: rows ? rows.filter((p) => ACTIVE.includes(p.status)).length : null,
      finished: null,
      codRiders: null,
      pendingRiders: null,
    }
  }

  if (isAgent) {
    const rows = deliveries.data ?? null
    return {
      active: rows ? rows.filter((d) => ACTIVE.includes(d.status)).length : null,
      finished: rows ? rows.filter((d) => !ACTIVE.includes(d.status)).length : null,
      codRiders: null,
      pendingRiders: null,
    }
  }

  if (isAdmin) {
    const rows = deliveries.data ?? null
    return {
      active: rows ? rows.filter((d) => ACTIVE.includes(d.status)).length : null,
      finished: null,
      codRiders: cod.data
        ? cod.data.rows.filter((r) => r.outstanding > 0).length
        : null,
      pendingRiders: agents.data?.pendingApproval ?? null,
    }
  }

  return { active: null, finished: null, codRiders: null, pendingRiders: null }
}
