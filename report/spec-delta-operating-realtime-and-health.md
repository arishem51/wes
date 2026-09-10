# Spec delta — operating console realtime path, SSE auth, and MQTT health

Changes made 2026-09-10 that the official reports do not yet describe. Merge into
the source `.docx` on Drive; `report/specs/` is a generated mirror and will be
overwritten by `scripts/sync-specs.py`.

**Affected:** SRS §4.1 External Interfaces (empty table — openTCS REST/SSE and
VDA5050 MQTT are undocumented); SDS §1 high-level (operating backend surface).

## 1. Operating SSE endpoints authenticate without an `Authorization` header

`GET /api/operating/vehicles/stream` and `/api/operating/cargo/stream` are
`EventSource` streams. `EventSource` cannot set request headers, so these two
routes accept the JWT by either:

- the `wes_access` cookie (set by `POST /api/auth/login` and `/api/auth/refresh`,
  `httpOnly`, `path=/api`), or
- a `?token=<jwt>` query parameter.

Both are already wired in `JwtStrategy` (`ExtractJwt.fromExtractors`). The
`wes-new-client-v2` client keeps its access token in `localStorage` and has no
token-refresh flow, so it relies on `?token=`; the cookie alone is insufficient
because it is session-scoped and disappears on a browser restart while
`localStorage` survives (REST calls keep working, streams 401, the map freezes
until re-login). Every other `/api/operating/*` route uses the bearer header as
normal.

**Follow-up not done:** the client has no silent refresh, so when the token
`exp` passes both REST and SSE 401 and the operator must log in again.

## 2. Realtime vehicle telemetry is event-driven, not polled

The moving-vehicle display on the operating screen is driven end to end by SSE:

openTCS kernel `GET /v1/sse` (`/events/vehicles`) → `KernelEventListenerService`
→ `VehicleStateStore.set()` (emits whenever the state fingerprint changes,
`precisePosition` included) → `OperatingVehiclesService.updates$` →
`@Sse('stream')` → browser `EventSource` → `LiveMapCanvas` motion interpolation.

`DISPATCH_HEARTBEAT_MS` (default 5000, `KernelEventListenerService`) is a
reconcile safety net only — it re-reads `/v1/vehicles` and pushes just what the
SSE stream missed; on a healthy stream every reconcile hits the fingerprint
dedup and emits nothing. It is not the update cadence for a moving vehicle.

## 3. MQTT broker liveness is reported in `GET /api/operating/health`

New `MqttHealthService` (`src/opentcs/`) holds a client connection to the
VDA5050 MQTT broker purely as a liveness probe (wes has no functional use for
MQTT — the broker is the kernel ⇆ AGV transport). `health.mqtt` is now `"ok"` /
`"unreachable"` instead of the previous hardcoded `"n/a"`.

Config (all optional, localhost defaults): `MQTT_URL`
(default `mqtt://127.0.0.1:1883`), `MQTT_USERNAME`, `MQTT_PASSWORD`.

## 4. Zone/map writes restore the fleet afterwards

Any zone create / update / remove / sync lands in openTCS as a full
`PUT /v1/plantModel`, which re-initialises every vehicle (comm adapter detached,
integration level reset to the model default). `ZoneLocationWriter` now
snapshots vehicle states before the write and, for each vehicle that was live
(`state !== 'UNKNOWN'`), re-enables its comm adapter and restores its prior
integration level afterwards. Best-effort and fully guarded — a kernel hiccup
here never blocks the zone bookkeeping. This replaces the note in
`project_cargo_workflow_opentcs` §24 #14 ("Area CRUD disables comm adapter"):
the side effect still happens at the kernel, but wes now undoes it.
