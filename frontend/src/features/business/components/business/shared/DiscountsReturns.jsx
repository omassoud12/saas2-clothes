import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Discounts given and returns processed in the period.
export default function DiscountsReturns({ data, loading, period = 'today' }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="45%" /><Skeleton height={40} /></section>
  const none = !data.discounts && !data.returns.count
  return (
    <section className="bcard" aria-labelledby="dr-title">
      <h2 id="dr-title" className="bcard__title">Discounts & returns</h2>
      {none ? <p className="note">No discounts or returns {period}.</p> : (
        <div className="dr">
          <div><span>Discounts given</span><strong>{formatUsd(Math.round(data.discounts))}</strong></div>
          <div><span>Returns</span><strong>{formatUsd(Math.round(data.returns.amount))}</strong><em>{data.returns.count} {data.returns.count === 1 ? 'item' : 'items'}</em></div>
        </div>
      )}
    </section>
  )
}
