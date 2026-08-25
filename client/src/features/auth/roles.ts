import type { Role } from '@pdms/shared'

/**
 * Where each role lands after signing in, and where a role-mismatched URL
 * sends you. One place, so the login redirect, the route guard, the rail's
 * wordmark and the post-logout bounce cannot disagree.
 *
 * v3 moved every authenticated route under its role, so the URL always states
 * who you are. These are the first item of each role's rail.
 */
const HOME: Record<Role, string> = {
  customer: '/customer/parcels',
  agent: '/agent/runs',
  admin: '/admin/board',
}

export const homeForRole = (role: Role): string => HOME[role]
