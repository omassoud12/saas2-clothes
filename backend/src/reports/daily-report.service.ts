import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { computeDailyFinancialsInTransaction, parseReportDate } from './financial.service.js'
import type { DailyFinancials, DailyReportService, RebuiltDailyReport } from './financial.types.js'
import { FinancialComputationError } from './financial.types.js'

function persistenceData(day: DailyFinancials, computedAt: Date) {
  return {
    currency: day.currency,
    salesCount: day.salesCount,
    totalUnitsSold: day.totalUnitsSold,
    grossRevenue: day.grossRevenue,
    returnedRevenue: day.returnedRevenue,
    voidedRevenue: day.voidedRevenue,
    netRevenue: day.netRevenue,
    grossCOGS: day.grossCOGS,
    returnedCOGS: day.returnedCOGS,
    voidedCOGS: day.voidedCOGS,
    netCOGS: day.netCOGS,
    grossProfit: day.grossProfit,
    operatingExpenses: day.operatingExpenses,
    netProfit: day.netProfit,
    stockValue: null,
    computedAt,
  }
}

export function createDailyReportService(prisma: PrismaClient): DailyReportService {
  async function rebuildDailyReport(accountId: string, reportDate: string): Promise<RebuiltDailyReport> {
    const date = parseReportDate(reportDate)
    try {
      return await prisma.$transaction(async (transaction) => {
        const accounts = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
        )
        if (!accounts[0]) {
          throw new FinancialComputationError('FINANCIAL_ACCOUNT_NOT_FOUND', 'Financial Account is unavailable')
        }
        const day = await computeDailyFinancialsInTransaction(transaction, accountId, reportDate)
        const computedAt = new Date()
        await transaction.dailyReport.upsert({
          where: { accountId_reportDate: { accountId, reportDate: date } },
          create: { accountId, reportDate: date, ...persistenceData(day, computedAt) },
          update: persistenceData(day, computedAt),
          select: { id: true },
        })
        return { ...day, computedAt }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    } catch (error) {
      if (error instanceof FinancialComputationError) throw error
      throw new FinancialComputationError('FINANCIAL_REBUILD_FAILED', 'Daily financial report could not be rebuilt')
    }
  }

  return { rebuildDailyReport }
}
