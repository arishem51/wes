# UC 3 — Transport Request Management: Phân tích Thiết kế

> Tài liệu này tổng hợp phân tích nghiệp vụ, functional requirements, data structures, algorithms, và architecture của UC 3 dựa trên SRS (Report 3) và codebase hiện tại.

---

## 1. Nghiệp vụ Pickup, Dropoff, Cancel — Business Rules

### 1.1 Luồng tổng quan

```
Scanner / Operator
     │  scan QR nguồn + barcode đích
     ▼
[WES: Tạo Cargo]
     │  validate source/dest (BR-07)
     │  check conflict source
     ▼
[Cargo ACTIVE + TransportTask CREATED]
     │  trigger schedule()
     ▼
[Release Engine]  ← event: vehicle available / periodic
     │  dependency check BR-10 (outer-before-inner)
     │  → READY_TO_ASSIGN nếu eligible
     ▼
[Assignment Engine]
     │  AGV selection (battery > opThreshold, acceptance=ENABLED, not busy)
     │  → Tạo TO1 trong FMS (PICK_UP operation)
     │  task → PICKING_UP
     ▼
[FMS executes TO1] ──SSE──▶ TO1 state=FINISHED
                                    │
                          [EventProcessor: onPickUpToFinished]
                                    │  Tạo TO2 (DROP_OFF operation)
                                    │  task → DELIVERING
                                    ▼
                          [FMS executes TO2] ──SSE──▶ TO2 state=FINISHED
                                                          │
                                               [onDropOffToFinished]
                                                          │  task → DELIVERY_COMPLETED
                                                          │  Cargo → DELIVERED
```

### 1.2 Business Rules

| ID | Rule |
|---|---|
| **BR-04** | 1 Transport Request chỉ được assign cho tối đa 1 AGV tại một thời điểm |
| **BR-05** | 1 AGV chỉ được execute tối đa 1 active TR cùng lúc |
| **BR-06** | AGV có `acceptance=IGNORED` bị loại khỏi toàn bộ dispatch logic |
| **BR-07** | Tạo Cargo: source phải là Point[type=PICKUP], dest phải là Location[type=DROPOFF]. Vi phạm → Cargo=INVALID, không tạo TR |
| **BR-08** | Delete Cargo chỉ được khi TR (nếu có) chưa đạt `PICKUP_COMPLETED` hoặc `DELIVERY_COMPLETED`. Nếu đang DELIVERING → block delete |
| **BR-09** | Cancel TR không được khi đã ở terminal state: `DELIVERY_COMPLETED` hoặc `CANCELLED` |
| **BR-10** | **Pickup zone — Outer before Inner**: AGV chỉ được pick up hàng tại slot X nếu tất cả slots nằm giữa X và entrance của zone đều EMPTY. Áp dụng tại Release Engine |
| **BR-11** | **Drop-off — Cascading Depth-First Fill**: Chọn slot innermost trước (lấp từ trong ra ngoài) để tối đa hoá mật độ lưu trữ và tránh gap |
| **BR-12** | **Debounce**: Sau khi TR được tạo, đợi một khoảng thời gian trước khi chạy conflict check, gom các requests đến cùng location vào cùng window để tránh race condition |

### 1.3 Cancel & Delete

**Cancel TR:**
- Cho phép khi status ∈ {`CREATED`, `READY_TO_ASSIGN`, `PICKING_UP`}
- Nếu đang `PICKING_UP`: gọi `kernelApi.withdrawTransportOrder(to1Name)` để abort FMS
- Nếu đang `DELIVERING`: block (AGV đang mang hàng vật lý — BR-08)
- Chuyển task → `CANCELLED`

**Delete Cargo:**
- Soft delete Cargo entity
- Tự động cancel TR liên kết nếu chưa đến `DELIVERY_COMPLETED`
- Nếu TR đang `DELIVERING` → block delete

---

## 2. Functional Requirements

