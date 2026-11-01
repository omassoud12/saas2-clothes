import { createContext, useContext } from 'react'
import { normalizePathname } from '../app/routes.js'

// The public site uses the app's own History API router (App.jsx), not react-router.
// SiteRoot provides the current path and a go(to) that also handles "/#section" links.
export const SiteRouterContext = createContext({ pathname: '/', go: () => {} })

export function useSiteRouter() {
  return useContext(SiteRouterContext)
}

// "/#features" -> { pathname: '/', hash: '#features' }
export function splitSiteHref(to) {
  const index = to.indexOf('#')
  const path = index === -1 ? to : to.slice(0, index)
  const hash = index === -1 ? '' : to.slice(index)
  return { pathname: normalizePathname(path || '/'), hash: hash === '#' ? '' : hash }
}

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&display=swap'

// The site's Google Fonts are added only when a public page opens, so the app never loads them.
export function loadSiteFonts(doc = document) {
  if (doc.getElementById('site-fonts')) return false
  for (const [href, crossOrigin] of [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]]) {
    const link = doc.createElement('link')
    link.rel = 'preconnect'
    link.href = href
    if (crossOrigin) link.crossOrigin = ''
    doc.head.appendChild(link)
  }
  const link = doc.createElement('link')
  link.id = 'site-fonts'
  link.rel = 'stylesheet'
  link.href = FONTS_HREF
  doc.head.appendChild(link)
  return true
}
