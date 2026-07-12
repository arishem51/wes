# Kế hoạch nâng cấp WES Dispatch

> **Phạm vi:** (A) đấu weights đa tiêu chí (urgency/inventory) vào Hungarian cost; (B) claim + outbox
> để dispatch **exactly-once** giữa openTCS và cập nhật trạng thái task.
> **Trạng thái:** KẾ HOẠCH (chưa code). Soạn từ điều tra + thiết kế + phản biện đối kháng (14 agent).
> **Cập nhật 2026-07-11 — ĐÃ CHỐT hướng Phần A:** urgency là tín hiệu **DẪN XUẤT** (tuổi chờ +
> blocking-count), **KHÔNG** dùng priority client-set (người dùng tự định nghĩa ⇒ inflation, thang đo chủ
> quan); pin×chuyến làm tiêu chí per-pair trong ma trận; sửa đồ thị chi phí thành **CÓ HƯỚNG**.
> Quyết định #1/#2/#3 (mục 3) đã chốt; #4–#6 còn treo.
> **Nguyên tắc xuyên suốt:** mọi thứ **off-by-default**, hệ thống đang chạy live không đổi hành vi cho tới khi bật cờ.

---

## 0. TL;DR — 3 sự thật phải quyết trước khi code

1. **⚠️ "Weighted pairing" phần lớn BẤT ĐỘNG cho bài toán hiện tại.** Vì mỗi lô có `T ≤ V`
   (`dispatch.policy.ts:116` cắt `selectedTasks = tasks.slice(0, vehicles.length)` → mọi task đều được
   ghép), nên: `weight_proximity` **không bao giờ đổi được cặp ghép** (nhân vô hướng lên mục tiêu duy
   nhất không đổi argmin); tham số **per-task** chỉ đổi được **thứ tự CHỌN task** (Stage-A), và chỉ khi
   backlog > xe rảnh. Muốn đổi **CẶP GHÉP** thì tiêu chí phải là **per-pair** → đã chốt dùng
   **pin×chuyến** (mục A.2) + sửa distance thành **có hướng**.

2. **ĐÃ CHỐT: urgency = tín hiệu DẪN XUẤT, không cần cột mới/DTO.** Client-set priority bị **loại**
   (ai cũng tự cho đơn mình gấp nhất — priority inflation; thang đo chủ quan, không kiểm chứng được).
   Thay bằng: **tuổi chờ** (`created_at`, có sẵn) + **blocking-count** (số task bị nó chặn — suy từ
   lane-geometry `pickup-dependency`, logic có sẵn). `weight_inventory` **hoãn** (nghĩa chưa rõ: vị trí
   kệ vật lý vs tồn kho số lượng — cái sau chưa có field nào; destination slot late-bound tới TO2).

3. **Claim/outbox có 1 blocker mà 3 critic cùng chỉ ra:** ai sở hữu chuyển trạng thái leg APPROACH.
   Đã có lời giải rõ (một chủ sở hữu duy nhất mỗi leg). Toàn bộ blocker/major đều **vá được** — kế
   hoạch dưới đã lồng sẵn.

---

## 1. Phát hiện điều tra (nền tảng, đã kiểm chứng bằng code)

| Chủ đề | Sự thật | Bằng chứng |
|---|---|---|
| Cost hiện tại | 1 scalar/cặp = Dijkstra distance thuần; FIFO chọn task | `dispatch.policy.ts:191,60-81` |
| Signal urgency | KHÔNG có cột priority/deadline; chỉ có `created_at` (đang dùng làm FIFO) | `transport_requests` schema `320-341`; entity `20-27` |
| Signal inventory | KHÔNG có số lượng/tồn; vị trí hình học có (points x/y, zone, position_index) nhưng chưa surface | `schema.sql:309-318,276-282` |
| weights dead-config | `weight_urgency/proximity/inventory_position` chỉ xuất hiện trong schema.sql + ERD.md — **không .ts nào đọc** | grep repo → chỉ schema/ERD/report |
| Order-flow | Mọi dispatch là **openTCS side-effect TRƯỚC, DB commit SAU** (không nguyên tử) | `assignment-engine.ts:344→369`; saga TO2/TO3 |
| Transaction | Chỉ `cargo.service`, `zone.service`, `saga.commitDropoffSlot` dùng `dataSource.transaction`; changeStatus là `save()` thuần | `transport-task.service.ts:70` |
| Scheduler | Singleton mỗi process; single-flight `isFlushing` chỉ trong-bộ-nhớ → **không** serialize giữa replica | `dispatch-scheduler.ts:18,62` |
| Ràng buộc | openTCS chỉ qua `kernel-api.service.ts`; entity→DTO; không sửa migration cũ; tránh @nestjs/schedule; ARCHITECTURE.md là source-of-truth | CLAUDE.md, ARCHITECTURE.md |

