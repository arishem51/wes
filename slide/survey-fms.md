# Khảo sát bản fork openTCS (`opentcs-integration-FMS`) — danh mục MỌI THỨ fork thêm vào

> Mục đích: nhặt nội dung đáng lên slide bảo vệ. Mỗi mục có (a) giải thích đời thường,
> (b) một dòng **vì sao khó**, (c) đường dẫn/hằng số để đối chiếu.
> Mọi số liệu dưới đây **đọc từ code**, không suy từ tên lớp. Chỗ nào tài liệu của chính
> dự án nói khác code thì ghi rõ ở §7.
>
> Ký hiệu: 🔴 = **hạn chế còn mở** (phải nói thẳng khi bảo vệ), 🟡 = doc lệch code.

---

## §0. Bối cảnh — quy mô và cách "fork" (số liệu mở đầu slide)

**openTCS KHÔNG bị fork mã nguồn.** openTCS 7.3.0 là **dependency nhị phân Maven**
(`libs.opentcs.kernel`, `libs.opentcs.commadapter.vda5050` — `opentcs-FMS-kernel/build.gradle:19-21`).
Toàn bộ can thiệp đi qua **điểm mở rộng chính thức**: một file service
`src/main/resources/META-INF/services/org.opentcs.customizations.kernel.KernelInjectionModule`
trỏ tới `org.opentcs.fms.kernel.FMSInjection`. `RunKernel` của openTCS dùng
`Modules.override(defaultModules).with(registeredModules)`, nên `bindRouter`/`bindDispatcher`/`bindScheduler`
của FMS **ghi đè ngầm** bản mặc định — không cần tắt gì, không xung đột binding.

> **Đời thường:** không sửa một dòng nào của openTCS; chỉ cắm thêm mô-đun vào đúng ổ cắm
> mà openTCS đã chừa sẵn, rồi bản của mình được ưu tiên hơn bản gốc.
> **Vì sao khó:** phải tìm ra ổ cắm nào đủ quyền — hook sai tầng thì không nhìn thấy toàn đội (xem §1).

| | Số liệu |
|---|---|
| Mã production | **49 file / 7.338 LOC** |
| Mã test | **44 file / 8.803 LOC** |
| Tỉ lệ | **test nhiều hơn production** (1,20×) |
| Vị trí | 100% nằm ở `opentcs-FMS-kernel`; 4 module còn lại chỉ chứa file `.properties` |

Cấu hình vận hành đáng chú ý (`src/main/resources/.../opentcs-kernel-defaults-custom.properties`,
`src/dist/config/opentcs-kernel.properties`):

- `commadapter.vehicle.vda5050.enabledVersions=` (**rỗng**) — tắt hẳn driver VDA5050 gốc,
  nhường chỗ cho `AubotCommAdapterFactory` (§4).
- `kernelapp.vehicleResourceManagementType=LENGTH_IGNORED` — tắt mô hình chiều dài xe của
  openTCS, vì hình học thân xe đã được xử lý ở tầng MAPF (§3).

---

## §1. Ba mảnh tích hợp — thay/bổ sung cái gì, và vì sao phải hook đúng chỗ đó

### 1.0 Vì sao Dispatcher chứ không phải Router

| Thành phần openTCS 7.3.0 | Bản chất | Hợp với MAPF? |
|---|---|---|
| **Router** | `getRoutes(Vehicle, …)` — hỏi **từng (xe, lệnh)**, route thuần không-gian, **không có lời gọi nào cho cả đội**, không có trục thời gian | ❌ không có chỗ nào nhìn thấy toàn đội |
| **Dispatcher** | `dispatch()` — điểm **DUY NHẤT** có state toàn cục của mọi xe + mọi order | ✅ **nhà của coordination** |
| **Scheduler** | claim/allocate/free loại trừ lẫn nhau trên point + path; **KHÔNG có trục thời gian** | ✅ là tầng chống va chạm — *hợp tác*, không thay |

> **Đời thường:** bộ định tuyến chỉ được hỏi "một xe, một đích" nên nó không có cách nào biết
> xe khác đang định đi đâu; chỉ tầng điều phối mới nhìn thấy cả đội cùng lúc.
> **Vì sao khó:** đây là quyết định kiến trúc **không đảo ngược được** — hook sai tầng thì mọi
> ràng buộc phối hợp phía sau đều vô nghĩa.

**Điểm khái niệm cốt lõi:** Scheduler **không có thời gian** ⇒ không áp được "đặt chỗ theo cửa sổ
thời gian", chỉ áp được **thứ tự ưu tiên không-gian**. Nên "MAPF là bộ não" nghĩa là MAPF **tính kế
hoạch phối hợp** rồi **lái thứ tự allocation** của Scheduler — chứ không bypass nó.

### 1.1 Mảnh ① — `FMSDispatcher extends DefaultDispatcher`

`opentcs-FMS-kernel/src/main/java/org/opentcs/fms/kernel/FMSDispatcher.java`

**Không thay logic gán xe** — `super.dispatch()` vẫn là bộ gán của openTCS. Cái nó **thêm** vào:

1. **Trước** khi gán: `FleetSnapshotService.read()` đọc vị trí + đích của **mọi** xe đã định vị,
   rồi `MapfCoordinator.resolve(...)` chạy **một lần giải MAPF cho cả đội**.
2. **Sau** khi gán: `rerouteChangedVehicles()` chỉ reroute những xe mà route thực sự **lệch** so với
   cache (`routeDiverges` so `pointsFor(...)` với `committedSuffix(...)`). Log
   `[MAPF reroute] {} rerouted, {} kept (route unchanged)`.
3. **Nhịp tự đập:** `HORIZON_TICK_MS = 1_000L` — một `scheduleAtFixedRate` trên `kernelExecutor`
   gọi `dispatch()` khi `coordinator.overdue()`.

> **Đời thường:** mỗi vòng, hệ thống chụp ảnh cả đội xe, giải một bài toán chung cho tất cả,
> rồi mới để openTCS phân việc như cũ.
> **Vì sao khó:** mọi nguồn gọi `dispatch()` của openTCS đều **edge-triggered** (chạy khi có sự
> kiện). Đội đóng băng = không có sự kiện = không ai gọi = **đóng băng vĩnh viễn**. Phải tự đẻ ra
> nhịp đập, và phải `catch (Throwable)` vì `scheduleAtFixedRate` **chết vĩnh viễn** nếu task ném
> exception (`FMSDispatcher.java:97-105`).

**Bẫy đã trả giá — goal trễ một chu kỳ.** `readFleet` từng đọc goal từ route **đã gán**, mà route chỉ
được gán **SAU** `super.dispatch()` ⇒ order vừa tạo bị lập kế hoạch như **không tồn tại**. Vá:
`FleetSnapshotService.pendingGoalsByVehicle()` đọc thẳng đích của order **đang chờ** qua
`intendedVehicle`, chấp nhận cả trạng thái `RAW/ACTIVE/DISPATCHABLE` (`FleetSnapshotService.java:206-213`).

### 1.2 Mảnh ② — `FMSRouter implements Router` (bọc `DefaultRouter` làm delegate)

`.../kernel/FMSRouter.java`

5/7 phương thức uỷ quyền thẳng cho `DefaultRouter`. Chỉ chặn đúng
`getRoutes(vehicle, sourcePoint, order, maxRoutes)`: dựng chuỗi `Route` theo **từng leg** từ cache của
coordinator; **nghi ngờ là rơi về Dijkstra** — có **7 nhánh fallback** riêng biệt (context null,
goal không nằm trên roadmap, `src == goal`, path MAPF không hợp lệ, `buildRoute` rỗng, chain rỗng,
`RuntimeException`). `initialize()` và `updateRoutingTopology()` gọi `coordinator.invalidateModel()`
để roadmap dựng lại lười khi plant model đổi.

> **Đời thường:** khi openTCS hỏi "xe này đi đường nào", ta trả lời bằng đoạn đường đã tính chung cho
> cả đội; không có sẵn thì trả lời bằng đường ngắn nhất như cũ.
> **Vì sao khó:** openTCS coi route là **hợp đồng nguồn→đích**, còn RHCR coi phần đuôi là **giấy nháp**.
> Hai hợp đồng ngược nhau. Chỗ hoà giải là `MapfPlanner.padToGoals` — **cài FULL route xuống tận đích,
> nhưng chỉ phần đầu là có phối hợp**.

### 1.3 Mảnh ③ — Hai `Scheduler.Module` cắm thêm, **GIỮ** `DefaultScheduler`

