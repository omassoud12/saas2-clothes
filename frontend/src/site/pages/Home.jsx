import { ROUTES } from '../../app/routes.js'
import { HeroSilk } from '../components/HeroSilk.jsx'
import { HeroStitch } from '../components/HeroStitch.jsx'
import { LaptopIcon, PhoneIcon, TabletIcon } from '../components/Icons.jsx'
import { RackShowcase } from '../components/RackShowcase.jsx'
import { SiteLink } from '../components/SiteLink.jsx'
import { StepStack } from '../components/StepStack.jsx'
import { allFeatures, contact, faqs, features } from '../data.js'
import { useSeo } from '../useSeo.js'

export function Home() {
  useSeo(
    'SaaS2 · POS for clothing shops in Lebanon',
    'SaaS2 is a point of sale for clothing shops in Lebanon. Sell from your phone, track sizes and colors, take USD or LBP, record debt customers, and share receipts on WhatsApp.'
  )

  return (
    <>
      <section className="hero3d">
        <HeroSilk />
        <div className="hero3d__fade" aria-hidden="true" />
        <HeroStitch />
        <div className="container hero3d__content">
          <h1 className="hero__title">Your clothing shop, on your phone.</h1>
          <p className="lead" style={{ maxWidth: '40ch' }}>Sell in dollars or lira, and track every size.</p>
          <div className="hero__actions">
            <SiteLink to="/contact" className="btn btn--primary">Book a free demo</SiteLink>
            <SiteLink to={ROUTES.login} className="text-link">Log in</SiteLink>
          </div>
        </div>
      </section>

      <section id="product" className="section section--soft" aria-labelledby="product-title">
        <div className="container product">
          <div className="product__intro stack" style={{ gap: 12 }}>
            <h2 id="product-title" className="section-title">One app for your whole shop</h2>
            <p className="lead" style={{ fontSize: 16 }}>Rent an account, open it in your browser, and start selling.</p>
            <p className="product__price">From <strong>{contact.price}</strong> a month · every feature included</p>
          </div>
          <StepStack />
        </div>
      </section>

      <section id="business" className="section" aria-labelledby="business-title">
        <div className="container stack" style={{ gap: 20 }}>
          <h2 id="business-title" className="section-title">Made for shops that sell in sizes and colors</h2>
          <RackShowcase />
        </div>
      </section>

      <section id="features" className="section section--soft" aria-labelledby="features-title">
        <div className="container stack" style={{ gap: 24 }}>
          <h2 id="features-title" className="section-title">What you can do</h2>
          <div className="tiles">
            {features.map((f) => (
              <div key={f.title} className="tile">
                <h3 className="tile__title" style={{ fontFamily: 'var(--font-body)' }}>{f.title}</h3>
                <p className="tile__text">{f.text}</p>
              </div>
            ))}
          </div>
          <details className="disclosure">
            <summary>See the full feature list<span className="disclosure__plus" aria-hidden="true">+</span></summary>
            <ul className="disclosure__list">
              {allFeatures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </details>
        </div>
      </section>

      <section id="hardware" className="section" aria-labelledby="hardware-title">
        <div className="container stack" style={{ gap: 20 }}>
          <h2 id="hardware-title" className="section-title">Use the devices you already have</h2>
          <div className="devices">
            <div className="device"><PhoneIcon />Phone</div>
            <div className="device"><TabletIcon />Tablet</div>
            <div className="device"><LaptopIcon />Laptop</div>
          </div>
          <p className="lead" style={{ fontSize: 15, maxWidth: '52ch' }}>
            All you need is internet and a recent browser. A 58 or 80 mm receipt printer is optional.
          </p>
        </div>
      </section>

      <section id="faq" className="section section--soft" aria-labelledby="faq-title">
        <div className="container stack" style={{ maxWidth: 720 }}>
          <h2 id="faq-title" className="section-title" style={{ fontSize: 'clamp(24px, 5.5vw, 32px)' }}>Questions</h2>
          <div className="faq">
            {faqs.map((f) => (
              <details key={f.q} className="disclosure">
                <summary>{f.q}<span className="disclosure__plus" aria-hidden="true">+</span></summary>
                <p className="disclosure__body">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="cta-title">
        <div className="container stack" style={{ alignItems: 'flex-start' }}>
          <h2 id="cta-title" className="section-title" style={{ maxWidth: '20ch' }}>See it with products like yours</h2>
          <SiteLink to="/contact" className="btn btn--primary">Book a free demo</SiteLink>
        </div>
      </section>
    </>
  )
}
