import mongoose from 'mongoose'
import { CREW_SKILLS, CREW_STATUSES } from '../domain.js'

const crewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, match: [/^\+?[0-9 -]{7,20}$/, 'Invalid phone number'] },
    email: { type: String, trim: true, lowercase: true },
    skills: [{ type: String, enum: CREW_SKILLS }],
    plants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true }],
    status: { type: String, enum: CREW_STATUSES, default: 'active' },
  },
  { timestamps: true },
)

export const Crew = mongoose.model('Crew', crewSchema)
