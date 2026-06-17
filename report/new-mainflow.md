# Main Flows — SWES

Tài liệu mô tả 3 luồng nghiệp vụ chính (main flows) của SWES. Mỗi main flow trình bày mục tiêu nghiệp vụ, điều kiện kích hoạt, sơ đồ swim-lane, bảng các bước và luồng ngoại lệ.

**Các actor tham gia:**

- `Scanner`: người quét hàng tại hiện trường.
- `WES`: lớp điều phối nghiệp vụ (hệ thống đang xây dựng). Bao gồm Task Pool, Release Engine và Task Assignment engine.
- `FMS (openTCS)`: tầng thực thi đội xe — routing, traffic management, MAPF và giao tiếp AGV. Nhận Transport Order đã được WES gán xe sẵn (`intendedVehicle`).
- `AGV`: xe tự hành thực hiện di chuyển và thao tác lấy/trả hàng.

---

## MF-01 — Lấy hàng (Pickup)

**Mục tiêu nghiệp vụ:** Từ thao tác quét hàng, tạo cargo và task, phát hiện conflict với tasks đang chạy, gán AGV tối ưu và điều phối AGV đến lấy hàng thành công.

**Điều kiện kích hoạt:** Scanner quét hàng, cung cấp source point và destination location.

**Tiền điều kiện:** Topology và location đã được cấu hình; Scanner đã xác thực.

**Swim-lane diagram:**

```plantuml
@startuml
skinparam swimlaneWidth 220

|Scanner|
start
:Quét hàng;
note right: source point\n+ destination location

|WES|
:Tạo Cargo trong hệ thống;
if (Cargo hợp lệ?\nsource + destination valid) then (Không)
  :Ghi nhận lỗi\n& thông báo Scanner;
  stop
else (Có)
endif
:Tạo Task → đưa vào Task Pool;
:Debounce 3s;
note right: Reset mỗi khi có cargo mới\nđược tạo trong window

:Conflict check:\ncargo batch mới có chặn\ntask in-flight không?;
if (Có conflict?) then (Có)
  :Auto-cancel blocked tasks\n(gọi FMS withdrawal API);
  :Re-queue về pool\nvới dependency constraint;
else (Không)
endif

:Release Engine:\ndependency check (outer trước inner)\n→ Candidate Tasks;
if (Có candidate?) then (Không)
  :Tasks chờ trong pool;
  stop
else (Có)
endif

:Hungarian\n(Candidates × AGV eligible\n→ optimal assignment);
if (Assignment khả thi?) then (Không)
  :Tasks chờ trong pool\n(re-trigger khi AGV rảnh);
  stop
else (Có)
endif

:Gọi openTCS API\n(intendedVehicle = AGV được chọn);

|FMS (openTCS)|
:Tạo TO với intendedVehicle;
:Route AGV đến điểm lấy hàng;
:Gửi lệnh cho AGV;

|AGV|
:Di chuyển → Lấy hàng → Báo hoàn tất;

|FMS (openTCS)|
:Callback pickup confirmed về WES;

|WES|
:Cập nhật → PICKUP_COMPLETED;
stop

@enduml
```

**Mô tả theo từng lane:**

- **Scanner:** Quét hàng, cung cấp source point và destination location. **Handoff → WES.**
- **WES:** Tạo Cargo, validate source point và destination location trong topology. Nếu không hợp lệ → ghi lỗi và thông báo. Nếu hợp lệ → tạo Task, đưa vào **Task Pool**, bắt đầu debounce 3s (reset mỗi khi có cargo mới trong window). Sau debounce → **conflict check**: cargo batch mới có nằm ở outer position chặn task đang in-flight không? Nếu có → auto-cancel blocked tasks qua FMS withdrawal API và re-queue về pool với dependency constraint. Tiếp theo, **Release Engine** lọc Task Pool theo dependency rule (outer trước inner) ra Candidate Tasks. **Hungarian algorithm** chạy trên Candidates × AGV eligible → optimal assignment. Sau khi assign → gọi openTCS API với `intendedVehicle`. Nhận callback pickup confirmed, cập nhật `PICKUP_COMPLETED`. **Handoff → FMS.**
- **FMS (openTCS):** Nhận lệnh từ WES, tạo TO với xe đã xác định, route và gửi lệnh cho AGV. Callback kết quả về WES. **Handoff ↔ AGV.**
- **AGV:** Di chuyển, lấy hàng, báo hoàn tất về FMS. **Handoff → FMS.**

