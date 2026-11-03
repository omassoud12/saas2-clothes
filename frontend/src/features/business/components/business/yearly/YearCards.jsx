import { formatLbp, formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// The year in numbers: sales on top, then where the money went, and what was left.
export default function YearCards({ data, loading }) {
  if (loading) {
    return (
      <section className="ycards" aria-busy="true">
        <div className="ycard ycard--main"><Skeleton height={16} width="40%" /><Skeleton height={40} width="70%" /></div>
        {[0, 1, 2, 3].map((i) => <div key={i} className="ycard"><Skeleton height={14} width="60%" /><Skeleton height={26} width="70%" /></div>)}
      </section>
    )
  }
  const cards = [
    { key: 'purchases', label: 'Stock bought', value: data.purchases, note: 'Goods you paid suppliers for' },
    { key: 'rent', label: 'Rent', value: data.rent, note: `${formatUsd(Math.round(data.rent / Math.max(1, data.months.filter((m) => !m.partial).length || 1)))} a month` },
    { key: 'other', label: 'Salaries & other costs', value: data.other, note: 'Staff, generator, supplies' },
    { key: 'net', label: 'Net profit', value: data.net, note: `${data.sales ? Math.round((data.net / data.sales) * 100) : 0}% of sales kept`, tone: data.net >= 0 ? 'good' : 'bad' },
  ]
  return (
    <section className="ycards" aria-label="Year totals">
      <div className="ycard ycard--main">
        <span className="ycard__label">Total sales · {data.year}</span>
        <strong className="ycard__big">{formatUsd(Math.round(data.sales))}</strong>
        <span className="ycard__note">
          {formatLbp(data.sales, data.rate)} · {data.invoices.toLocaleString('en-US')} invoices
        </span>
        {data.vsLastYear !== null && (
          <span className={'delta ' + (data.vsLastYear >= 0 ? 'delta--up' : 'delta--down')}>
            {data.vsLastYear >= 0 ? '▲' : '▼'} {Math.abs(data.vsLastYear)}% vs {data.year - 1} (same months)
          </span>
        )}
      </div>
      {cards.map((c) => (
        <div key={c.key} className={'ycard' + (c.tone ? ` ycard--${c.tone}` : '')}>
          <span className="ycard__label">{c.label}</span>
          <strong className="ycard__value">{formatUsd(Math.round(c.value))}</strong>
          <span className="ycard__note">{c.note}</span>
        </div>
      ))}
    </section>
  )
}
