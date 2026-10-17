// Demo data. Runs automatically on an empty database; `npm run seed` wipes and reloads it.
// Tickets are created through the real workflow service (with past timestamps), so the seed obeys the same rules as users.
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { config } from './config.js'
import { connectDb, disconnectDb } from './db.js'
import { Crew } from './models/Crew.js'
import { Device, Inverter, Meter } from './models/Device.js'
import { Plant } from './models/Plant.js'
import { Reading } from './models/Reading.js'
import { Ticket } from './models/Ticket.js'
import { User } from './models/User.js'
import { ingestReadings } from './services/readings.js'
import { simulatePlant } from './services/simulator.js'
import { assignTicket, createTicket, transitionTicket, addComment } from './services/tickets.js'

export const DEMO_PASSWORD = 'Solar@123'
const HOUR = 3_600_000
const DAY = 24 * HOUR

const USERS = [
  { key: 'admin', name: 'Asha Verma', email: 'admin@solarops.test', role: 'admin' },
  { key: 'manager', name: 'Rohan Mehta', email: 'manager@solarops.test', role: 'manager' },
  { key: 'operator', name: 'Priya Nair', email: 'operator@solarops.test', role: 'operator' },
  { key: 'operator2', name: 'Vikram Singh', email: 'operator2@solarops.test', role: 'operator' },
  { key: 'viewer', name: 'Neha Kapoor', email: 'viewer@solarops.test', role: 'viewer' },
]

const PLANTS = [
  { code: 'RJ-JOD-01', name: 'Jodhpur Sunfield', address: 'Bhadla Solar Park, Phalodi', state: 'Rajasthan', latitude: 27.5362, longitude: 71.9167, capacityKwp: 5000, commissionedOn: '2021-03-15', status: 'operational' },
  { code: 'GJ-CHA-02', name: 'Charanka Ridge', address: 'Charanka Solar Park, Patan', state: 'Gujarat', latitude: 23.9012, longitude: 71.1988, capacityKwp: 3000, commissionedOn: '2019-11-02', status: 'operational' },
  { code: 'KA-PAV-03', name: 'Pavagada East', address: 'Pavagada, Tumakuru', state: 'Karnataka', latitude: 14.1002, longitude: 77.2795, capacityKwp: 2000, commissionedOn: '2020-06-20', status: 'maintenance', statusHoursAgo: 49 },
  { code: 'TN-KAM-04', name: 'Kamuthi Plains', address: 'Kamuthi, Ramanathapuram', state: 'Tamil Nadu', latitude: 9.3470, longitude: 78.3830, capacityKwp: 1500, commissionedOn: '2017-09-21', status: 'offline', statusHoursAgo: 5 },
  { code: 'MH-SOL-05', name: 'Solapur Rooftop Cluster', address: 'MIDC Chincholi, Solapur', state: 'Maharashtra', latitude: 17.6599, longitude: 75.9064, capacityKwp: 800, status: 'commissioning', statusHoursAgo: 20 * 24 },
]

const inverter = (name, serialNumber, manufacturer, model, ratedPowerKw, extra) => ({ type: 'inverter', name, serialNumber, manufacturer, model, ratedPowerKw, mpptCount: 6, ...extra })
const meter = (name, serialNumber, meterKind, accuracyClass) => ({ type: 'meter', name, serialNumber, manufacturer: 'Secure Meters', model: 'Elite 440', meterKind, accuracyClass })

const DEVICES = {
  'RJ-JOD-01': [
    inverter('INV-01', 'SG-INV-1101', 'Sungrow', 'SG1250UD', 1250),
    inverter('INV-02', 'SG-INV-1102', 'Sungrow', 'SG1250UD', 1250),
    inverter('INV-03', 'SG-INV-1103', 'Sungrow', 'SG1250UD', 1250),
    inverter('INV-04', 'SG-INV-1104', 'Sungrow', 'SG1250UD', 1250),
    meter('MTR-01 Main export', 'SM-44-0101', 'export', '0.2S'),
    meter('MTR-02 Auxiliary', 'SM-44-0102', 'import', '0.5S'),
  ],
  'GJ-CHA-02': [
    inverter('INV-01', 'SG-INV-2201', 'Sungrow', 'SG1000HV', 1000),
    inverter('INV-02', 'SG-INV-2202', 'Sungrow', 'SG1000HV', 1000),
    inverter('INV-03', 'SG-INV-2203', 'Sungrow', 'SG1000HV', 1000), // lost communication (see SIM_SILENT_SERIALS)
    meter('MTR-01 Main export', 'SM-44-0201', 'export', '0.2S'),
  ],
  'KA-PAV-03': [
    inverter('INV-01', 'SMA-SC-3301', 'SMA', 'Sunny Central 1000', 1000),
    inverter('INV-02', 'SMA-SC-3302', 'SMA', 'Sunny Central 1000', 1000, { status: 'maintenance' }),
    meter('MTR-01 Net meter', 'SM-44-0301', 'bidirectional', '0.2S'),
  ],
  'TN-KAM-04': [
    inverter('INV-01', 'HW-SUN-4401', 'Huawei', 'SUN2000-330KTL', 750),
    inverter('INV-02', 'HW-SUN-4402', 'Huawei', 'SUN2000-330KTL', 750),
    meter('MTR-01 Main export', 'SM-44-0401', 'export', '0.2S'),
  ],
  'MH-SOL-05': [
    inverter('INV-01', 'HW-SUN-5501', 'Huawei', 'SUN2000-330KTL', 400),
    inverter('INV-02', 'HW-SUN-5502', 'Huawei', 'SUN2000-330KTL', 400),
    meter('MTR-01 Net meter', 'SM-44-0501', 'bidirectional', '0.5S'),
  ],
}

