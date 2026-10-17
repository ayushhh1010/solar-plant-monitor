try { process.loadEnvFile() } catch { /* .env is optional */ }

const env = process.env

if (env.NODE_ENV === 'production' && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production')

export const config = {
  port: Number(env.PORT) || 4000,
  mongoUri: env.MONGO_URI, // unset → embedded MongoDB (see db.js)
  jwtSecret: env.JWT_SECRET || 'dev-only-secret',
  ingestApiKey: env.INGEST_API_KEY || 'dev-ingest-key',
  simulator: env.SIMULATOR !== 'off',
  simIntervalSec: Number(env.SIM_INTERVAL_SEC) || 60,
  staleAfterMin: Number(env.STALE_AFTER_MIN) || 15,
  // Devices the simulator treats as having lost communication, to demo stale-device detection.
  silentSerials: (env.SIM_SILENT_SERIALS ?? 'SG-INV-2203').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  secureCookies: env.NODE_ENV === 'production',
}
