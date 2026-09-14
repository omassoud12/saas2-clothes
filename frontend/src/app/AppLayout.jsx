import { useEffect, useState } from 'react'
import {
  getBusinessShellIdentity,
  logoutBusinessApp,
} from './app-flow.js'
import { resolveAppRoute } from './app-navigation.js'
import { AppHeader } from './AppHeader.jsx'
import { AppSidebar } from './AppSidebar.jsx'
import { CategoriesPage } from '../pages/app/CategoriesPage.jsx'
import { DashboardPage } from '../pages/app/DashboardPage.jsx'
import { ExpensesPage } from '../pages/app/ExpensesPage.jsx'
import { InventoryPage } from '../pages/app/InventoryPage.jsx'
import { ProductsPage } from '../pages/app/ProductsPage.jsx'
import { ReportsPage } from '../pages/app/ReportsPage.jsx'
import { SalesPage } from '../pages/app/SalesPage.jsx'
import { supabase } from '../lib/supabase.js'

const pageComponents = Object.freeze({
  dashboard: DashboardPage,
  products: ProductsPage,
  categories: CategoriesPage,
  inventory: InventoryPage,
  sales: SalesPage,
  expenses: ExpensesPage,
  reports: ReportsPage,
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
          onLogout={handleLogout}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        <main className="business-content">
          {logoutError && (
            <p className="business-alert error-message" role="alert">
              {logoutError}
            </p>
          )}
          <Page profile={profile} />
        </main>
      </div>
    </div>
  )
}
