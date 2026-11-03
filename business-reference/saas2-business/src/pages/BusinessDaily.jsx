import { useMemo } from 'react';
import { getDailySummary, getStores } from '../api/business.js';
import { mapDailySummary } from '../domain/mappers.js';
import useAsync from '../hooks/useAsync.js';
import useFilters from '../hooks/useFilters.js';
import { DayNav } from '../components/business/nav/Navs.jsx';
import StorePicker from '../components/business/nav/StorePicker.jsx';
import SalesBreakdown from '../components/business/daily/SalesBreakdown.jsx';
import CompareDays from '../components/business/daily/CompareDays.jsx';
import SalesByHour from '../components/business/daily/SalesByHour.jsx';
import DiscountsReturns from '../components/business/shared/DiscountsReturns.jsx';
import LiveBadge from '../components/business/shared/LiveBadge.jsx';
import HeroCard from '../components/business/shared/HeroCard.jsx';
import PaymentsCard from '../components/business/shared/PaymentsCard.jsx';
import StaffCard from '../components/business/shared/StaffCard.jsx';
import ProductsCard from '../components/business/shared/ProductsCard.jsx';
import InvoiceList from '../components/business/InvoiceList.jsx';
import { ErrorBox } from '../components/business/States.jsx';
import MonthlyView from './MonthlyView.jsx';
import WeeklyView from './WeeklyView.jsx';
import YearlyView from './YearlyView.jsx';

const TABS = [
  { key: 'daily', label: 'Daily', ready: true },
  { key: 'weekly', label: 'Weekly', ready: true },
  { key: 'monthly', label: 'Monthly', ready: true },
  { key: 'yearly', label: 'Yearly', ready: true },
];

export default function BusinessDaily() {
  const [filters, setFilters] = useFilters();
  const animate = useMemo(() => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  const stores = useAsync((o) => getStores(o), []);
  const isDaily = filters.view === 'daily';
  const summary = useAsync(
    (o) => (isDaily
      ? getDailySummary({ date: filters.date, storeId: filters.storeId }, o).then(mapDailySummary)
      : Promise.resolve(null)),
    [isDaily, filters.date, filters.storeId],
  );
  const loading = summary.loading && !summary.data;
  const data = summary.data;

  return (
    <div className="biz">
      <header className="biz__head">
        <div className="biz__top">
          <h1 className="biz__title">Business</h1>
          <StorePicker value={filters.storeId} onChange={setFilters} />
        </div>
        <nav className="tabs" aria-label="Business reports">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={'tabs__tab' + (t.key === filters.view ? ' is-on' : '')}
              aria-current={t.key === filters.view ? 'page' : undefined}
              disabled={!t.ready}
              onClick={() => t.ready && setFilters({ view: t.key })}
            >
              {t.label}{!t.ready && <span className="tabs__soon">Soon</span>}
            </button>
          ))}
        </nav>
      </header>

      {isDaily ? (
        <>
          <DayNav filters={filters} onChange={setFilters} />

          {summary.error ? (
            <ErrorBox error={summary.error} onRetry={summary.reload} />
          ) : (
            <div className={'biz__body biz__body--daily' + (summary.loading && data ? ' is-refreshing' : '')}>
              {data && <LiveBadge live={data.live} asOf={data.asOf} liveText="so far today" doneText="Full day" />}
              {/* Same order on every tab: totals → sales → payments → employees → products */}
              <HeroCard
                title="Sales today"
                data={data}
                loading={loading}
                trend={data && { diff: data.comparisons[0].sales ? data.comparisons[0].diff : null, change: data.comparisons[0].change, label: data.live ? `vs yesterday by ${data.asOf}` : 'vs the day before' }}
              />
              <SalesBreakdown data={data} loading={loading} />
              <CompareDays data={data} loading={loading} />
              <SalesByHour data={data} loading={loading} animate={animate} />
              <PaymentsCard title="For closing the drawer" meta="Cash should be in the drawer" payments={data?.payments || []} rate={data?.rate} loading={loading} />
              <StaffCard staff={data?.staff || []} loading={loading} empty="No sales yet today." />
              <ProductsCard title="Top products today" products={data?.products || []} loading={loading} empty="No sales yet today." />
              <DiscountsReturns data={data} loading={loading} />
            </div>
          )}

          <InvoiceList filters={filters} onChange={setFilters} />
        </>
      ) : filters.view === 'yearly' ? (
        <YearlyView filters={filters} setFilters={setFilters} animate={animate} />
      ) : filters.view === 'weekly' ? (
        <WeeklyView filters={filters} setFilters={setFilters} animate={animate} />
      ) : (
        <MonthlyView filters={filters} setFilters={setFilters} animate={animate} />
      )}
    </div>
  );
}
