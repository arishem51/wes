# WES Backend — Agent Rules

> Read `ARCHITECTURE.md` (same folder) first. This file adds NestJS-specific conventions on top.

## Docs are binding — check them before and after you code

Every feature and every code change is decided against the official SEP490_G4
reports, not against the code alone. A text mirror of those reports lives in
`report/specs/` — grep it, it is cheap. Never read the `.docx` files for this.

The mirror is generated and **not committed**. If `report/specs/` is missing or
`_manifest.json` is stale, run `python scripts/sync-specs.py` — do not skip the
checks below because the mirror is absent.

| Mirror file | Report | Use it to answer |
|---|---|---|
| `report/specs/report1-vision-scope.md` | 1 — Vision & Scope | Is this feature in scope at all? (§4 Scope & Limitations) |
| `report/specs/report3-srs.md` | 3 — SRS | What is the specified behaviour? Screens §3, NFR §4, business rules BR-01…BR-12 |
| `report/specs/report4-sds.md` | 4 — SDS | What is the specified design? High-level §1, class specs §3 |
| `report/specs/report5.0-test-documentation.md` | 5.0 — Test Doc | What is claimed to be tested |
| `report/specs/report2-project-plan.md`, `report2.1-project-tracking.md` | 2, 2.1 | Committed scope and schedule |

Requirements are addressed by section number (e.g. SRS §3.1.2, §4.2.1), plus
business rules `BR-01`…`BR-12`. Cite those anchors when you reason about scope.

**Before implementing** — locate the feature in the SRS/SDS and say which section
it comes from. Three outcomes, and each has a required action:

1. *Specified and consistent* → implement to the spec.
2. *Specified but the spec contradicts reality* (state name that does not exist,
   a knob that is never read, a flow the kernel cannot perform) → do NOT silently
   follow the code. Report the contradiction to the user and record it under
   "Doc drift" below. `report/srs-1.4.3-non-ui-functions.md` is the worked example.
3. *Not in the docs at all* → stop and flag it as **potentially out of scope**
   before writing code. If the user confirms it is needed, it must be written back
   into the docs — see below.

**After implementing** — anything that is not derivable from the docs must be
captured, or the work is lost at acceptance. This is the failure mode this rule
exists to prevent: stabilisation work (deadlock fixes, ADG-acyclicity, commit
horizon, claim resync, park-on-idle, VDA5050 wiring) is real engineering that no
report currently describes. When a change adds behaviour, a constraint, an
interface, a config flag or a failure mode that the reports do not mention, write
a short entry naming the affected report and section so it can be merged into the
official `.docx` later.

Known gaps to fill rather than re-discover: SRS §4.1 External Interfaces is an
empty table (openTCS REST/SSE and VDA5050 MQTT are undocumented); the dispatch
policy knobs `weight_proximity` and `weight_inventory_position` are documented but
never read by the code.

**Refreshing the mirror** (never hand-edit `report/specs/` — a re-sync overwrites
it; real edits belong in the Drive `.docx`):

```bash
python scripts/sync-specs.py          # all reports
python scripts/sync-specs.py 3 4      # only SRS and SDS
```

Source of truth is the Drive folder `1UjrNCm58OVG_p-GDwhyF7tYx8nt_qrJH`; the team
edits it, so re-sync before any scope discussion and check `report/specs/_manifest.json`
for the last sync time. Do not overwrite files in that folder.

## Quick orientation

| File | Role |
|---|---|
| `src/cargo/` | Core domain: transport orders, dispatch, assignment |
| `src/opentcs/` | ACL: all openTCS REST/SSE calls live here |
| `src/agvs/` | AGV fleet registry (WES side) |
| `src/zones/` | Warehouse topology (zones, members) |
| `src/maps/` | QR-grid map management |
| `src/auth/` | JWT auth, guards, roles |
| `src/users/` | User entities, roles, sessions |
| `src/admin-users/` | Admin user management use cases |
| `src/account/` | Self-service profile/password (operator/admin) |

## Code style

- Do NOT add comments to code. Code must express its intent by itself — clear names, small functions, extracted variables instead of explanatory comments.
- If a piece of code needs a comment to be understood, rewrite it until it doesn't.
- Only allowed: required non-explanatory annotations (license headers, `// eslint-disable`, `@ts-expect-error`, JSDoc consumed by tooling).

## NestJS conventions

- Injectable services use constructor injection — never property injection.
- Guards are applied at controller level with `@UseGuards(JwtAuthGuard, RolesGuard)`. Never skip auth guards on mutation endpoints.
- DTOs use `class-validator` decorators. Controllers accept `@Body() dto: XDto` — no manual parsing.
- Response shapes: return plain objects or typed response DTOs. Don't return TypeORM entities directly to controllers (they may leak relations or timestamps).
- Errors: throw `BadRequestException`, `NotFoundException`, `ForbiddenException` from NestJS — not generic `Error`.

## TypeORM conventions

- Repositories injected via `@InjectRepository(Entity)` — no custom repository classes needed.
- Use `QueryBuilder` only for complex conditions (JSONB path queries, multi-join aggregates). Simple CRUD uses `repo.find/findOne/save`.
- Soft-delete: `@DeleteDateColumn` + `repo.softDelete()`. Never hard-delete business entities.
- Migrations: generate with `pnpm migration:generate -- src/database/migrations/NNN-Description`. Never edit existing migrations.
- All `timestamptz` columns. Never `timestamp without time zone`.

## Architecture

Any backend change that touches architecture — module boundaries, the transport
task lifecycle, events, dispatch/assignment, the openTCS ACL, or where business
logic lives — MUST be checked against and follow **`ARCHITECTURE.md`** (same folder). That
file is the source of truth for architecture and design patterns; this file only
covers NestJS/TypeORM coding conventions.

## Running locally

```bash
pnpm start:dev          # watch mode
pnpm migration:run      # apply pending migrations
pnpm seed               # seed initial data
pnpm test               # unit tests
pnpm test:e2e           # e2e tests
```

## Environment variables

See `.env` file (not committed). Key vars:
- `OPENTCS_KERNEL_URL` — openTCS kernel base URL (default: `http://localhost:55200`)
- `DATABASE_URL` — PostgreSQL connection string

## Do not

- Add business logic in `AppService` or `AppController` — they are stubs.
- Add new `axios` calls outside `src/opentcs/kernel-api.service.ts`.
- Use `@nestjs/schedule` for new recurring tasks until checking if a domain event is a better trigger.
- Return TypeORM entity objects from controllers — map to DTO first.
