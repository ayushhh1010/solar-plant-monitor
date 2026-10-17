import { Router } from 'express'
import { OPEN_TICKET_STATUSES } from '../domain.js'
import { requirePermission } from '../middleware/auth.js'
import { Ticket } from '../models/Ticket.js'
import { addComment, assignTicket, changePriority, createTicket, transitionTicket } from '../services/tickets.js'
import { HttpError, pick } from '../util.js'

const router = Router()

// ?status=active means every not-yet-closed status.
router.get('/', async (req, res) => {
  const filter = pick(req.query, ['status', 'plant', 'device', 'priority', 'category'])
  if (filter.status === 'active') filter.status = { $in: OPEN_TICKET_STATUSES }
  // shortcut: newest 500 only, no pagination; add cursor paging when ticket volume grows.
  const tickets = await Ticket.find(filter).sort('-openedAt').limit(500)
    .select('-history')
    .populate('plant', 'name code')
    .populate('device', 'name type')
    .populate('assignees', 'name')
    .populate('reportedBy', 'name')
    .lean()
  res.json(tickets)
})

router.post('/', requirePermission('ticket:create'), async (req, res) => {
  res.status(201).json(await createTicket(req.body, req.user))
})

router.get('/:id', async (req, res) => {
  const ticket = await Ticket.findById(req.params.id)
    .populate('plant', 'name code status')
    .populate('device', 'name type serialNumber status')
    .populate('assignees', 'name phone skills status')
    .populate('reportedBy', 'name role')
    .populate('history.by', 'name role')
    .lean()
  if (!ticket) throw new HttpError(404, 'Ticket not found')
  res.json(ticket)
})

router.post('/:id/assign', requirePermission('ticket:triage'), async (req, res) => {
  res.json(await assignTicket(req.params.id, req.body?.crewIds, req.user))
})

// Permission depends on the transition, so it is checked inside the workflow service.
router.post('/:id/transition', requirePermission('ticket:work'), async (req, res) => {
  res.json(await transitionTicket(req.params.id, req.body?.to, req.body?.note, req.user))
})

router.post('/:id/priority', requirePermission('ticket:triage'), async (req, res) => {
  res.json(await changePriority(req.params.id, req.body?.priority, req.user))
})

router.post('/:id/comments', requirePermission('ticket:work'), async (req, res) => {
  res.status(201).json(await addComment(req.params.id, req.body?.text, req.user))
})

export default router
