# Spec delta — drop-off slot swap keeps a vehicle in its column

Change made 2026-08-18 that the official reports do not yet describe. Merge into
the source `.docx` on Drive; `report/specs/` is a generated mirror and will be
overwritten by `scripts/sync-specs.py`.

## 1. A vehicle already inside a column never changes column

**Affected:** SDS §2.2 / §II.5 `DeliverySlotEngine` and the transport-task saga
description ("commits the concrete drop-off slot late, at the TO2 barrier");
SRS BR-11.

BR-11 states *where* a slot may be placed (farthest-from-exit first, cascading
over the hops-to-exit columns) but says nothing about **re-aiming a vehicle that
is already driving inside the rack**. The commit loop samples vehicle positions
every 500 ms, so a vehicle that crosses the zone gate between two ticks enters a
column while its slot is still only *reserved* — and a reservation is takeable.
It could therefore be sent to a slot in another column and would have to back out
of the rack to reach it.

Two rules now bound that:

- the reservation of a cargo whose vehicle stands on a member point of column *i*
  is **not stealable** — the slot is treated exactly as if it were already
  committed, and the vehicle at the gate takes the next slot in BR-11 fill order;
- should such a vehicle ever have to re-pick a slot, only slots of **its own**
  column are offered, and nothing is committed when that column is full.

Consequence worth recording: the outcome of a commit tick no longer depends on
the order the tasks are processed in. A vehicle that missed its gate tick behaves
exactly as if it had committed there on time, so the 500 ms sampling grid cannot
change who gets which slot. This replaces what was previously a race between the
vehicle at the gate and the vehicle inside the rack.

## 2. Two corrections the documents still carry

**Affected:** SDS §2.2 saga text and §II.5 `TransportTaskSaga` method table; SRS
§II.1.4 Part B and BR-11's "Applied ... at the approach barrier".

- **There is no TO2 / approach barrier.** The approach leg was retired: there are
  two kernel orders per task (TO1 pick-up, TO3 drop-off + retreat). The concrete
  slot is committed by `DropoffCommitLoop` when the vehicle stands on a zone
  entry point (or later, once it is inside), not at a TO2 barrier. Every
  occurrence of "TO2 barrier" / "approach barrier" in the slot-commit description
  must be replaced with "zone gate".
- **`metadata.swapCount` counts two different things.** It is incremented both by
  a pick-up hand-over (`PickupOrderService.revoke`) and by losing a drop-off slot
  (`DropoffCommitLoop.reaimDisplaced`), while the assignment engine reads it as a
  pick-up hysteresis term. Harmless today — the drop-off increment can only
  happen after the pick-up swap window has closed — but any report figure quoting
  `swapCount` is mixing the two.
