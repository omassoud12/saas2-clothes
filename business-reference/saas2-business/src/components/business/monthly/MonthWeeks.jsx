import { formatDay } from '../../../lib/date.js';
import { formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// W1 vs W2 vs W3…: each week of the month (Mon–Sun, cut at the month edges), with sales and sales per day.
const range = (w) => {
  const a = formatDay(w.from).split(' ');
  const b = formatDay(w.to).split(' ');
  return w.from === w.to ? `${a[1]} ${a[2]}` : `${a[1]}–${b[1]} ${b[2]}`;
};

export default function MonthWeeks({ data, loading }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="40%" />{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</section>;
  const max = Math.max(...data.weeks.map((w) => w.sales), 1);
  const started = data.weeks.filter((w) => w.started);
  const later = data.weeks.filter((w) => !w.started);
  return (
    <section className="bcard" aria-labelledby="mw-title">
      <h2 id="mw-title" className="bcard__title">Week by week</h2>
      <ul className="cmp">
        {started.map((w) => (
          <li key={w.key}>
            <span className="cmp__name"><strong>{w.key}</strong><span>{range(w)}</span></span>
            <span className="cmp__bar"><span style={{ width: `${(w.sales / max) * 100}%` }} /></span>
            <span className="cmp__val">
              {w.started ? (
                <><strong>{formatUsd(Math.round(w.sales))}</strong><span className="cmp__sub">{formatUsd(Math.round(w.perDay))}/day · {w.days} {w.days === 1 ? 'day' : 'days'}</span></>
              ) : <span className="cmp__sub">Still to come</span>}
            </span>
          </li>
        ))}
      </ul>
      {later.length > 0 && <p className="note">{later.length === 1 ? later[0].key : `${later[0].key}–${later[later.length - 1].key}`} still to come.</p>}
    </section>
  );
}
