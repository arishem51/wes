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
} as const;
```

Payload classes carry only IDs/primitives, never an entity:
`TransportTaskCreatedEvent`, `TransportTaskStatusChangedEvent` (taskId, from, to,
cargoId), `TransportTaskCompletedEvent`, `TransportTaskFailedEvent`,
`FmsTransportOrderFinishedEvent` (orderName), `FmsVehicleAvailableEvent`.

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
                             leg-reconcile → release → assign → park
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
  BLOCKED                               (approach NOP) + cargo = DELIVERED
                                        → DELIVERING.
                                        TO2 FINISHED → create TO3
                                        (DROP_OFF), stays DELIVERING.

CANCELLED ◄── from CREATED, BLOCKED, READY_TO_ASSIGN, PICKING_UP, DELIVERING
FAILED    ◄── from PICKING_UP, DELIVERING  (missing approach/destination
                                            location or assigned vehicle)
Terminal (no exits): DELIVERY_COMPLETED, CANCELLED, FAILED
```

There are **three** openTCS transport orders per task: `TO1` = pick-up, `TO2` =
approach (a NOP move to the drop-off zone's approach location), `TO3` = drop-off.
The order-name prefix (`TO1-`/`TO2-`/`TO3-`) tells the saga which leg finished;
the names are stored in `task.metadata.{to1Name,to2Name,to3Name}`.

**Drop-off slot is late-bound.** Creating a request only *reserves a seat* in the
destination zone (`cargo.destination_zone_id`, capacity-checked against the zone's
member count); `cargo.destination_location_name` stays null. The concrete slot is
committed at the **TO2 barrier** (`TransportTaskSaga.commitDropoffSlot` →
`DeliverySlotEngine.findSlot`), under a per-zone advisory lock, when the vehicle is
parked at the zone's approach head and occupancy reflects physical reality — this
keeps the fill order correct on one-way lanes. `TO1` (pick-up) therefore only needs
the source location. The zone's parent `zone_<id>` location links to the zone's
**feeder points** (aisle heads), not every member, so the NOP stops at the
entry-most head from which all slots stay forward-reachable.

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

**Module:** `src/opentcs/` — files: `kernel-api.service.ts` (REST),
`kernel-event-listener.service.ts` (SSE → `fms.*` events), `kernel-sync.service.ts`
(startup sync), `vehicle-state.store.ts` (in-memory live vehicle telemetry),
`map-loader/` (XML plant-model parsing/loading).

### 5.1 What belongs here
- All `axios`/HTTP calls to the openTCS REST API.
- All openTCS-specific types (`KernelVehicleState`, etc.).
- SSE connection management and translation of SSE frames into `fms.*` events.
- The live vehicle-state cache (`VehicleStateStore`).

### 5.2 What does NOT belong here
- Business logic (which AGV to pick, which location to go to).
- Transport-task state management or cargo writes.

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
the pure `pickVehicle()` policy in `cargo/domain/dispatch.policy.ts`. No hardcoded
vehicle name.

```
eligible AGV =  isDispatchEnabled = true
            AND isIgnored = false
            AND ( FMS-available (procState IDLE|AWAITING_ORDER)
                  OR preemptible-parking (en route to a PARK- order — §6.4) )
                with integrationLevel = TO_BE_UTILIZED
            AND energyLevel > operationalBatteryThreshold      (strictly greater)
            AND not already on a PICKING_UP/DELIVERING task
```

Among the eligible AGVs, `pickNearestVehicle()` picks the one closest to the
cargo's source point: `RoutingService` builds an undirected weighted graph from
the plant-model paths (`cargo/domain/routing.ts`) and `shortestDistancesFrom()`
(Dijkstra) gives the road distance from the pickup point to each vehicle's
`currentPosition`. Ties, an unknown/unreachable position, or an unavailable plant
model fall back to `pickVehicle()` (lowest-named, deterministic). Within one flush
a vehicle is never handed two tasks. **`AgvEntity.name` must equal the openTCS
vehicle name** — that is the join key. An empty `agvs` table ⇒ nothing dispatches
(register the fleet first).

> Distance is the road-graph shortest path (Dijkstra), not straight-line — it
> respects aisles/walls. Task order stays FIFO (`createdAt ASC`); this is a
> per-task greedy nearest pick. A global-optimum strategy (e.g. Hungarian over a
> vehicle×task cost matrix built from the same `shortestDistancesFrom`) can
> replace the selection loop later without touching the graph or eligibility.

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

### 6.4 Idle parking, preemption & lost-event reconcile (WES-owned)
openTCS's own `parkIdleVehicles` is left **off** — WES owns parking so it can
preempt a park order the instant cargo arrives.

**Park on idle** — `ParkingEngineService`, at the tail of the flush
(leg-reconcile → release → assign → **park**). A vehicle idle with no cargo work
for `PARK_IDLE_DELAY_MS` (default 10s) is sent to the nearest free `PARK_POSITION`
via a `MOVE` order named `PARK-<uuid>` (`PARK_ORDER_PREFIX`, tagged `wes:leg=PARK`;
the listener's leg gate ignores it so park orders never reach the saga). Rules are
pure in `cargo/domain/parking.policy.ts` (`needsParking`, `pickParkingPoint`).
Suppressed while any `READY_TO_ASSIGN` task waits (don't park then preempt). The
`idleSince` clock and in-flight point reservations (`parkTargets`, which stop two
vehicles targeting one point) are in-RAM — on restart they simply re-arm.

**Preempt** — a vehicle en route to a park order is an eligible candidate
(`preemptibleParking`), recognized by the `PARK-` name prefix WES owns (never
inferred from "processing + no task", which could misclassify a cargo order whose
task is momentarily untracked). When picked, `assign()` withdraws the park order
before creating TO1; the `parkTargets` reservation frees itself once the vehicle
leaves that order.

**Lost-event reconcile** — the in-process bus can drop a frame (restart,
hot-reload, network blip), so **correctness never depends on an event**. Two
level-triggered backstops re-pull the kernel's authoritative state on a fixed
heartbeat (`DISPATCH_HEARTBEAT_MS`, default 5s); SSE stays the low-latency path:
- **Vehicle stream** — `KernelEventListenerService` re-pulls `GET /v1/vehicles`
  into the store and emits `fms.vehicle.available`, so a lost "→ IDLE" frame can't
  strand a finished vehicle.
- **Order stream** — `LegReconcileService` (first step of the flush) recomputes
  each live task's expected leg order from its own status/metadata and, only when
  the vehicle has moved off it, fetches that single order by name: FINISHED →
  re-emit `fms.transport-order.finished`; FAILED/UNROUTABLE → fail the task. It
  never pulls the unbounded `/transportOrders` list (history grows without bound);
  the vehicle snapshot's `transportOrder` field is the cheap change detector.

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
