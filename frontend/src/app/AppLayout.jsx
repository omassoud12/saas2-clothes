import { lazy, Suspense, useEffect, useState } from 'react'
import {
  getBusinessShellIdentity,
  logoutBusinessApp,
} from './app-flow.js'
import { resolveAppRoute } from './app-navigation.js'
import { AppHeader } from './AppHeader.jsx'
import { AppSidebar } from './AppSidebar.jsx'
import { LoadingState } from '../components/ui/index.jsx'
import { supabase } from '../lib/supabase.js'

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })))
}

const pageComponents = Object.freeze({
  dashboard: lazyNamed(() => import('../pages/app/DashboardPage.jsx'), 'DashboardPage'),
  products: lazyNamed(() => import('../pages/app/ProductsPage.jsx'), 'ProductsPage'),
  categories: lazyNamed(() => import('../pages/app/CategoriesPage.jsx'), 'CategoriesPage'),
  inventory: lazyNamed(() => import('../pages/app/InventoryPage.jsx'), 'InventoryPage'),
  sales: lazyNamed(() => import('../pages/app/SalesPage.jsx'), 'SalesPage'),
  returns: lazyNamed(() => import('../pages/app/ReturnsPage.jsx'), 'ReturnsPage'),
  exchanges: lazyNamed(() => import('../pages/app/ExchangesPage.jsx'), 'ExchangesPage'),
  expenses: lazyNamed(() => import('../pages/app/ExpensesPage.jsx'), 'ExpensesPage'),
  reports: lazyNamed(() => import('../pages/app/ReportsPage.jsx'), 'ReportsPage'),
})

export function AppLayout({ pathname, navigate, profile }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const identity = getBusinessShellIdentity(profile)
  const resolvedRoute = resolveAppRoute(pathname, identity.role)
  const Page = pageComponents[resolvedRoute.route.key]

  useEffect(() => {
    if (resolvedRoute.redirectTo) {
      navigate(resolvedRoute.redirectTo, { replace: true })
    }
  }, [navigate, resolvedRoute.redirectTo])

  useEffect(() => {
    if (!mobileMenuOpen) return undefined

    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileMenuOpen])

  async function handleLogout() {
    if (loggingOut) return

    setLoggingOut(true)
    setLogoutError('')
    setMobileMenuOpen(false)
    const result = await logoutBusinessApp({
      supabase,
      redirect: (path) => window.location.replace(path),
    })

    if (!result.ok) {
      setLogoutError(result.message)
      setLoggingOut(false)
    }
  }

  return (
    <div className="business-shell">
      <AppSidebar
        identity={identity}
        mobileOpen={mobileMenuOpen}
        pathname={pathname}
        onClose={() => setMobileMenuOpen(false)}
        onNavigate={navigate}
      />
      {mobileMenuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="business-workspace">
        <AppHeader
          identity={identity}
          loggingOut={loggingOut}
          mobileMenuOpen={mobileMenuOpen}
          onLogout={handleLogout}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        <main className="business-content">
          {logoutError && (
            <p className="business-alert error-message" role="alert">
              {logoutError}
            </p>
          )}
          <Suspense fallback={<LoadingState label="Loading page" />}>
            <Page profile={profile} navigate={navigate} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
