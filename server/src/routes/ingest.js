import { Router } from 'express'
import { requireApiKey } from '../middleware/auth.js'
import { ingestReadings } from '../services/readings.js'
import { HttpError } from '../util.js'

const router = Router()
const MAX_BATCH = 5000

// How field data loggers / SCADA gateways push readings: POST an array of { deviceId, ts, values }.
router.post('/readings', requireApiKey, async (req, res) => {
  if (Array.isArray(req.body) && req.body.length > MAX_BATCH) throw new HttpError(413, `Send at most ${MAX_BATCH} readings per request`)
  res.status(202).json(await ingestReadings(req.body))
})

export default router
