# SWES — Architecture Rules

> **Agent contract:** Every backend change in this repo MUST follow these rules.
> Rules override personal preference, framework defaults, and "it works" reasoning.
> When in doubt: simpler, not smarter. **Readable & maintainable beats clever.**
> If you change code in a way that makes this document wrong, update the document
> in the same change.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  wes-client (React + Vite)                                              │
│  MUI pages → react-query → axios → REST / WebSocket                    │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTP (REST) + WebSocket
┌────────────────────────────▼────────────────────────────────────────────┐
│  wes/ — NestJS Modular Monolith                                         │
│                                                                         │
│  Controllers (HTTP / WS)                                               │
│       │                                                                 │
│  Application Services   ←──── in-process Event Bus ────→               │
│       │                       (@nestjs/event-emitter)                   │
│  Domain Layer                                                           │
│  (state machine, policies — pure TS)                                    │
│       │                                                                 │
│  TypeORM Entities / Repositories (PostgreSQL)                           │
│       │                                                                 │
│  opentcs/ ← Anti-Corruption Layer (ACL) → openTCS REST + SSE           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                             │ REST (commands) + SSE (telemetry)
┌────────────────────────────▼────────────────────────────────────────────┐
│  opentcs-integration-FMS/ (Java/Gradle)                                 │
│  openTCS kernel — physical routing & AGV control. Dispatching is taken  │
│  over by WES: the kernel receives transport orders with an              │
│  intendedVehicle already chosen.                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**One-sentence rule per component:**
- `wes-client`: renders data from WES REST/WS — zero business logic.
- `wes`: all business logic lives here — single deployable binary.
- `opentcs/` (inside wes): translates between WES domain and openTCS — nothing else.

---

## 1.1 Design Patterns — what to use, where

Apply these patterns when changing the backend. Each row gives the pattern, where
it lives, and the one rule that keeps it intact.

| Pattern | Lives in | The rule |
|---|---|---|
| **Modular Monolith** | whole `wes/` | One deployable. No microservices, no external broker. |
| **Layered (light-DDD)** | every module | Controller → Service → Domain → Entity/Repo. Dependencies point inward (§2). |
| **State Machine** | `cargo/domain/transport-task.state-machine.ts` | The transition table is the single source of truth for the task lifecycle and the only code that assigns `task.status` (§4). |
| **Single write choke point** | `cargo/transport-task.service.ts` | `TransportTaskService.changeStatus()` is the only path to transition: validate (state machine) → persist → emit. Set other fields before calling it. |
| **In-process Event Bus** | `cargo/domain/events.ts` + `@nestjs/event-emitter` | Producers `emit`, consumers `@OnEvent`. Never call another service's method to trigger a reaction — emit an event (§3). |
| **Saga / Process Manager** | `cargo/transport-task.saga.ts` | Owns the TO1→TO2→TO3 leg progression reacting to `fms.transport-order.finished`. Keep multi-leg flow here, not scattered. |
| **Specification / Strategy** | `cargo/domain/dispatch.policy.ts`, `cargo/domain/row-dependency.policy.ts` | Fleet eligibility, vehicle pick, and row-dependency are pure functions. The engine feeds data in; the policy decides. No hardcoded vehicles (§6). |
| **Anti-Corruption Layer** | `src/opentcs/` | All openTCS REST/SSE + types stay here; never leak openTCS types into business modules (§5). |
| **Repository + DTO** | every module | TypeORM repos for persistence; map entities → DTO before returning from controllers. |

**Pure-domain rule:** everything under `domain/` is framework-free TS (no NestJS,
no TypeORM) so it is unit-testable without a DB or HTTP. Every pure rule ships a
`*.spec.ts` (e.g. `transport-task.state-machine.spec.ts`, `dispatch.policy.spec.ts`).

---

## 2. Backend Module Structure

### 2.1 Generic module layout

```
src/{module}/
  {module}.controller.ts     # HTTP/WS only
  {module}.service.ts        # Application use cases
  {module}.module.ts         # DI wiring
  {module}.dto.ts            # or dto/{module}.dto.ts — request/response (class-validator)
  domain/                    # pure TS only (when the module has real rules)
  entities/
    {entity}.entity.ts       # TypeORM entity = persistence model
```

### 2.2 `cargo/` layout — the reference module

