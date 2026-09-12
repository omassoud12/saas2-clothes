import type {
  AccountStatus,
  UserRole,
} from '../generated/prisma/enums.js'

export interface AuthContext {
  readonly userId: string
  readonly role: UserRole
  readonly accountId: string | null
  readonly accountStatus?: AccountStatus
}

export interface VerifiedAuthIdentity {
  readonly id: string
  readonly email: string | null
  readonly emailConfirmedAt: string | null
  readonly isAnonymous: boolean
}

export interface ApplicationIdentity {
  readonly id: string
  readonly role: UserRole
  readonly accountId: string | null
  readonly isActive: boolean
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
    readonly rejectionReason: string | null
  } | null
}

export interface AuthDependencies {
  verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity | null>
  findApplicationUser(userId: string): Promise<ApplicationIdentity | null>
  findAccountById(accountId: string): Promise<TenantAccount | null>
  findCurrentUser(userId: string): Promise<CurrentUserProfile | null>
}
