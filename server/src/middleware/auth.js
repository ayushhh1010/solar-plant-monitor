import { timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { can } from '../domain.js'
import { User } from '../models/User.js'
import { HttpError } from '../util.js'

export const COOKIE = 'token'

// Session = signed JWT in an httpOnly, SameSite=Strict cookie (not readable by page scripts, not sent cross-site).
export async function requireAuth(req, res, next) {
  let payload
  try {
    payload = jwt.verify(req.cookies?.[COOKIE] ?? '', config.jwtSecret)
  } catch {
    throw new HttpError(401, 'Please sign in')
  }
  // Re-read the user so deactivation or a role change applies immediately, not when the token expires.
  const user = await User.findById(payload.sub).lean()
  if (!user?.active) throw new HttpError(401, 'Please sign in')
  req.user = user
  next()
}

export const requirePermission = permission => (req, res, next) => {
  if (!can(req.user.role, permission)) throw new HttpError(403, 'Your role is not allowed to do this')
  next()
}

// Machine-to-machine auth for data loggers pushing readings.
export function requireApiKey(req, res, next) {
  const given = Buffer.from(req.get('x-api-key') ?? '')
  const expected = Buffer.from(config.ingestApiKey)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Invalid API key')
  next()
}
