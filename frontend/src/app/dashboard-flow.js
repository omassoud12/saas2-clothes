import { loadDailyReport } from './finance-flow.js'
import { listProducts } from './product-flow.js'
import { loadSaleHistory } from './sale-flow.js'
import { ROUTES } from './routes.js'

const recentSaleLimit = 6

export function dashboardQuickActions(role) {
  const shared = [
    Object.freeze({ label: 'New sale', description: 'Open the point of sale', path: ROUTES.sales, primary: true }),
    Object.freeze({ label: 'Products', description: 'Review the active catalog', path: ROUTES.products }),
    Object.freeze({ label: 'Inventory', description: 'Check current stock', path: ROUTES.inventory }),
  ]
  if (role === 'WAREHOUSE') return Object.freeze(shared)
  if (role !== 'OWNER') return Object.freeze([])
  return Object.freeze([
    ...shared,
    Object.freeze({ label: 'Add expense', description: 'Record an operating cost', path: ROUTES.expenses }),
    Object.freeze({ label: 'View reports', description: 'Open financial reporting', path: ROUTES.reports }),
  ])
}

export function summarizeDashboardCatalog(products, total) {
  const rows = Array.isArray(products) ? products : []
  let activeVariants = 0
  let unitsOnHand = 0n
  const outOfStock = []

  for (const product of rows) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      if (variant?.isActive !== true || !Number.isInteger(variant.currentStock) || variant.currentStock < 0) continue
      activeVariants += 1
      unitsOnHand += BigInt(variant.currentStock)
      if (variant.currentStock === 0 && outOfStock.length < 5) {
        outOfStock.push(Object.freeze({
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          sku: variant.sku,
          details: [variant.color, variant.size].filter(Boolean).join(' / ') || 'Standard variant',
        }))
      }
    }
  }

  return Object.freeze({
    activeProducts: Number.isInteger(total) && total >= 0 ? total : 0,
    sampledProducts: rows.length,
    activeVariants,
    unitsOnHand: unitsOnHand.toString(),
    outOfStock: Object.freeze(outOfStock),
  })
}

function validRecentSale(sale) {
  return typeof sale?.id === 'string' && ['COMPLETED', 'VOIDED'].includes(sale.status) &&
    typeof sale.totalAmount === 'string' && typeof sale.currency === 'string' &&
    Number.isInteger(sale.itemCount) && sale.itemCount >= 0 && Number.isInteger(sale.totalUnits) && sale.totalUnits >= 0 &&
    typeof sale.createdAt === 'string' && typeof sale.seller?.name === 'string'
}

export function dashboardRecentSales(sales, role) {
  if (!Array.isArray(sales) || !sales.every(validRecentSale)) return null
  return Object.freeze(sales.slice(0, recentSaleLimit).map((sale) => Object.freeze({
    id: sale.id,
    status: sale.status,
    itemCount: sale.itemCount,
    totalUnits: sale.totalUnits,
    createdAt: sale.createdAt,
    seller: Object.freeze({ name: sale.seller.name, employeeCode: sale.seller.employeeCode ?? null }),
    ...(role === 'OWNER' ? { totalAmount: sale.totalAmount, currency: sale.currency } : {}),
  })))
}

export async function loadDashboardCatalog({ supabase, fetchImpl = globalThis.fetch }) {
  const result = await listProducts({ supabase, fetchImpl, filters: { page: 1 } })
  return result.ok ? Object.freeze({ ok: true, summary: summarizeDashboardCatalog(result.products, result.total) }) : result
}

export async function loadDashboardRecentSales({ supabase, fetchImpl = globalThis.fetch, role }) {
  const result = await loadSaleHistory({ supabase, fetchImpl, limit: recentSaleLimit })
  if (!result.ok) return result
  const sales = dashboardRecentSales(result.sales, role)
  return sales === null
    ? Object.freeze({ ok: false, code: 'INVALID_DASHBOARD_SALES', message: 'Recent Sales response was invalid. Refresh and try again.' })
    : Object.freeze({ ok: true, sales })
}

export async function loadDashboardFinance({ supabase, fetchImpl = globalThis.fetch, role, date, currency }) {
  if (role !== 'OWNER') return Object.freeze({ ok: true, skipped: true })
  const result = await loadDailyReport({ supabase, fetchImpl, date })
  if (!result.ok) return result
  if (result.report.currency !== currency) {
    return Object.freeze({ ok: false, code: 'DASHBOARD_CURRENCY_MISMATCH', message: 'Financial reporting currency was inconsistent. Refresh and try again.' })
  }
  return Object.freeze({ ok: true, report: result.report })
}
