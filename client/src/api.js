import { useEffect, useState } from 'react'

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'))
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }
  return data
}

// Loads `path` (skipped when falsy), keeps showing the previous data while reloading, optionally polls.
export function useApi(path, { refreshMs } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true
    setState(s => ({ ...s, loading: true }))
    api(path).then(
      data => alive && setState({ data, error: null, loading: false }),
      error => alive && setState(s => ({ ...s, error, loading: false })),
    )
    const timer = refreshMs && setTimeout(() => setVersion(v => v + 1), refreshMs)
    return () => { alive = false; clearTimeout(timer) }
  }, [path, version, refreshMs])
  return { ...state, reload: () => setVersion(v => v + 1) }
}

// Reads a form into a plain object. Blank text stays '' (so edits can clear it); blank numbers/dates/selects become null.
export function formValues(form) {
  const data = {}
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue
    if (el.type === 'checkbox') {
      data[el.name] ??= []
      if (el.checked) data[el.name].push(el.value)
    } else if (el.value === '') {
      data[el.name] = ['number', 'date', 'datetime-local', 'select-one'].includes(el.type) ? null : ''
    } else if (el.type === 'number') {
      data[el.name] = Number(el.value)
    } else if (el.type === 'datetime-local') {
      data[el.name] = new Date(el.value).toISOString() // send an absolute time, not the browser's wall clock
    } else {
      data[el.name] = el.value
    }
  }
  return data
}