Đăng ký qua `schedulerModuleBinder()`: `MapfPrecedenceModule` + `RetreatHoldModule` (chi tiết §2).
Collision-freedom vẫn ở `DefaultScheduler`; module chỉ **THÊM ràng buộc thứ tự**.

**⚠️ Tầng Block đã GỠ (2026-08-13).** `FmsSingleVehicleBlockModule` + `BlockCrossings` đã xoá vì MAPF
đã lo phần này, và **mọi map v7 đang chạy có 0 phần tử `<block>`**.
🔴 **Hạn chế còn mở:** `DefaultSchedulerModule` của openTCS **vẫn tự đăng ký `SingleVehicleBlockModule`
bản STOCK** (chặt hơn bản direction-aware cũ) vào multibinder. Nó im lặng **CHỈ VÌ** map có 0 block.
Ngày nào có người vẽ `SINGLE_VEHICLE_ONLY` trong Model Editor, luật stock sẽ khoá **cả block kể cả
junction dùng chung** và cross-traffic sẽ stall — **không test nào bắt được** vì map test cũng 0 block.
*(Phía WES nhất quán: `wes/src/opentcs/domain/apply-blocks.ts` có bộ sinh block `SVB-*` nhưng
**đã comment out ở cả 2 chỗ gọi** — `maps.service.ts:218`, `map-loader.service.ts:58`.)*

### 1.4 Bảng đầy đủ 15 binding (`FMSInjection.java`)

| # | Binding | Tác dụng |
|---|---|---|
| 1-3 | `PrecedenceService`, `FleetSnapshotService`, `MapfCoordinator` (SINGLETON) | dịch vụ FMS mới |
| 4 | `bindRouter(FMSRouter)` | **thay** `DefaultRouter` |
| 5 | `bindDispatcher(FMSDispatcher)` | **thay** `DefaultDispatcher` |
| 6 | `IsAvailableForAnyOrder → FmsIsAvailableForAnyOrder` | **thay** vị từ "xe rảnh?" (§5.3) |
| 7 | `bindScheduler(FMSScheduler)` | **thay** `DefaultScheduler` (§5.1) |
| 8 | `RegularDriveOrderMerger → FmsRegularDriveOrderMerger` | **thay** bộ ghép route khi reroute (§5.2) |
| 9-10 | `schedulerModuleBinder() += MapfPrecedenceModule, RetreatHoldModule` | **thêm** 2 tầng veto (§2) |
| 11 | `V1RequestHandler → FMSV1RequestHandler` | **thay** REST v1, thêm 2 endpoint (§5.5) |
| 12-13 | `extensionsBinderOperating() += WaitDropOffListener, LostNavigationListener` | **thêm** 2 kernel extension (§5.3, §5.4) |
| 14 | `vehicleDataTransformersBinder() += LaserActionTransformerFactory` | **thêm** (§4.5) |
| 15 | `vehicleCommAdaptersBinder() += AubotCommAdapterFactory` | **thêm** driver VDA5050 riêng (§4) |

🟡 Banner log của `FMSInjection` **lệch bindings**: không nhắc `FMSV1RequestHandler`,
`FmsIsAvailableForAnyOrder`, `WaitDropOffListener`, `LostNavigationListener`, `AubotCommAdapterFactory`.

---

## §2. Ràng buộc an toàn cài thêm ở tầng thi hành

### 2.1 `MapfPrecedenceModule` — veto theo ADG **per-visit**

`.../kernel/mapf/MapfPrecedenceModule.java` — `Scheduler.Module`, hook duy nhất có logic là
`mayAllocate` (dòng 109).

Cơ chế:
- `setAllocationState` ghi lại **hàng đợi claim còn lại** của mỗi xe (dòng 66-84) — đây là **tín hiệu
  tiến độ DUY NHẤT** mà module có.
- `nextStepOf(v) = route.size() − claim.size()` (dòng 194-204) = số bước đã tiêu.
- Với mỗi `Point` được xin: tra `byPoint[point]` → danh sách `Visit` có thứ tự; tìm **lần ghé của
  CHÍNH MÌNH tại/ sau bước kế tiếp của mình** (`visit.step() >= myNextStep`, dòng 142-145); nếu mình
  không đứng đầu thì quét tiền nhiệm, tiền nhiệm nào **chưa qua khỏi lần ghé của nó** thì **veto**.
- Log: `[MAPF veto] {} waits at {} for {}`.

> **Đời thường:** kế hoạch chung không được gửi thẳng xuống xe. Nó được dịch thành luật đơn giản
> "xe B phải chờ đến khi xe A đi qua điểm R", và luật đó được cưỡng chế bằng cách **từ chối cấp ô**
> cho xe đến sớm. Xe nhanh hay chậm, thứ tự vẫn giữ.
> **Vì sao khó:** MAPF giả định mọi xe nhích **đồng bộ ở tick t**; openTCS không có đồng hồ chung và
> cấp tài nguyên theo **tiến độ vật lý thực**. Phải dịch "thời gian" thành "thứ tự" mới nối được hai
> mô hình.

**Per-visit là bắt buộc:** route là **WALK** (có điểm lặp, xem §2.6), nên "xe này đã qua điểm R chưa"
không trả lời được bằng tên điểm — phải bằng **chỉ số bước**.

**Không có timeout per-veto.** Đã gỡ `VETO_TIMEOUT_MS = 6s` ngày 2026-07-11: van 6 giây là **fail-open** —
lúc kẹt nhất thì nó bỏ luật, và nó tạo ra swap-deadlock. Thay bằng cơ chế `RetryAllocates` của chính
openTCS + nhịp đập commit-horizon ở §1.1.
🔴 Còn sót plumbing chết: `nanoClock`/`setClock`/`vetoStart`/`vetoElapsedMs`/`prune` giờ **chỉ để
chống lặp một dòng log**, không so với ngưỡng nào.

🔴 **Danh sách fail-open (5 điều kiện trả `true`)** — nên nói thẳng vì đây là mặt trái của thiết kế:
`!initialized`; `byPoint.isEmpty()` (sau `invalidate()` do đổi model ⇒ **ngưng cưỡng chế hoàn toàn**);
`client.getRelatedVehicle() == null`; điểm không nằm trong `byPoint`; tiền nhiệm không `isProcessingOrder()`
(xe idle/biến mất bị **âm thầm bỏ khỏi vai trò chặn**).

### 2.2 `RetreatHoldModule` — giữ ô lùi-nhường **(đây là ràng buộc "ô của xe khác" mạnh nhất)**

`.../kernel/scheduling/RetreatHoldModule.java` + `RetreatHolds.java`

**Đây là chỗ DUY NHẤT trong kernel mà một ô **đang được xe khác đặt trước** khoá cứng việc cấp phát.**

- WES đóng dấu property `wes:leg = "DROPOFF"` lên transport order.
- Kernel đọc các đích `OP_MOVE` của drive order hiện tại + tương lai của order đó = **những ô mà xe sẽ
  lùi vào sau khi hạ hàng** (`RetreatHolds.retreatCells`, dòng 54-77), rồi **veto** mọi xe khác xin ô đó
  (`mayAllocate`, dòng 100-106).
- Luật nới theo làn (`mayTake`, dòng 32-48): nhả nếu người xin **khác cột** (`requester.x() != hold.x()`),
  hoặc đứng **phía trước** ô giữ (`requester.y() < hold.y()`), hoặc người giữ hiện tại **không sâu hơn**.
- Cache đọc lại object pool tối đa mỗi `fms.retreatHold.ttlMs` (mặc định **1.000 ms**). **Không có timer
  cho từng hold** — hold sống đúng bằng vòng đời của order.

> **Đời thường:** xe vừa trả hàng cần lùi ra 2 ô để thoát; hai ô đó được "đặt gạch" trước, xe khác
> không được chen vào — nhưng chỉ trong cùng làn, xe ở làn khác vẫn đi bình thường.
> **Vì sao khó:** ô lùi **chưa có xe nào đứng**, nên tầng cấp phát của openTCS coi nó là ô trống hợp lệ.
> Phải tự dựng khái niệm "ô đã có chủ dù đang trống".

🔴 **Hold KHÔNG đuổi được ai.** Nếu ô lùi đã bị chiếm lúc hold được dựng thì hold vô hiệu — code tự log
cảnh báo `[retreat hold] {} retreat cell(s) already occupied when armed; a hold cannot evict: {}`.
🔴 Sau khi order biến mất, veto còn dư tối đa **1 TTL** (test `theObjectPoolIsReadOncePerIntervalAndTheHoldLiftsAfterIt`).

### 2.3 "Không được né vào ô có cargo" — phía kernel là **GIÁ, không phải LUẬT**

