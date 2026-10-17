import { Link } from 'react-router-dom'
import { useApi } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Async, Badge, Empty, Page, Stat } from '../components/ui.jsx'
import { ago, capacity, hours, label, power } from '../format.js'
import { PlantTable } from './Plants.jsx'

export default function Dashboard() {
  const { meta } = useAuth()
  const result = useApi('/dashboard', { refreshMs: 30_000 })
  return (
    <Async result={result}>
      {({ kpis, attention, plants, insights, generatedAt }) => (
        <Page title="Overview" subtitle={`All plants · updated ${ago(generatedAt)} · refreshes every 30 s`}>
          <div className="stats">
            <Stat title="Live output" value={power(kpis.liveKw)} sub={`of ${capacity(kpis.capacityKwp)} installed`} />
            <Stat
              title="Plants in service"
              value={kpis.plants}
              sub={Object.entries(kpis.plantsByStatus).filter(([, n]) => n).map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(' · ')}
              tone={kpis.plantsByStatus.offline ? 'red' : undefined}
            />
            <Stat
              title="Open tickets"
              value={kpis.openTickets}
              sub={`${kpis.criticalTickets} critical · ${kpis.unassignedTickets} unassigned · ${kpis.overdueTickets} overdue`}
              tone={kpis.criticalTickets || kpis.overdueTickets ? 'red' : undefined}
            />
            <Stat
              title="Devices not reporting"
              value={`${kpis.staleDevices} / ${kpis.devices}`}
              sub={`no data for over ${meta.staleAfterMin} min`}
              tone={kpis.staleDevices ? 'amber' : 'green'}
            />
          </div>

          <section className="card">
            <h2>Needs attention {attention.length > 0 && <span className="count">{attention.length}</span>}</h2>
            {attention.length === 0 ? (
              <Empty>All clear: nothing needs attention right now.</Empty>
            ) : (
              <ul className="attention">
                {attention.map(a => (
                  <li key={a.link + a.title} className={`sev-${a.severity}`}>
                    <Link to={a.link}>{a.title}</Link>
                    <div className="muted small">{a.detail}{a.since && ` · since ${ago(a.since)}`}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Plants</h2>
            <PlantTable plants={plants} />
          </section>

          <Insights insights={insights} />
        </Page>
      )}
    </Async>
  )
}

const Bars = ({ rows }) => {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="bars">
      {rows.map(r => (
        <div key={r.label} className="bar-row">
          <span>{r.label}</span>
          <div className="bar"><div style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num">{r.value}{r.extra}</span>
        </div>
      ))}
    </div>
  )
}

function Insights({ insights }) {
  return (
    <div className="grid-3">
      <section className="card">
        <h2>Time to resolve</h2>
        <p className="muted small">Average from report to fix, last {insights.periodDays} days</p>
        <table className="table">
          <thead><tr><th>Priority</th><th>Fixed</th><th>Average</th><th>Target</th></tr></thead>
          <tbody>
            {Object.entries(insights.resolutionHoursByPriority).map(([priority, r]) => (
              <tr key={priority}>
                <td><Badge value={priority} /></td>
                <td>{r.count}</td>
                <td className={r.avgHours > r.targetHours ? 'bad' : ''}>{hours(r.avgHours)}</td>
                <td>{hours(r.targetHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Age of open tickets</h2>
        <p className="muted small">How long unfinished tickets have been waiting</p>
        <Bars rows={insights.openAge.map(a => ({ label: a.label, value: a.count }))} />
      </section>
      <section className="card">
        <h2>Tickets by plant</h2>
        <p className="muted small">Raised in the last {insights.periodDays} days (open now)</p>
        {insights.ticketsByPlant.length ? (
          <Bars rows={insights.ticketsByPlant.map(p => ({ label: p.name, value: p.total, extra: ` (${p.open})` }))} />
        ) : <Empty>No tickets yet.</Empty>}
      </section>
    </div>
  )
}
