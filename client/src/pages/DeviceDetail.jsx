import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Empty, Field, Form, Modal, Page, Select } from '../components/ui.jsx'
import { ago, date, dateTime, label, num, toLocalInput } from '../format.js'
import { DeviceForm } from './Devices.jsx'
import { TicketTable } from './Tickets.jsx'

const PERIODS = [['6 h', 6], ['24 h', 24], ['7 days', 168], ['30 days', 720]]
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const COLORS = ['#2563eb', '#f59e0b', '#10b981']
const digits = m => (m.counter ? 0 : m.unit ? 2 : 3)
const lastHours = (h, preset) => ({ from: new Date(Date.now() - h * 3_600_000).toISOString(), to: new Date().toISOString(), preset })

export default function DeviceDetail() {
  const { id } = useParams()
  const result = useApi(`/devices/${id}`, { refreshMs: 30_000 })
  return <Async result={result}>{device => <DeviceView device={device} reload={result.reload} />}</Async>
}

function DeviceView({ device, reload }) {
  const { can, meta } = useAuth()
  const [modal, setModal] = useState(null)
  const close = () => setModal(null)
  const saved = () => { close(); reload() }
  const metrics = meta.METRICS[device.type]
  const retired = device.status === 'retired'

  return (
    <Page
      title={device.name}
      subtitle={<><Badge value={device.type} /> at <Link to={`/plants/${device.plant._id}`}>{device.plant.name}</Link> · {device.manufacturer} {device.model} · S/N {device.serialNumber}</>}
      actions={
        <>
          {!retired && can('ticket:create') && <Link className="button primary" to={`/tickets/new?plant=${device.plant._id}&device=${device._id}`}>Report issue</Link>}
          {can('device:write') && <button onClick={() => setModal('edit')}>Edit</button>}
          {!retired && can('device:write') && <button onClick={() => setModal('move')}>Move to another plant</button>}
        </>
      }
    >
      {device.stale && (
        <p className="alert" role="status">
          Not reporting: last data {ago(device.lastReadingAt)}, expected at least every {meta.staleAfterMin} min. Check the device and its data link.
        </p>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Right now <Badge value={retired ? 'retired' : device.stale ? 'stale' : 'reporting'}>{retired ? 'Retired' : device.stale ? 'Not reporting' : 'Reporting'}</Badge></h2>
          <span className="muted small">{device.lastReadingAt ? `Last reading ${dateTime(device.lastReadingAt)} (${ago(device.lastReadingAt)}) · refreshes every 30 s` : 'No readings yet'}</span>
        </div>
        <div className={`readings${device.stale ? ' old' : ''}`}>
          {metrics.map(m => (
            <div key={m.key} className="reading">
              <div className="muted small">{m.label}</div>
              <div className="reading-value">{num(device.lastReading?.[m.key], digits(m))} <span className="unit">{m.unit}</span></div>
            </div>
          ))}
        </div>
      </section>

      <History device={device} metrics={metrics} />

      <div className="grid-2">
        <section className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>Status</dt><dd><Badge value={device.status} /></dd>
            <dt>Serial number</dt><dd>{device.serialNumber}</dd>
            <dt>Manufacturer / model</dt><dd>{device.manufacturer} {device.model}</dd>
            <dt>Installed</dt><dd>{date(device.installedOn)}</dd>
            {device.type === 'inverter' ? (
              <>
                <dt>Rated AC power</dt><dd>{num(device.ratedPowerKw, 1)} kW</dd>
                <dt>MPPT inputs</dt><dd>{device.mpptCount ?? '–'}</dd>
              </>
            ) : (
              <>
                <dt>Meter kind</dt><dd>{label(device.meterKind)}</dd>
                <dt>Accuracy class</dt><dd>{device.accuracyClass ?? '–'}</dd>
              </>
            )}
          </dl>
          {device.moves.length > 0 && (
            <>
              <h3>Moves</h3>
              <ul className="plain">
                {device.moves.map(m => <li key={m.at}>{dateTime(m.at)}: {m.from?.name} → {m.to?.name} by {m.by?.name}</li>)}
              </ul>
            </>
          )}
        </section>
        <section className="card">
          <h2>Tickets for this device</h2>
          <TicketTable tickets={device.tickets} hidePlant hideDevice />
        </section>
      </div>

      {modal === 'edit' && (
        <Modal title={`Edit ${device.name}`} onClose={close}>
          <DeviceForm device={device} onSaved={saved} />
        </Modal>
      )}
      {modal === 'move' && <MoveDevice device={device} onClose={close} onSaved={saved} />}
    </Page>
  )
}

function MoveDevice({ device, onClose, onSaved }) {
  const plants = useApi('/plants')
  const options = (plants.data ?? []).filter(p => p.status !== 'decommissioned' && p._id !== device.plant._id).map(p => [p._id, `${p.name} (${p.code})`])
  return (
    <Modal title={`Move ${device.name}`} onClose={onClose}>
      <p className="muted">Its readings history stays with the device. Moving is refused while tickets for it are still open at {device.plant.name}.</p>
      <Form submitLabel="Move device" onSubmit={values => api(`/devices/${device._id}/move`, { method: 'POST', body: values }).then(onSaved)}>
        <Field label="New plant" wide><Select name="plant" required placeholder="Choose a plant…" options={options} /></Field>
      </Form>
    </Modal>
  )
}

function History({ device, metrics }) {
  const [range, setRange] = useState(() => lastHours(24, '24 h'))
  const [customOpen, setCustomOpen] = useState(false)
  const result = useApi(`/devices/${device._id}/readings?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(TZ)}`)
  const charts = Object.entries(Object.groupBy(metrics, m => m.chart))

  return (
    <section className="card">
      <div className="section-head">
        <h2>History</h2>
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map(([text, h]) => (
            <button key={text} className={range.preset === text ? 'on' : ''} onClick={() => { setCustomOpen(false); setRange(lastHours(h, text)) }}>{text}</button>
          ))}
          <button className={range.preset === 'custom' ? 'on' : ''} onClick={() => setCustomOpen(o => !o)}>Custom…</button>
        </div>
      </div>
      {customOpen && (
        <form className="toolbar" onSubmit={e => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setRange({ from: new Date(f.get('from')).toISOString(), to: new Date(f.get('to')).toISOString(), preset: 'custom' })
        }}>
          <label>From <input type="datetime-local" name="from" required defaultValue={toLocalInput(range.from)} /></label>
          <label>To <input type="datetime-local" name="to" required defaultValue={toLocalInput(range.to)} /></label>
          <button className="primary">Show</button>
        </form>
      )}
      <p className="muted small">{dateTime(range.from)} – {dateTime(range.to)}</p>
      <Async result={result}>
        {data => data.count === 0 ? <Empty>No readings in this period.</Empty> : (
          <>
            <Summary metrics={metrics} summary={data.summary} />
            <div className="charts">
              {charts.map(([title, list]) => <Chart key={title} title={title} metrics={list} data={data} />)}
            </div>
          </>
        )}
      </Async>
    </section>
  )
}

