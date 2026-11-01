import { SiteLink } from './SiteLink.jsx'

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner" style={{ maxWidth: 1080, margin: '0 auto' }}>
        <span>© {new Date().getFullYear()} UltraScaling · SaaS2</span>
        <nav className="footer__links" aria-label="Footer">
          <SiteLink to="/about">About</SiteLink>
          <SiteLink to="/contact">Contact</SiteLink>
        </nav>
      </div>
    </footer>
  )
}
