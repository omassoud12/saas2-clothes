import { HeroSilk } from '../components/HeroSilk.jsx'
import { HeroStitch } from '../components/HeroStitch.jsx'
import { SiteLink } from '../components/SiteLink.jsx'
import { StepStack } from '../components/StepStack.jsx'
import { contact } from '../data.js'

export function Home() {
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
            <a href="#features" className="text-link">See features</a>
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
        </div>
      </section>

      <section id="features" className="section section--soft" aria-labelledby="features-title">
        <div className="container stack" style={{ gap: 24 }}>
          <h2 id="features-title" className="section-title">What you can do</h2>
        </div>
      </section>

      <section id="hardware" className="section" aria-labelledby="hardware-title">
        <div className="container stack" style={{ gap: 20 }}>
          <h2 id="hardware-title" className="section-title">Use the devices you already have</h2>
        </div>
      </section>
    </>
  )
}
