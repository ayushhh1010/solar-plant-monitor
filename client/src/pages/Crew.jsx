import { useState } from 'react'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Checkboxes, Empty, Field, Form, Modal, Page, Select, useFilters } from '../components/ui.jsx'
import { label } from '../format.js'

export default function Crew() {
  const { can, meta } = useAuth()
  const [editing, setEditing] = useState(null) // {} = new member
  const { query, value, bind } = useFilters()
  const plants = useApi('/plants')
  const result = useApi(`/crew?${query}`)
  const livePlants = (plants.data ?? []).filter(p => p.status !== 'decommissioned')
  const saved = () => { setEditing(null); result.reload() }

  return (
    <Page
      title="Crew"
      subtitle="Field technicians, where they work and how busy they are"
      actions={can('crew:write') && <button className="primary" onClick={() => setEditing({})}>+ Add crew member</button>}
    >
      <div className="toolbar">
        <Select aria-label="Plant" {...bind('plant')} options={livePlants.map(p => [p._id, p.name])} placeholder="All plants" />
        <Select aria-label="Status" {...bind('status')} options={meta.CREW_STATUSES} placeholder="Any status" />
        <label className="check">
          <input type="checkbox" checked={value('available') === 'true'} onChange={bind('available').onChange} /> Available now only
        </label>
      </div>
      <Async result={result}>
        {crew => <div className="card"><CrewTable crew={crew} showPlants onEdit={can('crew:write') ? setEditing : undefined} /></div>}
      </Async>
      {editing && plants.data && (
        <Modal title={editing._id ? `Edit ${editing.name}` : 'Add crew member'} onClose={() => setEditing(null)}>
          <CrewForm member={editing} plants={livePlants} onSaved={saved} />
        </Modal>
      )}
    </Page>
  )
}

export function CrewTable({ crew, showPlants, onEdit }) {
  if (!crew.length) return <Empty>No crew members match.</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Skills</th>{showPlants && <th>Plants</th>}<th>Status</th><th className="num">Open tickets</th>{onEdit && <th />}</tr>
        </thead>
        <tbody>
          {crew.map(c => (
            <tr key={c._id} className={c.status === 'inactive' ? 'dim' : ''}>
              <td><strong>{c.name}</strong>{c.email && <div className="muted small">{c.email}</div>}</td>
              <td><a href={`tel:${c.phone.replaceAll(' ', '')}`}>{c.phone}</a></td>
              <td>{c.skills.map(s => <span key={s} className="chip">{label(s)}</span>)}</td>
              {showPlants && <td>{c.plants.length ? c.plants.map(p => <span key={p._id} className="chip">{p.name}</span>) : <span className="muted">none</span>}</td>}
              <td><Badge value={c.status} /></td>
              <td className="num">{c.openTickets}</td>
              {onEdit && <td><button className="small" onClick={() => onEdit(c)}>Edit</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CrewForm({ member, plants, onSaved }) {
  const { meta } = useAuth()
  const assigned = (member.plants ?? []).map(p => p._id)
  const save = values => (member._id
    ? api(`/crew/${member._id}`, { method: 'PATCH', body: values })
    : api('/crew', { method: 'POST', body: values })).then(onSaved)
  return (
    <Form onSubmit={save} submitLabel={member._id ? 'Save changes' : 'Add crew member'}>
      <Field label="Name"><input name="name" defaultValue={member.name} required maxLength={80} /></Field>
      <Field label="Phone"><input name="phone" type="tel" defaultValue={member.phone} required pattern="\+?[0-9 \-]{7,20}" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={member.email} /></Field>
      <Field label="Status" hint="Leaving or going on leave is refused while they hold unfinished tickets">
        <Select name="status" defaultValue={member.status ?? 'active'} options={meta.CREW_STATUSES} />
      </Field>
      <Checkboxes legend="Skills" name="skills" options={meta.CREW_SKILLS.map(s => [s, label(s)])} selected={member.skills} />
      <Checkboxes legend="Works at" name="plants" options={plants.map(p => [p._id, p.name])} selected={assigned} />
    </Form>
  )
}
