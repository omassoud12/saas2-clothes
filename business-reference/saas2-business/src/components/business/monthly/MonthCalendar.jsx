import { daysInMonth, firstWeekday, formatDay, todayInShop } from '../../../lib/date.js';
import { formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// Every day of the month as a calendar heat grid: columns = Mon…Sun (Sunday always visible),
// rows = weeks of the month (W1, W2…). Darker = more sold, with a scale from $0 to the best day.
// Best day has a dark outline, today a dot, closed days are striped, days to come are empty.
// Tap a day to open it in the Daily view.
const RAMP = ['#f6ebe8', '#f0d6cf', '#e2b0aa', '#c98190', '#a8455c', '#7a2a42'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function levelOf(value, max) {
  if (!value || !max) return -1;
  return Math.min(RAMP.length - 1, Math.floor((value / max) * RAMP.length * 0.999));
}

export default function MonthCalendar({ month, data, loading, onPickDay }) {
  const total = daysInMonth(month);
  const offset = firstWeekday(month);
  const cols = Math.ceil((offset + total) / 7);
  const today = todayInShop();

  if (loading) {
    return (
      <section className="bcard" aria-busy="true">
        <Skeleton height={20} width="45%" />
        <Skeleton height={230} />
      </section>
    );
  }

  const byDate = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const max = Math.max(...data.days.map((d) => d.sales ?? 0), 0);
  const dayAt = (row, col) => {
    const n = row * 7 + col - offset + 1;
    return n >= 1 && n <= total ? n : null;
  };

  const cells = [];
  WEEK.forEach((w) => cells.push(<span key={`h${w}`} className="heat__h" role="columnheader">{w}</span>));
  for (let r = 0; r < cols; r += 1) {
    cells.push(<span key={`w${r}`} className="heat__d" role="rowheader">W{r + 1}</span>);
    for (let c = 0; c < 7; c += 1) {
      const n = dayAt(r, c);
      if (!n) {
        cells.push(<span key={`pad${r}-${c}`} className="heat__pad" aria-hidden="true" />);
        continue;
      }
      const date = `${month}-${String(n).padStart(2, '0')}`;
      const d = byDate[date];
      const closed = Boolean(d?.closed);
      const future = !d || (d.sales === null && !closed);
      const level = d && !future && !closed ? levelOf(d.sales, max) : -1;
      const isBest = date === data.bestDate;
      const isToday = date === today;
      const label = closed
        ? `${formatDay(date)}: closed`
        : future
          ? `${formatDay(date)}: still to come`
          : `${formatDay(date)}: ${formatUsd(Math.round(d.sales))}, ${d.invoices} invoices${isBest ? ', best day' : ''}`;
      cells.push(
        <button
          key={date}
          type="button"
          role="gridcell"
          className={['heat__cell', future && 'is-future', closed && 'is-closed', level >= 3 && 'is-dark', isBest && 'is-best', isToday && 'is-today'].filter(Boolean).join(' ')}
          style={level >= 0 ? { background: RAMP[level] } : undefined}
          disabled={future || closed}
          onClick={() => onPickDay(date)}
          aria-label={label}
          title={label}
        >
          <span className="heat__num">{n}</span>
        </button>,
      );
    }
  }

  return (
    <section className="bcard" aria-labelledby="cal-title">
      <div className="bcard__row">
        <h2 id="cal-title" className="bcard__title">Every day of the month</h2>
        <span className="bcard__meta">Tap a day to open it</span>
      </div>
      <div className="heat" role="grid" aria-label="Sales per day" style={{ gridTemplateColumns: '30px repeat(7, minmax(0, 1fr))' }}>
        <span aria-hidden="true" />
        {cells}
      </div>
      <div className="heat__legend" aria-hidden="true">
        <span className="heat__scale">$0 {RAMP.map((c) => <i key={c} style={{ background: c }} />)} {formatUsd(Math.round(max))}</span>
        <span className="heat__keys">
          <span><b className="mk mk--best" /> Best day</span>
          <span><b className="mk mk--today" /> Today</span>
          <span><b className="mk mk--closed" /> Closed</span>
        </span>
      </div>
    </section>
  );
}
