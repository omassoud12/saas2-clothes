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
