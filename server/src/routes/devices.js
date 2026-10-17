import { Router } from 'express'
import { OPEN_TICKET_STATUSES } from '../domain.js'
import { requirePermission } from '../middleware/auth.js'
import { Device, Inverter, Meter } from '../models/Device.js'
import { Plant } from '../models/Plant.js'
import { Ticket } from '../models/Ticket.js'
import { MAX_RANGE_DAYS, deviceSeries, isStale } from '../services/readings.js'
import { HttpError, findOr404, oid, pick } from '../util.js'

const router = Router()
const COMMON = ['name', 'serialNumber', 'manufacturer', 'model', 'installedOn', 'status']
const BY_TYPE = {
  meter: { Model: Meter, fields: ['meterKind', 'accuracyClass'] },
  inverter: { Model: Inverter, fields: ['ratedPowerKw', 'mpptCount'] },
}

async function livePlant(id) {
  const plant = await Plant.findById(oid(id, 'plant'))
  if (!plant) throw new HttpError(400, 'A device must belong to an existing plant')
  if (plant.status === 'decommissioned') throw new HttpError(409, `${plant.name} is decommissioned`)
  return plant
}

async function assertNoOpenTickets(device, action) {
  const open = await Ticket.find({ device: device._id, status: { $in: OPEN_TICKET_STATUSES } }, 'number')
  if (open.length) throw new HttpError(409, `Cannot ${action} while tickets are open for this device: ${open.map(t => t.number).join(', ')}`)
}

router.get('/', async (req, res) => {
  const filter = pick(req.query, ['plant', 'type', 'status'])
  const devices = await Device.find(filter).sort({ plant: 1, type: 1, name: 1 }).populate('plant', 'name code status').lean()
  res.json(devices.map(d => ({ ...d, stale: isStale(d) })))
})

router.post('/', requirePermission('device:write'), async (req, res) => {
  const spec = BY_TYPE[req.body?.type]
  if (!spec) throw new HttpError(400, 'Device type must be meter or inverter')
  const plant = await livePlant(req.body.plant)
  const data = pick(req.body, [...COMMON, ...spec.fields])
  if (data.status === 'retired') throw new HttpError(400, 'A new device cannot start retired')
  res.status(201).json(await spec.Model.create({ ...data, plant: plant._id }))
})

router.get('/:id', async (req, res) => {
  const device = await Device.findById(req.params.id)
    .populate('plant', 'name code status latitude longitude')
    .populate('moves.from moves.to', 'name code')
    .populate('moves.by', 'name')
    .lean()
  if (!device) throw new HttpError(404, 'Device not found')
  const tickets = await Ticket.find({ device: device._id }).sort('-openedAt').limit(20).populate('assignees', 'name').lean()
  res.json({ ...device, stale: isStale(device), tickets })
})

// The plant and the type are fixed here: moving has its own action, and a meter never becomes an inverter.
router.patch('/:id', requirePermission('device:write'), async (req, res) => {
  const device = await findOr404(Device, req.params.id)
  const data = pick(req.body, [...COMMON, ...BY_TYPE[device.type].fields])
  if (data.status === 'retired' && device.status !== 'retired') await assertNoOpenTickets(device, 'retire it')
  if (device.status === 'retired' && data.status && data.status !== 'retired') await livePlant(String(device.plant))
  device.set(data)
  res.json(await device.save())
})

router.post('/:id/move', requirePermission('device:write'), async (req, res) => {
  const device = await findOr404(Device, req.params.id)
  if (device.status === 'retired') throw new HttpError(409, 'Reactivate the device before moving it')
  const target = await livePlant(req.body?.plant)
  if (target._id.equals(device.plant)) throw new HttpError(400, 'The device is already at this plant')
  // Open tickets describe a problem at the current site, so they must be settled before the device leaves.
  await assertNoOpenTickets(device, 'move it')
  device.moves.push({ from: device.plant, to: target._id, at: new Date(), by: req.user._id })
  device.plant = target._id
  res.json(await device.save())
})

router.get('/:id/readings', async (req, res) => {
  const device = await findOr404(Device, req.params.id)
  const to = req.query.to ? new Date(req.query.to) : new Date()
  const from = req.query.from ? new Date(req.query.from) : new Date(to - 86_400_000)
  if (isNaN(from) || isNaN(to) || from >= to) throw new HttpError(400, 'Choose a valid period: "from" must be before "to"')
  if (to - from > MAX_RANGE_DAYS * 86_400_000) throw new HttpError(400, `The period can be at most ${MAX_RANGE_DAYS} days`)
  const tz = typeof req.query.tz === 'string' ? req.query.tz : 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
  } catch {
    throw new HttpError(400, 'Unknown time zone')
  }
  res.json(await deviceSeries(device, from, to, tz))
})

export default router
