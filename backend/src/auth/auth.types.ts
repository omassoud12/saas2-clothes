import type {
  AccountStatus,
  UserRole,
} from '../generated/prisma/enums.js'
import type { Permission } from '../access/permissions.js'

export interface AuthContext {
  readonly userId: string
  readonly role: UserRole
  readonly accountId: string | null
  readonly accountStatus?: AccountStatus
  /** Pages and capabilities (src/access/permissions.ts); absent only in old test doubles. */
  readonly permissions?: ReadonlySet<Permission>
  readonly employeeRole?: string | null
  readonly mustChangePassword?: boolean
}

export interface VerifiedAuthIdentity {
  readonly id: string
  readonly email: string | null
  readonly emailConfirmedAt: string | null
  readonly isAnonymous: boolean
}

export interface VerifiedIdentityContext {
  readonly authUserId: string
  readonly verifiedEmail: string
}

export type SupportedCurrency = 'USD' | 'LBP'

export interface OwnerBootstrapInput {
  readonly firstName: string
  readonly lastName: string
  readonly accountName: string
  readonly baseCurrency: SupportedCurrency
  readonly employeeCode: string | null
}

export interface OwnerBootstrapData {
  readonly user: {
    readonly id: string
    readonly email: string
    readonly firstName: string
    readonly lastName: string
    readonly role: UserRole
    readonly employeeCode: string | null
  }
  readonly account: {
    readonly id: string
    readonly name: string
    readonly status: AccountStatus
    readonly baseCurrency: string
  }
}

export interface OwnerBootstrapResult {
  readonly created: boolean
  readonly data: OwnerBootstrapData
}

export interface ApplicationIdentity {
  readonly id: string
  readonly role: UserRole
  readonly accountId: string | null
  readonly isActive: boolean
  // Owner Dashboard access fields (optional so older test doubles keep working).
  readonly status?: 'INVITED' | 'ACTIVE' | 'DEACTIVATED'
  readonly employeeRole?: string | null
  readonly permissions?: readonly string[]
  readonly permissionsCustom?: boolean
  readonly mustChangePassword?: boolean
}

export interface TenantAccount {
  readonly id: string
  readonly status: AccountStatus
}

export interface CurrentUserProfile {
  readonly id: string
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly role: UserRole
  readonly employeeCode: string | null
  readonly isActive: boolean
  readonly account: {
    readonly id: string
    readonly name: string
    readonly status: AccountStatus
    readonly baseCurrency: string
    readonly rejectionReason: string | null
  } | null
}

export interface AuthDependencies {
  verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity | null>
  findApplicationUser(userId: string): Promise<ApplicationIdentity | null>
  findAccountById(accountId: string): Promise<TenantAccount | null>
  findCurrentUser(userId: string): Promise<CurrentUserProfile | null>
  bootstrapOwner(
    identity: VerifiedIdentityContext,
    input: OwnerBootstrapInput,
  ): Promise<OwnerBootstrapResult>
}
