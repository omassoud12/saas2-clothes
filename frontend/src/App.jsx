import { useCallback, useEffect, useState } from 'react'
import { AppRouteGuard } from './app/AppRouteGuard.jsx'
import { isSupabaseConfigured } from './lib/supabase.js'
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx'
import { AdminPage } from './pages/AdminPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { OwnerOnboardingPage } from './pages/OwnerOnboardingPage.jsx'
import { PendingApprovalPage } from './pages/PendingApprovalPage.jsx'
import { SetPasswordPage } from './pages/SetPasswordPage.jsx'
import { SignupCallbackPage } from './pages/SignupCallbackPage.jsx'
import { SignupPage } from './pages/SignupPage.jsx'

function readPathname() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
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

  if (pathname === '/auth/callback') return <AuthCallbackPage />
  if (pathname === '/auth/signup-callback') return <SignupCallbackPage />
  if (pathname === '/set-password') return <SetPasswordPage />
  if (pathname === '/login') return <LoginPage />
  if (pathname === '/signup') return <SignupPage />
  if (pathname === '/owner/onboarding') return <OwnerOnboardingPage />
  if (pathname === '/pending-approval') return <PendingApprovalPage />
  if (pathname === '/admin') return <AdminPage />
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return <AppRouteGuard pathname={pathname} navigate={navigate} />
  }

  return <HomePage />
}

function HomePage() {
  const [apiStatus, setApiStatus] = useState('Checking…')

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable')
        return response.json()
      })
      .then(() => setApiStatus('Connected'))
      .catch(() => setApiStatus('Unavailable'))
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
