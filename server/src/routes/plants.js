import { Router } from 'express'
import { OPEN_TICKET_STATUSES } from '../domain.js'
import { requirePermission } from '../middleware/auth.js'
import { Crew } from '../models/Crew.js'
import { Device } from '../models/Device.js'
import { Plant } from '../models/Plant.js'
import { Ticket } from '../models/Ticket.js'
import { loadOverview, withWorkload } from '../services/overview.js'
import { isStale } from '../services/readings.js'
import { HttpError, findOr404, pick } from '../util.js'

const router = Router()
const FIELDS = ['code', 'name', 'address', 'state', 'latitude', 'longitude', 'capacityKwp', 'commissionedOn', 'status']
const SAME_SITE_DEGREES = 0.001 // ≈ 100 m

// Code and name are unique indexes; this also catches the same site registered under a different name.
async function assertNewSite(latitude, longitude, excludeId) {
  const lat = parseFloat(latitude)
  const lng = parseFloat(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return // schema validation reports it
  const filter = {
    status: { $ne: 'decommissioned' },
    latitude: { $gte: lat - SAME_SITE_DEGREES, $lte: lat + SAME_SITE_DEGREES },
    longitude: { $gte: lng - SAME_SITE_DEGREES, $lte: lng + SAME_SITE_DEGREES },
  }
  if (excludeId) filter._id = { $ne: excludeId }
  const near = await Plant.findOne(filter, 'name code')
  if (near) throw new HttpError(409, `These coordinates are within ~100 m of ${near.name} (${near.code}). Is this the same plant?`)
}

router.get('/', async (req, res) => {
  res.json((await loadOverview()).plants)
})

router.post('/', requirePermission('plant:write'), async (req, res) => {
  const data = pick(req.body, FIELDS)
  if (data.status === 'decommissioned') throw new HttpError(400, 'A new plant cannot start decommissioned')
  await assertNewSite(data.latitude, data.longitude)
  res.status(201).json(await Plant.create(data))
})

router.get('/:id', async (req, res) => {
  const plant = await findOr404(Plant, req.params.id)
  const [devices, crew, tickets, overview] = await Promise.all([
    Device.find({ plant: plant._id }).sort('type name').lean(),
    Crew.find({ plants: plant._id, status: { $ne: 'inactive' } }).sort('name').lean(),
    Ticket.find({ plant: plant._id }).sort('-openedAt').limit(50).populate('device', 'name').populate('assignees', 'name').lean(),
    loadOverview(),
  ])
  res.json({
    ...overview.plants.find(p => p._id.equals(plant._id)),
    devices: devices.map(d => ({ ...d, stale: isStale(d) })),
    crew: await withWorkload(crew),
    tickets,
  })
})

router.patch('/:id', requirePermission('plant:write'), async (req, res) => {
  const plant = await findOr404(Plant, req.params.id)
  if (plant.status === 'decommissioned') throw new HttpError(409, 'A decommissioned plant cannot be edited')
  const data = pick(req.body, FIELDS)
  if (data.status === 'decommissioned') throw new HttpError(400, 'Use "Decommission" to retire a plant')
  if (data.latitude !== undefined || data.longitude !== undefined) {
    await assertNewSite(data.latitude ?? plant.latitude, data.longitude ?? plant.longitude, plant._id)
  }
  plant.set(data)
  res.json(await plant.save())
})

// Plants are never deleted: tickets and readings keep referring to them. Decommissioning retires the plant
// and its devices and frees its crew, but only once nothing is left open there.
router.post('/:id/decommission', requirePermission('plant:write'), async (req, res) => {
  const plant = await findOr404(Plant, req.params.id)
  if (plant.status === 'decommissioned') throw new HttpError(409, 'Plant is already decommissioned')
  const open = await Ticket.find({ plant: plant._id, status: { $in: OPEN_TICKET_STATUSES } }, 'number')
  if (open.length) throw new HttpError(409, `Close or cancel its open tickets first: ${open.map(t => t.number).join(', ')}`)

  // No multi-document transaction (the embedded dev MongoDB is standalone): the plant is marked last,
  // so if a step fails the action can simply be repeated.
  const devices = await Device.updateMany({ plant: plant._id, status: { $ne: 'retired' } }, { status: 'retired' })
  const crew = await Crew.updateMany({ plants: plant._id }, { $pull: { plants: plant._id } })
  plant.set({ status: 'decommissioned', decommissionedAt: new Date() })
  await plant.save()
  res.json({ plant, retiredDevices: devices.modifiedCount, crewReleased: crew.modifiedCount })
})

export default router