| FR ID | Tên | Mô tả |
|---|---|---|
| FR-01 | Scanner Cargo Ingestion API | REST endpoint nhận payload scanner (QR + barcode), validate topology, tạo Cargo + TR |
| FR-02 | Manual Cargo Creation | UI form cho Operator/Admin tạo Cargo thủ công |
| FR-03 | Cargo Validation | Validate source=Point[PICKUP], dest=Location[DROPOFF] (BR-07) |
| FR-04 | Source Conflict Check | Chặn tạo Cargo khi source point đã có Cargo ACTIVE |
| FR-05 | Release Engine | Periodic/event-driven scan CREATED tasks, evaluate BR-10, promote → READY_TO_ASSIGN |
| FR-06 | Pickup Point Calculator | Chọn outermost available slot trong PICKUP location (BR-10) |
| FR-07 | Drop-off Point Calculator | Chọn innermost available slot trong DROPOFF location (BR-11) |
| FR-08 | Cargo Debounce Timer | Gom requests trong window trước conflict check (BR-12) |
| FR-09 | Conflict Check Engine | Sau debounce, đảm bảo không có 2 requests cùng target 1 slot |
| FR-10 | AGV Candidate Filter | Lọc AGVs đủ điều kiện: battery > opThreshold, acceptance=ENABLED, not busy (BR-02, BR-05, BR-06) |
| FR-11 | Task Assignment Engine | Tính toán pairing AGV-Task (Hungarian + weighted scoring), tạo TO1 trong FMS |
| FR-12 | Transport Order Creator | Tạo TO trong FMS với `intendedVehicle` (FMS không re-assign) |
| FR-13 | FMS SSE Listener | Stream SSE từ FMS, detect `TO state=FINISHED`, emit domain events |
| FR-14 | Delivery Chaining | Khi TO1 FINISHED → tự động tạo TO2 (DROP_OFF), PICKING_UP → DELIVERING |
| FR-15 | FMS Withdrawal Caller | Gọi FMS withdraw khi TR bị cancel/fail sau khi đã dispatch |
| FR-16 | Cancel Transport Request | Abort task với withdraw nếu cần, chặn cancel ở terminal states (BR-09) |
| FR-17 | Delete Cargo | Soft delete Cargo + auto-cancel TR, chặn khi DELIVERING (BR-08) |
| FR-18 | View Cargo/TR List & Detail | Hiển thị lifecycle info, assigned AGV, visual state (AT_SOURCE/ON_AGV/AT_DESTINATION) |

---

## 3. Core Data Structures

### 3.1 Entities

```typescript
// Cargo — đại diện hàng hoá vật lý
CargoEntity {
  id: UUID
  itemCode: string                    // barcode hàng hoá
  sourcePointName: string             // QR point nguồn (type=PICKUP)
  sourcePickupLocationName: string    // Location gắn với source point
  destinationLocationName: string     // Location đích (type=DROPOFF)
  status: ACTIVE | DELIVERED | CANCELLED
  createdBy: UUID
  deletedAt: Date | null              // soft delete
}

// Transport Task — vòng đời vận chuyển (table: transport_requests)
TransportTaskEntity {
  id: UUID
  requestCode: string                 // TR-{timestamp}-{random}, unique
  cargoId: UUID | null
  status: TaskStatus
  metadata: JSONB {
    assignedVehicleName?: string      // AGV đang execute
    to1Name?: string                  // tên TO pickup trong FMS
    to2Name?: string                  // tên TO dropoff trong FMS
  }
  assignedAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
}
```

### 3.2 State Machine của TransportTask

```
CREATED
   │
   ▼  [ReleaseEngine: BR-10 dependency check]
READY_TO_ASSIGN
   │
   ▼  [AssignmentEngine: AGV selection + TO1 created in FMS]
PICKING_UP  ←── cancel allowed (withdraw TO1)
   │
   ▼  [FMS: TO1 FINISHED → TO2 created]
DELIVERING  ←── cancel BLOCKED (AGV đang mang hàng vật lý)
   │
   ▼  [FMS: TO2 FINISHED]
DELIVERY_COMPLETED ── terminal

Any non-terminal → CANCELLED ── terminal
Any             → FAILED
```

---

## 4. Algorithms

### 4.1 Task Release — BR-10 Outer-before-Inner

**Mục đích:** Chỉ release task khi tất cả slots nằm phía ngoài (gần entrance hơn) đều đang trống.

```
Input: Tập hợp task có status = CREATED

for each task T:
  cargo    = T.cargo
  location = cargo.sourcePickupLocation
  idx      = cargo.pickup_slot.positionIndex  // slot hiện tại của hàng

  # Lấy tất cả slots nằm giữa slot này và entrance (index nhỏ hơn = ngoài hơn)
  blocking_slots = location.slots.filter(s => s.positionIndex < idx)

  is_blocked = blocking_slots.any(s =>
    exists Task where
      task.cargo.pickup_slot = s
      AND task.status IN [PICKING_UP, DELIVERING]
  )

  if NOT is_blocked:
    T.status = READY_TO_ASSIGN
  else:
    record block reason: "Bị chặn bởi hàng tại slot #{blocking_slot.index}"
```

**Trạng thái hiện tại (naive — Phase 4 fix):**
```typescript
// release-engine.service.ts — không có dependency check
const tasks = await this.taskRepo.find({ where: { status: TaskStatus.CREATED } });
for (const task of tasks) {
  task.status = TaskStatus.READY_TO_ASSIGN; // blindly promote tất cả
}
```

