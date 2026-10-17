export const num = (v, dp = 0) => (v == null ? '–' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }))
export const power = kw => (kw == null ? '–' : Math.abs(kw) >= 1000 ? `${num(kw / 1000, 2)} MW` : `${num(kw, 1)} kW`)
export const capacity = kwp => (Math.abs(kwp) >= 1000 ? `${num(kwp / 1000, 2)} MWp` : `${num(kwp)} kWp`)
export const dateTime = d => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–')
export const date = d => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '–')
export const label = s => (s ? (s[0].toUpperCase() + s.slice(1)).replaceAll('_', ' ') : '')
export const hours = h => (h == null ? '–' : h < 48 ? `${num(h, 1)} h` : `${num(h / 24, 1)} days`)

export function ago(d) {
  if (!d) return 'never'
  const minutes = (Date.now() - new Date(d)) / 60_000
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.floor(minutes)} min ago`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ago`
  return `${Math.floor(minutes / 1440)} days ago`
}

// For <input type="datetime-local">, which wants local wall-clock time.
export const toLocalInput = d => {
  const t = new Date(d)
  return new Date(t - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
