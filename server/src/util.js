export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Copy only the listed keys that are present, so request bodies can't set fields they shouldn't.
export const pick = (obj, keys) =>
  Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]]))

// Ids taken from request bodies must be plain id strings; this blocks {"$ne": null}-style query injection.
export function oid(value, label = 'id') {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new HttpError(400, `Invalid ${label}`)
  return value
}

export async function findOr404(Model, id) {
  const doc = await Model.findById(id)
  if (!doc) throw new HttpError(404, `${Model.modelName} not found`)
  return doc
}

export const round = (v, dp = 2) => (v == null ? v : Math.round(v * 10 ** dp) / 10 ** dp)
