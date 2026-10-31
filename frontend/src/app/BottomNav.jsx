import { getMobileNavigation, isNavigationItemActive, isPlainLeftClick } from './app-navigation.js'
import { NavigationIcon } from './AppSidebar.jsx'

// Phone navigation: Home, Products, Sell (center), History and More. Shown only on narrow screens (see index.css).
export function BottomNav({ role, pathname, onNavigate, onOpenMore, moreOpen }) {
  const { bar, more } = getMobileNavigation(role)
  const moreActive = more.some((item) => isNavigationItemActive(pathname, item.path))

  function follow(event, path) {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    onNavigate(path)
  }

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <ul>
        {bar.map((item) => {
          const active = isNavigationItemActive(pathname, item.path)
          const primary = item.key === 'sales'
          return (
            <li key={item.key}>
              <a
                className={[active ? 'is-active' : '', primary ? 'is-primary' : ''].filter(Boolean).join(' ') || undefined}
                href={item.path}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => follow(event, item.path)}
              >
                <span className="bottom-nav-icon"><NavigationIcon name={item.icon} /></span>
                <span>{item.mobileLabel || item.label}</span>
              </a>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            className={moreActive ? 'is-active' : undefined}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={onOpenMore}
          >
            <span className="bottom-nav-icon"><NavigationIcon name="more" /></span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
