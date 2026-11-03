import { formatUsd } from '../../../lib/money.js'
import { Skeleton } from '../States.jsx'

// Sales target (week or month): progress bar with a tick for "where you should be by tonight".
// `children` adds lines under the bar (Monthly: projection and last month for reference).
export default function TargetCard({ title, sales, target, live, loading, children }) {
  if (loading) return <section className="bcard" aria-busy="true"><Skeleton height={18} width="40%" /><Skeleton height={14} /></section>
  if (!target) return children ? <section className="bcard">{children}</section> : null
  const { value, progress, expectedByNow } = target
  const p = Math.round(progress * 100)
  const gap = sales - value * expectedByNow
  return (
    <section className="bcard" aria-label={title}>
      <div className="bcard__row">
        <h2 className="bcard__title">{title}</h2>
        <span className="bcard__meta"><strong className="ink">{formatUsd(Math.round(sales))}</strong> / {formatUsd(value)}</span>
      </div>
      <div className="target" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(p, 100)} aria-label={`${p}% of the target`}>
        <span className="target__fill" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
        {live && expectedByNow < 1 && <span className="target__pace" style={{ left: `${expectedByNow * 100}%` }} title="Where you should be by the end of today" />}
      </div>
      <p className="target__text">
        <strong>{p}%</strong>
        {progress >= 1 ? ' · target reached' : live
          ? (gap >= 0 ? ` · ${formatUsd(Math.round(gap))} ahead of pace` : ` · ${formatUsd(Math.round(-gap))} behind pace`)
          : ` · missed by ${formatUsd(Math.round(value - sales))}`}
      </p>
      {children}
    </section>
  )
}
