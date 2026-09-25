export const ROUTES = Object.freeze({
  home: '/',
  login: '/login',
  signup: '/signup',
  authCallback: '/auth/callback',
  signupCallback: '/auth/signup-callback',
  setPassword: '/set-password',
  ownerOnboarding: '/owner/onboarding',
  pendingApproval: '/pending-approval',
  inactiveAccount: '/account-inactive',
  admin: '/admin',
  app: '/app',
  dashboard: '/app/dashboard',
  products: '/app/products',
  categories: '/app/categories',
  inventory: '/app/inventory',
  sales: '/app/sales',
  returns: '/app/returns',
  exchanges: '/app/exchanges',
  expenses: '/app/expenses',
  reports: '/app/reports',
})

export function normalizePathname(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return ROUTES.home
  return pathname.replace(/\/+$/u, '') || ROUTES.home
}

export function isBusinessPath(pathname) {
  const normalized = normalizePathname(pathname)
  return normalized === ROUTES.app || normalized.startsWith(`${ROUTES.app}/`)
}
