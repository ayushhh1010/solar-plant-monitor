import mongoose from 'mongoose'
import { HttpError } from '../util.js'

const DUPLICATE = {
  code: 'A plant with this code already exists',
  name: 'A plant with this name already exists',
  serialNumber: 'This device (same manufacturer and serial number) is already registered',
  email: 'This email is already in use',
}

export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof mongoose.Error.ValidationError) {
    const label = path => path.replace(/([A-Z])/g, ' $1').toLowerCase() // capacityKwp → "capacity kwp"
    const message = e => (e.kind === 'required' ? `${label(e.path)} is required` : e.kind === 'enum' ? `${label(e.path)} has an invalid value` : e.message)
    return res.status(400).json({ error: Object.values(err.errors).map(message).join('. ') })
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: `Invalid ${err.path}` })
  if (err?.code === 11000) {
    const key = Object.keys(err.keyPattern ?? {}).find(k => DUPLICATE[k])
    return res.status(409).json({ error: DUPLICATE[key] ?? 'This record already exists' })
  }
  if (err?.expose && err.status < 500) return res.status(err.status).json({ error: err.message }) // e.g. malformed JSON
  console.error(err)
  res.status(500).json({ error: 'Something went wrong' })
}
