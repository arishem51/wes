# PLAN — Phân quyền (RBAC động) + role Viewer + token vĩnh viễn cho `wes-new-client-v2`

Trạng thái: **ĐÃ IMPLEMENT (2026-09-10)** — build xanh cả `wes` (`nest build`) và `wes-new-client-v2` (`tsc -b` + `vite build`); test `wes` 973/975 pass (2 fail có sẵn ở `cargo/dropoff-commit.loop.spec.ts`, không liên quan) + 9 test RBAC mới.
Ngày lập: 2026-09-10.

## Đã làm (tóm tắt so với plan)

**Backend `wes`**
- `src/auth/permission.catalogue.ts` — 25 key / 8 cụm + `SYSTEM_ROLE_GRANTS` (admin=all, operator=giữ nguyên năng lực cũ, viewer=view+download).
- `src/auth/permissions.service.ts` — cache role→perms (`refresh()` khi sửa role), `resolveApiToken(jti)` chặn token đã revoke.
- `src/auth/permission-catalogue.service.ts` — `OnModuleInit` upsert bảng `permissions` + seed grant hệ thống (admin luôn full, operator/viewer chỉ seed khi trống).
- `src/auth/guards/permissions.guard.ts` + `decorators/require-permissions.decorator.ts` — `@RequirePermissions(...)`.
- `jwt.strategy.ts` async: resolve `role`+`perms` vào `req.user`, chặn `jti` đã thu hồi. `jwt-payload.ts` thêm `role/perms/jti`.
- `auth.service.ts` `signPermanent(user, jti)` — JWT **không `exp`** (mẫu `Authenticator.signJwt` FMS-SRC).
- Entities: `permission.entity.ts`, `role-permission.entity.ts`, `api-token.entity.ts`; `role.entity.ts` thêm `key/isSystem/timestamps`, bỏ `RoleName` enum. `users.service.ts` cache role theo `key`, thêm `roleNameOf()`. `user.mapper.ts` `FeRole=string`, DTO thêm `roleName`.
- Guard áp lên: `operating/commands|areas|cargo.controller.ts`, `maps/maps.controller.ts` (thay `@Roles('admin')`), `admin-users.controller.ts` (bỏ `@Roles('admin')` class → `users.view`/`users.manage`). `admin-users.service.ts` thêm chống tự-khoá (không tự đổi vai trò/khoá/xoá mình, không hạ quyền quản trị cuối).
- Module mới `src/admin-rbac/`: `GET /api/permissions/catalogue`, `GET/POST/PATCH/DELETE /api/admin/roles`, `GET/POST /api/admin/users/:id/tokens`, `POST /api/admin/tokens/:jti/revoke`. `RbacService` chặn xoá role hệ thống / role còn user, chặn bỏ hết `roles.manage`/`users.manage`, chặn sửa ma trận role `admin`.
- `/api/account/me` trả thêm `permissions[]`, `roleName`.
- Migration `1804000000000-AddRbacPermissions.ts` + đồng bộ `database/schema.sql` (block idempotent cuối file) + `database/seed.sql` (seed 3 role theo `key`) + `src/database/seed.ts` (gọi `syncCatalogue()`+`seedSystemGrants()`).
- Test mới: `src/auth/permissions.guard.spec.ts`, `src/auth/permission.catalogue.spec.ts` (kể cả test quét mọi `@RequirePermissions` phải khớp catalogue).
- Doc chạy: `wes/database/README.md` + `HUONG-DAN-CHAY-WCS-FMS.md` thêm bước bắt buộc `migration:run`.

