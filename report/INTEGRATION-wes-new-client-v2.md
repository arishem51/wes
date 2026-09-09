# Tích hợp `wes-new-client-v2` vào backend `wes`

> Trạng thái: **PLAN — đã chốt quyết định, chưa implement.**
> Nguồn: đánh giá 4 codebase `WCS-FMS/{wes, wes-client, wes-new, wes-new-client}` (2026-09-09).
> Repo áp dụng: `wes` (nhánh `feature/aubot`) cho backend; folder mới `WCS-FMS/wes-new-client-v2` (repo riêng) cho frontend.

---

## 1. Nguyên tắc

**Chỉ thay lớp tương tác (UI/UX).** `wes-new-client-v2` = bản sao `wes-new-client`, giữ nguyên UI/UX,
đổi lớp API để cắm vào `wes`. Toàn bộ **logic vận hành giữ nguyên như `wes`**: zone/store, tạo hàng,
dispatch, gán order cho xe, state machine, Hungarian, saga, slot reservation, parking/charge engine.

`wes-new` (backend) và `wes-new-client` (gốc) **không chạy nữa** — giữ trên nhánh `newWes` làm tham chiếu.
Không port "bộ não" cargo của `wes-new` (deferred-pickup, `evaluatePickup`, `stop-charging`,
`dispensable-order-watchdog`, CommitGuard/MQTT). Không dựng DB `wes_new`.

`wes` chỉ **thêm 1 module ACL mỏng** `src/operating/` = proxy đọc/ghi kernel cho màn điều hành, cộng vài
bổ sung nhỏ (cookie auth, CORS, method trong `KernelApiService`, adapter Zone↔Area, SSE cargo).

---

## 2. Kiến trúc đích

```
wes-new-client-v2  (Vite/React/shadcn/Tailwind — folder & repo riêng, sibling các client khác)
  • src/api/*  : axios → /api (JWT bearer + cookie), thay hoàn toàn src/api.ts (fetch :3101)
  • màn login/security riêng (shadcn) — dùng /api/auth + /api/account của wes
  • CHỈ có màn Điều hành + auth/account. Các màn của wes-client (dashboard, users, fleet, cargo MUI) KHÔNG convert.
        │  HTTP /api/*  +  SSE  (qua Vite dev proxy → same-origin)
        ▼
wes  (NestJS :3000, prefix /api, JWT) — GIỮ NGUYÊN DOMAIN
  ├─ auth/ account/ cargo/ zones/ maps/ agvs/ opentcs/ dashboard/  → logic không đổi
  ├─ auth: + set cookie `wes_access`, + cookie extractor trong JwtStrategy   (§5)
  ├─ main.ts: CORS nhận danh sách origin (thêm origin v2)                    (§5)
  ├─ opentcs/KernelApiService: + setVehiclePaused, + setPathLocked,
  │     + createManualTransportOrder (intendedVehicle optional),
  │     + getTransportOrdersRaw / getTransportOrderRaw                        (§6)
  └─ NEW  src/operating/  — ACL passthrough, mọi route /api/operating/*, @UseGuards(JwtAuthGuard)
        plant-model.controller   GET  points | paths | location-types        (chiếu getPlantModelView)
        vehicles.controller      GET  vehicles | vehicles/stream(SSE)        (VehicleStateStore + /api/maps/kernel/sse)
        orders.controller        GET  orders | orders/:name  ·  POST orders  ·  POST orders/:name/withdraw
        commands.controller      PUT  vehicles/:n/integration-level|paused|comm-adapter
                                 POST vehicles/:n/withdraw|send-to-point  ·  PUT paths/:n/lock
        fleet.controller         POST fleet/run-all | fleet/stop-all
        areas.controller         CRUD  → adapter sang ZoneService            (§7)
        cargo.controller         GET cargo | cargo/stream(SSE) · POST · DELETE  → CargoService (§8)
        health.controller        GET  operating/health                       (map từ /api/maps/kernel-status)
        │  REST + SSE (/v1/sse?/events/transportOrders=true&/events/vehicles=true — đã có sẵn)
        ▼
opentcs kernel :55200   (không đổi; parkIdleVehicles vẫn OFF)
```

