# Thuật toán Hungarian & cách tích hợp vào WES dispatch

> Giải thích **thuật toán Hungarian** (gán tối ưu tối thiểu chi phí) và cách nó được dùng làm
> **bộ điều phối gán task↔xe toàn cục** trong WES. Bổ sung cho `ARCHITECTURE.md` §6.1.
>
> Trạng thái: đã review + 15/15 unit/integration test xanh (2026-07-10).

---

## 0. Một câu tóm tắt

> Thay vì gán **tham lam** từng task cho xe gần nhất (FIFO), WES dựng một **ma trận chi phí
> task×xe** rồi giải bài toán gán bằng **thuật toán Hungarian** để có **tổng quãng đường cả lô là
> nhỏ nhất** — tối ưu **toàn cục**, không phải cục bộ từng task.

Vì sao quan trọng: gán tham lam có thể "cướp" chiếc xe mà một task khác cần hơn. Ví dụ kinh điển
(chính là test tích hợp):

```
                 V1(ở S2)   V2(ở xa)
task t1 (pickup S1):  4        6
task t2 (pickup S2):  0       10

Tham lam FIFO:  t1 lấy V1 gần nhất (4);  t2 đành lấy V2 (10)  → TỔNG 14
Hungarian:      t1→V2 (6);              t2→V1 (0)            → TỔNG 6  ✅
```

---

## 1. Bài toán gán (assignment problem)

Cho `T` task và `V` xe, và chi phí `cost[i][j]` = "quãng đường xe `j` phải đi để tới điểm lấy hàng
của task `i`". Tìm một **cặp ghép một-một** (mỗi task ↔ một xe khác nhau) sao cho **tổng chi phí
nhỏ nhất**. Đây là *minimum-cost bipartite perfect matching* — bài toán mà **thuật toán Hungarian**
(còn gọi Kuhn–Munkres) giải tối ưu trong thời gian đa thức.

- Nếu số task ≤ số xe: mọi task đều được ghép (một số xe rảnh).
- Nếu số task > số xe: chỉ ghép được `V` task; phần dư để lại lô sau.

WES luôn ở nhánh **task ≤ xe** (xem mục 5): mỗi vòng chỉ xét đúng số task bằng số xe rảnh.

---

## 2. Thuật toán Hungarian — trực giác & độ phức tạp

Bản cài đặt ở đây là biến thể **potentials + shortest augmenting path** (Jonker–Volgenant, cùng
họ với bản e-maxx nổi tiếng), không phải bản "kẻ đường che 0" trong sách giáo khoa. Ý tưởng:

- Giữ hai vector **thế năng (potential)** `u[i]` cho hàng (task) và `v[j]` cho cột (xe). Chúng là
  biến **đối ngẫu (dual)** của bài toán LP gán.
- **Chi phí rút gọn (reduced cost)** `cost[i][j] − u[i] − v[j]` luôn ≥ 0; một cặp có reduced cost
  = 0 là "chặt" và có thể vào cặp ghép.
- Thêm **từng hàng một**: với hàng mới, chạy một kiểu **Dijkstra trên chi phí rút gọn** để tìm
  đường tăng luồng (augmenting path) rẻ nhất, cập nhật thế năng dọc đường, rồi lật cặp ghép dọc
  đường đó.

**Độ phức tạp:** `O(n² · m)` thời gian với `n = min(hàng,cột)`, `m = max(hàng,cột)`; bộ nhớ phụ
`O(hàng·cột)`. Với đội vài chục xe thì cực nhanh (dưới mili-giây).

**Vì sao tối ưu:** khi mọi hàng đã thêm xong, các thế năng thỏa điều kiện bù trừ (complementary
slackness) của LP gán → cặp ghép tìm được là **tối ưu toàn cục**, không phải nghiệm địa phương.

---

## 3. Bản cài đặt `hungarian.ts`

File `src/cargo/domain/hungarian.ts` — thuần túy (chỉ số học, không phụ thuộc framework), **không
mutate đầu vào**.

### 3.1 API

