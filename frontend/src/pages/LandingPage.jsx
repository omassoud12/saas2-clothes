import { LANDING_CTA_ROUTES } from '../app/landing-flow.js'

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
  return <a className="landing-brand" href="#top" aria-label="SaaS2 Clothes home"><span aria-hidden="true">S2</span><strong>SaaS2 — <i>Clothes</i></strong></a>
}

function ProductPreview() {
  return <div className="landing-product-preview" role="img" aria-label="Illustrative SaaS2 dashboard preview showing inventory, recent sales, and business metrics">
    <div className="preview-window">
      <div className="preview-sidebar" aria-hidden="true"><span className="preview-logo">S2</span><i /><i /><i className="is-active" /><i /><i /></div>
      <div className="preview-content">
        <div className="preview-topline"><div><small>Store overview</small><strong>Good morning</strong></div><span>Illustrative preview</span></div>
        <div className="preview-metrics">
          <div className="is-highlighted"><small>Net revenue</small><strong>2,480.00 USD</strong><span>Today</span></div>
          <div><small>Sales</small><strong>24</strong><span>38 units</span></div>
          <div><small>Active products</small><strong>128</strong><span>Catalog</span></div>
        </div>
        <div className="preview-grid">
          <div className="preview-inventory"><div className="preview-section-title"><strong>Inventory</strong><span>Current stock</span></div>
            <div><span><i className="preview-swatch is-sage" />Linen Shirt <small>LIN-SAGE-M</small></span><strong>18</strong></div>
            <div><span><i className="preview-swatch is-stone" />Classic Trouser <small>TRS-STN-32</small></span><strong>11</strong></div>
            <div><span><i className="preview-swatch is-rose" />Everyday Tee <small>TEE-RSE-S</small></span><strong>26</strong></div>
          </div>
          <div className="preview-activity"><div className="preview-section-title"><strong>Recent sales</strong><span>Connected operations</span></div><div className="preview-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><p><strong>Connected records</strong><span>Sales update stock automatically.</span></p></div>
        </div>
      </div>
    </div>
    <div className="preview-float preview-float--stock"><small>Stock movement</small><strong>+24</strong><span>Restock recorded</span></div>
    <div className="preview-float preview-float--sale"><span aria-hidden="true">✓</span><div><small>Sale completed</small><strong>Stock updated</strong></div></div>
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
  const year = new Date().getFullYear()
  return <div className="landing-page" id="top">
    <a className="landing-skip" href="#landing-content">Skip to content</a>
    <header className="landing-header">
      <div className="landing-shell landing-header-inner">
        <Brand />
        <nav className="landing-nav" aria-label="Landing page"><a href="#product">Product</a><a href="#features">Features</a><a href="#workflow">Workflow</a></nav>
        <div className="landing-auth-actions"><InternalLink className="landing-login" navigate={navigate} to={LANDING_CTA_ROUTES.login}>Login</InternalLink><InternalLink className="landing-button landing-button--small" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>Create Account</InternalLink></div>
      </div>
    </header>

    <main className="landing-main" id="landing-content">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-shell landing-hero-grid">
          <div className="landing-hero-copy"><span className="landing-kicker">Clothing store management, connected</span><h1 id="landing-title">Run your clothing store from one connected system.</h1><p>Manage products, variants, stock, sales, returns, expenses, and business performance from one organized workspace.</p>
            <div className="landing-hero-actions"><InternalLink className="landing-button" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>Create Account <span aria-hidden="true">→</span></InternalLink><InternalLink className="landing-button landing-button--secondary" navigate={navigate} to={LANDING_CTA_ROUTES.login}>Login</InternalLink></div>
            <p className="landing-hero-note"><span aria-hidden="true">✓</span> Designed for owners and operational teams.</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="landing-summary" aria-label="Product summary"><div className="landing-shell"><p><strong>One store workspace.</strong> From stock to sale.</p><ul><li>Products</li><li>Inventory</li><li>Sales</li><li>Business insights</li></ul></div></section>

      <section className="landing-section landing-problem" id="product"><div className="landing-shell landing-problem-grid"><div><span className="landing-kicker">A clearer operating picture</span><h2>Store operations should not live in disconnected records.</h2></div><div><p>Products and variants change. Stock moves with every restock, sale, return, and exchange. Expenses affect the financial picture.</p><p>SaaS2 brings those records into one deliberate workflow, so the information your team uses stays connected to the work they perform.</p></div></div></section>

      <section className="landing-section landing-features" id="features" aria-labelledby="features-title"><div className="landing-shell"><div className="landing-section-heading"><span className="landing-kicker">The complete workflow</span><h2 id="features-title">Built around how a clothing store operates.</h2><p>Every module has a clear job, while sharing the same catalog, stock, and sales history.</p></div><div className="landing-feature-grid">{featureGroups.map(([name, description, items]) => <article key={name}><span>{name}</span><h3>{description}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></div></section>

      <section className="landing-section landing-workflow" id="workflow" aria-labelledby="workflow-title"><div className="landing-shell"><div className="landing-section-heading is-centered"><span className="landing-kicker">One connected flow</span><h2 id="workflow-title">Follow the product from catalog to report.</h2></div><ol>{workflow.map(([number, title, copy]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></div></section>

      <section className="landing-section landing-showcase" aria-label="Product interface highlights"><div className="landing-shell landing-showcase-stack">
        <article><div className="showcase-copy"><span className="landing-kicker">Inventory</span><h2>Know what is in stock.</h2><p>See current stock by product and variant, record owner-authorized restocks, and review the movements that explain each change.</p></div><div className="showcase-ui inventory-ui" aria-hidden="true"><header><strong>Inventory</strong><span>128 products</span></header><div><span><i className="preview-swatch is-sage" /> Linen Shirt <small>Sage / M · LIN-SAGE-M</small></span><b>18 <small>in stock</small></b></div><div><span><i className="preview-swatch is-stone" /> Classic Trouser <small>Stone / 32 · TRS-STN-32</small></span><b>11 <small>in stock</small></b></div><div><span><i className="preview-swatch is-rose" /> Everyday Tee <small>Rose / S · TEE-RSE-S</small></span><b>26 <small>in stock</small></b></div></div></article>
        <article className="is-reversed"><div className="showcase-copy"><span className="landing-kicker">Point of sale</span><h2>Move from product to completed sale quickly.</h2><p>Search the active catalog, build a precise cart, and let each confirmed sale update inventory through the same transaction.</p></div><div className="showcase-ui pos-ui" aria-hidden="true"><header><strong>Current sale</strong><span>3 units</span></header><div><span>Linen Shirt <small>Sage / M</small></span><b>48.00 USD</b></div><div><span>Everyday Tee <small>Rose / S × 2</small></span><b>56.00 USD</b></div><footer><span>Total</span><strong>104.00 USD</strong></footer></div></article>
        <article><div className="showcase-copy"><span className="landing-kicker">Business visibility</span><h2>Review an authoritative financial picture.</h2><p>Owners can examine revenue, returns, voids, expenses, COGS, and profit through daily or summary reporting—without exposing sensitive figures to operational roles.</p></div><div className="showcase-ui report-ui" aria-hidden="true"><header><strong>Daily report</strong><span>Today</span></header><div><small>Net revenue</small><strong>2,480.00 USD</strong></div><div><small>Operating expenses</small><strong>320.00 USD</strong></div><footer><span>Net profit</span><strong>1,124.00 USD</strong></footer></div></article>
      </div></section>

      <section className="landing-section landing-roles"><div className="landing-shell landing-roles-grid"><div><span className="landing-kicker">Access with purpose</span><h2>The right workspace for each responsibility.</h2><p>Keep day-to-day operations moving while protecting sensitive business information.</p></div><div className="role-list"><article><span>Owner</span><div><h3>Manage the whole business</h3><p>Control the catalog, restock, sell, manage expenses, and review financial performance.</p></div></article><article><span>Warehouse</span><div><h3>Work without financial exposure</h3><p>Manage permitted catalog operations, complete sales, and process returns or exchanges without access to costs or profit.</p></div></article></div></div></section>

      <section className="landing-workspace"><div className="landing-shell"><div><span className="landing-kicker">Your store. Your team. Your workspace.</span><h2>Each business operates inside its own organized account.</h2></div><p>Products, inventory, sales, and reports stay within the store workspace your team is authorized to use.</p></div></section>

      <section className="landing-section landing-final-cta"><div className="landing-shell"><span className="landing-kicker">A more organized operation</span><h2>Ready to bring your clothing store into one workspace?</h2><p>Set up your business account and start with the catalog you already know.</p><div><InternalLink className="landing-button landing-button--light" navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>Create Account <span aria-hidden="true">→</span></InternalLink><InternalLink className="landing-button landing-button--outline" navigate={navigate} to={LANDING_CTA_ROUTES.login}>Login</InternalLink></div></div></section>
    </main>

    <footer className="landing-footer"><div className="landing-shell landing-footer-grid"><div><Brand /><p>Connected clothing-store operations, from catalog to report.</p></div><nav aria-label="Footer"><a href="#product">Product</a><a href="#features">Features</a><InternalLink navigate={navigate} to={LANDING_CTA_ROUTES.login}>Login</InternalLink><InternalLink navigate={navigate} to={LANDING_CTA_ROUTES.createAccount}>Create Account</InternalLink></nav></div><div className="landing-shell landing-footer-bottom"><span>© {year} SaaS2 — Clothes</span><span>Built by UltraScaling Solutions</span></div></footer>
  </div>
}