---

## 3. Quyết định đã chốt (từ trao đổi 2026-09-09)

| # | Quyết định |
|---|---|
| 5.1 | v2 là **app độc lập**, folder mới `WCS-FMS/wes-new-client-v2` (repo riêng, bằng cấp các client khác), seed từ HEAD hiện tại của `wes-new-client`. |
| 5.2 | v2 có **màn login riêng** (shadcn, thiết kế theo style `wes-new-client`), dùng `/api/auth` + `/api/account` của `wes`. Port cả các màn **security** của `wes-client` (login, quên/đặt lại mật khẩu, đổi mật khẩu, đăng xuất phiên khác, hồ sơ) sang shadcn. Token: `localStorage['wes.accessToken']` + `wes-auth='1'` (giống `wes-client`). |
| 5.3 | Auth cho SSE = **đọc cookie**. `wes` set thêm cookie `wes_access` khi login/refresh; `JwtStrategy` thêm cookie extractor. `EventSource` chạy same-origin qua Vite proxy. (`?token=` query param đã được `JwtStrategy` hỗ trợ sẵn — fallback.) |
| 5.4 | **Giữ nguyên OrderModal (tạo transport order thủ công).** Order đi qua `wes` → xuống kernel/FMS, **`intendedVehicle` để trống → kernel tự gán xe, tự dispatch** (bypass Hungarian của `wes` một cách có chủ đích). |
| 5.5 | Concept `wes`: tạo **khu vực** với type = *khu vực lấy hàng* (↔ ZONE / `ZoneType.PICKUP`) hoặc *khu vực trả hàng* (↔ STORE / `ZoneType.DROPOFF`). Các trường `wes` **không có** (`wesId`, `operation`, `maxVehicles`) → tạm để trong form dưới dạng **text hiển thị, bỏ trống, không tác động logic**. Không thêm cột DB. `Area.wesId` trong response = `zone.id` (uuid). |
| 5.7 | Trạng thái cargo: UI v2 thiếu state nào (`BLOCKED`, `READY_TO_ASSIGN`…) thì **thêm badge vào UI v2**. Xem bảng §9.2. |
| 5.8 | **Thêm SSE cho cargo vào `wes`** (`GET /api/operating/cargo/stream`) — tap domain event `transport-task.*` → tick, client refetch. |
| 5.9 | Sửa khu vực khi kernel OPERATING: **theo luồng `wes-new` = xoá đi tạo lại**; đổi map = đẩy plant model mới lên (`POST /api/maps/upload`). v2 không cần in-place member edit. |
| 5.10 | Các màn khác của `wes-client` (dashboard, users, AGV fleet, cargo MUI, map konva): **tạm bỏ qua**, không convert sang v2. |
| 5.11 | v2 = folder mới `WCS-FMS/wes-new-client-v2`, repo git riêng, seed từ `wes-new-client` hiện tại. |

---

## 4. CONFIG — inventory đầy đủ & reconciliation

### 4.1 `wes` backend (`wes/.env`) — GIỮ, có bổ sung nhỏ