```ts
solveHungarian(costMatrix: readonly (readonly number[])[]): {
  assignment: number[];  // assignment[hàng] = cột được chọn, hoặc -1 nếu hàng không ghép
  totalCost: number;
}
```

- `costMatrix` phải **chữ nhật** và **hữu hạn** (validate ở `hungarian.ts:55` —
  ném `TypeError` nếu ragged / gặp `Infinity` / `NaN`; đây là lý do tầng tích hợp phải dùng
  **sentinel hữu hạn** thay cho `Infinity`, mục 5).
- Ma trận rỗng / 0 cột được xử lý sớm (`:21`, `:25`).

### 3.2 Lõi `solveRows()` — yêu cầu hàng ≤ cột (`hungarian.ts:74`)

Mảng **1-indexed**; cột 0 là **cột lính gác (sentinel)** của thuật toán:

```
u[1..hàng], v[1..cột]  = 0          // thế năng
p[0..cột]              = 0          // p[j] = hàng đang ghép với cột j (0 = chưa ghép)
way[0..cột]            = 0          // tiền nhiệm trên đường tăng luồng

với mỗi hàng row = 1..hàng:
  p[0] = row;  j0 = 0
  minSlack[1..cột] = +∞;  used[...] = false
  do:                                     // Dijkstra tìm đường tăng luồng
    used[j0] = true;  i0 = p[j0];  delta = +∞
    với mỗi cột j chưa used:
      cur = cost[i0][j] − u[i0] − v[j]     // chi phí rút gọn
      nếu cur < minSlack[j]: minSlack[j] = cur; way[j] = j0
      nếu minSlack[j] < delta (tie: cột nhỏ hơn thắng): delta = minSlack[j]; j1 = j
    với mỗi cột j:                          // dịch thế năng theo delta
      nếu used[j]: u[p[j]] += delta; v[j] −= delta
      else:        minSlack[j] −= delta
    j0 = j1
  while p[j0] != 0                          // dừng khi chạm cột chưa ghép
  do:                                       // lật cặp ghép dọc đường
    j1 = way[j0];  p[j0] = p[j1];  j0 = j1
  while j0 != 0

assignment[p[j]−1] = j−1  cho mọi cột j có p[j] != 0
```

Vài chi tiết đã kiểm chứng là **đúng**:

- **Thế năng `u/v` và cặp ghép `p` được giữ qua các hàng** (không reset) — đúng bản chất phương
  pháp đối ngẫu; chỉ `minSlack`/`used` là cục bộ mỗi hàng.
- **`way` không cần reset mỗi hàng**: đường tăng luồng chỉ đi qua các cột đã `used` trong hàng
  hiện tại, mà mỗi cột như vậy đều đã được gán `way[]` trong hàng này → tái tạo đường luôn đúng.
- **Tie-break "cột nhỏ thắng"** (`:107-115`): thêm vào để **tất định**; không đổi tính tối ưu (bản
  gốc duyệt tăng dần cũng chọn cột nhỏ nhất đạt min).
- Vòng cập nhật thế năng **có bao gồm cột 0** (`:118`) với `u[p[0]] += delta` — đúng vai trò
  sentinel (`p[0] = row` hiện tại).

### 3.3 Ma trận chữ nhật — giải bằng chuyển vị (`hungarian.ts:29-53`)

Lõi chỉ chạy khi **hàng ≤ cột**. Nếu hàng > cột, code **chuyển vị** ma trận, giải, rồi map kết quả
về:

```ts
if (rowCount <= columnCount) return solveRows(costMatrix);
// ngược lại: giải transpose (cột↔hàng) rồi ánh xạ ngược, các hàng dư → -1
```

`totalCost` ở nhánh này cộng có bảo vệ `column >= 0` để bỏ qua hàng chưa ghép (`:48-51`). *(Trong
WES, tầng tích hợp luôn bảo đảm hàng ≤ cột nên nhánh transpose không bao giờ chạy — nhưng
`hungarian.ts` là tiện ích tổng quát và có test cho cả hai chiều.)*

### 3.4 Vì sao tin là đúng

