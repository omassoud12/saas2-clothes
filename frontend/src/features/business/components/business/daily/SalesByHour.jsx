import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Small chart of sales per hour: the busiest hour is darker and named under the chart.
const label = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return <div className="tip"><strong>{formatUsd(Math.round(d.sales))}</strong><span>{label(d.hour)}–{label(d.hour + 1)}</span></div>
}

export default function SalesByHour({ data, loading, animate }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="40%" /><Skeleton height={110} /></section>
  if (!data.hours.length) return null
  const peak = data.hours.reduce((a, h) => (h.sales > a.sales ? h : a), data.hours[0])
  return (
    <section className="bcard" aria-labelledby="hr-title">
      <div className="bcard__row">
        <h2 id="hr-title" className="bcard__title">Sales by hour</h2>
        {peak.sales > 0 && <span className="bcard__meta">Busiest {label(peak.hour)}–{label(peak.hour + 1)}</span>}
      </div>
      <div className="chart-box" style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.hours} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
            <XAxis dataKey="hour" tickFormatter={label} tickLine={false} axisLine={{ stroke: '#e3cfc9' }} tick={{ fill: '#6e6461', fontSize: 11 }} interval="preserveStartEnd" />
            <Tooltip content={<Tip />} cursor={{ fill: 'rgba(154, 78, 92, 0.06)' }} />
            <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={animate}>
              {data.hours.map((h) => <Cell key={h.hour} fill={h.hour === peak.hour ? '#a8455c' : '#e2b0aa'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
