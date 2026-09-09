# PLAN — Web Map Editor cho `wes-new-client-v2` (tầm nhìn đầy đủ — scope B)

> Trạng thái: **BẢN THIẾT KẾ / CHƯA IMPLEMENT**. Đây là đích đến. Phần làm ngay xem
> `PLAN-map-editor-phase1.md`.
> Ngày: 2026-09-10. Workspace: `E:\IIHUST\AUBOT\WCS-FMS`.

---

## 0. Mục tiêu

Thay thế **openTCS Model Editor (Swing)** bằng một màn editor chạy ngay trong
`wes-new-client-v2`. Cho phép:

- Nạp (load) plant model hiện tại từ kernel.
- Sửa topology: point / path / location / locationType / block / vehicle / visualLayout.
- Lưu (persist) trở lại kernel — model được kernel ghi xuống `data/`, tự nạp lần sau.
- Không phải mở Model Editor / Kernel Control Center để chỉnh bản đồ nữa.

**Người dùng:** admin (kỹ sư triển khai). Không dành cho operator.

**Không nằm trong phạm vi:** vẽ peripheral devices, chỉnh cấu hình kernel, mô phỏng.

---

## 1. Ràng buộc kỹ thuật (bắt buộc đọc trước khi code)

### 1.1 openTCS REST (`servicewebapi`, overlay 7.3.0)

| API | Ghi chú |
|---|---|
| `GET /v1/plantModel` | Trả **toàn bộ** model JSON (`PlantModelTO`). Points: `position`/`pose` + `type` + `vehicleOrientationAngle` + `properties[]` + `layout{position,labelOffset,layerId}`. Paths: `srcPointName`/`destPointName` + `length` + `maxVelocity` + `maxReverseVelocity` + `locked` + `peripheralOperations[]` + `layout`. Locations: `typeName` + `position` + `links[]` + `locked` + `properties[]` + `layout`. Kèm `locationTypes[]`, `blocks[]`, `visualLayout{}`, `properties[]`. |
| `PUT /v1/plantModel` | **Thay thế toàn bộ model.** Không có patch từng phần ở tầng REST. |
| `PUT /v1/kernel/state?newValue=MODELLING\|OPERATING` | Chuyển chế độ kernel. |
| `GET /v1/vehicles/{name}/commAdapter` | `{enabled, attached, ...}` — dùng cho badge adapter (xem plan phase 1). |

**Tác dụng phụ của `PUT /v1/plantModel` (đã quan sát trong dự án này):**

- Kernel nạp lại model → **huỷ mọi transport order đang chạy, reset allocation**.
- **Tắt comm adapter tất cả xe** (memo: "Area CRUD tắt comm adapter").
- Một số trường hợp bị từ chối `400/409` nếu kernel đang OPERATING
  (`wes/src/opentcs/save-plant-model.ts` bắt lỗi này → "phải chuyển sang chế độ Thiết kế").
  Area CRUD hiện `PUT` khi OPERATING vẫn được vì chỉ đụng mảng `locations`; với thay đổi
  points/paths → **phải `setKernelState('MODELLING')` trước**, xong `setKernelState('OPERATING')`.
- Kernel tự ghi model xuống `data/` sau `PUT` ⇒ "persist" là miễn phí.
  Lưu ý: `gradlew clean` xoá `data/` (memo).

### 1.2 Kiến trúc `wes` (backend)

- `wes/src/operating/*` là **FE passthrough, read-only** (ARCHITECTURE.md §5.2b).
  **Không** đặt endpoint ghi plant model ở đây.
- Đã có sẵn module quản lý map: `wes/src/maps/*` → `/api/maps/*`
  (`kernel-status`, `kernel-state` [admin], `plant-model` GET, `upload` XML [admin],
  `current`, `cargo-options`, `kernel/vehicles`, `kernel/sse`, `kernel/events`,
  `kernel/transport-orders/:name/withdraw`).
  → **Editor write API đặt trong `MapsModule`.**
- `wes/src/opentcs/plant-model-locations.ts` = **mẫu read-modify-write nguyên model**:
  `getRawPlantModel()` → sửa 1 mảng → `savePlantModel(kernelApi, { ...model, <mảng> })`.
  Editor dùng đúng mẫu này, mở rộng cho mọi mảng.
- `KernelApiService` đã có: `getRawPlantModel`, `putRawPlantModel`, `putPlantModel`,
  `getKernelState`, `setKernelState`, `initializeVehiclesForOperation`, `isReachable`.

### 1.3 `wes-new-client-v2` (frontend)

- **Chưa có router.** Chỉ 1 màn `OperatingScreen`. `App.tsx` → `AppShell` → `OperatingScreen`.
- Client **chỉ gọi `/api/operating/*`** (`src/api.ts`: `BASE_URL = ${API_BASE}/operating`).
- Canvas mạnh sẵn: `src/operating/LiveMapCanvas.tsx` (~1500 dòng) — pan/zoom, vẽ
  point/path/area/vehicle, select, multi-select rubber-band, focus. `src/geometry.ts` = transforms.
