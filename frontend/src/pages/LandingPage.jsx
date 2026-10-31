import { LANDING_CTA_ROUTES } from '../app/landing-flow.js'
import { useI18n } from '../i18n/I18nContext.js'
import { LanguageSwitch } from '../i18n/LanguageSwitch.jsx'

function InternalLink({ children, className, navigate, to }) {
  function follow(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
    window.scrollTo(0, 0)
  }

  return <a className={className} href={to} onClick={follow}>{children}</a>
}

function Brand() {
  const { t } = useI18n()
  return <a className="landing-brand" href="#top" aria-label={t('SaaS2 Clothes home')}><span aria-hidden="true">S2</span><strong>{t('SaaS2 —')} <i>{t('Clothes')}</i></strong></a>
}

function ProductPreview() {
  const { t } = useI18n()
  return <div className="landing-product-preview" role="img" aria-label={t('Illustrative SaaS2 dashboard preview showing inventory, recent sales, and business metrics')}>
    <div className="preview-window">
      <div className="preview-sidebar" aria-hidden="true"><span className="preview-logo">S2</span><i /><i /><i className="is-active" /><i /><i /></div>
      <div className="preview-content">
        <div className="preview-topline"><div><small>{t('Store overview')}</small><strong>{t('Good morning')}</strong></div><span>{t('Illustrative preview')}</span></div>
        <div className="preview-metrics">
          <div className="is-highlighted"><small>{t('Net revenue')}</small><strong>{t('2,480.00 USD')}</strong><span>{t('Today')}</span></div>
          <div><small>{t('Sales')}</small><strong>24</strong><span>{t('38 units')}</span></div>
          <div><small>{t('Active products')}</small><strong>128</strong><span>{t('Catalog')}</span></div>
        </div>
        <div className="preview-grid">
          <div className="preview-inventory"><div className="preview-section-title"><strong>{t('Inventory')}</strong><span>{t('Current stock')}</span></div>
            <div><span><i className="preview-swatch is-sage" />{t('Linen Shirt')} <small>{t('LIN-SAGE-M')}</small></span><strong>18</strong></div>
            <div><span><i className="preview-swatch is-stone" />{t('Classic Trouser')} <small>{t('TRS-STN-32')}</small></span><strong>11</strong></div>
            <div><span><i className="preview-swatch is-rose" />{t('Everyday Tee')} <small>{t('TEE-RSE-S')}</small></span><strong>26</strong></div>
          </div>
          <div className="preview-activity"><div className="preview-section-title"><strong>{t('Recent sales')}</strong><span>{t('Connected operations')}</span></div><div className="preview-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><p><strong>{t('Connected records')}</strong><span>{t('Sales update stock automatically.')}</span></p></div>
        </div>
      </div>
    </div>
    <div className="preview-float preview-float--stock"><small>{t('Stock movement')}</small><strong>+24</strong><span>{t('Restock recorded')}</span></div>
    <div className="preview-float preview-float--sale"><span aria-hidden="true">✓</span><div><small>{t('Sale completed')}</small><strong>{t('Stock updated')}</strong></div></div>
  </div>
}

const featureGroups = [
  ['Catalog', 'Build a clean sellable catalog.', ['Categories and products', 'Color and size variants', 'Primary product images']],
  ['Inventory', 'Know what is available by variant.', ['Current stock', 'Owner-controlled restocking', 'Movement history and reconciliation']],
  ['Sales', 'Keep every stock-changing event connected.', ['Point of sale and history', 'Returns and exchanges', 'Authorized sale voiding']],
  ['Business', 'Review operations and financial performance.', ['Business dashboard', 'Expense history', 'Daily and summary reports']],
]

const workflow = [
  ['01', 'Organize the catalog', 'Add categories, products, and the variants customers actually buy.'],
  ['02', 'Bring stock in', 'Record restocks and maintain a clear movement trail.'],
  ['03', 'Complete the sale', 'Choose available variants and sell through the connected POS.'],
  ['04', 'Handle what follows', 'Process returns, exchanges, or an authorized void against the original sale.'],
  ['05', 'Review the business', 'See sales activity, expenses, and authoritative financial reports.'],
]