Đây là câu trả lời trực tiếp cho ví dụ phía WES. Kernel **có** một cơ chế tương ứng, nhưng nó **yếu hơn
tên gọi**, và nên nói đúng bản chất:

```java
// routing/Roadmap.java:30
private static final int CARGO_SLOT_SURCHARGE = Math.max(0, Integer.getInteger("fms.mapf.cargoSlotSurcharge", 2));
// routing/Roadmap.java:96
vertexWeights[i] = cargoSlots.contains(names[i]) ? 1 + CARGO_SLOT_SURCHARGE : 1;   // 3 thay vì 1
```

- **Ô nào là "cargo slot"**: `PlantModelAdapter.cargoSlotPoints` (dòng 79-93) — **mọi point gắn link tới
  bất kỳ Location nào KHÔNG phải trạm sạc**. Tính **một lần lúc nạp plant model**.
- **Phụ phí chảy vào 3 chỗ**: bảng khoảng cách có trọng số (`weightedDistancesTo`), điểm chấm ứng viên của
  PIBT (`PibtEngine.costThrough = weightOf(v) + dist(v)`), và thứ tự nới ràng buộc của LaCAM
  (`Lacam2Solver.sortByVertexWeight`).
- **Chỗ duy nhất nó là bất khả xâm phạm**: `PibtEngine.boundedGuideBonus` (dòng 338-345) chặn thưởng
  warm-start ở `surcharge − 0.5`, nên **gợi ý đường cũ không bao giờ mua nổi một lần bước vào ô hàng**.

> **Đời thường:** ô chứa hàng bị "tính đắt gấp ba" nên xe tránh nó khi còn đường khác; nhưng nếu vòng
> tránh dài hơn 2 ô thì xe **vẫn né vào ô hàng**.
> **Vì sao khó:** phụ phí phải đủ lớn để đổi hành vi mà không được phá gradient khoảng cách — đặt to
> quá thì bản đồ vỡ thành các ốc đảo.

🔴 **Hai giới hạn phải nói thẳng:**
1. **Đây là topology tĩnh, không phải tình trạng thực.** Không có bất kỳ chỗ nào trong kernel đọc
   "ô này *đang* có hàng hay không" (grep `hasCargo|slotOccupied|occupancy` ⇒ **0 kết quả**). Một ô trống
   trong khu hàng vẫn bị tính đắt; một ô đang có pallet cũng chỉ đắt đúng chừng đó.
2. **Không có chặn cứng.** `cargoSlotPoints` **không bao giờ** được đưa vào `Roadmap.blocking(...)`;
   `candidates()` trả về mọi hàng xóm không lọc. Xe **sẽ** né vào ô hàng ngay khi đường thay thế đắt hơn 3.
   Test `PlanQualityTest.theCargoSurchargeCannotPickAWinnerWhenBothBranchesOutOf3074AreCargoPoints`
   ghi lại đúng ca phụ phí **không phân định được**.

### 2.4 Chỉ có **HAI** thứ bị chặn cứng trong toàn hệ

| Tầng | Cái gì bị chặn | Ở đâu |
|---|---|---|
| **Lúc lập kế hoạch** | ô dưới chân **xe bất động** hoặc **xe đã tới đích** → thành **TƯỜNG** | `MapfPlanner.java:86-106` → `Roadmap.blocking` |
| **Lúc thi hành** | ô lùi-nhường của leg **DROPOFF** | `RetreatHoldModule.mayAllocate` |

Chi tiết quyết định tính đúng của masking: `Roadmap.blocking` che `neighbors` nhưng **các bảng khoảng
cách vẫn tính trên đồ thị GỐC** (nhờ `distanceSource` uỷ quyền, `Roadmap.java:48-57, 214-251`) ⇒ goal nằm
**sau lưng** xe bất động **vẫn còn gradient**, PIBT không bị mù.

> **Đời thường:** xe rảnh không phải "agent" — điều phối không ra lệnh MOVE cho nó, nên đưa nó vào bài
> toán như một xe di động là **mô hình sai**. Đúng hơn là biến chỗ nó đứng thành bức tường.
> **Vì sao khó:** biến thành tường thì đồ thị nhỏ đi và bài toán có thể **vô nghiệm**; phải giữ bảng
> khoảng cách trên đồ thị gốc mới không mù.

### 2.5 `hasMoveRing` — cổng chống deadlock **thật sự** (nằm thấp hơn solver một tầng)

`routing/pibt/PibtEngine.java:249-271`, bật bởi `fms.pibt.acyclic` (mặc định ON), gọi ở dòng 156.

Vấn đề gốc: solver đẻ ra **"vòng xoay không có ô trống"** — 4 xe cùng nhích một nhịp, mỗi xe vào ô của
xe kế. Kiểm va chạm MAPF **cho qua sạch** (không vertex conflict, không edge-swap cặp). Nhưng bộ thi hành
của ta là **pebble-motion machine**: chỉ vào được ô **đã TRỐNG**, từng xe một ⇒ vòng chờ khép kín ⇒ đứng
vĩnh viễn.

> **Đời thường:** bốn xe xếp thành vòng tròn, ai cũng chờ người trước nhả ô. Không xe nào sai luật,
> không xe nào tiến được.
> **Vì sao khó:** **tập kế hoạch hợp lệ theo MAPF ⊋ tập kế hoạch thi hành được**, và khoảng chênh đúng
> bằng lớp "vòng xoay không ô trống". Đây là bug mà mọi bộ kiểm va chạm đều mù.

