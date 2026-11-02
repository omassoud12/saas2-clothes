import {
  getAppNavigation,
  isNavigationItemActive,
} from './app-navigation.js'
import { useI18n } from '../i18n/I18nContext.js'
import { LanguageSwitch } from '../i18n/LanguageSwitch.jsx'

export function NavigationIcon({ name }) {
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
    business: <><path d="M4 19h16" /><path d="m5 15 4-5 4 3 6-7" /><path d="M15 6h4v4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68M12 8v4l2.6 1.6" /></>,
    more: <><path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" /></>,
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
  const { t } = useI18n()
  const navigation = getAppNavigation(identity.role)
  const storeInitial = [...String(identity.storeName || 'S').trim()][0]?.toLocaleUpperCase() || 'S'

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
          <strong>{t('SaaS2 Clothes')}</strong>
          <span>{t('Retail operations')}</span>
        </div>
        <button
          className="sidebar-close-button"
          type="button"
          aria-label={t('Close navigation')}
          onClick={onClose}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div className="sidebar-store-context">
        <span className="sidebar-store-mark" aria-hidden="true">{storeInitial}</span>
        <div className="sidebar-store-copy">
          <small>{t('Current store')}</small>
          <strong>{identity.storeName}</strong>
        </div>
        <span className="sidebar-role-badge">{identity.role}</span>
      </div>

      <p className="sidebar-navigation-label">{t('Workspace')}</p>
      <nav className="business-navigation" aria-label={t('Business modules')}>
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
              <span>{t(item.label)}</span>
            </a>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-logout-button" type="button" disabled={loggingOut} onClick={onLogout}>
          <svg className="business-nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H4v16h5M10 12h10m-4-4 4 4-4 4" /></svg>
          <span>{loggingOut ? t('Signing out...') : t('Logout')}</span>
        </button>
        <LanguageSwitch className="sidebar-language" />
        <p className="sidebar-security-note">{t('Access is scoped to your authenticated store.')}</p>
      </div>
    </aside>
  )
}
