import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Empty, Field, Form, Modal, Page, Select } from '../components/ui.jsx'
import { capacity, power } from '../format.js'

export default function Plants() {
  const { can, meta } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  const result = useApi('/plants')
  return (
    <Page
      title="Plants"
      subtitle="Every site, how large it is and what state it is in"
      actions={can('plant:write') && <button className="primary" onClick={() => setAdding(true)}>+ Onboard plant</button>}
    >
      <div className="toolbar">
        <Select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)} options={meta.PLANT_STATUSES} placeholder="All statuses" />
      </div>
      <Async result={result}>
        {plants => (
          <div className="card">
            <PlantTable plants={status ? plants.filter(p => p.status === status) : plants} />
          </div>
        )}
      </Async>
      {adding && (
        <Modal title="Onboard a plant" onClose={() => setAdding(false)}>
          <PlantForm onSaved={plant => navigate(`/plants/${plant._id}`)} />
        </Modal>
      )}
    </Page>
  )
}

export function PlantTable({ plants }) {
  if (!plants.length) return <Empty>No plants match.</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Plant</th><th>State</th><th>Status</th><th>Health</th><th className="num">Capacity</th><th>Live output</th><th className="num">Devices</th><th className="num">Open tickets</th><th className="num">Crew</th></tr>
        </thead>
        <tbody>
          {plants.map(p => {
            const share = Math.min(100, (p.liveKw / p.capacityKwp) * 100) || 0
            return (
              <tr key={p._id}>
                <td><Link to={`/plants/${p._id}`}><strong>{p.name}</strong></Link><div className="muted small">{p.code}</div></td>
                <td>{p.state}</td>
                <td><Badge value={p.status} /></td>
                <td><Badge value={p.health} /></td>
                <td className="num">{capacity(p.capacityKwp)}</td>
                <td>
                  <div className="meter" title={`${share.toFixed(0)}% of capacity`}><div style={{ width: `${share}%` }} /></div>
                  <span className="small">{power(p.liveKw)}</span>
                </td>
                <td className="num">{p.deviceCount}{p.staleDevices > 0 && <div><Badge value="stale">{p.staleDevices} silent</Badge></div>}</td>
                <td className="num">{p.openTickets}{p.criticalTickets > 0 && <div><Badge value="critical">{p.criticalTickets} critical</Badge></div>}</td>
                <td className="num">{p.crewCount}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PlantForm({ plant = {}, onSaved }) {
  const { meta } = useAuth()
  const save = async values =>
    onSaved(await (plant._id ? api(`/plants/${plant._id}`, { method: 'PATCH', body: values }) : api('/plants', { method: 'POST', body: values })))
  return (
    <Form onSubmit={save} submitLabel={plant._id ? 'Save changes' : 'Onboard plant'}>
      <Field label="Plant code" hint="Unique, e.g. RJ-JOD-01">
        <input name="code" defaultValue={plant.code} required pattern="[A-Za-z0-9\-]{3,20}" />
      </Field>
      <Field label="Name" hint="Unique, case-insensitive">
        <input name="name" defaultValue={plant.name} required maxLength={100} />
      </Field>
      <Field label="Address" wide><input name="address" defaultValue={plant.address} maxLength={200} /></Field>
      <Field label="State"><input name="state" defaultValue={plant.state} required maxLength={60} /></Field>
      <Field label="Capacity (kWp DC)"><input name="capacityKwp" type="number" min="1" step="any" defaultValue={plant.capacityKwp} required /></Field>
      <Field label="Latitude" hint="Another plant within ~100 m is treated as a duplicate">
        <input name="latitude" type="number" min="-90" max="90" step="any" defaultValue={plant.latitude} required />
      </Field>
      <Field label="Longitude"><input name="longitude" type="number" min="-180" max="180" step="any" defaultValue={plant.longitude} required /></Field>
      <Field label="Commissioned on"><input name="commissionedOn" type="date" defaultValue={plant.commissionedOn?.slice(0, 10)} /></Field>
      <Field label="Status">
        <Select name="status" defaultValue={plant.status ?? 'commissioning'} options={meta.PLANT_STATUSES.filter(s => s !== 'decommissioned')} />
      </Field>
    </Form>
  )
}
