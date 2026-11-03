// The Supabase Auth admin calls the employee features need, behind a small interface (tests use a fake).
//
// The service-role key is read ONLY here, by its own optional loader: the ordinary runtime environment
// (config/env.ts loadEnvironment) still never holds it. When SUPABASE_SERVICE_ROLE_KEY or APP_URL is not
// configured, the employee mail/password actions answer 503 and everything else keeps working.
// The key never leaves the server.
import { createClient } from '@supabase/supabase-js'
import { HttpError } from '../errors/http-error.js'
import { createTimeoutFetch } from '../supabase.js'

export interface AuthAdmin {
  /** Sends Supabase's invite mail. Returns the new auth user id. Throws AuthAdminError('USER_EXISTS'). */
  inviteUser(email: string, redirectTo: string, data: Record<string, string>): Promise<{ userId: string }>
  /** Sends Supabase's password recovery mail (also used to resend an invite to an existing auth user). */
  sendPasswordEmail(email: string, redirectTo: string): Promise<void>
  /** Sets a password (and confirms the email, which the invite mail proved). */
  setPassword(userId: string, password: string): Promise<void>
  /** Bans the auth user (refresh tokens stop working) or lifts the ban. */
  setBanned(userId: string, banned: boolean): Promise<void>
  lastSignIn(userId: string): Promise<string | null>
  deleteUser(userId: string): Promise<void>
}

export class AuthAdminError extends Error {
  constructor(readonly code: 'USER_EXISTS' | 'PROVIDER_ERROR', message: string) {
    super(message)
    this.name = 'AuthAdminError'
  }
}

export interface AuthAdminEnvironment {
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly appUrl: string
}

/** null when the employee admin features are not configured. */
export function loadAuthAdminEnvironment(environment: NodeJS.ProcessEnv = process.env): AuthAdminEnvironment | null {
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const appUrl = environment.APP_URL?.trim()
  const supabaseUrl = environment.SUPABASE_URL?.trim()
  if (!key || !appUrl || !supabaseUrl) return null
  if (key.length > 8_192 || /\s|[\u0000-\u001f\u007f]/u.test(key)) throw new Error('SUPABASE_SERVICE_ROLE_KEY configuration is invalid')
  let url: URL
  try { url = new URL(appUrl) } catch { throw new Error('APP_URL configuration is invalid') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && environment.NODE_ENV !== 'production')) throw new Error('APP_URL configuration is invalid')
  if (url.search || url.hash || url.username || url.password) throw new Error('APP_URL configuration is invalid')
  return Object.freeze({ supabaseUrl, serviceRoleKey: key, appUrl: url.origin + url.pathname.replace(/\/+$/u, '') })
}

export function requireAdmin(admin: AuthAdmin | null): AuthAdmin {
  if (!admin) throw new HttpError(503, 'EMPLOYEE_ADMIN_UNAVAILABLE', 'Inviting and password actions are not configured on this server')
  return admin
}

function failure(error: { message?: string; code?: string; status?: number } | null): never {
  const message = error?.message ?? ''
  if (error?.code === 'email_exists' || error?.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(message)) {
    throw new AuthAdminError('USER_EXISTS', 'This email already has an account')
  }
  throw new AuthAdminError('PROVIDER_ERROR', 'The sign-in provider did not accept the request')
}

export function createSupabaseAuthAdmin(environment: AuthAdminEnvironment): AuthAdmin {
  const client = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createTimeoutFetch(10_000) },
  })
  return {
    async inviteUser(email, redirectTo, data) {
      const result = await client.auth.admin.inviteUserByEmail(email, { redirectTo, data })
      if (result.error || !result.data.user) failure(result.error)
      return { userId: result.data.user.id }
    },
    async sendPasswordEmail(email, redirectTo) {
      const result = await client.auth.resetPasswordForEmail(email, { redirectTo })
      if (result.error) failure(result.error)
    },
    async setPassword(userId, password) {
      const result = await client.auth.admin.updateUserById(userId, { password, email_confirm: true })
      if (result.error) failure(result.error)
    },
    async setBanned(userId, banned) {
      // ~100 years, or lift it.
      const result = await client.auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' })
      if (result.error) failure(result.error)
    },
    async lastSignIn(userId) {
      const result = await client.auth.admin.getUserById(userId)
      if (result.error) return null
      return result.data.user?.last_sign_in_at ?? null
    },
    async deleteUser(userId) {
      const result = await client.auth.admin.deleteUser(userId)
      if (result.error) failure(result.error)
    },
  }
}
