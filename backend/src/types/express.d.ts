import type {
  AuthContext,
  TenantAccount,
  VerifiedIdentityContext,
} from '../auth/auth.types.js'

declare global {
  namespace Express {
    interface Request {
      auth?: Readonly<AuthContext>
      verifiedIdentity?: Readonly<VerifiedIdentityContext>
      /** The member's Account, loaded with the User in the same query (null: no Account). */
      tenantAccount?: Readonly<TenantAccount> | null
      requestId?: string
    }
  }
}

export {}
