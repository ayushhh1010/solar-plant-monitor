import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { config } from './config.js'

let embedded

export async function connectDb(uri = config.mongoUri) {
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    const dbPath = fileURLToPath(new URL('../data/db', import.meta.url))
    mkdirSync(dbPath, { recursive: true })
    try {
      embedded = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } })
    } catch (err) {
      throw new Error(`Could not start embedded MongoDB at ${dbPath} (is another server process using it?): ${err.message}`)
    }
    uri = embedded.getUri('solar_ops')
  }
  await mongoose.connect(uri)
  // Make sure collections (incl. the time-series one) and unique indexes exist before any write.
  await Promise.all(Object.values(mongoose.models).map(m => m.init()))
}

export async function disconnectDb() {
  // The embedded mongod is killed rather than shut down (notably on Windows); flush first so recent writes survive.
  if (embedded) await mongoose.connection.db.admin().command({ fsync: 1 })
  await mongoose.disconnect()
  await embedded?.stop({ doCleanup: false }) // keep the persisted data folder
}