**Bảng các bước:**

| Bước | Lane          | Hành động                                                      | Đầu ra / Handoff                           |
| ---- | ------------- | -------------------------------------------------------------- | ------------------------------------------ |
| 1    | Scanner → WES | Quét hàng: source point + destination location                 | WES tạo Cargo                              |
| 2    | WES           | Validate source point + destination location trong topology    | Hợp lệ → tiếp; không → ghi lỗi + thông báo |
| 3    | WES           | Tạo Task → đưa vào Task Pool                                   | Task chờ trong pool                        |
| 4    | WES           | Debounce 3s (reset nếu có cargo mới trong window)              | Sau 3s → trigger conflict check            |
| 5    | WES           | Conflict check: cargo mới có chặn task in-flight không?        | Có → cancel + re-queue; không → tiếp       |
| 6    | WES → FMS     | Auto-cancel blocked tasks qua withdrawal API (nếu có conflict) | Blocked tasks về pool với dependency       |
| 7    | WES           | Release Engine: dependency check → Candidate Tasks             | Tập task eligible để assign                |
| 8    | WES           | Hungarian (Candidates × AGV eligible) → optimal assignment     | Mỗi task được gán AGV cụ thể               |
| 9    | WES → FMS     | Gọi openTCS API với intendedVehicle = AGV được chọn            | FMS tạo TO và thực thi                     |
| 10   | FMS → AGV     | Route + gửi lệnh điều khiển                                    | AGV nhận nhiệm vụ                          |
| 11   | AGV           | Di chuyển → lấy hàng → báo hoàn tất                            | Pickup completed                           |
| 12   | FMS → WES     | Callback pickup confirmed                                      | WES cập nhật → `PICKUP_COMPLETED`          |

**Luồng ngoại lệ:**

- **Cargo không hợp lệ:** source point hoặc destination location không trong topology → ghi lỗi, thông báo Scanner.
- **Task bị block bởi dependency:** outer chưa lấy → nằm pool, re-trigger khi outer task hoàn tất.
- **Không có AGV eligible:** candidate tasks chờ trong pool, re-trigger khi AGV trở thành eligible.
- **AGV gặp sự cố:** FMS callback task failed → WES cập nhật `FAILED`, ghi event log, thông báo Admin.

**Hậu điều kiện:** AGV đã lấy hàng; task ở trạng thái `PICKUP_COMPLETED`; sẵn sàng chuyển sang MF-02 (Trả hàng).

---

## MF-02 — Trả hàng (Delivery)

**Mục tiêu nghiệp vụ:** Sau khi AGV đã lấy hàng, WES điều phối AGV đến location, tính toán điểm trả cụ thể khi AGV đến cột đầu tiên của zone, và xác nhận hoàn tất.

**Điều kiện kích hoạt:** FMS callback `PICKUP_COMPLETED` → WES (tiếp nối trực tiếp từ MF-01).

**Tiền điều kiện:** Task ở trạng thái `PICKUP_COMPLETED`; AGV đang giữ hàng; destination location đã xác định từ lúc scan.

**Swim-lane diagram:**

