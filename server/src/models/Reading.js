import mongoose from 'mongoose'

// MongoDB time-series collection: one document per device per sample, `values` keyed by METRICS[type].
const readingSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true },
    device: { type: mongoose.Schema.Types.ObjectId, required: true },
    values: { type: Object, required: true },
  },
  {
    timeseries: { timeField: 'ts', metaField: 'device', granularity: 'minutes' },
    expireAfterSeconds: 60 * 60 * 24 * 90,
    versionKey: false,
  },
)

export const Reading = mongoose.model('Reading', readingSchema)
