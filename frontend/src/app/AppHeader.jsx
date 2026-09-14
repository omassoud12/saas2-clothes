function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function AppHeader({
  identity,
  loggingOut,
  onLogout,
  onOpenMenu,
}) {
  return (
    <header className="business-header">
      <div className="business-header-title">
        <button
          className="mobile-menu-button"
          type="button"
          aria-label="Open navigation"
          aria-controls="business-sidebar"
          onClick={onOpenMenu}
        >
          <MenuIcon />
        </button>
        <div>
          <span>Current store</span>
          <strong>{identity.storeName}</strong>
        </div>
      </div>

      <div className="business-user-menu">
        <div className="business-user-copy">
          <strong>{identity.userName}</strong>
          <span>{identity.role}</span>
        </div>
        <button
          className="business-logout-button"
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
        >
          {loggingOut ? 'Signing out...' : 'Logout'}
        </button>
      </div>
    </header>
  )
}