| Key | Giá trị hiện tại | Hành động |
|---|---|---|
| `PORT` | 3000 | giữ |
| `WEB_ORIGIN` | `http://localhost:5173` (CORS 1 origin, `credentials:true`) | **đổi `main.ts` → nhận danh sách** `WEB_ORIGIN` phẩy-phân-tách; thêm origin v2 (`http://localhost:5174` dev; domain thật khi deploy) |
| `DATABASE_URL` / `PG*` (`wes`) | postgres 5432 db `wes` | giữ — v2 & module `operating` dùng chung DB `wes`, **không tạo `wes_new`** |
| `JWT_SECRET` | `change-me-in-production` | giữ; v2 xác thực qua đây |
| `JWT_ACCESS_TTL` | `1d` | giữ; = maxAge cookie `wes_access` mới |
| `REFRESH_TTL_DAYS` | `7` | giữ (cookie `wes_refresh` path `/api/auth` đã có) |
| `RESET_TTL_MINUTES` | `30` | giữ (màn reset password của v2) |
| `APP_URL` | `http://localhost:5173` | link trong email reset — **cân nhắc** trỏ về v2 nếu v2 là console chính |
| `SMTP_*`, `MAIL_FROM` | Gmail | giữ (forgot-password của v2 gửi mail qua đây) |
| `OPENTCS_KERNEL_URL` | `http://localhost:55200` | giữ — **trùng `wes-new`**, không xung đột |
| `OPENTCS_MAP_AUTO_LOAD` / `OPENTCS_MAP_PATH` | `false` / `maps/v7-vda5050.xml` | giữ |
| `DISPATCH_MATCHER` | `hungarian` | giữ (logic dispatch `wes`) |
| `DISPATCH_SWAP` / `_BASE_MM` / `_STEP_MM` / `_MAX` | `on` / 2000 / 2000 / 2 | giữ |
| `VEHICLE_TYPE` | `vda5050` (→ `liftUp`/`liftDown`) \| `loopback` (→ `PICK_UP`/`DROP_OFF`) | giữ — ⚠️ v2 OrderModal phải **lấy operation động** từ `location-types`, không hardcode |
| `DISPATCH_HEARTBEAT_MS` | 5000 (mặc định) | giữ |
| `SSE_STALL_TIMEOUT_MS` | 60000 (mặc định) | giữ |

`wes/src/app.module.ts` đọc `.env` repo-local với `skipProcessEnv:true` khi file tồn tại — giữ.
`main.ts` prefix `/api` (exclude `/`, `transport-order`) — mọi route mới nằm dưới `/api/operating/*`.
`ValidationPipe`: `whitelist:true`, `forbidNonWhitelisted:false`, `transform:true` — field thừa từ payload v2
(`pickupAreaWesId`, `maxVehicles`…) sẽ **bị bỏ qua âm thầm** (không lỗi).

### 4.2 `wes-new` backend (`wes-new/.env`) — BỎ hết

| Key | Số phận |
|---|---|
| `PORT=3101` | bỏ (backend không chạy) |
| `OPENTCS_KERNEL_URL` | trùng `wes` → bỏ |
| `PG*` → `wes_new` | bỏ — không port bảng `area`/`area_member`/`cargo`(new)/migration `1757xxx` |
| `MQTT_URL=mqtt://127.0.0.1:1883` (topic `uagv/+/+/+/state`) | bỏ — CommitGuard/MQTT là của bộ não cargo `wes-new`; `wes` đọc trạng thái xe qua kernel SSE. *Nếu sau này `wes` cần MQTT → việc riêng.* |
| `enableCors()` mở toang, không auth, không prefix, `forbidNonWhitelisted:true` | thay bằng policy của `wes` |

### 4.3 Frontend

| | `wes-client` | `wes-new-client` (gốc) | `wes-new-client-v2` (đích) |
|---|---|---|---|
| Base API | `VITE_API_BASE_URL=/api` (proxy→:3000) | `VITE_WES_NEW_URL=http://127.0.0.1:3101` | **`VITE_API_BASE_URL=/api`** — đổi toàn bộ `src/api.ts` sang axios + JWT |
| Dev port | 5173 | 5174 | **5174** (giữ) |
| Vite proxy | `/api`→:3000, `/opentcs-v1`→:55200/v1 | (không) | **thêm** `/api`→:3000 (`changeOrigin:true`; SSE: tắt buffering) |
| Auth | interceptor gắn `Bearer localStorage['wes.accessToken']` | không gửi gì | **dùng lại cơ chế + key `wes.accessToken` / `wes-auth`** của `wes-client` |
| Style | MUI 6 + Emotion | Tailwind v4 + shadcn | **giữ Tailwind/shadcn** (app độc lập → hết xung đột MUI) |
| Theme | hệ riêng (`--app-bg`…) | `.dark` trên `<html>` (`src/lib/theme.ts`) | giữ nguyên |
| Font | Roboto | Roboto + Roboto Mono (`@fontsource`) | giữ |

