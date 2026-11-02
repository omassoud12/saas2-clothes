import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Who sold the most: store, sales, invoices, average ticket and gross profit (owner) for each employee.
// A high average ticket means the person sells bigger baskets, not just more invoices.
export default function StaffCard({ staff, loading, empty }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="40%" />{[0, 1, 2].map((i) => <Skeleton key={i} height={52} />)}</section>
  const topAvg = Math.max(...staff.map((s) => s.average), 0)
  return (
    <section className="bcard" aria-labelledby="st-title">
      <h2 id="st-title" className="bcard__title">Sales by employee</h2>
      {staff.length === 0 ? <p className="note">{empty}</p> : (
        <ol className="staff">
          {staff.map((s) => (
            <li key={s.id}>
              <span className="staff__avatar" aria-hidden="true">{s.name.slice(0, 1)}</span>
              <span className="staff__main">
                <span className="staff__line">
                  <span><strong>{s.name}</strong>{s.stores.length > 0 && <span className="staff__store"> · {s.stores.join(' + ')}</span>}</span>
                  <strong className="staff__money">{formatUsd(Math.round(s.sales))}</strong>
                </span>
                <span className="top__bar"><span style={{ width: `${s.share * 100}%` }} /></span>
                <span className="staff__meta">
                  <span>{s.invoices} invoices · avg <b className={staff.length > 1 && s.average === topAvg ? 'staff__best' : ''}>{formatUsd(Math.round(s.average))}</b></span>
                  {s.profit !== null && <span>Profit {formatUsd(Math.round(s.profit))} · {s.margin}%</span>}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {staff.length > 1 && <p className="note">Green avg = biggest baskets.</p>}
    </section>
  )
}