---

## PHẦN A — Weighted multi-criteria cost

### A.1 Sự thật toán học (quyết định toàn bộ thiết kế)

Với `T ≤ V`, bài toán gán ghép **mọi** task. Cộng một hằng số per-task vào **toàn bộ một hàng** là
*matching-invariant* (không đổi cặp tối ưu). Do đó:

- **`weight_proximity` bất động cho pairing** — nhân vô hướng lên mục tiêu duy nhất không đổi argmin.
- **`weight_inventory` = nhân 0** (không signal).
- **`weight_urgency`** chỉ có đòn bẩy thật ở **khâu CHỌN task (Stage-A)**, và chỉ khi **backlog > xe rảnh**.

> 🔴 **Bẫy do critic correctness-hierarchy phát hiện:** thiết kế gốc định nhét composite cost vào
> **chỉ nhánh `reachable`** của `evaluatePair`, KHÔNG vào ô `unknown/unreachable`. Khi đó hằng số
> per-task chỉ cộng vào **một phần hàng** → **KHÔNG còn invariant** → urgency **âm thầm đổi pairing**
> đúng lúc xe chưa định vị (sau boot / reload map) — nơi cần dự đoán được nhất. Và test "matching-
> invariance" sẽ pass rỗng (chỉ khi all-reachable) → false confidence.

### A.2 Thiết kế đã chốt — "per-pair matrix (distance có hướng + pin) + urgency DẪN XUẤT qua Stage-A"

**Hai tầng, tách bạch:**

- **Stage-A (CHỌN task — đòn bẩy urgency dẫn xuất):** thay `ORDER BY createdAt` bằng re-sort ổn định theo
  `selectionScore = normAge + w_urgency·normBlocking`.
  - `normAge = (now − createdAt)/AGE_HORIZON` **không chặn trên** → task đủ già cuối cùng vượt mọi task
    "gấp" mới (giữ chống đói); tie-break `createdAt,id`. `w_urgency=0` ⇒ **đúng FIFO hôm nay**.
  - `normBlocking = clamp(blockingCount/BLOCK_MAX, 0, 1)` — **số task READY khác đang bị task này chặn**
    trong cùng lane (suy từ lane-geometry của `pickup-dependency`): giải task chặn đầu lane mở khóa cả
    chuỗi phía sau. Khách quan, hệ thống tự đo, không ai khai gian được.
- **Stage-B (MA TRẬN — per-pair thật):** `evaluatePair` reachable trả
  `cost = distance · (1 + w_batt·(1−normBattery))`, với `normBattery = clamp(energyLevel/100, 0, 1)`
  (đã có sẵn trong `VehicleCandidate`). **Pin×chuyến** là tiêu chí per-pair đúng nghĩa nên đổi cặp ghép
  một cách chính đáng: xe yếu pin nhận chuyến gần, xe khỏe nhận chuyến xa. **KHÔNG** nhét tiêu chí
  per-task (urgency/inventory) vào ma trận — xóa bỏ cái bẫy A.1. `w_batt=0` (mặc định) ⇒
  `cost = distance` y hệt hôm nay. Giữ field `distance` thô riêng cho log/telemetry.
- **Nền tảng cost — distance CÓ HƯỚNG:** sửa `buildRoadGraph` chỉ thêm chiều ngược khi
  `maxReverseVelocity > 0`. Distance hiện là ước lượng **vô hướng** trên map **một chiều** — nguồn sai
  số lớn nhất của cost (caveat mục 7 tài liệu Hungarian: xe kẹt trong bẫy một chiều vẫn bị coi là
  "reachable"). Sửa cái này giá trị hơn mọi weight, và độc lập triển khai được trước.