```
src/cargo/
  cargo.controller.ts            # HTTP: create / list / get / delete cargo
  cargo.service.ts               # use cases for Cargo (create, list, remove)
  cargo.dto.ts
  cargo.module.ts
  transport-task.service.ts      # ⭐ single write choke point for task.status
  transport-task.saga.ts         # ⭐ TO1→TO2→TO3 orchestration (@OnEvent)
  release-engine.service.ts      # CREATED → READY_TO_ASSIGN | BLOCKED
  assignment-engine.service.ts   # READY_TO_ASSIGN → PICKING_UP (+ creates TO1)
  dispatch-scheduler.service.ts  # debounced flush: release → assign (@OnEvent)
  delivery-slot.engine.ts        # picks a free drop-off slot in a zone (at the TO2 barrier)
  domain/                        # PURE — no NestJS, no TypeORM
    events.ts                    # event names + payload classes
    transport-task.state-machine.ts
    dispatch.policy.ts
    row-dependency.policy.ts
    *.spec.ts
  entities/
    cargo.entity.ts              # table: cargos
    transport-task.entity.ts     # table: transport_requests
```

### 2.3 Layer rules

| Layer | May import | May NOT import |
|---|---|---|
| Controller | Service, DTO | Domain, Entity directly |
| Application Service | Domain, Entity/Repo, other Services, ACL services | Controller |
| Domain (`domain/`) | Nothing (pure TS) | Any NestJS or TypeORM import |
| Entity | TypeORM decorators only | Service, Domain, DTO |
| opentcs ACL | Its own types only | cargo, agvs, maps, zones, etc. |

**Rationale:** the Domain layer must be unit-testable without a DB or HTTP context.

---

## 3. Event-Driven Rules (in-process)

### 3.1 Setup
`@nestjs/event-emitter` is wired via `EventEmitterModule.forRoot()` in `AppModule`.

### 3.2 Naming convention
`{entity-kebab-case}.{past-tense-verb}` — e.g. `transport-task.status-changed`,
`fms.transport-order.finished`.

### 3.3 The canonical event set (`cargo/domain/events.ts`)

```typescript
export const TRANSPORT_TASK_EVENTS = {
  CREATED: 'transport-task.created',
  STATUS_CHANGED: 'transport-task.status-changed',
  COMPLETED: 'transport-task.completed',
  FAILED: 'transport-task.failed',
} as const;

export const FMS_EVENTS = {
  TRANSPORT_ORDER_FINISHED: 'fms.transport-order.finished',
  VEHICLE_AVAILABLE: 'fms.vehicle.available',
  VEHICLE_ERROR_CHANGED: 'fms.vehicle.error-changed',
} as const;
```

Payload classes carry only IDs/primitives, never an entity:
`TransportTaskCreatedEvent`, `TransportTaskStatusChangedEvent` (taskId, from, to,
cargoId), `TransportTaskCompletedEvent`, `TransportTaskFailedEvent`,
`FmsTransportOrderFinishedEvent` (orderName), `FmsVehicleAvailableEvent`,
`FmsVehicleErrorChangedEvent` (vehicleName, kind, fatal[], warning[], plus the
vehicle-state/point/order snapshot taken when the change was observed).

### 3.4 Emitting
- Transport-task events are emitted **only** by `TransportTaskService`, **after**
  the DB write so consumers see fresh state.
- `fms.*` events are emitted by `KernelEventListenerService` (in `opentcs/`) on
  the live SSE stream, and — as a **level-triggered backstop** — re-emitted by the
  reconcilers when a frame was lost (§6.4): the heartbeat re-emits
  `fms.vehicle.available`, and `LegReconcileService` re-emits
  `fms.transport-order.finished`. No other class emits `fms.*`. Re-emission is
  safe because every `fms.*` consumer is idempotent.

### 3.5 Consuming
- Use `@OnEvent('...')` (array form for multiple events) on a service method.
- Consumers are decoupled from producers — never call the producer's service
  directly to react to its output.

### 3.6 Wiring (the standing flow)

```
KernelEventListenerService → emits 'fms.transport-order.finished'
                             emits 'fms.vehicle.available'
                             emits 'fms.vehicle.error-changed'

VehicleErrorService        ← @OnEvent('fms.vehicle.error-changed')
                             inserts one row into vehicle_error_events (§6.6)

TransportTaskSaga          ← @OnEvent('fms.transport-order.finished')
                             advances TO1 → TO2 → TO3,
                             changes status via TransportTaskService

TransportTaskService        = the only writer of task.status; on each change
                             emits 'transport-task.status-changed'
                             (+ '.completed' on DELIVERY_COMPLETED,
                                '.failed'    on FAILED)
                             on create emits 'transport-task.created'

DispatchSchedulerService   ← @OnEvent(['transport-task.created',
                                        'transport-task.status-changed',
                                        'fms.vehicle.available'])
                             debounced (1.5s) flush:
                             park-claims → leg-reconcile → release → assign → park
```

No service calls `DispatchSchedulerService.schedule()` directly. The flush is
idempotent and debounced, so reacting to every status change is safe. A periodic
heartbeat also drives the flush regardless of events — see §6.4.

---

## 4. State Machine Rules (TransportTask)

### 4.1 Source of truth
All valid transitions live in `cargo/domain/transport-task.state-machine.ts`.
**Nothing else assigns `task.status`.**

