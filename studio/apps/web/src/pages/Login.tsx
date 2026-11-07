import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox, Field } from '../components/ui';

export function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/auth/login', { email, password });
      await onDone();
    } catch (x) {
      setErr(x);
    }
  };
  return (
    <div className="center-screen">
      <form className="card login-card stack" onSubmit={submit}>
        <img src="/brand/logo-horizontal-black.svg" alt="Sound Ninja" style={{ height: 26 }} />
        <div className="eyebrow">Design Studio</div>
        <h1>Sign in</h1>
        <ErrorBox error={err} />
        <Field label="Email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn primary" type="submit">
          Sign in
        </button>
      </form>
    </div>
  );
}

export function SetupPage({ onDone }: { onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', email: '', password: '', organisation: 'Sound Ninja', setupToken: '' });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/setup', { ...f, setupToken: f.setupToken || undefined });
      await onDone();
    } catch (x) {
      setErr(x);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="center-screen">
      <form className="card login-card stack" onSubmit={submit}>
        <img src="/brand/logo-horizontal-black.svg" alt="Sound Ninja" style={{ height: 26 }} />
        <div className="eyebrow">First-run setup</div>
        <h1>Create the admin account</h1>
        <p className="small muted">This form is only available until the first account exists.</p>
        <ErrorBox error={err} />
        <Field label="Your name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Password (min. 12 characters)"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} minLength={12} required /></Field>
        <Field label="Organisation"><input value={f.organisation} onChange={set('organisation')} required /></Field>
        <Field label="Setup token" hint="Only needed if the server was started with SETUP_TOKEN."><input value={f.setupToken} onChange={set('setupToken')} /></Field>
        <button className="btn primary" type="submit">Create account</button>
      </form>
    </div>
  );
}
