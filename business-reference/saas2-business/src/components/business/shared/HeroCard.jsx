import { formatLbp, formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// The same hero on every tab: dark card with sales (USD, ≈ LBP and the rate used), one trend line,
// then small cards: Gross profit with margin %, Average ticket (big) with invoices, and pieces.
export default function HeroCard({ title, data, trend, loading }) {
  if (loading) {
    return (
      <section className="bcard bcard--dark hero" aria-busy="true">
        <Skeleton height={14} width="35%" /><Skeleton height={42} width="60%" /><Skeleton height={12} width="70%" />
        <div className="ws__stats">{[0, 1, 2].map((i) => <div key={i}><Skeleton height={36} /></div>)}</div>
      </section>
    );
  }
  const rate = data.rate?.toLocaleString('en-US');
  return (
    <section className="bcard bcard--dark hero" aria-label={title}>
      <h2 className="ws__label">{title}</h2>
      <p className="ws__value">{formatUsd(Math.round(data.sales))}</p>
      <p className="ws__sub">
        {formatLbp(data.sales, data.rate)}
        {rate && <span className="rate" title={`Exchange rate used: 1 USD = ${rate} LBP`}>· Rate {rate}</span>}
      </p>
      {trend && trend.diff !== null && (
        <span className={'trend ' + (trend.diff >= 0 ? 'trend--up' : 'trend--down')}>
          {trend.diff >= 0 ? '↑' : '↓'} {formatUsd(Math.abs(Math.round(trend.diff)))}
          {trend.change !== null && ` (${trend.change >= 0 ? '+' : '−'}${Math.abs(trend.change)}%)`} {trend.label}
        </span>
      )}
      <div className="ws__stats">
        {data.canSeeCost && (
          <div>
            <span>Gross profit</span>
            <strong>{formatUsd(Math.round(data.profit ?? 0))} <em>· {data.grossMargin ?? 0}%</em></strong>
            <small>margin, before rent</small>
          </div>
        )}
        <div>
          <span>Avg ticket</span>
          <strong>{formatUsd(Math.round(data.averageInvoice))}</strong>
          <small>{data.invoices} invoices</small>
        </div>
        <div>
          <span>Pieces sold</span>
          <strong>{data.pieces}</strong>
          <small>{data.piecesPerInvoice.toFixed(1)} per invoice</small>
        </div>
      </div>
    </section>
  );
}
