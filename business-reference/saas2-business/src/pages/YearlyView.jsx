import { getYearly } from '../api/business.js';
import { mapYearly } from '../domain/mappers.js';
import { thisMonthInShop } from '../lib/date.js';
import useAsync from '../hooks/useAsync.js';
import { YearNav } from '../components/business/nav/Navs.jsx';
import YearCards from '../components/business/yearly/YearCards.jsx';
import MoneyInOut from '../components/business/yearly/MoneyInOut.jsx';
import GrowthChart from '../components/business/yearly/GrowthChart.jsx';
import MonthTiles from '../components/business/yearly/MonthTiles.jsx';
import { ErrorBox } from '../components/business/States.jsx';

// Yearly view (owner only): totals, money in vs out, growth with a trend line, and the 12 months.
export default function YearlyView({ filters, setFilters, animate }) {
  const yearly = useAsync(
    (o) => getYearly({ year: filters.year, storeId: filters.storeId }, o).then((dto) => mapYearly(dto, thisMonthInShop())),
    [filters.year, filters.storeId],
  );
  const loading = yearly.loading && !yearly.data;
  const data = yearly.data;
  return (
    <>
      <YearNav filters={filters} onChange={setFilters} />
      {yearly.error ? (
        <ErrorBox error={yearly.error} onRetry={yearly.reload} />
      ) : (
        <div className={'biz__body biz__body--yearly' + (yearly.loading && data ? ' is-refreshing' : '')}>
          <YearCards data={data} loading={loading} />
          <MoneyInOut data={data} loading={loading} animate={animate} />
          <GrowthChart data={data} loading={loading} animate={animate} />
          <MonthTiles year={filters.year} data={data} loading={loading} onPickMonth={(month) => setFilters({ view: 'monthly', month })} />
        </div>
      )}
    </>
  );
}
