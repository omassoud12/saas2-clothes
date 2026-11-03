import { useCallback, useEffect, useState } from 'react';
import { mondayOf, thisMonthInShop, todayInShop } from '../lib/date.js';

// Filters live in the URL (?view=&date=&month=&store=&method=&q=) so a filtered view can be refreshed, bookmarked or shared.
const DEFAULTS = () => ({ view: 'daily', date: todayInShop(), week: mondayOf(todayInShop()), month: thisMonthInShop(), year: todayInShop().slice(0, 4), storeId: 'all', method: 'all', q: '' });
const KEYS = { view: 'view', date: 'date', week: 'week', month: 'month', year: 'year', storeId: 'store', method: 'method', q: 'q' };

function read() {
  const params = new URLSearchParams(window.location.search);
  const d = DEFAULTS();
  const date = params.get('date');
  const month = params.get('month');
  const view = params.get('view');
  const week = params.get('week');
  const year = params.get('year');
  return {
    view: ['weekly', 'monthly', 'yearly'].includes(view) ? view : d.view,
    year: year && /^\d{4}$/.test(year) ? year : d.year,
    week: week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : d.week,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : d.date,
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : d.month,
    storeId: params.get('store') || d.storeId,
    method: params.get('method') || d.method,
    q: params.get('q') || d.q,
  };
}

export default function useFilters() {
  const [filters, setFilters] = useState(read);

  useEffect(() => {
    const onPop = () => setFilters(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      const params = new URLSearchParams(window.location.search);
      const d = DEFAULTS();
      Object.entries(KEYS).forEach(([key, param]) => {
        if (next[key] && next[key] !== d[key]) params.set(param, next[key]);
        else params.delete(param);
      });
      const qs = params.toString();
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
      } catch (e) {
        /* some embedded frames block history changes; filters still work in memory */
      }
      return next;
    });
  }, []);

  return [filters, update];
}
