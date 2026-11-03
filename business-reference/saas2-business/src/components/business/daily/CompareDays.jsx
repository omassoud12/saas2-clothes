import { formatDay } from '../../../lib/date.js';
import { formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// Today vs yesterday and vs the same weekday last week, cut at the same time of day while today is live.
export default function CompareDays({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="45%" /><Skeleton height={28} /><Skeleton height={28} /><Skeleton height={28} /></section>;
  const rows = [{ key: 'today', label: data.live ? 'Today so far' : 'This day', date: data.date, sales: data.sales }, ...data.comparisons];
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <section className="bcard" aria-labelledby="cd-title">
      <div className="bcard__row">
        <h2 id="cd-title" className="bcard__title">Compared with</h2>
        {data.live && <span className="bcard__meta">All up to {data.asOf}</span>}
      </div>
      <ul className="cmp">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="cmp__name"><strong>{r.label}</strong><span>{formatDay(r.date)}</span></span>
            <span className="cmp__bar"><span className={r.key === 'today' ? 'is-today' : ''} style={{ width: `${(r.sales / max) * 100}%` }} /></span>
            <span className="cmp__val">
              <strong>{formatUsd(Math.round(r.sales))}</strong>
              {r.key !== 'today' && r.change !== null && (
                <span className={'trend ' + (r.diff >= 0 ? 'trend--up' : 'trend--down')}>
                  {r.diff >= 0 ? '↑' : '↓'} {formatUsd(Math.abs(Math.round(r.diff)))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