### 4.2 Pickup Point Calculator — Outermost Available Slot

**Mục đích:** Trong một PICKUP location có nhiều slots, chọn slot ngoài cùng (positionIndex cao nhất) chưa có task đang chiếm.

```
Input: PICKUP location L

slots = L.locationPoints.sortBy(positionIndex, DESC)  // outer first

for each slot S in slots:
  if no active task (PICKING_UP hoặc DELIVERING) targeting S:
    return S.pointName

return null  // không có slot khả dụng
```

### 4.3 Drop-off Point Calculator — Cascading Depth-First Fill (BR-11)

**Mục đích:** Lấp slot innermost trước để tối đa hoá mật độ, tránh gap.

```
Input: DROPOFF location L

slots = L.locationPoints.sortBy(positionIndex, ASC)  // inner first

for each slot S in slots:
  if S is EMPTY AND no pending TR targeting S:
    return S.pointName

return null  // location đầy
```

### 4.4 Task Assignment Engine — Hungarian Algorithm (implemented)

**Implementation hiện tại:**
```
Input: READY_TO_ASSIGN tasks, danh sách AGVs

Step 1 — Lọc candidate AGVs:
  candidates = AGVs.filter(v =>
    v.battery > v.operationalBatteryThreshold
    AND v.isDispatchEnabled
    AND NOT v.isIgnored
    AND (v đang IDLE/AWAITING_ORDER OR park order có thể preempt)
    AND no task IN [PICKING_UP, DELIVERING] assigned to v
  )

Step 2 — Chọn tối đa N task hợp lệ cũ nhất (createdAt, id), N = số candidate AGV.
  Pickup dependency vẫn được re-check trước khi đưa task vào batch.

Step 3 — Xây dựng cost matrix task × AGV:
  cost[task][agv] = shortestRoadDistance(task.pickupPoint, agv.currentPosition)
  // Dijkstra trên plant-model graph; unknown dùng finite penalty.
  // Pair được graph xác nhận unreachable bị loại và batch được backfill/re-solve.

Step 4 — Chạy Hungarian Algorithm → pairing có tổng quãng đường nhỏ nhất.

Step 5 — Dispatch tuần tự:
  for each (agv, task) in assignments:
    kernelApi.createTransportOrder(TO1, PICK_UP, intendedVehicle=agv)
    TransportTaskService.changeStatus(task, PICKING_UP)
```

Việc giới hạn solver ở FIFO head giữ fairness khi backlog lớn hơn fleet; Hungarian
chỉ tối ưu cách ghép AGV trong batch, không chọn task mới hơn vì ở gần hơn. Weighted
scoring (`weight_urgency`, `weight_proximity`, `weight_inventory_position`) vẫn là
extension point sau khi `dispatch_policies` được nối vào domain/service và có quy
tắc normalization rõ ràng. Nếu một pairing bị block hoặc openTCS từ chối khi
dispatch, capacity còn trống được backfill và ma trận được giải lại trong cycle;
AGV vừa lỗi bị quarantine đến cycle kế tiếp.

### 4.5 Dispatch Scheduling — Debounce Pattern

**Vấn đề starvation tại peak hours:**

Debounce hiện tại là **trailing debounce** — mỗi lần `schedule()` được gọi, timer reset về 0. Nếu cargo đến liên tục với interval < 1500ms, engine không bao giờ chạy.

```
t=0ms:    Cargo A → schedule() → timer fire tại t=1500ms
t=300ms:  Cargo B → schedule() → timer RESET → fire tại t=1800ms
t=600ms:  Cargo C → schedule() → timer RESET → fire tại t=2100ms
...       (engine không bao giờ fire nếu cargo đến liên tục)
```

**Safety net duy nhất hiện tại:** `FMS_EVENTS.VEHICLE_AVAILABLE` — khi AGV hoàn thành task và về IDLE, event này trigger `schedule()`. Nếu tất cả AGV đang bận, không có event này → engine blocked.

**Root cause — lẫn lộn 2 concerns:**

| Concern | SRS thiết kế | Hiện tại |
|---|---|---|
| BR-12 Debounce | Gom requests đến cùng location trong 3s | Bị trộn vào scheduler chung |
| Release Engine | **Periodically scans** Task Pool | Event-driven, bị block bởi debounce |

SRS ghi rõ: *"Task Release Engine: **Periodically** scans the Task Pool"* — Release Engine nên chạy theo interval độc lập, không phụ thuộc vào debounce của cargo creation.

---

## 5. Architecture Backend

### 5.1 Tổng quan