**Frontend `wes-new-client-v2`**
- `src/lib/permissions.ts`, `src/hooks/me.ts` (`usePermissions`, `useCan`, `useCanAny`, `useIsAdmin`=`users.manage`, `me` staleTime 5' + refetch on focus), `src/lib/account.ts` (`AccountUser` thêm `permissions/roleName`).
- `src/components/PermissionButton.tsx` — `Button` tự disable + tooltip "không có quyền", layout không đổi.
- `src/api-admin.ts` — client `adminUsersApi` / `rolesApi` / `tokensApi`.
- Gating: `TopActionBar`, `PropertyDrawer` (bỏ footer action nếu rỗng, giữ nguyên phần info), `BottomPanel` (nút hàng + bulk + header), `CommandPalette`, `OrderModal`/`CargoModal`/`CreateAreaPanel` (nút submit), `MapScreen`, `AppShell` (tab Bản đồ theo `map.*`, tab mới "Người dùng" theo `users.view`), `AccountMenu` (hiện `roleName`).
- Màn mới `src/features/admin/`: `AdminScreen` (2 tab) · `UsersTab` (bảng + tạo/sửa/đổi vai trò/reset/khoá/xoá + menu) · `RolesTab` (danh sách role + **ma trận quyền theo cụm**, tạo/xoá role, role `admin` khoá ma trận) · `TokenDialog` (cấp/hiện-1-lần/copy/thu hồi token vĩnh viễn).
- i18n: `src/i18n/{vi,en,ja}.json` thêm namespace `admin.*` + `gate.noPermission` + `shell.tabAdmin` + `common.create/reset/done`.

**Còn treo / lưu ý vận hành**
- Phải chạy `pnpm migration:run` sau `schema.sql` (đã ghi vào 2 doc).
- Token vĩnh viễn chết nếu `JWT_SECRET` xoay vòng (đã ghi §5).
- Vai trò `admin` = superuser cứng: boot luôn re-seed đủ quyền, UI khoá ma trận.
- Chưa viết lại vào SRS/SDS (không có bản mirror `report/specs/` trong repo) — doc này là bản ghi delta tạm.

---

## 1. Mục tiêu (theo yêu cầu)

| # | Yêu cầu | Kết quả mong muốn |
|---|---------|-------------------|
| T1 | Màn phân quyền các account — thêm / sửa / xoá | Màn "Người dùng & Phân quyền" trong `wes-new-client-v2`: quản lý user, gán role, tạo/sửa/xoá **role động** với ma trận quyền theo **cụm** |
| T2 | Trong phần JWT: tự gen hoặc dán 1 chuỗi làm token vĩnh viễn cho khách | Nút **"Cấp token vĩnh viễn"** trên từng user → phát JWT **không có `exp`**, ký bằng `JWT_SECRET` hiện tại, có `jti` để thu hồi. Tham khảo `Authenticator.signJwt(user, ttl<=0)` của FMS-SRC |
| T3 | Màn vận hành **giao diện không đổi**, chỉ mất thao tác theo phân quyền | Viewer thấy y hệt layout: zoom/pan bản đồ, mở chi tiết mọi element, mở mọi tab list — nhưng **mọi nút hành động bị ẩn/disable**. Backend cũng chặn (403) nếu gọi thẳng API |

### Quyết định đã chốt (hỏi user 2026-09-10)

1. **Mức chặn: FE ẩn + BE chặn.** Frontend ẩn/disable theo permission; `wes` backend thêm `PermissionsGuard` trên các endpoint ghi → viewer gọi thẳng API vẫn 403.
2. **Mô hình quyền: động trong DB, chỉnh trên UI.** Bảng `permissions` / `roles` / `role_permissions` trong Postgres; màn phân quyền tạo/sửa/xoá role và tick từng chức năng.
3. **Token vĩnh viễn: nút "Cấp token vĩnh viễn" trên user.** JWT no-exp + `jti`; thu hồi = revoke `jti` (blacklist) hoặc khoá user.

---

## 2. Hiện trạng (khảo sát)

### `wes` backend (NestJS + TypeORM + Postgres)
- JWT: `JWT_SECRET` (mặc định `dev-secret-change-me`), `JWT_ACCESS_TTL` mặc định `1d`. Payload: `{ sub, username, roles: [role] }`.
- Trích token theo thứ tự: `Authorization: Bearer`, cookie `wes_access`, query `?token=` (cho SSE). Refresh token cookie `wes_refresh` + rotation + `user_sessions`.
- DB: `roles(id smallint, name user_role_enum, description)` — enum PG `user_role_enum = ('ADMIN','OPERATOR')`; `user_roles(user_id, role_id)` — **đúng 1 role / user** (enforce ở `UsersService.setRole`).
- `RolesGuard` + `@Roles('admin')` + `ROLES_KEY` metadata. Hiện chỉ 2 vai trò FE: `admin | operator` (`user.mapper.ts` `FeRole`).
- `/api/admin/users/*` (AdminUsersController) đã có CRUD đầy đủ: list / create / update / delete / `PUT :id/role` / lock / unlock / activate / reset-password — **cả class `@Roles('admin')`**.
- `/api/account/*`: `me`, `updateMe`, `change-password`, `sessions/revoke-others`, `preferences`.
- **Endpoint ghi vận hành hiện chỉ có `JwtAuthGuard`** (bất kỳ user đăng nhập nào cũng gọi được), ngoại lệ `POST operating/fleet/:action` + `maps kernel-state` + `maps upload` có `@Roles('admin')`.
- Seed: `src/database/seed.ts` upsert roles `ADMIN`/`OPERATOR`, seed admin `quan.tran`.

### `wes-client` (client cũ) — chỉ dùng làm tham khảo UX
- `src/features/usersAdmin/`: `UsersAdmin.tsx` (bảng + drawer chi tiết), `modals.tsx` (`UserFormModal` / `RolesModal` / `ResetModal` / `LockModal` / `ActivateModal` / `DeleteModal`, có `genPassword()`), `Permissions.tsx` (`PermissionList`).
- `src/data/permissions.ts`: ma trận **tĩnh chỉ để hiển thị** `Record<Role, Record<PermGroup, 'full'|'view'|'none'>>` với các cụm `pg_fleet / pg_map / pg_requests / pg_dispatch / pg_dashboard / pg_users / pg_audit`.
- `src/api/adminUsers.ts` — client cho `/api/admin/users/*`.
- Gating hiện tại: rải rác `user.role === 'admin'` trong `App.tsx` / `AppShell.tsx`.

### `wes-new-client-v2` — nơi triển khai chính
- React 18 + Vite `:5174` + `@tanstack/react-query` + `zustand` + shadcn (`src/components/ui/*`). **Không có router** — `store/app-screen.ts` (`'operating' | 'map'`).
- Auth: `src/lib/auth.ts` (login/logout, token ở `localStorage['wes.accessToken']`), `src/lib/account.ts` (`getMe`), `src/hooks/me.ts` (`useMe`, `useIsAdmin = role === 'admin'`).
- `AppShell.tsx`: tab `map` chỉ hiện khi `isAdmin`. `AccountMenu.tsx` hiển thị nhãn role.
- **Không có màn quản lý user.**
- Các bề mặt hành động cần chặn:
  - `operating/TopActionBar.tsx` — layer toggles, Tạo khu vực, Đồng bộ Kernel, Run all / Stop all.
  - `operating/PropertyDrawer.tsx` — action block cho VEHICLE / POINT / PATH / AREA / CARGO (pause, withdraw, send-to-point, integration level, comm adapter, bring online, lock path, tạo cargo/order tại điểm, sửa/xoá area, xoá cargo).
  - `operating/BottomPanel.tsx` — `IconAct` mỗi hàng + `headerAction` (Tạo order/area) + `BulkBar` (bulk connect/disconnect/pause/withdraw/delete).
  - `components/CommandPalette.tsx` — item "tạo order", "tạo area", "run/stop fleet".
  - `operating/OrderModal.tsx` / `CargoModal.tsx` / `CreateAreaPanel.tsx` — nút submit.
  - `maps/MapScreen.tsx` — đổi MODELLING/OPERATING, upload plant model, download XML.
- `src/api.ts` — `request()` helper (Bearer + `credentials:'include'` + xử lý 401). Các hàm ghi: `fleetCommand`, `createTransportOrder`, `setVehicleIntegrationLevel`, `setVehiclePaused`, `setVehicleCommAdapter`, `withdrawVehicle`, `setPathLocked`, `withdrawOrder`, `sendVehicleToPoint`, `syncKernelAreas`, `createArea`, `updateArea`, `replaceAreaMembers`, `removeArea`, `createCargo`, `cancelCargo`, `redirectCargo`.
- i18n: `src/i18n/{vi,en,ja}.json` phẳng theo namespace (`common, shell, topbar, statusbar, state, inspector, dock, dialog, map, auth, account`), lookup `a.b.c`, fallback về `vi`.

### `FMS-SRC` — tham khảo cho T2 + mô hình quyền
- `aubot-control-gateway/.../security/`:
  - `Permission.java` — enum quyền chi tiết chia **Group A (đọc)** / **Group B (điều khiển thường)** / route+cargo / model-edit / **Group C (nguy hiểm)**.
  - `Role.java` — enum `VIEWER / OPERATOR / SUPERVISOR / ADMIN`, mỗi role = `Set<Permission>`; `ADMIN = EnumSet.allOf`.
  - `GatewayPrincipal.can(Permission)`; JWT HS256, `sub` = user id, claim `role` (tên claim cấu hình được), `defaultRole` fallback.
- `openTCS-...-HTTP-Services/.../Authenticator.java` — **`signJwt(user, ttlMillis)`**: `.setExpiration(ttlMillis > 0 ? exp : null)` → **`ttl <= 0` ⇒ không set `exp` ⇒ token vĩnh viễn**. Đây là khuôn mẫu cho T2.

---

## 3. Thiết kế

### 3.1. Catalogue quyền (danh sách chức năng — cố định trong code)

Danh sách **key quyền** cố định trong code (`wes/src/auth/permission.catalogue.ts`) vì mỗi key phải khớp một nhánh code được guard. Việc **gán key nào cho role nào** nằm trong DB, sửa trên UI. Trên mỗi lần boot, backend **upsert** các dòng `permissions` từ catalogue (giống `seedRoles` hiện tại) → thêm quyền mới = 1 lần deploy, không SQL tay.

| Cụm (`cluster`) | Key | Nguy hiểm | Bề mặt FE | Endpoint BE |
|---|---|---|---|---|
| `view` | `map.view` | | Bản đồ, zoom, chọn element, PropertyDrawer (phần info) | (GET plant-model) |
| `view` | `list.view` | | Các tab BottomPanel (vehicles/orders/areas/cargos/alarms) | (GET *) |
| `vehicle` | `vehicle.pause` | | Pause/Resume (drawer + dock + bulk) | `PUT operating/vehicles/:name/paused` |
| `vehicle` | `vehicle.integration_level` | | Select integration level | `PUT operating/vehicles/:name/integration-level` |
| `vehicle` | `vehicle.comm_adapter` | | Connect/Disconnect, Bring online | `PUT operating/vehicles/:name/comm-adapter` |
| `vehicle` | `vehicle.send_to_point` | | "Giao tới điểm" | `POST operating/vehicles/:name/send-to-point` |
| `vehicle` | `vehicle.withdraw` | | Rút order khỏi xe | `POST operating/vehicles/:name/withdraw` |
| `order` | `order.create` | | OrderModal, "tạo order tại điểm" | `POST operating/orders` |
| `order` | `order.withdraw` | | Rút/huỷ order (dock + bulk) | `POST operating/orders/:name/withdraw`, `POST maps/kernel/transport-orders/:name/withdraw` |
| `cargo` | `cargo.create` | | CargoModal, "tạo cargo tại điểm" | `POST operating/cargo` |
| `cargo` | `cargo.cancel` | | Xoá cargo (drawer + dock + bulk) | `DELETE operating/cargo/:id` |
| `cargo` | `cargo.redirect` | | Đổi kho đích | `POST operating/cargo/:id/redirect` *(nếu có)* |
| `area` | `area.create` | | "Tạo khu vực" | `POST operating/areas` |
| `area` | `area.edit` | | Sửa area / members | `PATCH operating/areas/:wesId`, `PUT operating/areas/:wesId/members` |
| `area` | `area.delete` | ⚠ | Xoá area (drawer + dock + bulk) | `DELETE operating/areas/:wesId` |
| `area` | `area.sync_kernel` | | "Đồng bộ Kernel" | `POST operating/areas/sync` |
| `fleet` | `fleet.control` | ⚠ | Run all / Stop all | `POST operating/fleet/:action` |
| `fleet` | `path.lock` | ⚠ | Khoá/mở path | `PUT operating/paths/:name/lock` |
| `map` | `map.download` | | Tải plant model XML | `GET maps/plant-model.xml` |
| `map` | `map.kernel_mode` | ⚠ | Đổi MODELLING/OPERATING | `POST maps/kernel-state` |
| `map` | `map.upload` | ⚠ | Nạp plant model | `POST maps/upload` |
| `admin` | `users.view` | | Thấy tab "Người dùng & Phân quyền", danh sách user/role | `GET admin/users`, `GET admin/roles` |
| `admin` | `users.manage` | ⚠ | Tạo/sửa/xoá user, gán role, lock, reset pass | `POST/PATCH/DELETE admin/users/*` |
| `admin` | `roles.manage` | ⚠ | Tạo/sửa/xoá role + ma trận quyền | `POST/PATCH/DELETE admin/roles/*` |
| `admin` | `tokens.manage` | ⚠ | Cấp/thu hồi token vĩnh viễn | `admin/users/:id/tokens/*` |

`map.view` + `list.view` là **quyền đọc, mặc định mọi role đều có** (kể cả viewer). Guard chỉ áp cho endpoint ghi; GET giữ `JwtAuthGuard`.

### 3.2. Seed 3 role hệ thống (`is_system = true`, không xoá được)

| Role | Key | Quyền |
|---|---|---|
| Quản trị viên | `admin` | **tất cả** |
| Điều hành viên | `operator` | `view`, toàn bộ `vehicle`, `order`, `cargo`, `area.create/edit/sync_kernel`, `path.lock`, `map.download` (giữ nguyên năng lực hiện tại; **không** `area.delete`, `fleet.control`, `map.kernel_mode/upload`, `admin.*` — có thể chỉnh sau) |
| Người xem | `viewer` | chỉ `map.view`, `list.view`, `map.download` |

Admin có thể tạo thêm role tuỳ ý (vd "Trưởng ca" = operator + `fleet.control` + `area.delete`).

### 3.3. Schema DB — 1 migration mới trong `wes`

```
-- 1) permissions: danh mục, seed từ code mỗi lần boot, user KHÔNG sửa
CREATE TABLE permissions (
  key           varchar(64) PRIMARY KEY,
  cluster       varchar(32) NOT NULL,
  is_dangerous  boolean NOT NULL DEFAULT false,
  sort          int NOT NULL DEFAULT 0,
  label_vi      varchar(128), label_en varchar(128), label_ja varchar(128)
);

-- 2) roles: bỏ phụ thuộc enum, thêm key + is_system
ALTER TABLE roles ADD COLUMN key varchar(48);
ALTER TABLE roles ADD COLUMN is_system boolean NOT NULL DEFAULT false;
ALTER TABLE roles ALTER COLUMN name TYPE varchar(64) USING name::text;   -- rời enum user_role_enum
UPDATE roles SET key = lower(name), is_system = true;
UPDATE roles SET name = 'Quản trị viên' WHERE key = 'admin';
UPDATE roles SET name = 'Điều hành viên' WHERE key = 'operator';
ALTER TABLE roles ALTER COLUMN key SET NOT NULL;
CREATE UNIQUE INDEX roles_key_uq ON roles(key);
-- giữ lại TYPE user_role_enum (không drop) để tránh vỡ dump cũ; không còn cột nào dùng

-- 3) role_permissions
CREATE TABLE role_permissions (
  role_id        smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key varchar(64) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- 4) api_tokens: token vĩnh viễn (T2)
CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti          uuid NOT NULL UNIQUE,
  label        varchar(120),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id);
```

Data migration: insert role `viewer`; insert toàn bộ `permissions`; nạp `role_permissions` cho admin/operator/viewer theo §3.2.
Đồng bộ `database/schema.sql` + `src/database/seed.ts` (seed `permissions` + grants idempotent).

> **Rủi ro migration**: `roles.name` đang `NOT NULL` enum. `grep` cho thấy `user_role_enum` chỉ được cột `roles.name` dùng → đổi type an toàn. Chạy trên scratch DB trước, regenerate `schema.sql`.

### 3.4. Backend `wes` — thành phần mới trong `src/auth/`

| File | Vai trò |
|---|---|
| `permission.catalogue.ts` | Mảng `{ key, cluster, dangerous, sort, labels }` — nguồn sự thật duy nhất |
| `permissions.service.ts` | `getRolePermissions(roleKey): Set<string>` cache in-memory; `getEffectivePermissions(userId)`; `refresh()` gọi khi role/role_permissions đổi; `isRevoked(jti)` (Set các jti đã revoke, cache) |
| `permissions.guard.ts` | Đọc metadata `@RequirePermissions(...)`; 403 nếu `req.user.perms` thiếu; role có đủ tất cả (admin) pass hết |
| `require-permissions.decorator.ts` | `RequirePermissions(...keys)` → `SetMetadata` |
| sửa `jwt.strategy.ts` | `validate()` async: resolve `role` (key) + `perms` (từ `PermissionsService`) gắn vào `req.user`; nếu `payload.jti` → chặn nếu `isRevoked` hoặc row `api_tokens` không tồn tại; cập nhật `last_used_at` (throttle) |
| sửa `auth.service.ts` | `signAccess`: payload `{ sub, username, role: <key>, roles: [<key>] }` (giữ `roles` cho tương thích); **`signPermanent(userId, label, actorId)`**: `jwt.sign(payload, {})` **không `expiresIn`**, payload có `jti` (uuid), lưu `api_tokens` |
| sửa `jwt-payload.ts` | Thêm `role: string`, `jti?: string`, `perms?: string[]` |

Guard resolve quyền **theo request** từ cache role→perms (không hit DB mỗi request sau khi cache ấm) → admin sửa ma trận **có hiệu lực ngay** cho request kế tiếp; không cần token mới. `RolesGuard` cũ giữ lại nhưng các endpoint chuyển sang `PermissionsGuard`.

### 3.5. Backend — áp guard lên endpoint ghi

`@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('<key>')` cho từng handler theo bảng §3.1:
- `operating/commands.controller.ts` — 9 handler (thay `@Roles('admin')` ở `fleet/:action` bằng `@RequirePermissions('fleet.control')`).
- `operating/areas.controller.ts` — sync / create / patch / members / delete.
- `operating/cargo.controller.ts` — create / delete (+ redirect nếu có).
- `maps/maps.controller.ts` — `kernel-state` → `map.kernel_mode`, `upload` → `map.upload`, `plant-model.xml` (GET) → `map.download`, withdraw → `order.withdraw`.
- `admin-users.controller.ts` — bỏ `@Roles('admin')` ở class; `GET` → `users.view`, còn lại → `users.manage`.
- GET vận hành khác: giữ `JwtAuthGuard`.

### 3.6. Backend — endpoint mới

- `GET /api/account/me` (mở rộng) → thêm `role: { key, name }`, `permissions: string[]`.
- `GET /api/permissions/catalogue` (`users.view`) → catalogue + nhãn 3 ngôn ngữ + cờ `is_dangerous`, gom theo `cluster` (cho UI ma trận).
- `admin/roles.controller.ts` (`roles.manage`; `GET` cho `users.view`):
  - `GET /api/admin/roles` → `[{ id, key, name, description, isSystem, userCount, permissions: string[] }]`
  - `POST /api/admin/roles` → `{ key, name, description, permissions[] }` (key slug, unique)
  - `PATCH /api/admin/roles/:id` → sửa `name` / `description` / thay toàn bộ `permissions[]`. Chặn sửa `key`; chặn bỏ `roles.manage`+`users.manage` khỏi role cuối cùng còn giữ (chống tự khoá).
  - `DELETE /api/admin/roles/:id` → chỉ khi `is_system=false` **và** `userCount=0`.
  - Mọi mutation → `PermissionsService.refresh()`.
- `admin/tokens.controller.ts` (`tokens.manage`):
  - `GET /api/admin/users/:id/tokens` → `[{ id, jti, label, createdAt, lastUsedAt, revokedAt }]`
  - `POST /api/admin/users/:id/tokens` → `{ label }` → **trả `{ token }` một lần**; lưu row.
  - `POST /api/admin/tokens/:jti/revoke` → set `revoked_at` + refresh blacklist.
- `admin-users` DTO: `role` → `roleKey: string`, validate theo danh sách role key thực tế (bỏ `IsIn(['admin','operator'])` tĩnh).
- `user.mapper.ts`: `FeRole` → `string` (role key); `feRoleOf` trả key; bỏ `roleToDb/roleToFe` (uppercase). `AdminUserDto.role` → `{ key, name }`.

### 3.7. Frontend `wes-new-client-v2`

**a) Ngữ cảnh quyền**
- `src/lib/permissions.ts` — kiểu `PermKey = string`; helper gom cụm cho màn admin (lấy từ catalogue endpoint).
- `src/hooks/me.ts` — `useMe()` trả thêm `permissions`. Thêm:
  - `usePermissions(): Set<string>`
  - `useCan(key): boolean`
  - `useIsAdmin()` = `useCan('users.manage')` (thay cho `role === 'admin'`).
  - `me` query: bỏ `staleTime: Infinity` → `5 phút` + `refetchOnWindowFocus` (để chỉnh role thấm nhanh).
