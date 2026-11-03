import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordField from '../components/PasswordField.jsx';
import useSeo from '../useSeo.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  useSeo('Log in · SaaS2', 'Log in to your SaaS2 shop account.');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter the email you use for your shop.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    // TODO: sign in with your auth provider (e.g. supabase.auth.signInWithPassword), then go to /app.
    setTimeout(() => setLoading(false), 1200);
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your shop."
      footer={<>New to SaaS2? <Link to="/signup">Create an account</Link></>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && <p className="field__error" id="email-error">{errors.email}</p>}
        </div>
        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          extra={<Link to="/forgot-password" className="field__link">Forgot password?</Link>}
        />
        <button type="submit" className="btn btn--primary btn--block" disabled={loading} aria-busy={loading}>
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthLayout>
  );
}