- **Đối chiếu từng dòng** với bản e-maxx/JV chuẩn: khớp.
- Test `hungarian.spec.ts` có **oracle vét cạn** (`bruteForceMinimum`) so tổng chi phí với tìm
  kiếm brute-force cho **mọi** ma trận `rows,cols ∈ [1..4]` → luôn bằng nhau, và kiểm mỗi hàng ghép
  đúng số & không trùng cột.
- Chạy thực tế: **7/7 test core xanh**.

---

## 4. Tầng tích hợp — "Hungarian dispatcher"

Chuỗi lắp ghép:

```
routing.ts (Dijkstra)  ─┐
                        ├─> dispatch.policy.ts (dựng ma trận + gọi solveHungarian)
VehicleCandidate/task ──┘            │
                                     ▼
        assignment-engine.service.ts (vòng lặp batch, side-effect tạo order)
```

### 4.1 Nguồn chi phí: `routing.ts` (`src/cargo/domain/routing.ts`)

- `buildRoadGraph()` (`:31`): dựng đồ thị **vô hướng** có trọng số từ path của plant-model (mỗi
  path thêm **cả hai chiều**; độ dài < 0 hoặc không hữu hạn bị kẹp về 0 vì Dijkstra cần trọng số
  không âm).
- `shortestDistancesFrom()` (`:54`): Dijkstra một-nguồn (min-heap nhị phân), trả **khoảng cách từ
  điểm lấy hàng tới mọi điểm**. Điểm không tới được → **vắng mặt** khỏi map (caller hiểu là ∞).
- `RoutingService.getRoadGraph()` (`routing.service.ts:29`): cache đồ thị theo **định danh object**
  của plant-model — chỉ dựng lại khi model đổi. Path `locked` bị loại (`:51`).

> ⚠️ Đồ thị là **vô hướng** trong khi map thật có path **một chiều**. Xem mục 7 (giới hạn kế thừa).

### 4.2 Dựng ma trận chi phí — `planVehicleAssignments()` (`dispatch.policy.ts:111`)

Đây là phần **khéo nhất**. Ba loại cặp (task, xe) — `evaluatePair()` (`:191`):

| Loại | Khi nào | Chi phí đưa vào ma trận |
|---|---|---|
| **reachable** | có đồ thị + xe đã định vị + khoảng cách hữu hạn ≥ 0 | `distance` (thật) |
| **unknown** | thiếu đồ thị / xe chưa định vị (chưa biết, **chưa phải bất khả**) | `unknownCost` |
| **unreachable** | đồ thị xác nhận **không tới được** | `unreachableCost` |

Hai sentinel (`:129-131`):

```ts
const D          = maxDistance;               // khoảng cách hữu hạn lớn nhất trong ma trận
const batchScale = selectedTasks.length + 1;  // = T + 1
const unknownCost     = (D + 1) * batchScale;         // = (D+1)(T+1)
const unreachableCost = unknownCost * batchScale;      // = (D+1)(T+1)²
```

**Tại sao hai công thức này đúng — thứ tự ưu tiên từ điển (lexicographic):**
mục tiêu là Hungarian phải **(1) tối đa số cặp khả thi → (2) tối thiểu số cặp unknown → (3) tối
thiểu tổng khoảng cách**. Chứng minh gọn (T cặp được ghép, mỗi khoảng cách ≤ D):

- Tổng khoảng cách của một lô ≤ `T·D`. Mà `unknownCost = (D+1)(T+1) = DT+D+T+1 > T·D`.
  → **một** cặp unknown đắt hơn **toàn bộ** khoảng cách của một lô reachable đầy đủ. Nên giảm số
  unknown luôn thắng việc giảm khoảng cách. Chi phí của lô có `k` unknown nằm trong
  `[k·U, k·U + T·D)`, và vì `T·D < U` nên các khoảng này **rời nhau & xếp thứ tự theo k**.
- Tương tự `unreachableCost = U·(T+1) > T·U + T·D` → **một** cặp unreachable đắt hơn **cả** lô
  toàn-unknown tệ nhất. Nên số unreachable là ưu tiên cao nhất.

