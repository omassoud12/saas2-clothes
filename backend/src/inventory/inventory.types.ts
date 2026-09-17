import type { InventoryMovementType, UserRole } from '../generated/prisma/enums.js'

export interface HistoryQuery {
  readonly productId?: string
  readonly variantId?: string
  readonly type?: InventoryMovementType
  readonly from?: Date
  readonly to?: Date
  readonly cursor?: { readonly createdAt: Date; readonly id: string }
  readonly limit: number
}

export interface ReconciliationQuery {
  readonly productId?: string
  readonly variantId?: string
  readonly status?: 'RECONCILED' | 'MISMATCH'
  readonly cursor?: string
  readonly limit: number
}

export interface MovementView {
  readonly id: string
  readonly type: InventoryMovementType
  readonly quantityChange: number
  readonly createdAt: Date
  readonly variant: { readonly id: string; readonly sku: string; readonly color: string | null; readonly size: string | null }
  readonly product: { readonly id: string; readonly name: string }
  readonly performer: { readonly name: string; readonly employeeCode: string | null }
  readonly unitCost?: string | null
  readonly note?: string | null
}

export interface ReconciliationView {
  readonly variant: {
    readonly id: string; readonly sku: string; readonly color: string | null; readonly size: string | null
    readonly product: { readonly id: string; readonly name: string }
  }
  readonly storedStock: number
  readonly ledgerStock: number
  readonly difference: number
  readonly status: 'RECONCILED' | 'MISMATCH'
}

export interface InventoryAuditDependencies {
  listMovements(accountId: string, role: UserRole, query: HistoryQuery): Promise<{ movements: readonly MovementView[]; nextCursor: string | null }>
  reconcile(accountId: string, query: ReconciliationQuery): Promise<{ variants: readonly ReconciliationView[]; nextCursor: string | null }>
}