### 4.4 Hạ tầng chung — không đổi

- Kernel REST/SSE `:55200` (`servicewebapi.bindPort`). SSE thật: `GET /v1/sse?/events/transportOrders=true&/events/vehicles=true` — **`wes` `KernelEventListenerService` đã nối đúng 2 param này** (đủ cho xe + order).
- MQTT broker `:1883` — chỉ `wes-new` dùng; `wes` không.
- `opentcs-kernel.properties` — chứa MQTT creds `fms` / `Aubot@2025` → **KHÔNG commit**.
- kernel `parkIdleVehicles` **OFF** (WES sở hữu parking) — giữ.
- Postgres 1 server, dùng db `wes`.

---

## 5. Backend `wes` — thay đổi ngoài module `operating/`

### 5.1 Cookie access-token (cho SSE)
- `AuthController.login` + `.refresh`: set thêm cookie
  `wes_access` — `httpOnly:true`, `sameSite:'lax'`, `secure:false` (dev), `path:'/api'`, `maxAge` = TTL access (`1d`).
- `AuthController.logout`: `res.clearCookie('wes_access', { path:'/api' })`.
- `JwtStrategy.jwtFromRequest`: thêm vào `ExtractJwt.fromExtractors([...])` một extractor đọc `req.cookies['wes_access']`
  (đứng sau bearer header, trước `?token=`).
- v2 gọi API qua **Vite proxy** (`/api` trên :5174 → :3000) ⇒ cookie same-origin với v2 ⇒ `EventSource('/api/operating/.../stream', { withCredentials:true })` tự gửi cookie. `?token=` giữ làm fallback.

### 5.2 CORS
`main.ts` `app.enableCors({ origin: (WEB_ORIGIN ?? 'http://localhost:5173').split(','), credentials:true })`.
Thêm `http://localhost:5174` vào `.env` `WEB_ORIGIN` cho dev.

### 5.3 Tắt `wes-new`
Đảm bảo tiến trình `wes-new` (:3101) **không còn chạy** — nếu còn, 2 dispatcher tranh order/park trên cùng kernel.

---

## 6. `KernelApiService` — bổ sung (giữ nguyên "typed door" §5.2b ARCHITECTURE.md)

| Method mới | Kernel call | Dùng cho |
|---|---|---|
| `setVehiclePaused(name, paused)` | `PUT /v1/vehicles/{n}/paused?newValue=` | nút pause xe, `fleet/*` |
| `setPathLocked(name, locked)` | `PUT /v1/paths/{n}/locked?newValue=` | khoá path trên map |
| `withdrawByVehicle(name, immediate)` | `POST /v1/vehicles/{n}/withdrawal?immediate=` | rút order theo xe |
| `createManualTransportOrder(destinations, { intendedVehicle?, type? })` | `POST /v1/transportOrders/{OP-...}` **không bắt buộc `intendedVehicle`** | OrderModal + send-to-point (§5.4) |
| `getTransportOrdersRaw()` | `GET /v1/transportOrders` | panel Order (list) |
| `getTransportOrderRaw(name)` | `GET /v1/transportOrders/{n}` | dialog chi tiết order |

`createTransportOrder` cũ (bắt buộc `intendedVehicle`, tự `triggerDispatcher`) — **giữ nguyên**, cargo domain vẫn dùng.
Method mới KHÔNG gọi `triggerDispatcher` của WES (để kernel tự dispatch order thủ công).

---

## 7. Adapter Zone ↔ Area (`operating/areas.controller.ts`)

### 7.1 Ánh xạ đọc (`GET /api/operating/areas` ← `ZoneService.list()`)

