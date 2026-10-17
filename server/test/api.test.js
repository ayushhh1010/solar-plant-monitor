// End-to-end checks of the business rules against a throwaway in-memory MongoDB loaded with the demo seed.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app } from '../src/app.js'
import { connectDb, disconnectDb } from '../src/db.js'
import { DEMO_PASSWORD, seed } from '../src/seed.js'

let mongo, server, base

before(async () => {
  mongo = await MongoMemoryServer.create()
  await connectDb(mongo.getUri('test'))
  await seed()
  await new Promise(resolve => { server = app.listen(0, resolve) })
  base = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  server.close()
  await disconnectDb()
  await mongo.stop()
})

async function login(role) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${role}@solarops.test`, password: DEMO_PASSWORD }) })
  assert.equal(res.status, 200)
  const cookie = res.headers.get('set-cookie').split(';')[0]
  return async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    return { status: r.status, body: r.status === 204 ? null : await r.json() }
  }
}

const findPlant = async (as, code) => (await as('GET', '/plants')).body.find(p => p.code === code)
const findDevice = async (as, serial) => (await as('GET', '/devices')).body.find(d => d.serialNumber === serial)

test('only signed-in users get in', async () => {
  assert.equal((await fetch(`${base}/plants`)).status, 401)
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@solarops.test', password: 'wrong' }) })
  assert.equal(bad.status, 401)
})

test('roles are enforced by the API', async () => {
  const viewer = await login('viewer')
  const operator = await login('operator')
  const plant = { code: 'XX-NEW-01', name: 'Nope', state: 'Goa', latitude: 15.3, longitude: 74.1, capacityKwp: 100 }
  assert.equal((await viewer('POST', '/plants', plant)).status, 403)
  assert.equal((await operator('POST', '/plants', plant)).status, 403)
  const jodhpur = await findPlant(viewer, 'RJ-JOD-01')
  assert.equal((await viewer('POST', '/tickets', { plant: jodhpur._id, category: 'other', priority: 'low', title: 'x', description: 'y' })).status, 403)
  const me = (await operator('GET', '/auth/me')).body
  assert.ok(me.permissions.includes('ticket:create') && !me.permissions.includes('ticket:triage'))
})

test('the same plant cannot be registered twice', async () => {
  const admin = await login('admin')
  const plant = { code: 'UP-AGR-06', name: 'Agra Fields', state: 'Uttar Pradesh', latitude: 27.1767, longitude: 78.0081, capacityKwp: 1200 }
  const created = await admin('POST', '/plants', plant)
  assert.equal(created.status, 201)
  assert.equal(created.body.code, 'UP-AGR-06')
  assert.ok(created.body.statusSince, 'status change time recorded')
  assert.equal((await admin('POST', '/plants', { ...plant, code: 'up-agr-06', name: 'Other name', latitude: 20 })).status, 409, 'same code, other case')
  assert.equal((await admin('POST', '/plants', { ...plant, code: 'UP-AGR-07', name: 'agra FIELDS', latitude: 20 })).status, 409, 'same name, other case')
  const near = await admin('POST', '/plants', { ...plant, code: 'UP-AGR-08', name: 'Agra Fields II', latitude: 27.1772 })
  assert.equal(near.status, 409, 'same site')
  assert.match(near.body.error, /same plant/)
})

test('devices need a plant and a physical device is registered once', async () => {
  const admin = await login('admin')
  const plant = await findPlant(admin, 'RJ-JOD-01')
  const inverter = { type: 'inverter', name: 'INV-09', serialNumber: 'abc-123', manufacturer: 'Sungrow', ratedPowerKw: 100 }
  assert.equal((await admin('POST', '/devices', inverter)).status, 400, 'no plant')
  assert.equal((await admin('POST', '/devices', { ...inverter, plant: { $ne: null } })).status, 400, 'operator injection')
  assert.equal((await admin('POST', '/devices', { ...inverter, plant: plant._id })).status, 201)
  assert.equal((await admin('POST', '/devices', { ...inverter, plant: plant._id, serialNumber: ' ABC-123', manufacturer: 'SUNGROW' })).status, 409)
  assert.equal((await admin('POST', '/devices', { ...inverter, plant: plant._id, serialNumber: 'ABC-123', manufacturer: 'SMA' })).status, 201, 'other maker may reuse a serial')
  assert.equal((await admin('POST', '/devices', { type: 'meter', name: 'M', serialNumber: 'M-1', manufacturer: 'Secure', plant: plant._id })).status, 400, 'meter needs meterKind')
})

test('ticket lifecycle cannot skip or reverse steps and keeps an audit trail', async () => {
  const operator = await login('operator')
  const manager = await login('manager')
  const plant = await findPlant(manager, 'GJ-CHA-02')
  const report = { plant: plant._id, category: 'physical_damage', priority: 'medium', title: 'Broken module', description: 'Row 4 module cracked' }
  const created = await operator('POST', '/tickets', report)
  assert.equal(created.status, 201)
  assert.equal((await operator('POST', '/tickets', report)).status, 409, 'duplicate open report')
  const id = created.body._id
  const move = (as, to, note) => as('POST', `/tickets/${id}/transition`, { to, note })

  assert.equal((await move(operator, 'in_progress')).status, 409, 'cannot start before assignment')
  assert.equal((await move(manager, 'closed')).status, 409, 'cannot close an open ticket')

  const crew = (await manager('GET', `/crew?plant=${plant._id}&available=true`)).body
  const outsider = (await manager('GET', '/crew?status=active')).body.find(c => !c.plants.some(p => p._id === plant._id))
  assert.equal((await operator('POST', `/tickets/${id}/assign`, { crewIds: [crew[0]._id] })).status, 403)
  assert.equal((await manager('POST', `/tickets/${id}/assign`, { crewIds: [outsider._id] })).status, 400, 'crew not at this plant')
  assert.equal((await manager('POST', `/tickets/${id}/assign`, { crewIds: [crew[0]._id] })).body.status, 'assigned')

  assert.equal((await move(operator, 'in_progress')).body.status, 'in_progress')
  assert.equal((await move(operator, 'resolved')).status, 400, 'resolution note required')
  assert.equal((await move(operator, 'resolved', 'Module replaced')).body.status, 'resolved')
  assert.equal((await move(operator, 'closed')).status, 403, 'operators cannot verify their own fix')
  assert.equal((await move(manager, 'closed')).body.status, 'closed')
  assert.equal((await move(manager, 'in_progress', 'again')).status, 409, 'closed is final')

  const { body } = await manager('GET', `/tickets/${id}`)
  assert.deepEqual(body.history.filter(h => h.action === 'status').map(h => h.to), ['assigned', 'in_progress', 'resolved', 'closed'])
  assert.ok(body.history.every(h => h.by.name && h.at))
})

test('a plant with open tickets cannot be decommissioned; otherwise devices retire and crew is released', async () => {
  const admin = await login('admin')
  const kamuthi = await findPlant(admin, 'TN-KAM-04')
  const blocked = await admin('POST', `/plants/${kamuthi._id}/decommission`)
  assert.equal(blocked.status, 409)
  assert.match(blocked.body.error, /TKT-/)

  const plant = (await admin('POST', '/plants', { code: 'GA-OLD-09', name: 'Old Pilot', state: 'Goa', latitude: 15.49, longitude: 73.82, capacityKwp: 50 })).body
  const device = (await admin('POST', '/devices', { type: 'meter', name: 'M1', serialNumber: 'OLD-1', manufacturer: 'Secure', meterKind: 'export', plant: plant._id })).body
  const member = (await admin('POST', '/crew', { name: 'Test Tech', phone: '+91 90000 00000', skills: ['civil'], plants: [plant._id] })).body
  const done = await admin('POST', `/plants/${plant._id}/decommission`)
  assert.equal(done.status, 200)
  assert.equal((await admin('GET', `/devices/${device._id}`)).body.status, 'retired')
  assert.equal((await admin('GET', '/crew')).body.find(c => c._id === member._id).plants.length, 0)
  assert.equal((await admin('POST', '/tickets', { plant: plant._id, category: 'other', priority: 'low', title: 't', description: 'd' })).status, 409)
})

test('crew cannot leave or drop a plant while holding unfinished tickets', async () => {
  const manager = await login('manager')
  const crew = (await manager('GET', '/crew')).body
  const kavya = crew.find(c => c.name === 'Kavya Gowda')
  assert.equal((await manager('PATCH', `/crew/${kavya._id}`, { status: 'inactive' })).status, 409)
  assert.equal((await manager('PATCH', `/crew/${kavya._id}`, { plants: [kavya.plants[0]._id] })).status, 409)
  const deepak = crew.find(c => c.name === 'Deepak Jadhav')
  assert.equal((await manager('PATCH', `/crew/${deepak._id}`, { status: 'on_leave' })).status, 200)
})

test('moving a device is blocked by its open tickets and is recorded', async () => {
  const admin = await login('admin')
  const charanka = await findPlant(admin, 'GJ-CHA-02')
  const busy = await findDevice(admin, 'SG-INV-1102') // has an open ticket
  assert.equal((await admin('POST', `/devices/${busy._id}/move`, { plant: charanka._id })).status, 409)
  const free = await findDevice(admin, 'SG-INV-1103')
  assert.equal((await admin('POST', `/devices/${free._id}/move`, { plant: charanka._id })).status, 200)
  const moved = (await admin('GET', `/devices/${free._id}`)).body
  assert.equal(moved.plant.code, 'GJ-CHA-02')
  assert.equal(moved.moves[0].from.code, 'RJ-JOD-01')
})

test('ingest validates readings per device type; a silent device is stale until it reports', async () => {
  const admin = await login('admin')
  const silent = await findDevice(admin, 'SG-INV-2203')
  assert.equal(silent.stale, true)
  const post = (body, key = 'dev-ingest-key') => fetch(`${base}/ingest/readings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) })
  assert.equal((await post([{ deviceId: silent._id, values: { acPowerKw: 1 } }], 'wrong')).status, 401)
  assert.equal((await post([{ deviceId: silent._id, values: { exportKwh: 5 } }])).status, 400, 'meter metric on an inverter')
  assert.equal((await post([{ deviceId: silent._id, values: { acPowerKw: 'high' } }])).status, 400)
  assert.equal((await post([{ deviceId: silent._id, ts: new Date(Date.now() + 3_600_000), values: { acPowerKw: 1 } }])).status, 400, 'future')
  assert.equal((await post([{ deviceId: silent._id, values: { acPowerKw: 500 } }])).status, 202)
  const now = (await admin('GET', `/devices/${silent._id}`)).body
  assert.equal(now.stale, false)
  assert.equal(now.lastReading.acPowerKw, 500)
})

