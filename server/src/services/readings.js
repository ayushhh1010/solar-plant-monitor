import mongoose from 'mongoose'
import { config } from '../config.js'
import { METRICS } from '../domain.js'
import { Device } from '../models/Device.js'
import { Reading } from '../models/Reading.js'
import { HttpError, round } from '../util.js'

const MAX_CLOCK_SKEW_MS = 5 * 60_000
const DAY = 86_400_000

const staleCutoff = (now = Date.now()) => new Date(now - config.staleAfterMin * 60_000)

// An active device is "stale" when it has not reported for longer than the acceptable gap.
export const isStale = (device, now = Date.now()) =>
  device.status === 'active' && (!device.lastReadingAt || device.lastReadingAt < staleCutoff(now))

// Validates and stores a batch of readings: [{ deviceId, ts, values: { metricKey: number } }].
// Used by the ingest API (data loggers), the simulator and the seed, so all data passes the same checks.
export async function ingestReadings(input) {
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, 'Expected a non-empty array of readings')
  const ids = [...new Set(input.map(r => String(r?.deviceId)))].filter(id => mongoose.isValidObjectId(id))
  const devices = new Map((await Device.find({ _id: { $in: ids } }, 'type status').lean()).map(d => [String(d._id), d]))
  const now = Date.now()

  const docs = input.map((r, i) => {
    const fail = msg => { throw new HttpError(400, `Reading ${i}: ${msg}`) }
    const device = devices.get(String(r?.deviceId))
    if (!device) fail('unknown deviceId')
    if (device.status === 'retired') fail('device is retired')
    const ts = new Date(r.ts ?? now)
    if (isNaN(ts) || ts > now + MAX_CLOCK_SKEW_MS) fail('ts must be a valid time that is not in the future')
    const allowed = METRICS[device.type].map(m => m.key)
    const entries = Object.entries(r.values ?? {})
    if (!entries.length) fail('values is empty')
    for (const [key, value] of entries) {
      if (!allowed.includes(key)) fail(`"${key}" is not measured by a ${device.type}`)
      if (!Number.isFinite(value)) fail(`"${key}" must be a number`)
    }
    return { ts, device: device._id, values: Object.fromEntries(entries) }
  })

  await Reading.collection.insertMany(docs, { ordered: false }) // already validated above

  // Keep a "latest reading" snapshot on each device; ignore late, out-of-order samples.
  const latest = new Map()
  for (const d of docs) {
    const key = String(d.device)
    if (!latest.has(key) || latest.get(key).ts < d.ts) latest.set(key, d)
  }
  await Device.bulkWrite([...latest.values()].map(d => ({
    updateOne: {
      filter: { _id: d.device, $or: [{ lastReadingAt: null }, { lastReadingAt: { $lt: d.ts } }] },
      update: { $set: { lastReadingAt: d.ts, lastReading: d.values } },
    },
  })))
  return { accepted: docs.length }
}

// Bucket size keeps any chosen period to a few hundred points.
function bucketFor(spanMs) {
  if (spanMs <= DAY / 4) return { unit: 'minute', binSize: 5 }
  if (spanMs <= 2 * DAY) return { unit: 'minute', binSize: 15 }
  if (spanMs <= 8 * DAY) return { unit: 'hour', binSize: 1 }
  if (spanMs <= 32 * DAY) return { unit: 'hour', binSize: 6 }
  return { unit: 'day', binSize: 1 }
}

export const MAX_RANGE_DAYS = 92

// History for one device over [from, to]: gauges averaged per bucket, counters turned into energy per bucket.
export async function deviceSeries(device, from, to, timezone) {
  const metrics = METRICS[device.type]
  const bucket = bucketFor(to - from)
  const match = { $match: { device: device._id, ts: { $gte: from, $lte: to } } }
  const perBucket = { _id: { $dateTrunc: { date: '$ts', ...bucket, timezone } } }
  const overall = { _id: null, count: { $sum: 1 } }
  for (const { key, counter } of metrics) {
    const field = `$values.${key}`
    perBucket[key] = counter ? { $max: field } : { $avg: field }
    Object.assign(overall, { [`${key}_min`]: { $min: field }, [`${key}_max`]: { $max: field }, [`${key}_avg`]: { $avg: field } })
  }
  const [buckets, [totals] = []] = await Promise.all([
    Reading.aggregate([match, { $group: perBucket }, { $sort: { _id: 1 } }]),
    Reading.aggregate([match, { $group: overall }]),
  ])

  const points = buckets.map((b, i) => {
    const point = { t: b._id }
    for (const { key, counter } of metrics) {
      if (!counter) point[key] = round(b[key], 3)
      // shortcut: energy per bucket = rise of the cumulative register; assumes registers never reset.
      else point[key] = i > 0 && b[key] != null && buckets[i - 1][key] != null ? round(b[key] - buckets[i - 1][key]) : null
    }
    return point
  })
  const summary = Object.fromEntries(metrics.map(({ key, counter }) => [key, counter
    ? { total: totals?.[`${key}_max`] != null ? round(totals[`${key}_max`] - totals[`${key}_min`]) : null }
    : { avg: round(totals?.[`${key}_avg`], 3), min: round(totals?.[`${key}_min`], 3), max: round(totals?.[`${key}_max`], 3) }]))
  return { bucket, count: totals?.count ?? 0, points, summary }
}
