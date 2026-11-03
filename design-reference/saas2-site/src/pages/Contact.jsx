import { useState } from 'react';
import { ChatIcon, MailIcon, PinIcon, ClockIcon, CheckIcon } from '../components/Icons.jsx';
import { businesses, contact } from '../data.js';
import useSeo from '../useSeo.js';

export default function Contact() {
  useSeo(
    'Contact SaaS2 · Book a free demo',
    'Book a free demo of SaaS2, ask about pricing, or get help with your account. Reach the SaaS2 team on WhatsApp or email.'
  );

  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    // TODO: send `data` to your backend (e.g. POST /api/contact) or a form service.
    console.info('Contact form', data);
    setSent(true);
  }

  return (
    <>
      <section className="page-head">
        <div className="container stack">
          <p className="eyebrow">Contact</p>
          <h1 className="page-title">Talk to us</h1>
          <p className="lead">Book a demo, ask about pricing, or get help. WhatsApp is the fastest way to reach us.</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container contact">
          <div className="contact__ways" aria-label="Ways to reach us">
            <a className="way way--primary" href={contact.whatsappLink} target="_blank" rel="noopener noreferrer">
              <span className="way__icon"><ChatIcon /></span>
              <span><span className="way__label">Message us on WhatsApp</span><span className="way__value">{contact.whatsappNumber}</span></span>
            </a>
            <a className="way" href={`mailto:${contact.email}`}>
              <span className="way__icon"><MailIcon /></span>
              <span><span className="way__label">Email</span><span className="way__value">{contact.email}</span></span>
            </a>
            <div className="way">
              <span className="way__icon"><PinIcon /></span>
              <span><span className="way__label">Office</span><span className="way__value">{contact.city}, Lebanon</span></span>
            </div>
            <div className="way">
              <span className="way__icon"><ClockIcon /></span>
              <span><span className="way__label">Hours</span><span className="way__value">{contact.hours}</span></span>
            </div>
          </div>

          <div className="form-card">
            {sent ? (
              <div className="success" role="status">
                <span className="success__icon"><CheckIcon /></span>
                <h2 style={{ fontSize: 24 }}>Thanks, we got your message</h2>
                <p className="muted">We will reply on WhatsApp within {contact.replyTime}.</p>
                <div>
                  <button type="button" className="btn btn--outline" onClick={() => setSent(false)}>Send another message</button>
                </div>
              </div>
            ) : (
              <form className="form" onSubmit={handleSubmit}>
                <h2 style={{ fontSize: 24 }}>Send us a message</h2>
                <p className="muted" style={{ fontSize: 14 }}>Fields marked * are required.</p>
                <div className="field">
                  <label htmlFor="c-name">Full name *</label>
                  <input id="c-name" name="name" type="text" required autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="c-shop">Shop name *</label>
                  <input id="c-shop" name="shop" type="text" required autoComplete="organization" />
                </div>
                <div className="field">
                  <label htmlFor="c-phone">WhatsApp number *</label>
                  <input id="c-phone" name="phone" type="tel" inputMode="tel" required autoComplete="tel" placeholder="+961 70 123 456" />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="c-city">City</label>
                    <input id="c-city" name="city" type="text" autoComplete="address-level2" />
                  </div>
                  <div className="field">
                    <label htmlFor="c-type">Type of shop</label>
                    <select id="c-type" name="type" defaultValue={businesses[0]}>
                      {businesses.map((b) => <option key={b}>{b}</option>)}
                      <option>Other</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="c-reason">I want to</label>
                  <select id="c-reason" name="reason" defaultValue="Book a free demo">
                    <option>Book a free demo</option>
                    <option>Ask about pricing</option>
                    <option>Get help with my account</option>
                    <option>Something else</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-msg">Message</label>
                  <textarea id="c-msg" name="message" rows={4} />
                </div>
                <button type="submit" className="btn btn--primary">Send message</button>
                <p className="muted" style={{ fontSize: 13 }}>We only use your details to reply to you.</p>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
