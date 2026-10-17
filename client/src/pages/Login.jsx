import { useState } from 'react'
import { useAuth } from '../auth.jsx'

// Seeded demo accounts, one per role (see README).
const DEMO = [
  ['admin@solarops.test', 'Admin', 'everything, incl. onboarding plants and devices'],
  ['manager@solarops.test', 'Manager', 'crew, triage, assign, close tickets'],
  ['operator@solarops.test', 'Operator', 'report and work tickets'],
  ['viewer@solarops.test', 'Viewer', 'read-only'],
]

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1><span aria-hidden="true">☀</span> Solar Ops</h1>
        <p className="muted">Sign in to monitor plants and handle issues.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <div className="demo">
          <div className="muted small">Demo accounts (password <code>Solar@123</code>) — click to fill:</div>
          {DEMO.map(([address, role, what]) => (
            <button type="button" key={address} className="demo-user" onClick={() => { setEmail(address); setPassword('Solar@123') }}>
              <strong>{role}</strong> <span className="muted">{what}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
