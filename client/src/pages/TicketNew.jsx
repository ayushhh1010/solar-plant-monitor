import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Field, Form, Page, Select } from '../components/ui.jsx'
import { toLocalInput } from '../format.js'

export default function TicketNew() {
  const { meta } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [plant, setPlant] = useState(params.get('plant') ?? '')
  const [category, setCategory] = useState('')
  const plants = useApi('/plants')
  const devices = useApi(plant ? `/devices?plant=${plant}` : null)
  const deviceOptions = plant ? (devices.data ?? []).filter(d => d.status !== 'retired' && d.plant._id === plant) : []

  const submit = async values => {
    const ticket = await api('/tickets', { method: 'POST', body: values })
    navigate(`/tickets/${ticket._id}`)
  }

  return (
    <Page title="Report an issue" subtitle="Give the team enough to act on: where, what, how bad and when">
      <div className="card narrow">
        <Form onSubmit={submit} submitLabel="Submit report">
          <Field label="Plant">
            <Select name="plant" required value={plant} onChange={e => setPlant(e.target.value)} placeholder="Choose a plant…"
              options={(plants.data ?? []).filter(p => p.status !== 'decommissioned').map(p => [p._id, `${p.name} (${p.code})`])} />
          </Field>
          <Field label="Device" hint={category === 'device_fault' ? 'Required for a device fault' : 'Leave empty for a plant-wide issue'}>
            <Select
              key={`${plant}-${deviceOptions.length}`} // re-apply the preselected device once the list has loaded
              name="device"
              defaultValue={plant === params.get('plant') ? params.get('device') ?? '' : ''}
              required={category === 'device_fault'}
              placeholder="Whole plant / not device-specific"
              options={deviceOptions.map(d => [d._id, `${d.name} (${d.type}, ${d.serialNumber})`])}
            />
          </Field>
          <Field label="What happened">
            <Select name="category" required value={category} onChange={e => setCategory(e.target.value)} placeholder="Choose…" options={meta.TICKET_CATEGORIES} />
          </Field>
          <Field label="Priority" hint="Critical: generation lost or safety risk · High: major loss · Medium: degraded · Low: no output impact">
            <Select name="priority" required defaultValue="medium" options={meta.TICKET_PRIORITIES} />
          </Field>
          <Field label="Title" wide>
            <input name="title" required maxLength={120} placeholder="Short summary, e.g. INV-03 tripped on over-temperature" />
          </Field>
          <Field label="Description" wide>
            <textarea name="description" required maxLength={2000} rows={5} placeholder="What you saw, alarms or readings, what has been tried, any safety concerns" />
          </Field>
          <Field label="When did it happen?">
            <input type="datetime-local" name="occurredAt" required defaultValue={toLocalInput(new Date())} />
          </Field>
        </Form>
      </div>
    </Page>
  )
}
