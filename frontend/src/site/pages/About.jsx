import { SiteLink } from '../components/SiteLink.jsx'
import { contact } from '../data.js'
import { useSeo } from '../useSeo.js'

const reasons = [
  { title: 'Two currencies at one counter', text: 'Prices in dollars, payments in dollars, lira or both, and change in either.' },
  { title: 'Customers who pay later', text: 'Debt is part of the relationship with regular customers, and it lived in a notebook.' },
  { title: 'Stock in sizes and colors', text: 'One shirt can be fifteen different items on the shelf.' },
  { title: 'Local ways to pay', text: 'Whish and OMT next to cash and card, on the same receipt.' },
]

const values = [
  { title: 'Fast at the counter', text: 'A sale should take seconds, even when the shop is full.' },
  { title: 'Numbers you can trust', text: 'Every sale, return and delivery updates stock and money the same way.' },
  { title: 'Made for the phone', text: 'Big buttons, clear text, and one thumb is enough to sell.' },
  { title: 'Support in your language', text: 'Help in Arabic or English, from people who know Lebanese shops.' },
]

export function About() {
  useSeo(
    'About SaaS2 · UltraScaling',
    'SaaS2 is built by UltraScaling, a software company making simple tools for small businesses. Learn why we built a point of sale for clothing shops in Lebanon.'
  )

  return (
    <>
      <section className="page-head">
        <div className="container stack">
          <p className="eyebrow">About</p>
          <h1 className="page-title">SaaS2 is built by UltraScaling</h1>
          <p className="lead" style={{ maxWidth: '52ch' }}>
            We build simple software for small businesses. SaaS2 is our point of sale for clothing shops in Lebanon.
          </p>
        </div>
      </section>

      <section className="section section--soft" aria-labelledby="why-title">
        <div className="container stack" style={{ gap: 24 }}>
          <h2 id="why-title" className="section-title">Why we built it</h2>
          <div className="cards">
            {reasons.map((r) => (
              <article key={r.title} className="card">
                <h3 className="card__title">{r.title}</h3>
                <p className="card__text">{r.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="values-title">
        <div className="container stack" style={{ gap: 24 }}>
          <h2 id="values-title" className="section-title">What we care about</h2>
          <div className="cards">
            {values.map((v) => (
              <article key={v.title} className="card" style={{ background: 'var(--soft)' }}>
                <h3 className="card__title">{v.title}</h3>
                <p className="card__text">{v.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--soft" aria-labelledby="company-title">
        <div className="container stack" style={{ gap: 20 }}>
          <h2 id="company-title" className="section-title" style={{ fontSize: 24 }}>The company</h2>
          <dl className="facts">
            <div><dt>Company</dt><dd>UltraScaling</dd></div>
            <div><dt>Product</dt><dd>SaaS2</dd></div>
            <div><dt>Based in</dt><dd>{contact.city}, Lebanon</dd></div>
            <div><dt>Founded</dt><dd>{contact.founded}</dd></div>
          </dl>
          <div>
            <SiteLink to="/contact" className="btn btn--primary">Talk to us</SiteLink>
          </div>
        </div>
      </section>
    </>
  )
}