| `Area` (v2 mong đợi) | Nguồn từ `wes` |
|---|---|
| `wesId` | `zone.id` (uuid) |
| `name` | `zone.name` |
| `kind` | `ZoneType.PICKUP → 'ZONE'`, `ZoneType.DROPOFF → 'STORE'` |
| `operation` | suy: `kind==='STORE' ? unloadOperation : loadOperation` (từ `KernelApiService`) — chỉ để hiển thị |
| `maxVehicles` | `null` (wes chưa có) |
| `color` | `zone.color` |
| `plantModelName` | `zone.plantModelName` |
| `status` | `zone.status` (`ACTIVE`/`STALE`) |
| `members[].wesId` | `zoneMember.id` |
| `members[].opentcsLocationName` | `zoneMember.locationName` (`location_<point>`) |
| `members[].opentcsPointName` | strip prefix `location_` |
| `members[].priority` | `zoneMember.positionIndex` |
| `members[].state` | suy từ join `cargos`: `destination_location_name == locationName` → `OCCUPIED`; `reserved_location_name == locationName` → `RESERVED`; còn lại `FREE` |
| `members[].cargoId` | `cargo.id` khớp ở trên, hoặc `null` |

### 7.2 Ánh xạ ghi

| v2 gọi | → `wes` |
|---|---|
| `POST /areas { wesId, name, kind, operation, maxVehicles?, color?, members:[{pointName, priority}] }` | `ZoneService.create({ name, type: kind==='STORE'?DROPOFF:PICKUP, color, members: members.map((m,i)=>({ locationName:'location_'+m.pointName, positionIndex: <reindex 0..n-1 theo priority tăng dần, đảm bảo unique> })) })`. Bỏ `wesId`/`operation`/`maxVehicles`. |
| `PATCH /areas/:id { color }` | `ZoneService.update(id, { color })` — như hiện tại |
| `PATCH /areas/:id { name/operation/maxVehicles }` | `wes` chưa hỗ trợ đổi tên/thành viên → **xoá + tạo lại** (id mới) theo §5.9. **Chặn nếu Area còn cargo đang chạy** (bất kỳ member nào có `state` `RESERVED`/`OCCUPIED`, hoặc có `transport_requests` chưa terminal trỏ vào) → trả 409 + thông báo "Còn cargo đang chạy trong khu vực này — không thể đổi location. Hãy chờ hoàn tất hoặc huỷ cargo." |
| `PUT /areas/:id/members` | như trên — xoá + tạo lại, cùng điều kiện chặn |
| `DELETE /areas/:id` | `ZoneService.remove(id)` (soft-delete + gỡ Location kernel nếu không zone khác dùng chung) |

### 7.3 Ràng buộc `wes` chặt hơn — UI v2 phải chịu

> **TẠM HOÃN phần UX mượt cho các ràng buộc dưới** (làm sau). Đợt này: adapter chỉ
> **pass-through nguyên văn lỗi 4xx của `wes`** lên toast v2, không xây flow riêng
> (không auto chuyển MODELLING, không gợi ý gộp/tách overlap…).

- 1 Location chỉ thuộc **1 zone ACTIVE**; area builder cho point trùng → `wes` trả 400 → hiện lỗi thô.
- `positionIndex` **unique** trong 1 zone; adapter reindex `priority` → `0..n-1` (việc duy nhất adapter làm chủ động).
- Chỉ zone của **bản đồ đang tải** hiện trong list (mặc định). `assign-map` / `sync` là hành động riêng — chưa surface ở v2.
- Tạo/sửa/xoá zone ghi `PUT /v1/plantModel` → kernel từ chối ở OPERATING → hiện lỗi thô (user tự chuyển chế độ / đẩy map mới theo §5.9).
- DROPOFF cần `zone_kernel_id_seq` (migration `002_zone_kernel_id.sql`) + reachability check (đã có trong `ZoneService`).

---

## 8. Cargo — proxy + SSE (`operating/cargo.controller.ts`)

- `GET /api/operating/cargo` ← `CargoService.list()` (`wes` phân trang → trả mảng phẳng cho v2, hoặc v2 nhận `{cargos,total,...}`).
- `POST /api/operating/cargo { cargoId?, pickupPointName, targetStoreAreaWesId, pickupAreaWesId? }`
  → `CargoService.create({ itemCode: cargoId, sourcePointName: pickupPointName, destinationZoneId: targetStoreAreaWesId }, userId)`.
  `pickupAreaWesId` bỏ (wes tự `findPickupLocationForPoint`).
