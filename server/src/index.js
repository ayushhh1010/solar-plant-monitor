import { app } from './app.js'
import { config } from './config.js'
import { connectDb, disconnectDb } from './db.js'
import { User } from './models/User.js'
import { seed } from './seed.js'
import { startSimulator } from './services/simulator.js'

await connectDb()
if (!(await User.countDocuments())) {
  console.log('Empty database, loading demo data…')
  await seed()
}
if (config.simulator) startSimulator()

const server = app.listen(config.port, () => console.log(`API ready on http://localhost:${config.port}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close()
    await disconnectDb()
    process.exit(0)
  })
}
