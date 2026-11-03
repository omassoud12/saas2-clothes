import { formatMonth, formatMonthShort, todayInShop } from '../../../lib/date.js';
import { formatUsd, formatUsdCompact } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// The 12 months as a calendar. Darker = more sold. Best month outlined, current month marked,
// months still to come empty. Tap a month to open it in the Monthly view.
const RAMP = ['#f6ebe8', '#f0d6cf', '#e2b0aa', '#c98190', '#a8455c', '#7a2a42'];

export default function MonthTiles({ year, data, loading, onPickMonth }) {
  if (loading) {
    return <section className="bcard" aria-busy="true"><Skeleton height={20} width="45%" /><div className="mtiles">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} height={66} radius={12} />)}</div></section>;
  }
  const byMonth = Object.fromEntries(data.months.map((m) => [m.month, m]));
  const max = Math.max(...data.months.map((m) => m.sales), 0);
  const min = Math.min(...data.months.map((m) => m.sales));
  const thisMonth = todayInShop().slice(0, 7);
  const level = (v) => (v && max ? Math.min(RAMP.length - 1, Math.floor(((v - min * 0.9) / (max - min * 0.9)) * (RAMP.length - 1) + 0.5)) : 0);

  return (
    <section className="bcard" aria-labelledby="mt-title">
      <div className="bcard__row">
        <h2 id="mt-title" className="bcard__title">Every month of {year}</h2>
        <span className="bcard__meta">Tap to open</span>
      </div>
      <div className="mtiles" role="grid" aria-label="Sales per month">
        {Array.from({ length: 12 }, (_, i) => {
          const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
          const m = byMonth[ym];
          const lv = m ? level(m.sales) : -1;
          const label = m ? `${formatMonth(ym)}: ${formatUsd(Math.round(m.sales))}${ym === data.bestMonth ? ', best month' : ''}` : `${formatMonth(ym)}: still to come`;
          return (
            <button
              key={ym}
              type="button"
              role="gridcell"
              className={['mtile', !m && 'is-future', lv >= 3 && 'is-dark', ym === data.bestMonth && 'is-best', ym === thisMonth && 'is-now'].filter(Boolean).join(' ')}
              style={m ? { background: RAMP[lv] } : undefined}
              disabled={!m}
              onClick={() => onPickMonth(ym)}
              aria-label={label}
              title={label}
            >
              <span className="mtile__name">{formatMonthShort(ym)}{ym === data.bestMonth && <span aria-hidden="true"> ★</span>}</span>
              <span className="mtile__value">{m ? formatUsdCompact(m.sales) : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="heat__legend" aria-hidden="true">
        <span className="heat__scale">Less {RAMP.map((c) => <i key={c} style={{ background: c }} />)} More</span>
        <span className="heat__keys">
          <span><b className="mk mk--best" /> Best month</span>
          <span><b className="mk mk--today" /> This month</span>
        </span>
      </div>
    </section>
  );
}
