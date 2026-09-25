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
    key: 'categories',
    label: 'Categories',
    path: ROUTES.categories,
    icon: 'categories',
    roles: tenantRoles,
  }),
  Object.freeze({
    key: 'inventory',
    label: 'Inventory',
    path: ROUTES.inventory,
    icon: 'inventory',
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
  return pathname === itemPath
}

export function resolveAppRoute(pathname, role) {
  const navigation = getAppNavigation(role)
  const route = navigation.find((item) => item.path === pathname)

  if (route) {
    return Object.freeze({ route, redirectTo: null })
  }

  return Object.freeze({ route: dashboardRoute, redirectTo: dashboardRoute.path })
}
