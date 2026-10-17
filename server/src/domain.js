// Business vocabulary and rules shared by the API, the seed and (via GET /api/meta) the UI.

export const ROLES = ['admin', 'manager', 'operator', 'viewer']

// Who may do what. The API enforces this table; the UI only uses it to hide controls.
export const PERMISSIONS = {
  'plant:write': ['admin'], // onboard, edit, decommission plants
  'device:write': ['admin'], // register, edit, move, retire devices
  'crew:write': ['admin', 'manager'], // crew join / leave / move between plants
  'ticket:create': ['admin', 'manager', 'operator'],
  'ticket:work': ['admin', 'manager', 'operator'], // start work, resolve, comment
  'ticket:triage': ['admin', 'manager'], // assign crew, change priority, close, reopen, cancel
}
export const can = (role, permission) => PERMISSIONS[permission]?.includes(role) ?? false
export const permissionsFor = role => Object.keys(PERMISSIONS).filter(p => can(role, p))

export const PLANT_STATUSES = ['commissioning', 'operational', 'maintenance', 'offline', 'decommissioned']
// Plants whose equipment is expected to be reporting data.
export const LIVE_PLANT_STATUSES = ['commissioning', 'operational', 'maintenance']

export const DEVICE_TYPES = ['meter', 'inverter']
export const DEVICE_STATUSES = ['active', 'maintenance', 'retired']
export const METER_KINDS = ['export', 'import', 'bidirectional']
export const ACCURACY_CLASSES = ['0.2S', '0.5S', '1.0']

export const CREW_STATUSES = ['active', 'on_leave', 'inactive']
export const CREW_SKILLS = ['electrical', 'mechanical', 'communications', 'civil']

export const TICKET_CATEGORIES = ['outage', 'device_fault', 'physical_damage', 'communication_loss', 'other']
export const TICKET_PRIORITIES = ['critical', 'high', 'medium', 'low']
export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled']
export const OPEN_TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'resolved'] // not yet closed/cancelled
export const ASSIGNABLE_STATUSES = ['open', 'assigned', 'in_progress']
// Target hours from report to resolution; older unresolved tickets are flagged on the dashboard.
export const SLA_HOURS = { critical: 4, high: 24, medium: 72, low: 168 }

// The only status changes allowed. Assigning crew (open → assigned) is its own action, see services/tickets.js.
export const TRANSITIONS = [
  { from: 'assigned', to: 'in_progress', permission: 'ticket:work', label: 'Start work' },
  { from: 'in_progress', to: 'resolved', permission: 'ticket:work', label: 'Mark resolved', noteRequired: true },
  { from: 'resolved', to: 'closed', permission: 'ticket:triage', label: 'Verify & close' },
  { from: 'resolved', to: 'in_progress', permission: 'ticket:triage', label: 'Reopen', noteRequired: true },
  { from: 'open', to: 'cancelled', permission: 'ticket:triage', label: 'Cancel', noteRequired: true },
  { from: 'assigned', to: 'cancelled', permission: 'ticket:triage', label: 'Cancel', noteRequired: true },
]
export const findTransition = (from, to) => TRANSITIONS.find(t => t.from === from && t.to === to)

// What each device type measures. `counter` metrics are cumulative (energy registers).
export const METRICS = {
  meter: [
    { key: 'activePowerKw', label: 'Active power (net)', unit: 'kW', chart: 'Power' },
    { key: 'exportKwh', label: 'Energy exported', unit: 'kWh', chart: 'Energy', counter: true },
    { key: 'importKwh', label: 'Energy imported', unit: 'kWh', chart: 'Energy', counter: true },
    { key: 'voltageV', label: 'Voltage (L-L)', unit: 'V', chart: 'Voltage' },
    { key: 'currentA', label: 'Current', unit: 'A', chart: 'Current' },
    { key: 'powerFactor', label: 'Power factor', unit: '', chart: 'Power factor' },
    { key: 'frequencyHz', label: 'Frequency', unit: 'Hz', chart: 'Frequency' },
  ],
  inverter: [
    { key: 'acPowerKw', label: 'AC power', unit: 'kW', chart: 'Power' },
    { key: 'dcPowerKw', label: 'DC power', unit: 'kW', chart: 'Power' },
    { key: 'totalYieldKwh', label: 'Energy yield', unit: 'kWh', chart: 'Energy', counter: true },
    { key: 'efficiencyPct', label: 'Efficiency', unit: '%', chart: 'Efficiency' },
    { key: 'dcVoltageV', label: 'DC voltage', unit: 'V', chart: 'DC voltage' },
    { key: 'temperatureC', label: 'Temperature', unit: '°C', chart: 'Temperature' },
  ],
}
