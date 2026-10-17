import mongoose from 'mongoose'
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../domain.js'

const { ObjectId } = mongoose.Schema.Types

// Append-only audit trail entry. `from`/`to` hold human-readable values (status, priority, crew names).
const historySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['created', 'status', 'assigned', 'priority', 'comment'], required: true },
    from: String,
    to: String,
    note: String,
  },
  { _id: false },
)

const ticketSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    plant: { type: ObjectId, ref: 'Plant', required: true, index: true },
    device: { type: ObjectId, ref: 'Device', index: true },
    category: { type: String, enum: TICKET_CATEGORIES, required: true },
    priority: { type: String, enum: TICKET_PRIORITIES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    assignees: [{ type: ObjectId, ref: 'Crew', index: true }],
    reportedBy: { type: ObjectId, ref: 'User', required: true },
    resolution: String,
    openedAt: { type: Date, required: true },
    resolvedAt: Date,
    closedAt: Date,
    history: [historySchema],
  },
  { timestamps: true },
)

export const Ticket = mongoose.model('Ticket', ticketSchema)

const Counter = mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: Number }, { versionKey: false }))

export async function nextTicketNumber() {
  const { seq } = await Counter.findByIdAndUpdate('ticket', { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  return `TKT-${1000 + seq}`
}
