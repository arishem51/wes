# PLAN — Phase 1: Công cụ Map + Bật/tắt Adapter + Fix cargo refresh

> Trạng thái: **CHƯA IMPLEMENT — chờ duyệt.**
> Ngày: 2026-09-10. Workspace: `E:\IIHUST\AUBOT\WCS-FMS`.
> Tầm nhìn đầy đủ (editor topology): `PLAN-map-editor-vision.md`.

Phase 1 = những gì làm **ngay**. **Không** đụng canvas editor (để Phase 2+).
Gồm 3 phần độc lập:

- **A.** Màn "Bản đồ" trong `wes-new-client-v2` — lấy map từ kernel / upload map / (hạ tầng) lưu map. Scope C.
- **B.** Bật/tắt comm adapter xe từ `wes-new-client-v2` (thay Kernel Control Center) — mục 1.
- **C.** Fix cargo tạo từ API không hiển thị, phải F5 — mục 2.

---

## Phần A — Màn "Bản đồ" trong `wes-new-client-v2` (scope C)

### A0. Kết quả mong muốn

Màn "Bản đồ" mới (route riêng, tab riêng) với **3 chức năng tách biệt**:

1. **Lấy map từ kernel** — xem model hiện tại (tên, số point/path/vehicle, file gốc, upload lúc nào) + **tải model về file `.json`**.
2. **Tải map lên (upload)** — chọn file map `.xml` → nạp vào kernel (đi qua flow an toàn của `MapsService.upload`).
3. **Lưu map vào kernel** — Phase 1 chỉ dựng **hạ tầng API** (`PUT /plant-model/raw` + `etag`); nút ở FE để **disabled/ẩn** cho tới Phase 2 (khi có canvas sửa). Có thể bỏ qua nếu muốn gọn.

Kèm: pill trạng thái kernel **MODELLING / OPERATING** + nút chuyển chế độ.

### A1. Backend — `wes/src/maps` (đã có nhiều, thêm ít)

**Tái dùng nguyên (không sửa):**

| API | Guard | Việc |
|---|---|---|
| `GET /api/maps/kernel-status` | authed | `{reachable, state}` |
| `POST /api/maps/kernel-state` `{state}` | **admin** | chuyển chế độ; khi về OPERATING gọi `initializeVehiclesForOperation()` |
| `GET /api/maps/current` | authed | `{name, pointCount, pathCount, vehicleCount, originalFilename, uploadedAt, uploadedById}` |
| `GET /api/maps/plant-model` | authed | model JSON (đã guard summary) |
| `POST /api/maps/upload` (multipart) | **admin** | parse XML → `savePlantModel` → lưu `MapRecord` |

**Thêm mới trong `MapsController` (KHÔNG đặt trong `operating/*`):**

- `GET /api/maps/plant-model/raw` (authed) → `kernelApi.getRawPlantModel()` nguyên văn +
  `etag` (sha1 của JSON sort-key). Dùng cho nút "tải về" và làm nền Phase 2.
- *(tuỳ chọn Phase 1)* `PUT /api/maps/plant-model/raw` (**admin**, header `If-Match`):
  verify etag → `setKernelState('MODELLING')` → `putRawPlantModel(body)` →
  `setKernelState('OPERATING')` → `initializeVehiclesForOperation()` → trả `{model, etag}`.
  → Nếu Phase 1 chưa cần lưu, hoãn sang Phase 2.

### A2. Frontend — `wes-new-client-v2`

1. **Router** — thêm `react-router-dom@6`.
   `App.tsx`: khi `authed` → `<RouterProvider>` với `/` = `AppShell`/`OperatingScreen`,
   `/map` = `MapScreen`.
   *(Phương án nhẹ hơn nếu ngại thư viện: state `screen` trong 1 zustand + 2 nút header.
   Đề xuất dùng react-router vì Phase 2+ cần.)*
2. **Header `AppShell`** — thêm 2 tab **"Điều hành" | "Bản đồ"**.
   Tab "Bản đồ" chỉ hiện nếu role = admin (đọc từ `src/lib/account.ts` / token).
   Lưu ý: các `GET /api/maps/*` không bị role-gate, chỉ `upload` + `kernel-state` là admin —
   nên vẫn ẩn tab cho gọn.