- `src/components/PermissionButton.tsx` — bọc `Button`: khi thiếu quyền → `disabled` + `SimpleTooltip` "Bạn không có quyền". Dùng cho các nút hay lặp; chỗ khác dùng `useCan` inline (đúng phong cách codebase).

**b) Chặn màn vận hành (T3 — layout giữ nguyên, chỉ mất thao tác)**
Nguyên tắc: **render y hệt, disable/ẩn phần tương tác.** Ưu tiên `disabled`+tooltip cho nút đơn lẻ; **ẩn** với nút phá huỷ/hiếm và với cả block action nếu rỗng.

| File | Xử lý |
|---|---|
| `TopActionBar.tsx` | Layer toggles: **giữ enabled** (chỉ đổi hiển thị). "Tạo khu vực" `area.create`, "Đồng bộ Kernel" `area.sync_kernel`, "Run all"/"Stop all" `fleet.control` → `disabled`+tooltip khi thiếu |
| `PropertyDrawer.tsx` | Bọc từng nút trong `actions:` theo key. Nếu 1 loại element không còn action nào được phép → **bỏ hẳn footer `actions`** (vẫn hiện đủ `sections` info — đúng nhu cầu "xem chi tiết element" của viewer) |
| `BottomPanel.tsx` | `IconAct` mỗi hàng: truyền `disabled` khi thiếu quyền; `headerAction` (Tạo order/area) gate; `BulkBar` chỉ hiện action được phép, ẩn cả thanh nếu rỗng. Checkbox chọn hàng giữ nguyên (vô hại) |
| `CommandPalette.tsx` | Lọc `CommandItem` hành động theo quyền; giữ item điều hướng/tìm kiếm |
| `OrderModal / CargoModal / CreateAreaPanel` | Gate nút submit + guard thủ khi mở không quyền (phòng thủ) |
| `MapScreen.tsx` | Nút đổi mode `map.kernel_mode`, upload `map.upload`, download `map.download` |
| `AppShell.tsx` | Tab "Bản đồ": hiện khi `useCan('map.kernel_mode') || useCan('map.upload')`. Thêm tab "Người dùng & Phân quyền" khi `useCan('users.view')` |
| Rà `useIsAdmin` | AppShell (map tab), `AccountMenu` (nhãn role) → chuyển `useCan` / `role.key` |

