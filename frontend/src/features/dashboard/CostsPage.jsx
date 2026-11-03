import { useEffect, useId, useState } from 'react'
import { ROUTES } from '../../app/routes.js'
import { useI18n } from '../../i18n/I18nContext.js'
import { formatUsd } from '../business/lib/money.js'
import {
  QUANTITY_CHIPS, asState, lbpToUsd, normalizeMoneyInput, unitCostPreview,
} from './owner-dashboard.js'
import { addCostEntry, loadCostHistory, loadMissingCost, loadSettings, loadStores, searchProducts } from './owner-api.js'
import '../business/styles/business.css'
import './owner-dashboard.css'
import useAsync from '../business/hooks/useAsync.js'

/** The value, settled for `ms` (the timer callback sets it, not the effect). */
function useSettled(value, ms) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

// "How much did one piece cost you?" Full screen on a phone, two columns from 900px.
// The server computes the unit cost (total ÷ pieces); the preview here uses the same rounding.

const cents = (value) => (value === null || value === undefined ? '—' : formatUsd(Number(value)))

function ProductSearch({ onPick }) {
  const { t } = useI18n()
  const id = useId()
  const [query, setQuery] = useState('')
  const text = useSettled(query.trim(), 300)
  const result = useAsync((options) => (text.length < 2 ? Promise.resolve(null) : searchProducts(text, options)), [text])
  const found = asState(result)
  const state = text.length < 2 || query.trim().length < 2 ? { kind: 'idle' }
    : found.kind === 'ready' && !found.refreshing ? { kind: 'ready', products: found.body?.products || [] }
      : found.kind === 'error' ? found : { kind: 'loading' }

  return (
    <div className="odash-stack">
      <label className="odash-field" htmlFor={id}>
        <span>{t('Find a product (name or barcode)')}</span>
        <input id={id} type="search" autoComplete="off" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('e.g. Linen shirt')} />
      </label>
      {state.kind === 'loading' && <span className="odash-skeleton" style={{ height: 44 }} aria-hidden="true" />}
      {state.kind === 'error' && <p className="odash-form-error" role="alert">{t(state.message)}</p>}
      {state.kind === 'ready' && state.products.length === 0 && <p className="odash-muted">{t('No product matches.')}</p>}
      {state.kind === 'ready' && state.products.length > 0 && (
        <ul className="odash-list">
          {state.products.map((product) => (
            <li key={product.id}><button type="button" className="odash-list__item" onClick={() => { onPick(product.id); setQuery('') }}><b>{product.name}</b><span aria-hidden="true">›</span></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MissingList({ onPick, version }) {
  const { t } = useI18n()
  const [state, setState] = useState({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    loadMissingCost({ signal: controller.signal })
      .then((body) => setState({ kind: 'ready', body }))
      .catch((error) => { if (error.name !== 'AbortError') setState({ kind: 'error', message: error.message }) })
    return () => controller.abort()
  }, [version])
  if (state.kind === 'loading') return <span className="odash-skeleton" style={{ height: 60 }} aria-hidden="true" />
  if (state.kind === 'error') return <p className="odash-form-error" role="alert">{t(state.message)}</p>
  if (!state.body.items.length) return <p className="odash-muted">{t('Every product has a cost. Your profit is exact.')}</p>
  return (
    <section className="odash-card odash-card--warn" aria-labelledby="odash-missing-title">
      <h2 id="odash-missing-title" className="odash-title">{t('Missing cost ({count})', { count: state.body.productCount })}</h2>
      <p className="odash-muted">{t('Set the cost of these products so your profit is right.')}</p>
      <ul className="odash-list">
        {state.body.items.slice(0, 8).map((item) => (
          <li key={item.id}>
            <button type="button" className="odash-list__item" onClick={() => onPick(item.id)}>
              <span><b>{item.name}</b><small>{Number(item.salesWithoutCost) > 0 ? t('{amount} sold without a cost', { amount: cents(item.salesWithoutCost) }) : t('{count} in stock', { count: item.stock })}</small></span>
              <span aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CostForm({ product, rate, stores, onSaved }) {
  const { t } = useI18n()
  const formId = useId()
  const [quantity, setQuantity] = useState(12)
  const [custom, setCustom] = useState('')
  const [total, setTotal] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [scope, setScope] = useState('all')
  const [picked, setPicked] = useState(() => new Set())
  const [addStock, setAddStock] = useState(false)
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const pieces = quantity === 'custom' ? Number(custom) : quantity
  const totalUsd = currency === 'LBP' ? lbpToUsd(total, rate) : normalizeMoneyInput(total)
  const each = Number.isInteger(pieces) && pieces > 0 && totalUsd ? unitCostPreview(totalUsd, pieces) : null
  const chosen = scope === 'all' ? product.variants.map((variant) => variant.id) : [...picked]
  const canSave = Boolean(each) && Number(each) >= 0.01 && chosen.length > 0 && !saving

  async function submit(event) {
    event.preventDefault()
    if (!canSave) {
      setError(!each ? t('Enter how many pieces and the total you paid.') : t('Choose at least one variant.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await addCostEntry(product.id, {
        quantity: pieces, totalCost: totalUsd,
        ...(scope === 'pick' ? { variantIds: chosen } : {}),
        ...(supplier.trim() ? { supplierName: supplier.trim() } : {}),
        ...(addStock ? { addToStock: { storeId: stores[0]?.id ?? null } } : {}),
      })
      onSaved(t('Saved: {amount} each on {count} variants', { amount: cents(result.unitCost), count: result.variantsUpdated }))
      setTotal(''); setSupplier(''); setAddStock(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="odash-card odash-form" onSubmit={submit} aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="odash-title">{t('New purchase price')}</h2>
      <fieldset className="odash-fieldset">
        <legend>{t('How many did you buy?')}</legend>
        <div className="odash-chips">
          {QUANTITY_CHIPS.map((value) => (
            <button key={value} type="button" className={`odash-chip ${quantity === value ? 'is-on' : ''}`} aria-pressed={quantity === value} onClick={() => setQuantity(value)}>
              {value === 12 ? t('12 (dozen)') : value}
            </button>
          ))}
          <button type="button" className={`odash-chip ${quantity === 'custom' ? 'is-on' : ''}`} aria-pressed={quantity === 'custom'} onClick={() => setQuantity('custom')}>{t('Other')}</button>
        </div>
        {quantity === 'custom' && (
          <label className="odash-field">
            <span>{t('Number of pieces')}</span>
            <input inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={custom} onChange={(event) => setCustom(event.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
        )}
      </fieldset>

      <fieldset className="odash-fieldset">
        <legend>{t('Total you paid')}</legend>
        <div className="odash-money-input">
          <input aria-label={t('Total you paid')} inputMode="decimal" autoComplete="off" value={total} onChange={(event) => setTotal(event.target.value)} placeholder={currency === 'USD' ? '96' : '8,600,000'} />
          <div className="odash-toggle" role="group" aria-label={t('Currency')}>
            {['USD', 'LBP'].map((code) => (
              <button key={code} type="button" aria-pressed={currency === code} className={currency === code ? 'is-on' : ''} disabled={code === 'LBP' && !rate} onClick={() => setCurrency(code)}>{code}</button>
            ))}
          </div>
        </div>
        {currency === 'LBP' && totalUsd && <p className="odash-muted">{t('= {amount} at {rate} LBP per $', { amount: cents(totalUsd), rate: Number(rate).toLocaleString('en-US') })}</p>}
        {!rate && <p className="odash-muted">{t('Set the exchange rate in Settings to enter LBP.')}</p>}
      </fieldset>

      <p className="odash-preview" aria-live="polite">{each ? t('= {amount} each', { amount: cents(each) }) : t('= … each')}</p>

      <fieldset className="odash-fieldset">
        <legend>{t('Apply to')}</legend>
        <label className="odash-radio"><input type="radio" name={`${formId}-scope`} checked={scope === 'all'} onChange={() => setScope('all')} /> {t('All variants ({count})', { count: product.variants.length })}</label>
        <label className="odash-radio"><input type="radio" name={`${formId}-scope`} checked={scope === 'pick'} onChange={() => setScope('pick')} /> {t('Choose variants')}</label>
        {scope === 'pick' && (
          <ul className="odash-checks">
            {product.variants.map((variant) => (
              <li key={variant.id}>
                <label className="odash-radio">
                  <input type="checkbox" checked={picked.has(variant.id)} onChange={() => setPicked((previous) => { const next = new Set(previous); if (next.has(variant.id)) next.delete(variant.id); else next.add(variant.id); return next })} />
                  <span>{variant.label}</span><small className="odash-num">{cents(variant.unitCost)}</small>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <label className="odash-field">
        <span>{t('Supplier (optional)')}</span>
        <input autoComplete="off" value={supplier} maxLength={200} onChange={(event) => setSupplier(event.target.value)} />
      </label>
      <label className="odash-radio odash-switch">
        <input type="checkbox" checked={addStock} onChange={(event) => setAddStock(event.target.checked)} />
        <span>{Number.isInteger(pieces) && pieces > 0 ? t('Also add these {count} pieces to stock', { count: pieces }) : t('Also add the pieces to stock')}{stores[0] ? ` · ${stores[0].name}` : ''}</span>
      </label>
      <p className="odash-muted">{t('Old sales keep their old cost. Only new sales use this price.')}</p>
      {error && <p className="odash-form-error" role="alert">{t(error)}</p>}
      <div className="odash-sticky">
        <button type="submit" className="odash-button" disabled={saving}>{saving ? t('Saving…') : each ? t('Save · {amount} each', { amount: cents(each) }) : t('Save')}</button>
      </div>
    </form>
  )
}

// The first page comes with the product; older pages are appended on request. Keyed by product + save.
function History({ productId, first }) {
  const { t, locale } = useI18n()
  const [pages, setPages] = useState({ kind: 'ready', items: first.items, cursor: first.nextCursor })
  async function more() {
    try {
      const body = await loadCostHistory(productId, pages.cursor)
      setPages((previous) => ({ kind: 'ready', items: [...previous.items, ...body.items], cursor: body.nextCursor }))
    } catch (error) {
      setPages((previous) => ({ ...previous, kind: 'error', message: error.message }))
    }
  }
  return (
    <section className="odash-card" aria-labelledby="odash-history-title">
      <h2 id="odash-history-title" className="odash-title">{t('Price history')}</h2>
      {pages.kind === 'loading' && <span className="odash-skeleton" style={{ height: 44 }} aria-hidden="true" />}
      {pages.kind === 'error' && <p className="odash-form-error" role="alert">{t(pages.message)}</p>}
      {pages.kind === 'ready' && pages.items.length === 0 && <p className="odash-muted">{t('No purchase price entered yet.')}</p>}
      {pages.items.length > 0 && (
        <ul className="odash-history">
          {pages.items.map((entry) => (
            <li key={entry.id}>
              <span><b className="odash-num">{t('{quantity} for {total} → {each} each', { quantity: entry.quantity, total: cents(entry.totalCost), each: cents(entry.unitCost) })}</b>
                <small>{new Date(entry.createdAt).toLocaleDateString(locale)} · {entry.allVariants ? t('All variants') : t('{count} variants', { count: entry.variantIds.length })}{entry.supplierName ? ` · ${entry.supplierName}` : ''}{entry.addedToStock ? ` · ${t('added to stock')}` : ''}</small></span>
            </li>
          ))}
        </ul>
      )}
      {pages.cursor && <button type="button" className="odash-button odash-button--ghost" onClick={() => void more()}>{t('Show older')}</button>}
    </section>
  )
}

export function CostsPage({ navigate }) {
  const { t, dir } = useI18n()
  const [productId, setProductId] = useState(null)
  const [rate, setRate] = useState(null)
  const [stores, setStores] = useState([])
  const [version, setVersion] = useState(0)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    loadSettings({ signal: controller.signal }).then((body) => setRate((body.settings ?? body).lbpPerUsd ?? null)).catch(() => {})
    loadStores({ signal: controller.signal }).then((body) => setStores(body.items || [])).catch(() => {})
    return () => controller.abort()
  }, [])

  const loaded = useAsync((options) => (productId ? loadCostHistory(productId, undefined, options) : Promise.resolve(null)), [productId, version])
  const product = !productId ? { kind: 'idle' } : asState(loaded)

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  const current = product.kind === 'ready' && product.body?.product.id === productId ? product.body.product : null

  return (
    <div className="biz odash odash-costs" dir={dir}>
      <header className="odash-head">
        <div>
          <a className="odash-back" href={ROUTES.dashboard} onClick={(event) => { event.preventDefault(); navigate(ROUTES.dashboard) }}>{dir === 'rtl' ? '→' : '←'} {t('Dashboard')}</a>
          <h1 className="odash-hello">{t('Product cost')}</h1>
        </div>
      </header>
      <div className="odash-grid">
        <div className="odash-col">
          <ProductSearch onPick={setProductId} />
          <MissingList onPick={setProductId} version={version} />
        </div>
        <div className="odash-col">
          {product.kind === 'idle' && <p className="odash-card odash-muted">{t('Choose a product to see its cost and enter a new purchase price.')}</p>}
          {product.kind !== 'idle' && !current && product.kind !== 'error' && <span className="odash-skeleton" style={{ height: 120 }} aria-hidden="true" />}
          {product.kind === 'error' && <p className="odash-form-error" role="alert">{t(product.message)}</p>}
          {current && (
            <>
              <section className="odash-card" aria-labelledby="odash-product-title">
                <h2 id="odash-product-title" className="odash-title">{current.name}</h2>
                <ul className="odash-variants">
                  {current.variants.map((variant) => (
                    <li key={variant.id}><span>{variant.label}</span><span className={`odash-num ${variant.unitCost ? '' : 'is-missing'}`}>{variant.unitCost ? t('{amount} each', { amount: cents(variant.unitCost) }) : t('No cost')}</span></li>
                  ))}
                </ul>
              </section>
              <CostForm key={`${current.id}-${version}`} product={current} rate={rate} stores={stores} onSaved={(message) => { setToast(message); setVersion((count) => count + 1) }} />
              <History key={`${current.id}-${version}`} productId={current.id} first={product.body} />
            </>
          )}
        </div>
      </div>
      {toast && <p className="odash-toast" role="status">{toast}</p>}
    </div>
  )
}