3. **`src/api.ts`** — thêm:
   - `mapsRequest<T>(path, init)` — base `${API_BASE}/maps`, cùng `authHeaders()` +
     `credentials:'include'` + xử lý 401 giống `request()`.
   - `fetchKernelStatus()`, `setKernelMode(state)`, `fetchCurrentMap()`,
     `fetchPlantModelRaw()`, `uploadMap(file: File)` — dùng `FormData`,
     **KHÔNG** tự set `Content-Type` (để browser set boundary).
4. **`src/map/MapScreen.tsx`** (mới):
   - **Card "Model hiện tại":** tên, số point/path/vehicle, file gốc, upload lúc nào + bởi ai.
     Nút **"Tải model (.json)"** → `fetchPlantModelRaw()` → `Blob` → blob URL → click tải.
   - **Card "Trạng thái kernel":** pill MODELLING/OPERATING (poll `fetchKernelStatus` 5s).
     Nút "Chuyển sang Thiết kế / Vận hành" + confirm — cảnh báo:
     *về OPERATING sẽ bật lại adapter & khởi tạo xe; sang MODELLING sẽ dừng điều phối.*
   - **Card "Tải map lên":** input file `.xml`, nút "Tải lên & nạp vào kernel" + confirm —
     cảnh báo: *huỷ order đang chạy, tắt adapter, cần bật lại xe.* → `uploadMap` → toast + refetch.
5. **Hooks** — `useKernelStatus()`, `useCurrentMap()` (react-query, `refetchInterval` hợp lý).

### A3. Kiểm thử

- Kernel OPERATING → mở màn "Bản đồ" → tên model + số lượng khớp `curl /v1/plantModel`.
- Tải `.json` về → so với `curl http://127.0.0.1:55200/v1/plantModel`.
- Upload lại đúng file XML đang chạy → model không đổi; order cũ bị huỷ (đúng cảnh báo);
  adapter tắt → tự bật lại khi kernel về OPERATING (xác nhận `initializeVehiclesForOperation` chạy).
- OPERATOR login → **không** thấy tab "Bản đồ".

---

## Phần B — Bật/tắt comm adapter trong `wes-new-client-v2` (mục 1)

### B0. Kết quả mong muốn

- **Panel chi tiết xe** (`PropertyDrawer`, khi chọn 1 `VEHICLE`): nút **"Kết nối xe" / "Ngắt kết nối"**
  + badge trạng thái adapter (Bật/Tắt).
- **Bảng Xe của `BottomPanel`** (đã có checkbox multi-select + `BulkBar`): thêm nút bulk
  **"Kết nối" / "Ngắt kết nối"** để chạy cho **nhiều xe được tick cùng lúc**.
- Đây là thay thế cho "enable driver" của Kernel Control Center.
- Nguyên tắc: chỉ tác động xe được chọn — **không** làm xe khác đứng yên (memo `feedback_dispatch_isolation`).

### B1. Backend

- **Route đã có, dùng luôn:** `PUT /api/operating/vehicles/:name/comm-adapter?value=true|false`
  (`wes/src/operating/commands.controller.ts:48` → `OperatingCommandsService.setCommAdapter`
  → `kernelApi.setVehicleAdapterEnabled`). **Không cần thêm endpoint.**
- **Vấn đề:** FE không biết adapter đang bật/tắt. `VehicleRealtimeDto` (operating) và
  `resolveKernelStatus` (agvs) đều suy ra từ `integrationLevel`, **không** đọc cờ adapter thật.
- **Thêm:**
  1. `KernelApiService.getVehicleAdapterInfo(name)` → `GET /v1/vehicles/{name}/commAdapter`
     → `{enabled, attached}`.
     **Trước tiên** `curl http://127.0.0.1:55200/v1/vehicles/AMR_1` xem overlay FMS có sẵn
     field adapter trong payload `/v1/vehicles` chưa — nếu có thì lấy free, khỏi gọi thêm.
  2. `OperatingVehiclesService`: enrich mỗi `VehicleRealtimeDto` thêm `commAdapterEnabled: boolean`.
     - Hiệu năng: nếu phải gọi riêng `/commAdapter` cho từng xe → **chỉ gọi trong `snapshot()`**
       (list), cache 2–3s; **không** gọi trong mỗi SSE delta.
  3. `wes/src/operating/dto/operating.dto.ts`: thêm `commAdapterEnabled` vào `VehicleRealtimeDto`.
