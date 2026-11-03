import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordField from '../components/PasswordField.jsx';
import useSeo from '../useSeo.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  useSeo('Create your shop account · SaaS2', 'Create a SaaS2 account for your clothing shop.');
  const [form, setForm] = useState({ name: '', shop: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Enter your name.';
    if (!form.shop.trim()) next.shop = 'Enter your shop name.';
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email, like name@shop.com.';
    if (form.password.length < 8) next.password = 'Use at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    // TODO: create the account with your auth provider (e.g. supabase.auth.signUp), then continue to onboarding.
    setTimeout(() => setLoading(false), 1200);
  }

  const text = (id, label, autoComplete) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type="text"
        autoComplete={autoComplete}
        value={form[id]}
        onChange={set(id)}
        aria-invalid={errors[id] ? 'true' : undefined}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
      />
      {errors[id] && <p className="field__error" id={`${id}-error`}>{errors[id]}</p>}
    </div>
  );

  return (
    <AuthLayout
      title="Create your shop account"
      subtitle="Set up in a few minutes. No card needed."
      footer={<>Already have an account? <Link to="/login">Log in</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field-row">
          {text('name', 'Your name', 'name')}
          {text('shop', 'Shop name', 'organization')}
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && <p className="field__error" id="email-error">{errors.email}</p>}
        </div>
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 8 characters."
        />
        <button type="submit" className="btn btn--primary btn--block" disabled={loading} aria-busy={loading}>
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
          {loading ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth-form__legal">By creating an account you agree to the <a href="#terms">Terms</a> and <a href="#privacy">Privacy policy</a>.</p>
      </form>
    </AuthLayout>
  );
}
