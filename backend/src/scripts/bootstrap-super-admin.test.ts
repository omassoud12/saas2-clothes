import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { UserRole } from '../generated/prisma/enums.js'
import {
  bootstrapSuperAdmin,
  parseSuperAdminBootstrapInput,
  SuperAdminBootstrapError,
  type SuperAdminBootstrapDependencies,
  type SuperAdminBootstrapInput,
} from './super-admin-bootstrap.js'

const authUserId = '11111111-1111-4111-8111-111111111111'
const input: SuperAdminBootstrapInput = Object.freeze({
  email: 'admin@example.com',
  firstName: 'Platform',
  lastName: 'Admin',
  inviteRedirectUrl: 'http://localhost:5173/auth/callback',
})

type ApplicationUser = Awaited<
  ReturnType<SuperAdminBootstrapDependencies['findExistingSuperAdmin']>
>

function applicationUser(
  role: UserRole,
  overrides: Partial<NonNullable<ApplicationUser>> = {},
): NonNullable<ApplicationUser> {
  return {
    id: authUserId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    role,
    accountId: role === UserRole.SUPER_ADMIN ? null : 'account-1',
    employeeCode: role === UserRole.WAREHOUSE ? 'WH-1' : null,
    isActive: true,
    ...overrides,
  }
}

class DependenciesDouble implements SuperAdminBootstrapDependencies {
  existingSuperAdmin: NonNullable<ApplicationUser> | null = null
  emailUser: NonNullable<ApplicationUser> | null = null
  inviteFailed = false
  inviteThrows = false
  createFails = false
  compensationFails = false
  compensationThrows = false
  authLookupFailed = false
  invitedCount = 0
  invitedRedirectUrl: string | undefined
  createdCount = 0
  deletedIds: string[] = []
  createdInput:
    | {
        id: string
        email: string
        firstName: string
        lastName: string
        role: typeof UserRole.SUPER_ADMIN
        accountId: null
        employeeCode: null
        isActive: true
      }
    | undefined

  async findExistingSuperAdmin() {
    return this.existingSuperAdmin
  }

  async findApplicationUserByEmail() {
    return this.emailUser
  }

  async findAuthUserById(userId: string) {
    return {
      user: this.authLookupFailed ? null : { id: userId, email: input.email },
      failed: this.authLookupFailed,
    }
  }

  async inviteAuthUser(_email: string, redirectTo: string) {
    this.invitedCount += 1
    this.invitedRedirectUrl = redirectTo
    if (this.inviteThrows) throw new Error('secret transport detail')
    return {
      user: this.inviteFailed ? null : { id: authUserId, email: input.email },
      failed: this.inviteFailed,
    }
  }

  async deleteAuthUser(userId: string) {
    this.deletedIds.push(userId)
    if (this.compensationThrows) throw new Error('secret deletion detail')
    return { failed: this.compensationFails }
  }

  async createApplicationSuperAdmin(createdInput: typeof this.createdInput) {
    this.createdCount += 1
    this.createdInput = createdInput
    if (this.createFails) throw new Error('secret database detail')
    assert.ok(createdInput)
    const createdUser = applicationUser(UserRole.SUPER_ADMIN, createdInput)
    this.existingSuperAdmin = createdUser
    this.emailUser = createdUser
    return createdUser
  }
}

async function expectBootstrapError(
  promise: Promise<unknown>,
  code: string,
): Promise<SuperAdminBootstrapError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof SuperAdminBootstrapError)
    assert.equal(error.code, code)
    assert.doesNotMatch(error.message, /secret/i)
    return error
  }

  assert.fail(`Expected ${code}`)
}

describe('SUPER_ADMIN CLI input', () => {
  test('normalizes CLI input', () => {
    assert.deepEqual(
      parseSuperAdminBootstrapInput(
        [
          '--email',
          ' ADMIN@Example.COM ',
          '--first-name= Platform ',
          '--last-name',
          ' Admin ',
        ],
        {
          SUPER_ADMIN_INVITE_REDIRECT_URL:
            'http://localhost:5173/auth/callback',
        },
      ),
      input,
    )
  })

  test('accepts the three dedicated environment variables', () => {
    assert.deepEqual(
      parseSuperAdminBootstrapInput([], {
        SUPER_ADMIN_EMAIL: ' ADMIN@EXAMPLE.COM ',
        SUPER_ADMIN_FIRST_NAME: ' Platform ',
        SUPER_ADMIN_LAST_NAME: ' Admin ',
        SUPER_ADMIN_INVITE_REDIRECT_URL:
          'http://localhost:5173/auth/callback',
      }),
      input,
    )
  })

  test('rejects an unsafe invitation redirect URL', () => {
    assert.throws(
      () =>
        parseSuperAdminBootstrapInput([], {
          SUPER_ADMIN_EMAIL: 'admin@example.com',
          SUPER_ADMIN_FIRST_NAME: 'Platform',
          SUPER_ADMIN_LAST_NAME: 'Admin',
          SUPER_ADMIN_INVITE_REDIRECT_URL: 'http://example.com/auth/callback',
        }),
      SuperAdminBootstrapError,
    )
  })

  for (const [name, arguments_] of [
    ['invalid email', ['--email=not-an-email', '--first-name=A', '--last-name=B']],
    ['blank firstName', ['--email=a@example.com', '--first-name= ', '--last-name=B']],
    ['blank lastName', ['--email=a@example.com', '--first-name=A', '--last-name= ']],
  ] as const) {
    test(`rejects ${name}`, () => {
      assert.throws(
        () => parseSuperAdminBootstrapInput(arguments_, {}),
        SuperAdminBootstrapError,
      )
    })
  }

  for (const forbiddenOption of [
    'role',
    'accountId',
    'isActive',
    'employeeCode',
    'userId',
  ]) {
    test(`rejects forbidden option ${forbiddenOption}`, () => {
      assert.throws(
        () =>
          parseSuperAdminBootstrapInput(
            [
              '--email=a@example.com',
              '--first-name=A',
              '--last-name=B',
              `--${forbiddenOption}=attacker-controlled`,
            ],
            {},
          ),
        SuperAdminBootstrapError,
      )
    })
  }
})

