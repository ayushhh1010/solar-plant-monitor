import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Empty, Field, Form, Modal, Page, Select, useFilters } from '../components/ui.jsx'
import { ago, power } from '../format.js'

export default function Devices() {
  const { can, meta } = useAuth()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const { query, bind } = useFilters()
  const plants = useApi('/plants')
  const result = useApi(`/devices?${query}`)

  return (
    <Page
      title="Devices"
      subtitle="Meters and inverters across all plants"
      actions={can('device:write') && <button className="primary" onClick={() => setAdding(true)}>+ Register device</button>}
    >
      <div className="toolbar">
        <Select aria-label="Plant" {...bind('plant')} options={(plants.data ?? []).map(p => [p._id, p.name])} placeholder="All plants" />
        <Select aria-label="Type" {...bind('type')} options={meta.DEVICE_TYPES} placeholder="All types" />
        <Select aria-label="Status" {...bind('status')} options={meta.DEVICE_STATUSES} placeholder="Any status" />
      </div>
      <Async result={result}>{devices => <div className="card"><DeviceTable devices={devices} showPlant /></div>}</Async>
      {adding && (
        <Modal title="Register a device" onClose={() => setAdding(false)}>
          <DeviceForm onSaved={d => navigate(`/devices/${d._id}`)} />
        </Modal>
      )}
    </Page>
  )
}

const KEY_METRIC = { inverter: 'acPowerKw', meter: 'activePowerKw' }

export function DeviceTable({ devices, showPlant }) {
  if (!devices.length) return <Empty>No devices.</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Device</th><th>Type</th><th>Make / model</th>{showPlant && <th>Plant</th>}<th>Status</th><th>Last data</th><th className="num">Now</th></tr>
        </thead>
        <tbody>
          {devices.map(d => (
            <tr key={d._id} className={d.status === 'retired' ? 'dim' : ''}>
              <td><Link to={`/devices/${d._id}`}><strong>{d.name}</strong></Link><div className="muted small">{d.serialNumber}</div></td>
              <td><Badge value={d.type} /></td>
              <td>{d.manufacturer}<div className="muted small">{d.model}</div></td>
              {showPlant && <td><Link to={`/plants/${d.plant._id}`}>{d.plant.name}</Link></td>}
              <td><Badge value={d.status} /></td>
              <td>{ago(d.lastReadingAt)}{d.stale && <div><Badge value="stale">not reporting</Badge></div>}</td>
              <td className="num">{d.lastReading && !d.stale ? power(d.lastReading[KEY_METRIC[d.type]]) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DeviceForm({ device, plantId, onSaved }) {
  const { meta } = useAuth()
  const [type, setType] = useState(device?.type ?? 'inverter')
  const plants = useApi(device || plantId ? null : '/plants')
  const d = device ?? {}
  const save = async values =>
    onSaved(await (device
      ? api(`/devices/${device._id}`, { method: 'PATCH', body: values })
      : api('/devices', { method: 'POST', body: { ...values, type, plant: plantId ?? values.plant } })))

  return (
    <Form onSubmit={save} submitLabel={device ? 'Save changes' : 'Register device'}>
      {!device && (
        <Field label="Type">
          <Select value={type} onChange={e => setType(e.target.value)} options={meta.DEVICE_TYPES} />
        </Field>
      )}
      {!device && !plantId && (
        <Field label="Plant" hint="A device always belongs to a plant">
          <Select name="plant" required placeholder="Choose a plant…" options={(plants.data ?? []).filter(p => p.status !== 'decommissioned').map(p => [p._id, `${p.name} (${p.code})`])} />
        </Field>
      )}
      <Field label="Name / tag" hint="e.g. INV-05"><input name="name" defaultValue={d.name} required maxLength={60} /></Field>
      <Field label="Manufacturer"><input name="manufacturer" defaultValue={d.manufacturer} required maxLength={60} /></Field>
      <Field label="Serial number" hint="Manufacturer + serial identify the physical device">
        <input name="serialNumber" defaultValue={d.serialNumber} required maxLength={60} />
      </Field>
      <Field label="Model"><input name="model" defaultValue={d.model} maxLength={60} /></Field>
      <Field label="Installed on"><input name="installedOn" type="date" defaultValue={d.installedOn?.slice(0, 10)} /></Field>
      {device && (
        <Field label="Status" hint="Retire a device that is removed for good">
          <Select name="status" defaultValue={d.status} options={meta.DEVICE_STATUSES} />
        </Field>
      )}
      {type === 'inverter' ? (
        <>
          <Field label="Rated AC power (kW)"><input name="ratedPowerKw" type="number" min="0.1" step="any" defaultValue={d.ratedPowerKw} required /></Field>
          <Field label="MPPT inputs"><input name="mpptCount" type="number" min="1" max="32" step="1" defaultValue={d.mpptCount} /></Field>
        </>
      ) : (
        <>
          <Field label="Meter kind" hint="Export/import side or net (bidirectional)">
            <Select name="meterKind" defaultValue={d.meterKind ?? ''} options={meta.METER_KINDS} placeholder="Choose…" required />
          </Field>
          <Field label="Accuracy class">
            <Select name="accuracyClass" defaultValue={d.accuracyClass ?? ''} options={meta.ACCURACY_CLASSES.map(c => [c, c])} placeholder="Not specified" />
          </Field>
        </>
      )}
    </Form>
  )
}
