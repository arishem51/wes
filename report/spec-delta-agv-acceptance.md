# Spec delta — AGV acceptance (DISABLED vs IGNORED)

Changes made 2026-08-15 that the official reports do not yet describe. Merge into
the source `.docx` on Drive; `report/specs/` is a generated mirror and will be
overwritten by `scripts/sync-specs.py`.

## 1. `is_dispatch_enabled` gates dispatch only — not parking, not charging

**Affected:** SDS attribute table row 07 (`is_dispatch_enabled`); SDS
`ParkingEngineService.toCandidate` / `ChargeEngineService.toCandidate` method
tables; SRS UC "Disable AGV from Accepting Requests" postconditions; SRS BR-06.

`needsParking()` and `needsCharging()` used to require `dispatchEnabled`, so an
AGV in acceptance status DISABLED stopped where it finished its last leg: never
sent to a park point, never sent to charge even below the critical threshold.
That contradicted SDS row 07 ("Eligibility gate for the assignment engine") and
the UC postcondition ("excluded from **next dispatch cycle**"), neither of which
mentions parking or charging.

Both policies now read only `ignored`. Net behaviour:

| Acceptance | New cargo task | Park on idle | Forced charge | Routing obstacle |
|---|---|---|---|---|
| ENABLED | yes | yes | yes | yes |
| DISABLED | no | **yes** | **yes** | yes |
| IGNORED | no | no | no | yes |

The IGNORED row is unchanged and matches BR-06 verbatim. It is enforced twice:
by the `ignored` flag in each policy, and by the kernel integration level
`TO_BE_RESPECTED` that `ignore()` pushes, which fails `isIdleAvailable()`.
`ChargeVehicleCandidate.dispatchEnabled` was removed as a dead field.

## 2. The parking suppressor no longer holds back paused AGVs

**Affected:** SDS `ParkingEngineService.hasPendingWork` method table.

`needsParking` suppressed parking fleet-wide while any task waited to be
assigned. A DISABLED AGV can never take that work, so it was blocked from the
park point indefinitely while standing in an aisle. The gate is now
`hasPendingWork && dispatchEnabled` — unchanged for AGVs still accepting work.

Also note the SDS text for `hasPendingWork` says "CREATED / READY_TO_ASSIGN /
BLOCKED"; the code counts `READY_TO_ASSIGN` only. Correct the document.

## 3. Bulk acceptance endpoint and fleet multi-select

**Affected:** SRS §4.1 External Interfaces (currently an empty table); SRS
§II.1.3.2 UC list (Activate / Deactivate AGV); the operations-map screen
description that documents the vehicle control panel.

New admin-only endpoint alongside the four single-AGV actions, which are
unchanged:

```
POST /agvs/acceptance
{ "ids": [...], "action": "enable" | "disable" | "ignore" | "restore" }
→ { "action": ..., "results": [ { "id", "outcome", "reason" } ] }
```

`outcome` is `changed`, `unchanged` (the AGV is already in the target state —
the single-AGV endpoints answer 409 here, the bulk endpoint does not fail the
batch) or `failed` (AGV missing, action blocked by the IGNORED state, or the
kernel call failed). Each id is processed independently; one failure never
aborts the rest. Duplicate ids are applied once. Batch capped at 200 ids.

The operations map gains a third sidebar tab, "Xe", listing the registry with
per-row checkboxes, a select-all control and the four bulk actions; Ngừng nhận
việc and Bỏ qua keep the confirmation step the single-vehicle panel already had.
The per-vehicle panel opened by clicking an AGV on the canvas is unchanged.