const CREW = [
  { name: 'Ravi Kumar', phone: '+91 98290 11001', skills: ['electrical'], plants: ['RJ-JOD-01'] },
  { name: 'Suresh Choudhary', phone: '+91 98290 11002', skills: ['electrical', 'mechanical'], plants: ['RJ-JOD-01', 'GJ-CHA-02'] },
  { name: 'Imran Shaikh', phone: '+91 98250 22003', skills: ['communications'], plants: ['RJ-JOD-01', 'GJ-CHA-02'] },
  { name: 'Meena Patel', phone: '+91 98250 22004', skills: ['electrical'], plants: ['GJ-CHA-02'] },
  { name: 'Arjun Reddy', phone: '+91 98450 33005', skills: ['mechanical', 'civil'], plants: ['KA-PAV-03'] },
  { name: 'Kavya Gowda', phone: '+91 98450 33006', skills: ['electrical', 'communications'], plants: ['KA-PAV-03', 'TN-KAM-04'] },
  { name: 'Senthil Murugan', phone: '+91 94430 44007', skills: ['electrical'], plants: ['TN-KAM-04'] },
  { name: 'Lakshmi Iyer', phone: '+91 94430 44008', skills: ['communications'], plants: ['TN-KAM-04'], status: 'on_leave' },
  { name: 'Deepak Jadhav', phone: '+91 98220 55009', skills: ['electrical', 'civil'], plants: ['MH-SOL-05'] },
  { name: 'Anil Sharma', phone: '+91 98290 11010', skills: ['mechanical'], plants: [], status: 'inactive' }, // has left
]

