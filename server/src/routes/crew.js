import { Router } from 'express'
import { ASSIGNABLE_STATUSES } from '../domain.js'
import { requirePermission } from '../middleware/auth.js'
import { Crew } from '../models/Crew.js'
import { Plant } from '../models/Plant.js'
import { Ticket } from '../models/Ticket.js'
import { withWorkload } from '../services/overview.js'
import { HttpError, findOr404, oid, pick } from '../util.js'

const router = Router()
const FIELDS = ['name', 'phone', 'email', 'skills', 'status']

async function assertLivePlants(ids) {
  const plants = await Plant.find({ _id: { $in: ids } }, 'name status')
  if (plants.length !== ids.length) throw new HttpError(400, 'Unknown plant')
  const closed = plants.filter(p => p.status === 'decommissioned')
  if (closed.length) throw new HttpError(409, `${closed.map(p => p.name).join(', ')} is decommissioned`)
}

const plantIds = value => {
  if (!Array.isArray(value)) throw new HttpError(400, 'plants must be a list')
  return [...new Set(value.map(id => oid(id, 'plant')))]
}

// ?plant=<id>&available=true answers "who can I send to this plant right now?"
router.get('/', async (req, res) => {
  const filter = pick(req.query, ['plant', 'status', 'skills'])
  if (filter.plant) filter.plants = filter.plant
  delete filter.plant
  if (req.query.available === 'true') filter.status = 'active'
  const crew = await Crew.find(filter).sort('name').populate('plants', 'name code').lean()
  res.json(await withWorkload(crew))
})

router.post('/', requirePermission('crew:write'), async (req, res) => {
  const plants = plantIds(req.body?.plants ?? [])
  await assertLivePlants(plants)
  res.status(201).json(await Crew.create({ ...pick(req.body, FIELDS), plants }))
})

router.patch('/:id', requirePermission('crew:write'), async (req, res) => {
  const member = await findOr404(Crew, req.params.id)
  const data = pick(req.body, FIELDS)
  const leaving = data.status && data.status !== 'active'
  const plants = req.body?.plants === undefined ? member.plants.map(String) : plantIds(req.body.plants)
  const removed = member.plants.map(String).filter(id => !plants.includes(id))
  const added = plants.filter(id => !member.plants.some(p => p.equals(id)))

  // Unfinished tickets must be handed to someone else first, otherwise they would be left with nobody able to act.
  if (leaving || removed.length) {
    const tickets = await Ticket.find({ assignees: member._id, status: { $in: ASSIGNABLE_STATUSES } }, 'number plant')
    const blocking = tickets.filter(t => leaving || removed.includes(String(t.plant)))
    if (blocking.length) throw new HttpError(409, `Reassign ${blocking.map(t => t.number).join(', ')} to someone else first`)
  }
  if (added.length) await assertLivePlants(added)

  member.set({ ...data, plants })
  res.json(await member.save())
})

export default router
