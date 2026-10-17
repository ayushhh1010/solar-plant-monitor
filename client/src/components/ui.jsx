import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useSearchParams } from 'react-router-dom'
import { formValues } from '../api.js'
import { useAuth } from '../auth.jsx'
import { label } from '../format.js'

const NAV = [['/', 'Overview'], ['/plants', 'Plants'], ['/devices', 'Devices'], ['/crew', 'Crew'], ['/tickets', 'Tickets']]

export function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span aria-hidden="true">☀</span> Solar Ops</div>
        <nav>
          {NAV.map(([to, text]) => <NavLink key={to} to={to} end={to === '/'}>{text}</NavLink>)}
        </nav>
        <div className="me">
          <strong>{user.name}</strong>
          <span className="muted">{label(user.role)}</span>
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export function Page({ title, subtitle, actions, children }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="muted">{subtitle}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </>
  )
}

// List filters live in the URL (shareable, survive reload). Returns the API query (blank values dropped) and a binder for inputs.
export function useFilters(defaults = {}) {
  const [params, setParams] = useSearchParams()
  const value = name => params.get(name) ?? defaults[name] ?? ''
  const query = new URLSearchParams()
  for (const name of new Set([...params.keys(), ...Object.keys(defaults)])) if (value(name)) query.set(name, value(name))
  const bind = name => ({
    value: value(name),
    onChange: e => setParams(p => { p.set(name, e.target.type === 'checkbox' ? (e.target.checked ? 'true' : '') : e.target.value); return p }, { replace: true }),
  })
  return { query: query.toString(), value, bind }
}

export const Loading = () => <div className="loading">Loading…</div>
export const ErrorBox = ({ error }) => <p className="error" role="alert">{error?.message ?? String(error)}</p>
export const Empty = ({ children }) => <p className="empty">{children}</p>

// Renders a useApi() result: spinner first time, error if nothing to show, otherwise children(data).
export function Async({ result, children }) {
  if (result.data === undefined) return result.error ? <ErrorBox error={result.error} /> : <Loading />
  return (
    <>
      {result.error && <ErrorBox error={result.error} />}
      {children(result.data)}
    </>
  )
}

const TONE = {
  operational: 'green', ok: 'green', active: 'green', reporting: 'green',
  commissioning: 'blue', assigned: 'blue', in_progress: 'blue', medium: 'blue',
  open: 'amber', maintenance: 'amber', warning: 'amber', on_leave: 'amber', resolved: 'teal',
  high: 'orange', offline: 'red', critical: 'red', stale: 'red',
  meter: 'purple', inverter: 'purple',
}
export const Badge = ({ value, children }) => <span className={`badge tone-${TONE[value] ?? 'grey'}`}>{children ?? label(value)}</span>

export const Stat = ({ title, value, sub, tone }) => (
  <div className={`card stat${tone ? ` stat-${tone}` : ''}`}>
    <div className="muted small">{title}</div>
    <div className="stat-value">{value}</div>
    {sub && <div className="muted small">{sub}</div>}
  </div>
)

export function Modal({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon" onClick={() => ref.current.close()} aria-label="Close">✕</button>
      </div>
      {children}
    </dialog>
  )
}

// Submits the form's values to `onSubmit`, shows the API's error message and blocks double submits.
export function Form({ onSubmit, children, submitLabel = 'Save', danger }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function handle(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(formValues(e.currentTarget))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="form" onSubmit={handle}>
      {children}
      {error && <p className="error wide" role="alert">{error}</p>}
      <div className="form-actions wide">
        <button type="submit" className={danger ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Working…' : submitLabel}</button>
      </div>
    </form>
  )
}

export const Field = ({ label: text, hint, wide, children }) => (
  <label className={`field${wide ? ' wide' : ''}`}>
    <span>{text}</span>
    {children}
    {hint && <small className="muted">{hint}</small>}
  </label>
)

// options: plain values (labelled automatically) or [value, text] pairs.
export const Select = ({ options, placeholder, ...props }) => (
  <select {...props}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map(o => {
      const [value, text] = Array.isArray(o) ? o : [o, label(o)]
      return <option key={value} value={value}>{text}</option>
    })}
  </select>
)

export const Checkboxes = ({ legend, name, options, selected = [] }) => (
  <fieldset className="checks wide">
    <legend>{legend}</legend>
    {options.map(([value, text]) => (
      <label key={value}>
        <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} /> {text}
      </label>
    ))}
  </fieldset>
)