// [hours after opening, user, action, argument, note]; action is assign | comment | a target status.
const TICKETS = [
  { plant: 'RJ-JOD-01', category: 'communication_loss', priority: 'medium', daysAgo: 50, by: 'operator', title: 'Plant SCADA link down', description: 'No data from any device at Jodhpur since 06:10. Site reachable by phone, generation looks normal locally.',
    steps: [[1, 'manager', 'assign', ['Imran Shaikh']], [2, 'operator', 'in_progress'], [5, 'operator', 'resolved', 'Router at control room rebooted; ISP fibre cut repaired.'], [8, 'manager', 'closed']] },
  { plant: 'RJ-JOD-01', device: 'INV-01', category: 'device_fault', priority: 'high', daysAgo: 40, by: 'operator', title: 'INV-01 tripped on DC insulation fault', description: 'INV-01 showing fault code 039 (insulation resistance low) since morning, zero output.',
    steps: [[0.5, 'manager', 'assign', ['Ravi Kumar']], [1, 'operator', 'in_progress'], [6, 'operator', 'resolved', 'Water ingress in combiner box 14 dried and resealed; IR test passed.'], [20, 'manager', 'closed']] },
  { plant: 'RJ-JOD-01', device: 'MTR-01 Main export', category: 'communication_loss', priority: 'medium', daysAgo: 33, by: 'operator2', title: 'Export meter not polling', description: 'Main export meter missing from SCADA for 2 hours; billing data at risk.',
    steps: [[1, 'manager', 'assign', ['Imran Shaikh']], [3, 'operator', 'in_progress'], [9, 'operator', 'resolved', 'RS-485 converter reset; data backfilled from meter memory.'], [30, 'manager', 'closed']] },
  { plant: 'KA-PAV-03', device: 'INV-01', category: 'device_fault', priority: 'low', daysAgo: 30, by: 'operator', title: 'INV-01 cooling fan noisy', description: 'Loud bearing noise from INV-01 cabinet fan during afternoon inspection.',
    steps: [[4, 'manager', 'assign', ['Arjun Reddy']], [24, 'operator', 'in_progress'], [100, 'operator', 'resolved', 'Fan replaced with spare from store.'], [120, 'manager', 'closed']] },
  { plant: 'GJ-CHA-02', category: 'outage', priority: 'critical', daysAgo: 25, by: 'operator2', title: 'Grid outage - plant export zero', description: 'Export meter shows zero, all inverters in grid-fault. 66 kV line from substation tripped.',
    steps: [[0.2, 'manager', 'assign', ['Suresh Choudhary', 'Meena Patel']], [0.5, 'operator2', 'in_progress'], [3.5, 'operator2', 'resolved', 'DISCOM restored the feeder after breaker maintenance; all inverters back online.'], [6, 'manager', 'closed']] },
  { plant: 'TN-KAM-04', category: 'physical_damage', priority: 'high', daysAgo: 20, by: 'operator', title: 'Storm damage to module rows', description: 'Cyclone winds lifted two module rows in block B; several modules cracked.',
    steps: [[1, 'manager', 'assign', ['Senthil Murugan', 'Kavya Gowda']], [2, 'operator', 'in_progress'], [20, 'operator', 'resolved', '42 modules replaced, mounting structure re-torqued.'], [30, 'manager', 'closed']] },
  { plant: 'GJ-CHA-02', device: 'INV-01', category: 'physical_damage', priority: 'medium', daysAgo: 18, by: 'operator2', title: 'Cracked modules on INV-01 strings', description: 'Thermal scan shows hotspots on string 7 feeding INV-01.',
    steps: [[2, 'manager', 'assign', ['Meena Patel']], [5, 'operator2', 'in_progress'], [30, 'operator2', 'resolved', 'Six cracked modules replaced.'], [40, 'manager', 'in_progress', 'IR test on string 7 still failing.'], [52, 'operator2', 'resolved', 'Faulty MC4 connector replaced; IR test passed.'], [60, 'manager', 'closed']] },
  { plant: 'KA-PAV-03', category: 'communication_loss', priority: 'high', daysAgo: 12, by: 'operator', title: 'SCADA switch down', description: 'Whole plant offline on SCADA; local HMI working.',
    steps: [[1, 'manager', 'assign', ['Kavya Gowda']], [2, 'operator', 'in_progress'], [8, 'operator', 'resolved', 'Replaced failed power supply of the SCADA network switch.'], [12, 'manager', 'closed']] },
  { plant: 'TN-KAM-04', device: 'INV-01', category: 'device_fault', priority: 'medium', daysAgo: 9, by: 'operator', title: 'INV-01 derating on temperature', description: 'INV-01 limiting output to 70% every afternoon, temperature alarm.',
    steps: [[3, 'manager', 'assign', ['Senthil Murugan']], [6, 'operator', 'in_progress'], [50, 'operator', 'resolved', 'Clogged air filters cleaned and cooling fan replaced.'], [70, 'manager', 'closed']] },
  { plant: 'MH-SOL-05', category: 'other', priority: 'low', daysAgo: 5, by: 'operator2', title: 'Inverter room lighting not working', description: 'Two tube lights in inverter room not working.',
    steps: [[4, 'manager', 'cancelled', 'Raised with building maintenance; not a plant operations issue.']] },
  // Still open: these drive the dashboard.
  { plant: 'RJ-JOD-01', category: 'physical_damage', priority: 'low', hoursAgo: 80, by: 'operator2', title: 'Perimeter fence damaged near block C', description: 'About 6 m of fence down after a vehicle hit it; cattle could enter the array.',
    steps: [[3, 'manager', 'assign', ['Suresh Choudhary']], [10, 'operator', 'in_progress'], [26, 'operator', 'resolved', 'Fence section replaced and gate lock fixed.']] },
  { plant: 'KA-PAV-03', device: 'INV-02', category: 'device_fault', priority: 'high', hoursAgo: 50, by: 'operator', title: 'INV-02 IGBT module failure', description: 'INV-02 tripped with fault 1002 (IGBT overcurrent). Inverter isolated and set to maintenance.',
    steps: [[1, 'manager', 'assign', ['Kavya Gowda']], [4, 'operator', 'in_progress'], [20, 'operator', 'comment', 'Replacement IGBT module ordered from SMA, ETA 3 days.']] },
  { plant: 'RJ-JOD-01', device: 'INV-02', category: 'device_fault', priority: 'medium', hoursAgo: 30, by: 'operator', title: 'INV-02 output ~20% below peers', description: 'INV-02 consistently produces less than INV-01/03/04 at noon. Possible string fuse or soiling issue.',
    steps: [[2, 'manager', 'assign', ['Ravi Kumar']]] },
  { plant: 'MH-SOL-05', category: 'other', priority: 'low', hoursAgo: 12, by: 'manager', title: 'Commissioning: earthing test pending', description: 'Earth pit resistance test for the new array must be done before handover.', steps: [] },
  { plant: 'TN-KAM-04', category: 'outage', priority: 'critical', hoursAgo: 5, by: 'operator', title: 'Plant offline - no data and no export', description: 'All devices stopped reporting at once; DISCOM reports a 33 kV feeder trip in the area.',
    steps: [[0.3, 'manager', 'assign', ['Senthil Murugan', 'Kavya Gowda']], [1.5, 'operator', 'in_progress'], [2, 'operator', 'comment', 'Feeder trip confirmed by DISCOM; restoration expected this evening.']] },
  { plant: 'GJ-CHA-02', device: 'INV-03', category: 'communication_loss', priority: 'high', hoursAgo: 2.5, by: 'operator2', title: 'INV-03 stopped reporting', description: 'No data from INV-03 for 30 minutes while INV-01/02 report normally. Could be the inverter or its data logger.', steps: [] },
]