Engines/services never call the state machine directly either — they go through
`TransportTaskService.changeStatus(task, newStatus)` (the single write choke
point): it validates via the state machine, saves, and emits the domain event.
Mutate other fields (metadata, timestamps) on the task object **before** calling
it — they persist in the same write.

### 4.2 Lifecycle & triggers

```
                 ┌──────────── BLOCKED ◄──┐  (row-dependency fails)
                 ▼                         │
CREATED ──► READY_TO_ASSIGN ──► PICKING_UP ──► DELIVERING ──► DELIVERY_COMPLETED
  ReleaseEngine     AssignmentEngine    saga          saga
  passes dep →      picks AGV, creates  TO1 FINISHED  TO3 FINISHED →
  READY else        TO1 (PICK_UP)       → create TO2  DELIVERY_COMPLETED
  BLOCKED                               (approach MOVE) + cargo = DELIVERED
                                        → DELIVERING.
                                        TO2 FINISHED → create TO3
                                        (DROP_OFF), stays DELIVERING.

CANCELLED ◄── from CREATED, BLOCKED, READY_TO_ASSIGN, PICKING_UP, DELIVERING
FAILED    ◄── from PICKING_UP, DELIVERING  (missing approach/destination
                                            location or assigned vehicle)
Terminal (no exits): DELIVERY_COMPLETED, CANCELLED, FAILED
```

There are **three** openTCS transport orders per task: `TO1` = pick-up, `TO2` =
approach (a `MOVE` to a specific feeder-head point, with no load operation),
`TO3` = drop-off. The order-name prefix (`TO1-`/`TO2-`/`TO3-`) tells the saga
which leg finished; the names are stored in
`task.metadata.{to1Name,to2Name,to3Name}`.

**Drop-off slot is late-bound.** Creating a request only *reserves a seat* in the
destination zone (`cargo.destination_zone_id`, capacity-checked against the zone's
member count); `cargo.destination_location_name` stays null. The concrete slot is
committed at the **TO2 barrier** (`TransportTaskSaga.commitDropoffSlot` →
`DeliverySlotEngine.findSlot`), under a per-zone advisory lock, when the vehicle is
parked at the zone's approach head and occupancy reflects physical reality — this
keeps the fill order correct on one-way lanes. `TO1` (pick-up) therefore only needs
the source location. TO2's target is chosen at dispatch:
`ApproachPointService.pickFor(zone, vehicle)` returns the **nearest reachable
feeder-head point** (an aisle head from which all slots stay forward-reachable),
and TO2 is a `MOVE` to that point — no `zone_<id>` approach location is involved.

### 4.3 State machine interface

```typescript
// domain/transport-task.state-machine.ts — pure
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  CREATED:            [READY_TO_ASSIGN, BLOCKED, CANCELLED],
  BLOCKED:            [READY_TO_ASSIGN, CANCELLED],
  READY_TO_ASSIGN:    [PICKING_UP, CANCELLED],
  PICKING_UP:         [DELIVERING, CANCELLED, FAILED],
  DELIVERING:         [DELIVERY_COMPLETED, CANCELLED, FAILED],
  DELIVERY_COMPLETED: [],
  CANCELLED:          [],
  FAILED:             [],
};

export class TransportTaskStateMachine {
  static canTransition(from: TaskStatus, to: TaskStatus): boolean;
  static isCancellable(status: TaskStatus): boolean;   // == canTransition(s, CANCELLED)
  static transition(task: TransportTaskEntity, to: TaskStatus): void;
  // transition() throws InvalidTransportTaskTransitionError on an illegal move,
  // otherwise sets task.status = to (the ONLY assignment of task.status).
}
```

`TaskStatus` enum (`entities/transport-task.entity.ts`): `CREATED`, `BLOCKED`,
`READY_TO_ASSIGN`, `PICKING_UP`, `DELIVERING`, `DELIVERY_COMPLETED`, `CANCELLED`,
`FAILED`.

---

## 5. Anti-Corruption Layer (openTCS)

**Module:** `src/opentcs/` — files: `kernel-api.service.ts` (REST calls only),
`domain/kernel-model.ts` (the `Kernel*` types), `domain/kernel-mappers.ts` (pure
payload → `Kernel*` mapping), `domain/vehicle-operations.ts` (`VEHICLE_TYPE` →
load/unload/charge operation names), `kernel-event-listener.service.ts` (SSE →
`fms.*` events), `kernel-sync.service.ts` (startup sync), `vehicle-state.store.ts`
(in-memory live vehicle telemetry), `map-loader/` (XML plant-model parsing/loading).

