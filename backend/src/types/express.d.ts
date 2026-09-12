import type {
  AuthContext,
  VerifiedIdentityContext,
} from '../auth/auth.types.js'

declare global {
  namespace Express {
    interface Request {
      auth?: Readonly<AuthContext>
      verifiedIdentity?: Readonly<VerifiedIdentityContext>
    }
  }
}

export {}
