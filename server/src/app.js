import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import { config } from './config.js'
import * as domain from './domain.js'
import { requireAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/errors.js'
import authRoutes from './routes/auth.js'
import crewRoutes from './routes/crew.js'
import deviceRoutes from './routes/devices.js'
import ingestRoutes from './routes/ingest.js'
import plantRoutes from './routes/plants.js'
import ticketRoutes from './routes/tickets.js'
import { dashboard } from './services/overview.js'

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '5mb' }))
app.use(cookieParser())

app.use('/api/auth', authRoutes)
app.use('/api/ingest', ingestRoutes)

app.use('/api', requireAuth) // everything below needs a signed-in user
app.get('/api/meta', (req, res) => res.json({ ...domain, staleAfterMin: config.staleAfterMin })) // functions are dropped by JSON
app.get('/api/dashboard', async (req, res) => res.json(await dashboard()))
app.use('/api/plants', plantRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/crew', crewRoutes)
app.use('/api/tickets', ticketRoutes)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

// Serve the built React app (npm start) from the same origin as the API.
const dist = fileURLToPath(new URL('../../client/dist', import.meta.url))
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }))
}

app.use(errorHandler)
