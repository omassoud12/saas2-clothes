import { useCallback, useEffect, useMemo, useState } from 'react'
import { findLandingRedirect } from '../app/landing-flow.js'
import { ROUTES } from '../app/routes.js'
import { supabase } from '../lib/supabase.js'
import { Footer } from './components/Footer.jsx'
import { Navbar } from './components/Navbar.jsx'
import { About } from './pages/About.jsx'
import { Contact } from './pages/Contact.jsx'
import { Home } from './pages/Home.jsx'
import { loadSiteFonts, SiteRouterContext, splitSiteHref } from './site-router.js'
import './site.css'

const PAGES = { [ROUTES.home]: Home, [ROUTES.about]: About, [ROUTES.contact]: Contact }

const readHash = () => (typeof window === 'undefined' ? '' : window.location.hash)

// The public site: landing (/), about and contact. Ported from design-reference/saas2-site.
export function SiteRoot({ pathname, navigate }) {
  // Signed-in users who open "/" go straight to the app, so the landing waits for the session check.
  const [auth, setAuth] = useState(supabase ? 'checking' : 'signed-out')
  const [hashState, setHashState] = useState(() => ({ hash: readHash(), seq: 0 }))

  useEffect(() => {
    loadSiteFonts()
    if (!supabase) return undefined
    let active = true
    void findLandingRedirect(supabase).then((redirect) => {
      if (active) setAuth(redirect ? 'signed-in' : 'signed-out')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (auth === 'signed-in' && pathname === ROUTES.home) navigate(ROUTES.app, { replace: true })
  }, [auth, pathname, navigate])

  useEffect(() => {
    function handlePopState() {
      setHashState((current) => ({ hash: readHash(), seq: current.seq + 1 }))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const waiting = pathname === ROUTES.home && auth !== 'signed-out'

  // Scroll to the linked section, or to the top on a new page.
  useEffect(() => {
    if (waiting) return
    const target = hashState.hash ? document.getElementById(hashState.hash.slice(1)) : null
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hashState, waiting])

  const go = useCallback((to) => {
    const target = splitSiteHref(to)
    if (target.pathname === pathname) window.history.pushState(null, '', target.pathname + target.hash)
    else navigate(target.pathname + target.hash)
    setHashState((current) => ({ hash: target.hash, seq: current.seq + 1 }))
  }, [navigate, pathname])

  const router = useMemo(() => ({ pathname, go }), [pathname, go])
  const Page = PAGES[pathname] ?? Home

  if (waiting) return <div className="site" dir="ltr" lang="en" />

  return (
    <SiteRouterContext.Provider value={router}>
      <div className="site" dir="ltr" lang="en">
        <a className="skip-link" href="#content">Skip to content</a>
        <Navbar />
        <main id="content">
          <Page />
        </main>
        <Footer />
      </div>
    </SiteRouterContext.Provider>
  )
}
