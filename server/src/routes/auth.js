import bcrypt from 'bcryptjs'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { permissionsFor } from '../domain.js'
import { COOKIE, requireAuth } from '../middleware/auth.js'
import { User } from '../models/User.js'
import { HttpError } from '../util.js'

const router = Router()
const SESSION_HOURS = 8
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10)
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.secureCookies }
const publicUser = u => ({ id: u._id, name: u.name, email: u.email, role: u.role, permissions: permissionsFor(u.role) })

// shortcut: no login rate limiting; add express-rate-limit (or lockout after N failures) before exposing beyond a LAN.
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Email and password are required')
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash')
  // Always run bcrypt so response time doesn't reveal whether the email exists.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok || !user.active) throw new HttpError(401, 'Wrong email or password')

  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: `${SESSION_HOURS}h` })
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_HOURS * 3_600_000 })
  res.json(publicUser(user))
})

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, cookieOptions)
  res.status(204).end()
})

router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)))

export default router