describe('SUPER_ADMIN provisioning', () => {
  test('stops when a different SUPER_ADMIN exists', async () => {
    const dependencies = new DependenciesDouble()
    dependencies.existingSuperAdmin = applicationUser(UserRole.SUPER_ADMIN, {
      email: 'other@example.com',
    })

    await expectBootstrapError(
      bootstrapSuperAdmin(dependencies, input),
      'SUPER_ADMIN_ALREADY_EXISTS',
    )
    assert.equal(dependencies.invitedCount, 0)
  })

  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    test(`stops when the email belongs to ${role}`, async () => {
      const dependencies = new DependenciesDouble()
      dependencies.emailUser = applicationUser(role)

      await expectBootstrapError(
        bootstrapSuperAdmin(dependencies, input),
        'EMAIL_ALREADY_PROVISIONED',
      )
      assert.equal(dependencies.invitedCount, 0)
    })
  }

  test('reports a definite Supabase invitation failure safely', async () => {
    const dependencies = new DependenciesDouble()
    dependencies.inviteFailed = true

    await expectBootstrapError(
      bootstrapSuperAdmin(dependencies, input),
      'AUTH_INVITATION_FAILED',
    )
    assert.equal(dependencies.createdCount, 0)
    assert.deepEqual(dependencies.deletedIds, [])
  })

  test('reports an ambiguous thrown Auth outcome without creating a User', async () => {
    const dependencies = new DependenciesDouble()
    dependencies.inviteThrows = true

    await expectBootstrapError(
      bootstrapSuperAdmin(dependencies, input),
      'AUTH_OUTCOME_AMBIGUOUS',
    )
    assert.equal(dependencies.createdCount, 0)
    assert.deepEqual(dependencies.deletedIds, [])
  })

  test('compensates a newly invited Auth user after Prisma failure', async () => {
    const dependencies = new DependenciesDouble()
    dependencies.createFails = true

    const error = await expectBootstrapError(
      bootstrapSuperAdmin(dependencies, input),
      'APPLICATION_USER_CREATION_FAILED',
    )
    assert.equal(error.compensation, 'SUCCEEDED')
    assert.deepEqual(dependencies.deletedIds, [authUserId])
  })

  for (const failureMode of ['returned', 'thrown'] as const) {
    test(`reports ${failureMode} compensation failure safely`, async () => {
      const dependencies = new DependenciesDouble()
      dependencies.createFails = true
      dependencies.compensationFails = failureMode === 'returned'
      dependencies.compensationThrows = failureMode === 'thrown'

      const error = await expectBootstrapError(
        bootstrapSuperAdmin(dependencies, input),
        'APPLICATION_USER_CREATION_FAILED',
      )
      assert.equal(error.compensation, 'FAILED')
      assert.deepEqual(dependencies.deletedIds, [authUserId])
    })
  }

  test('creates the fixed application SUPER_ADMIN fields', async () => {
    const dependencies = new DependenciesDouble()

    const result = await bootstrapSuperAdmin(dependencies, input)

    assert.deepEqual(result, { created: true, userId: authUserId })
    assert.equal(dependencies.invitedCount, 1)
    assert.equal(dependencies.invitedRedirectUrl, input.inviteRedirectUrl)
    assert.equal(dependencies.createdCount, 1)
    assert.deepEqual(dependencies.createdInput, {
      id: authUserId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: UserRole.SUPER_ADMIN,
      accountId: null,
      employeeCode: null,
      isActive: true,
    })
    assert.equal(dependencies.createdInput.role, UserRole.SUPER_ADMIN)
    assert.equal(dependencies.createdInput.accountId, null)
    assert.equal(dependencies.createdInput.employeeCode, null)
    assert.equal(dependencies.createdInput.isActive, true)
  })

  test('does not duplicate an exact Auth/application identity on rerun', async () => {
    const dependencies = new DependenciesDouble()

    const first = await bootstrapSuperAdmin(dependencies, input)
    const rerun = await bootstrapSuperAdmin(dependencies, input)

    assert.deepEqual(first, { created: true, userId: authUserId })
    assert.deepEqual(rerun, { created: false, userId: authUserId })
    assert.equal(dependencies.invitedCount, 1)
    assert.equal(dependencies.createdCount, 1)
  })

  test('requires reconciliation when an existing administrator cannot be verified', async () => {
    const dependencies = new DependenciesDouble()
    dependencies.existingSuperAdmin = applicationUser(UserRole.SUPER_ADMIN)
    dependencies.authLookupFailed = true

    await expectBootstrapError(
      bootstrapSuperAdmin(dependencies, input),
      'RECONCILIATION_REQUIRED',
    )
    assert.equal(dependencies.invitedCount, 0)
  })
})
