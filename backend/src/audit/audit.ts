// Audit log: who did what, when, with the values before and after. Always written inside the same
// transaction as the change, so a change is never saved without its audit row (and the other way round).
import { Prisma } from '../generated/prisma/client.js'

export interface AuditEntry {
  readonly accountId: string
  readonly actorId: string
  readonly action: string
  readonly targetType: string
  readonly targetId?: string | null
  readonly before?: unknown
  readonly after?: unknown
  readonly ip?: string | null
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull
  // Decimals, dates and sets become plain JSON values.
  return JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Set ? [...item] : item))) as Prisma.InputJsonValue
}

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      accountId: entry.accountId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      ip: entry.ip ? entry.ip.slice(0, 64) : null,
    },
  })
}