- `src/operating/PropertyDrawer.tsx` — panel chi tiết theo loại phần tử (read-only + vài lệnh).
- `src/operating/BottomPanel.tsx` — bảng dày Xe/Order/Area/Hàng/Cảnh báo, **có sẵn checkbox
  multi-select + `BulkBar` + helper `runBulk()`**.
- `src/store/operating-ui.ts` — zustand cho selection/multi/layer/panel/modal.
- SSE dùng `makeSharedStream()` (EventSource dùng chung, refcount).

### 1.4 Đồng thời / xung đột

- **Không có optimistic-lock** trên model. 2 người sửa cùng lúc = last-write-wins.
- Cần: hash (ETag) model lúc load; khi lưu gửi `If-Match` — nếu kernel đã đổi → chặn, buộc reload.

---

## 2. Kiến trúc đề xuất

### 2.1 Backend — `wes/src/maps` (mới, `@Roles('admin')` cho write)

| Method | Path | Việc |
|---|---|---|
| `GET`  | `/api/maps/plant-model/raw` | `getRawPlantModel()` nguyên văn + `etag` (sha1 của JSON đã sort key). |
| `PUT`  | `/api/maps/plant-model/raw` | body = model đầy đủ + header `If-Match: <etag>`. Flow: verify etag → `setKernelState('MODELLING')` → `putRawPlantModel(body)` → `setKernelState('OPERATING')` → `initializeVehiclesForOperation()` → trả model mới + etag mới. |
| `POST` | `/api/maps/plant-model/validate` | Validate **không ghi** (xem §3). Trả `{errors[], warnings[]}` kèm tên phần tử để FE focus. |
| `GET`  | `/api/maps/plant-model/export?format=json\|xml` | Tải model hiện tại về file. v1: chỉ `json`. `xml` = dựng lại từ raw (phase 4). |

Tái dùng nguyên: `GET /api/maps/kernel-status`, `POST /api/maps/kernel-state`,
`GET /api/maps/current`, `POST /api/maps/upload`.

Service mới: `MapEditorService` (trong `MapsModule`) — validate + apply. Controller chỉ điều phối.

### 2.2 Frontend — `wes-new-client-v2`

- **Router:** thêm `react-router-dom@6`. Route `/` = `OperatingScreen`, `/map-editor` = `MapEditorScreen`.
  Tab-switch ở header `AppShell`. Ẩn tab với role ≠ admin.
- **API layer:** thêm `mapsRequest<T>(path, init)` — base `${API_BASE}/maps`, cùng
  `authHeaders()` + `credentials:'include'` + xử lý 401 như `request()`.
- **State:** `useMapEditor` (zustand) — `original`, `draft`, `etag`, `dirty`, `selection`,
  `history` (undo/redo), `validation`, `mode` (chọn/kéo | thêm-point | vẽ-path | thêm-location | xoá).
- **Canvas:** tách `MapEditorCanvas` từ `LiveMapCanvas` (chung layer vẽ point/path), thêm:
  - Kéo point → cập nhật `draft.points[i].position` **và** `layout.position`.
  - "Thêm point": click canvas → point mới (tên tạm, `HALT_POSITION`).
  - "Vẽ path": click point A → point B → path mới (`length` = Euclid, `maxVelocity` mặc định).
  - "Thêm location": click point → location mới + chọn `locationType`.
  - "Xoá" phần tử đang chọn (dọn path/link liên quan).
  - Snap: hút lưới / hút point gần nhất khi vẽ path.
- **PropertyForm** (thay `PropertyDrawer` read-only) — form theo loại, mọi field ghi vào `draft`
  + push history:
  - **Point:** name, type, x, y, `vehicleOrientationAngle`, `labelOffset`, `layerId`, `properties[]`.
  - **Path:** name, src, dest, length (auto/manual), `maxVelocity`, `maxReverseVelocity`,
    `locked`, oneWay (= `maxReverseVelocity` 0), `properties[]`.
  - **Location:** name, `typeName`, x, y, `links[]`, `locked`, `properties[]`.
  - **LocationType:** name, `allowedOperations[]`, `properties[]`.
  - **Block:** name, type (`SINGLE_VEHICLE_ONLY` / `BLOCK_AREA`), `members[]`.
  - **Vehicle:** `energyLevel*`, `maxVelocity`, `properties[]` (ít sửa).
  - **VisualLayout:** `scaleX/Y`, `layers`, `layerGroups`.
- **Toolbar:** chọn/kéo · thêm point · vẽ path · thêm location · xoá · undo/redo · layer toggles · zoom-fit.
- **Panel thao tác model** (3 chức năng TÁCH BIỆT — theo yêu cầu):
  - **Lấy map từ kernel:** `GET /plant-model/raw` → nạp vào editor (cảnh báo mất draft nếu dirty) +
    nút "Tải file".
  - **Tải map lên (upload):** chọn file XML/JSON → `POST /api/maps/upload` (đi qua flow an toàn) —
    độc lập với editor.
  - **Lưu vào kernel:** `PUT /plant-model/raw` với `If-Match`. Confirm (cảnh báo gián đoạn).
    Chặn khi có xe `EXECUTING`. Sau lưu: reload từ kernel + toast.
  - **Kiểm tra:** `POST /plant-model/validate` — bảng lỗi/cảnh báo, click để focus phần tử.
