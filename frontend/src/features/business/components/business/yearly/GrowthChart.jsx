import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMonth, formatMonthShort } from '../../../lib/date.js'
import { formatUsd } from '../../../lib/money.js'
import { formatAxisUsd, niceMoneyAxis, valuesOf } from '../../../lib/axis.js'
import { Skeleton } from '../States.jsx'

// Growth: monthly sales as bars, and a trend line (3-month average) on the same chart and the same $ scale,
// so you can see where the business is heading without the noise of one good or bad month.
const BAR = '#e2b0aa'
const BAR_LAST = '#a8455c'
const BAR_PARTIAL = '#f3e2dd'
const LINE = '#2a2626'

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  return (
    <div className="tip tip--stack">
      <span className="tip__date">{formatMonth(m.month)}</span>
      <strong className="tip__big">{formatUsd(Math.round(m.sales))}</strong>
      {m.partial && <span className="tip__muted">So far this month</span>}
      {m.growth !== null && (
        <span className={'delta ' + (m.growth >= 0 ? 'delta--up' : 'delta--down')}>{m.growth >= 0 ? '▲' : '▼'} {Math.abs(m.growth)}% vs month before</span>
      )}
      {m.trend !== null && <span className="tip__row"><span className="tip__key" style={{ background: LINE }} />Trend {formatUsd(Math.round(m.trend))}</span>}
    </div>
  )
}

export default function GrowthChart({ data, loading, animate }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={20} width="40%" /><Skeleton height={230} /></section>
  const rows = data.months.map((m) => ({ ...m, label: formatMonthShort(m.month) }))
  const full = rows.filter((r) => !r.partial)
  const lastFull = full.length - 1
  const first = full[0]
  const last = full[lastFull]
  const trendChange = first && last && first.trend ? Math.round(((last.trend - first.trend) / first.trend) * 100) : null
  const axis = niceMoneyAxis(valuesOf(rows, ['sales', 'trend']))
  return (
    <section className="bcard" aria-labelledby="gr-title">
      <div className="bcard__row">
        <h2 id="gr-title" className="bcard__title">Growth</h2>
        {trendChange !== null && full.length > 2 && (
          <span className={'delta ' + (trendChange >= 0 ? 'delta--up' : 'delta--down')}>
            Trend {trendChange >= 0 ? '▲' : '▼'} {Math.abs(trendChange)}% since {first.label}
          </span>
        )}
      </div>
      <ul className="line-legend">
        <li><span className="box-key" style={{ background: BAR }} />Sales each month</li>
        <li><span className="line-key" style={{ background: LINE }} />Trend (3-month average)</li>
      </ul>
      <div className="chart-box" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#f0e2de" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e3cfc9' }} tick={{ fill: '#6e6461', fontSize: 12 }} interval="preserveStartEnd" minTickGap={10} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6e6461', fontSize: 12 }} tickFormatter={formatAxisUsd} domain={axis.domain} ticks={axis.ticks} width={44} />
            <Tooltip content={<Tip />} cursor={{ fill: 'rgba(154, 78, 92, 0.06)' }} />
            <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={animate}>
              {rows.map((r) => <Cell key={r.month} fill={r.partial ? BAR_PARTIAL : r === last ? BAR_LAST : BAR} />)}
            </Bar>
            <Line type="monotone" dataKey="trend" stroke={LINE} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: LINE, stroke: '#fffbfa', strokeWidth: 2 }} isAnimationActive={animate} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="note">Bars are each month’s sales (last full month darker; the current month is pale until it ends). The line smooths them out to show the real direction.</p>
    </section>
  )
}
