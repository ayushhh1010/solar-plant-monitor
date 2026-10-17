// There is no real hardware: this generates plausible meter/inverter data and feeds it through the
// same ingest path a field data logger would use (POST /api/ingest/readings).
import { config } from '../config.js'
import { LIVE_PLANT_STATUSES } from '../domain.js'
import { Device } from '../models/Device.js'
import { Plant } from '../models/Plant.js'
import { round } from '../util.js'
import { ingestReadings } from './readings.js'

const jitter = (value, pct) => value * (1 + (Math.random() * 2 - 1) * pct)

// 0 at night, 1 at local solar noon; local solar time comes from the plant's longitude.
function sunFactor(at, longitude) {
  const hour = (at.getUTCHours() + at.getUTCMinutes() / 60 + longitude / 15 + 24) % 24
  return Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12))
}

// One sample for every given device of a plant at time `at`.
// `prev` maps device id → last values, so the cumulative energy registers keep counting up.
export function simulatePlant(plant, devices, at, intervalSec, prev) {
  const sun = sunFactor(at, plant.longitude) * (0.8 + 0.2 * Math.random()) // passing clouds
  const hours = intervalSec / 3600
  const readings = []
  let plantAcKw = 0

  for (const d of devices.filter(d => d.type === 'inverter')) {
    const last = prev[d._id] ?? {}
    const ac = d.status === 'active' ? round(d.ratedPowerKw * sun * jitter(0.96, 0.02)) : 0
    const efficiency = 96 + 2.5 * Math.random()
    plantAcKw += ac
    readings.push({
      deviceId: d._id, ts: at, values: {
        acPowerKw: ac,
        dcPowerKw: ac > 0 ? round(ac / (efficiency / 100)) : 0,
        totalYieldKwh: round((last.totalYieldKwh ?? 0) + ac * hours),
        ...(ac > 0 && { efficiencyPct: round(efficiency) }), // undefined at night
        dcVoltageV: ac > 0 ? round(jitter(620 + 180 * sun, 0.01)) : 0,
        temperatureC: round(24 + 22 * sun + 2 * Math.random()),
      },
    })
  }

  const auxKw = plant.capacityKwp * 0.004 // trackers, SCADA, lighting
  for (const d of devices.filter(d => d.type === 'meter')) {
    const last = prev[d._id] ?? {}
    // Import meters sit on the auxiliary supply; export/bidirectional meters see the plant's net flow (negative = importing).
    const net = round(d.meterKind === 'import' ? -auxKw : plantAcKw * 0.985 - auxKw)
    const voltage = jitter(415, 0.015)
    const pf = Math.min(net > 0 ? jitter(0.985, 0.01) : jitter(0.9, 0.03), 1)
    readings.push({
      deviceId: d._id, ts: at, values: {
        activePowerKw: net,
        exportKwh: round((last.exportKwh ?? 0) + Math.max(net, 0) * hours),
        importKwh: round((last.importKwh ?? 0) + Math.max(-net, 0) * hours),
        voltageV: round(voltage),
        currentA: round((Math.abs(net) * 1000) / (Math.sqrt(3) * voltage * pf)),
        powerFactor: round(pf, 3),
        frequencyHz: round(jitter(50, 0.002)),
      },
    })
  }
  return readings
}

async function tick() {
  // Offline/decommissioned plants and "silent" devices send nothing, which is what makes them show up as stale.
  const plants = await Plant.find({ status: { $in: LIVE_PLANT_STATUSES } }).lean()
  const devices = await Device.find({
    plant: { $in: plants.map(p => p._id) },
    status: { $ne: 'retired' },
    serialNumber: { $nin: config.silentSerials },
  }).lean()
  const prev = Object.fromEntries(devices.map(d => [d._id, d.lastReading ?? {}]))
  const at = new Date()
  const readings = plants.flatMap(p => simulatePlant(p, devices.filter(d => d.plant.equals(p._id)), at, config.simIntervalSec, prev))
  if (readings.length) await ingestReadings(readings)
}

export function startSimulator() {
  const run = () => tick().catch(err => console.error('[simulator]', err.message))
  run()
  console.log(`Simulator: new readings every ${config.simIntervalSec}s`)
  return setInterval(run, config.simIntervalSec * 1000)
}
