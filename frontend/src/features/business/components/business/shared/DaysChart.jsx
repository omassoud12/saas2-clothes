import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, COLORS } from '../../../lib/colors.js'
import { formatAxisUsd, niceMoneyAxis, valuesOf } from '../../../lib/axis.js'
import { formatDay } from '../../../lib/date.js'
import { formatUsd, percentChange } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Sales per day as bars (never a running line): cost + gross profit stacked for the owner, plain sales otherwise.
// Dashed outline = expected sales for days still to come. Optional dashed line = same day last week (Weekly).
// Used by Weekly (7 days) and Monthly (every day of the month).

function Tip({ active, payload, canSeeCost, asOf, showLastWeek }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (d.closed) return <div className="tip"><span>{formatDay(d.date)} · closed</span></div>
  if (d.sales === null) {
    return (
      <div className="tip tip--stack">
        <span className="tip__date">{formatDay(d.date)}</span>
        <span>Still to come · expected about <strong>{formatUsd(Math.round(d.forecast ?? 0))}</strong></span>
        <span className="tip__muted">Average of the last 4 {formatDay(d.date).split(' ')[0]}s</span>
      </div>
    )
  }
  const change = percentChange(d.sales, d.lastWeek)
  return (
    <div className="tip tip--stack">
      <span className="tip__date">{formatDay(d.date)}{d.isToday ? ` · up to ${asOf}` : ''}</span>
      <span className="tip__row"><strong>{formatUsd(Math.round(d.sales))}</strong> sales · {d.invoices} invoices</span>
      {canSeeCost && <span className="tip__row"><span className="tip__key" style={{ background: COLORS.profit }} />{formatUsd(Math.round(d.profit))} gross profit · {d.margin ?? 0}%</span>}
      {showLastWeek && <span className="tip__row">{formatUsd(Math.round(d.lastWeek))} last week{d.isToday ? ' by the same time' : ''}</span>}
      {showLastWeek && change !== null && <span className={'delta ' + (change >= 0 ? 'delta--up' : 'delta--down')}>{change >= 0 ? '▲' : '▼'} {Math.abs(change)}%</span>}
    </div>
  )
}

export default function DaysChart({ data, rows: input, loading, animate, title = 'Day by day', showLastWeek = false, height = 220, labelOf }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="55%" /><Skeleton height={height} /></section>
  const rows = input.map((d, i) => ({ ...d, forecast: d.sales === null && !d.closed ? d.forecast : null, label: labelOf(d, i) }))
  const axis = niceMoneyAxis(valuesOf(rows, showLastWeek ? ['sales', 'lastWeek', 'forecast'] : ['sales', 'forecast']))
  const own = data.canSeeCost
  const hasFuture = rows.some((r) => r.sales === null && !r.closed)
  const bar = rows.length > 10 ? 12 : 26
  return (
    <section className="bcard" aria-labelledby="dc-title">
      <h2 id="dc-title" className="bcard__title">{title}</h2>
      {(data.best || data.worst) && (
        <p className="bestworst">
          {data.best && <span>Best day: <strong>{formatDay(data.best.date)} · {formatUsd(Math.round(data.best.sales))}</strong></span>}
          {data.worst && <span>Slowest: <strong>{formatDay(data.worst.date)} · {formatUsd(Math.round(data.worst.sales))}</strong></span>}
        </p>
      )}
      <ul className="line-legend">
        {own ? (
          <>
            <li><span className="box-key" style={{ background: COLORS.cost }} />Cost</li>
            <li><span className="box-key" style={{ background: COLORS.profit }} />Gross profit</li>
          </>
        ) : <li><span className="box-key" style={{ background: COLORS.sales }} />Sales</li>}
        {showLastWeek && <li><span className="line-key line-key--dashed" style={{ borderColor: COLORS.salesSoft }} />Last week</li>}
        {hasFuture && <li><span className="box-key box-key--dashed" />Expected</li>}
      </ul>
      <div className="chart-box" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={AXIS.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS.line }} tick={AXIS.tick} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS.tick} tickFormatter={formatAxisUsd} domain={axis.domain} ticks={axis.ticks} width={44} />
            <Tooltip content={<Tip canSeeCost={own} asOf={data.asOf} showLastWeek={showLastWeek} />} cursor={{ fill: 'rgba(154, 78, 92, 0.06)' }} />
            {own ? (
              <>
                <Bar dataKey="cost" stackId="d" fill={COLORS.cost} maxBarSize={bar} isAnimationActive={animate} />
                <Bar dataKey="profit" stackId="d" fill={COLORS.profit} radius={[3, 3, 0, 0]} maxBarSize={bar} isAnimationActive={animate} />
              </>
            ) : <Bar dataKey="sales" stackId="d" fill={COLORS.sales} radius={[3, 3, 0, 0]} maxBarSize={bar} isAnimationActive={animate} />}
            <Bar dataKey="forecast" stackId="d" fill="transparent" stroke={COLORS.forecast} strokeDasharray="4 3" strokeWidth={1.5} radius={[3, 3, 0, 0]} maxBarSize={bar} isAnimationActive={false} />
            {showLastWeek && <Line dataKey="lastWeek" type="monotone" stroke={COLORS.salesSoft} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, fill: COLORS.salesSoft, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={animate} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
