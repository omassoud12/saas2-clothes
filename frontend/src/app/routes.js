export const ROUTES = Object.freeze({
  home: '/',
  about: '/about',
  contact: '/contact',
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
  textMatchingLab: '/app/dev/text-matching',
})

export function normalizePathname(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return ROUTES.home
  return pathname.replace(/\/+$/u, '') || ROUTES.home
}

// The public marketing site (landing, about, contact): no sign-in needed.
export const SITE_PATHS = Object.freeze([ROUTES.home, ROUTES.about, ROUTES.contact])

export function isSitePath(pathname) {
  return SITE_PATHS.includes(normalizePathname(pathname))
}

export function isBusinessPath(pathname) {
  const normalized = normalizePathname(pathname)
  return normalized === ROUTES.app || normalized.startsWith(`${ROUTES.app}/`)
}
