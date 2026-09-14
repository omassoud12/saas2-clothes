export function DashboardPage({ profile }) {
  return (
    <section className="business-page">
      <header className="business-page-heading">
        <span className="eyebrow">Store overview</span>
        <h1>Dashboard</h1>
        <p>
          Your operational overview for {profile.account.name}. Business data
          will populate these areas as each module is connected.
        </p>
      </header>

      <div className="dashboard-placeholder-grid">
        <article>
          <span>Catalog</span>
          <h2>Products</h2>
          <p>Product data will appear here once the Products module is connected.</p>
        </article>
        <article>
          <span>Stock</span>
          <h2>Inventory</h2>
          <p>Inventory activity will appear here once stock workflows are connected.</p>
        </article>
        <article>
          <span>Transactions</span>
          <h2>Sales</h2>
          <p>Sales activity will appear here once the POS module is connected.</p>
        </article>
        <article className="store-status-card">
          <span>Store status</span>
          <h2>Active</h2>
          <p>Your store is approved and ready for business modules.</p>
        </article>
      </div>
    </section>
  )
}
