import { ROUTES } from './routes.js'

export const LANDING_ROUTE_CONTRACT = Object.freeze({
  path: ROUTES.home,
  requiresAuthentication: false,
  businessApiRequests: Object.freeze([]),
})

export const LANDING_CTA_ROUTES = Object.freeze({
  createAccount: ROUTES.signup,
  login: ROUTES.login,
})

export function isLandingRoute(pathname) {
  return pathname === ROUTES.home
}

// A signed-in user who opens the landing page goes straight to the app.
export function landingRedirectFor(session) {
  return session?.user?.id && typeof session.access_token === 'string' && session.access_token ? ROUTES.app : null
}

export async function findLandingRedirect(supabase) {
  if (!supabase) return null
  try {
    const result = await supabase.auth.getSession()
    return result.error ? null : landingRedirectFor(result.data?.session)
  } catch {
    return null
  }
}