- *(tuỳ chọn — nút 1-chạm)* `POST /api/operating/vehicles/:name/bring-online`
  = adapter ON + `integrationLevel TO_BE_UTILIZED` (giống `AgvsService.connect`).

### B2. Frontend `wes-new-client-v2`

1. `src/api.ts`: `setVehicleCommAdapter(name, enabled)` — **đã có (dòng 228).** Không cần thêm.
2. `VehicleRealtime` type (`src/api.ts`): thêm `commAdapterEnabled: boolean`.
3. **`src/operating/PropertyDrawer.tsx`** — nhánh `type === 'VEHICLE'`:
   - Thêm badge "Adapter: Bật / Tắt" (màu theo trạng thái) vào `rows` hoặc `headerExtra`.
   - Thêm nút trong `actions`:
     `commAdapterEnabled ? "Ngắt kết nối" : "Kết nối xe"` →
     `useMutation(() => setVehicleCommAdapter(v.name, !v.commAdapterEnabled))` →
     `invalidateQueries(['vehicles'])` + toast.
   - *(nếu làm combo)* nút "Đưa vào vận hành" → `bring-online`.
4. **`src/operating/BottomPanel.tsx`** — nhánh `panel === 'vehicles'`, khối `bulkBar`
   (hiện có "Tạm dừng" + "Rút order"):
   - `commAdapterMut = useMutation({ mutationFn: ({name,enabled}) => setVehicleCommAdapter(name,enabled), ...okErr })`.
   - Thêm 2 nút vào `BulkBar`:
     - "Kết nối" → `runBulk([...checked], (n) => commAdapterMut.mutate({name:n, enabled:true}), { title: 'Kết nối ' + chk + ' xe?', confirmText: 'Kết nối' })`
     - "Ngắt kết nối" → tương tự `enabled:false`.
   - Thêm cột "Adapter" vào bảng Xe (badge nhỏ) để nhìn nhanh xe nào chưa kết nối.
5. *(tuỳ chọn)* filter "chỉ xe chưa kết nối" ở ô search bảng Xe → tick nhanh → bulk-connect.

### B3. Kiểm thử

- Chọn 1 xe trên map → panel → "Kết nối xe" → `curl /v1/vehicles/<name>/commAdapter` = `enabled:true`; badge đổi.
- Mở bảng Xe → tick 5 xe → "Kết nối" → cả 5 bật; 1 toast; badge đổi. "Ngắt kết nối" → `enabled:false`.
- So với Kernel Control Center: kết quả tương đương (driver enabled).
- Xe **không** được chọn: trạng thái không đổi, không đứng yên.

---

## Phần C — Fix cargo tạo từ API không hiển thị, phải F5 (mục 2)

### C1. Nguyên nhân (đã xác định trong code)

- `wes-new-client-v2/src/hooks/data.ts` → `useCargos`: `useQuery({ staleTime: Infinity })`,
  **không** `refetchInterval`. Danh sách chỉ refresh khi SSE `/operating/cargo/stream` bắn tick
  → `invalidateQueries(['cargos'])`.
- `src/api.ts` → `makeSharedStream`: `EventSource` **chỉ** set `onmessage`; **không** có
  `onopen` / `onerror` / bắt reconnect. Khi stream đứt (dev: `nest start --watch` recompile
  mỗi lần lưu file → SSE rớt; prod: proxy/redeploy) → `EventSource` tự reconnect **nhưng mọi tick
  server bắn trong lúc rớt bị mất vĩnh viễn**. Vì `staleTime: Infinity` + không interval → cargo
  mới không hiện tới khi có cargo event khác hoặc F5.
- Phụ: race get-then-subscribe — `useQuery` fetch lúc mount; SSE mở ở `useEffect` sau; cargo tạo
  trong khe đó mất tick.
- Backend **có** bắn tick khi tạo: `wes/src/cargo/cargo.service.ts` `create()` luôn tạo
  `TransportTaskEntity` + `transportTask.publishCreated()` → emit `transport-task.created` →
  `OperatingCargoService.onTaskChanged()` → `ticks.next()`. Event có; client bỏ lỡ khi reconnect.
- Đối chiếu: `useOrders` **không** dính bug vì có `refetchInterval: 4000`.
  `useVehicles` cùng thiết kế nhưng che được vì delta xe chảy liên tục; cargo event thưa nên miss là "dính".

### C2. Sửa (nhỏ — theo thứ tự ưu tiên)

