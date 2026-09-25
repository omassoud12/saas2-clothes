import { useCallback, useEffect, useState } from 'react'
import { AppRouteGuard } from './app/AppRouteGuard.jsx'
import { isBusinessPath, normalizePathname, ROUTES } from './app/routes.js'
import { apiRequest } from './lib/api-client.js'
import { isSupabaseConfigured } from './lib/supabase.js'
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx'
import { AdminPage } from './pages/AdminPage.jsx'
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
      setPathname(readPathname())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((path, options = {}) => {
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

  return <HomePage />
}

function HomePage() {
  const [apiStatus, setApiStatus] = useState('Checking…')

  useEffect(() => {
    let active = true
    void apiRequest({ path: '/api/health' }).then((result) => {
      if (active) setApiStatus(result.ok ? 'Connected' : 'Unavailable')
    })
    return () => { active = false }
  }, [])

  return (
    <main>
      <section className="card">
        <span className="eyebrow">Clothes inventory</span>
        <h1>Your new project is ready.</h1>
        <p>React, Node.js, and Supabase are wired together and ready for features.</p>
        <div className="statuses">
          <div><span>React</span><strong>Ready</strong></div>
          <div><span>Node API</span><strong>{apiStatus}</strong></div>
          <div><span>Supabase</span><strong>{isSupabaseConfigured ? 'Configured' : 'Add credentials'}</strong></div>
        </div>
      </section>
    </main>
  )
}

export default App
