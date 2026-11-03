import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { getBusinessShellIdentity } from './app-flow.js'
import { resolveAppRoute } from './app-navigation.js'
import { AppHeader } from './AppHeader.jsx'
import { AppSidebar } from './AppSidebar.jsx'
import { BottomNav } from './BottomNav.jsx'
import { MoreSheet } from './MoreSheet.jsx'
import { LoadingState } from '../components/ui/index.jsx'
import { useLogout } from './useLogout.js'
import { NotFoundPage } from '../pages/NotFoundPage.jsx'
import { ROUTES } from './routes.js'
import { useI18n } from '../i18n/I18nContext.js'

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })))
}

const pageComponents = Object.freeze({
  dashboard: lazyNamed(() => import('../pages/app/DashboardPage.jsx'), 'DashboardPage'),
  products: lazyNamed(() => import('../pages/app/ProductsPage.jsx'), 'ProductsPage'),
  categories: lazyNamed(() => import('../pages/app/CategoriesPage.jsx'), 'CategoriesPage'),
  inventory: lazyNamed(() => import('../pages/app/InventoryPage.jsx'), 'InventoryPage'),
  sales: lazyNamed(() => import('../pages/app/SalesPage.jsx'), 'SalesPage'),
  history: lazyNamed(() => import('../pages/app/HistoryPage.jsx'), 'HistoryPage'),
  returns: lazyNamed(() => import('../pages/app/ReturnsPage.jsx'), 'ReturnsPage'),
  exchanges: lazyNamed(() => import('../pages/app/ExchangesPage.jsx'), 'ExchangesPage'),
  expenses: lazyNamed(() => import('../pages/app/ExpensesPage.jsx'), 'ExpensesPage'),
  settings: lazyNamed(() => import('../pages/app/SettingsPage.jsx'), 'SettingsPage'),
  business: lazyNamed(() => import('../pages/app/BusinessPage.jsx'), 'BusinessPage'),
  dashboardCosts: lazyNamed(() => import('../features/dashboard/CostsPage.jsx'), 'CostsPage'),
  ...(import.meta.env.DEV ? {
    textMatchingLab: lazyNamed(() => import('../pages/app/TextMatchingLabPage.jsx'), 'TextMatchingLabPage'),
  } : {}),
})

export function AppLayout({ pathname, navigate, profile }) {
  const { t } = useI18n()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const { loggingOut, logoutError, logout } = useLogout()
  const menuTrigger = useRef(null)
  const identity = getBusinessShellIdentity(profile)
  const resolvedRoute = resolveAppRoute(pathname, identity.role, import.meta.env.DEV)
  const Page = pageComponents[resolvedRoute.route?.key] || NotFoundPage

  useEffect(() => {
    if (resolvedRoute.redirectTo) {
      navigate(resolvedRoute.redirectTo, { replace: true })
    }
  }, [navigate, resolvedRoute.redirectTo])

  useEffect(() => {
    if (!mobileMenuOpen) return undefined

    const sidebar = document.getElementById('business-sidebar')
    const previousOverflow = document.body.style.overflow
    menuTrigger.current = document.activeElement
    document.body.style.overflow = 'hidden'
    sidebar?.querySelector('button:not(:disabled), a[href]')?.focus()

    function handleMenuKey(event) {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = sidebar ? [...sidebar.querySelectorAll('button:not(:disabled), a[href]')] : []
      if (focusable.length === 0) return
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault()
        focusable.at(-1).focus()
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault()
        focusable[0].focus()
      }
    }

    window.addEventListener('keydown', handleMenuKey)
    return () => {
      window.removeEventListener('keydown', handleMenuKey)
      document.body.style.overflow = previousOverflow
      menuTrigger.current?.focus?.()
    }
  }, [mobileMenuOpen])

  // The on-screen keyboard covers the bottom bar, so it steps aside while a text field has focus.
  useEffect(() => {
    const textTypes = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number'])
    const isTextField = (node) => node instanceof HTMLElement && (
      node.tagName === 'TEXTAREA' || node.isContentEditable || (node.tagName === 'INPUT' && textTypes.has(node.type)))
    const onFocusIn = (event) => setTyping(isTextField(event.target))
    const onFocusOut = () => setTyping(false)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  async function handleLogout() {
    const result = await logout()
    if (result) { setMobileMenuOpen(false); setMoreOpen(false) }
  }

  return (
    <div className={`business-shell${typing ? ' is-keyboard-open' : ''}`}>
      <AppSidebar
        identity={identity}
        mobileOpen={mobileMenuOpen}
        pathname={pathname}
        onClose={() => setMobileMenuOpen(false)}
        onNavigate={navigate}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      />
      {mobileMenuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label={t('Close navigation')}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="business-workspace">
        <AppHeader
          identity={identity}
          mobileMenuOpen={mobileMenuOpen}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        <main className="business-content">
          {logoutError && (
            <p className="business-alert error-message" role="alert">
              {logoutError}
            </p>
          )}
          <Suspense fallback={<LoadingState label={t('Loading page')} />}>
            <Page key={resolvedRoute.productId || resolvedRoute.route?.key || 'not-found'} profile={profile} navigate={navigate} productId={resolvedRoute.productId} homePath={ROUTES.dashboard} />
          </Suspense>
        </main>
      </div>
      <BottomNav role={identity.role} pathname={pathname} onNavigate={navigate} onOpenMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
      {moreOpen && (
        <MoreSheet
          role={identity.role}
          identity={identity}
          pathname={pathname}
          loggingOut={loggingOut}
          onNavigate={navigate}
          onLogout={handleLogout}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </div>
  )
}
