import { formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// One stacked bar: cost + gross profit = sales. Colors checked for color-blind separation; both parts are labeled.
import { COLORS } from '../../../lib/colors.js';

export default function SalesBreakdown({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="45%" /><Skeleton height={20} /></section>;
  if (!data.canSeeCost || !data.sales) return null;
  const cost = data.cost ?? 0;
  const profit = data.profit ?? 0;
  const costPct = Math.max(0, Math.min(100, (cost / data.sales) * 100));
  return (
    <section className="bcard" aria-labelledby="sb2-title">
      <h2 id="sb2-title" className="bcard__title">Where today’s sales go</h2>
      <div className="split-bar" role="img" aria-label={`Cost ${formatUsd(Math.round(cost))}, gross profit ${formatUsd(Math.round(profit))}`}>
        <span style={{ width: `${costPct}%`, background: COLORS.cost }} />
        <span style={{ width: `${100 - costPct}%`, background: COLORS.profit }} />
      </div>
      <ul className="split-legend">
        <li><span className="box-key" style={{ background: COLORS.cost }} /><span>Cost of goods</span><strong>{formatUsd(Math.round(cost))}</strong><em>{100 - (data.grossMargin ?? 0)}%</em></li>
        <li><span className="box-key" style={{ background: COLORS.profit }} /><span>Gross profit</span><strong>{formatUsd(Math.round(profit))}</strong><em>{data.grossMargin ?? 0}%</em></li>
      </ul>
      {!data.costComplete && <p className="note">Some items sold today have no cost yet, so profit may be off.</p>}
    </section>
  );
}
