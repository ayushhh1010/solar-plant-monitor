# Solar Ops: write-up

## The problem as I understood it

An operations team keeps its plants, equipment, measurements, field crew and problems in different places. The app brings them together around one daily question: **is anything wrong right now, and who is dealing with it?** The seven problem statements are the pieces needed to answer it reliably: trusted users, a clean register of plants and devices, live and historical data, crew coverage, and a ticket process that can't be bypassed.

## Design decisions

**Data model.** Six collections: `users`, `plants`, `devices`, `readings`, `crew`, `tickets`.

- *Devices* use one collection with Mongoose **discriminators**: shared fields once, plus meter-only (`meterKind`, `accuracyClass`) and inverter-only (`ratedPowerKw`, `mpptCount`) fields, each type validated on its own.
- *Readings* live in a MongoDB **time-series collection**. What each type measures is defined once (`METRICS` in `domain.js`), so meter and inverter views show different charts from the same definitions. Each device keeps a `lastReading` snapshot, which makes "right now" and stale detection cheap.
- *Crew ↔ plants* is many-to-many, stored as an array of plant ids on each crew member (a person works at a handful of plants at most).
- *Tickets* embed their **history** (append-only audit entries), which is always read with the ticket and stays small.
- Nothing is hard-deleted. Plants are *decommissioned*, devices *retired*, crew made *inactive*, so old tickets and readings always point to something real.

**Identity and uniqueness.** A plant is a duplicate if its code matches, its name matches in any case (collation index), or another live plant is within ~100 m. A physical device is **manufacturer + serial number**, unique in any case across all plants including retired devices, since serials are only unique per manufacturer.

**Roles.** Four roles (see README): *admin* owns the asset register (plants, devices), *manager* runs operations (crew, triage, sign-off), *operator* reports and works issues, *viewer* reads. The permission table is one object on the server. The API checks it on every request, and the UI reads it only to hide controls.

**Ticket lifecycle.** `open → assigned → in progress → resolved → closed`, plus `cancel` before work starts and `reopen` from resolved. The rules:

- The allowed moves are a table; anything else is rejected.
- Crew are assigned only if active and assigned to that plant.
- Resolving needs a resolution note. Reopening and cancelling need a reason.
- **Verification is a manager action**, so the person who fixed something doesn't also sign it off.
- Closed and cancelled are final; a recurring problem gets a new ticket.
- Updates use optimistic locking, so two people can't overwrite each other.
- Only one open ticket per plant/device and category; duplicates point to the existing ticket.

**Edge cases handled.**

- *Decommissioning a plant* is refused while it has open tickets; otherwise it retires its devices and releases its crew.
- *Moving or retiring a device* is refused while it has open tickets (they describe the old site). Moves are recorded; readings stay with the device.
- *A crew member leaving* or dropping a plant is refused while they hold unfinished tickets there; the message lists which to reassign.
- A device fault must name a device of the chosen plant. Ids in request bodies must be plain strings, which blocks query injection.

**Getting data in.** Data enters through an **API-key protected ingest endpoint**, the path a site data logger would use. A built-in **simulator** feeds it every minute along each plant's day/night curve. The seed adds 7 days of history and two failures (an offline plant, a silent inverter).

**Overview.** The dashboard answers "does anything need attention?" in one list, ordered worst first:

- offline or maintenance plants
- devices that stopped reporting
- critical or high tickets
- unassigned tickets
- tickets past their target time
- fixes waiting more than a day for verification

Above it are four numbers (live output, plants, open tickets, silent devices). Below it are plant health and the bonus analytics: time to resolve per priority against target, age of open tickets, and tickets per plant.

**User flow.** Tasks start where the user already is: "Report issue" on a plant or device pre-fills the form, the plant page lists who can be sent (least busy first), and a ticket shows its next allowed step or who may take it. Rule violations appear in plain words in the form.

## Assumptions

- Crew are field technicians, **not app users**. Operators record progress on their behalf. Users are seeded and there is no sign-up or user admin screen.
- One deployment covers one team. Every signed-in user may *see* all plants; roles limit what they *change*.
- Plant capacity is DC kWp; inverter rating is AC kW. Meters report net power (negative = import), import meters measure auxiliary load.
- "Not reporting" means no data for 15 minutes (configurable), and is only judged for active devices.
- Fix-time targets (4 h / 24 h / 3 days / 7 days by priority) are reasonable defaults, not a contract.
- A plant's status (operational, maintenance, offline…) is set by people. *Health* is derived from tickets and data.

## Known gaps

- No login rate limiting or password management. Sessions last 8 h.
- No multi-document transactions: the embedded dev database is a single node. Decommissioning runs its steps in a safe order instead.
- The duplicate-ticket check and the plant proximity check can race under truly simultaneous requests (unique indexes cover codes, names and serials).
- Lists are capped (500 tickets) without paging. Overview figures are computed in memory, which is fine for tens of plants but not thousands.
- Energy per period assumes meter registers never reset.
- No notifications (SMS/email) when a critical ticket is raised.
- Tests cover the API rules end to end. There are no UI tests.

## With more time

- Auto-raise a *communication loss* ticket when a device goes silent, and notify the crew.
- Crew as users (technician role) with their own task list and on-call schedules.
- Per-device reporting intervals; performance ratio and expected-vs-actual yield per plant.
- Pagination, aggregation pipelines, rate limiting, user management, a replica set with transactions, photos on tickets.
