import type { SupabaseClient } from '@supabase/supabase-js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface SuperAdminBootstrapInput {
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly inviteRedirectUrl: string
}

interface ApplicationUserRecord {
  readonly id: string
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly role: UserRole
  readonly accountId: string | null
  readonly employeeCode: string | null
  readonly isActive: boolean
}

interface AuthUserRecord {
  readonly id: string
  readonly email: string | null
}

interface AuthOperationResult {
  readonly user: AuthUserRecord | null
  readonly failed: boolean
}

interface AuthDeleteResult {
  readonly failed: boolean
}

export interface SuperAdminBootstrapDependencies {
  findExistingSuperAdmin(): Promise<ApplicationUserRecord | null>
  findApplicationUserByEmail(
    email: string,
  ): Promise<ApplicationUserRecord | null>
  findAuthUserById(userId: string): Promise<AuthOperationResult>
  inviteAuthUser(
    email: string,
    redirectTo: string,
  ): Promise<AuthOperationResult>
  deleteAuthUser(userId: string): Promise<AuthDeleteResult>
  createApplicationSuperAdmin(input: {
    readonly id: string
    readonly email: string
    readonly firstName: string
    readonly lastName: string
    readonly role: typeof UserRole.SUPER_ADMIN
    readonly accountId: null
    readonly employeeCode: null
    readonly isActive: true
  }): Promise<ApplicationUserRecord>
}

export type CompensationStatus = 'NOT_REQUIRED' | 'SUCCEEDED' | 'FAILED'

export class SuperAdminBootstrapError extends Error {
  readonly code: string
  readonly compensation: CompensationStatus

  constructor(
    code: string,
    message: string,
    compensation: CompensationStatus = 'NOT_REQUIRED',
  ) {
    super(message)
    this.name = 'SuperAdminBootstrapError'
    this.code = code
    this.compensation = compensation
  }
}

export interface SuperAdminBootstrapResult {
  readonly created: boolean
  readonly userId: string
}

function inputError(message: string): SuperAdminBootstrapError {
  return new SuperAdminBootstrapError('INVALID_INPUT', message)
}

function normalizeName(value: string | undefined, field: string): string {
  if (typeof value !== 'string') {
    throw inputError(`${field} is required`)
  }

  const normalized = value.trim()

  if (!normalized) throw inputError(`${field} must not be blank`)
  if (normalized.length > 100) {
    throw inputError(`${field} must be at most 100 characters`)
  }

  return normalized
}

function normalizeEmail(value: string | undefined): string {
  if (typeof value !== 'string') throw inputError('email is required')

  const normalized = value.trim().toLowerCase()

  if (
    !normalized ||
    normalized.length > 254 ||
    !emailPattern.test(normalized)
  ) {
    throw inputError('email must be a valid email address')
  }

  return normalized
}

function normalizeInviteRedirectUrl(value: string | undefined): string {
  if (typeof value !== 'string') {
    throw inputError('SUPER_ADMIN_INVITE_REDIRECT_URL is required')
  }

  try {
    const url = new URL(value.trim())
    const isLocalHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')

    if (
      (url.protocol !== 'https:' && !isLocalHttp) ||
      url.pathname.replace(/\/+$/, '') !== '/auth/callback' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid redirect URL')
    }

    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    throw inputError(
      'SUPER_ADMIN_INVITE_REDIRECT_URL must be an HTTPS callback URL, or localhost HTTP, ending in /auth/callback',
    )
  }
}

function parseArguments(arguments_: readonly string[]): Map<string, string> {
  const allowedOptions = new Set(['email', 'first-name', 'last-name'])
  const values = new Map<string, string>()

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (!argument.startsWith('--')) {
      throw inputError('Only named CLI options are supported')
    }

    const equalsIndex = argument.indexOf('=')
    const option = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex)

    if (!allowedOptions.has(option)) {
      throw inputError(`Unsupported CLI option: --${option}`)
    }

    if (values.has(option)) {
      throw inputError(`CLI option --${option} may only be provided once`)
    }

    let value: string
    if (equalsIndex !== -1) {
      value = argument.slice(equalsIndex + 1)
    } else {
      const following = arguments_[index + 1]
      if (following === undefined || following.startsWith('--')) {
        throw inputError(`CLI option --${option} requires a value`)
      }
      value = following
      index += 1
    }

    values.set(option, value)
  }

  return values
}

export function parseSuperAdminBootstrapInput(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): SuperAdminBootstrapInput {
  const argumentsByName = parseArguments(arguments_)

  return Object.freeze({
    email: normalizeEmail(
      argumentsByName.get('email') ?? environment.SUPER_ADMIN_EMAIL,
    ),
    firstName: normalizeName(
      argumentsByName.get('first-name') ?? environment.SUPER_ADMIN_FIRST_NAME,
      'firstName',
    ),
    lastName: normalizeName(
      argumentsByName.get('last-name') ?? environment.SUPER_ADMIN_LAST_NAME,
      'lastName',
    ),
    inviteRedirectUrl: normalizeInviteRedirectUrl(
      environment.SUPER_ADMIN_INVITE_REDIRECT_URL,
    ),
  })
}

function isExactApplicationIdentity(
  user: ApplicationUserRecord,
  input: SuperAdminBootstrapInput,
): boolean {
  return (
    user.email.toLowerCase() === input.email &&
    user.firstName === input.firstName &&
    user.lastName === input.lastName &&
    user.role === UserRole.SUPER_ADMIN &&
    user.accountId === null &&
    user.employeeCode === null &&
    user.isActive
  )
}