Kết quả: cực tiểu tổng chi phí ⇔ cực tiểu bộ ba `(số unreachable, số unknown, tổng khoảng cách)`
theo đúng thứ tự — chính xác điều mong muốn. Sentinel **hữu hạn** (không dùng `Infinity`) vì
`solveHungarian` từ chối `Infinity`; có `RangeError` chặn tràn số (`:133`, thực tế không bao giờ
chạm).

Sau khi giải (`:143`), map cột→xe và **bỏ** cặp nào rơi vào `unreachable` (`:145-157`) — một task
bị ép nhận xe unreachable coi như **không** được điều phối lô này.

### 4.3 Vòng lặp batch — `assignment-engine.service.ts` (`run()`, `:73`)

```
1. Lấy task READY_TO_ASSIGN theo FIFO (createdAt, id).
2. buildCandidates(): ghép registry AGV + telemetry FMS → VehicleCandidate,
   đánh dấu hasActiveTask (đang bận), preemptibleParking (đang đi đỗ, có thể kéo về).
3. Lặp:
   a. fillPendingTasks(): nạp task tới sức chứa = số xe eligible; bỏ qua task bị chặn
      (pickupDependency.isBlocked) hoặc thiếu điểm lấy hàng; nạp sẵn distanceByPoint (cache Dijkstra).
   b. planVehicleAssignments(xe eligible, task) → cặp ghép Hungarian.
   c. Task không được ghép & KHÔNG có xe khả dụng nào (hasDispatchableVehicle=false)
      → hoãn (defer), gỡ khỏi pending.  (unreachable thật sự)
   d. Với mỗi cặp: re-check isBlocked ngay trước side-effect; rồi assign():
        - nếu xe đang đi park order → withdraw (preempt) trước;
        - tạo TO1 "PICKUP-<uuid>" với intendedVehicle = xe, prop wes:taskId;
        - task → PICKING_UP.
      assign lỗi → **quarantine** xe cho lô này, tiếp cặp khác, backfill sau.
      task bị chặn giữa chừng → break, re-solve phần còn lại.
```

**Điểm eligibility** — `isEligible()` (`dispatch.policy.ts:34`):

```ts
dispatchEnabled && !ignored && (available || preemptibleParking)
  && !hasActiveTask && energyLevel > operationalThreshold
```

**Bất biến quan trọng (đã kiểm):** vòng lặp **luôn tiến triển & kết thúc** — mỗi vòng hoặc gán ≥1
task (đánh dấu xe bận → co eligible), hoặc hoãn ≥1 task unreachable (co pending), hoặc break. Không
có vòng lặp vô hạn: nếu `assignments` rỗng thì mọi task đã chọn đều unreachable → tất cả bị
`hasDispatchableVehicle=false` → hoãn hết. `uniqueEligibleVehicles` còn **khử trùng tên** phòng
registry lỗi gán một AGV hai lần (`:170-184`).

---

## 5. Ví dụ end-to-end (dùng chính test tích hợp)

```
Xe:  V1 ở S2,  V2 ở V2-POS.   Đồ thị: S2—(4)—S1—(6)—V2-POS
Task: t1 pickup S1,  t2 pickup S2  (FIFO).

distanceByPoint[t1] (từ S1): {S1:0, S2:4, V2-POS:6}
distanceByPoint[t2] (từ S2): {S2:0, S1:4, V2-POS:10}

Ma trận chi phí (hàng=task, cột=xe V1,V2):
        V1   V2
  t1 [   4    6 ]
  t2 [   0   10 ]

solveHungarian → assignment = [1, 0]   (t1→cột1=V2, t2→cột0=V1)
Tổng = 6 + 0 = 6   (tham lam FIFO sẽ là 4 + 10 = 14)

→ Tạo TO1 PICKUP cho t1 trên V2 (distanceToSource=6), t2 trên V1 (0).
```

Đúng như log chạy thật: `Hungarian plan: t1->V2(6) t2->V1(0)`.

---

## 6. Ánh xạ code ↔ khái niệm

