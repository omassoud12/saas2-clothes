import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
  const menuTrigger = useRef(null)
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
