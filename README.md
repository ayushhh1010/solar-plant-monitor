# Solar Ops

A web app for a solar operations team: plants, their meters and inverters, live and historical device data, field crew, and issue tickets with a controlled lifecycle and audit trail.

Stack: Node.js + Express 5, MongoDB (Mongoose), React 19 (Vite), Recharts.

## Quick start

Needs Node.js 20.19 or newer (22 LTS recommended). Nothing else needs to be installed.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and sign in with one of the demo accounts below.

- `npm install` also downloads a MongoDB server binary once (large on Windows, ~780 MB archive). The API runs it as an **embedded database** stored in `server/data/db`, so no MongoDB install is needed.
- On first start the empty database is filled with demo data automatically. A simulator then adds new device readings every minute.
- `npm run seed` wipes and reloads the demo data. Stop the app first: the embedded database can only be opened by one process.
- `npm start` builds the web app and serves everything from http://localhost:4000.
- `npm test` runs the API tests against a throwaway in-memory database.

**Using your own MongoDB:** copy `server/.env.example` to `server/.env` and set `MONGO_URI`. To skip the binary download in that case, install with `MONGOMS_DISABLE_POSTINSTALL=1`.

## Demo accounts

All passwords are `Solar@123`. The login page has buttons that fill these in.

| Email | Role |
| --- | --- |
| admin@solarops.test | Admin |
| manager@solarops.test | Manager |
| operator@solarops.test, operator2@solarops.test | Operator |
| viewer@solarops.test | Viewer |

## Roles and permissions

Everyone signed in can see everything. What each role can change:

| Action | Admin | Manager | Operator | Viewer |
| --- | :-: | :-: | :-: | :-: |
| Onboard, edit and decommission plants | ✓ | | | |
| Register, edit, move and retire devices | ✓ | | | |
| Add crew, change their plants and status | ✓ | ✓ | | |
| Report an issue (create a ticket) | ✓ | ✓ | ✓ | |
| Start work, mark resolved, comment | ✓ | ✓ | ✓ | |
| Assign crew, change priority, verify & close, reopen, cancel | ✓ | ✓ | | |

The permission table lives in one place (`server/src/domain.js`). The API enforces it on every request; the UI reads the same table from `GET /api/meta` only to hide buttons the user can't use.

## How each problem statement is covered

| # | Problem | Where |
| --- | --- | --- |
| 1 | Controlled access | Seeded users only, bcrypt passwords, JWT in an httpOnly SameSite cookie, role checks on the API |
| 2 | Plant onboarding | **Plants** page: list with size, status and health; *Onboard plant*. Duplicates blocked by code, by name (any case) and by location (another plant within ~100 m) |
| 3 | Device registry | **Devices** page and plant page. Shared fields plus meter-only and inverter-only fields. A device must reference a live plant; manufacturer + serial number is unique (any case), retired devices included |
| 4 | Device monitoring | Device page: *Right now* values and a *History* view (6 h, 24 h, 7 days, 30 days or a custom period) with charts per device type |
| 5 | Crew coverage | Plant page lists who can be sent there, available people first, with phone, skills and current workload. **Crew** page filters by plant and availability |
| 6 | Issue reporting | **Tickets**: report from anywhere (pre-filled from a plant or device page), lifecycle with enforced steps, crew assignment, comments and a full audit trail |
| 7 | At-a-glance overview | **Overview**: live output, plants by status, open/critical/unassigned/overdue tickets, silent devices, and a "Needs attention" list ordered worst first |
| Bonus | Stale devices | Active devices with no data for 15 min are flagged everywhere |
| Bonus | Issue analytics | Average time to resolve per priority vs target, age of open tickets, tickets per plant (last 90 days) |

## Ticket lifecycle

```
open ──assign crew──▶ assigned ──start work──▶ in progress ──mark resolved──▶ resolved ──verify & close──▶ closed
  │                      │                          ▲                            │
  └──────cancel──────────┴──▶ cancelled             └───────────reopen───────────┘
```

- Assigning crew is a manager/admin action; the crew must be active and assigned to that plant.
- Resolving needs a note on what was done. Reopening and cancelling need a reason.
- Only a manager/admin can verify and close, so nobody signs off their own fix as an operator.
- Closed and cancelled are final. Any other move is rejected by the API.
- Each change is written to the ticket's history with who, when, from and to. Changes use optimistic locking, so two people can't overwrite each other.
- Only one open ticket per plant/device and category is allowed; the second report is pointed to the existing one.
- Targets for fixing: critical 4 h, high 24 h, medium 3 days, low 7 days. Overdue tickets are flagged.

## Device data

There is no real hardware, so data comes in through the path a field data logger would use:

- **Ingest API:** `POST /api/ingest/readings` with header `x-api-key` (default `dev-ingest-key`) and a JSON array of `{ deviceId, ts, values }`. Readings are validated per device type: a meter can't send inverter metrics, values must be numbers, timestamps can't be in the future.
- **Simulator:** inside the API, every 60 s it generates readings for each active device at plants that are operational, commissioning or under maintenance. It follows a day/night solar curve for each plant's longitude, with cloud noise. Offline plants send nothing.
- **Seed:** 7 days of 15-minute history. Two failures are built in: *Kamuthi Plains* went offline 5 h ago, and Charanka *INV-03* (serial `SG-INV-2203`, listed in `SIM_SILENT_SERIALS`) lost communication 3 h ago. Both show up as not reporting.

Readings are stored in a MongoDB **time-series collection** (90-day retention). Each device also keeps its latest values, so "right now" views never scan history.

To push a reading yourself, for example to make INV-03 report once (bash; take the device id from the browser URL). It goes silent again after 15 min unless you remove its serial from `SIM_SILENT_SERIALS`:

```bash
curl -X POST http://localhost:4000/api/ingest/readings -H "x-api-key: dev-ingest-key" -H "content-type: application/json" -d '[{"deviceId":"<id>","values":{"acPowerKw":640,"dcPowerKw":655,"temperatureC":41}}]'
```

## Project layout

```
server/src
  domain.js        roles, permissions, statuses, ticket transitions, metric definitions
  models/          User, Plant, Device (+ Meter/Inverter discriminators), Reading (time series), Crew, Ticket
  services/        tickets.js (workflow), readings.js (ingest + history), overview.js (health, dashboard), simulator.js
  routes/          auth, plants, devices, crew, tickets, ingest
  middleware/      auth (session, roles, API key), errors
  seed.js          demo data, built through the real ticket workflow
server/test        API tests for the business rules
client/src
  pages/           Dashboard, Plants, PlantDetail, Devices, DeviceDetail, Crew, Tickets, TicketNew, TicketDetail, Login
  components/ui.jsx  layout, forms, modal, badges
```

## Configuration (`server/.env`, all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `MONGO_URI` | (embedded) | Use an external MongoDB instead of the embedded one |
| `PORT` | 4000 | API port |
| `JWT_SECRET` | dev value | Session signing secret; required when `NODE_ENV=production` |
| `INGEST_API_KEY` | `dev-ingest-key` | Key for the ingest API |
| `SIMULATOR` | on | `off` disables generated readings |
| `SIM_INTERVAL_SEC` | 60 | Simulator interval |
| `STALE_AFTER_MIN` | 15 | Gap after which a device counts as not reporting |
| `SIM_SILENT_SERIALS` | `SG-INV-2203` | Comma-separated serials the simulator keeps silent |
