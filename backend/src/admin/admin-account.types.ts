import type { AccountStatus } from '../generated/prisma/enums.js'

export interface PendingAccountReview {
  readonly account: {
    readonly id: string
    readonly name: string
    readonly baseCurrency: string
    readonly status: AccountStatus
    readonly createdAt: Date
  }
  readonly owner: {
    readonly id: string
    readonly email: string
    readonly firstName: string
    readonly lastName: string
  }
}

export interface ReviewedAccount {
  readonly id: string
  readonly status: AccountStatus
  readonly reviewedAt: Date | null
  readonly reviewedById: string | null
  readonly rejectionReason: string | null
}

export interface AdminAccountDependencies {
  listPendingAccounts(): Promise<readonly PendingAccountReview[]>
  approveAccount(
    accountId: string,
    reviewerId: string,
  ): Promise<ReviewedAccount>
  rejectAccount(
    accountId: string,
    reviewerId: string,
    reason: string,
  ): Promise<ReviewedAccount>
  suspendAccount(accountId: string): Promise<ReviewedAccount>
}