async function resolveExistingSuperAdmin(
  dependencies: SuperAdminBootstrapDependencies,
  existingUser: ApplicationUserRecord,
  input: SuperAdminBootstrapInput,
): Promise<SuperAdminBootstrapResult> {
  if (!isExactApplicationIdentity(existingUser, input)) {
    throw new SuperAdminBootstrapError(
      'SUPER_ADMIN_ALREADY_EXISTS',
      'A SUPER_ADMIN is already provisioned; no changes were made',
    )
  }

  let authResult: AuthOperationResult
  try {
    authResult = await dependencies.findAuthUserById(existingUser.id)
  } catch {
    throw new SuperAdminBootstrapError(
      'RECONCILIATION_REQUIRED',
      'The existing application administrator could not be verified against Supabase Auth',
    )
  }

  const authEmail = authResult.user?.email?.trim().toLowerCase()
  if (
    authResult.failed ||
    !authResult.user ||
    authResult.user.id !== existingUser.id ||
    authEmail !== input.email
  ) {
    throw new SuperAdminBootstrapError(
      'RECONCILIATION_REQUIRED',
      'The existing application administrator is inconsistent with Supabase Auth',
    )
  }

  return { created: false, userId: existingUser.id }
}

async function compensateAuthIdentity(
  dependencies: SuperAdminBootstrapDependencies,
  userId: string,
): Promise<CompensationStatus> {
  try {
    const result = await dependencies.deleteAuthUser(userId)
    return result.failed ? 'FAILED' : 'SUCCEEDED'
  } catch {
    return 'FAILED'
  }
}

async function failAfterAuthCreation(
  dependencies: SuperAdminBootstrapDependencies,
  userId: string,
  code: string,
  message: string,
): Promise<never> {
  const compensation = await compensateAuthIdentity(dependencies, userId)
  throw new SuperAdminBootstrapError(code, message, compensation)
}

export async function bootstrapSuperAdmin(
  dependencies: SuperAdminBootstrapDependencies,
  input: SuperAdminBootstrapInput,
): Promise<SuperAdminBootstrapResult> {
  const existingSuperAdmin = await dependencies.findExistingSuperAdmin()

  if (existingSuperAdmin) {
    return resolveExistingSuperAdmin(dependencies, existingSuperAdmin, input)
  }

  const applicationUserWithEmail =
    await dependencies.findApplicationUserByEmail(input.email)

  if (applicationUserWithEmail) {
    throw new SuperAdminBootstrapError(
      'EMAIL_ALREADY_PROVISIONED',
      'The supplied email already belongs to an application user; no changes were made',
    )
  }

  let invitation: AuthOperationResult
  try {
    invitation = await dependencies.inviteAuthUser(
      input.email,
      input.inviteRedirectUrl,
    )
  } catch {
    throw new SuperAdminBootstrapError(
      'AUTH_OUTCOME_AMBIGUOUS',
      'The Supabase invitation outcome is unknown; reconciliation is required before retrying',
    )
  }

  if (invitation.failed || !invitation.user) {
    throw new SuperAdminBootstrapError(
      'AUTH_INVITATION_FAILED',
      'Supabase Auth did not create the invitation; no application user was created',
    )
  }

  const invitedUser = invitation.user
  const returnedEmail = invitedUser.email?.trim().toLowerCase()

  if (!uuidPattern.test(invitedUser.id) || returnedEmail !== input.email) {
    return failAfterAuthCreation(
      dependencies,
      invitedUser.id,
      'AUTH_IDENTITY_MISMATCH',
      'Supabase Auth returned an unexpected identity; the application user was not created',
    )
  }

  let createdUser: ApplicationUserRecord
  try {
    createdUser = await dependencies.createApplicationSuperAdmin({
      id: invitedUser.id,
      email: returnedEmail,
      firstName: input.firstName,
      lastName: input.lastName,
      role: UserRole.SUPER_ADMIN,
      accountId: null,
      employeeCode: null,
      isActive: true,
    })
  } catch {
    return failAfterAuthCreation(
      dependencies,
      invitedUser.id,
      'APPLICATION_USER_CREATION_FAILED',
      'Application user creation failed after the Auth invitation',
    )
  }

  if (!isExactApplicationIdentity(createdUser, input)) {
    throw new SuperAdminBootstrapError(
      'RECONCILIATION_REQUIRED',
      'The created application administrator failed an integrity check',
    )
  }

  return { created: true, userId: invitedUser.id }
}

export function createSuperAdminBootstrapDependencies(
  prisma: PrismaClient,
  admin: SupabaseClient,
): SuperAdminBootstrapDependencies {
  const applicationUserSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    accountId: true,
    employeeCode: true,
    isActive: true,
  } as const

  return {
    findExistingSuperAdmin() {
      return prisma.user.findFirst({
        where: { role: UserRole.SUPER_ADMIN },
        select: applicationUserSelect,
      })
    },

    findApplicationUserByEmail(email) {
      return prisma.user.findUnique({
        where: { email },
        select: applicationUserSelect,
      })
    },

    async findAuthUserById(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId)
      return {
        user: data.user
          ? { id: data.user.id, email: data.user.email ?? null }
          : null,
        failed: Boolean(error),
      }
    },

    async inviteAuthUser(email, redirectTo) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      })
      return {
        user: data.user
          ? { id: data.user.id, email: data.user.email ?? null }
          : null,
        failed: Boolean(error),
      }
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      return { failed: Boolean(error) }
    },

    createApplicationSuperAdmin(input) {
      return prisma.user.create({
        data: {
          ...input,
        },
        select: applicationUserSelect,
      })
    },
  }
}