### 5.1 What belongs here
- All `axios`/HTTP calls to the openTCS REST API — and nothing else in
  `kernel-api.service.ts`: types live in `domain/kernel-model.ts`, and every
  `unknown → Kernel*` conversion in `domain/kernel-mappers.ts`, which is pure TS
  and unit-tested without axios (`domain/kernel-mappers.spec.ts`).
- All openTCS-specific types (`KernelVehicleState`, etc.). Consumers import them
  from `opentcs/domain/kernel-model`; only `KernelApiService` itself is injected.
- SSE connection management and translation of SSE frames into `fms.*` events.
- The live vehicle-state cache (`VehicleStateStore`).

### 5.2 What does NOT belong here
- Business logic (which AGV to pick, which location to go to).
- Transport-task state management or cargo writes.
- WES naming conventions. `PARK-<vehicle>-<point>-<uuid>` is a WES convention:
  the ACL reports transport orders as the kernel gives them and `ParkClaimStore`
  decides which are park claims (§6.4).

### 5.2b Plant model: one typed door, one raw door
Two accessors, and which one you may call depends on where you are:

| Accessor | Returns | Who may call it |
|---|---|---|
| `getPlantModelView()` | `KernelPlantModel` — mapped, validated `points` / `paths` / `locations` / `locationTypes` | **anyone**, including business modules |
| `getRawPlantModel()` | the untouched kernel payload | only `opentcs/` (the read-modify-`PUT` round trip) and the `maps` passthrough endpoint that hands the model to the FE |

A business module that reaches for `getRawPlantModel()` and casts it to
`Record<string, unknown>` is re-opening the leak §10 forbids: add the missing
field to `KernelPlantModel` and its mapper instead. Both accessors share one cache,
invalidated by `putPlantModel`/`putRawPlantModel`; the view is identity-stable
between invalidations, which is what lets `RoutingService` cache its road graph.
Entries the kernel reports in an unusable shape (a path with no endpoints, a point
with no name) are dropped by the mapper and counted in one warning per model load.

### 5.3 Exports
`OpenTcsModule` exports exactly **`KernelApiService`** and **`VehicleStateStore`**.
Business modules consume those; they never import other opentcs internals.

### 5.4 Error handling
- openTCS call failures are caught by the caller in the cargo module
  (`AssignmentEngineService.assign`, `TransportTaskSaga.createNextOrder`): the
  error is logged and the step aborts **without** transitioning the task, so the
  scheduler retries it on the next cycle.
- openTCS error types never propagate into business code.

---

## 6. AGV Fleet & Dispatch Rules

### 6.1 AGV candidate selection

`AssignmentEngineService.buildCandidates()` joins `AgvEntity` (registry config)
with `VehicleStateStore` (live FMS telemetry) and hands `VehicleCandidate[]` to
the pure `planVehicleAssignments()` policy in `cargo/domain/dispatch.policy.ts`.
No hardcoded vehicle name.

```
eligible AGV =  isDispatchEnabled = true
            AND isIgnored = false
            AND ( FMS-available (procState IDLE|AWAITING_ORDER)
                  OR preemptible-parking (en route to a PARK- order — §6.4) )
                with integrationLevel = TO_BE_UTILIZED
            AND energyLevel > operationalBatteryThreshold      (strictly greater)
            AND not already on a PICKING_UP/DELIVERING task
```

`AssignmentEngineService` selects at most N valid tasks from the FIFO head
(`createdAt ASC, id ASC`), where N is the number of eligible AGVs, then
`planVehicleAssignments()` runs the Hungarian algorithm over the resulting
task×vehicle cost matrix. Each cost is the road-graph shortest-path distance from
the cargo's source point to the vehicle's `currentPosition`: `RoutingService`
builds the graph from plant-model paths and `shortestDistancesFrom()` computes
the distances with Dijkstra. This minimizes total fleet approach distance for
the whole dispatch batch instead of greedily minimizing one task at a time.

Unknown pairs (plant model/source/vehicle position unavailable) use a finite
penalty; when all distance data is unknown, FIFO task order plus lowest vehicle
name is the deterministic fallback. A pair proven unreachable by an available
graph is excluded. An unmatched task is deferred for the cycle and the batch is
backfilled/re-solved, as it is after a late block or openTCS assignment failure.
An AGV whose assignment side effect fails is quarantined for that cycle so a
vehicle-specific fault cannot consume the backlog; the fixed heartbeat retries
deferred work against fresh telemetry. Independent pairs in the plan continue.
The FIFO head window prevents newer nearby work from starving feasible old tasks.
Within one flush a vehicle is never handed two tasks. **`AgvEntity.name` must
equal the openTCS vehicle name** — that is the join key. An empty `agvs` table ⇒
nothing dispatches (register the fleet first). Duplicate registry rows sharing a
vehicle name are ambiguous, so that name is excluded from the cycle and logged.