- `DELETE /api/operating/cargo/:id` → `CargoService.remove(id)`.
- `PATCH /api/operating/cargo/:id/redirect` — `wes` **chưa có** redirect (đổi Store đích). Đợt này: **giữ nút ở v2 nhưng để xám / disabled, không nối logic** (giống các field Area không dùng ở §5.5). Thêm use case `wes` sau.
- `GET /api/operating/cargo/stream` (SSE) — `@OnEvent(['transport-task.created','transport-task.status-changed','transport-task.completed','transport-task.failed'])` → `Subject` → `{ data: { ts } }`. v2 refetch `GET /cargo` trên mỗi tick (đúng pattern `wes-new-client` cũ).
- Order realtime: **polling 4s** (`useOrders` đã có `refetchInterval:4000`) — không cần SSE order.

---

## 9. Bảng ánh xạ

### 9.1 Location / operation vocabulary
- Map `vda5050` (`maps/v7-vda5050.xml`): LocationType `Pick up`→`liftUp`, `Drop off`→`liftDown`, `charging`→`startCharging`.
- Map `loopback` (`v7.xml`…): `PICK_UP` / `DROP_OFF`.
- v2 **luôn** lấy từ `GET /api/operating/plant-model/location-types` (`CreateAreaPanel` đã đúng; **OrderModal phải sửa** — đang hardcode `['MOVE','NOP','liftUp','liftDown','leaveGoods','Charge']`).

### 9.2 Trạng thái cargo: `wes` → nhãn v2 (thêm state còn thiếu vào UI)

| `wes` `taskStatus` (`transport_requests`) | + tín hiệu | Nhãn v2 | Ghi chú UI |
|---|---|---|---|
| `CREATED` | — | `QUEUED` | |
| `READY_TO_ASSIGN` | — | `QUEUED` (hoặc badge mới `READY`) | |
| `BLOCKED` | `metadata.blockedReason` | **`BLOCKED`** (mới) | badge đỏ + tooltip lý do — SRS BR-03 |
| `PICKING_UP` | `visual.state==='AT_SOURCE'` & chưa có xe di chuyển | `PICK_PENDING` | |
| `PICKING_UP` | xe đang tới / đang lấy | `PICKING` | |
| `DELIVERING` | `visual.state==='ON_AGV'`, `cargo.reservedLocationName==null` | `CARRYING` | |
| `DELIVERING` | `cargo.reservedLocationName!=null` (đã giữ slot) | `SHIPPING` | |
| `DELIVERY_COMPLETED` | — | `DONE` | |
| `CANCELLED` | — | ẩn khỏi list hoạt động / `CANCELLED` | |
| `FAILED` | `metadata` | `FAILED` | |

`CargoResponseDto` của `wes` đã trả sẵn `taskStatus`, `assignedVehicleName`, `blockedReason`,
`visual:{state:'AT_SOURCE'|'ON_AGV'|'AT_DESTINATION', pointName, vehicleName}` → đủ để map + vẽ beacon trên bản đồ.

---

## 10. Frontend `wes-new-client-v2` — việc cụ thể

1. **Seed**: copy `wes-new-client` → `WCS-FMS/wes-new-client-v2`; `git init` → **repo GitHub riêng** (remote riêng, không chung với `wes-new-client`); commit đầu = cây gốc.
2. **`src/api/`**: xoá `src/api.ts` (fetch :3101). Tạo `src/api/client.ts` (axios `VITE_API_BASE_URL ?? '/api'`, interceptor
   `Bearer localStorage['wes.accessToken']`, `withCredentials:true`, `toApiError`). Tách theo domain:
   `operating.ts` (plant-model, vehicles, orders, commands, fleet, health), `areas.ts`, `cargo.ts`, `auth.ts`, `account.ts`.
   Đường dẫn: prefix `/operating/*` cho nhóm điều hành; `/auth/*`, `/account/*` cho auth.
