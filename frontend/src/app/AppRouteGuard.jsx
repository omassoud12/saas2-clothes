import { useEffect, useRef, useState } from 'react'
import { loadBusinessAppProfile } from './app-flow.js'
import { AppLayout } from './AppLayout.jsx'
import { Button, Card, ErrorState, LoadingState } from '../components/ui/index.jsx'
import { supabase } from '../lib/supabase.js'

export function AppRouteGuard({ pathname, navigate }) {
  const profilePromise = useRef(null)
  const [state, setState] = useState({ kind: 'loading' })

  useEffect(() => {
    if (!profilePromise.current) {
      profilePromise.current = loadBusinessAppProfile({ supabase })
    }

    let active = true
    void profilePromise.current.then((result) => {
      if (!active) return

      if (result.ok) {
        setState({ kind: 'ready', profile: result.profile })
      } else if (result.redirectTo) {
        window.location.replace(result.redirectTo)
      } else {
        setState({ kind: 'error', message: result.message })
      }
    })

    return () => {
      active = false
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <main className="foundation-page">
        <Card className="auth-card">
          <span className="eyebrow">Store workspace</span>
          <h1>Opening your workspace...</h1>
          <LoadingState label="Loading your account and store" />
        </Card>
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main className="foundation-page">
        <Card className="auth-card">
          <span className="eyebrow">Store workspace</span>
          <ErrorState
            title="Workspace unavailable"
            description={state.message}
            action={<Button onClick={() => window.location.reload()}>Try again</Button>}
          />
        </Card>
      </main>
    )
  }

  return (
    <AppLayout
      pathname={pathname}
      navigate={navigate}
      profile={state.profile}
    />
  )
}
