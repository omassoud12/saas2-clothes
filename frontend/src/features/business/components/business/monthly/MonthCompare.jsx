import { formatDay } from '../../../lib/date.js'
import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// This month so far vs the same WEEKDAYS last month and last year (Sun+Mon vs Sun+Mon), as plain bars + text.
const fmt = (sub) => {
  const [a, b] = sub.split('|')
  return b ? `${formatDay(a).replace(/^\w+ /, '')} – ${formatDay(b).replace(/^\w+ /, '')}` : formatDay(a)
}

export default function MonthCompare({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="45%" />{[0, 1, 2].map((i) => <Skeleton key={i} height={28} />)}</section>
  const rows = [{ key: 'now', label: data.live ? 'This month so far' : 'This month', sub: null, sales: data.sales }, ...data.comparisons]
  const max = Math.max(...rows.map((r) => r.sales), 1)
  return (
    <section className="bcard" aria-labelledby="mc-title">
      <div className="bcard__row">
        <h2 id="mc-title" className="bcard__title">Compared with</h2>
        <span className="bcard__meta">{data.live ? `Same weekdays, up to ${data.asOf}` : 'Whole months'}</span>
      </div>
      <ul className="cmp">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="cmp__name"><strong>{r.label}</strong>{r.sub && <span>{fmt(r.sub)}</span>}</span>
            <span className="cmp__bar"><span className={r.key === 'now' ? 'is-today' : ''} style={{ width: `${(r.sales / max) * 100}%` }} /></span>
            <span className="cmp__val">
              <strong>{formatUsd(Math.round(r.sales))}</strong>
              {r.key !== 'now' && r.change !== null && (
                <span className={'trend ' + (r.diff >= 0 ? 'trend--up' : 'trend--down')}>{r.diff >= 0 ? '↑' : '↓'} {formatUsd(Math.abs(Math.round(r.diff)))} ({r.change >= 0 ? '+' : '−'}{Math.abs(r.change)}%)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
