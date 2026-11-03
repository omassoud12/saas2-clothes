import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { MenuIcon, CloseIcon } from './Icons.jsx';

const sectionLinks = [
  { to: '/#product', label: 'Product' },
  { to: '/#business', label: 'Business types' },
  { to: '/#features', label: 'Features' },
  { to: '/#hardware', label: 'Hardware' },
];

const pageLinks = [
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
  { to: '/login', label: 'Log in' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route or section changes.
  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header className="nav">
      <div className="container nav__bar">
        <Link to="/" className="brand" aria-label="SaaS2 home">
          <span className="brand__mark">S2</span>
          <span className="brand__name">SaaS2</span>
        </Link>

        <nav className="nav__links" aria-label="Main">
          {sectionLinks.map((l) => (
            <Link key={l.to} to={l.to}>{l.label}</Link>
          ))}
          {pageLinks.map((l) => (
            <NavLink key={l.to} to={l.to}>{l.label}</NavLink>
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
            <Link key={l.to} to={l.to}>{l.label}</Link>
          ))}
          {pageLinks.map((l) => (
            <NavLink key={l.to} to={l.to}>{l.label}</NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