> Distance is the road-graph shortest path (Dijkstra), not straight-line — it
> respects aisles/walls. The Hungarian solver is a pure TypeScript domain
> function (`cargo/domain/hungarian.ts`) with no external runtime dependency.

**Battery-weighted cost spans the loaded approach leg.** With an active
`dispatch_policies` row carrying `weight_battery > 0`, a reachable pair costs
`(d_pickup + d_approach) × (1 + weight_battery × (1 − energyLevel/100))`, where
`d_approach` is the distance from the cargo's source point to the cheapest
approach point of its destination zone (`ApproachPointService.feederPointsOf`,
same feeder the saga commits at the TO2 barrier — §6.3). The destination *zone*
is known at request creation; only the concrete slot waits for TO2. The
drop-off leg is deliberately excluded: its point is unknown until that barrier.

`d_approach` never enters the unweighted cost, and must not be added there: it
is constant across a matrix row, and adding a constant to a row cannot change
which pairing the solver selects. It changes the outcome only once multiplied
by the per-vehicle battery factor, which is what makes the penalty track the
whole job instead of the empty run to the source. With `weight_battery = 0`
(including no active policy row) cost is the raw pickup distance and the term
is inert. The `distance` recorded on the assignment stays the raw distance to
the source so deadhead measurements remain comparable across settings.

### 6.2 Battery management
- Battery level is read from `KernelVehicleState.energyLevel` (FMS telemetry); WES
  never writes battery level to `AgvEntity`.
- `energyLevel > operationalBatteryThreshold` is the dispatch gate (§6.1).
- Below `operationalBatteryThreshold` (above charging): excluded from candidates,
  emit `agv.battery-low`.
- Below `chargingBatteryThreshold`: excluded from candidates, emit
  `agv.battery-critical`, and route the AGV to a charging order.

### 6.3 Row dependency / BLOCKED gate (WF-02)
The anti-congestion gate — the reason this product exists.
- The rule is a pure function in `cargo/domain/row-dependency.policy.ts`: a task is
  blocked when its `sourcePointName` sits "behind" (further from the aisle) another
  ACTIVE cargo at the same zone.
- `ReleaseEngineService` runs the policy on each CREATED task: pass →
  `READY_TO_ASSIGN`; fail → `BLOCKED` with a reason on `metadata`.
- BLOCKED tasks are re-evaluated on `@OnEvent('transport-task.completed')` (the
  blocker in front was delivered), moving them to `READY_TO_ASSIGN` when freed.
- `ReleaseEngineService` never touches a `PICKING_UP` task: halting a vehicle
  already sent into a lane is decided once, at cargo-create time, by
  `LaneSafetyService`. `PICKING_UP` still counts as *at source* in
  `PickupDependencyService`, so a cargo being picked keeps blocking the tasks
  behind it.

**Lane safety at cargo create** — `CargoService.create()` → `LaneSafetyService.
clearLaneForNewCargo()`. Cargo is not a kernel resource, so nothing below WES
stops a new box in a shallow slot from trapping a vehicle already ordered to a
deeper slot of the same lane. For every `PICKING_UP` task whose cargo is deeper
in that lane, the guard reads the vehicle's **`allocatedResources`** (points
only — a `A --- B` path resource is ignored) against the lane's point set:

- intersects → `BadRequestException`, nothing is withdrawn and no cargo is
  created. `withdrawTransportOrder(name, immediate=false)` does not clear the
  command queue, so a vehicle already granted resources inside the lane cannot
  be guaranteed to stop before it.
- disjoint → withdraw `to1Name`, then `changeStatus(BLOCKED)` (trigger
  `CARGO_CREATE`, `context.preempted`), clearing `to1Name`,
  `assignedVehicleName`, `assignedAt`, `startedAt`.

`allocatedResources` is read from `VehicleStateStore` while SSE is connected and
straight from `GET /v1/vehicles` when it is not (the 5s heartbeat is too stale
for this margin). The lane→points index is cached per zone.

**Ordering is the safety property, not the transaction.** A withdraw cannot be
rolled back and a DB transaction cannot un-send it, so everything that can fail
cheaply runs first: resolve the pickup location → capacity pre-check on the
drop-off zone (unlocked read) → lane guard → withdraw + block, one task at a
time (withdraw first, so a failed withdraw leaves the task `PICKING_UP` and
retryable) → only then the advisory-locked transaction that re-checks capacity
and inserts cargo + task. No HTTP call runs inside that transaction — it would
hold the per-zone advisory lock across a 10s kernel timeout. Accepted race: the
seat can be taken between the pre-check and the locked re-check, leaving a
preempted task `BLOCKED` with no blocker; the next flush's `unblock()` returns it
to `READY_TO_ASSIGN`.

### 6.4 Idle parking (WES-owned)
openTCS's own `parkIdleVehicles` is left **off** — WES owns which vehicle parks
where, so parking can respect claims, charge points and the cargo queue. WES is
therefore the sole author of park orders, which is what makes the ledger below safe.

