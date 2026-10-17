import { Link } from 'react-router-dom'
import { useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Empty, Page, Select, useFilters } from '../components/ui.jsx'
import { ago, label } from '../format.js'

export default function Tickets() {
  const { can, meta } = useAuth()
  const { query, bind } = useFilters({ status: 'active' })
  const plants = useApi('/plants')
  const result = useApi(`/tickets?${query}`)
  return (
    <Page
      title="Tickets"
      subtitle="Issues reported at the plants"
      actions={can('ticket:create') && <Link className="button primary" to="/tickets/new">Report issue</Link>}
    >
      <div className="toolbar">
        <Select aria-label="Status" {...bind('status')} options={[['active', 'Not closed yet'], ...meta.TICKET_STATUSES.map(s => [s, label(s)])]} placeholder="All statuses" />
        <Select aria-label="Plant" {...bind('plant')} options={(plants.data ?? []).map(p => [p._id, p.name])} placeholder="All plants" />
        <Select aria-label="Priority" {...bind('priority')} options={meta.TICKET_PRIORITIES} placeholder="Any priority" />
        <Select aria-label="Category" {...bind('category')} options={meta.TICKET_CATEGORIES} placeholder="Any category" />
      </div>
      <Async result={result}>{tickets => <div className="card"><TicketTable tickets={tickets} /></div>}</Async>
    </Page>
  )
}

export function TicketTable({ tickets, hidePlant, hideDevice }) {
  const { meta } = useAuth()
  if (!tickets.length) return <Empty>No tickets.</Empty>
  const overdue = t => ['open', 'assigned', 'in_progress'].includes(t.status) && Date.now() - new Date(t.openedAt) > meta.SLA_HOURS[t.priority] * 3_600_000
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Ticket</th>{!hidePlant && <th>Plant</th>}{!hideDevice && <th>Device</th>}<th>Category</th><th>Priority</th><th>Status</th><th>Crew</th><th>Opened</th></tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t._id}>
              <td><Link to={`/tickets/${t._id}`}><strong>{t.number}</strong></Link><div className="small">{t.title}</div></td>
              {!hidePlant && <td>{t.plant?.name}</td>}
              {!hideDevice && <td>{t.device?.name ?? <span className="muted">whole plant</span>}</td>}
              <td>{label(t.category)}</td>
              <td><Badge value={t.priority} /></td>
              <td><Badge value={t.status} />{overdue(t) && <div><Badge value="critical">overdue</Badge></div>}</td>
              <td>{t.assignees?.length ? t.assignees.map(a => a.name).join(', ') : <span className="muted">–</span>}</td>
              <td className="nowrap">{ago(t.openedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