| Khái niệm | Vị trí |
|---|---|
| Lõi Hungarian (JV/potentials) | `domain/hungarian.ts` — `solveRows` (`:74`) |
| Chữ nhật qua transpose | `hungarian.ts:29-53` |
| Validate hữu hạn/chữ nhật | `hungarian.ts:55` |
| Dựng ma trận + sentinel | `domain/dispatch.policy.ts` — `planVehicleAssignments` (`:111`) |
| Phân loại cặp | `dispatch.policy.ts` — `evaluatePair` (`:191`) |
| Eligibility | `dispatch.policy.ts` — `isEligible` (`:34`) |
| Nguồn khoảng cách (Dijkstra) | `domain/routing.ts` (`:54`), `routing.service.ts` (`:29`) |
| Vòng lặp batch + side-effect | `assignment-engine.service.ts` — `run` (`:73`), `assign` (`:306`) |

---

## 7. Giới hạn & lưu ý (không phải bug, nhưng cần biết)

1. **Đồ thị chi phí là VÔ HƯỚNG**, còn map thật có path **một chiều** (`maxReverseVelocity=0`).
   Nên khoảng cách dùng để gán là **ước lượng vô hướng**: một xe nằm trong "bẫy một chiều"
   (xem ghi chú dự án `park-area-one-way-trap`) vẫn bị coi là "reachable" với chi phí hữu hạn →
   Hungarian có thể gán task cho nó → kernel (định tuyến **có hướng**) không route được → order
   nằm `DISPATCHABLE`, task kẹt `PICKING_UP`. **Đây là giới hạn KẾ THỪA** từ luật nearest-vehicle
   cũ (cũng dùng đồ thị vô hướng), **không phải do Hungarian gây ra** — nhưng Hungarian không sửa
   nó. Nếu cần, cho `buildRoadGraph`/Dijkstra tôn trọng chiều path.
2. **Mục tiêu là tổng (utilitarian)**, không phải makespan (min-max). Đây là lựa chọn thiết kế —
   tối thiểu tổng quãng di chuyển đội, có thể để một xe đi khá xa nếu điều đó giảm tổng.
3. **Chi phí chỉ tính chặng tới điểm lấy hàng** (pickup), chưa tính chặng giao (dropoff) — hợp lý
   vì thời điểm gán mới chỉ commit chặng PICKUP.
4. **Chặn tràn số** ném `RangeError` thay vì suy biến — chấp nhận được (thực tế không chạm với
   quãng đường mm và đội vài chục xe).

---

## 8. Kiểm thử

| File | Kiểm |
|---|---|
| `domain/hungarian.spec.ts` | vuông/chữ nhật cả hai chiều, âm, tất định, rỗng, ragged/∞ ném lỗi, **oracle vét cạn** tới 4×4 |
| `assignment-engine.hungarian.spec.ts` | tối ưu toàn cục vs tham lam, bỏ task bị chặn + backfill, re-plan, quarantine xe lỗi, hoãn task unreachable, khử trùng tên xe |

Chạy: `npx jest src/cargo/domain/hungarian.spec.ts src/cargo/assignment-engine.hungarian.spec.ts`
→ **15/15 xanh** (xác nhận 2026-07-10).

---

## 9. Kết luận review

Bản cài đặt **đúng** ở cả hai tầng:

- **Lõi Hungarian**: bản port JV/e-maxx trung thực; thế năng/cặp ghép giữ qua hàng, đường tăng
  luồng & tái tạo đúng, xử lý chữ nhật + validate + bất biến (không mutate) + tất định. Oracle
  vét cạn xác nhận tối ưu.
- **Tích hợp**: hệ sentinel `reachable < unknown < unreachable` cho thứ tự từ điển **đã chứng minh
  đúng**; vòng lặp batch tiến triển & kết thúc, xử lý gọn các ca biên (chặn/quarantine/unreachable/
  trùng tên).

Điểm cần **theo dõi** (không chặn): giới hạn **đồ thị vô hướng** ở mục 7.1 có thể khiến dispatcher
gán task cho xe mà kernel không route được trên map một chiều — nên cân nhắc cho routing chi phí
tôn trọng chiều path để khớp với bộ định tuyến có hướng của kernel.

---

*Tài liệu theo mã nguồn tại thời điểm 2026-07-10.*
