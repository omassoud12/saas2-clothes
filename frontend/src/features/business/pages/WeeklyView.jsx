import { getWeekly } from '../api/business.js'
import { mapWeekly } from '../domain/mappers.js'
import useAsync from '../hooks/useAsync.js'
import { formatDay } from '../lib/date.js'
import { WeekNav } from '../components/business/nav/Navs.jsx'
import SlowMovers from '../components/business/weekly/SlowMovers.jsx'
import LiveBadge from '../components/business/shared/LiveBadge.jsx'
import HeroCard from '../components/business/shared/HeroCard.jsx'
import PaymentsCard from '../components/business/shared/PaymentsCard.jsx'
import StaffCard from '../components/business/shared/StaffCard.jsx'
import TargetCard from '../components/business/shared/TargetCard.jsx'
import DaysChart from '../components/business/shared/DaysChart.jsx'
import ProductsCard from '../components/business/shared/ProductsCard.jsx'
import { ErrorBox } from '../components/business/States.jsx'

// Weekly view, same order as Daily: totals → sales → payments → employees → products,
// then "Not selling" (only on the current week, because stock is "now").
export default function WeeklyView({ filters, setFilters, animate }) {
  const weekly = useAsync(
    (o) => getWeekly({ week: filters.week, storeId: filters.storeId }, o).then(mapWeekly),
    [filters.week, filters.storeId],
  )
  const loading = weekly.loading && !weekly.data
  const data = weekly.data
  const asOf = data?.live ? `${formatDay(data.asOfDate).split(' ')[0]} ${data.asOf}` : null
  return (
    <>
      <WeekNav filters={filters} onChange={setFilters} />
      {weekly.error ? (
        <ErrorBox error={weekly.error} onRetry={weekly.reload} />
      ) : (
        <div className={'biz__body biz__body--weekly' + (weekly.loading && data ? ' is-refreshing' : '')}>
          {data && <LiveBadge live={data.live} asOf={asOf} liveText="so far" doneText="Full week" />}
          <HeroCard
            title="Sales this week"
            data={data}
            loading={loading}
            trend={data && { diff: data.previousSales ? data.diff : null, change: data.change, label: data.live ? `vs last week by ${data.asOf}` : 'vs last week' }}
          />
          <TargetCard title="Weekly target" sales={data?.sales} target={data?.target} live={data?.live} loading={loading} />
          <DaysChart data={data} rows={data?.days || []} loading={loading} animate={animate} showLastWeek labelOf={(d, i) => (d.isToday ? 'Today' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i])} />
          <PaymentsCard title="How customers paid" payments={data?.payments || []} rate={data?.rate} loading={loading} />
          <StaffCard staff={data?.staff || []} loading={loading} empty="No sales yet this week." />
          <ProductsCard title="Top products this week" products={data?.products || []} loading={loading} empty="No sales yet this week." />
          <SlowMovers data={data} loading={loading} />
        </div>
      )}
    </>
  )
}