**When** — `ParkingEngineService`, at the tail of every flush
(park-claims → leg-reconcile → release → assign → charge → **park**). Rules are pure
in `cargo/domain/parking.policy.ts` (`needsParking`, `pickParkingPoint`).

**Fleet gate** — suppressed while any task is `CREATED`, `READY_TO_ASSIGN` or
`BLOCKED`. All three are work assign is about to want: a task is written `CREATED`
and only classified on the *next* flush by `ReleaseEngineService`, and a `BLOCKED`
one becomes assignable the moment its lane clears. `PICKING_UP`/`DELIVERING` do
**not** suppress — they already hold a vehicle, and counting them would stop the
whole fleet parking for the length of a batch and leave idle vehicles in the aisles.

**Vehicle gate** — dispatch-enabled, not ignored, kernel reports
`IDLE`/`AWAITING_ORDER` + `TO_BE_UTILIZED`, carries no transport order, holds no
`PICKING_UP`/`DELIVERING` task, above the critical battery threshold, localised, and
**not already standing on a park point**. There is no idle delay: assign ran earlier
in this same flush and declined the vehicle, so waiting cannot win it work, while an
idle vehicle left on the mainline holds resources others need.

**Order names carry their target** — `buildOrderName` / `destinationFromOrderName`
(`cargo/domain/transport-order-name.ts`) format *every* WES-issued order as
`<TYPE>-<vehicle>-<destination>-<uuid>` (TYPE ∈ PARK, CHARGE, PICKUP, APPROACH,
DROPOFF), so the destination travels inside the name the kernel stores and echoes
back on the vehicle stream — no local order→destination table, nothing to rebuild.
The segment is whatever was sent to the kernel: a point for PARK and APPROACH, a
Location for PICKUP, DROPOFF and CHARGE, because openTCS binds the load/unload/charge
operation to a Location.

**A park point is unavailable** when any of the following holds. Together they cover
the three consecutive stages of one journey, and each stage hands off to the next:

| stage | source |
|---|---|
| order created, kernel has not attached it yet | `ParkClaimStore.claimedPoints()` |
| vehicle is driving there | `unavailableParkPoints` — decoded from the attached order's name |
| vehicle stands on it | `unavailableParkPoints` — vehicle snapshot position |

…plus every point already handed out earlier in the same pass. Charge points are
excluded from the pool entirely, so parking never lands on a charger.

**The order.** `PARK-<vehicle>-<point>-<uuid>`, one destination
`{locationName: <point>, operation: MOVE}`, tagged `wes:leg=PARK` (the listener's leg
gate ignores it, so park orders never reach the saga), `intendedVehicle` pinned, and
**`dispensable: true`** — cargo, charge and approach orders stay non-dispensable. A
claim is written only after the POST succeeds.

**The claim ledger.** `ParkClaimStore` (`cargo/park-claim.store.ts`) is an in-memory
`vehicle → {point, orderName}`. Both the parking and charge engines write a claim
when they create a park order, and read `claimedPoints()` / `claimedVehicles()`
instead of listing the kernel's order pool — `claimedVehicles()` is what stops WES
stacking duplicate park orders onto one vehicle.

**The release rule.** `DispatchSchedulerService` calls `parkClaims.reconcile()` once
per flush, ahead of the engines. Each entry is evaluated in this order; only the last
branch costs HTTP:

1. the vehicle stands on the claimed point → release (its position protects it now);
2. the vehicle is processing the claimed order → release (`parkPointFromOrderName`
   in `unavailableParkPoints` protects it now);
3. otherwise `getTransportOrderStateStrict(orderName)` — HTTP 404 or
   `FINISHED`/`FAILED`/`UNROUTABLE` → release; any other state → keep; **kernel
   unreachable → keep**.

`WITHDRAWN` is *not* terminal in openTCS 7.3.0 (it becomes `FAILED` later), so a
withdrawn order still holds its claim. 404 counts as released because a kernel
restart empties the order pool. `getTransportOrderStateStrict` exists precisely to
separate "the kernel says it is gone" from "the kernel did not answer" — the plain
`getTransportOrderState` collapses both to `null` and must not be used here.

**Rebuilt from the kernel, never assumed empty.** `ParkClaimStore` implements
`OnApplicationBootstrap`: one fleet-wide `getTransportOrders()` rebuilds every claim.
Which of those orders is a park claim is decided **in `ParkClaimStore`, not in the
ACL** — the `PARK-<vehicle>-<point>-<uuid>` naming convention is WES's, so the ACL
returns every order and the store filters (non-terminal state + `parkPointFromOrderName`,
falling back to the point encoded in the name when the order carries no destination).
Until the rebuild succeeds `isReady()` stays false and **no engine may create a park
order**; `reconcile()` retries every flush. Only one claim per vehicle is tracked (a
pre-restart fleet holding two live park orders for one vehicle keeps the newest and
logs). `getTransportOrders()` survives for this rehydrate only — never per flush.

