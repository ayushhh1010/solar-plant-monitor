import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Form, Modal, Page, Stat } from '../components/ui.jsx'
import { ago, capacity, date, power } from '../format.js'
import { CrewTable } from './Crew.jsx'
import { DeviceForm, DeviceTable } from './Devices.jsx'
import { PlantForm } from './Plants.jsx'
import { TicketTable } from './Tickets.jsx'

export default function PlantDetail() {
  const { id } = useParams()
  const result = useApi(`/plants/${id}`, { refreshMs: 60_000 })
  return <Async result={result}>{plant => <PlantView plant={plant} reload={result.reload} />}</Async>
}

function PlantView({ plant, reload }) {
  const { can } = useAuth()
  const [modal, setModal] = useState(null)
  const close = () => setModal(null)
  const saved = () => { close(); reload() }
  const live = plant.status !== 'decommissioned'
  const activeDevices = plant.devices.filter(d => d.status !== 'retired')
  // Who to send: available people first, then the least busy.
  const crew = [...plant.crew].sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || a.openTickets - b.openTickets)

  return (
    <Page
      title={plant.name}
      subtitle={<>{plant.code} · {plant.address ? `${plant.address}, ` : ''}{plant.state} · <a href={`https://www.openstreetmap.org/?mlat=${plant.latitude}&mlon=${plant.longitude}#map=14/${plant.latitude}/${plant.longitude}`} target="_blank" rel="noreferrer">map</a></>}
      actions={live && (
        <>
          {can('ticket:create') && <Link className="button primary" to={`/tickets/new?plant=${plant._id}`}>Report issue</Link>}
          {can('plant:write') && <button onClick={() => setModal('edit')}>Edit</button>}
          {can('plant:write') && <button className="danger-outline" onClick={() => setModal('decommission')}>Decommission</button>}
        </>
      )}
    >
      <div className="stats">
        <Stat title="Status" value={<Badge value={plant.status} />} sub={<>{plant.statusSince && `Since ${ago(plant.statusSince)} · `}Health <Badge value={plant.health} /></>} />
        <Stat title="Capacity" value={capacity(plant.capacityKwp)} sub={plant.decommissionedAt ? `Decommissioned ${date(plant.decommissionedAt)}` : plant.commissionedOn ? `Commissioned ${date(plant.commissionedOn)}` : 'Not commissioned yet'} />
        <Stat title="Live output" value={power(plant.liveKw)} sub={`${Math.round((plant.liveKw / plant.capacityKwp) * 100)}% of capacity`} />
        <Stat title="Open tickets" value={plant.openTickets} sub={`${plant.criticalTickets} critical`} tone={plant.criticalTickets ? 'red' : undefined} />
      </div>

      <section className="card">
        <div className="section-head">
          <h2>Devices ({activeDevices.length}{plant.staleDevices > 0 && `, ${plant.staleDevices} not reporting`})</h2>
          {live && can('device:write') && <button onClick={() => setModal('device')}>+ Add device</button>}
        </div>
        <DeviceTable devices={plant.devices} />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Crew who can be sent here</h2>
          <Link to={`/crew?plant=${plant._id}`}>Manage crew →</Link>
        </div>
        <CrewTable crew={crew} />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent tickets</h2>
          <Link to={`/tickets?plant=${plant._id}&status=`}>All tickets for this plant →</Link>
        </div>
        <TicketTable tickets={plant.tickets} hidePlant />
      </section>

      {modal === 'edit' && (
        <Modal title={`Edit ${plant.name}`} onClose={close}>
          <PlantForm plant={plant} onSaved={saved} />
        </Modal>
      )}
      {modal === 'device' && (
        <Modal title={`Add a device to ${plant.name}`} onClose={close}>
          <DeviceForm plantId={plant._id} onSaved={saved} />
        </Modal>
      )}
      {modal === 'decommission' && (
        <Modal title={`Decommission ${plant.name}?`} onClose={close}>
          <p>The plant stays on record with its history, but it can no longer receive devices, crew or tickets. This cannot be undone.</p>
          <ul>
            <li>{activeDevices.length} device(s) will be retired</li>
            <li>{plant.crew.length} crew member(s) will no longer be assigned here</li>
            <li>It is refused while the plant has open tickets ({plant.openTickets} now)</li>
          </ul>
          <Form danger submitLabel="Decommission plant" onSubmit={() => api(`/plants/${plant._id}/decommission`, { method: 'POST' }).then(saved)} />
        </Modal>
      )}
    </Page>
  )
}
