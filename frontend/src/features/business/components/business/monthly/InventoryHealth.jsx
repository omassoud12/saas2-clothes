import { formatDay } from '../../../lib/date.js'
import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Stock right now (so only on the current month): value on the shelves, dead stock, sell-through.
export default function InventoryHealth({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="40%" /><Skeleton height={60} /></section>
  const inv = data.inventory
  if (!inv) return null
  return (
    <section className="bcard" aria-labelledby="ih-title">
      <div className="bcard__row">
        <h2 id="ih-title" className="bcard__title">Stock health</h2>
        <span className="bcard__meta">Right now</span>
      </div>
      <ul className="kv">
        {inv.stockValue !== null && <li><span>Stock value<em>{inv.stockUnits} pieces, at cost</em></span><strong>{formatUsd(Math.round(inv.stockValue))}</strong></li>}
        {inv.deadStockValue !== null && <li><span>Dead stock<em>nothing sold in {inv.basisDays} days</em></span><strong>{formatUsd(Math.round(inv.deadStockValue))}</strong></li>}
        <li><span>Sell-through<em>sold ÷ (sold + in stock)</em></span><strong>{inv.sellThrough ?? 0}%</strong></li>
      </ul>
      {inv.deadStock.length > 0 && (
        <ul className="reorder">
          {inv.deadStock.map((m) => (
            <li key={m.id}>
              <span className="reorder__name">
                <strong>{m.name}</strong>
                <span>{m.variant} · {m.stock} in stock</span>
                <span>Last sold {formatDay(m.lastSoldDate)}</span>
              </span>
              {m.stockValue !== null && <span className="reorder__qty"><strong>{formatUsd(Math.round(m.stockValue))}</strong><span>tied up</span></span>}
            </li>
          ))}
        </ul>
      )}
      {inv.deadStock.length > 0 && <p className="note">A discount on these frees cash for what sells.</p>}
    </section>
  )
}
