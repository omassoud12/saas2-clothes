import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// From sales to net profit: sales − cost of goods = gross profit, − rent, salaries, electricity, generator… = net profit.
// Monthly costs are spread over the days of the month, so "so far" is fair in the middle of the month.
export default function NetProfit({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="40%" />{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={22} />)}</section>
  if (!data.expenses || data.profit === null) return null
  const row = (label, value, cls = '', note = null) => (
    <li className={cls}><span>{label}{note && <em> {note}</em>}</span><strong>{value < 0 ? '−' : ''}{formatUsd(Math.abs(Math.round(value)))}</strong></li>
  )
  return (
    <section className="bcard" aria-labelledby="np-title">
      <div className="bcard__row">
        <h2 id="np-title" className="bcard__title">Net profit</h2>
        <span className={'trend ' + (data.net >= 0 ? 'trend--up' : 'trend--down')}>{data.netMargin ?? 0}% of sales</span>
      </div>
      <ul className="pl">
        {row('Sales', data.sales)}
        {row('Cost of goods sold', -data.cost, 'pl--minus')}
        {row('Gross profit', data.profit, 'pl--sub', `${data.grossMargin ?? 0}%`)}
        {data.expenses.map((x) => <li key={x.key} className="pl--minus"><span>{x.label}</span><strong>−{formatUsd(Math.round(x.amount))}</strong></li>)}
        {row('Net profit', data.net, 'pl--total')}
      </ul>
      {data.live && <p className="note">Monthly costs are counted day by day (so far: {data.days.filter((d) => d.sales !== null).length} of {data.days.length} days).</p>}
    </section>
  )
}
