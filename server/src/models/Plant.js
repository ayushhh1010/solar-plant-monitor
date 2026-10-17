import mongoose from 'mongoose'
import { PLANT_STATUSES } from '../domain.js'

const plantSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, match: [/^[A-Z0-9-]{3,20}$/, 'Code must be 3-20 letters, digits or dashes'] },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 200 },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    capacityKwp: { type: Number, required: true, min: [1, 'Capacity must be at least 1 kWp'], max: 5_000_000 },
    commissionedOn: Date,
    status: { type: String, enum: PLANT_STATUSES, default: 'commissioning' },
    statusSince: Date,
    decommissionedAt: Date,
  },
  { timestamps: true },
)
// Remember when the operating condition last changed, so the UI can say "offline for 5 h".
plantSchema.pre('save', function () {
  if (this.isNew ? !this.statusSince : this.isModified('status')) this.statusSince = new Date()
})
// Plant names are unique regardless of case ("Kamuthi Plains" == "kamuthi plains").
plantSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })
plantSchema.index({ latitude: 1, longitude: 1 })

export const Plant = mongoose.model('Plant', plantSchema)
