import {
  getAppNavigation,
  isNavigationItemActive,
} from './app-navigation.js'

function NavigationIcon({ name }) {
  const paths = {
    dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    products: <><path d="M7 4h10l2 4-7 12L5 8l2-4Z" /><path d="M9 8h6" /></>,
    categories: <><path d="M4 7h7v5H4zM13 7h7v5h-7zM4 14h7v5H4zM13 14h7v5h-7z" /></>,
    entry: <><path d="M4 13v7h16v-7M12 3v11m-4-4 4 4 4-4" /><path d="M4 13h4l2 3h4l2-3h4" /></>,
    sales: <><path d="M5 5h14v14H5z" /><path d="M8 9h8M8 13h5M8 16h3" /></>,
    returns: <><path d="M9 7 5 11l4 4" /><path d="M5 11h9a5 5 0 0 1 5 5" /></>,
    exchanges: <><path d="m7 7-3 3 3 3" /><path d="M4 10h13" /><path d="m17 17 3-3-3-3" /><path d="M20 14H7" /></>,
    expenses: <><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.5-1-3.5-1.2-4.5.2-1 1.5.5 2.3 2 2.6 1.5.3 3 1.1 2 2.6-1 1.4-4 1.2-4.5.1M12 7v10" /></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7" /></>,
  }

  return (
    <svg className="business-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  )
}

export function AppSidebar({
  identity,
  mobileOpen,
  onClose,
  onNavigate,
  pathname,
  loggingOut,
  onLogout,
}) {
  const navigation = getAppNavigation(identity.role)

  function handleNavigation(event, path) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    onNavigate(path)
    onClose()
  }

  return (
    <aside
      className={`business-sidebar${mobileOpen ? ' is-open' : ''}`}
      id="business-sidebar"
    >
      <div className="business-brand">
        <span className="business-brand-mark" aria-hidden="true">C</span>
        <div>
          <strong>SaaS2 Clothes</strong>
          <span>Retail operations</span>
        </div>
        <button
          className="sidebar-close-button"
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
        >
          &times;
        </button>
      </div>

      <div className="sidebar-store-context">
        <span>Store</span>
        <strong>{identity.storeName}</strong>
        <small>{identity.role}</small>
      </div>

      <nav className="business-navigation" aria-label="Business modules">
        {navigation.map((item) => {
          const active = isNavigationItemActive(pathname, item.path)
          return (
            <a
              className={active ? 'is-active' : undefined}
              href={item.path}
              key={item.key}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => handleNavigation(event, item.path)}
            >
              <NavigationIcon name={item.icon} />
              <span>{item.label}</span>
            </a>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-logout-button" type="button" disabled={loggingOut} onClick={onLogout}>
          <svg className="business-nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H4v16h5M10 12h10m-4-4 4 4-4 4" /></svg>
          <span>{loggingOut ? 'Signing out...' : 'Logout'}</span>
        </button>
        <p className="sidebar-security-note">Access is scoped to your authenticated store.</p>
      </div>
    </aside>
  )
}