Cổng bác **cả configuration** ngay khi sinh ra, ở tầng **cả `LacamSolver` lẫn `Lacam2Solver` đều đi qua`.
Bài học ghi trong `mapf.md:400`: *đừng suy ra "cổng đã mất" từ việc grep tên hàm trong một file — bất
biến có thể được giữ ở tầng thấp hơn, dưới một cái tên khác.*

### 2.6 `simplify` — bỏ **đứng chờ**, GIỮ **lùi-nhường**

`MapfPlanner.simplify` (dòng 348-363) chỉ gộp các phần tử **liền kề trùng nhau**.

- **Pure-wait** (đứng yên 1 tick) là construct **DUY NHẤT** không mã hoá được thành waypoint, vì
  `Route.Step` **không có trường thời gian**. Bỏ.
- **Excursion** (`A → B → A`, lùi ra né rồi quay lại) là route **HỢP LỆ** với openTCS 7.3.0 — đã đọc source,
  `Route` **không** cấm điểm lặp; cấp lại một điểm đang giữ chỉ tăng bộ đếm `ReservationEntry`. **GIỮ.**

> **Đời thường:** "nhường đường rồi quay lại" là một đường đi thật, giữ nguyên. Chỉ "đứng yên một nhịp"
> là không viết ra được, và cái chờ đó được thực hiện bằng cách **từ chối cấp ô**, không phải bằng cách
> nhét thêm điểm vào đường đi.
> **Vì sao khó:** hệ quả là route trở thành **WALK** ⇒ **mọi tra cứu vị trí bằng TÊN ĐIỂM đều là bug tiềm
> tàng**. Đây là **luật rà soát #1** của dự án, và nó đã đẻ ra 3 bug riêng biệt (§5.2).

### 2.7 `GoalClaimer` — tranh chấp đích + **goal thay thế (surrogate)**

`.../kernel/mapf/GoalClaimer.java`

Nhiều xe có thể cùng nhắm một điểm đích. Luật: **order tạo trước thắng** (`claimRank` = `creationTime`,
`ClaimPolicies.java:19-21`), hoà thì phân định bằng tên xe (để tất định). Kẻ thua nhận **surrogate** = ô
tiếp cận trống gần nhất, tìm bằng **BFS ngược qua `predecessorsOf(desired)`** — tức đúng những ô *dẫn vào*
đích.

Ba tầng nới + một mức chót:
1. tự do ∧ trên-đường-vào ∧ **đúng trục** (`SAME_X`/`SAME_Y`) — chỉ khi `ClaimPolicy.Axis != ANY`;
   production đặt `SAME_X` cho leg **DROPOFF** (`ClaimPolicies.surrogateAxisFor`).
2. tự do ∧ trên-đường-vào (`spannedByStartAndGoal` = hộp bao + luật **không được đi vòng quá đích rồi
   quay lại**).
3. **chỉ cần tự do** — bỏ hẳn hộp bao.
4. không có gì ⇒ **stranded**: goal = chính chỗ đang đứng.

> **Đời thường:** hai xe cùng muốn một ô; xe có đơn cũ hơn được ô đó, xe kia được xếp đứng chờ ở ô ngay
> trước cửa vào — chứ không bị đẩy đi lung tung.
> **Vì sao khó:** "chờ ở đâu" phải vừa không chắn lối vào của người thắng, vừa không nằm ngoài đoạn
> xe↔đích, vừa phải **tồn tại** — ba điều kiện này thường xuyên mâu thuẫn trên bản đồ 75% một chiều.

🔴 **Hạn chế đo được từ code:**
- `holderApproaches` **chỉ bảo vệ người giữ goal THẬT**, không bảo vệ người giữ surrogate ⇒ một xe sau có
  thể đỗ chình ình trên lối vào của một xe đang chờ bằng surrogate.
- Tầng 3 **không có ràng buộc nào ngoài "trống"** ⇒ surrogate có thể rơi ra **sau lưng** xe.
- Xe **stranded** phá hợp đồng coordinated-prefix — chính code tự cảnh báo: *"Their cached route ends
  there, NOT at the goal openTCS asks for, so FMSRouter cannot use it as a coordinated prefix."*
- `reachable`/`hopsFrom` dùng **BFS không trọng số** trong khi lập kế hoạch dùng `distanceTo` **có trọng số
  cargo** ⇒ hai bên **bất đồng về "gần nhất"**.
- `MapfCoordinator.points()` sửa surrogate bằng `remainder.indexOf(goal)` — **tra cứu theo TÊN trên một
  WALK**, đúng thứ luật #1 cấm.

### 2.8 Nhịp giải lại — sàn và trần

`.../kernel/mapf/ReplanPolicy.java`

| | Giá trị code | Ý nghĩa |
|---|---|---|
| **SÀN** `fms.mapf.debounceMs` | `1_000` ms | không giải lại sớm hơn 1 s — giải quá dày thì route lật qua lật lại, claim thay liên tục |
| **TRẦN** `fms.mapf.commitMs` | **`5_000`** ms | ép giải lại nếu đã quá hạn, **bỏ qua** `shouldReplan` |

`shouldSolve` cho phép `forceReplan` **vượt cả sàn lẫn phép thử thay đổi**. `shouldReplan` kích khi:
plan rỗng, tập goal đổi, tập immobile đổi, hoặc có xe đang chạy mà **vị trí hiện tại không nằm trên route
cache**.

🔴 `overdueAt` yêu cầu `!currentPlan.isEmpty()` ⇒ **plan rỗng không bao giờ "quá hạn"**, nên nhịp đập 1 s
**không tự khởi động lần giải đầu tiên**.
🟡 `mapf.md:23,167` ghi `3_500`; code là `5_000` (3.500 chỉ là override cho test trong `gradle/java-project.gradle`).

---

## §3. Hình học thân xe (footprint)

### 3.1 Giả định bị vi phạm

Cả **MAPF chuẩn** lẫn **ADG** (Hönig et al., RA-L 2019, §III.A) đều giả định *"robot hình tròn, lọt gọn
trong một ô"*. Ở đây **cả hai vế đều sai**.

### 3.2 Các số đo (đọc từ `routing/pibt/Footprint.java`, đã tự tính lại)

| Đại lượng | Giá trị | Nguồn |
|---|---|---|
| Thân xe | **840 × 425 mm** | `fms.pibt.vehicleLengthMm` / `...WidthMm` |
| Hàng | **800 × 800 mm** | `fms.pibt.cargoLengthMm` / `...WidthMm` |
| Khe an toàn | **0 mm** (mặc định) | `fms.pibt.clearanceMm` |
| Pitch bản đồ | 750 / 800 / 950 mm | map v7 |

| | **rỗng** | **có hàng** |
|---|---|---|
| nửa chiều **dọc** khi đứng | 420 | 420 |
| nửa chiều **ngang** khi đứng | 212,5 | **400** |
| **bán kính quét khi xoay 90°** | **470,7** | **565,7** |

Chi tiết đáng nói ở slide: `sweptRadiusLoaded = hypot(800/2, 800/2) = 565,7`, **không phải**
`hypot(420, 400) = 579,8`. Vì thân + hàng hợp thành **hình dấu cộng** (hợp của hai chữ nhật đồng tâm),
điểm xa nhất là **góc của hàng** hoặc **góc của xe** — **góc (420, 400) không tồn tại trên hình hợp**.

**Kết luận hình học:**
- Đi thẳng thì thân nằm gọn: `420 + 420 = 840 < 950`.
- **Chỉ cú XOAY mới thò sang ô kề.** Bốn góc × 90° phủ trọn vòng ⇒ vùng quét là **đĩa tròn đầy**, chỉ cần
  so bán kính.
- **Hai xe có hàng ở hai ô kề nhau thì KHÔNG con nào xoay được:** `565,7 + 400 = 965,7 > 950`. Xe kia
  **đứng yên cũng không cứu được** — nó phải **rời hẳn khỏi ô**.
- `maxReach() = 2 × 565,7 + 0 = **1131,4 mm**` — dùng làm bộ lọc bán kính cắt trước vòng ghép cặp O(S²)
  (`PrecedenceService.java:213`).
  🟡 `ARCHITECTURE-MAPF-OpenTCS.md:184` ghi **1181,4** — sai so với mặc định hiện tại (1181,4 đòi
  `clearanceMm = 50`).

### 3.3 Mô hình phải nới ra sao — ba tầng cưỡng chế

| Tầng | Ở đâu | Vai trò |
|---|---|---|
| 1 | `PibtEngine.clearsPlannedMotions` | cắt tỉa sớm khi chọn ứng viên — **bỏ được, không ảnh hưởng đúng/sai** |
| 2 | `PibtEngine.clearsUnplannedMotions` | có thể **ĐẨY đệ quy** một xe đang đứng ra chỗ khác (`footprintPushes`), không chỉ từ chối |
| **3** | **`PibtEngine.bodiesOverlap(next)`** | **CHỊU LỰC** — soi **cấu hình đầu ra**, O(n²) toàn cặp |

**Vì sao tầng 3 phải nằm ở cấu hình đầu ra:** mảng `to[]` có **BỐN** đường ghi, và **ba trong đó không đi
qua `decideNextVertex`**:

| # | Dòng | Đường ghi | Qua tầng 1? |
|---|---|---|---|
| 1 | 138 | replay ràng buộc cứng của LaCAM | ❌ |
| 2 | 394 | ứng viên PIBT chọn | ✅ |
| 3 | 407 | **đứng yên** khi mọi ứng viên trượt | ❌ |
| 4 | 419 | `swapOperation` kéo đối thủ vào ô vừa nhả | ❌ |

> **Đời thường:** gác từng cửa thì cửa thứ năm mai sau lại hở; nên phải kiểm **kết quả cuối cùng**.
> **Vì sao khó:** ba trong bốn đường ghi là các nhánh "phụ" mà đọc code rất dễ bỏ sót.

### 3.4 Hướng xe phải vào **không gian tìm kiếm**

`Lacam2Solver` mang thêm `axis` qua từng `HighNode` và **băm nó vào `ConfigKey`**:

```java
this.hash = 31 * Arrays.hashCode(config) + Arrays.hashCode(axis);
```

Hai cấu hình **cùng vị trí nhưng khác hướng là hai node khác nhau** — gộp lại là sai, vì hướng quyết định
nước kế tiếp **có phải cú xoay hay không**. Khi tắt footprint, `axis == null`, `Arrays.hashCode(null) == 0`
⇒ thoái hoá sạch về "chỉ vị trí".

Nguồn trục: `BodyStates.of(...)` — ưu tiên `Vehicle.getPose().getOrientationAngle()` (chia rổ **±45°**),
dự phòng suy từ route drive order, cuối cùng `AXIS_NONE`. Log `[MAPF body]` báo tỉ lệ từng nguồn và báo
**ERROR** khi pose không khớp **cả** trục vừa đi vào **lẫn** trục sắp đi ra — dấu hiệu **hệ quy chiếu pose
và roadmap lệch nhau**, khiến *mọi* trục sai chứ không chỉ *không biết*.

🟡 Chi phí "**nodes +37%, thời gian ~0**" chỉ có trong `ARCHITECTURE-MAPF-OpenTCS.md:149` — **không có
benchmark hay test nào trong cây tái lập được con số này**.

### 3.5 `byPoint` ĐỔI NGHĨA — đóng góp mô hình rõ nhất

ADG gốc chỉ diễn đạt được *"tại **cùng một** ô, ai trước ai sau"* (`s_k^i == g_k'^i'`). Ràng buộc thân xe
là quan hệ giữa **HAI ô khác nhau**, nên luật đó **không viết được**.

`PrecedenceService.buildPrecedence` giờ ghép cặp **mọi bước của mọi xe**; cặp nào **chồng thân**
(`bodiesTouch` = lọc bán kính `maxReach` rồi gọi `Footprint.collideMoving`) thì **đăng ký xe đến trước vào
ĐIỂM của xe đến sau**:

```
A: 0082 → 0083 → 0012      B: 0085 → 0084 → 0011      (KHÔNG chung ô nào)

