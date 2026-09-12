import type { AuthContext } from '../auth/auth.types.js'

declare global {
  namespace Express {
    interface Request {
      auth?: Readonly<AuthContext>
    }
  }
}

export {}