**Disposal belongs to openTCS.** WES never withdraws a park order. A vehicle en
route to park stays an eligible dispatch candidate (`preemptibleParking`, recognised
by the `PARK-` name prefix WES owns — never inferred from "processing + no task",
which could misclassify a cargo order whose task is momentarily untracked), `assign()`
pins the cargo order to it via `intendedVehicle`, and `dispensable: true` makes the
kernel drop the park order in favour of that work. Claims retire only through
`reconcile()`; assignment adds no release of its own.

**Invariants — breaking any one re-opens a measured bug:**

1. **`dispensable: true` on park orders.** Without it nothing disposes of a stale one.
2. **`preemptibleParking`.** A `PROCESSING_ORDER` vehicle is `available === false`, so
   without this predicate a parking vehicle is invisible to dispatch — and because
   `intendedVehicle` is a hard pin, the kernel's swap then never fires at all.
3. **Release branch 2 and the order-name branch of `unavailableParkPoints` are two
   halves of one handoff.** Delete either and the point is unprotected for part of
   the journey.
4. **Never release a claim because the vehicle carries *some* order.** That inference
   is what made the deleted `PointReservationStore` (2026-07-28) churn; the name must
   not come back.
5. **An empty ledger is not "nothing is claimed".** Fail closed, everywhere.

Measurements, the kernel experiments behind these rules, and the rejected
alternatives are recorded in `report/park-claims-findings.md`.

### 6.5 Lost-event reconcile
The in-process bus can drop a frame (restart, hot-reload, network blip), so
**correctness never depends on an event**. Two
level-triggered backstops re-pull the kernel's authoritative state on a fixed
heartbeat (`DISPATCH_HEARTBEAT_MS`, default 5s); SSE stays the low-latency path:
- **Vehicle stream** — `KernelEventListenerService` re-pulls `GET /v1/vehicles`
  into the store and emits `fms.vehicle.available`, so a lost "→ IDLE" frame can't
  strand a finished vehicle.
- **Order stream** — `LegReconcileService` (runs right after `parkClaims.reconcile()`) recomputes
  each live task's expected leg order from its own status/metadata and, only when
  the vehicle has moved off it, fetches that single order by name: FINISHED →
  re-emit `fms.transport-order.finished`; FAILED/UNROUTABLE → fail the task. It
  never pulls the unbounded `/transportOrders` list (history grows without bound);
  the vehicle snapshot's `transportOrder` field is the cheap change detector.

### 6.6 Vehicle error detection (SRS §1.4.3 item 10)
The VDA5050 driver publishes the vehicle's live error types as two vehicle
properties — `vda5050:errors.fatal` and `vda5050:errors.warning`, each a
comma-joined, de-duplicated, sorted list of `errorType` strings. Any FATAL entry
also drives the kernel's own `Vehicle.State` to `ERROR`.

**Parsing belongs to the ACL.** `opentcs/domain/vehicle-errors.ts` (pure, with
`vehicle-errors.spec.ts`) turns those two properties into
`KernelVehicleErrors { fatal, warning }`, which `toKernelVehicleState` puts on
`KernelVehicleState.errors`. Business modules read `.errors` and must never know
the `vda5050:` property keys exist (§5.2).

**Detection is edge-triggered with the same level-triggered backstop as §6.5.**
`KernelEventListenerService` compares the previous and incoming error sets and
emits `fms.vehicle.error-changed` on every difference — from the SSE frame, from
the heartbeat re-pull, and from the store seed on connect. The seed emission is
what records a vehicle that was already faulted while WES was down; a reconnect
does not duplicate it, because the store already holds the same error set.

**One row per change, never an update.** `VehicleErrorService` (`agvs/`) inserts
into `vehicle_error_events` with `kind` ∈ `RAISED` / `CHANGED` / `CLEARED`. The
table is insert-only like `vehicle_state_transitions` (§8 applies): a later
recovery attempt appends a *new* row (`RECOVERY_ATTEMPTED` / `RECOVERY_REFUSED`)
rather than mutating the one that recorded the fault. There is no read endpoint
yet — the rows are evidence for the recovery work, queried directly during sim
runs.

**The operating screen is the primary surface.** Operators work on the warehouse
map, so that is where a fault has to be visible without hunting: `VehicleAlertBar`
floats over the canvas listing every faulted vehicle (fatal first) and selecting
one focuses it, `useVehicleShapes` draws a dashed ring around it, and
`VehicleControlPanel` lists the decoded error types. The ring matters because a
WARNING-only fault (`noRouteError`) leaves `Vehicle.State` untouched and would
otherwise be invisible on the map. All three read `KernelVehicle.errors`, which
already flows through `GET /maps/kernel/vehicles` and the SSE passthrough because
both hand out `KernelVehicleState` objects unchanged — no extra endpoint.