```
┌───────────────────────────────────────────────────────────────┐
│                    WES Backend (NestJS)                       │
│                                                               │
│  ┌──────────────┐  ┌─────────────────────────────────────┐   │
│  │  Controllers │  │          Domain Layer (cargo/)       │   │
│  │  - cargo     │  │                                     │   │
│  │  - agvs      │  │  CargoService  (create/list/delete) │   │
│  │  - zones     │  │  ReleaseEngineService  (CREATED→RTA)│   │
│  │  - maps      │  │  AssignmentEngineService (RTA→PU)   │   │
│  │  - auth      │  │  EventProcessorService (PU→DEL→DONE)│   │
│  └──────────────┘  │  DispatchSchedulerService (debounce)│   │
│                    └─────────────────────────────────────┘   │
│                                    │ EventEmitter2            │
│                    ┌───────────────▼────────────────────┐    │
│  ┌─────────────┐   │    ACL Layer (opentcs/)             │    │
│  │  TypeORM    │   │                                    │    │
│  │  Repos      │   │  KernelApiService  (REST → FMS)    │    │
│  │  PostgreSQL │   │  KernelEventListenerService (SSE ←)│    │
│  └─────────────┘   │  KernelSyncService (AGV telemetry) │    │
│                    └────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
          │ REST                              │ SSE / REST
          ▼                                  ▼
    ┌──────────┐                       ┌───────────┐
    │  Client  │                       │   FMS     │
    │  (React) │                       │ (openTCS) │
    └──────────┘                       └───────────┘
```

### 5.2 Design Patterns

| Pattern | Áp dụng ở đâu | Lý do |
|---|---|---|
| **Anti-Corruption Layer** | `KernelApiService` | Isolate domain khỏi FMS API internals. Mọi call tới openTCS phải qua đây |
| **Event-Driven** | `EventEmitter2`, `@OnEvent()` | Decoupling FMS event → domain state transitions |
| **State Machine (implicit)** | `TransportTask.status` | Explicit status enum + enforced transitions. Phase 2 extract thành `TransportTaskStateMachine` |
| **Debounce/Scheduler** | `DispatchSchedulerService` | Batch vehicle-available events, tránh N dispatch cycles đồng thời |
| **Repository Pattern** | `@InjectRepository(Entity)` | TypeORM repositories, không dùng custom repo classes |
| **Strategy Pattern** *(planned)* | Dispatch Policy weights | Hungarian scoring weights configurable per policy |
| **Soft Delete** | `CargoEntity.deletedAt` | Audit trail, không hard delete business data |
| **Observer** | `KernelEventListenerService` → `eventEmitter.emit()` | FMS SSE stream → domain events |

### 5.3 Module Boundaries

```
CargoModule (domain core)
  providers: [CargoService, ReleaseEngineService, AssignmentEngineService,
              EventProcessorService, DispatchSchedulerService]
  imports: [OpenTCSModule, TypeORM(Cargo, TransportTask)]

OpenTCSModule (ACL + infrastructure)
  providers: [KernelApiService, KernelEventListenerService, KernelSyncService]
  exports: [KernelApiService]

AGVsModule, ZonesModule, MapsModule, AuthModule — independent feature modules
```

---

## 6. Mapping vào Report 4 (SDS)

| Nội dung | Mục trong Report 4 |
|---|---|
| Sequence diagrams (Pickup/Delivery/Cancel flow) | Section 2 — Detailed Design |
| Class specs (attributes, methods, return types) | Section 3 — Class Specifications |
| **Pseudocode algorithms (BR-10, BR-11, Hungarian)** | **Section 4 — Other Design Specifications** |

**Thứ tự viết Report 4 hợp lý:**
1. Chốt class design → entity fields, service boundaries, method signatures
2. Section 4 — Algorithms (ít phụ thuộc nhất vào class cụ thể)
3. Section 3 — Class Specs (dựa trên class đã chốt)
4. Section 2 — Sequence Diagrams (dựa trên cả class lẫn flow)

---

## 7. Known Shortcuts (per CLAUDE.md — có kế hoạch fix)

| Shortcut hiện tại | Phase fix |
|---|---|
| `ASSIGNED_VEHICLE = 'Vehicle-0001'` hardcoded | Phase 3 |
| `ReleaseEngine` release ALL tasks, không check BR-10 | Phase 4 |
| `KernelEventListenerService` đặt nhầm trong `cargo/` (thuộc `opentcs/`) | Phase 1 |
| Direct method call thay vì `eventEmitter.emit()` | Phase 1 |
| Không có explicit `TransportTaskStateMachine` | Phase 2 |
| `DEBOUNCE_MS = 1_500` (code) vs 3s (SRS BR-12); không có periodic fallback | Phase 4 |
