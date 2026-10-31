import { useState } from 'react'
import { canEditVariantPrice } from './product-flow.js'
import { formatMoney, summarizeProductCatalog } from '../../lib/money.js'
import { useI18n } from '../../i18n/I18nContext.js'


export function ProductImage({ url, name, revision = 0, status }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  return <span className="product-image-frame">{url && !failed
    ? <img key={`${url}-${revision}`} src={url} alt={name} onError={() => setFailed(true)} />
    : <span className="product-image-placeholder" aria-label={failed || status === 'unavailable' ? t('Photo unavailable') : t('No product image')}><svg aria-hidden="true" width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 32 32"><path d="m10 5-7 5 4 7 3-2v13h12V15l3 2 4-7-7-5-3 3h-6l-3-3Z" /></svg><small>{failed || status === 'unavailable' ? t('Photo unavailable') : t('No image')}</small></span>}
  </span>
}

export function ProductIdentityForm({ draft, change, categories, categoriesLoading = false, editing, busy, submit, cancel, error }) {
  const { t } = useI18n()
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <div className="product-form-grid">
      <div><label htmlFor="catalog-product-name">{t('Product name')}</label><input id="catalog-product-name" autoFocus required maxLength={150} value={draft.name} disabled={busy} placeholder={t('e.g. Linen shirt')} onChange={(event) => change({ ...draft, name: event.target.value })} /></div>
      <div><label htmlFor="catalog-product-category">{t('Category')}</label><select id="catalog-product-category" required value={draft.categoryId} disabled={busy || categories.length === 0} onChange={(event) => change({ ...draft, categoryId: event.target.value })}>
        <option value="">{t('Choose a category')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></div>
    </div>
    {categoriesLoading && <p className="product-muted">{t('Loading categories...')}</p>}
    {!categoriesLoading && categories.length === 0 && <p className="product-muted">{t('Add a category first in')} <a href="/app/categories">{t('Categories')}</a>.</p>}
    <div className="product-actions"><button type="submit" disabled={busy || categories.length === 0}>{busy ? t('Saving...') : editing ? t('Save product') : t('Save & add sizes') }</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>{t('Cancel')}</button></div>
  </form>
}

export function VariantForm({ draft, change, editing, busy, submit, cancel, role, currency, error }) {
  const { t } = useI18n()
  const fields = [
    ['color', 'Color'], ['size', 'Size'],
    ...(canEditVariantPrice(role) ? [['sellingPrice', `Selling price per piece${currency ? ` (${currency})` : ''}`]] : []),
  ]
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <h3>{editing ? t('Edit color / size') : t('Add a color / size')}</h3><p className="product-muted">{t('One option per color and size. For example: Black / M.')}</p>
    <div className="product-form-grid">{fields.map(([field, label, required]) => <div key={field}><label htmlFor={`catalog-variant-${field}`}>{t(label)}</label><input id={`catalog-variant-${field}`} autoFocus={field === 'color'} placeholder={field === 'color' ? t('e.g. Black') : field === 'size' ? 'e.g. M' : 'e.g. 15.00'} value={draft[field]} required={Boolean(required)} maxLength={field === 'sellingPrice' ? undefined : 100} inputMode={field === 'sellingPrice' ? 'decimal' : undefined} disabled={busy} onChange={(event) => change({ ...draft, [field]: event.target.value })} /></div>)}</div>
    <details className="product-optional"><summary>{t('Product code & barcode')}</summary><div className="product-form-grid"><div><label htmlFor="catalog-variant-sku">{t('Product code (SKU)')}</label><input id="catalog-variant-sku" maxLength={100} value={draft.sku} disabled={busy} onChange={(event) => change({ ...draft, sku: event.target.value })} /><small>{t('A unique code is filled in for you. You can change it.')}</small></div><div><label htmlFor="catalog-variant-barcode">{t('Barcode (optional)')}</label><input id="catalog-variant-barcode" maxLength={100} value={draft.barcode} disabled={busy} onChange={(event) => change({ ...draft, barcode: event.target.value })} /></div></div></details>
    <p className="product-muted">{role === 'OWNER' ? t(' Save this option, then open Restock to receive a delivery.') : t(' An owner can set the selling price and add stock after you save.')}</p>
    <div className="product-actions"><button type="submit" disabled={busy}>{busy ? t('Saving...') : editing ? t('Save changes') : t('Save color / size')}</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>{t('Cancel')}</button></div>
  </form>
}

export function ProductCatalogCard({ product, currency, select, listVersion, imageRevision }) {
  const { t } = useI18n()
  const aggregate = product.catalogSummary
  const summary = aggregate ? {stock:aggregate.availableStock,inactiveStock:aggregate.inactiveStock,price:aggregate.priceMin===null?'Price unavailable':aggregate.priceMin===aggregate.priceMax?formatMoney(aggregate.priceMin,currency):`${formatMoney(aggregate.priceMin,currency)} - ${formatMoney(aggregate.priceMax,currency)}`} : summarizeProductCatalog(product, currency)
  const optionCount = aggregate ? aggregate.activeVariantCount + aggregate.inactiveVariantCount : product.variants.length
  return <div className="product-card">
    <span className="product-row-identity"><ProductImage key={`${product.imageUrl || product.id}-${listVersion}`} url={product.imageUrl} status={product.imageStatus} name="" revision={imageRevision} /><span className="product-row-copy"><strong title={product.name}>{product.name}</strong><span className="product-row-inline-category" title={product.category.name}>{product.category.name}</span></span></span>
    <span className="product-row-category"><span className="product-cell-label">{t('Category')}</span>{product.category.name}</span>
    <span className="product-row-metadata"><span className="product-row-count"><span className="product-cell-label">{t('Variants')}</span>{optionCount}<small className="product-row-count-suffix"> {t('variants')}</small></span>
      <span className={`product-row-stock ${summary.stock === '0' ? 'is-empty' : ''}`}><span className="product-cell-label">{t('Stock')}</span>{summary.stock === '0' ? <span>{t('Out of stock')}</span> : <span>{summary.stock} <small>{t('available')}</small></span>}{summary.inactiveStock !== '0' && <small className="product-row-inactive-stock">{t('{inactiveStock} inactive', { inactiveStock: summary.inactiveStock })}</small>}</span></span>
    <span className="product-row-price"><span className="product-cell-label">{t('Selling price')}</span>{summary.price}</span>
    <span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? t('Active') : t('Inactive')}</span>
    <span className="sr-only" id={`product-summary-${product.id}`}>{t('{name}. {optionCount} variants. {stock} units in stock. {price}.', { name: product.category.name, optionCount, stock: summary.stock, price: summary.price })} {product.isActive ? t('Active') : t('Inactive')}.</span>
    <span className="product-row-open"><button type="button" className="text-button product-card-open" onClick={select} aria-label={t('View product: {name}', { name: product.name })} aria-describedby={`product-summary-${product.id}`}>{t('View')} <span aria-hidden="true">→</span></button></span>
  </div>
}