`AgvDto` deliberately carries **none** of this. `/agvs` is the registry path —
config plus the derived `kernelStatus`, no live telemetry — and faults belong on
the operating screen, so duplicating them onto an admin CRUD page would only
re-open that boundary.

Vietnamese error labels live in `wes-client/src/lib/vehicleErrors.ts` (pure
utility, per `wes-client/CLAUDE.md`).

**Not yet covered — deliberately.** openTCS freezes a vehicle that reports a
position outside its route (`kernelapp.requireManualReroutingAfterUnexpectedPosition`,
default `true`) without raising any vehicle error, and that frozen flag is not
exposed over REST. Such a vehicle is invisible to everything above; catching it
needs a periodic sweep for a `BEING_PROCESSED` order that stops progressing.

---

## 7. Read Model & Realtime (WF-08)
- Dashboard KPIs are computed queries — do NOT cache them in a separate table
  unless a measured bottleneck demands it.
- Realtime pushes use a NestJS `@WebSocketGateway` that subscribes to domain
  events and pushes to connected clients.
- `wes-client` consumes the WebSocket and calls
  `queryClient.invalidateQueries` on a message — no manual polling loops.

---

## 8. Audit Trail (WF-10)
- Every `TransportTaskEntity` state change and every Admin action writes an
  append-only row to `event_log`.
- Min schema: `(id, entity_type, entity_id, actor_id, action, from_state,
  to_state, metadata jsonb, created_at)`.
- The write happens in the **same DB transaction** as the state change, so a
  multi-write use case must adopt a transaction boundary. Rows are never updated
  or deleted.
- Implement as a shared `AuditService` injected where state changes occur — the
  natural home is inside `TransportTaskService.changeStatus`.

---

## 9. Frontend Rules (wes-client)
- All server state: **react-query** (`useQuery`, `useMutation`). No `useState` for server data.
- All form state: **react-hook-form + zod**.
- All API calls: `src/api/{domain}.ts`. No `axios` inside components/hooks.
- UI text: **Vietnamese** (see `wes-client/CLAUDE.md`).
- Live map canvas: **react-konva** in `src/features/map/`.
- UI components: MUI only. No additional component libraries.
- API response types: `src/types/{domain}.ts`.

---

## 10. What NOT to Do

| ❌ Don't | ✅ Do instead |
|---|---|
| Add Kafka, RabbitMQ, Redis Streams | Use `@nestjs/event-emitter` in-process |
| Split into microservices | Keep the modular monolith |
| Full Event Sourcing on all aggregates | Append-only `event_log` table only (§8) |
| Assign `task.status` anywhere | Call `TransportTaskService.changeStatus()` (§4) |
| Call the state machine straight from an engine | Go through `TransportTaskService.changeStatus()` |
| Trigger a reaction by calling another service | Emit an event; the consumer `@OnEvent`s it |
| Call openTCS REST from a business module | Go through `KernelApiService` (§5) |
| Leak openTCS types into cargo/agvs/etc. | Map to WES types in the ACL |
| Business logic in controllers | Put it in Services or pure Domain |
| Hardcode vehicle names | Build candidates from `AgvEntity` (§6.1) |
| `useEffect`/DOM for server data | react-query |
| Comments explaining WHAT code does | Name things well; comment only non-obvious WHY |

---

## 11. Implementation order (dependencies)

Build non-breaking and independently mergeable. Recommended sequence, because each
step depends on the one before:

1. **Row dependency / BLOCKED** (§6.3) — depends on the state machine (§4).
2. **Audit trail** (§8) — wraps `TransportTaskService.changeStatus` (§4) in a transaction.
3. **Realtime push** (§7) — consumes the events from §3.
4. **Battery management** (§6.2) — extends the dispatch policy (§6.1).

---

## 12. Testing Expectations
- **Domain** (`domain/*.ts`): pure unit tests, no DB/HTTP, aim 100% branch
  coverage. Every pure rule has its own `*.spec.ts`
  (e.g. `transport-task.state-machine.spec.ts`, `dispatch.policy.spec.ts`).
- **Services**: integration tests against a real (seeded/test-container) DB — do
  not mock the DB. Mock the openTCS ACL.
- **Controllers**: e2e via supertest.
- **ACL (`opentcs/`)**: mock the openTCS HTTP/SSE responses; test the mapping.
- **Frontend**: Playwright e2e for critical flows (auth, create cargo, cancel cargo).
- A service constructor change must update that service's `*.spec.ts` providers
  in the same change (keep the suite green).
```
