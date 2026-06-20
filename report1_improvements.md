# Report 1 — Improvement Notes

## Core Problem with Current Draft

The draft frames SWES as a product solving generic market pain points.
The stronger and more honest narrative is:

> "The company already runs an FMS built on openTCS. It has real, measurable operational problems.
> SWES is the execution layer built to solve them — validated by production data from the live system."

This reframes the project from *academic market research* to *evidence-based engineering*, which is
more credible to reviewers and more useful to the enterprise partner.

---

## Narrative Restructure: 3 Strategic Pain Points

### Pain Point 1 — Fleet State Contention (current FMS has no priority layer)

Charge and Park orders compete on equal footing with real transport orders.
On the busiest observed day (2026-04-21):

```
Charge:   743 orders → 665 failed  = 89.5% fail rate
Park:     185 orders → 104 failed  = 56.2% fail rate
Business: 946 orders →  60 failed  =  6.3% fail rate
```

44% of all orders on that day were support/maintenance orders (Charge + Park).
The dispatcher processed them at the same priority as transport orders.
The result: fleet capacity wasted on failing support tasks during peak load.

**Why this matters for SWES:** Proves the need for a fleet state management layer (FE-01)
that separates operational orders from business transport orders and enforces priority.

---

### Pain Point 2 — Deadlock & Post-Assignment Execution Failure

The current FMS has no deadlock detection or traffic-aware dispatch.
Proxy evidence from `vehicle_error_history`:

```
Vehicle 9:  78 E_STOPs → ~16.5 minutes blocked
Vehicle 7:  31 E_STOPs → ~22.0 minutes blocked
Vehicle 4:  34 E_STOPs → ~1.5  minutes blocked
```

E_STOP in AGV context = vehicle halts because another vehicle is blocking its path.
In a fleet of 11, this is near-deadlock behavior.

Supporting signal from `vehicle_history` state transitions:

```
ERROR → ERROR:    819 transitions (vehicles looping in error, not recovering)
ERROR → EXECUTING: 225
EXECUTING → ERROR: 194
```

819 repeated ERROR→ERROR transitions means vehicles are not single-fault events —
they are getting stuck in error loops, consistent with deadlock or blocked path conditions.

**Peak window collapse** further supports this.
Before 05:00: fail rate < 5%.
During 05:00–06:59: fail rate = **85%** (701 failed out of 825 orders).
After 07:00: fail rate drops back below 25%.

A two-hour window with 85% failure followed by recovery is not a systemic failure —
it is a **localized collapse under load**, caused by absence of queue management and
congestion awareness.

Average execution metrics on 2026-04-21:

```
avg_assign_seconds:      309s  (~5 min from creation to assignment)
avg_post_assign_seconds: 255s  (~4 min from assignment to completion attempt)
avg_total_seconds:       780s  (~13 min end-to-end)
```

Post-assignment delay of 255s means the problem does not end at dispatch.
Execution itself is where friction accumulates — congestion, E_STOP, route blocking.

**Why this matters for SWES:** Proves the need for FE-04 (Traffic Routing & Dispatch
Orchestration) with deadlock-aware logic and physical inventory context. The 309s/255s/780s
baseline also gives SWES measurable improvement targets.

---

### Pain Point 3 — openTCS Core Customization Risk (architectural)

Every business rule addition — dispatch priority, battery threshold logic, spatial
constraints — currently requires modifying openTCS core code.

Consequences:
- Upgrade path blocked: touching core increases regression risk on every version bump
- Testing surface expands unpredictably
- Business logic is embedded at the wrong architectural layer (fleet control instead of
  execution control)

This is not a bug. It is a structural mismatch: openTCS is a fleet controller, not a
warehouse execution system. Customizing it to do WES work is inherently fragile.

**Why this matters for SWES:** This is the architectural justification for why SWES must be
a *separate layer above openTCS*, not a patch to openTCS itself. It answers the reviewer
question: "Why not just fix the FMS?" — because fixing the FMS is the wrong abstraction level.

---

### Pain Point 4 (bonus) — No Operational Visibility

None of the KPI data in `stats.md` is visible during live operations.
It only exists as raw DB rows, accessible only via SQL over an SSH tunnel.

Operators cannot see during the 05:00–06:59 pressure window:
- How many orders are failing right now
- Which vehicles are in E_STOP and for how long
- Whether the queue is draining or accumulating

"You cannot improve what you cannot measure" — and currently, nothing is measured in real time.

**Why this matters for SWES:** Directly justifies FE-05 (Operational Monitoring Dashboard)
and FE-07 (Event Log & Audit Trail) as operational necessities, not nice-to-haves.

---

## Revised Objectives (suggested rewrite)

**Objective 1 — Reduce deadlock and post-assignment execution failure**
Introduce a warehouse execution layer that coordinates transport requests using warehouse
context and operational priorities, targeting reduction of the 85% peak-window failure rate
and the 255s average post-assignment delay observed in the production system.

**Objective 2 — Separate business execution logic from the fleet controller**
Decouple warehouse orchestration rules (priority, battery policy, spatial constraints)
from openTCS core code, reducing customization risk and enabling independent evolution
of business logic without touching the fleet control layer.

**Objective 3 — Provide real-time operational visibility**
Deliver KPI dashboards and execution monitoring so that warehouse performance metrics —
currently invisible during live operations — can be observed, benchmarked, and acted upon.

---

## Data Still Needed (if available)

| What | Why it would help |
|------|-------------------|
| E_STOP count by hour (correlate with 05:00-06:59) | Closes the triangle: peak load → E_STOP spike → cascade failure |
| Physical map of hot positions (0021, 2519, 2070) | Turns position codes into a congestion heatmap — strongest visual evidence |
| Manual intervention log | Quantifies operational cost of current system's fragility |
| Replan/reroute count | Proves routing instability under load |

---

## What NOT to change

- The existing operational data (6,294 orders, 11 vehicles, production date range) is solid and
  should stay as the evidence base.
- The GAP-01 through GAP-07 traceability structure in the Vision & Scope version is good.
  Keep it and strengthen the evidence behind each gap using the numbers above.
- The competitive analysis (openTCS, Geek+, GreyOrange) is well-structured. No changes needed.