Kiểm chứng: chụp màn hình viewer vs admin — layout không đổi, chỉ khác các nút.

**c) Màn mới "Người dùng & Phân quyền" (T1)**
- `store/app-screen.ts` — thêm `'admin'`.
- `src/features/admin/`:
  - `AdminScreen.tsx` — 2 sub-tab (radix `Tabs`): **Người dùng** / **Vai trò & Quyền**.
  - **Người dùng** — port từ `wes-client/src/features/usersAdmin` nhưng dựng lại bằng primitive shadcn của v2 (`Dialog`, `Select`, `Input`, `Button`, `Checkbox`, `sonner`). Bảng: user · role (pill) · trạng thái · hoạt động gần nhất · actions. Actions: xem / sửa / đổi role / reset mật khẩu / khoá-mở / xoá / **Cấp token vĩnh viễn**. Có `genPassword()` như bản cũ.
  - **Vai trò & Quyền** — danh sách role (tên, số user, badge "hệ thống"). "+ Vai trò". Chọn role → **ma trận quyền theo cụm**: mỗi cụm là 1 section, mỗi quyền 1 `Checkbox` có nhãn; quyền nguy hiểm đánh dấu đỏ. Lưu = `PATCH /admin/roles/:id`. Xoá role (disable với role hệ thống / role còn user).
  - `TokenDialog.tsx` — nhập `label` → `POST /admin/users/:id/tokens` → hiện JWT trong ô mono readonly + nút Copy + cảnh báo "Chỉ hiển thị một lần". Dưới: danh sách token hiện có + nút Thu hồi.
  - `src/api-admin.ts` — theo mẫu `request()` của `api.ts`: `listAdminUsers/createUser/updateUser/setUserRole/lock/unlock/activate/resetPassword/removeUser`, `listRoles/createRole/updateRole/deleteRole`, `fetchPermissionCatalogue`, `listUserTokens/issueUserToken/revokeToken`.
