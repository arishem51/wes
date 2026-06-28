# WES Backend — Agent Rules

> Read `../ARCHITECTURE.md` first. This file adds NestJS-specific conventions on top.

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

## Event Bus (Phase 1 target)

After Phase 1 refactor:
- Import `EventEmitter2` from `@nestjs/event-emitter`.
- Inject via constructor: `private readonly eventEmitter: EventEmitter2`.
- Emit: `this.eventEmitter.emit('transport-task.status-changed', new TransportTaskStatusChangedEvent(...))`.
- Listen: `@OnEvent('transport-task.status-changed')` on a service method.
- Event classes defined in `src/cargo/domain/events.ts`.

## State Machine (Phase 2 target)

- `TransportTaskStateMachine.transition(task, newStatus)` is the ONLY way to change `task.status`.
- Call it, then `await this.taskRepo.save(task)`.
- After save, emit the corresponding domain event.

## Current known shortcuts (temporary, remove in respective phase)

- `ASSIGNED_VEHICLE = 'Vehicle-0001'` in `assignment-engine.service.ts` → replace in Phase 3.
- `ReleaseEngineService` releases ALL CREATED tasks without dependency check → add in Phase 4.
- `KernelEventListenerService` is in `src/cargo/` but belongs in `src/opentcs/` → move in Phase 1.
- Direct method call `EventProcessorService.onPickUpToFinished()` → replace with event emit in Phase 1.

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