> **ĐÃ CHỐT (Quyết định #1):** urgency chỉ qua Stage-A selection, KHÔNG multiplicative coupling.
> Pairing chịu ảnh hưởng bởi tiêu chí per-pair (distance có hướng + pin), không bởi tiêu chí per-task.

### A.3 Chuẩn hóa AN TOÀN (đã lồng fix critic)

- **Mọi tín hiệu chuẩn hóa phải CLAMP về [0,1]** (không chỉ chia): `normBlocking =
  clamp(count/BLOCK_MAX)`, `normBattery = clamp(energyLevel/100)`. Không clamp ⇒ giá trị ngoài miền tạo
  cost âm/quá cỡ ⇒ `evaluatePair` (điều kiện `distance ≥ 0`, `dispatch.policy.ts:201`) **âm thầm xếp
  "unreachable" và LOẠI cặp**, hoặc assert ném lỗi → **cả flush chết** (task "độc" đứng đầu batch ⇒
  outage lặp lại). Dạng pin nhân `distance·(1+w_batt·(1−normBattery))` với các norm đã clamp luôn ≥ 0 và
  hữu hạn theo cấu trúc — vẫn giữ assert làm lưới cuối.
- **Divide-by-zero:** khi mọi giá trị bằng nhau (`max−min ≤ EPS`) → trả `0` cho tất cả (hằng số, vô hại).
- **Chống đói không rỗng:** thời gian vượt = `AGE_HORIZON·w_urgency` (vì `normBlocking ≤ 1`). → **clamp
  weight thấp (0..10)** và/hoặc **trần tuổi cứng** (task quá `AGE_MAX` nhảy lên đầu bất kể weight).
  Validate `BLOCK_MAX>0`, `AGE_HORIZON>0` (0 ⇒ NaN ⇒ `Array.sort` không xác định).

### A.4 Loader policy — KHÔNG cache-lỗi

Thiết kế gốc "cache tới khi invalidate()" **mâu thuẫn**: gọi `getActive()` mỗi flush chỉ trả **giá trị
cache cũ**, không đọc lại; kích hoạt policy có thể không có tác dụng tới khi restart; multi-replica mỗi
process cache khác nhau. → **`getActive()` luôn chạy `findOne({where:{isActive:true}})` mỗi flush**
(1 truy vấn indexed, flush đã debounce 1.5s nên rẻ), hoặc TTL ngắn. Không có active policy → trả `null`
→ engine đi **fast-path FIFO + distance thuần** (an toàn tuyệt đối).

### A.5 Signal urgency — đường ghi thật (fix major signal-availability)

**KHÔNG có transport-request DTO.** Task sinh trong `CargoService.create()` (`cargo.service.ts:128-137`)
từ `CreateCargoDto` (chỉ `itemCode?/sourcePointName/destinationZoneId`). → phải:
1. Thêm `priority` vào `CreateCargoDto` (`@IsInt @IsOptional @Min(0) @Max(P_MAX)`).
2. Thread qua `CargoService.create(dto,userId)`, **denormalize `priority` lên task** trong **chính
   transaction advisory-lock per-zone đang có** (không phải ghi riêng).
3. Cột `priority SMALLINT NOT NULL DEFAULT 0` trên `transport_requests` — default 0 ⇒ chưa task nào gấp
   ⇒ term urgency đồng loạt 0 ⇒ **matching-invariant** tới khi có dữ liệu ⇒ an toàn.
4. Test: client gửi priority → round-trip xuống `transport_requests.priority`.

> Files phải đụng (thiết kế gốc **bỏ sót**): thêm `cargo.dto.ts` + `cargo.service.ts` vào change set.

### A.6 Inventory — HOÃN (không map vào cost lúc này)

Nghĩa chưa rõ (vị trí kệ vật lý vs tồn kho số lượng — cái sau không có field). Destination slot late-bound
(null tới TO2). → **map cột vào entity cho đủ, nhưng để `inventoryNorm=0` (inert)** và **ghi rõ chỉ 1/3
weight (urgency) thực sự sống** sau feature này. Là **Quyết định #2**.

### A.7 Files / migration / test (Phần A)

- **Entity/loader:** `entities/dispatch-policy.entity.ts` (map `dispatch_policies`, KHÔNG `@DeleteDateColumn`),
  `dispatch-policy.service.ts` (findOne mỗi flush).
- **Domain thuần:** `domain/dispatch-cost.ts` (+`.spec.ts`, yêu cầu 100% branch): `minMaxNormalize` (clamp),
  `compositeCost` (assert finite & ≥0).
- **Cost path:** `domain/dispatch.policy.ts` — `PairEvaluation.reachable` thêm `cost`; sentinel dùng
  `maxCost` thay `maxDistance`; **fast-path**: no policy ⇒ `cost=distance` byte-identical.
- **Engine:** `assignment-engine.service.ts` — inject loader; Stage-A re-sort tại dòng ~74 (áp lên mảng
  nguồn trước fill, backfill giữ thứ tự); giữ `distanceToSource` thô.
- **DTO/creation:** `cargo.dto.ts`, `cargo.service.ts` (priority).
- **Migration:** 1 file idempotent — `CREATE TABLE IF NOT EXISTS dispatch_policies` (no-op nếu DB bootstrap
  từ schema.sql) + `ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL
  DEFAULT 0` (PG≥11 = metadata-only, an toàn live) + partial-unique `is_active WHERE is_active`. Cập nhật
  `database/schema.sql`. **Không sửa migration cũ.**
- **Test:** normalize/clamp/divide-by-zero; compositeCost ≥0 & finite; **regression: no-policy ⇒ 15/15 y
  hệt**; sentinel-hierarchy giữ với composite; determinism; **Stage-A starvation crossover**; e2e
  proximity-only == no-policy; urgency>0 kéo task gấp lên đầu **khi backlog**.
- **Write-path policy (CRUD kích hoạt):** controller có `@UseGuards(JwtAuthGuard,RolesGuard)`, DTO-in/DTO-out,
  enforce 1 active, ghi `event_log` cùng transaction (**lưu ý:** §8 AuditService **chưa tồn tại** trong src
  — phải xây hoặc chấp nhận gap). Là **Quyết định #3**.

---

## PHẦN B — Exactly-once: claim + transactional outbox

### B.1 Vấn đề

`assign()` làm 2 việc **ở 2 hệ thống, không nguyên tử**: `createTransportOrder` (openTCS) **rồi**
`changeStatus` (DB). Crash/commit-fail ở giữa ⇒ order sống mà DB vẫn READY ⇒ chu kỳ sau **tạo order thứ
hai**. Đa replica: 2 scheduler cùng `SELECT ... READY_TO_ASSIGN` (không khóa) ⇒ gán trùng.

### B.2 Thiết kế đã sửa — hai pha ngăn bởi 1 commit

- **PHA 1 — CLAIM+INTENT (thuần DB, 1 `dataSource.transaction`):** CAS `UPDATE transport_requests SET
  status='ASSIGNING' WHERE id=? AND status='READY_TO_ASSIGN'` (yêu cầu `affected=1`, thua ⇒
  `StaleTaskStateError` → skip, **chưa có side-effect nào để undo**); ghi `to1Name+assignedVehicleName`
  vào metadata; **insert 1 row `dispatch_outbox`** (order_name = `PICKUP-<uuid>` đúc **một lần**, tái dùng
  mọi retry). Tất cả commit chung.
- **PHA 2 — RELAY (poller riêng):** rút row PENDING, gọi openTCS **idempotent**, rồi CAS-advance task.

**Claim = status-CAS** (marker sở hữu **bền**, sống qua HTTP + crash, mọi replica thấy). `FOR UPDATE SKIP
LOCKED` chỉ dùng **trong relay** để chia row cho đúng 1 replica. Thêm **advisory lock cụm quanh flush** vì
CAS bảo vệ *task* chứ không bảo vệ *xe*.

### B.3 Các BLOCKER/major đã vá (lồng sẵn)

1. **🔴 BLOCKER — ai sở hữu chuyển trạng thái leg APPROACH (3 critic cùng chỉ):** saga advance
   `PICKING_UP→DELIVERING` lúc claim, relay lại advance lần nữa lúc confirm ⇒ `DELIVERING→DELIVERING`
   phi pháp ⇒ **mọi delivery hỏng**, row APPROACH retry vô hạn. **FIX — một chủ sở hữu duy nhất mỗi
   leg:** relay **chỉ** advance `ASSIGNING→PICKING_UP` cho leg **PICKUP**; leg **APPROACH/DROPOFF** giữ
   nguyên `DELIVERING`, **saga** đổi trạng thái lúc claim, **relay chỉ đánh DONE, KHÔNG đổi status** cho 2
   leg đó (và tolerate transition đã thỏa → skip `changeStatus` thay vì gọi).
2. **🔴 BLOCKER — emit-before-commit:** `changeStatus` emit `STATUS_CHANGED/COMPLETED/FAILED` **đồng bộ**
   ngay sau save; bọc trong transaction caller ⇒ event bắn **trước commit** ⇒ rollback ⇒ phantom event
   (COMPLETED/FAILED có consumer thật: websocket, cargo-completion). **FIX:** khi có `manager`, **buffer
   event, chỉ flush sau commit** (afterCommit hook hoặc trả event list cho caller emit).
3. **🔴 BLOCKER — CAS-always phá "byte-identical":** biến `changeStatus` thành CAS-luôn đổi failure-mode
   **mọi** caller (ném `StaleTaskStateError`) kể cả cờ tắt. **FIX:** CAS **chỉ khi** caller truyền
   `expectedFrom/manager` (claim + relay + saga guard); caller cũ giữ `save()` mù ⇒ tắt cờ = y hệt hôm nay.
4. **major — `recordTransition` nuốt lỗi trong shared txn:** PG abort cả transaction sau lỗi đầu; nuốt
   rồi chạy tiếp ⇒ outbox insert + commit fail "transaction is aborted". **FIX:** trong shared txn để lỗi
   **propagate** (rollback nguyên khối) — hoặc SAVEPOINT.
5. **major — relay giữ DB connection suốt HTTP ~10s:** cạn pool → treo cả app. **FIX — lease:** txn1 đánh
   `DISPATCHING+locked_at` rồi **commit (nhả conn)**; gọi HTTP **không giữ conn**; txn2 CAS `DONE`+advance;
   **sweeper** thu hồi lease quá hạn. `SKIP LOCKED` chỉ để claim row ngắn.
6. **major — success detection sai:** `getTransportOrderState != null` gồm cả `WITHDRAWN/FAILED/UNROUTABLE`
   ⇒ false "delivered". **FIX:** chỉ coi **state sống** (`RAW/DISPATCHABLE/BEING_PROCESSED/FINISHED`) là
   success; xác nhận **chuỗi state chính xác của openTCS trước khi ship** (prerequisite blocking).
7. **major — give-up để order sống + task FAILED (orphan):** create đã thành công, cap attempts ⇒ FAILED
   nhưng xe vẫn chạy. **FIX:** trước khi FAIL, **`withdrawTransportOrder(order_name)` (idempotent)**; mặc
   định cap → **FAILED+withdraw** (KHÔNG rollback→READY, tránh gán trùng); chỉ rollback sau khi
   `getTransportOrderState` xác nhận **không** có order.
8. **major — cờ rời gây gán trùng xe:** outbox-on + lock-off + >1 replica ⇒ 2 replica gán 2 task khác
   nhau cho **cùng 1 xe**. **FIX:** **ràng buộc cờ** — outbox-on mà replica>1 thì **bắt buộc** cluster-lock
   (fail startup nếu thiếu). Nói rõ: exactly-once cho **xe** hoàn toàn dựa vào advisory lock.
9. **major — advisory lock SESSION rò trên pool:** nếu quên unlock, lock kẹt trên pooled connection → treo
   dispatch cả cụm. **FIX:** dùng `pg_advisory_xact_lock` (tự nhả khi commit/rollback) — bọc thân flush
   trong 1 transaction — hoặc dedicated non-pooled conn, hoặc lease-row có expiry. (Repo vốn dùng
   `pg_advisory_xact_lock` — theo cùng kiểu.)
10. **major — enum ADD VALUE chạy trong transaction:** TypeORM mặc định chạy **mọi** migration trong **1**
    transaction ⇒ `ALTER TYPE ADD VALUE` fail (PG<12) / không dùng được cùng txn. **FIX:** set
    `migrationsTransactionMode:'each'|'none'` hoặc `transaction=false` cho migration đó; **xác nhận PG≥12
    (blocking)**; xác nhận đúng tên type `transport_request_status_enum`.
11. **major — không có heal cho DELIVERING-với-outbox-kẹt:** task DELIVERING mà row DROPOFF FAILED/relay
    chết ⇒ `getTransportOrderState(to3Name)=null` ⇒ LegReconcile coi "chưa ngã ngũ, để yên" ⇒ **kẹt mãi**
    (biến thể mới của stale-PICKING_UP trap). **FIX:** mở rộng LegReconcile quét **cả DELIVERING** và
    **đọc row `dispatch_outbox`** (không chỉ hỏi kernel theo tên): PENDING⇒để relay, FAILED/missing⇒re-drive
    hoặc fail theo policy. Áp cho **mọi** leg outbox sở hữu (thêm cả backstop ASSIGNING).
12. **major — module wiring:** `CargoModule` **không export** `TransportTaskService`. **FIX:** export nó,
    `OutboxModule` import `CargoModule` (kiểm forwardRef — claim/saga insert outbox qua manager, không qua
    relay, nên không có cycle). Đừng re-instantiate service.
13. **minor — saga double-fire (SSE + LegReconcile):** insert outbox thứ hai đụng partial-unique `(aggregate_id,leg)`
    → 23505. **FIX:** bắt `23505` + `StaleTaskStateError`, coi như **no-op thành công** (giống guard
    to2Name/to3Name hiện tại).
14. **minor — cột `from` cho CAS:** phải chụp `const from = task.status` **trước** khi state-machine mutate
    `task.status`; WHERE dùng `from` đã chụp, không dùng `task.status` sau mutate.

### B.4 Schema / files (Phần B)

- **Enum:** `ALTER TYPE transport_request_status_enum ADD VALUE IF NOT EXISTS 'ASSIGNING'` (migration
  RIÊNG, transaction=false).
- **Bảng `dispatch_outbox`:** `id uuid PK; aggregate_type varchar; aggregate_id uuid; leg varchar;
  order_name varchar UNIQUE; payload jsonb; status varchar('PENDING'|'DISPATCHING'|'DONE'|'FAILED');
  attempts int; last_error text; locked_at timestamptz; next_attempt_at timestamptz; created_at/updated_at/
  done_at`. Index `(status,next_attempt_at)`; **partial-unique `(aggregate_id,leg) WHERE status IN
  ('PENDING','DISPATCHING')`** (≤1 intent sống/leg). *(Dùng `DISPATCHING` thật vì đi lease model.)*
- **State machine:** `READY_TO_ASSIGN→{ASSIGNING,BLOCKED,CANCELLED}`; `ASSIGNING→{PICKING_UP,
  READY_TO_ASSIGN(rollback có điều kiện),BLOCKED,CANCELLED,FAILED}`. Cập nhật spec (§12) cùng commit.
- **`busyVehicleNames`** thêm `ASSIGNING` (xe đang relay TO1 không bị tái dùng).
- **Files:** `transport-task.service.ts` (CAS opt-in + event-buffer + recordTransition-propagate),
  `assignment-engine.service.ts` (claim, bỏ openTCS call), `outbox/outbox-relay.service.ts` +
  `outbox/outbox.module.ts` + `app.module.ts` (relay lease, `setInterval` kiểu KernelEventListener,
  **không** @nestjs/schedule), `transport-task.saga.ts` (TO2/TO3 qua outbox), `dispatch-scheduler.service.ts`
  (advisory xact-lock), `leg-reconcile.service.ts` (heal ASSIGNING+DELIVERING qua outbox), migrations +
  `schema.sql`, cập nhật **ARCHITECTURE.md §4.2/§5.4/§12**.

### B.5 Cờ & rollout theo pha (an toàn khi live)

Cờ mặc định = hành vi hôm nay: `DISPATCH_OUTBOX_ENABLED=false` (assign chạy path cũ, relay không khởi
động, không task nào vào ASSIGNING); `DISPATCH_CLUSTER_LOCK_ENABLED=false` (scheduler giữ single-flight
in-memory). CAS opt-in nên tắt cờ = byte-identical thật.

**Pha:** (0) migrate (enum + bảng rỗng, **trơ**) → (1) bật advisory lock → (2) bật outbox cho **TO1**,
kiểm crash-sim ở staging rồi prod → (3) saga TO2/TO3 qua outbox → (4) (tùy) parking + gỡ path cũ.
Rollback tức thì: set cờ về false + redeploy (không cần down-migration).

> ⚠️ **Cửa sổ rolling-deploy:** trong lúc cutover, replica code cũ chạy `assign()` cũ và **không đếm
> ASSIGNING** → có thể gán trùng xe mà replica mới vừa claim. → **gate cứng trong runbook:** ship advisory
> lock ở **release trước**, hoặc cutover **single-replica**.

---

## 2. Thứ tự thực hiện tổng

```
B0  Migrate enum ASSIGNING + bảng dispatch_outbox (trơ)            ── không đổi hành vi
A0  Migrate dispatch_policies entity + cột priority (trơ)          ── không đổi hành vi
─────────────────────────────────────────────────────────────────
B1  changeStatus: CAS opt-in + event-buffer + recordTransition     ← nền cho cả claim & an toàn
B2  Claim (assign) + outbox + relay lease (chỉ TO1) + LegReconcile  ← bật DISPATCH_OUTBOX_ENABLED
B3  Advisory xact-lock flush                                        ← bật DISPATCH_CLUSTER_LOCK_ENABLED
B4  Saga TO2/TO3 qua outbox
─────────────────────────────────────────────────────────────────
A1  dispatch-cost.ts (normalize clamp) + loader findOne/flush
A2  Stage-A urgency selection + priority qua CreateCargoDto/CargoService
A3  Policy CRUD + kích hoạt (guard, audit)                         ← feature mới "sống"
```

B (exactly-once) **nên đi trước** — nó là gap độ-bền có thật ngay bây giờ; A (weights) phụ thuộc quyết
định sản phẩm (Quyết định #1/#2/#3) nên làm sau.

---

## 3. QUYẾT ĐỊNH cần bạn chốt trước khi code

1. **Urgency có cần đổi được PAIRING không, hay chỉ đổi thứ tự CHỌN khi quá tải?**
   - *(a) Chỉ selection (Recommended, an toàn):* đơn giản, không méo mục tiêu tổng-quãng-đường; nhưng
     urgency **không tác dụng khi fleet còn dư xe**.
   - *(b) Multiplicative coupling:* urgency cướp được xe gần lúc tranh chấp; đánh đổi tổng quãng đường +
     phải phân tích kỹ.
2. **"Inventory position" nghĩa là gì?** vị trí kệ vật lý (có data, cần denormalize `position_index`) hay
   **tồn kho số lượng** (chưa có field, phải thêm subsystem)? → khuyến nghị **hoãn**, chỉ làm urgency trước.
3. **Nguồn urgency:** `priority SMALLINT` (client set khi tạo cargo) hay `due_at TIMESTAMPTZ` (SLA)? và ai
   nhập (UI/operator)? Nếu sản phẩm chưa surface được ⇒ cột lại thành placeholder chết như hiện tại.
4. **Topology triển khai:** thực tế chạy **mấy replica**? Nếu chắc chắn **1 replica lâu dài** ⇒ có thể bỏ
   advisory-lock (B3) và giảm độ phức tạp; nếu có kế hoạch scale ⇒ giữ.
5. **Chính sách cap của relay:** `ASSIGNING→FAILED+withdraw+alert` (Recommended) hay rollback→READY sau khi
   xác nhận không có order?
6. **PG version** (≥12 cho enum/partial-index) và **chuỗi state openTCS** (ObjectExists + retention) — 2
   prerequisite **blocking**.

---

## 4. Rủi ro tồn dư (sau khi vá)

- `getTransportOrderState` trả `null` cho **cả** "order bị purge sau FINISHED nhanh" lẫn "GET lỗi tạm" —
  hiếm khi relay đọc null rồi tạo lại (idempotent theo tên nên chỉ 1 order, nhưng cần xác nhận retention).
- Outbox tăng trưởng ⇒ cần job dọn row DONE/FAILED.
- Preempt-withdraw dời vào relay ⇒ xe được giải phóng trễ 1 nhịp poll (thấp).
- Weights: kể cả làm xong, chỉ `weight_urgency` sống và chỉ khi quá tải — cần truyền thông đúng kỳ vọng
  để operator không tưởng chỉnh `weight_proximity=5` là đổi được cách chọn xe.

---

*Soạn từ workflow 14-agent (điều tra + thiết kế + phản biện đối kháng), đã lồng 4 blocker + các major fix. 2026-07-11.*