3. **SSE**: `subscribeVehicles` → `EventSource('/api/operating/vehicles/stream', { withCredentials:true })`;
   `subscribeCargos` → `.../cargo/stream`. Giữ pattern refcounted singleton hiện có.
4. **Auth/security screens (shadcn, style `wes-new-client`)**: `LoginView`, `ForgotView`, `ResetPasswordView`,
   `AccountSecurity` (đổi mật khẩu, đăng xuất phiên khác), `Profile`. Router tối thiểu (`react-router-dom`) hoặc
   state-based: `/login`, `/forgot-password`, `/reset-password`, `/account`, `/` (màn điều hành, cần auth).
   Guard: chưa có token → `/login`.
5. **Chrome**: `AppShell` của `wes-new-client` (brand/conn/model/⌘K/alarms/theme) — thêm menu user (hồ sơ / đổi mật khẩu / đăng xuất).
6. **OrderModal**: giữ UX; operation list lấy động; `intendedVehicle` trống = để kernel gán (§5.4).
7. **CreateAreaPanel**: giữ khung; `wesId`/`operation`/`maxVehicles` → field text hiển thị, disabled, không gửi (§5.5).
   Nút "Sửa" → xác nhận "xoá & tạo lại" (§5.9) hoặc ẩn, chỉ giữ tạo/xoá.
8. **CargoModal**: giữ nguyên (map 1:1 sang `sourcePointName` + `destinationZoneId`).
9. **Trạng thái cargo**: thêm badge `BLOCKED` (+ `READY` nếu muốn) vào `status.ts` / `StatusBadges`.
10. **`.env`**: `VITE_API_BASE_URL=/api`. **`vite.config.ts`**: `server.port=5174`, proxy `/api`→`http://localhost:3000`
    (`changeOrigin:true`; cho SSE: `configure` tắt `res` buffering nếu cần).
11. **i18n**: giữ tiếng Việt (màn đã sẵn); auth screens dùng tiếng Việt.

---

## 11. Kế hoạch phase

| Phase | Repo | Nội dung | Acceptance |
|---|---|---|---|
| **P0** | — | Chốt xong (tài liệu này). Xác minh: TypeORM version `wes` thực resolve; `zone_kernel_id_seq` tồn tại; build `wes` xanh. | doc merged |
| **P1** | `wes` | `src/operating/` phần đọc: `plant-model`, `vehicles`(+`/stream`), `orders`(GET), `health`. Port `routeRemainingPoints`. Cookie `wes_access` + cookie extractor. CORS list. | `curl` (kèm cookie) 4 nhóm GET trả đúng shape v2 mong đợi; SSE `vehicles/stream` đẩy frame khi xe đổi trạng thái |
| **P2** | `wes` | `KernelApiService` bổ sung (§6). `commands.controller` (integration-level/paused/comm-adapter/withdraw/send-to-point/path-lock) + `fleet.controller` + `orders` POST/withdraw. | pause/withdraw/lock/fleet/manual-order chạy live trên map thật; order thủ công không xe → kernel tự gán |
| **P3** | `wes` | `operating/areas.controller` (adapter §7) + `operating/cargo.controller` (§8) + SSE cargo. | tạo/xoá Area qua v2 → Location xuất hiện/biến mất đúng trong kernel; tạo cargo → `wes` dispatch như cũ; `cargo/stream` tick khi task đổi state |
| **P4** | `wes-new-client-v2` | Seed + `src/api/*` + SSE + màn login/security (shadcn) + sửa OrderModal/CreateAreaPanel/badges + `.env`/proxy. | `pnpm build` xanh; đăng nhập → màn điều hành load; tạo hàng / tạo khu vực / chạy fleet OK trên `v7-Xuonghientai` |
| **P5** | cả 2 | CORS origin thật; smoke end-to-end; cập nhật `wes/ARCHITECTURE.md` (module `operating/` = ACL passthrough, không logic), `wes/CLAUDE.md` (quick orientation +1 dòng), `SETUP.md` (thêm bước chạy v2); memory. | checklist §12 chạy hết |

