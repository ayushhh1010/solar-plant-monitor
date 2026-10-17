// Read models for "how is everything doing": per-plant health, crew workload and the manager dashboard.
// shortcut: computed in memory from a few queries; fine for tens of plants / thousands of devices, move to aggregations beyond that.
import { ASSIGNABLE_STATUSES, OPEN_TICKET_STATUSES, SLA_HOURS } from '../domain.js'
import { Crew } from '../models/Crew.js'
import { Device } from '../models/Device.js'
import { Plant } from '../models/Plant.js'
import { Ticket } from '../models/Ticket.js'
import { round } from '../util.js'
import { isStale } from './readings.js'

const HOUR = 3_600_000
const SEVERITY_ORDER = { critical: 0, warning: 1 }
const byPlant = (items, plantId) => items.filter(i => String(i.plant) === String(plantId))
const isOverdue = (t, now) => t.status !== 'resolved' && now - t.openedAt > SLA_HOURS[t.priority] * HOUR

function plantHealth(plant, devices, staleDevices, tickets) {
  if (plant.status === 'decommissioned') return 'retired'
  if (plant.status === 'offline' || tickets.some(t => t.priority === 'critical') || (devices.length && staleDevices.length === devices.length)) return 'critical'
  if (plant.status === 'maintenance' || staleDevices.length || tickets.some(t => t.priority === 'high' || !t.assignees.length)) return 'warning'
  return 'ok'
}

export async function loadOverview(now = Date.now()) {
  const [plants, devices, tickets, crew] = await Promise.all([
    Plant.find().sort('name').lean(),
    Device.find({ status: { $ne: 'retired' } }, 'plant type name serialNumber status lastReadingAt lastReading').lean(),
    Ticket.find({ status: { $in: OPEN_TICKET_STATUSES } }, 'number title plant device priority status assignees openedAt resolvedAt').lean(),
    Crew.find({ status: 'active' }, 'plants').lean(),
  ])
  const stale = devices.filter(d => isStale(d, now))
  const plantRows = plants.map(p => {
    const pDevices = byPlant(devices, p._id)
    const pStale = byPlant(stale, p._id)
    const pTickets = byPlant(tickets, p._id)
    const liveKw = pDevices.filter(d => d.type === 'inverter' && !isStale(d, now)).reduce((sum, d) => sum + (d.lastReading?.acPowerKw ?? 0), 0)
    return {
      ...p,
      deviceCount: pDevices.length,
      staleDevices: pStale.length,
      openTickets: pTickets.length,
      criticalTickets: pTickets.filter(t => t.priority === 'critical').length,
      crewCount: crew.filter(c => c.plants.some(id => String(id) === String(p._id))).length,
      liveKw: round(liveKw),
      health: plantHealth(p, pDevices, pStale, pTickets),
    }
  })
  return { plants: plantRows, devices, stale, tickets }
}

// Adds each crew member's number of unfinished tickets, so dispatchers can pick the least loaded person.
export async function withWorkload(crew) {
  const counts = await Ticket.aggregate([
    { $match: { status: { $in: ASSIGNABLE_STATUSES }, assignees: { $in: crew.map(c => c._id) } } },
    { $unwind: '$assignees' },
    { $group: { _id: '$assignees', n: { $sum: 1 } } },
  ])
  const byId = new Map(counts.map(c => [String(c._id), c.n]))
  return crew.map(c => ({ ...c, openTickets: byId.get(String(c._id)) ?? 0 }))
}