1. **`useCargos`** — thêm `refetchInterval: 10_000`, `refetchOnReconnect: true`,
   `refetchOnWindowFocus: true`. Giống `useOrders`. Tự lành ≤10s. **Làm ngay (~15 phút).**
2. **`makeSharedStream`** — thêm:
   - `source.onopen`: lần mở đầu bỏ qua; các lần sau (reconnect) → gọi listeners với 1 sentinel
     (vd `{ __reconnect: true }`) để consumer chạy `invalidateQueries` bù.
   - `source.onerror`: log debug (không spam).
   - Sửa `useCargos` / `useVehicles` để với payload reconnect thì `invalidateQueries` / refetch.
   *(~1–2 giờ. Vá tận gốc cho mọi SSE consumer.)*
3. **Backend `wes/src/operating/cargo.controller.ts`** — stream `.pipe(startWith({ data: { ts: Date.now() } }))`
   (rxjs) để mỗi lần (re)connect client nhận 1 tick ngay → refetch on connect.
   Kết hợp (2) là 2 lớp chắc ăn. *(~15 phút.)*
4. *(không cần cho code `WCS-FMS/wes` hiện tại)* Nếu sau này port "deferred pickup" từ
   `FMS-SRC` newWes (`create()` không tạo task) → `OperatingCargoService` phải nghe thêm
   cargo-domain event, không chỉ `transport-task.*`.

### C3. Kiểm thử

- Mở màn Điều hành, **không** F5. `POST /api/operating/cargo` (script/curl) → cargo xuất hiện
  trong ≤10s (sau fix 1) / gần như tức thì (sau fix 2+3).
- Trong lúc backend đang recompile (sửa 1 file `wes`), tạo cargo → sau khi SSE reconnect, cargo
  hiện (không F5).
- Tạo 5 cargo liên tiếp → đủ 5, không sót.

---

## Thứ tự triển khai đề xuất

1. **Phần C fix 1** — 15 phút, giá trị ngay.
2. **Phần B** — backend cờ adapter + FE panel + bulk. ~1 ngày.
3. **Phần A** — màn "Bản đồ" scope C. ~1 ngày.
4. **Phần C fix 2 + 3** — ~2 giờ.
5. Cập nhật `HUONG-DAN-CHAY-WCS-FMS.md` (mục mới: bật xe từ web, màn Bản đồ) +
   `wes/report/INTEGRATION-wes-new-client-v2.md`.

**Tổng Phase 1 ≈ 1–1.5 ngày.**

---

## File đụng tới (Phase 1)

**Backend:**
- `wes/src/maps/maps.controller.ts` (+ `plant-model/raw`)
- `wes/src/opentcs/kernel-api.service.ts` (+ `getVehicleAdapterInfo`)
- `wes/src/operating/operating-vehicles.service.ts` (+ `commAdapterEnabled`)
- `wes/src/operating/dto/operating.dto.ts` (+ field)
- `wes/src/operating/cargo.controller.ts` (`startWith`)

**Frontend (`wes-new-client-v2`):**
- `package.json` (react-router-dom)
- `src/App.tsx`, `src/components/AppShell.tsx` (router + tab)
- `src/api.ts` (`mapsRequest` + maps fns + `commAdapterEnabled` type)
- `src/hooks/data.ts` (`useCargos` interval; `useKernelStatus`, `useCurrentMap`)
- `src/operating/PropertyDrawer.tsx` (nút + badge adapter)
- `src/operating/BottomPanel.tsx` (bulk connect + cột Adapter)
- `src/map/MapScreen.tsx` (mới)

**Docs:**
- `HUONG-DAN-CHAY-WCS-FMS.md`
- `wes/report/INTEGRATION-wes-new-client-v2.md`

---

## Ghi chú quyết định (từ trao đổi 2026-09-10)

- Editor đặt ở **màn mới trong `wes-new-client-v2`** (không dùng lại wes-client).
- "Lưu map" và "Upload map" là **2 chức năng riêng**; kéo thêm **"Lấy map từ kernel"** (tải model về).
- Bật/tắt adapter: tích hợp vào **panel chi tiết xe**; bật nhiều = **multi-select trong bảng Xe** →
  1 nút bulk.
- Phase 1 làm scope **C**; scope **B** (editor topology đầy đủ) chỉ là tài liệu tầm nhìn
  (`PLAN-map-editor-vision.md`), chưa code.
