import type { AuthContext } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'

/** Internal backend context only; HTTP callers never supply this object. */
export function requireVoiceSaleTenant(context: AuthContext | undefined) {
  if (!context) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
  if (!context.userId || !context.accountId || context.accountStatus !== AccountStatus.ACTIVE
    || (context.role !== UserRole.OWNER && context.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active authorized tenant is required')
  }
  return { accountId: context.accountId, role: context.role }
}
