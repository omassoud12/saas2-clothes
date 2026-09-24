import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { encodeExchangeCursor } from './exchange.history.schemas.js'
import { persistedExchangeSelect, serializeExchangeDetail } from './exchange.service.js'
import type { ExchangeHistoryItem, ExchangeHistoryQuery, ExchangeView } from './exchange.types.js'

const historySelect = {
  id: true,
  createdAt: true,
  returnId: true,
  newSaleId: true,
  saleReturn: {
    select: {
      saleId: true,
      processedByName: true,
      processedByCode: true,
      sale: { select: { currency: true } },
    },
  },
  newSale: { select: { totalAmount: true } },
} as const

type HistoryRow = Prisma.ExchangeGetPayload<{ select: typeof historySelect }>

export interface ExchangeHistoryDependencies {
  listExchanges(
    accountId: string,
    query: ExchangeHistoryQuery,
  ): Promise<{ exchanges: readonly ExchangeHistoryItem[]; nextCursor: string | null }>
  getExchange(accountId: string, exchangeId: string): Promise<{ exchange: ExchangeView['exchange'] }>
}

export function createExchangeHistoryDependencies(prisma: PrismaClient): ExchangeHistoryDependencies {
  async function listExchanges(accountId: string, query: ExchangeHistoryQuery) {
    try {
      const where: Prisma.ExchangeWhereInput = {
        accountId,
        ...(query.from || query.to ? { createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        } } : {}),
        ...(query.cursor ? { OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ] } : {}),
      }
      const rows = await prisma.exchange.findMany({
        where,
        select: historySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const page = rows.slice(0, query.limit)
      const totals = page.length ? await prisma.saleReturnItem.groupBy({
        by: ['returnId'],
        where: { accountId, returnId: { in: page.map((row) => row.returnId) } },
        _sum: { refundAmount: true },
      }) : []
      const refundByReturn = new Map(totals.map((row) => [row.returnId, row._sum.refundAmount ?? new Prisma.Decimal(0)]))
      const exchanges = page.map((row: HistoryRow): ExchangeHistoryItem => {
        const totalRefund = refundByReturn.get(row.returnId) ?? new Prisma.Decimal(0)
        return {
          id: row.id,
          createdAt: row.createdAt,
          originalSaleId: row.saleReturn.saleId,
          replacementSaleId: row.newSaleId,
          currency: row.saleReturn.sale.currency,
          totalRefund: totalRefund.toFixed(2),
          replacementTotal: row.newSale.totalAmount.toFixed(2),
          differenceAmount: row.newSale.totalAmount.sub(totalRefund).toFixed(2),
          processor: { name: row.saleReturn.processedByName, employeeCode: row.saleReturn.processedByCode },
        }
      })
      const last = page.at(-1)
      return {
        exchanges,
        nextCursor: rows.length > query.limit && last ? encodeExchangeCursor(last.createdAt, last.id) : null,
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'EXCHANGE_HISTORY_UNAVAILABLE', 'Exchange history is temporarily unavailable')
    }
  }

  async function getExchange(accountId: string, exchangeId: string) {
    try {
      const row = await prisma.exchange.findUnique({
        where: { id_accountId: { id: exchangeId, accountId } },
        select: persistedExchangeSelect,
      })
      if (!row) throw new HttpError(404, 'EXCHANGE_NOT_FOUND', 'Exchange does not exist')
      return { exchange: serializeExchangeDetail(row) }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'EXCHANGE_HISTORY_UNAVAILABLE', 'Exchange history is temporarily unavailable')
    }
  }

  return { listExchanges, getExchange }
}
