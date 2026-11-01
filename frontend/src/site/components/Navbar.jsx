import { useState } from 'react'
import { CloseIcon, MenuIcon } from './Icons.jsx'
import { SiteLink } from './SiteLink.jsx'

const sectionLinks = [
  { to: '/#product', label: 'Product' },
  { to: '/#business', label: 'Business types' },
  { to: '/#features', label: 'Features' },
  { to: '/#hardware', label: 'Hardware' },
]

const pageLinks = [
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

export function Navbar() {
  const [open, setOpen] = useState(false)
  // The mobile menu closes whenever a link is followed.
  const close = () => setOpen(false)

  return (
    <header className="nav">
      <div className="container nav__bar">
        <SiteLink to="/" className="brand" aria-label="SaaS2 home" onNavigate={close}>
          <span className="brand__mark">S2</span>
          <span className="brand__name">SaaS2</span>
        </SiteLink>

        <nav className="nav__links" aria-label="Main">
          {sectionLinks.map((l) => (
            <SiteLink key={l.to} to={l.to}>{l.label}</SiteLink>
          ))}
          {pageLinks.map((l) => (
            <SiteLink key={l.to} to={l.to} nav>{l.label}</SiteLink>
          ))}
        </nav>

        <button
          type="button"
          className="nav__burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="nav__sheet" aria-label="Mobile">
          {sectionLinks.map((l) => (
            <SiteLink key={l.to} to={l.to} onNavigate={close}>{l.label}</SiteLink>
          ))}
          {pageLinks.map((l) => (
            <SiteLink key={l.to} to={l.to} nav onNavigate={close}>{l.label}</SiteLink>
          ))}
        </nav>
      )}
    </header>
  )
}
