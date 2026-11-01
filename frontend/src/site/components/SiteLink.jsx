import { splitSiteHref, useSiteRouter } from '../site-router.js'

// Stands in for react-router's Link (and NavLink with `nav`, which marks the current page).
export function SiteLink({ to, nav = false, onNavigate, children, ...rest }) {
  const { pathname, go } = useSiteRouter()

  function follow(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate?.()
    go(to)
  }

  const current = nav && splitSiteHref(to).pathname === pathname ? 'page' : undefined
  return <a href={to} aria-current={current} onClick={follow} {...rest}>{children}</a>
}
