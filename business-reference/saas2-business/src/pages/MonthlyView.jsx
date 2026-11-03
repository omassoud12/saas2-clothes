import { getMonthly } from '../api/business.js';
import { mapMonthly } from '../domain/mappers.js';
import useAsync from '../hooks/useAsync.js';
import { formatDay, formatMonth } from '../lib/date.js';
import { formatUsd } from '../lib/money.js';
import { MonthNav } from '../components/business/nav/Navs.jsx';
import NetProfit from '../components/business/monthly/NetProfit.jsx';
import MonthWeeks from '../components/business/monthly/MonthWeeks.jsx';
import MonthCompare from '../components/business/monthly/MonthCompare.jsx';
import MonthCalendar from '../components/business/monthly/MonthCalendar.jsx';
import InventoryHealth from '../components/business/monthly/InventoryHealth.jsx';
import LiveBadge from '../components/business/shared/LiveBadge.jsx';
import HeroCard from '../components/business/shared/HeroCard.jsx';
import TargetCard from '../components/business/shared/TargetCard.jsx';
import DaysChart from '../components/business/shared/DaysChart.jsx';
import PaymentsCard from '../components/business/shared/PaymentsCard.jsx';
import StaffCard from '../components/business/shared/StaffCard.jsx';
import ProductsCard from '../components/business/shared/ProductsCard.jsx';
import DiscountsReturns from '../components/business/shared/DiscountsReturns.jsx';
import { ErrorBox } from '../components/business/States.jsx';

const compact = (n) => (n >= 10000 ? `$${Math.round(n / 1000)}k` : formatUsd(Math.round(n)));

// Monthly view, same order as Daily and Weekly: totals → sales → payments → employees → products,
// then the month-only sections (net profit, discounts/returns, stock health).
export default function MonthlyView({ filters, setFilters, animate }) {
  const monthly = useAsync(
    (o) => getMonthly({ month: filters.month, storeId: filters.storeId }, o).then(mapMonthly),
    [filters.month, filters.storeId],
  );
  const loading = monthly.loading && !monthly.data;
  const data = monthly.data;
  const lm = data?.comparisons[0];

  return (
    <>
      <MonthNav filters={filters} onChange={setFilters} />
      {monthly.error ? (
        <ErrorBox error={monthly.error} onRetry={monthly.reload} />
      ) : (
        <div className={'biz__body biz__body--monthly' + (monthly.loading && data ? ' is-refreshing' : '')}>
          {data && <LiveBadge live={data.live} asOf={data.live ? `${formatDay(data.asOfDate)} ${data.asOf}` : null} liveText="so far" doneText="Full month" />}
          <HeroCard
            title={data?.live ? 'Sales this month' : `Sales in ${data ? formatMonth(data.month) : ''}`}
            data={data}
            loading={loading}
            trend={data && { diff: lm.sales ? lm.diff : null, change: lm.change, label: data.live ? 'vs last month' : 'vs previous month' }}
          />
          <TargetCard title="Monthly target" sales={data?.sales} target={data?.target} live={data?.live} loading={loading}>
            {data && (
              <p className="pace">
                {data.projection !== null && <span>On pace for <strong>~{compact(data.projection)}</strong></span>}
                <span>{formatMonth(data.previousMonthFull.month)}: <strong>{compact(data.previousMonthFull.sales)}</strong> </span>
              </p>
            )}
          </TargetCard>
          <NetProfit data={data} loading={loading} />
          <DaysChart
            title="Sales by day"
            data={data}
            rows={data?.days || []}
            loading={loading}
            animate={animate}
            height={200}
            labelOf={(d) => String(d.day)}
          />
          <MonthWeeks data={data} loading={loading} />
          <MonthCompare data={data} loading={loading} />
          <MonthCalendar month={filters.month} data={data} loading={loading} onPickDay={(date) => setFilters({ view: 'daily', date })} />
          <PaymentsCard title="How customers paid" payments={data?.payments || []} rate={data?.rate} loading={loading} />
          <StaffCard staff={data?.staff || []} loading={loading} empty="No sales yet this month." />
          <ProductsCard title="What sells the most" products={data?.products || []} loading={loading} top={10} empty="No sales yet this month." />
          <DiscountsReturns data={data} loading={loading} period="this month" />
          <InventoryHealth data={data} loading={loading} />
        </div>
      )}
    </>
  );
}
