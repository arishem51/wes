# WES Backend — Agent Rules

> Read `ARCHITECTURE.md` (same folder) first. This file adds NestJS-specific conventions on top.

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