- react-query keys: `['admin','users']`, `['admin','roles']`, `['admin','catalogue']`, `['admin','tokens',userId]`.

**d) i18n** — thêm namespace `admin.*`, `gate.noPermission` vào `vi/en/ja.json`. **Nhãn quyền + cụm lấy từ catalogue endpoint** (BE đã có `label_vi/en/ja`) — không nhân đôi vào i18n FE.

### 3.8. `wes-client` (client cũ)
Ngoài phạm vi sửa — chỉ dùng làm tham chiếu UX. Nếu muốn parity → follow-up riêng.

---

## 4. Thứ tự thực hiện

| Phase | Nội dung | Kiểm thử |
|---|---|---|
| **0. Catalogue & schema** | `permission.catalogue.ts`; migration (`permissions`, `roles.name`→varchar + `key`/`is_system`, `role_permissions`, `api_tokens`); seed viewer + grants; upsert `permissions` khi boot; đồng bộ `schema.sql` + `seed.ts` | `pnpm migration:run` sạch trên DB scratch; seed idempotent chạy 2 lần OK |
| **1. BE enforcement** | `PermissionsService` + guard + decorator + `@RequirePermissions` mọi endpoint ghi; `signAccess` dùng role key; `/account/me` trả `permissions` | Unit: viewer→403 khi ghi, operator→200, admin→200; sửa `role_permissions`→`refresh()`→request kế đổi kết quả |
| **2. Roles & tokens API** | `admin/roles` CRUD + chống tự khoá; `admin/tokens` + `signPermanent` (no `exp`, `jti`, blacklist) | token no-exp xác thực OK; revoke `jti`→401; token bám role hiện tại của user (đổi role user → quyền token đổi theo) |
| **3. FE gating** | `useCan`; gate mọi bề mặt hành động (operating + MapScreen + CommandPalette + modal); rà `useIsAdmin` | Đăng nhập viewer `:5174`: pan/zoom OK, mở chi tiết mọi element OK, mở mọi tab list OK, **không nút hành động nào chạy**; layout giống admin |
| **4. FE màn admin** | Tab Người dùng (port) + tab Vai trò & Quyền (ma trận) + `TokenDialog` + i18n vi/en/ja + tab ở shell | Tạo role "Trưởng ca", tick quyền, gán cho user → user đó thấy đúng nút; cấp + copy + revoke token |
| **5. Verify tổng** | Chạy `wes` + `:5174`; kịch bản viewer/operator/admin đầy đủ; `build` xanh 2 repo | Ảnh so sánh viewer vs admin; `pnpm build` (wes) + `npm run build` (v2) xanh |