export async function dashboard(now = Date.now()) {
  const { plants, stale, tickets } = await loadOverview(now)
  const active = plants.filter(p => p.status !== 'decommissioned')
  const plantName = id => plants.find(p => String(p._id) === String(id))?.name ?? 'Unknown plant'

  // "Needs attention": everything a manager should look at, worst first.
  const attention = []
  for (const p of active) {
    if (p.status === 'offline' || p.status === 'maintenance') {
      attention.push({ severity: p.status === 'offline' ? 'critical' : 'warning', title: `${p.name} is ${p.status === 'offline' ? 'offline' : 'under maintenance'}`, detail: `${p.capacityKwp.toLocaleString('en-IN')} kWp affected`, link: `/plants/${p._id}`, since: p.statusSince })
    }
    const pStale = byPlant(stale, p._id)
    if (pStale.length) {
      const oldest = Math.min(...pStale.map(d => d.lastReadingAt?.getTime() ?? 0))
      attention.push({ severity: pStale.length === p.deviceCount ? 'critical' : 'warning', title: `${pStale.length} device${pStale.length > 1 ? 's' : ''} not reporting at ${p.name}`, detail: pStale.map(d => d.name).join(', '), link: `/plants/${p._id}`, since: oldest ? new Date(oldest) : null })
    }
  }
  for (const t of tickets) {
    const reasons = []
    if (t.priority === 'critical' || t.priority === 'high') reasons.push(`${t.priority} priority`)
    if (!t.assignees.length) reasons.push('no crew assigned')
    if (isOverdue(t, now)) reasons.push(`past ${SLA_HOURS[t.priority]}h target`)
    if (t.status === 'resolved' && now - t.resolvedAt > 24 * HOUR) reasons.push('awaiting verification for over a day')
    if (!reasons.length) continue
    const critical = t.priority === 'critical' || isOverdue(t, now)
    attention.push({ severity: critical ? 'critical' : 'warning', title: `${t.number} · ${t.title}`, detail: `${plantName(t.plant)} · ${t.status.replace('_', ' ')} · ${reasons.join(', ')}`, link: `/tickets/${t._id}`, since: t.openedAt })
  }
  attention.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.since ?? 0) - (b.since ?? 0))

  const count = (items, fn) => items.filter(fn).length
  const kpis = {
    plants: active.length,
    plantsByStatus: Object.fromEntries(['operational', 'commissioning', 'maintenance', 'offline'].map(s => [s, count(active, p => p.status === s)])),
    capacityKwp: active.reduce((s, p) => s + p.capacityKwp, 0),
    liveKw: round(active.reduce((s, p) => s + p.liveKw, 0)),
    devices: active.reduce((s, p) => s + p.deviceCount, 0),
    staleDevices: stale.length,
    openTickets: tickets.length,
    criticalTickets: count(tickets, t => t.priority === 'critical'),
    unassignedTickets: count(tickets, t => !t.assignees.length),
    overdueTickets: count(tickets, t => isOverdue(t, now)),
  }
  return { generatedAt: new Date(now), kpis, attention, plants: active, insights: await insights(plants, tickets, now) }
}

// Bonus: how long issues stay open and which plants raise the most of them (last 90 days).
async function insights(plants, openTickets, now) {
  const since = new Date(now - 90 * 24 * HOUR)
  const recent = await Ticket.find({ openedAt: { $gte: since } }, 'plant priority status openedAt resolvedAt').lean()
  const hours = t => (t.resolvedAt - t.openedAt) / HOUR
  const resolved = recent.filter(t => t.resolvedAt)

  const resolutionHoursByPriority = Object.fromEntries(Object.keys(SLA_HOURS).map(priority => {
    const list = resolved.filter(t => t.priority === priority).map(hours)
    return [priority, { count: list.length, avgHours: list.length ? round(list.reduce((a, b) => a + b, 0) / list.length, 1) : null, targetHours: SLA_HOURS[priority] }]
  }))

  const ages = openTickets.map(t => (now - t.openedAt) / HOUR)
  const openAge = [['< 1 day', 0, 24], ['1–3 days', 24, 72], ['3–7 days', 72, 168], ['> 7 days', 168, Infinity]]
    .map(([label, min, max]) => ({ label, count: ages.filter(a => a >= min && a < max).length }))

  const ticketsByPlant = plants
    .map(p => ({ plantId: p._id, name: p.name, total: byPlant(recent, p._id).length, open: byPlant(openTickets, p._id).length }))
    .filter(r => r.total)
    .sort((a, b) => b.total - a.total)

  return { periodDays: 90, resolutionHoursByPriority, openAge, ticketsByPlant }
}
