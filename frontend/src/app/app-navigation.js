import { ROUTES } from './routes.js'

const ownerRoles = Object.freeze(['OWNER'])
const tenantRoles = Object.freeze(['OWNER', 'WAREHOUSE'])

export const APP_NAVIGATION = Object.freeze([
  Object.freeze({
    key: 'dashboard',
    label: 'Dashboard',
    path: ROUTES.dashboard,
    icon: 'dashboard',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'products',
    label: 'Products',
    path: ROUTES.products,
    icon: 'products',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'inventory',
    label: 'Entry',
    path: ROUTES.inventory,
    icon: 'entry',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'categories',
    label: 'Categories',
    path: ROUTES.categories,
    icon: 'categories',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'sales',
    label: 'Sales / POS',
    path: ROUTES.sales,
    icon: 'sales',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'returns',
    label: 'Returns',
    path: ROUTES.returns,
    icon: 'returns',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'exchanges',
    label: 'Exchanges',
    path: ROUTES.exchanges,
    icon: 'exchanges',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'expenses',
    label: 'Expenses',
    path: ROUTES.expenses,
    icon: 'expenses',
    roles: ownerRoles,
  }),
  Object.freeze({
    key: 'reports',
    label: 'Reports',
    path: ROUTES.reports,
    icon: 'reports',
    roles: ownerRoles,
  }),
])

const dashboardRoute = APP_NAVIGATION[0]

export function getAppNavigation(role) {
  return APP_NAVIGATION.filter((item) => item.roles.includes(role))
}

export function isNavigationItemActive(pathname, itemPath) {
  return pathname === itemPath || (itemPath === ROUTES.products && /^\/app\/products\/[0-9a-f-]{36}$/i.test(pathname))
}

export function resolveAppRoute(pathname, role) {
  const navigation = getAppNavigation(role)
  const productMatch = /^\/app\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(pathname)
  const route = navigation.find((item) => item.path === pathname || (item.key === 'products' && productMatch))

  if (route) {
    return Object.freeze({ route, redirectTo: null, ...(productMatch ? { productId: productMatch[1].toLowerCase() } : {}) })
  }

  if (pathname === ROUTES.app || APP_NAVIGATION.some((item) => item.path === pathname)) {
    return Object.freeze({ route: dashboardRoute, redirectTo: dashboardRoute.path })
  }

  return Object.freeze({ route: null, redirectTo: null })
}