export async function seed() {
  const now = Date.now()
  await Promise.all([User, Plant, Device, Crew, Ticket].map(m => m.deleteMany({})))
  await mongoose.connection.collection('counters').deleteMany({})
  await Reading.collection.drop().catch(() => {})
  await Reading.createCollection()

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const users = Object.fromEntries((await User.create(USERS.map(u => ({ ...u, passwordHash })))).map((u, i) => [USERS[i].key, u]))
  const plantDocs = PLANTS.map(({ statusHoursAgo, ...p }) => ({ ...p, statusSince: statusHoursAgo ? new Date(now - statusHoursAgo * HOUR) : new Date(p.commissionedOn) }))
  const plants = Object.fromEntries((await Plant.create(plantDocs)).map(p => [p.code, p]))

  const devices = []
  for (const [code, list] of Object.entries(DEVICES)) {
    for (const { type, ...d } of list) devices.push(await (type === 'meter' ? Meter : Inverter).create({ ...d, plant: plants[code]._id, installedOn: plants[code].commissionedOn }))
  }
  const deviceAt = (code, name) => devices.find(d => d.name === name && d.plant.equals(plants[code]._id))
  const crew = await Crew.create(CREW.map(c => ({ ...c, plants: c.plants.map(code => plants[code]._id) })))
  const crewId = name => String(crew.find(c => c.name === name)._id)

  await seedReadings(Object.values(plants), devices, now)

  // Oldest first so ticket numbers follow time.
  const specs = TICKETS.map(t => ({ ...t, openedAt: now - (t.daysAgo ? t.daysAgo * DAY : t.hoursAgo * HOUR) })).sort((a, b) => a.openedAt - b.openedAt)
  for (const t of specs) {
    const device = t.device && deviceAt(t.plant, t.device)
    const body = { ...t, plant: String(plants[t.plant]._id), device: device && String(device._id), occurredAt: new Date(t.openedAt - 20 * 60_000) }
    let ticket = await createTicket(body, users[t.by], new Date(t.openedAt))
    for (const [h, by, action, arg] of t.steps) {
      const at = new Date(t.openedAt + h * HOUR)
      if (action === 'assign') ticket = await assignTicket(ticket.id, arg.map(crewId), users[by], at)
      else if (action === 'comment') ticket = await addComment(ticket.id, arg, users[by], at)
      else ticket = await transitionTicket(ticket.id, action, arg, users[by], at)
    }
  }
  console.log(`Seeded ${USERS.length} users, ${PLANTS.length} plants, ${devices.length} devices, ${crew.length} crew, ${TICKETS.length} tickets. Password for all users: ${DEMO_PASSWORD}`)
}

// Seven days of 15-minute history. Kamuthi went offline 5 h ago and the "silent" inverter 3 h ago,
// so both show as not reporting; the live simulator carries on from here.
async function seedReadings(plants, devices, now) {
  const step = 15 * 60
  const start = Math.floor((now - 7 * DAY) / (step * 1000)) * step * 1000
  const offlineSince = { 'TN-KAM-04': now - 5 * HOUR }
  const silentSince = now - 3 * HOUR
  const capacity = id => plants.find(p => p._id.equals(id)).capacityKwp
  // Registers start at plausible lifetime totals rather than zero.
  const prev = Object.fromEntries(devices.map(d => [d._id, d.type === 'inverter'
    ? { totalYieldKwh: d.ratedPowerKw * 4000 }
    : { exportKwh: capacity(d.plant) * 6000, importKwh: capacity(d.plant) * 40 }]))

  const readings = []
  for (let t = start; t <= now; t += step * 1000) {
    for (const plant of plants) {
      if (t > (offlineSince[plant.code] ?? Infinity)) continue
      const reporting = devices.filter(d => d.plant.equals(plant._id) && !(t > silentSince && config.silentSerials.includes(d.serialNumber)))
      for (const r of simulatePlant(plant, reporting, new Date(t), step, prev)) {
        prev[r.deviceId] = r.values
        readings.push(r)
      }
    }
  }
  await ingestReadings(readings)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDb()
  await seed()
  await disconnectDb()
}
