# Spec delta — handing a drop-off cell over, and taking it back

Changes made 2026-08-22/23 that the official reports do not yet describe. Merge
into the source `.docx` on Drive; `report/specs/` is a generated mirror and will
be overwritten by `scripts/sync-specs.py`.

## 1. A cell is released before it is promised to someone else

**Affected:** SRS §II.1.4 Part B (delivery workflow) and BR-11; SDS §3.1
`DropoffCommitLoop` / `VehicleAimService`.

The SRS says the drop-off order is issued *"once the AGV has reached the approach
point"*. In practice `DropoffCommitLoop` commits as soon as the vehicle stands on
any cell of its own lane axis, so the approach order is often still in flight
when the drop-off order is created. Two consequences the reports do not cover.

- **The kernel rejects an order aimed at a cell another live order already
  targets.** `FMSRouter.checkGeneralRoutability` fails it as UNROUTABLE with
  reason `duplicateGoal:<cell>:<claimant>`. The only exemption is an approach
  order handing its cell to the drop-off order **of the same vehicle**.
  Committing a slot that a second vehicle is queued on therefore has to withdraw
  that vehicle's approach order *first*; the commit loop now does so before it
  asks for the drop-off order, and puts the loser back on an order aimed at its
  replacement slot if the drop-off is then refused.

- **A vehicle's own approach order is now always withdrawn once its drop-off
  order exists**, unless it already pointed at the committed slot. It used to be
  kept alive whenever the committed slot lay further down the same lane, on the
  assumption that the vehicle could keep rolling. It cannot: every vehicle runs
  `vda5050:maxStepsHorizon = 0`, and openTCS processes one transport order per
  vehicle, so the AGV brakes at the end of the approach either way. Keeping the
  order bought no continuity and left the approach cell claimed against every
  other vehicle.

## 2. A cell is never taken from a vehicle further into the lane

**Affected:** SRS BR-11; SDS §3.1 `SlotReservationService.commit`.

BR-11 fixes the fill order but not who may lose a reservation to whom. Drop-off
lanes are single-file dead ends, so a committer must never be routed past a
vehicle already deeper in the same lane. `DropoffCommitLoop` now passes the
reservations held by vehicles ahead of the committer as
`unstealableLocationNames`, and `SlotReservationService.commit` treats them
exactly as committed cells — the committer takes the next cell out, or waits.

This is the rule `spec-delta-dropoff-slot-swap.md` §1 already stated for a
vehicle inside a column; it had never been implemented.

## 3. A waiting cell is claimed before a vehicle is ordered onto it

**Affected:** SRS §II.1.4 Part A (approach); SDS §3.1 `DropoffCommitLoop.reaimLane`
and `SlotReservationService`.

Of four `duplicateGoal` rejections measured in one 75-minute run, two were not
swaps at all: two different vehicles had been aimed at the same *waiting* cell
(`3126`, `3122`). Two causes, both now closed.

- **The queue was re-derived from scratch on every commit.** `reaimLane` built
  the chain of standing cells geometrically and handed cell *i* to waiting
  vehicle *i*, where the waiting list is sorted by **live position**. Vehicles
  move between ticks, so the sort order changes and a cell is re-assigned to a
  different vehicle while the previous one's approach order still aims at it.
  Seating is now stable — `domain/queue-assignment.ts`: a vehicle whose current
  cell is still part of the chain keeps it, and only the rest are re-seated.
  Cells held by a cargo outside that lane's waiting list are excluded outright.
- **The kernel order was created before the cell was claimed.** `queueAt` called
  `approachOrder.aim` first and wrote the reservation afterwards, leaving a
  window where the cell was taken in the kernel but free in the database.
  `SlotReservationService.claimCell` now takes the cell under the zone lock,
  refuses it if another ACTIVE cargo holds it, and returns the previous holding
  so `queueAt` can hand it back when the order cannot be created.

`aimAt` is replaced by `claimCell` / `restoreClaim`: aiming can now fail, and a
caller that ignores the refusal would re-create the defect.

## 4. A drop-off slot is a lease, not a grant

**Affected:** SRS §II.1.4 Part B; SDS §3.1 — a new `SlotReclaimService`.

The reports describe the slot being chosen and then used. They do not say what
happens when the vehicle holding it never gets there. Until now: nothing. A cargo
committed but never reaching `unloadedAt` — drop-off order FAILED or UNROUTABLE,
order withdrawn, vehicle fault, kernel restart — blocked **every** slot of its
lane for good, because `slotsOfBusyLanes` treats a live commit as a busy lane and
`hasLeftLane` only releases after an unload that will never come. Measured over
the two weeks to 2026-08-23: 74 such commits, **every one** cleared by
hand-deleting the cargo.

A committed slot is now reclaimed when its holder can no longer drop there:

- **Trigger.** `TRANSPORT_TASK_EVENTS.FAILED`, which had no subscriber at all,
  plus a 30-second sweep for what an event cannot catch — tasks that died while
  the service was down, `CANCELLED` tasks (no event is emitted for those), and
  commits whose task row is gone entirely.
- **Order.** `metadata.dropoffOrderName` is cancelled through
  `TransportOrderService` *before* the slot is released. Releasing first would
  let a second vehicle be aimed at a cell the first is still driving to — the
  `duplicateGoal` failure of §1. A refused cancellation is logged and the slot
  released anyway.
- **Judgement.** The service never decides that a vehicle is dead. It acts only
  on a terminal task status decided elsewhere: `LegReconcileService`, an operator
  cancellation, or the saga giving up. A vehicle reporting
  `adapterLostNavigation` is therefore untouched by construction, because
  `LegReconcileService` deliberately keeps that task alive to recover.
- **Aftermath.** The cargo is left ACTIVE with neither a commit nor a
  reservation — which is what it is: carried by a vehicle, placed nowhere.
  Giving it a fresh task is out of scope of this change.

Deliberately not covered: a vehicle pushed out of its lane, or blocked behind
another vehicle, keeps its commit. In both the task is alive and the drop-off
order still valid, so calling them dead needs inference rather than an
already-settled outcome. Both reduce to one predicate — *another vehicle stands
between the holder and its committed cell* — which should be measured before it
is allowed to release anything.

## 5. Corrections to `spec-delta-dropoff-slot-swap.md`

That delta records *"There is no TO2 / approach barrier. The approach leg was
retired."* The approach leg is present and in use. It also states a 500 ms commit
sampling grid; `DropoffCommitLoop` ticks every 200 ms. Its §2 should be dropped
when the deltas are merged.

Order names are no longer numbered by leg: a task records `pickupOrderName`,
`approachOrderName` and `dropoffOrderName`, and there is no TO1/TO2/TO3.
