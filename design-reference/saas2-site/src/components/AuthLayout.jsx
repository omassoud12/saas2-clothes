import { Link } from 'react-router-dom';
import HeroSilk from './HeroSilk.jsx';

// Shared frame for Log in and Sign up: a silk panel (top band on phones, left half on wide screens)
// and a stitched card holding the form.

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <HeroSilk fill />
        <div className="auth__aside-inner">
          <Link to="/" className="auth__brand" aria-label="SaaS2 home">
            <span className="brand__mark">S2</span>
            <span className="brand__name">SaaS2</span>
          </Link>
          <p className="auth__quote">Your shop, ready when you are.</p>
          <div className="glass auth__glass" aria-hidden="true">
            <span className="glass__label">Sales today</span>
            <span className="glass__value">$184 · 9 receipts</span>
          </div>
        </div>
      </aside>

      <main className="auth__main" id="content">
        <div className="auth-card">
          <h1 className="auth-card__title">{title}</h1>
          <p className="auth-card__subtitle">{subtitle}</p>
          {children}
          <p className="auth-card__footer">{footer}</p>
        </div>
      </main>
    </div>
  );
}