function Summary({ metrics, summary }) {
  return (
    <div className="table-wrap">
      <table className="table summary">
        <thead><tr><th>Over this period</th><th className="num">Average</th><th className="num">Min</th><th className="num">Max</th><th className="num">Total</th></tr></thead>
        <tbody>
          {metrics.map(m => {
            const s = summary[m.key]
            const v = x => (x == null ? '–' : `${num(x, digits(m) || 1)} ${m.unit}`)
            return m.counter
              ? <tr key={m.key}><td>{m.label}</td><td /><td /><td /><td className="num"><strong>{v(s.total)}</strong></td></tr>
              : <tr key={m.key}><td>{m.label}</td><td className="num">{v(s.avg)}</td><td className="num">{v(s.min)}</td><td className="num">{v(s.max)}</td><td /></tr>
          })}
        </tbody>
      </table>
    </div>
  )
}

const BUCKET_TEXT = { minute: 'min', hour: 'h', day: 'day' }

function Chart({ title, metrics, data }) {
  const { unit: bucketUnit, binSize } = data.bucket
  const counter = metrics[0].counter
  const unit = metrics[0].unit
  const tick = t => new Date(t).toLocaleString('en-IN', bucketUnit === 'day' ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const ChartType = counter ? BarChart : LineChart
  return (
    <figure className="chart">
      <figcaption>{title}{counter && ` per ${binSize > 1 ? binSize + ' ' : ''}${BUCKET_TEXT[bucketUnit]}`}{unit && ` (${unit})`}</figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <ChartType data={data.points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tick} minTickGap={48} fontSize={11} />
          <YAxis fontSize={11} width={64} domain={['auto', 'auto']} tickFormatter={v => num(v, 2)} />
          <Tooltip labelFormatter={dateTime} formatter={(v, name) => [`${num(v, 3)} ${unit}`, name]} />
          {metrics.length > 1 && <Legend />}
          {metrics.map((m, i) => counter
            ? <Bar key={m.key} dataKey={m.key} name={m.label} fill={COLORS[i]} isAnimationActive={false} />
            : <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={COLORS[i]} dot={false} strokeWidth={2} isAnimationActive={false} />)}
        </ChartType>
      </ResponsiveContainer>
    </figure>
  )
}