```plantuml
@startuml
skinparam swimlaneWidth 220

|FMS (openTCS)|
start
:PICKUP_COMPLETED callback\n→ WES;

|WES|
:Cập nhật Task\n→ PICKUP_COMPLETED;
:Tạo TO-approach:\ndestination = first column\ncủa drop-off location;

|FMS (openTCS)|
:Route AGV đến\nfirst column của location;

|AGV|
:Di chuyển đến\nfirst column;

|FMS (openTCS)|
:Callback: AGV arrived\nat first column → WES;

|WES|
:Lock drop-off zone;
:BR-DROP-01: Cascading Depth-First Fill\n→ chọn slot (column + row);
if (Có slot eligible?) then (Không)
  :Unlock zone;\nTask chờ\n(re-trigger khi slot giải phóng);
  stop
else (Có)
endif
:Reserve slot → RESERVED;
:Unlock drop-off zone;
:Tạo TO-dropoff:\ndestination = specific slot;

|FMS (openTCS)|
:Route AGV đến specific slot;
:Gửi lệnh cho AGV;

|AGV|
:Di chuyển → Trả hàng → Báo hoàn tất;

|FMS (openTCS)|
:Callback delivery confirmed → WES;

|WES|
:Slot status → OCCUPIED;
:Cập nhật Task → DELIVERY_COMPLETED;
:Cargo status → DELIVERED;
stop

@enduml
```

**Mô tả theo từng lane:**

- **FMS (openTCS):** Callback `PICKUP_COMPLETED`. Route AGV đến first column của drop-off location (TO-approach). Callback khi AGV arrived. Route AGV đến specific slot (TO-dropoff). Callback delivery confirmed. **Handoff ↔ WES, AGV.**
- **WES:** Nhận `PICKUP_COMPLETED`, tạo TO-approach với destination = first column của location. Khi nhận callback "AGV arrived at first column" → lock zone → chạy **BR-DROP-01** (Cascading Depth-First Fill) để chọn slot theo arrival order (không phải pickup order). Reserve slot. Unlock zone. Tạo TO-dropoff với specific slot. Nhận callback confirmed → cập nhật `DELIVERY_COMPLETED`. **Handoff → FMS.**
- **AGV:** Di chuyển đến first column, sau đó đến specific slot. Trả hàng, báo hoàn tất. **Handoff → FMS.**

**Bảng các bước:**

| Bước | Lane      | Hành động                                                              | Đầu ra / Handoff                                       |
| ---- | --------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| 1    | FMS → WES | Callback `PICKUP_COMPLETED`                                            | WES cập nhật trạng thái task                           |
| 2    | WES → FMS | Tạo TO-approach: destination = first column của drop-off location      | FMS route AGV đến zone entry                           |
| 3    | FMS → AGV | Route AGV đến first column                                             | AGV di chuyển                                          |
| 4    | FMS → WES | Callback: AGV arrived at first column                                  | WES bắt đầu tính slot                                  |
| 5    | WES       | Lock zone → BR-DROP-01 → chọn slot (column + row) → reserve → unlock  | Slot = RESERVED, specific drop-off point xác định      |
| 6    | WES → FMS | Tạo TO-dropoff: destination = specific slot                            | FMS route AGV đến slot                                 |
| 7    | FMS → AGV | Route + gửi lệnh đến specific slot                                     | AGV nhận nhiệm vụ                                      |
| 8    | AGV       | Di chuyển → trả hàng → báo hoàn tất                                    | Delivery completed                                     |
| 9    | FMS → WES | Callback delivery confirmed                                            | WES cập nhật slot OCCUPIED, task `DELIVERY_COMPLETED`  |

**Luồng ngoại lệ:**

- **Không có slot eligible khi AGV tới first column:** zone full hoặc tất cả eligible slots bị block → task chờ tại first column, re-trigger khi slot giải phóng.
- **AGV gặp sự cố khi đang trả:** FMS callback failed → WES cập nhật `FAILED`, release reservation (slot về EMPTY), ghi event log, thông báo Admin.
- **AGV gặp sự cố trên đường đến first column:** FMS callback failed → WES cập nhật `FAILED`, ghi event log.

**Hậu điều kiện:** AGV đã trả hàng đúng vị trí; task ở trạng thái `DELIVERY_COMPLETED`; Cargo `DELIVERED`; slot `OCCUPIED`; AGV eligible cho assignment tiếp theo.