- **Kernel mode:** pill MODELLING/OPERATING + nút chuyển (`/api/maps/kernel-state`).
- **Undo/redo:** history stack các snapshot `draft` (debounce), `Ctrl+Z` / `Ctrl+Shift+Z`.

### 2.3 Round-trip an toàn

- Sửa **trên bản sao của raw JSON từ kernel**, **không** dựng lại từ DTO rút gọn
  (`opentcs-xml.parser.ts` `PlantModelDto` là schema **XML**, khác schema REST).
- Giữ nguyên các nhánh không đụng (`visualLayout`, `blocks`, `properties` gốc, peripheral…).
- Mỗi point sửa toạ độ phải cập nhật **đồng thời** `position`/`pose` VÀ `layout.position`
  (model = mm; layout có scale) — nếu không Operations Desk / Model Editor hiển thị lệch.

---

## 3. Validate tối thiểu (trước khi cho lưu)

**Chặn (errors):**

- Tên phần tử: không rỗng, không trùng trong cùng loại.
- Path: `srcPointName` & `destPointName` tồn tại; không tự nối chính nó.
- Location: `typeName` tồn tại trong `locationTypes`; mọi `links[].pointName` tồn tại.
- Block: mọi member tồn tại.
- Số: toạ độ / length / velocity là số hữu hạn ≥ 0.

**Cảnh báo (không chặn):**

- Point cô lập (không path nào chạm).
- Location không có link.
- `path.length` lệch xa khoảng cách hình học giữa 2 điểm.
- Đổi tên phần tử đang được order/zone tham chiếu.

---

## 4. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| `PUT` full model huỷ order + tắt adapter | Confirm rõ; chặn khi có xe `EXECUTING`; tự `initializeVehiclesForOperation` sau lưu; làm khi fleet rảnh |
| 2 người sửa đè nhau | `If-Match` etag; buộc reload khi lệch |
| Sai schema → kernel từ chối / model hỏng | `validate` trước; giữ nguyên nhánh không đụng; nút "Lấy lại từ kernel" để rollback; export backup trước khi lưu |
| `gradlew clean` xoá model | Ghi chú vận hành; luôn export backup trước |
| v2 chưa có router / role | Thêm `react-router`; guard tab theo role |
| Canvas 1500 dòng khó fork | Phase 2 chỉ clone phần render read-only; không refactor `LiveMapCanvas` gốc |

---

## 5. Lộ trình

| Phase | Nội dung | Tài liệu |
|---|---|---|
| **1** | Panel thao tác model (lấy từ kernel / upload / lưu-hạ-tầng) + kernel-mode toggle. **KHÔNG** sửa canvas. Kèm: bật/tắt adapter (mục 1) + fix bug cargo refresh (mục 2). | `PLAN-map-editor-phase1.md` |
| **2** | `MapEditorScreen` + router + canvas read-only clone + kéo point + sửa property point/path + validate + lưu (bounce MODELLING). | — |
| **3** | Thêm/xoá point, vẽ path, thêm/link location, undo/redo, snap. | — |
| **4** | locationType / block / visualLayout, export XML, diff view, backup tự động. | — |

**Ước lượng:** Phase 1 ≈ 1–1.5 ngày · Phase 2 ≈ 3–4 ngày · Phase 3 ≈ 4–6 ngày ·
Phase 4 ≈ 3–5 ngày. **Tổng B đầy đủ ≈ 3 tuần.**

---

## 6. File sẽ đụng (toàn bộ B)

**Backend:**
`wes/src/maps/maps.controller.ts`, `wes/src/maps/maps.module.ts`,
`wes/src/maps/map-editor.service.ts` (mới),
dùng `wes/src/opentcs/kernel-api.service.ts` + `wes/src/opentcs/save-plant-model.ts`.

**Frontend:**
`wes-new-client-v2/package.json` (react-router), `src/App.tsx`, `src/components/AppShell.tsx`,
`src/map-editor/*` (mới), `src/api.ts` (mapsRequest),
tách từ `src/operating/LiveMapCanvas.tsx` + `src/geometry.ts`.

**Docs:**
`HUONG-DAN-CHAY-WCS-FMS.md`, `wes/report/INTEGRATION-wes-new-client-v2.md`.

---

## 7. Câu hỏi mở (chốt trước Phase 2)

1. Lưu map: luôn bounce MODELLING (an toàn, ~vài giây downtime) hay thử `PUT` live như Area CRUD
   (nhanh, adapter vẫn tắt, rủi ro order cao hơn)? — *khuyến nghị: bounce.*
2. Có cần export **XML** (để mở lại bằng Model Editor Swing) hay chỉ **JSON** là đủ?
3. Undo/redo: snapshot toàn `draft` (đơn giản, tốn RAM với model lớn) hay patch (immer)?
4. Có versioning model trong DB `wes` (bảng `map_record` mở rộng: lưu cả JSON + ai sửa + khi nào)
   để rollback không, hay chỉ dựa vào file backup thủ công?
