import { confirmDiscardChanges } from './app/dirty-state.js'
import { useCallback, useEffect, useState } from 'react'
import { AppRouteGuard } from './app/AppRouteGuard.jsx'
import { isBusinessPath, normalizePathname, ROUTES } from './app/routes.js'
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx'
import { AdminPage } from './pages/AdminPage.jsx'
import { LandingPage } from './pages/LandingPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { OwnerOnboardingPage } from './pages/OwnerOnboardingPage.jsx'
import { PendingApprovalPage } from './pages/PendingApprovalPage.jsx'
import { InactiveAccountPage } from './pages/InactiveAccountPage.jsx'
import { SetPasswordPage } from './pages/SetPasswordPage.jsx'
import { SignupCallbackPage } from './pages/SignupCallbackPage.jsx'
import { SignupPage } from './pages/SignupPage.jsx'

function readPathname() {
  return normalizePathname(window.location.pathname)
}

function App() {
  const [pathname, setPathname] = useState(readPathname)

  useEffect(() => {
    function handlePopState() {
      if (!confirmDiscardChanges()) { window.history.pushState(null, '', pathname); return }
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

  if (pathname === ROUTES.authCallback) return <AuthCallbackPage />
  if (pathname === ROUTES.signupCallback) return <SignupCallbackPage />
  if (pathname === ROUTES.setPassword) return <SetPasswordPage />
  if (pathname === ROUTES.login) return <LoginPage />
  if (pathname === ROUTES.signup) return <SignupPage />
  if (pathname === ROUTES.ownerOnboarding) return <OwnerOnboardingPage />
  if (pathname === ROUTES.pendingApproval) return <PendingApprovalPage />
  if (pathname === ROUTES.inactiveAccount) return <InactiveAccountPage />
  if (pathname === ROUTES.admin) return <AdminPage />
  if (isBusinessPath(pathname)) {
    return <AppRouteGuard pathname={pathname} navigate={navigate} />
  }

  return <LandingPage navigate={navigate} />
}

export default App
