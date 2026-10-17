import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Checkboxes, Empty, Field, Form, Modal, Page, Select } from '../components/ui.jsx'
import { ago, dateTime, hours, label } from '../format.js'

const FLOW = ['open', 'assigned', 'in_progress', 'resolved', 'closed']

export default function TicketDetail() {
  const { id } = useParams()
  const result = useApi(`/tickets/${id}`)
  return <Async result={result}>{ticket => <TicketView ticket={ticket} reload={result.reload} />}</Async>
}

function TicketView({ ticket: t, reload }) {
  const { can, meta } = useAuth()
  const [modal, setModal] = useState(null) // a transition, or 'assign'
  const close = () => setModal(null)
  const saved = () => { close(); reload() }
  const next = meta.TRANSITIONS.filter(x => x.from === t.status)
  const canAssign = can('ticket:triage') && meta.ASSIGNABLE_STATUSES.includes(t.status)
  const isOpen = meta.OPEN_TICKET_STATUSES.includes(t.status)
  const who = permission => meta.PERMISSIONS[permission].map(label).join(' / ')
  const targetHours = meta.SLA_HOURS[t.priority]
  const elapsed = ((t.resolvedAt ? new Date(t.resolvedAt) : Date.now()) - new Date(t.openedAt)) / 3_600_000

  return (
    <Page
      title={`${t.number} · ${t.title}`}
      subtitle={<><Link to={`/plants/${t.plant._id}`}>{t.plant.name}</Link>{t.device && <> · <Link to={`/devices/${t.device._id}`}>{t.device.name}</Link></>} · reported by {t.reportedBy.name} {ago(t.openedAt)}</>}
    >
      <Stepper status={t.status} />

      <div className="grid-main">
        <div>
          <section className="card">
            <div className="badges">
              <Badge value={t.priority}>{label(t.priority)} priority</Badge>
              <Badge value={t.status} />
              <Badge value="category">{label(t.category)}</Badge>
            </div>
            <p className="pre">{t.description}</p>
            <dl className="facts">
              <dt>Happened</dt><dd>{dateTime(t.occurredAt)}</dd>
              <dt>Reported</dt><dd>{dateTime(t.openedAt)} by {t.reportedBy.name}</dd>
              <dt>Target</dt>
              <dd>
                Fix within {targetHours} h ·{' '}
                {t.resolvedAt ? `fixed in ${hours(elapsed)}` : isOpen ? (elapsed > targetHours ? <strong className="bad">{hours(elapsed - targetHours)} overdue</strong> : `${hours(targetHours - elapsed)} left`) : '–'}
              </dd>
              {t.resolution && <><dt>Resolution</dt><dd>{t.resolution}</dd></>}
              {t.closedAt && <><dt>{t.status === 'cancelled' ? 'Cancelled' : 'Closed'}</dt><dd>{dateTime(t.closedAt)}</dd></>}
            </dl>
          </section>

          <section className="card">
            <h2>Activity</h2>
            <Timeline history={t.history} />
            {can('ticket:work') && <CommentBox ticketId={t._id} onSaved={reload} />}
          </section>
        </div>

        <aside>
          <section className="card">
            <h2>Next step</h2>
            {!isOpen && <p className="muted">This ticket is {label(t.status).toLowerCase()}; its history is kept for reference.</p>}
            {t.status === 'open' && (
              canAssign
                ? <button className="primary block" onClick={() => setModal('assign')}>Assign crew</button>
                : <p className="muted">Waiting for {who('ticket:triage')} to assign crew.</p>
            )}
            {next.map(x => can(x.permission)
              ? <button key={x.to} className={`block ${x.to === 'cancelled' ? 'danger-outline' : 'primary'}`} onClick={() => setModal(x)}>{x.label}</button>
              : <p key={x.to} className="muted small">{who(x.permission)} can: {x.label.toLowerCase()}</p>)}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Crew</h2>
              {canAssign && t.assignees.length > 0 && <button className="small" onClick={() => setModal('assign')}>Change</button>}
            </div>
            {t.assignees.length ? (
              <ul className="plain">
                {t.assignees.map(c => (
                  <li key={c._id}>
                    <strong>{c.name}</strong> <a href={`tel:${c.phone.replaceAll(' ', '')}`}>{c.phone}</a>
                    <div className="muted small">{c.skills.map(label).join(', ')}{c.status !== 'active' && ` · ${label(c.status)}`}</div>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nobody assigned yet.</Empty>}
          </section>

          {can('ticket:triage') && isOpen && <PriorityControl ticket={t} onSaved={reload} />}
        </aside>
      </div>

      {modal === 'assign' && <AssignCrew ticket={t} onClose={close} onSaved={saved} />}
      {modal?.to && (
        <Modal title={`${modal.label}: ${t.number}`} onClose={close}>
          <Form onSubmit={values => api(`/tickets/${t._id}/transition`, { method: 'POST', body: { to: modal.to, note: values.note } }).then(saved)} submitLabel={modal.label} danger={modal.to === 'cancelled'}>
            <Field label={modal.to === 'resolved' ? 'What was done to fix it?' : modal.noteRequired ? 'Reason' : 'Note (optional)'} wide>
              <textarea name="note" rows={4} required={modal.noteRequired} maxLength={2000} />
            </Field>
          </Form>
        </Modal>
      )}
    </Page>
  )
}

function Stepper({ status }) {
  const steps = status === 'cancelled' ? ['open', 'cancelled'] : FLOW
  const current = steps.indexOf(status)
  return (
    <ol className="stepper" aria-label="Ticket progress">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>{label(s)}</li>
      ))}
    </ol>
  )
}

function describe(h) {
  switch (h.action) {
    case 'created': return 'reported the issue'
    case 'status': return <>moved it from <Badge value={h.from} /> to <Badge value={h.to} /></>
    case 'assigned': return h.from === 'nobody' ? `assigned ${h.to}` : `changed crew from ${h.from} to ${h.to}`
    case 'priority': return <>changed priority from <Badge value={h.from} /> to <Badge value={h.to} /></>
    default: return 'commented'
  }
}

// The audit trail: who did what, when, oldest first.
function Timeline({ history }) {
  return (
    <ol className="timeline">
      {history.map((h, i) => (
        <li key={i} className={`tl-${h.action}`}>
          <div><strong>{h.by?.name ?? 'Unknown'}</strong> <span className="muted small">{label(h.by?.role)}</span> {describe(h)}</div>
          {h.note && <blockquote>{h.note}</blockquote>}
          <time className="muted small" dateTime={h.at}>{dateTime(h.at)}</time>
        </li>
      ))}
    </ol>
  )
}

function CommentBox({ ticketId, onSaved }) {
  const [version, setVersion] = useState(0) // remount to clear the box after posting
  return (
    <div key={version} className="comment-box">
      <Form submitLabel="Add comment" onSubmit={values => api(`/tickets/${ticketId}/comments`, { method: 'POST', body: values }).then(() => { setVersion(v => v + 1); onSaved() })}>
        <Field label="Add a comment" wide><textarea name="text" rows={3} required maxLength={2000} placeholder="Progress, findings, parts ordered…" /></Field>
      </Form>
    </div>
  )
}

function PriorityControl({ ticket, onSaved }) {
  const { meta } = useAuth()
  const [error, setError] = useState(null)
  const change = e => api(`/tickets/${ticket._id}/priority`, { method: 'POST', body: { priority: e.target.value } }).then(onSaved, err => setError(err.message))
  return (
    <section className="card">
      <h2>Priority</h2>
      <Select aria-label="Priority" value={ticket.priority} onChange={change} options={meta.TICKET_PRIORITIES} />
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function AssignCrew({ ticket, onClose, onSaved }) {
  const crew = useApi(`/crew?plant=${ticket.plant._id}&available=true`)
  const current = ticket.assignees.map(c => c._id)
  return (
    <Modal title={`Crew for ${ticket.number}`} onClose={onClose}>
      <p className="muted">Active crew assigned to {ticket.plant.name}, with how many unfinished tickets each already has.</p>
      <Async result={crew}>
        {list => list.length === 0 ? <Empty>No active crew works at this plant. Add someone on the Crew page first.</Empty> : (
          <Form submitLabel="Save crew" onSubmit={values => api(`/tickets/${ticket._id}/assign`, { method: 'POST', body: values }).then(onSaved)}>
            <Checkboxes
              legend="Send"
              name="crewIds"
              selected={current}
              options={list.map(c => [c._id, `${c.name} · ${c.skills.map(label).join(', ')} · ${c.openTickets} open`])}
            />
          </Form>
        )}
      </Async>
    </Modal>
  )
}
