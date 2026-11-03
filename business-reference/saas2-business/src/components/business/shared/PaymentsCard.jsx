import { PAY_COLORS } from '../../../lib/colors.js';
import { formatLbp, formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// Cash vs Whish: one split bar + totals (USD and ≈ LBP). Same colors on every tab.
export default function PaymentsCard({ title, meta, payments, rate, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="45%" /><Skeleton height={14} /><Skeleton height={44} /><Skeleton height={44} /></section>;
  const total = payments.reduce((s, p) => s + p.sales, 0);
  return (
    <section className="bcard">
      <div className="bcard__row">
        <h2 className="bcard__title">{title}</h2>
        {meta && <span className="bcard__meta">{meta}</span>}
      </div>
      {total > 0 && (
        <div className="stackbar" role="img" aria-label={payments.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(', ')}>
          {payments.filter((p) => p.sales > 0).map((p) => <span key={p.key} style={{ width: `${p.share * 100}%`, background: PAY_COLORS[p.key] }} />)}
        </div>
      )}
      <ul className="pays">
        {payments.map((p) => (
          <li key={p.key}>
            <span className="box-key" style={{ background: PAY_COLORS[p.key] }} />
            <span className="pays__name"><strong>{p.label}</strong><span>{p.invoices} invoices · {Math.round(p.share * 100)}%</span></span>
            <span className="pays__val"><strong>{formatUsd(Math.round(p.sales * 100) / 100)}</strong><span>{formatLbp(p.sales, rate)}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