export function LandingPage({ navigate }) {
  const { t } = useI18n()
  const year = new Date().getFullYear()
  return <div className="landing-page" id="top">
    <a className="landing-skip" href="#landing-content">{t('Skip to content')}</a>
    <header className="landing-header">
      <div className="landing-shell landing-header-inner">
        <Brand />
        <nav className="landing-nav" aria-label={t('Landing page')}><a href="#product">{t('Product')}</a><a href="#features">{t('Features')}</a><a href="#workflow">{t('Workflow')}</a></nav><LanguageSwitch className="landing-language" />
        <div className="landing-auth-actions"><InternalLink className="landing-login" navigate={navigate} to={LANDING_CTA_ROUTES.login}>{t('Login')}</InternalLink><InternalLink className="landing-button landing-button--small" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>{t('Create Account')}</InternalLink></div>
      </div>
    </header>

    <main className="landing-main" id="landing-content">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-shell landing-hero-grid">
          <div className="landing-hero-copy"><span className="landing-kicker">{t('Clothing store management, connected')}</span><h1 id="landing-title">{t('Run your clothing store from one connected system.')}</h1><p>{t('Manage products, variants, stock, sales, returns, expenses, and business performance from one organized workspace.')}</p>
            <div className="landing-hero-actions"><InternalLink className="landing-button" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>{t('Create Account')} <span aria-hidden="true">→</span></InternalLink><InternalLink className="landing-button landing-button--secondary" navigate={navigate} to={LANDING_CTA_ROUTES.login}>{t('Login')}</InternalLink></div>
            <p className="landing-hero-note"><span aria-hidden="true">✓</span> {t('Designed for owners and operational teams.')}</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="landing-summary" aria-label={t('Product summary')}><div className="landing-shell"><p><strong>{t('One store workspace.')}</strong> {t('From stock to sale.')}</p><ul><li>{t('Products')}</li><li>{t('Inventory')}</li><li>{t('Sales')}</li><li>{t('Business insights')}</li></ul></div></section>

      <section className="landing-section landing-problem" id="product"><div className="landing-shell landing-problem-grid"><div><span className="landing-kicker">{t('A clearer operating picture')}</span><h2>{t('Store operations should not live in disconnected records.')}</h2></div><div><p>{t('Products and variants change. Stock moves with every restock, sale, return, and exchange. Expenses affect the financial picture.')}</p><p>{t('SaaS2 brings those records into one deliberate workflow, so the information your team uses stays connected to the work they perform.')}</p></div></div></section>

      <section className="landing-section landing-features" id="features" aria-labelledby="features-title"><div className="landing-shell"><div className="landing-section-heading"><span className="landing-kicker">{t('The complete workflow')}</span><h2 id="features-title">{t('Built around how a clothing store operates.')}</h2><p>{t('Every module has a clear job, while sharing the same catalog, stock, and sales history.')}</p></div><div className="landing-feature-grid">{featureGroups.map(([name, description, items]) => <article key={name}><span>{name}</span><h3>{t(description)}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></div></section>

      <section className="landing-section landing-workflow" id="workflow" aria-labelledby="workflow-title"><div className="landing-shell"><div className="landing-section-heading is-centered"><span className="landing-kicker">{t('One connected flow')}</span><h2 id="workflow-title">{t('Follow the product from catalog to report.')}</h2></div><ol>{workflow.map(([number, title, copy]) => <li key={number}><span>{number}</span><div><h3>{t(title)}</h3><p>{copy}</p></div></li>)}</ol></div></section>

      <section className="landing-section landing-showcase" aria-label={t('Product interface highlights')}><div className="landing-shell landing-showcase-stack">
        <article><div className="showcase-copy"><span className="landing-kicker">{t('Inventory')}</span><h2>{t('Know what is in stock.')}</h2><p>{t('See current stock by product and variant, record owner-authorized restocks, and review the movements that explain each change.')}</p></div><div className="showcase-ui inventory-ui" aria-hidden="true"><header><strong>{t('Inventory')}</strong><span>{t('128 products')}</span></header><div><span><i className="preview-swatch is-sage" /> {t('Linen Shirt')} <small>{t('Sage / M · LIN-SAGE-M')}</small></span><b>18 <small>{t('in stock')}</small></b></div><div><span><i className="preview-swatch is-stone" /> {t('Classic Trouser')} <small>{t('Stone / 32 · TRS-STN-32')}</small></span><b>11 <small>{t('in stock')}</small></b></div><div><span><i className="preview-swatch is-rose" /> {t('Everyday Tee')} <small>{t('Rose / S · TEE-RSE-S')}</small></span><b>26 <small>{t('in stock')}</small></b></div></div></article>
        <article className="is-reversed"><div className="showcase-copy"><span className="landing-kicker">{t('Point of sale')}</span><h2>{t('Move from product to completed sale quickly.')}</h2><p>{t('Search the active catalog, build a precise cart, and let each confirmed sale update inventory through the same transaction.')}</p></div><div className="showcase-ui pos-ui" aria-hidden="true"><header><strong>{t('Current sale')}</strong><span>{t('3 units')}</span></header><div><span>{t('Linen Shirt')} <small>{t('Sage / M')}</small></span><b>{t('48.00 USD')}</b></div><div><span>{t('Everyday Tee')} <small>{t('Rose / S × 2')}</small></span><b>{t('56.00 USD')}</b></div><footer><span>{t('Total')}</span><strong>{t('104.00 USD')}</strong></footer></div></article>
        <article><div className="showcase-copy"><span className="landing-kicker">{t('Business visibility')}</span><h2>{t('Review an authoritative financial picture.')}</h2><p>{t('Owners can examine revenue, returns, voids, expenses, COGS, and profit through daily or summary reporting—without exposing sensitive figures to operational roles.')}</p></div><div className="showcase-ui report-ui" aria-hidden="true"><header><strong>{t('Daily report')}</strong><span>{t('Today')}</span></header><div><small>{t('Net revenue')}</small><strong>{t('2,480.00 USD')}</strong></div><div><small>{t('Operating expenses')}</small><strong>{t('320.00 USD')}</strong></div><footer><span>{t('Net profit')}</span><strong>{t('1,124.00 USD')}</strong></footer></div></article>
      </div></section>

      <section className="landing-section landing-roles"><div className="landing-shell landing-roles-grid"><div><span className="landing-kicker">{t('Access with purpose')}</span><h2>{t('The right workspace for each responsibility.')}</h2><p>{t('Keep day-to-day operations moving while protecting sensitive business information.')}</p></div><div className="role-list"><article><span>{t('Owner')}</span><div><h3>{t('Manage the whole business')}</h3><p>{t('Control the catalog, restock, sell, manage expenses, and review financial performance.')}</p></div></article><article><span>{t('Warehouse')}</span><div><h3>{t('Work without financial exposure')}</h3><p>{t('Manage permitted catalog operations, complete sales, and process returns or exchanges without access to costs or profit.')}</p></div></article></div></div></section>

      <section className="landing-workspace"><div className="landing-shell"><div><span className="landing-kicker">{t('Your store. Your team. Your workspace.')}</span><h2>{t('Each business operates inside its own organized account.')}</h2></div><p>{t('Products, inventory, sales, and reports stay within the store workspace your team is authorized to use.')}</p></div></section>

      <section className="landing-section landing-final-cta"><div className="landing-shell"><span className="landing-kicker">{t('A more organized operation')}</span><h2>{t('Ready to bring your clothing store into one workspace?')}</h2><p>{t('Set up your business account and start with the catalog you already know.')}</p><div><InternalLink className="landing-button landing-button--light" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>{t('Create Account')} <span aria-hidden="true">→</span></InternalLink><InternalLink className="landing-button landing-button--outline" navigate={navigate} to={LANDING_CTA_ROUTES.login}>{t('Login')}</InternalLink></div></div></section>
    </main>

    <footer className="landing-footer"><div className="landing-shell landing-footer-grid"><div><Brand /><p>{t('Connected clothing-store operations, from catalog to report.')}</p></div><nav aria-label={t('Footer')}><a href="#product">{t('Product')}</a><a href="#features">{t('Features')}</a><InternalLink navigate={navigate} to={LANDING_CTA_ROUTES.login}>{t('Login')}</InternalLink><InternalLink navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>{t('Create Account')}</InternalLink></nav></div><div className="landing-shell landing-footer-bottom"><span>{t('© {year} SaaS2 — Clothes', { year })}</span><span>{t('Built by UltraScaling Solutions')}</span></div></footer>
  </div>
}
