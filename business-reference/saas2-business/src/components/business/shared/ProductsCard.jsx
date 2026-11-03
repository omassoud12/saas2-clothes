import { useState } from 'react';
import { formatUsd } from '../../../lib/money.js';
import { Skeleton } from '../States.jsx';

// What sells the most, grouped by product (all colours and sizes together).
// Toggle Revenue / Pieces / Profit (profit for the owner): a cheap tee can lead on pieces but not on profit.
// Tap a product to see its variants. Shows the top N with "See all".
const MODES = [
  { key: 'sales', label: 'Revenue' },
  { key: 'quantity', label: 'Pieces' },
  { key: 'profit', label: 'Profit' },
];
const show = (mode, r) => (mode === 'quantity' ? `${r.quantity} ${r.quantity === 1 ? 'piece' : 'pieces'}` : formatUsd(Math.round(r[mode] ?? 0)));

export default function ProductsCard({ title, products, loading, top = 5, empty }) {
  const [mode, setMode] = useState('sales');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(null);
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="45%" /><Skeleton height={40} />{[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}</section>;
  const canProfit = products.some((p) => p.profit !== null);
  const modes = MODES.filter((m) => m.key !== 'profit' || canProfit);
  const sorted = [...products].sort((a, b) => (b[mode] ?? 0) - (a[mode] ?? 0));
  const rows = all ? sorted : sorted.slice(0, top);
  const max = Math.max(...sorted.map((r) => r[mode] ?? 0), 1);
  const other = (r) => modes.filter((m) => m.key !== mode).map((m) => show(m.key, r)).join(' · ');
  return (
    <section className="bcard" aria-labelledby="pc-title">
      <div className="bcard__row">
        <h2 id="pc-title" className="bcard__title">{title}</h2>
        <span className="bcard__meta">By product</span>
      </div>
      {products.length === 0 ? <p className="note">{empty}</p> : (
        <>
          <div className="seg3" role="tablist" aria-label="Rank by">
            {modes.map((m) => (
              <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} className={mode === m.key ? 'is-on' : ''} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
          <ol className="top">
            {rows.map((r, i) => (
              <li key={r.id}>
                <span className="top__rank">{i + 1}</span>
                <span className="top__main">
                  <button type="button" className="top__btn" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span className="top__line"><strong>{r.name} <span className="top__chev" aria-hidden="true">{open === r.id ? '▾' : '▸'}</span></strong><strong className="top__money">{show(mode, r)}</strong></span>
                    <span className="top__bar"><span style={{ width: `${Math.max(0, (r[mode] ?? 0) / max) * 100}%` }} /></span>
                    <span className="top__meta"><span>{other(r)}{r.margin !== null ? ` · ${r.margin}%` : ''}</span></span>
                  </button>
                  {open === r.id && (
                    <ul className="variants">
                      {r.variants.map((x) => (
                        <li key={x.id}><span>{x.label}</span><span>{x.quantity} pcs · {formatUsd(Math.round(x.sales))}{x.profit !== null ? ` · ${x.margin}%` : ''}</span></li>
                      ))}
                    </ul>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {sorted.length > top && (
            <button type="button" className="linkbtn" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${sorted.length}`}</button>
          )}
        </>
      )}
    </section>
  );
}
