import { confirmDiscardChanges } from './app/dirty-state.js'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { AppRouteGuard } from './app/AppRouteGuard.jsx'
import { isBusinessPath, isSitePath, normalizePathname, ROUTES } from './app/routes.js'
import { NotFoundPage } from './pages/NotFoundPage.jsx'
// The public site stays in the first download: it is small, and it is the first thing a visitor sees,
// so loading it on demand would add a whole round trip before the landing page appears.
import { SiteRoot } from './site/SiteRoot.jsx'

// The app shell and the public site are in the first download. Every other screen (login, signup,
// admin...) is its own file, fetched the first time it is opened.
function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })))
}
const AuthCallbackPage = lazyNamed(() => import('./pages/AuthCallbackPage.jsx'), 'AuthCallbackPage')
const AdminPage = lazyNamed(() => import('./pages/AdminPage.jsx'), 'AdminPage')
const LoginPage = lazyNamed(() => import('./pages/LoginPage.jsx'), 'LoginPage')
const OwnerOnboardingPage = lazyNamed(() => import('./pages/OwnerOnboardingPage.jsx'), 'OwnerOnboardingPage')
const PendingApprovalPage = lazyNamed(() => import('./pages/PendingApprovalPage.jsx'), 'PendingApprovalPage')
const InactiveAccountPage = lazyNamed(() => import('./pages/InactiveAccountPage.jsx'), 'InactiveAccountPage')
const SetPasswordPage = lazyNamed(() => import('./pages/SetPasswordPage.jsx'), 'SetPasswordPage')
const SignupCallbackPage = lazyNamed(() => import('./pages/SignupCallbackPage.jsx'), 'SignupCallbackPage')
const SignupPage = lazyNamed(() => import('./pages/SignupPage.jsx'), 'SignupPage')

function readPathname() {
  return normalizePathname(window.location.pathname)
}

/** While a screen's file is downloading: an empty page in the app's background colour (no flash). */
function ScreenLoading() {
  return <div className="screen-loading" aria-busy="true" />
}

function App() {
  const [pathname, setPathname] = useState(readPathname)

  useEffect(() => {
    function handlePopState(event) {
      if (!confirmDiscardChanges()) {
        window.history.pushState(null, '', pathname)
        event.stopImmediatePropagation()
        return
      }
      setPathname(readPathname())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [pathname])

  const navigate = useCallback((path, options = {}) => {
    if (!confirmDiscardChanges()) return
    if (options.replace) {
      window.history.replaceState(null, '', path)
    } else {
      window.history.pushState(null, '', path)
    }
    setPathname(readPathname())
  }, [])

  return <Suspense fallback={<ScreenLoading />}>{screenFor(pathname, navigate)}</Suspense>
}

function screenFor(pathname, navigate) {
  if (pathname === ROUTES.authCallback) return <AuthCallbackPage />
  if (pathname === ROUTES.signupCallback) return <SignupCallbackPage />
  if (pathname === ROUTES.setPassword) return <SetPasswordPage />
  if (pathname === ROUTES.login) return <LoginPage />
  if (pathname === ROUTES.signup) return <SignupPage />
  if (pathname === ROUTES.ownerOnboarding) return <OwnerOnboardingPage />
  if (pathname === ROUTES.pendingApproval) return <PendingApprovalPage />
  if (pathname === ROUTES.inactiveAccount) return <InactiveAccountPage />
  if (pathname === ROUTES.admin) return <AdminPage />
  if (pathname === ROUTES.textMatchingLab && !import.meta.env.DEV) return <NotFoundPage />
  if (isBusinessPath(pathname)) {
    return <AppRouteGuard pathname={pathname} navigate={navigate} />
  }

  return isSitePath(pathname) ? <SiteRoot pathname={pathname} navigate={navigate} /> : <NotFoundPage />
}

export default App
