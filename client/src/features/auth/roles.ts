import type { Role } from '@pdms/shared'

/**
 * Where each role lands after signing in. Kept in one place so the login
 * redirect, the route guard and the post-logout bounce cannot disagree.
 */
const HOME: Record<Role, string> = {
  customer: '/',
  agent: '/agent',
  admin: '/admin',
}

export const homeForRole = (role: Role): string => HOME[role]