---

## Business Rules

### BR-PICKUP-01 — Outer trước Inner (Pickup zone)

**Rule:** AGV chỉ được lấy hàng tại slot nếu tất cả slots nằm giữa slot đó và lối vào zone đều EMPTY.

**Lý do:** Warehouse layout có lối vào 1 phía. AGV không thể đi xuyên qua pallet. Slot trong cùng chỉ accessible khi các slot ngoài đã được lấy trước.

**Áp dụng tại:** Release Engine (MF-01, bước 7) — dependency check trước khi đưa task vào Candidate set.

---

### BR-DROP-01 — Cascading Depth-First Fill (Drop-off zone)

**Rule:** Khi chọn drop-off point, WES ưu tiên column xa aisle nhất, nhưng đảm bảo chênh lệch giữa các column liền kề không vượt quá MAX_DIFF. Khi bất kỳ cặp column nào vi phạm, ưu tiên fill column gần aisle hơn trước.

```
Ví dụ (3 storage columns, MAX_DIFF=2, aisle ở phải):
col1=deepest, col2=middle, col3=closest to aisle

State      Action   Lý do
(0,0,0) → col1    deepest, no violation
(1,0,0) → col1    diff=1 < MAX_DIFF
(2,0,0) → col2    col1+1 would make diff=3 > MAX_DIFF
(2,1,0) → col1    deepest, no violation
(3,1,0) → col2    col1+1 would make diff=3
(3,2,0) → col3    col2-col3=2, shallowest violation → fix first
(3,2,1) → col1    no violations, deepest first
```

**Eligibility của slot S:** S eligible khi:
1. S = EMPTY
2. Không có slot nào trên path từ aisle đến S đang OCCUPIED hoặc RESERVED (path physically clear)
3. Không có slot inner hơn S trong cùng column đang RESERVED (tránh block AGV khác đang in-transit)

**Lý do trải dàn (không fill hết 1 column):** Xe tải lấy hàng ("xe khách") đón đầu ở điểm cuối zone. Nếu hàng dồn hết 1 column, xe tải phải đi dọc toàn bộ column để lấy. Trải dàn đều theo hàng giúp xe tải lấy hàng gần điểm đón nhất, giảm quãng đường di chuyển.

**Timing:** Tính tại thời điểm AGV arrived at first column của location — không phải PICKUP_COMPLETED. Lý do: arrival order tại first column = thứ tự thực tế AGV đến zone, đảm bảo assignment theo đúng thứ tự vật lý, tránh race condition "AGV gần pickup sau nhưng đến drop zone trước."

**Áp dụng tại:** MF-02 bước 5. WES lock drop-off zone (atomic) khi chạy thuật toán, release sau khi reserve xong.

---

### BR-CONFLICT-01 — Auto-cancel khi phát hiện conflict (3s debounce)

**Rule:** Khi có cargo mới được tạo tại outer position mà outer position đó chặn task đang in-flight (AGV đang di chuyển đến pickup inner), WES tự động cancel task bị chặn và re-queue với dependency constraint.

**Trigger:** Cuối debounce window 3s sau lần tạo cargo cuối cùng trong batch.

**Lý do:** Không thể predict trước khi assign task rằng sau đó sẽ có cargo mới chặn đường. Cancel và re-queue đảm bảo Release Engine đánh giá lại dependency đúng với trạng thái hiện tại.

**Áp dụng tại:** Conflict check (MF-01, bước 5–6).

---

## MF-03 — Cancel & Xóa hàng (Cancel & Delete)

**Mục tiêu nghiệp vụ:** Hủy lệnh vận chuyển đang chạy hoặc đang chờ, và/hoặc xóa cargo khỏi hệ thống. Hai thao tác này có thể xảy ra độc lập hoặc kết hợp.

**Điều kiện kích hoạt:** Admin hoặc Operator thực hiện cancel transport request (UC 3.7) hoặc delete cargo (UC 3.16).

> *(Nội dung chi tiết sẽ được bổ sung)*
