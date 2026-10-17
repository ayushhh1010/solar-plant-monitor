// Ticket workflow. Every change goes through here so the lifecycle rules and the audit trail can't be bypassed.
// `at` defaults to now; the seed passes past times to build a realistic history through the same rules.
import { ASSIGNABLE_STATUSES, OPEN_TICKET_STATUSES, TICKET_PRIORITIES, can, findTransition } from '../domain.js'
import { Crew } from '../models/Crew.js'
import { Device } from '../models/Device.js'
import { Plant } from '../models/Plant.js'
import { Ticket, nextTicketNumber } from '../models/Ticket.js'
import { HttpError, findOr404, oid, pick } from '../util.js'

const MAX_NOTE = 2000
const entry = (user, at, action, extra) => ({ at, by: user._id, action, ...extra })
const names = crew => crew.map(c => c.name).join(', ') || 'nobody'

function cleanNote(note, required, what) {
  const text = typeof note === 'string' ? note.trim() : ''
  if (required && !text) throw new HttpError(400, `A note is required to ${what}`)
  if (text.length > MAX_NOTE) throw new HttpError(400, `Note is longer than ${MAX_NOTE} characters`)
  return text || undefined
}

// Applies a change only if nobody else changed the ticket since we read it (optimistic locking).
async function save(ticket, change) {
  const updated = await Ticket.findOneAndUpdate({ _id: ticket._id, updatedAt: ticket.updatedAt }, change, { returnDocument: 'after' })
  if (!updated) throw new HttpError(409, 'This ticket was just changed by someone else. Reload and try again.')
  return updated
}

export async function createTicket(body, user, at = new Date()) {
  const data = pick(body, ['category', 'priority', 'title', 'description', 'occurredAt'])
  const plant = await Plant.findById(oid(body?.plant, 'plant'))
  if (!plant) throw new HttpError(400, 'Choose an existing plant')
  if (plant.status === 'decommissioned') throw new HttpError(409, `${plant.name} is decommissioned`)

  let device
  if (body.device) {
    device = await Device.findById(oid(body.device, 'device'))
    if (!device?.plant.equals(plant._id)) throw new HttpError(400, 'That device is not installed at this plant')
    if (device.status === 'retired') throw new HttpError(409, `${device.name} is retired`)
  } else if (data.category === 'device_fault') {
    throw new HttpError(400, 'A device fault must name the faulty device')
  }

  const occurredAt = new Date(data.occurredAt || at)
  if (isNaN(occurredAt) || occurredAt > Date.now() + 5 * 60_000) throw new HttpError(400, 'The event time must be a valid time, not in the future')

  const duplicate = await Ticket.findOne({ plant: plant._id, device: device?._id ?? null, category: data.category, status: { $in: OPEN_TICKET_STATUSES } }, 'number')
  if (duplicate) throw new HttpError(409, `${duplicate.number} is already open for this ${device ? 'device' : 'plant'} and category; add a comment there instead`)

  return Ticket.create({
    ...data, occurredAt, plant: plant._id, device: device?._id,
    number: await nextTicketNumber(), status: 'open', reportedBy: user._id, openedAt: at,
    history: [entry(user, at, 'created', { to: 'open' })],
  })
}

// Sets the crew on a ticket. The first assignment moves it from open to assigned.
export async function assignTicket(id, crewIds, user, at = new Date()) {
  const ticket = await findOr404(Ticket, id)
  if (!ASSIGNABLE_STATUSES.includes(ticket.status)) throw new HttpError(409, `Crew cannot be changed on a ${ticket.status} ticket`)
  const ids = [...new Set((Array.isArray(crewIds) ? crewIds : []).map(c => oid(c, 'crew member')))]
  if (!ids.length) throw new HttpError(400, 'Choose at least one crew member')

  const crew = await Crew.find({ _id: { $in: ids } })
  if (crew.length !== ids.length) throw new HttpError(400, 'Unknown crew member')
  const unavailable = crew.filter(c => c.status !== 'active' || !c.plants.some(p => p.equals(ticket.plant)))
  if (unavailable.length) throw new HttpError(400, `${names(unavailable)} cannot be sent: not active or not assigned to this plant`)

  const before = await Crew.find({ _id: { $in: ticket.assignees } }, 'name')
  const history = [entry(user, at, 'assigned', { from: names(before), to: names(crew) })]
  const status = ticket.status === 'open' ? 'assigned' : ticket.status
  if (status !== ticket.status) history.push(entry(user, at, 'status', { from: ticket.status, to: status }))
  return save(ticket, { $set: { assignees: crew.map(c => c._id), status }, $push: { history: { $each: history } } })
}

export async function transitionTicket(id, to, note, user, at = new Date()) {
  const ticket = await findOr404(Ticket, id)
  const rule = findTransition(ticket.status, to)
  if (!rule) throw new HttpError(409, `A ${ticket.status} ticket cannot be moved to ${to}`)
  if (!can(user.role, rule.permission)) throw new HttpError(403, `Your role cannot ${rule.label.toLowerCase()}`)
  note = cleanNote(note, rule.noteRequired, rule.label.toLowerCase())

  const change = { $set: { status: to }, $push: { history: entry(user, at, 'status', { from: ticket.status, to, note }) } }
  if (to === 'resolved') Object.assign(change.$set, { resolution: note, resolvedAt: at })
  if (to === 'closed' || to === 'cancelled') change.$set.closedAt = at
  if (ticket.status === 'resolved' && to === 'in_progress') change.$unset = { resolvedAt: 1, resolution: 1 } // reopened; old resolution stays in history
  return save(ticket, change)
}

export async function changePriority(id, priority, user, at = new Date()) {
  const ticket = await findOr404(Ticket, id)
  if (!OPEN_TICKET_STATUSES.includes(ticket.status)) throw new HttpError(409, `A ${ticket.status} ticket cannot be changed`)
  if (!TICKET_PRIORITIES.includes(priority)) throw new HttpError(400, 'Unknown priority')
  if (priority === ticket.priority) return ticket
  return save(ticket, { $set: { priority }, $push: { history: entry(user, at, 'priority', { from: ticket.priority, to: priority }) } })
}

// Comments are allowed at any stage, including after closing, so late findings are not lost.
export async function addComment(id, text, user, at = new Date()) {
  const note = cleanNote(text, true, 'comment')
  const ticket = await Ticket.findByIdAndUpdate(id, { $push: { history: entry(user, at, 'comment', { note }) } }, { returnDocument: 'after' })
  if (!ticket) throw new HttpError(404, 'Ticket not found')
  return ticket
}
