import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from './lib/supabase.js'
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx'
import { AuthenticatedStatusPage } from './pages/AuthenticatedStatusPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { OwnerOnboardingPage } from './pages/OwnerOnboardingPage.jsx'
import { PendingApprovalPage } from './pages/PendingApprovalPage.jsx'
import { SetPasswordPage } from './pages/SetPasswordPage.jsx'
import { SignupCallbackPage } from './pages/SignupCallbackPage.jsx'
import { SignupPage } from './pages/SignupPage.jsx'

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  if (pathname === '/auth/callback') return <AuthCallbackPage />
  if (pathname === '/auth/signup-callback') return <SignupCallbackPage />
  if (pathname === '/set-password') return <SetPasswordPage />
  if (pathname === '/login') return <LoginPage />
  if (pathname === '/signup') return <SignupPage />
  if (pathname === '/owner/onboarding') return <OwnerOnboardingPage />
  if (pathname === '/pending-approval') return <PendingApprovalPage />
  if (pathname === '/admin') return <AuthenticatedStatusPage destination="/admin" />
  if (pathname === '/app') return <AuthenticatedStatusPage destination="/app" />

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