luật cũ:  byPoint = {}                                  → không ràng buộc gì
luật mới: byPoint["0084"] = [Visit(A,1), Visit(B,1)]    → B đợi tới khi A rời 0083
```

⚠️ Nên `byPoint` **không còn là "ai đi qua điểm này"** mà là **"ai phải được xếp thứ tự so với điểm này"**.
**Một xe xuất hiện ở điểm nó không bao giờ tới.** `mayAllocate` chịu được vì mọi thứ nó đọc về tiền nhiệm
đều lấy từ **route THẬT** của tiền nhiệm; `buildRoutes` không bị nhiễm. **`MapfPrecedenceModule` không sửa
một dòng nào.** Chốt bằng `BodyInducedPrecedenceTest` (6 test, có
`routesStayTheRealRoutesEvenThoughAppearsAtACellItNeverVisits`).

**Bảo thủ một nhịp có chủ ý:** B đợi tới khi A **tới ô kế**, không phải tới khi A **xoay xong** — vì tín
hiệu hoàn thành duy nhất là báo tới nơi. Muốn cắt nhịp đó thì phải nghe `theta` của VDA5050.

### 3.6 🔴 Hạn chế còn mở của footprint

1. **Footprint chỉ cưỡng chế ở TẦNG LẬP KẾ HOẠCH.** Tầng cấp phát (`Scheduler`) hoàn toàn không biết
   thân xe — nó chỉ biết ô. Chỉ những xe **nằm trong plan** mới được xếp thứ tự theo thân. ⇒ **Một xe
   đang đỗ không bảo vệ được thân mình.**
2. **Chưa có integration test với xe MANG HÀNG.** `ARCHITECTURE §2.1` ghi thẳng `loaded=0` ở mọi solve
   hiện tại — mà **gần như mọi ràng buộc còn hiệu lực đều nằm ở ca có tải**.
3. **Test chạy với footprint TẮT theo mặc định**: `opentcs-FMS-kernel/build.gradle:69-72` đặt
   `fms.pibt.footprint=false`; từng class test phải tự bật lại (`FootprintYieldTest`,
   `SchedulerFaithfulTest`).
4. **Chưa đo chi phí `O(S²)`** của vòng ghép cặp trên đội xe thật (mới chỉ có bộ lọc `maxReach`).
5. `axisOf` trả `AXIS_NONE` khi `dx == dy` — bao gồm **mọi đường chéo chính xác**; khi trục là `NONE`,
   `halfExtentToward` lấy **`max(along, across)`** (bảo thủ), nhưng nghĩa là **xe không có trục thì không
   bao giờ bị thấy là đang xoay**.

---

## §4. Tầng giao tiếp thiết bị VDA5050 — adapter làm gì ngoài chuẩn

Driver VDA5050 gốc bị **tắt** (`enabledVersions=` rỗng); fork đăng ký `AubotCommAdapterFactory`.
`AubotCommAdapter extends CommAdapterImpl` (v2.0) và chỉ override **2 method**:
`sendCommand` (ghi route + trạng thái tải vào `AubotOrderContext`) và `onIncomingMessage`
(cho qua `AubotStateRewriter`). Ba việc còn lại làm trong constructor.

**Topic prefix bị ép** thành `<interfaceName>/2.0.0/<manufacturer>/<serialNumber>` — **ghi đè cả giá trị
khai báo trong map** (stock dùng đoạn `/v2/`).

### 4.1 Ràng buộc lệnh gửi đi (`AubotOrderFilter` + `AubotOrderContext`)

| Hằng số | Giá trị | Tác dụng |
|---|---|---|
| `MAX_ORDER_ID_LENGTH` | **10** | `orderId` dài hơn 10 bị **thay** bằng token base-36 (seed `SecureRandom`, bound `1<<20`), **giữ nguyên hậu tố `-<số>`** là chỉ số drive order |
| `MAX_ACTION_ID_LENGTH` | **10** | 3 luật rút gọn (`Order_destination_custom_action_`→`ODC_`, `Order_destination_action_`→`ODA_`, `<resource>_action_<n>`), rồi **cắt cứng `right(...,10)`** |
| `COMPACT_EDGE_ID_LENGTH` | **8** | `edgeId` dài hơn 8 → 4 ký tự đầu + 4 ký tự cuối |

> **Đời thường:** xe B300 chỉ chấp nhận mã ngắn, nên mọi định danh dài của openTCS phải được nén lại
> trước khi gửi, rồi **giãn ngược** khi xe báo về (§4.4) để kernel vẫn thấy tên gốc của mình.
> **Vì sao khó:** nén là hàm **mất thông tin** — hai id khác nhau có thể ra cùng một mã.

🔴 **Va chạm id chỉ được LOG, không được ngăn:** `"Action id '{}' and '{}' both shorten to '{}'"` và
`"Order id '{}' and '{}' both map to '{}'"`. Đây chính là cơ chế đẻ ra lỗi "2 order trùng id ⇒ xe kẹt
vĩnh viễn" — marker đã có sẵn ở mức INFO/WARNING.

**KHÔNG có** (đã kiểm): giới hạn số node/edge mỗi order, xử lý horizon / `releaseAt` / cắt phần chưa
released.

### 4.2 Mức tốc độ (`AubotSpeeds` + `AubotOrderContext.record`)

| Mức | Mặc định | Property ghi đè theo xe |
|---|---|---|
| có hàng | **40,0** | `aubot:speed.loaded` |
| không hàng | **50,0** | `aubot:speed.unloaded` |
| vào cua | **40,0** | `aubot:speed.turn` |

- `turnsAfter(steps, i, heading)` — tốc độ cua áp cho **cạnh DẪN VÀO** chỗ đổi hướng; cạnh cuối trước khi
  dừng vẫn là tốc độ chạy.
- **DẤU mã hoá chiều lùi**: `maxSpeed = backward ? -speed : speed`, trong đó
  `backward = step.getVehicleOrientation() == BACKWARD` — tức theo **MŨI XE**, không theo mũi tên của map.
  Test chốt: `keepsSpeedPositiveWhenOpenTcsOnlyTraversesAPathAgainstItsArrow`.
- Trạng thái tải được lấy mẫu **một lần** mỗi `record()` ⇒ cả route thừa hưởng tải tại thời điểm gửi lệnh.

🟡 **KHÔNG có mức 25** ở đâu trong code (tài liệu/ghi chú cũ nói 50/40/25 là **đã lỗi thời**).
🔴 `AubotCommAdapterSetupTest:64-67` khẳng định `DEFAULT_SPEED_UNLOADED == 70.0` trong khi hằng số là
**50.0** ⇒ **test ĐỎ sẵn ở HEAD**.

### 4.3 "Bù mã QR" — thực chất là **xoay hệ quy chiếu toàn bản đồ 90°**

`AubotDirection`: `NORTH("Y+")`, `EAST("X+")`, `SOUTH("Y-")`, `WEST("X-")`.

- Điều khiển bằng property **`direction`** đọc từ **VisualLayout** (không phải từ vehicle),
  giải quyết **một lần** lúc tạo adapter (`AubotCommAdapterFactory:123-130`). Giá trị lạ ⇒ `null` ⇒ không xoay.
- **CÓ xoay:** `nodePosition.x/y` gửi đi (`toVehicleFrame`); `agvPosition.x/y` nhận về (`toMapFrame`);
  `agvPosition.theta` nhận về — `IEEEremainder(PI/2 − (θ + ordinal·PI/2), 2π)`, **là phép phản chiếu +
  offset chứ không phải xoay thuần**, và **luôn được áp kể cả khi `direction` là null**; mã `direction`
  của cạnh (`heading.alignTo(layoutDirection)`).
- **KHÔNG xoay:** `nodePosition.theta` gửi đi, `mapId`, `allowedDeviation*`, và **dấu của `maxSpeed`**.

🔴 **Đính chính quan trọng cho slide:** **không có** bù lệch theo từng mã QR — không có offset per-point,
không có marker id, không có sai số dán. Chỉ có **một phép căn khung 90° cho cả bản đồ**.

### 4.4 Chuẩn hoá trạng thái nhận về (`AubotStateRewriter`)

Chỉ động vào topic kết thúc `/state` và `/visualization`; parse lỗi ⇒ **trả nguyên bản**.

- **Giãn ngược** `orderId`, `actionId`, `edgeId` về tên gốc (đối xứng với §4.1).
- **Sửa sai chuẩn**: `infoReference` → `infoReferences`, `errorReference` → `errorReferences`
  (xoá trường số ít, đặt lại dưới tên số nhiều), rồi ép `referenceKey`/`referenceValue` về chuỗi.
- **Bỏ hẳn `agvPosition`** khi `positionInitialized == false` (thiếu cờ thì mặc định `true`).
- **Bọc theta về `(−π, π]`** bằng `IEEEremainder`.
- `/visualization` bị **lọc trắng** còn đúng 7 khoá.

🔴 **KHÔNG có** (đã kiểm): bóc enum khỏi lớp bọc; **KHÔNG có** lọc `actionStates` theo `actionId`.

### 4.5 Lệnh laser (`LaserActionTransformer`)

Gắn `vda5050:action.laser = laserOff` + `blockingType = NONE` lên **điểm đích** (luôn), **path** (luôn),
và **điểm nguồn chỉ khi `routeIndex == 0`**. `ActionsMapping` của driver gốc biến chúng thành action trên
node/edge với trigger `ORDER_START` / `ORDER_END` / `PASSING`.

Vô điều kiện (ghi đè cả cờ laser-on trong map), **idempotent**, và áp **cho toàn đội**
(`providesTransformersFor` trả `true` với mọi xe).

⚠️ Đây là **action nhúng trong order**, **không phải instantAction** — không có chỗ nào trong cây phát
message `instantActions`.

---

## §5. Xử lý sự cố vận hành

### 5.1 Xe ZOMBIE + đồng bộ lại claim (`FMSScheduler`)

**Triệu chứng:** `DefaultScheduler.allocate()` ném `IllegalArgumentException: Not the next claimed
resources`. Không ai bắt trên `kernelExecutor` ⇒ **giết task** ⇒ xe thành **zombie**: state `EXECUTING`,
**vẫn giữ resource**, không gửi lệnh gì nữa. Nạn nhân có tên: Vehicle-0010 (11/7), Vehicle-0002 (13/7).

**Nguyên nhân:** dispatcher reroute ~9 xe mỗi ~4 s ⇒ `updateDriveOrder` ⇒ `scheduler.claim()` **thay TOÀN
BỘ** hàng đợi claim, **đè lên allocation đang bay**. Đây là race mà openTCS không được thiết kế để chịu ở
tần suất này.

**Bản vá** (`FMSScheduler.java`, 82 dòng, override đúng 2 method):

```java
@Override public void allocate(Client client, Set<TCSResource<?>> resources) {
  synchronized (globalSyncObject) {
    if (!reservationPool.isNextInClaim(client, resources)) {
      resyncClaimTo(client, resources);   // SPLICE: bỏ prefix đã tiêu, GIỮ ĐUÔI
    }
    super.allocate(client, resources);
  }
}
```

> **Đời thường:** khi kế hoạch đổi giữa chừng, danh sách ô "đã đặt trước" của xe bị lệch pha với ô nó
> đang xin. Thay vì để hệ thống ném lỗi và giết luồng lệnh, ta **nối lại danh sách cho khớp** rồi cấp
> bình thường.
> **Vì sao khó:** ba ràng buộc, mỗi cái đều **suýt làm hỏng bản vá**:

1. **KHÔNG được nuốt exception.** `Scheduler.Client` **chỉ có** `getId()` + `onAllocation(Set)` — **không
   có callback báo thất bại**. Nuốt ⇒ `allocate()` return êm ⇒ tracker vào `ALLOCATION_PENDING` **nhưng
   không có `AllocatorTask` nào được submit** ⇒ **tự tay đẻ ra đúng con zombie đang muốn chống**.
2. **KHÔNG được `claim(List.of(resources))`.** `AllocatorTask` gọi `unclaim()` mỗi lần cấp thành công ⇒
   **claim là HÀNG ĐỢI TIÊU THỤ**, không phải snapshot. Claim 1 phần tử ⇒ cấp xong ⇒ rỗng ⇒ **lệch VĨNH
   VIỄN**; tệ hơn, `MapfPrecedenceModule` nhận claim rỗng ⇒ **mù hoàn toàn về tương lai**.
3. **Phải ATOMIC.** `getClaim → claim → allocate` là 3 lần lấy khoá riêng; `AllocatorTask` chen vào giữa
   được. Giữ `@GlobalSyncObject` suốt cụm (monitor `synchronized` nên **reentrant**).

### 5.2 Tái định tuyến — neo tại **FRONTIER** (`FmsRegularDriveOrderMerger`)

**Khái niệm đúng — FRONTIER:** đích của **lệnh CUỐI CÙNG ĐÃ GỬI** cho driver
(`getInteractionsPendingCommand()`, không có thì phần tử cuối của `getCommandsSent()`). Nó **≠**
`currentRouteStepIndex` (xe đang ở đâu). **Xe đã nhận lệnh đi tới đâu thì không được cắt trước đó.**

`divergingStepIndex` quét **XUÔI** từ `frontier + 1`, lấy occurrence **ĐẦU TIÊN** của điểm-nguồn; không
có ⇒ **`throw IllegalStateException`** ⇒ dispatcher catch ⇒ **no-op an toàn**, xe giữ route cũ.

**Vì sao bản gốc hỏng:**
- openTCS gốc neo bằng `indexOf` (**lần đầu tính từ đầu route**) — route FMS là **WALK** có điểm lặp nên
  nó **cắt vào quá khứ**.
- Bản FMS đầu tiên neo vào **lần xuất hiện CUỐI** — kết quả đo được: route phình lên **66 bước**, plan tốt
  nằm ở bước 60–65, **sau 44 bước bập bênh `0008↔0009`**. Rác **bất tử và phình ra** mỗi lần reroute.

> **Đời thường:** khi thay đường giữa chừng, chỉ được thay từ chỗ **xe chưa nhận lệnh** trở đi; cắt sớm
> hơn là xoá mất lệnh xe đang chấp hành.
> **Vì sao khó:** ba bug liên tiếp cùng một gốc — **định danh vị trí trên route phải là INDEX, không phải
> TÊN ĐIỂM**. Đây là luật rà soát #1 của dự án.

### 5.3 Mất định vị (`LostNavigationListener` + `VehicleErrors` + `FmsIsAvailableForAnyOrder`)

- Loại lỗi: **`adapterLostNavigation`**, đọc từ property VDA5050 `PROPKEY_VEHICLE_ERRORS_FATAL`.
  `isOnlyLostNavigation` đòi tập lỗi fatal **đúng bằng** `{adapterLostNavigation}` — có thêm lỗi khác thì
  **không** kích hoạt.
- **Hành động phục hồi = đúng MỘT lời gọi kernel**:
  `dispatcherService.withdrawByVehicle(ref, /*immediateAbort=*/ true)` — bỏ những lệnh xe không còn chấp
  hành được, để **WES quyết định số phận lô hàng**. Edge-triggered (chỉ khi *vừa* rơi vào lỗi), và
  **kiểm lại lần nữa** trên `kernelExecutor` trước khi hành động.
- `FmsIsAvailableForAnyOrder` **vẫn giao việc mới** cho xe đó (thử lại vị từ với state `IDLE`), vì
  **nhận order mới chính là thứ xoá lỗi**.
- `FleetSnapshotService` lập kế hoạch cho xe đó từ vị trí **nó BÁO**, không phải từ frontier.
- `FMSDispatcher.rerouteChangedVehicles` **bỏ qua** xe đang lostNavigation.

> **Đời thường:** xe báo "tôi không biết mình đang ở đâu trên tuyến nữa". Hệ thống rút lệnh đang chạy,
> vẫn coi nó là xe khả dụng, và giao việc mới — chính việc mới làm nó định vị lại.
> **Vì sao khó:** đây là trạng thái **nửa hỏng**: xe vẫn biết mình đứng ở ô nào, chỉ mất tuyến. Coi là
> hỏng hẳn thì mất một xe; coi là bình thường thì nó chạy theo tuyến sai.

🔴 **KHÔNG có** (đã kiểm cả cây): reroute **cưỡng bức** (`ReroutingType.FORCED` chỉ xuất hiện ở
`FmsRegularDriveOrderMerger:54`; `FMSDispatcher:140` dùng `REGULAR`), **không có** xoá lỗi chủ động,
**không có** `cancelOrder`.
🟡 `ARCHITECTURE-MAPF-OpenTCS.md:281` ghi *"AubotCommAdapter ← + cancelOrder trước lệnh đầu của FORCED
reroute"* — **điều này KHÔNG có trong code**.

### 5.4 Bắt tay "xe đang dwell" (`WaitDropOffListener`)

Khi một order **vừa** chuyển sang `BEING_PROCESSED` với xe đã gán: nếu **tên order bắt đầu bằng
`APPROACH-`** thì đặt property xe `fms:waitDropOff = "true"`, ngược lại `"false"`.
`FleetSnapshotService` đọc cờ đó và đưa xe vào tập **`immobile`** (goal = chính chỗ đứng) ⇒ ô nó đứng
**thành tường**, không ai lập kế hoạch đẩy nó đi trong lúc WES tính ô trả hàng.

> **Đời thường:** xe đang chờ hệ thống quyết định trả hàng vào ô nào thì phải được đứng yên; nếu bộ giải
> coi nó là xe di động, nó sẽ bị "đẩy sang bên" mà không ai thi hành lệnh đó.
> **Vì sao khó:** đây là lỗ hổng mô hình R-007 — MAPF giả định **mọi agent đều di động**.

🔴 **Rất mong manh:** điều kiện kích hoạt là **tiền tố TÊN ORDER** (`APPROACH-`) — một quy ước đặt tên
chia sẻ với WES, **không có schema, không có kiểm tra**. Đổi tên order ở WES là tắt âm thầm cả cơ chế.
🔴 Lỗ còn lại: xe **có order và đã tới đích** nhưng **không** mang cờ này thì `isProcessingOrder()==true`
⇒ **vẫn là agent** ⇒ PIBT **đẩy nó khỏi dwell point được**. Chưa đo xem executor có thật sự chấp hành cú
đẩy đó không.

### 5.5 Hai endpoint REST thêm vào (`FMSV1RequestHandler`)

`createRoutes()` gọi `super.createRoutes()` rồi **nối thêm** (không đổi endpoint gốc nào):

| Endpoint | Việc |
|---|---|
| `POST /v1/dispatcher/replan` | `coordinator.requestReplan()` + `dispatcherService.dispatch()` — ép giải lại ngay |
| `PUT /v1/vehicles/{NAME}/properties?key=&newValue=` | ghi property lên xe, **chỉ cho phép tiền tố `fms:` và `wes:`** |

> **Đời thường:** openTCS bản gốc **không cho** đặt property qua REST; fork mở đúng một cửa hẹp, có
> whitelist namespace, để WES bắt tay được với kernel.
> **Vì sao khó:** property là kênh duy nhất truyền ngữ nghĩa nghiệp vụ (`wes:leg`, `fms:waitDropOff`) vào
> kernel; mở rộng thì mất kiểm soát, khoá lại thì WES câm.

🔴 **Chưa có ai gọi**: grep `wes/src` và `wes-client/src` ⇒ **0 caller** cho cả hai endpoint.

### 5.6 Đội đóng băng — nhịp đập commit-horizon

Đã mô tả ở §1.1. Nhắc lại vì đây là một sự cố vận hành riêng: **ZERO lần gọi `dispatch()` trong 10 phút**,
vì mọi nguồn dispatch của openTCS đều edge-triggered.

---

## §6. 🔴 Tổng hợp hạn chế còn mở (phần này đừng giấu)

| # | Hạn chế | Bằng chứng |
|---|---|---|
| 1 | **Không còn tầng kiểm va chạm nào trên plan trước khi cài.** `PlanResult.executable` giờ **chỉ là** `result.solved()`; `isExecutableAsync`/`hasCollision`/`hasAdgCycle`/`bestValidPlan`/`certifyWindowOnly` **đã gỡ hết**. An toàn hoàn toàn dựa vào `MapfPrecedenceModule` + Scheduler **lúc thi hành**. ⇒ **chất lượng plan không có ai canh — chỉ deadlock mới báo.** | `MapfPlanner.java:149`; `mapf.md:52-56` |
| 2 | **Phép đo quyết định chưa ai làm:** trong `COMMIT_MS`, một xe tiêu thụ được **bao nhiêu step** (`h_hiệu_dụng`)? Nếu **< window (10)** thì đuôi mù không bao giờ chạm tới ⇒ kiến trúc kín. Nếu **≥ 10** thì **đuôi mù đang chạy thật trên sàn**. | `mapf.md:468` |
| 3 | **Bảo đảm lý thuyết của solver vô hiệu trên chính map này.** Map **75% MỘT CHIỀU (678/905 path)**; **PIBT không có bảo đảm hoàn thành trên đồ thị CÓ HƯỚNG**, mà LaCAM\* dựng trên PIBT. Bằng chứng: `PIBT stranded` **184.520** lần khi thử dùng PIBT cho phần đuôi. | `mapf.md:418-450` |
| 4 | **Footprint chỉ ở tầng plan, không ở tầng allocation** ⇒ xe đang đỗ **không bảo vệ được thân mình**. | §3.6 |
| 5 | **Chưa có integration test với xe mang hàng** (`loaded=0` ở mọi solve), mà gần như mọi ràng buộc còn hiệu lực đều ở ca có tải. Test lại chạy với `fms.pibt.footprint=false` mặc định. | `ARCHITECTURE §2.1`; `build.gradle:69-72` |
| 6 | **Ô hàng chỉ bị tính đắt, không bị cấm**, và là **topology tĩnh chứ không phải tình trạng thực** — không có bất kỳ chỗ nào đọc "ô này đang có hàng hay không". | §2.3 |
| 7 | **`SingleVehicleBlockModule` bản STOCK vẫn armed** trong multibinder; im lặng chỉ vì map có 0 block. | §1.3 |
| 8 | **GoalClaimer**: surrogate holder không được bảo vệ lối vào; tầng 3 không ràng buộc; xe stranded phá hợp đồng coordinated-prefix; BFS không trọng số bất đồng với `distanceTo` có trọng số. | §2.7 |
| 9 | **`MapfCoordinator.points()` tra cứu theo TÊN trên route WALK** (`routeTailFrom`, cắt surrogate) — vi phạm chính luật #1 của dự án. | `MapfCoordinator.java:277, 324` |
| 10 | **Va chạm id VDA5050 chỉ được log, không ngăn** ⇒ 2 order trùng id ⇒ xe kẹt vĩnh viễn. | §4.1 |
| 11 | **Không có bù lệch theo từng mã QR** — chỉ có căn khung 90° cho cả bản đồ. Và theta **luôn bị viết lại** kể cả khi không khai báo `direction`. | §4.3 |
| 12 | **`kRobust` là BẪY IM LẶNG**: `PibtEngine.step()` **không có** tham số kRobust; bật lên là NO-OP. Cần cài thật khi tích hợp xe thật. | `mapf.md:452-460` |
| 13 | **`plan rỗng không bao giờ overdue`** ⇒ nhịp đập 1 s không tự khởi động lần giải đầu. | `ReplanPolicy.overdueAt` |
| 14 | **`LocalGuide` + `CollisionTable` là mã CHẾT** — `new LocalGuide(` không xuất hiện ở bất cứ đâu ngoài chính lớp đó, kể cả trong test. | §8 |
| 15 | **Test đỏ sẵn ở HEAD**: `AubotCommAdapterSetupTest` khẳng định 70.0 trong khi hằng số là 50.0. | §4.2 |
| 16 | **Nguồn tham số sim ↔ production đã tách rời.** `RhcrLoop.Config` từng là nguồn chung cố ý; giờ tham số production **hardcode** trong `RoutingContext` ⇒ **mọi số đo từ harness offline không tự động chuyển sang production**. | `mapf.md:279-296` |
| 17 | **`MapfPrecedenceModule` ngưng cưỡng chế hoàn toàn** khi `byPoint` rỗng (sau `invalidate()` do đổi model). | §2.1 |

---

## §7. 🟡 Chỗ tài liệu dự án lệch code (sửa trước khi lên slide)

| Tài liệu | Nói | Code thực tế |
|---|---|---|
| `mapf.md:19` | `fms.mapf.lacam2LoopLimit = 8_000` | **`48_000`** (`MapfPlanner.java:19`) |
| `mapf.md:23,167` | `fms.mapf.commitMs = 3_500` | **`5_000`** (`ReplanPolicy.java:10`); 3.500 chỉ là override test |
| `mapf.md:358` | `Roadmap.blocking` "chỉ mask `neighbors`, giữ nguyên `predecessors`" | Code **dựng lại** `predecessors = transposed(masked)`; bất biến được giữ bằng **cơ chế khác** (`distanceSource` uỷ quyền) |
| `mapf.md:31` | `guideBonus` ở `PibtEngine.java:206` | Nay ở **dòng 339**, và bị **chặn hai lớp** (`TIE_BREAK_ONLY_CEILING` và `surcharge − 0.5`) |
| `mapf.md:54` | `executable = result.solved()` ở `MapfPlanner.java:243` | Ở **dòng 149** |
| `ARCHITECTURE:184` | `Footprint.maxReach() = 1181,4 mm` | **1131,4 mm** (`2 × 565,685 + 0`) |
| `ARCHITECTURE:281` | `AubotCommAdapter` gửi `cancelOrder` trước lệnh đầu của FORCED reroute | **KHÔNG có trong code** |
| `ARCHITECTURE:149` | "nodes +37%, thời gian ~0" | **Không có benchmark/test nào trong cây tái lập được** |
| Ghi chú cũ | 3 mức tốc độ 50 / 40 / **25** | **50 / 40 / 40** (`AubotCommAdapter.java:32-34`) |
| `FMSInjection` banner | liệt kê 8 thành phần | thiếu 5 binding (§1.4) |

---

## §8. Bảng tham số điều khiển (rà bằng grep `System.getProperty|getInteger|getLong`)

**Đều là JVM system property — KHÔNG có `@ConfigurationEntry`, KHÔNG có file `.properties` nào cho chúng.**

| Property | Mặc định | Ở đâu |
|---|---|---|
| `fms.mapf.window` | `10` | `SolverParams.java:24` (≤0 ⇒ `WINDOW_FULL`) |
| `fms.mapf.lacam2LoopLimit` | `48_000` | `MapfPlanner.java:19` |
| `fms.mapf.warmStart` | `true` | `MapfPlanner.java:25` |
| `fms.mapf.priorityBoostCap` | `8` | `MapfPlanner.java:22` |
| `fms.mapf.debounceMs` | `1_000` | `ReplanPolicy.java:9` |
| `fms.mapf.commitMs` | `5_000` | `ReplanPolicy.java:10` |
| `fms.mapf.cargoSlotSurcharge` | `2` | `Roadmap.java:30` |
| `fms.mapf.searchPastWindow` | `true` | `Lacam2Solver.java:36` |
| `fms.mapf.backtrackCost` | `true` | `Lacam2Solver.java:39` |
| `fms.mapf.constraintWeightOrder` | `true` | `Lacam2Solver.java:42` |
| `fms.mapf.logSolutionSteps` | `false` | `Lacam2Solver.java:45` |
| `fms.pibt.swap` | `true` | `PibtEngine.java:39` |
| `fms.pibt.acyclic` | `true` | `PibtEngine.java:41` |
| `fms.pibt.laneBreak` | `true` | `PibtEngine.java:25` |
| `fms.pibt.guideBonus` | `0.5` | `PibtEngine.java:339` |
| `fms.pibt.footprint` | `true` | `Footprint.java:36-38` |
| `fms.pibt.vehicleLengthMm` / `vehicleWidthMm` | `840` / `425` | `Footprint.java:21-25` |
| `fms.pibt.cargoLengthMm` / `cargoWidthMm` | `800` / `800` | `Footprint.java:27-31` |
| `fms.pibt.clearanceMm` | `0` | `Footprint.java:33-34` |
| `fms.retreatHold.ttlMs` | `1_000` | `RetreatHoldModule.java:30` |
| `fms.mapf.lg.*` (7 khoá) | **`on=false`** | `LocalGuide.java:11-25` — 🔴 **mã chết, chưa từng được khởi tạo** |
| `fms.guide.collisionTable.*` | `true` | `CollisionTable.java:12-16` — chỉ đến được qua `LocalGuide` |

**Hardcode, KHÔNG phải property:** `SOLVE_DEADLINE_MS = 1_000` và `seed = 0` (`RoutingContext.java:12-19`) —
dùng cho **cả** `jointParams()` lẫn `soloParams()`. `HORIZON_TICK_MS = 1_000` (`FMSDispatcher.java:48`).

**Override lúc build (chỉ test):** `gradle/java-project.gradle:55-58` (`debounceMs=1000`, `commitMs=3500`,
`constraintWeightOrder=true`); `opentcs-FMS-kernel/build.gradle:69-72`
(**`fms.pibt.footprint=false`**, `clearanceMm=0`, `lacam2LoopLimit=48000`).

**Property object (không phải config) — hợp đồng WES ↔ kernel:**
`wes:leg = "DROPOFF"` (§2.2), `fms:waitDropOff` (§5.4), whitelist REST `{"fms:", "wes:"}` (§5.5).

---

## §9. Bằng chứng kiểm thử — dùng làm slide "đánh giá"

**44 file test / 8.803 LOC — nhiều hơn mã production.**

- **`SchedulerFaithfulTest`** (21 test) chạy **`DefaultScheduler` THẬT in-process**, không mock:
  - Quét quy mô: `fiveAgentRealScheduler`, `tenAgent…`, `twentyAgent…`, `twentyFiveAgent…`, `thirtyAgent…`
  - **Regression tái lập sự cố thật, đặt tên theo NGÀY**: `capturedKernelDeadlock20260709`,
    `capturedKernelDeadlock20260803`, `capturedLaneStandoff20260805`, `capturedKernelDeadlockWithContinuity`
  - Ca nghiệp vụ: `loadedVehiclesLeavingAdjacentPickupLanesStillDrain`,
    `theFiveAgentLoopStillDrainsWhenEveryVehicleCarriesALoad`,
    `retreatingVehicleLeavesTheAisleSidewaysInsteadOfBackingUpIt`,
    `surrogateStaysInTheAisleWhenConstrainedToTheGoalColumn`
- **`PlanQualityTest`** (25 test) — thuộc tính chất lượng & tất định, ví dụ
  `replanningAnInstanceReproducesItConfigurationByConfiguration`,
  `theSearchBudgetRatherThanTheWallClockDecidesWhenPlanningStops`,
  `sprintPlansStayWithinAKnownFactorOfTheIndependentShortestPathBound`,
  `theCargoSurchargeCannotPickAWinnerWhenBothBranchesOutOf3074AreCargoPoints`
- **`FootprintYieldTest`** (11 test) — `aLoadedPairIsOrderedWhateverTheClearancePolicy`,
  `atMostOneVehiclePivotsInAnyStep`, `noSolutionStepEverPlacesTwoBodiesOnTopOfEachOther`
- **`PibtAcyclicTest`** — **differential test** dùng cờ `fms.pibt.acyclic` làm đòn bẩy: tắt cờ ⇒ vòng 4 xe
  xoay thật; bật ⇒ `step` trả `null`. Cặp đối chứng này là **bằng chứng guard chịu lực**.

---

## §10. Bài học phương pháp (rút từ `mapf.md` — rất hợp làm slide kết)

1. **Định danh vị trí trên route là INDEX, không phải TÊN ĐIỂM.**
2. **Đừng đánh giá một mảnh vá khi mảnh phụ thuộc của nó chưa vào.** Thử `certifyWindowOnly` **tách rời**,
   khi chưa có cổng fallback → 3/3 đỏ → **kết luận sai** → suýt đi xây cả một SIPP solver.
3. **Báo động kêu đúng mà nhãn sai còn tệ hơn không có báo động.** `describeAdgCycle` dán nhãn
   *"likely FALSE positive"* **vô điều kiện** ⇒ báo động đúng bị bỏ qua **hàng tuần**.
   Hệ quả: **báo động chỉ log mà không hành động** sớm muộn cũng thành nhánh chết — hoặc reject, hoặc đừng dựng.
4. **Bất định là kẻ thù số một.** Cùng instance chạy 8 lần → **4 plan khác nhau**; deadlock 20 xe chỉ tái
   hiện **17%** ⇒ không mổ được. Làm nó tất định **TRƯỚC**, rồi mới mổ. Và tính tất định ấy **là THÀNH PHẦN
   của bản vá deadlock**: `UNBOUNDED + ADG` chỉ pass **3/6**, `budget + ADG` = **6/6**.
5. **Comment sai giết người.** Ba comment sai trong `MapfCoordinator` khiến ADG-alarm bị bỏ qua hàng tuần.
6. **Đỏ ≠ tải quá cao.** Test 30 xe "thất bại" hoá ra chỉ vì 5 pickup `02xx` **không tới được** trên map.
7. **Đo trước khi tối ưu.** `sumOfLoss` **phẳng tuyệt đối** từ budget 50k → 4M: production đốt **1000 ms**
   để ra thứ mà **24 ms** cũng ra.
