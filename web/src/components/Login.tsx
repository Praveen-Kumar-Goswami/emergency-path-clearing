import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

type AuthMode = 'login' | 'register';

interface LoginProps {
  onSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [role, setRole] = useState<'dispatcher' | 'ambulance'>('dispatcher');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetForm = () => {
    setError(null);
    setSuccessMsg(null);
    setEmail('');
    setPassword('');
    setFullName('');
    setBadgeId('');
  };

  const switchMode = (m: AuthMode) => {
    resetForm();
    setMode(m);
  };

  /* ── LOGIN ── */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      if (!data.user) throw new Error('Authentication succeeded but user was not found.');

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileErr) throw profileErr;
      if (!profile || profile.role !== 'dispatcher') {
        await supabase.auth.signOut();
        throw new Error(
          'This account is not a dispatcher. Only dispatch personnel may access this console.'
        );
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  /* ── REGISTER ── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || !fullName.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), badge_id: badgeId.trim() || null },
        },
      });
      if (signUpErr) throw signUpErr;
      if (!data.user) throw new Error('Registration failed — no user returned.');

      // Upsert profile with chosen role
      const { error: profileErr } = await (supabase.from('profiles') as any).upsert({
        id: data.user.id,
        role,
        full_name: fullName.trim(),
        badge_id: badgeId.trim() || null,
      });
      if (profileErr) throw profileErr;

      setSuccessMsg(
        `Account created! ${
          role === 'dispatcher'
            ? 'You can now sign in to the Dispatch Console.'
            : 'Use the mobile app to log in as an ambulance operator.'
        }`
      );
      setEmail('');
      setPassword('');
      setFullName('');
      setBadgeId('');

      // Auto-switch to login if dispatcher
      if (role === 'dispatcher') {
        setTimeout(() => switchMode('login'), 2000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-tabs">
      {/* Tab Bar */}
      <div className="auth-tab-bar">
        <button
          className={`auth-tab-btn ${mode === 'login' ? 'active' : ''}`}
          onClick={() => switchMode('login')}
        >
          🔑 Sign In
        </button>
        <button
          className={`auth-tab-btn ${mode === 'register' ? 'active' : ''}`}
          onClick={() => switchMode('register')}
        >
          ✨ Register
        </button>
      </div>

      {/* Login Card */}
      {mode === 'login' && (
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="badge-icon">🚨</span>
            <h2>Emergency Dispatch Console</h2>
            <p>Sign in with your dispatcher credentials to access real-time monitoring</p>
          </div>

          {error && (
            <div className="error-banner" role="alert" aria-live="assertive">
              ⚠️ {error}
            </div>
          )}
          {successMsg && (
            <div className="success-banner" role="status" aria-live="polite">
              ✅ {successMsg}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="login-email">Dispatcher Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dispatcher@agency.com"
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '⏳ Authenticating...' : '🔐 Sign In as Dispatcher'}
            </button>
          </form>

          <div className="form-divider">or</div>

          <button className="btn-secondary" onClick={() => switchMode('register')}>
            Create New Account
          </button>

          <div className="auth-footer-link" style={{ marginTop: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              🔒 Access restricted to authorized emergency personnel
            </span>
          </div>
        </div>
      )}

      {/* Register Card */}
      {mode === 'register' && (
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="badge-icon">🆕</span>
            <h2>Create Account</h2>
            <p>Register as a dispatcher or ambulance operator</p>
          </div>

          {error && (
            <div className="error-banner" role="alert" aria-live="assertive">
              ⚠️ {error}
            </div>
          )}
          {successMsg && (
            <div className="success-banner" role="status" aria-live="polite">
              ✅ {successMsg}
            </div>
          )}

          <form onSubmit={handleRegister}>
            {/* Role Selector */}
            <div className="form-group">
              <label>Account Role</label>
              <div className="role-selector">
                <div
                  className={`role-option ${role === 'dispatcher' ? 'selected' : ''}`}
                  onClick={() => setRole('dispatcher')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setRole('dispatcher')}
                >
                  <span className="role-icon">🖥️</span>
                  <span className="role-name">Dispatcher</span>
                </div>
                <div
                  className={`role-option ${role === 'ambulance' ? 'selected' : ''}`}
                  onClick={() => setRole('ambulance')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setRole('ambulance')}
                >
                  <span className="role-icon">🚑</span>
                  <span className="role-name">Ambulance</span>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-name">Full Name *</label>
              <input
                id="reg-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Smith"
                required
                autoFocus
                autoComplete="name"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="reg-badge">Badge / Unit ID</label>
                <input
                  id="reg-badge"
                  type="text"
                  value={badgeId}
                  onChange={(e) => setBadgeId(e.target.value)}
                  placeholder="AMB-07 / DSP-02"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-email">Work Email *</label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@agency.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-password">Password * (min 8 characters)</label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '⏳ Creating Account...' : `✨ Register as ${role === 'dispatcher' ? 'Dispatcher' : 'Ambulance Operator'}`}
            </button>
          </form>

          <div className="form-divider">already have an account?</div>
          <button className="btn-secondary" onClick={() => switchMode('login')}>
            Back to Sign In
          </button>

          {role === 'ambulance' && (
            <div className="auth-footer-link" style={{ marginTop: 14 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, display: 'block', textAlign: 'center' }}>
                🚑 After registering, download the Path Clear mobile app and log in with these credentials
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
