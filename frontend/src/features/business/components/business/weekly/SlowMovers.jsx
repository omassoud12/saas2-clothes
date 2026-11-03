import { formatDay } from '../../../lib/date.js'
import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Stock that is not selling: candidates for a discount. Sorted by money tied up (owner) or pieces.
export default function SlowMovers({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="45%" />{[0, 1].map((i) => <Skeleton key={i} height={44} />)}</section>
  if (!data.slowMovers) return null
  const items = data.slowMovers
  const tied = items.reduce((s, m) => s + (m.stockValue ?? 0), 0)
  return (
    <section className="bcard" aria-labelledby="sm-title">
      <div className="bcard__row">
        <h2 id="sm-title" className="bcard__title">Not selling</h2>
        <span className="bcard__meta">Last {data.slowMoversBasisDays} days</span>
      </div>
      {items.length === 0 ? <p className="note">Everything in stock sold at least a few pieces. Nice.</p> : (
        <>
          <ul className="reorder">
            {items.map((m) => (
              <li key={m.id}>
                <span className="reorder__name">
                  <strong>{m.name}</strong>
                  <span>{m.variant} · {m.stock} in stock</span>
                  {m.lastSoldDate && <span>Last sold {formatDay(m.lastSoldDate)}</span>}
                </span>
                {m.stockValue !== null && <span className="reorder__qty"><strong>{formatUsd(Math.round(m.stockValue))}</strong><span>tied up</span></span>}
              </li>
            ))}
          </ul>
          <p className="note">{tied > 0 ? `${formatUsd(Math.round(tied))} of stock is sitting still. ` : ''}A discount or moving it to the window can free that money.</p>
        </>
      )}
    </section>
  )
}
