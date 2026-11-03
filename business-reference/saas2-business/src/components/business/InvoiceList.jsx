import { useEffect, useState } from 'react';
import { getInvoices } from '../../api/business.js';
import { mapInvoice } from '../../domain/mappers.js';
import { PAYMENT_METHODS } from '../../domain/types.js';
import { formatTime } from '../../lib/date.js';
import { formatUsd } from '../../lib/money.js';
import { Empty, ErrorBox, Skeleton } from './States.jsx';

const PAGE = 10;

// The day's invoices with a payment-method filter, search, and "Load more" (cursor pagination).
export default function InvoiceList({ filters, onChange }) {
  const [state, setState] = useState({ items: [], next: null, loading: true, more: false, error: null });
  const [search, setSearch] = useState(filters.q);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce typing into the URL filter.
  useEffect(() => {
    const t = setTimeout(() => { if (search !== filters.q) onChange({ q: search }); }, 300);
    return () => clearTimeout(t);
  }, [search, filters.q, onChange]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ items: [], next: null, loading: true, more: false, error: null });
    getInvoices({ ...filters, limit: PAGE }, { signal: ctrl.signal })
      .then((page) => setState({ items: page.items.map(mapInvoice), next: page.nextCursor, loading: false, more: false, error: null }))
      .catch((error) => { if (error.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error })); });
    return () => ctrl.abort();
  }, [filters.date, filters.storeId, filters.method, filters.q, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadMore() {
    setState((s) => ({ ...s, more: true }));
    getInvoices({ ...filters, cursor: state.next, limit: PAGE })
      .then((page) => setState((s) => ({ ...s, items: s.items.concat(page.items.map(mapInvoice)), next: page.nextCursor, more: false })))
      .catch((error) => setState((s) => ({ ...s, more: false, error })));
  }

  return (
    <section className="bcard" aria-labelledby="inv-title">
      <h2 id="inv-title" className="bcard__title">Invoices</h2>

      <label className="search">
        <span className="visually-hidden">Search invoices</span>
        <input type="search" inputMode="search" placeholder="Search receipt #" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      <div className="chips" role="radiogroup" aria-label="Payment method">
        {[{ value: 'all', label: 'All' }, ...PAYMENT_METHODS].map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={filters.method === m.value}
            className={'chip' + (filters.method === m.value ? ' is-on' : '')}
            onClick={() => onChange({ method: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {state.error && <ErrorBox error={state.error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {state.loading ? (
        <ul className="invoices" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => <li key={i} className="invoice"><Skeleton height={38} /></li>)}
        </ul>
      ) : state.items.length === 0 && !state.error ? (
        <Empty title="No invoices" text="Nothing matches this day and these filters." />
      ) : (
        <ul className="invoices">
          {state.items.map((inv) => (
            <li key={inv.id} className={'invoice' + (inv.status === 'VOIDED' ? ' is-void' : '')}>
              <span className="invoice__main">
                <strong>#{inv.number}</strong>
                <span>{formatTime(inv.createdAt)} · {inv.staff} · {inv.store}</span>
                {inv.customer && <span>Customer: {inv.customer}</span>}
              </span>
              <span className={'method method--' + inv.method.toLowerCase()}>{inv.methodLabel}</span>
              <span className="invoice__total">
                <strong>{formatUsd(inv.total)}</strong>
                <span>{inv.status === 'VOIDED' ? 'Voided' : `${inv.items} ${inv.items === 1 ? 'piece' : 'pieces'}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.next && !state.loading && (
        <button type="button" className="btn btn--ghost btn--block" onClick={loadMore} disabled={state.more}>
          {state.more ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