---

## 5. Rủi ro & lưu ý

- **Migration enum→varchar** `roles.name`: chạy scratch DB trước; regenerate `schema.sql`; giữ `user_role_enum` (không drop).
- **Chống tự khoá**: không cho role cuối còn `roles.manage`+`users.manage` mất quyền đó; không xoá user admin cuối cùng. Enforce ở server.
- **Token vĩnh viễn = bí mật bearer**: nếu `JWT_SECRET` xoay vòng → mọi token vĩnh viễn chết (chấp nhận, ghi tài liệu). Chỉ lưu `jti` phía server, **không lưu token**, hiện 1 lần.
- **Token bám role động**: guard resolve role→perms theo request ⇒ hạ cấp role của user hoặc sửa ma trận sẽ **tự động** thu hẹp token. Đây là hành vi mong muốn.
- **SSE/stream**: viewer cần stream đọc (`?token=` đã hỗ trợ ở BE); token vĩnh viễn dùng được ở đây. Xác nhận builder URL `EventSource` dùng token đã lưu.
- **Độ trễ hiệu lực**: user đang đăng nhập của role vừa bị sửa chỉ thấy quyền mới sau khi `/account/me` refetch (đã đổi `staleTime` 5' + refetch on focus) hoặc lần đăng nhập kế. BE thì hiệu lực ngay.
- **`wes-new-client` (v1, không -v2)**: bản sao trung gian — không đụng.

---

## 6. Ước lượng

| Phase | Ước lượng |
|---|---|
| 0 — catalogue & schema | ~0.5 ngày |
| 1 — BE enforcement | ~1 ngày |
| 2 — roles & tokens API | ~1 ngày |
| 3 — FE gating | ~1 ngày |
| 4 — FE màn admin | ~1.5–2 ngày |
| 5 — verify | ~0.5 ngày |
| **Tổng** | **~5.5–6.5 ngày** |

## 7. Follow-up từ audit 2026-09-12 (F03–F06)

Đã sửa (2026-09-12): `/cargo`, `/zones` thiếu `PermissionsGuard` (F03); JWT/token vĩnh viễn lấy role đã lưu trong payload thay vì DB — `JwtStrategy` giờ luôn đọc `roleKey` sống từ `authStateOf` (F04 + token vĩnh viễn); endpoint demo `POST /transport-order` không guard + nginx proxy thẳng kernel không qua WES đã bị xoá (F05); session giờ có `sid` trong JWT, `logout` chỉ đóng đúng phiên gọi (không còn đóng hết mọi máy), `revoke-others` loại đúng phiên hiện tại thay vì "giữ phiên login mới nhất", `changePassword` revoke refresh token, rotate/consume refresh & reset token đổi sang UPDATE có điều kiện (atomic), heartbeat SSE (`vehicles/cargo/areas`) tái kiểm session/account mỗi 15s, rate-limit 5 lần/phút cho `login`/`forgot-password`, cookie `secure` theo `NODE_ENV`/`COOKIE_SECURE` (F06).

Hai điểm audit nêu nhưng **không sửa code**, ghi lại để không tái điều tra:

- **`/agvs` dùng `RolesGuard`+`@Roles('admin')` riêng, tách khỏi ma trận permission** — đây là lớp phân quyền song song có chủ đích (admin-only theo role, không theo permission key), không phải thiếu sót. Chỉ cần tài liệu hoá rõ khi rà lại RBAC, không cần hợp nhất vào `PermissionsGuard`.
- **`PermissionsService` cache role→permission theo từng process, `refresh()` chỉ xoá cache của instance nhận thao tác.** Với triển khai hiện tại (`deploy/docker-compose.prod.yml` chạy 1 instance `wes`) không phải vấn đề. **Trước khi scale `wes` ra nhiều replica**, cần thêm TTL ngắn hoặc cơ chế invalidate dùng chung (pub/sub qua DB LISTEN/NOTIFY hoặc Redis) cho cache này, nếu không một sửa đổi ma trận quyền có thể không có hiệu lực ngay trên các replica khác.