test('history is bucketed per period and summarised per metric', async () => {
  const viewer = await login('viewer')
  const meter = await findDevice(viewer, 'SM-44-0101')
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { status, body } = await viewer('GET', `/devices/${meter._id}/readings?from=${from}&tz=Asia/Kolkata`)
  assert.equal(status, 200)
  assert.equal(body.bucket.unit, 'hour')
  assert.ok(body.points.length > 150)
  assert.ok(body.summary.exportKwh.total > 0)
  assert.equal(body.points[0].exportKwh, null, 'no delta for the first bucket')
  assert.equal((await viewer('GET', `/devices/${meter._id}/readings?from=2020-01-01`)).status, 400, 'period too long')
})

test('dashboard surfaces what needs attention, worst first', async () => {
  const viewer = await login('viewer')
  const { body } = await viewer('GET', '/dashboard')
  assert.equal(body.attention[0].severity, 'critical')
  assert.ok(body.attention.some(a => a.title === 'Kamuthi Plains is offline'))
  assert.ok(body.attention.some(a => a.title.includes('INV-02 IGBT') && a.detail.includes('past 24h target')))
  assert.ok(body.kpis.staleDevices >= 3)
  assert.ok(body.insights.ticketsByPlant[0].total >= body.insights.ticketsByPlant.at(-1).total)
})
