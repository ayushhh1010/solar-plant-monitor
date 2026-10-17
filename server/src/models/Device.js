import mongoose from 'mongoose'
import { ACCURACY_CLASSES, DEVICE_STATUSES, METER_KINDS } from '../domain.js'

const { ObjectId } = mongoose.Schema.Types

// Fields common to every device; type-specific fields live in the discriminators below.
const deviceSchema = new mongoose.Schema(
  {
    plant: { type: ObjectId, ref: 'Plant', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    serialNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    manufacturer: { type: String, required: true, trim: true, maxlength: 60 },
    model: { type: String, trim: true, maxlength: 60 },
    installedOn: Date,
    status: { type: String, enum: DEVICE_STATUSES, default: 'active' },
    lastReadingAt: Date,
    lastReading: { type: Object }, // latest values, so "right now" never scans the time series
    moves: [{ _id: false, from: { type: ObjectId, ref: 'Plant' }, to: { type: ObjectId, ref: 'Plant' }, at: Date, by: { type: ObjectId, ref: 'User' } }],
  },
  { timestamps: true, discriminatorKey: 'type' },
)
// One physical device = one manufacturer + serial number, case-insensitive, across all plants (incl. retired).
deviceSchema.index({ manufacturer: 1, serialNumber: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Device = mongoose.model('Device', deviceSchema)

export const Meter = Device.discriminator('meter', new mongoose.Schema({
  meterKind: { type: String, enum: METER_KINDS, required: true },
  accuracyClass: { type: String, enum: ACCURACY_CLASSES },
}))

export const Inverter = Device.discriminator('inverter', new mongoose.Schema({
  ratedPowerKw: { type: Number, required: true, min: 0.1, max: 10_000 },
  mpptCount: { type: Number, min: 1, max: 32 },
}))
