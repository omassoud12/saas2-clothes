import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner" style={{ maxWidth: 1080, margin: '0 auto' }}>
        <span>© {new Date().getFullYear()} UltraScaling · SaaS2</span>
        <nav className="footer__links" aria-label="Footer">
          <Link to="/about">About</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
