import { useState, type FormEvent } from 'react';
import { signInErrorMessage, useSession } from '../../auth/session';
import { sq } from '../../strings/sq';

export function LoginCard() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(sq.login.missingFields);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(signInErrorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <section className="card" id="loginCard">
      <h2>{sq.login.title}</h2>
      <p className="muted">{sq.login.hint}</p>
      <form onSubmit={event => void submit(event)}>
        <div className="grid">
          <label>
            {sq.login.email}
            <input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label>
            {sq.login.password}
            <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={busy}>{busy ? sq.login.submitting : sq.login.submit}</button>
      </form>
      <p className="muted" role="alert">{error}</p>
    </section>
  );
}
