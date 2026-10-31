import { useI18n } from '../i18n/I18nContext.js'
function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function AppHeader({
  identity,
  mobileMenuOpen,
  onOpenMenu,
}) {
  const { t } = useI18n()
  return (
    <header className="business-header">
      <div className="business-header-title">
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={t('Open navigation')}
          aria-controls="business-sidebar"
          aria-expanded={mobileMenuOpen}
          onClick={onOpenMenu}
        >
          <MenuIcon />
        </button>
        <div className="business-store-identity">
          <strong className="business-store-name" title={identity.storeName}><bdi>{identity.storeName}</bdi></strong>
        </div>
      </div>

      <div className="business-user-menu">
        <div className="business-user-copy">
          <strong>{identity.userName}</strong>
          <span>{identity.role}</span>
        </div>
      </div>
    </header>
  )
}