Mỗi phase 1–2 commit, `tsc --noEmit && (nest build | vite build)` xanh, footer:
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_0147G66Nr1Tf5tTJ67x3p2oU`.

---

## 12. Rủi ro / lưu ý khi implement

1. **`createTransportOrder` bắt buộc `intendedVehicle`** → phải dùng `createManualTransportOrder` mới cho OrderModal/send-to-point; không tái dùng method cargo.
2. **Order thủ công không xe** — cần kernel còn dispatcher hoạt động cho order un-intended. `wes` chỉ *pre-assign* order cargo; order trần vẫn để kernel/openTCS dispatcher xử lý. **Verify live ở P2.**
3. **SSE + `JwtAuthGuard`** — `EventSource` không set header; phải xong cookie extractor (P1) trước, và v2 **bắt buộc đi qua Vite proxy** để cookie same-origin (`sameSite=lax` không gửi cross-site cho subresource).
4. **`VEHICLE_TYPE` vocabulary** — OrderModal đang hardcode; sửa lấy động từ `location-types`, nếu không map `loopback` sẽ tạo order sai operation.
5. **`ZoneService.update` mới chỉ đổi color** — v2 "sửa Area" = xoá + tạo lại (id đổi). **Chặn 409 nếu Area còn cargo đang chạy** (member `RESERVED`/`OCCUPIED` hoặc `transport_requests` chưa terminal) — không cho xoá+tạo lại.
6. **Kernel OPERATING** — tạo/sửa/xoá zone ghi plant model sẽ fail. Đợt này **hiện lỗi thô** (không xây `SwitchModeModal`); UX mượt cho ràng buộc chặt của `wes` = **tạm hoãn** (§7.3).
7. **CORS + credentials** — quên thêm origin v2 = chết ngay request đầu.
8. **`forbidNonWhitelisted:false` ở `wes`** — payload v2 có field thừa (`pickupAreaWesId`, `maxVehicles`, `wesId`, `operation`) bị bỏ qua **âm thầm** — nhớ để tránh "gửi mà không ăn".
9. **Chỉ 1 dispatcher** — `wes-new` (:3101) phải tắt hẳn.
10. **Cargo `redirect`** — `wes` chưa có; bỏ nút "đổi Store" ở v2 hoặc để lần sau.
11. **`positionIndex` unique** — adapter reindex `priority`; hai member cùng priority ở form phải ra 2 index khác nhau.
12. **`item_code` không phải PK** — `wes` cargo PK là uuid; `cargoId` v2 nhập vào chỉ thành `itemCode` (label). Trùng `itemCode` không bị chặn.

---

## 13. Ngoài phạm vi đợt này

- Port "bộ não" cargo `wes-new` (deferred-pickup, `evaluatePickup`, route-swap, `stop-charging`, watchdog, CommitGuard/MQTT).
- DB `wes_new`, bảng `area`/`area_member`, migration `1757xxx`.
- Cargo `redirect` (đổi Store đích) trên `wes` — nút để xám ở v2.
- Đổi tên / sửa member Area in-place trên `wes` (dùng xoá+tạo lại; chặn khi còn cargo chạy).
- UX mượt cho ràng buộc chặt của `wes`: overlap Location, auto chuyển MODELLING↔OPERATING, gợi ý sửa layout — **tạm hoãn**, đợt này chỉ pass-through lỗi 4xx.
- Convert các màn `wes-client` (dashboard, users, AGV fleet, cargo MUI, map konva) sang v2.
- Nhúng v2 thành tab trong `wes-client` (làm độc lập trước; viết code để dễ nhúng sau).
- Cột `zones.wes_id` / `max_vehicles` / `operation` (chỉ thêm khi nghiệp vụ `wes` thật sự cần).
- `wes` WebSocket gateway realtime tổng quát (§7 ARCHITECTURE.md — chưa tồn tại; SSE cargo là bản tối thiểu).
