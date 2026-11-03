// Pages and capabilities of a tenant member, and the presets of each role.
//
// The OWNER always has everything. An employee (UserRole.WAREHOUSE in the database) has the preset of
// its employeeRole, or — once the owner changed it — exactly the list stored on the User row.
// The backend enforces these on every tenant route (requirePermission); the frontend only hides what
// the member cannot use (GET /api/me/permissions).
import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import type { AuthContext } from '../auth/auth.types.js'

export const PAGES = [
  'DASHBOARD', 'POS', 'SALES_HISTORY', 'PRODUCTS', 'INVENTORY', 'BUSINESS_REPORTS',
  'EMPLOYEES', 'EXPENSES', 'TARGETS', 'SETTINGS',
] as const
export const CAPABILITIES = ['VIEW_COST_PROFIT', 'EDIT_PRODUCT_COST', 'GIVE_DISCOUNT', 'VOID_SALE'] as const

export type Page = (typeof PAGES)[number]
export type Capability = (typeof CAPABILITIES)[number]
export type Permission = Page | Capability
export type EmployeeRoleName = 'MANAGER' | 'CASHIER' | 'WAREHOUSE'
export type MemberRoleName = 'OWNER' | EmployeeRoleName

export const ALL_PERMISSIONS: readonly Permission[] = [...PAGES, ...CAPABILITIES]
// Only the account owner (the main account) ever has these; they cannot be given to an employee.
export const OWNER_ONLY: ReadonlySet<Permission> = new Set<Permission>(['DASHBOARD'])
const KNOWN = new Set<string>(ALL_PERMISSIONS)

export const ROLE_PRESETS: Readonly<Record<MemberRoleName, readonly Permission[]>> = Object.freeze({
  OWNER: ALL_PERMISSIONS,
  // Every page except Employees and Settings; never sees cost or profit.
  MANAGER: ['POS', 'SALES_HISTORY', 'PRODUCTS', 'INVENTORY', 'BUSINESS_REPORTS', 'EXPENSES', 'TARGETS', 'GIVE_DISCOUNT', 'VOID_SALE'],
  CASHIER: ['POS', 'SALES_HISTORY'],
  // What every employee could do before roles existed (kept for existing WAREHOUSE users).
  WAREHOUSE: ['POS', 'SALES_HISTORY', 'PRODUCTS', 'INVENTORY', 'BUSINESS_REPORTS', 'GIVE_DISCOUNT'],
})

/** For the employee form: pages grouped as the owner sees them. */
export const PERMISSION_GROUPS = Object.freeze([
  { group: 'Selling', permissions: ['POS', 'SALES_HISTORY', 'GIVE_DISCOUNT', 'VOID_SALE'] },
  { group: 'Products & stock', permissions: ['PRODUCTS', 'INVENTORY', 'EDIT_PRODUCT_COST'] },
  { group: 'Reports', permissions: ['BUSINESS_REPORTS', 'VIEW_COST_PROFIT'] },
  { group: 'Management', permissions: ['EMPLOYEES', 'EXPENSES', 'TARGETS', 'SETTINGS'] },
] as const)

export interface MemberAccessFields {
  readonly role: string
  readonly employeeRole?: string | null
  readonly permissions?: readonly string[] | null
  readonly permissionsCustom?: boolean | null
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && KNOWN.has(value)
}

/** Validates a client list: known names only, no duplicates. Returns them in a stable order. */
export function parsePermissionList(value: unknown, field = 'permissions'): Permission[] {
  if (!Array.isArray(value) || value.length > ALL_PERMISSIONS.length) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${field} must be a list of permissions`)
  }
  for (const item of value) {
    if (!isPermission(item)) throw new HttpError(422, 'VALIDATION_ERROR', `${field} contains an unknown permission`)
    if (OWNER_ONLY.has(item)) throw new HttpError(422, 'VALIDATION_ERROR', `${item} is for the owner only`)
  }
  const chosen = new Set(value as Permission[])
  return ALL_PERMISSIONS.filter((permission) => chosen.has(permission))
}

export function presetOf(role: MemberRoleName): readonly Permission[] {
  return ROLE_PRESETS[role]
}

/** The member's role as the API shows it: OWNER, or the employee preset. */
export function memberRoleOf(member: MemberAccessFields): MemberRoleName | null {
  if (member.role === 'OWNER') return 'OWNER'
  if (member.role !== 'WAREHOUSE') return null
  const preset = member.employeeRole
  return preset === 'MANAGER' || preset === 'CASHIER' ? preset : 'WAREHOUSE'
}

/** Everything the member may use. SUPER_ADMIN and unknown roles get nothing (they are not tenant members). */
export function effectivePermissions(member: MemberAccessFields): ReadonlySet<Permission> {
  const role = memberRoleOf(member)
  if (!role) return new Set()
  if (role === 'OWNER') return new Set(ALL_PERMISSIONS)
  if (member.permissionsCustom) return new Set((member.permissions ?? []).filter((item): item is Permission => isPermission(item) && !OWNER_ONLY.has(item)))
  return new Set(ROLE_PRESETS[role])
}

/** The permissions of a request. Test doubles that predate permissions fall back to the role preset. */
export function permissionsOf(auth: AuthContext | undefined): ReadonlySet<Permission> {
  if (!auth) return new Set()
  return auth.permissions ?? effectivePermissions({ role: auth.role })
}

export function hasPermission(auth: AuthContext | undefined, permission: Permission): boolean {
  return permissionsOf(auth).has(permission)
}

export function canViewCost(auth: AuthContext | undefined): boolean {
  return hasPermission(auth, 'VIEW_COST_PROFIT')
}

function requireAccess(test: (permissions: ReadonlySet<Permission>) => boolean): RequestHandler {
  return (request, _response, next) => {
    const auth = request.auth
    if (!auth) {
      next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'))
      return
    }
    if (auth.mustChangePassword) {
      next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue'))
      return
    }
    if (!test(permissionsOf(auth))) {
      next(new HttpError(403, 'PERMISSION_FORBIDDEN', 'You do not have access to this page'))
      return
    }
    next()
  }
}

/** The member must have every one of these. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return requireAccess((permissions) => required.every((permission) => permissions.has(permission)))
}

/** The member must have at least one of these (e.g. the product list serves both Products and POS). */
export function requireAnyPermission(...required: Permission[]): RequestHandler {
  return requireAccess((permissions) => required.some((permission) => permissions.has(permission)))
}
