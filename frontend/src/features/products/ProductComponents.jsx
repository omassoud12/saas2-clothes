import { useState } from 'react'
import { canEditVariantPrice } from './product-flow.js'
import { formatMoney, summarizeProductCatalog } from '../../lib/money.js'


export function ProductImage({ url, name, revision = 0, status }) {
  const [failed, setFailed] = useState(false)
  return <span className="product-image-frame">{url && !failed
    ? <img key={`${url}-${revision}`} src={url} alt={name} onError={() => setFailed(true)} />
    : <span className="product-image-placeholder" aria-label={failed || status === 'unavailable' ? 'Photo unavailable' : 'No product image'}><span aria-hidden="true">&#9671;</span><small>{failed || status === 'unavailable' ? 'Photo unavailable' : 'No image'}</small></span>}
  </span>
}

export function ProductIdentityForm({ draft, change, categories, categoriesLoading = false, editing, busy, submit, cancel, error }) {
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <div className="product-form-grid">
      <div><label htmlFor="catalog-product-name">Product name</label><input id="catalog-product-name" autoFocus required maxLength={150} value={draft.name} disabled={busy} placeholder="e.g. Linen shirt" onChange={(event) => change({ ...draft, name: event.target.value })} /></div>
      <div><label htmlFor="catalog-product-category">Category</label><select id="catalog-product-category" required value={draft.categoryId} disabled={busy || categories.length === 0} onChange={(event) => change({ ...draft, categoryId: event.target.value })}>
        <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></div>
    </div>
    {categoriesLoading && <p className="product-muted">Loading categories...</p>}
    {!categoriesLoading && categories.length === 0 && <p className="product-muted">Add a category first in <a href="/app/categories">Categories</a>.</p>}
    <div className="product-actions"><button type="submit" disabled={busy || categories.length === 0}>{busy ? 'Saving...' : editing ? 'Save product' : 'Save & add sizes' }</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

export function VariantForm({ draft, change, editing, busy, submit, cancel, role, currency, error }) {
  const fields = [
    ['color', 'Color'], ['size', 'Size'],
    ...(canEditVariantPrice(role) ? [['sellingPrice', `Selling price per piece${currency ? ` (${currency})` : ''}`]] : []),
  ]
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <h3>{editing ? 'Edit color / size' : 'Add a color / size'}</h3><p className="product-muted">One option per color and size. For example: Black / M.</p>
    <div className="product-form-grid">{fields.map(([field, label, required]) => <div key={field}><label htmlFor={`catalog-variant-${field}`}>{label}</label><input id={`catalog-variant-${field}`} autoFocus={field === 'color'} placeholder={field === 'color' ? 'e.g. Black' : field === 'size' ? 'e.g. M' : 'e.g. 15.00'} value={draft[field]} required={Boolean(required)} maxLength={field === 'sellingPrice' ? undefined : 100} inputMode={field === 'sellingPrice' ? 'decimal' : undefined} disabled={busy} onChange={(event) => change({ ...draft, [field]: event.target.value })} /></div>)}</div>
    <details className="product-optional"><summary>Product code & barcode</summary><div className="product-form-grid"><div><label htmlFor="catalog-variant-sku">Product code (SKU)</label><input id="catalog-variant-sku" maxLength={100} value={draft.sku} disabled={busy} onChange={(event) => change({ ...draft, sku: event.target.value })} /><small>A unique code is filled in for you. You can change it.</small></div><div><label htmlFor="catalog-variant-barcode">Barcode (optional)</label><input id="catalog-variant-barcode" maxLength={100} value={draft.barcode} disabled={busy} onChange={(event) => change({ ...draft, barcode: event.target.value })} /></div></div></details>
    <p className="product-muted">{role === 'OWNER' ? ' Save this option, then open Restock to receive a delivery.' : ' An owner can set the selling price and add stock after you save.'}</p>
    <div className="product-actions"><button type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Save color / size'}</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

export function ProductCatalogCard({ product, currency, select, listVersion, imageRevision }) {
  const aggregate = product.catalogSummary
  const summary = aggregate ? {stock:aggregate.availableStock,inactiveStock:aggregate.inactiveStock,price:aggregate.priceMin===null?'Price unavailable':aggregate.priceMin===aggregate.priceMax?formatMoney(aggregate.priceMin,currency):`${formatMoney(aggregate.priceMin,currency)} - ${formatMoney(aggregate.priceMax,currency)}`} : summarizeProductCatalog(product, currency)
  const optionCount = aggregate ? aggregate.activeVariantCount + aggregate.inactiveVariantCount : product.variants.length
  return <div className="product-card">
    <span className="product-row-identity"><ProductImage key={`${product.imageUrl || product.id}-${listVersion}`} url={product.imageUrl} status={product.imageStatus} name={product.name} revision={imageRevision} /><strong>{product.name}</strong></span>
    <span className="product-row-category"><span className="product-cell-label">Category</span>{product.category.name}</span>
    <span className="product-row-count"><span className="product-cell-label">Variants</span>{optionCount}</span>
    <span className="product-row-stock"><span className="product-cell-label">Stock</span>{summary.stock} <small>available</small>{summary.inactiveStock !== '0' && <small>{summary.inactiveStock} inactive</small>}</span>
    <span className="product-row-price"><span className="product-cell-label">Selling price</span>{summary.price}</span>
    <span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? 'Active' : 'Inactive'}</span>
    <span className="sr-only" id={`product-summary-${product.id}`}>{product.category.name}. {optionCount} variants. {summary.stock} units in stock. {summary.price}. {product.isActive ? 'Active' : 'Inactive'}.</span>
    <span className="product-row-open"><button type="button" className="text-button product-card-open" onClick={select} aria-label={`View product: ${product.name}`} aria-describedby={`product-summary-${product.id}`}>View product</button></span>
  </div>
}
