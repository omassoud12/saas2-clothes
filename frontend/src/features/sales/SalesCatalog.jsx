import { useState } from 'react'

export function SalesProductImage({ product }) {
  const [failedUrl, setFailedUrl] = useState(null)
  return <span className="sale-product-photo">{product.imageUrl && product.imageUrl !== failedUrl
    ? <img src={product.imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(product.imageUrl)} />
    : <span className="sale-photo-placeholder"><svg viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden="true"><path d="m17 8-11 6 5 10 6-3v19h14V21l6 3 5-10-11-6c-1 5-13 5-14 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg><small>No photo</small></span>}
  </span>
}

export function SalesCatalog({ products, busy, onOpen }) {
  return <div className="sale-product-grid">{products.map((product) => <button
    key={product.id} type="button" className="sale-product-tile" disabled={busy}
    aria-label={`View ${product.name}`}
    onClick={() => onOpen(product)}>
    <SalesProductImage product={product} />
    <span className="sale-product-name">{product.name}</span>
  </button>)}</div>
}
