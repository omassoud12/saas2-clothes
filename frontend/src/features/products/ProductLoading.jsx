import { Skeleton } from '../../components/ui/index.jsx'

export function ProductLoading({ label, rows = 3 }) {
  return <div className="product-loading" role="status" aria-live="polite" aria-busy="true">
    <p>{label}</p>
    <div aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div className="product-loading-row" key={index}><Skeleton className="product-loading-block" /><div><Skeleton /><Skeleton /></div></div>)}</div>
  </div>
}
