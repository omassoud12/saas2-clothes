import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonth, formatMonthShort } from '../../../lib/date.js';
import { formatUsd, formatUsdCompact } from '../../../lib/money.js';
import { formatAxisUsd, niceMoneyAxis, valuesOf } from '../../../lib/axis.js';
import { Skeleton } from '../States.jsx';

// Money in (sales) vs money out (stock bought + rent + other costs), month by month. One $ axis.
const COLORS = { in: '#a8455c', out: '#5b62b5' };

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  const diff = m.sales - m.moneyOut;
  return (
    <div className="tip tip--stack">
      <span className="tip__date">{formatMonth(m.month)}{m.partial ? ' (so far)' : ''}</span>
      <span className="tip__row"><span className="tip__key" style={{ background: COLORS.in }} /><strong>{formatUsd(Math.round(m.sales))}</strong> came in</span>
      <span className="tip__row"><span className="tip__key" style={{ background: COLORS.out }} /><strong>{formatUsd(Math.round(m.moneyOut))}</strong> went out</span>
      <span className="tip__muted">Stock {formatUsd(Math.round(m.purchases))} · Rent {formatUsd(Math.round(m.rent))} · Other {formatUsd(Math.round(m.other))}</span>
      <span className={'delta ' + (diff >= 0 ? 'delta--up' : 'delta--down')}>{diff >= 0 ? '+' : '−'}{formatUsd(Math.abs(Math.round(diff)))} left</span>
    </div>
  );
}

export default function MoneyInOut({ data, loading, animate }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="55%" /><Skeleton height={220} /></section>;
  const rows = data.months.map((m) => ({ ...m, label: formatMonthShort(m.month) }));
  const totalOut = data.purchases + data.rent + data.other;
  const axis = niceMoneyAxis(valuesOf(rows, ['sales', 'moneyOut']));
  return (
    <section className="bcard" aria-labelledby="mio-title">
      <h2 id="mio-title" className="bcard__title">Money in vs money out</h2>
      <ul className="line-legend">
        <li><span className="line-key" style={{ background: COLORS.in }} />Came in <strong>{formatUsd(Math.round(data.sales))}</strong></li>
        <li><span className="line-key" style={{ background: COLORS.out }} />Went out <strong>{formatUsd(Math.round(totalOut))}</strong></li>
      </ul>
      <div className="chart-box" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#f0e2de" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e3cfc9' }} tick={{ fill: '#6e6461', fontSize: 12 }} interval="preserveStartEnd" minTickGap={10} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6e6461', fontSize: 12 }} tickFormatter={formatAxisUsd} domain={axis.domain} ticks={axis.ticks} width={44} />
            <Tooltip content={<Tip />} cursor={{ stroke: '#c9b3ad', strokeWidth: 1 }} />
            <Line type="monotone" dataKey="sales" stroke={COLORS.in} strokeWidth={2} dot={{ r: 3, fill: COLORS.in, stroke: '#fffbfa', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fffbfa', strokeWidth: 2 }} isAnimationActive={animate} />
            <Line type="monotone" dataKey="moneyOut" stroke={COLORS.out} strokeWidth={2} dot={{ r: 3, fill: COLORS.out, stroke: '#fffbfa', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fffbfa', strokeWidth: 2 }} isAnimationActive={animate} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="note">Money out = stock bought + rent + salaries and other costs. Buying a lot of stock in one month can push it above sales; that stock is sold in later months.</p>
    </section>
  );
}
