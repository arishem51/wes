# Khảo sát backend WES — danh mục những gì hệ thống thực sự làm được

> **Mục đích.** Tìm các tính năng / ràng buộc / cơ chế **có thật trong mã nguồn** mà một bài
> thuyết trình chỉ nói "gán xe" + "định tuyến" sẽ bỏ sót.
>
> **Phạm vi.** Toàn bộ `wes/src` (14.335 dòng TS không kể test, 43 file `*.spec.ts`),
> `ARCHITECTURE.md`, `mainflow.md`, `report/specs/report3-srs.md` §II.1.4.3,
> `report/specs/report4-sds.md` §1.
> Tầng MAPF/LaCAM\* nằm trong repo **kernel Java** (`opentcs-integration-FMS`), **không**
> nằm trong phạm vi khảo sát này — chỗ nào nhắc tới sẽ ghi rõ.
>
> **Quy ước.** Mỗi mục có: (1) tên + đường dẫn file để truy vết, (2) giải thích đời thường,
> (3) một dòng *vì sao khó / vì sao đáng nói*.
> Mục nào chưa đọc được mã xác nhận sẽ ghi **CHƯA XÁC MINH**.

---

## Mục lục

1. [Engine & tiến trình nền](#1-engine--tiến-trình-nền)
2. [Ràng buộc an toàn & nghiệp vụ tinh tế](#2-ràng-buộc-an-toàn--nghiệp-vụ-tinh-tế)
3. [Cơ chế chống hỏng](#3-cơ-chế-chống-hỏng)
4. [Realtime & giám sát](#4-realtime--giám-sát)
5. [Phân quyền & quản trị](#5-phân-quyền--quản-trị)
6. [Độ lệch tài liệu ↔ mã nguồn (phải biết trước khi bị hỏi)](#6-độ-lệch-tài-liệu--mã-nguồn)
7. [Xếp hạng "đáng lên slide"](#7-xếp-hạng-đáng-lên-slide)
- [Phụ lục A — 33 hàm phi giao diện (SRS §II.1.4.3) đối chiếu mã nguồn](#phụ-lục-a--33-hàm-phi-giao-diện-srs-ii143-đối-chiếu-với-mã-nguồn)
- [Phụ lục B — 15 Business Rule và nơi cưỡng chế](#phụ-lục-b--15-business-rule-srs-51-và-nơi-cưỡng-chế)

---

## 1. Engine & tiến trình nền

### 1.0 Bộ điều nhịp: `DispatchSchedulerService` — **một vòng lặp, sáu chặng, cố định thứ tự**

`src/cargo/dispatch-scheduler.service.ts`

Toàn bộ "bộ não" của WES chạy trong **một hàm duy nhất** gọi là *flush*, và flush luôn chạy
sáu chặng **theo đúng thứ tự này**:

```
parkClaims.reconcile()  →  legReconcile.run()  →  releaseEngine.run()
                        →  assignmentEngine.run()  →  chargeEngine.run()  →  parkingEngine.run()
```

Cách kích hoạt (`@OnEvent` × 3 xếp chồng trên **một** handler): `transport-task.created`,
`transport-task.status-changed`, `fms.vehicle.available`. Cộng thêm nhịp tim 5 giây từ tầng
ACL, nên khi kho im lặng thì flush vẫn chạy đều. Còn một cửa thủ công:
`POST /cargo/dispatch/trigger` (204 No Content) cho phép Admin thúc một vòng — hữu ích khi demo.

> **Không có `@Cron` và không có `@Interval` nào trong toàn bộ `src/cargo/`.** Nhịp duy nhất
> nằm ở `src/opentcs/kernel-event-listener.service.ts:37`. Đây là kỷ luật kiến trúc: mọi
> tiến trình nền đều là **một chặng của cùng một vòng lặp**, không phải một cái đồng hồ riêng.

- **Đời thường:** thay vì mỗi bộ phận tự chạy theo đồng hồ riêng, cả hệ thống có **một nhịp
  chung**. Mỗi nhịp, hệ thống lần lượt: dọn sổ giữ chỗ → đối chiếu lại việc đang chạy →
  xét lệnh nào được phép đi → chia việc → lo sạc → lo chỗ đỗ.
- **Vì sao đáng nói:** thứ tự này **không tuỳ tiện**. Dọn sổ trước khi phát lệnh mới (nếu
  không sẽ phát trùng chỗ). Đối chiếu trước khi chia việc (nếu không sẽ giao việc cho xe
  thực ra đang bận). Sạc trước đỗ (pin ưu tiên hơn chỗ đứng). **Đổi thứ tự là mở lại một
  lỗi đã đo được** — đây là loại chi tiết hội đồng không đoán được từ sơ đồ khối.

Ba tham số điều nhịp, đều nằm ngay đầu file:

| Tham số | Giá trị | Vai trò |
|---|---|---|
| `DEBOUNCE_MS` | 1.500 ms | Gộp một chùm sự kiện thành một lần tính |
| `MAX_WAIT_MS` | 3.500 ms | **Trần chống đói** — chùm sự kiện dồn dập không được hoãn flush vô hạn |
| `DISPATCH_HEARTBEAT_MS` | 5.000 ms | Nhịp tim: flush vẫn chạy dù không có sự kiện nào |

`MAX_WAIT_MS` là chi tiết tinh: debounce thuần tuý có một lỗ hổng kinh điển — nếu sự kiện
tới liên tục nhanh hơn 1,5s thì hàm **không bao giờ chạy**. Trần 3,5s đóng lỗ đó.

**Giới hạn phải nói thẳng nếu bị hỏi:** single-flight ở đây là một **biến boolean trong
tiến trình**, không phải khoá phân tán. Thiết kế **giả định WES chạy một bản duy nhất**;
hai bản chạy song song sẽ cùng flush. (Ngược lại, hai khoá advisory ở §2.3 *là* khoá cấp DB
và vẫn đúng khi nhân bản.)

---

### 1.1 `ReleaseEngineService` — cổng "được phép đi hay chưa"

`src/cargo/release-engine.service.ts` + `src/cargo/pickup-dependency.service.ts`
+ luật thuần `src/cargo/domain/pickup-dependency.policy.ts`

Quyết định: lệnh ở trạng thái `CREATED` / `READY_TO_ASSIGN` / `BLOCKED` → chuyển sang
`BLOCKED` (kèm lý do ghi vào `metadata.blockedReason`) hay `READY_TO_ASSIGN`.

Luật (thuần hàm, 47 dòng, có `*.spec.ts`): một lệnh bị chặn khi **trong cùng làn** có một
kiện hàng khác **gần miệng làn hơn** mà vẫn còn nằm ở chỗ của nó.

- **Đời thường:** xe không chui qua kiện hàng được. Muốn lấy kiện trong thì kiện ngoài
  phải đi trước. Lệnh lấy kiện trong bị "giữ lại" kèm câu giải thích, chứ không bị vứt đi.
- **Vì sao đáng nói:** tập "còn nằm ở chỗ của nó" gồm cả `PICKING_UP` — tức **kiện đang
  được xe tới lấy vẫn tiếp tục chặn kiện phía sau**, vì nó vẫn còn nằm đó về mặt vật lý.
  Đây là điểm rất dễ cài sai (coi "đã có xe nhận" = "đã dọn đi").

Hai chi tiết kỹ thuật đáng nhắc trong Q&A:
- **Fail open:** không đọc được hình học khu vực → coi như **không chặn** (`pickup-dependency.service.ts:115`).
  Chọn "cho chạy" thay vì "khoá cả kho" khi dữ liệu thiếu.
- **Kiểm lại lần hai ngay trước khi gán** (`isBlocked()`, dòng 58) — đóng khe hở giữa lúc
  xét và lúc phát lệnh.

---

### 1.2 `AssignmentEngineService` — chia việc theo lô, tối ưu toàn cục

`src/cargo/assignment-engine.service.ts` (385 dòng) + `src/cargo/domain/dispatch.policy.ts`,
`domain/hungarian.ts`, `domain/dispatch-cost.ts`, `domain/routing.ts`,
`src/cargo/vehicle-candidate.service.ts`, `src/cargo/dispatch-distance.service.ts`

Đã có ở slide VI. Bốn thứ **chưa có ở slide** mà nằm trong cùng file này:

**(a) Cách li xe lỗi trong một chu kỳ (`quarantinedVehicleNames`, dòng 95).**
Một chiếc xe mà kernel từ chối nhận lệnh sẽ bị loại **khỏi chu kỳ đó**, rồi hệ thống
**giải lại bài toán ghép** với đội xe còn lại.
*Đời thường:* một chiếc xe hỏng không được phép nuốt hết hàng đợi.
*Vì sao đáng nói:* nếu không có, một xe lỗi sẽ liên tục được chọn (vì nó gần nhất), liên
tục thất bại, và cả lô hàng đứng im.

**(b) Cửa sổ FIFO có kích thước = số xe rảnh (dòng 116–131).**
Chỉ lấy N việc từ **đầu** hàng đợi, N = số xe đủ điều kiện.
*Vì sao đáng nói:* chống đói — nếu lấy hết hàng đợi rồi tối ưu, một việc cũ ở xa sẽ bị
việc mới ở gần chen mãi mãi.

**(c) Ba mức chi phí, không phải một (`domain/dispatch.policy.ts:204–219`).**
Khoảng cách thật < `unknownCost` ("không biết") < `unreachableCost` ("chứng minh được là
không tới được"), với **hệ số nhân theo cỡ lô**:
`unknownCost = (maxCost + 1) × batchScale`, `unreachableCost = unknownCost × batchScale`.
Nếu phép nhân tràn số → ném `RangeError('Dispatch distance matrix exceeds numeric range')`.
*Đời thường:* thứ tự ưu tiên là **phục vụ được nhiều việc nhất → ưu tiên cặp biết chắc
khoảng cách → cuối cùng mới tới cực tiểu quãng đường.**
*Vì sao đáng nói:* đây là mẹo mô hình hoá. Bài toán ghép chỉ tối thiểu **tổng**; muốn nó
ưu tiên theo bậc thì phải nhét thứ bậc vào **giá trị số** — và hệ số nhân được chọn sao cho
**không tổng nào của các chi phí thật có thể thắng nổi một chi phí "không tới được"**.
Bộ giải Hungarian (`domain/hungarian.ts`) **từ chối `Infinity`** (`validateCostMatrix` ném
`TypeError`), nên bậc thang này không phải làm đẹp — nó **bắt buộc** để bài toán hợp lệ.

**(d) `DISPATCH_SWAP` — đổi xe giữa chừng, có trễ trượt.**
`src/cargo/domain/dispatch-swap.ts` + `domain/dispatch.policy.ts:139–145`: mặc định **TẮT**.
Khi bật, chi phí phạt khi đổi xe là `switchCost = baseMm + swapCount × stepMm`
(mặc định 2.000 + 2.000/lần), cộng vào chi phí của xe thách thức; và một lệnh bị **ghim**
(không đổi được nữa) khi `swapCount >= maxSwaps` (mặc định 2).
*Vì sao đáng nói:* đây chính là thuốc chống dao động — **mỗi lần đổi làm lần đổi tiếp theo
đắt hơn**. Cả cơ chế lẫn việc **mặc định tắt nó** đều là quyết định kỹ thuật có lý do.
*Điểm nối đẹp:* một lệnh cũng bị **ghim** nếu xe của nó `committedInsideLane` (§2.2) hoặc
lệnh đang bị chặn — tức **luật an toàn làn trực tiếp cấm bộ giải đụng vào chiếc xe đó**.
Ghim được cưỡng chế **ngay trong ma trận chi phí** (đánh dấu `unreachable`), chứ không phải
bằng một câu `if` sau khi giải xong.

**(e) Hàng "đứng yên" giả lập trong ma trận (`dispatch.policy.ts:210–233`).**
Khi bật swap, ma trận được thêm các **hàng idle tổng hợp** để bộ giải có lựa chọn "giữ
nguyên xe này ở việc hiện tại" như một phương án hợp lệ, thay vì bị ép phải đổi.

**(f) Xe trùng tên bị loại hẳn.** `vehicle-candidate.service.ts:48–67` (`unambiguousAgvs`)
loại mọi tên AGV xuất hiện nhiều lần trong registry — mơ hồ thì **không dùng**, không đoán.

---

### 1.3 `DispatchCounterfactual` — hệ thống tự chấm điểm quyết định của chính nó ⭐

`src/cargo/domain/dispatch-counterfactual.ts` + `assignment-engine.service.ts:149–167`

**Mỗi flush, hệ thống giải bài toán ghép HAI LẦN** trên đúng cùng một ma trận chi phí:
một lần bằng Hungarian, một lần bằng greedy. Chỉ một phương án được thi hành
(`DISPATCH_MATCHER`, mặc định `hungarian`); phương án kia được **ghi lại chứ không chạy** —
lưu vào cột `context` (JSONB) của bảng `task_status_transitions`: xe mà thuật toán kia
sẽ chọn, và khoảng cách của nó.

- **Đời thường:** mỗi lần chia việc, hệ thống đồng thời ghi lại "nếu dùng cách đơn giản
  hơn thì tôi đã chọn xe nào". Mọi lần chạy thật đều **tự mang theo bằng chứng so sánh**.
- **Vì sao đáng nói:** đây là câu trả lời cho câu hỏi phản biện nặng nhất — *"làm sao
  chứng minh Hungarian hơn greedy?"*. Vì hai phương án đến từ **cùng một ma trận, cùng một
  khoảnh khắc, cùng một hàng đợi**, phép so sánh là **so cặp**, phương sai tải giữa các
  lần chạy triệt tiêu. Không cần dựng lại thí nghiệm A/B.
- **Giới hạn cần nói thẳng:** đây là phản-thực-tế **một bước** — nó đo chất lượng của từng
  quyết định lẻ, **không** đo hậu quả tích luỹ (makespan, ùn tắc).
- Hàm `comparableCounterfactual()` còn tự **từ chối ghi** khi hai bên không cùng cách
  định giá (khi bật swap, việc "đang giữ" và việc "mới" không so được) — tức là nó biết
  khi nào phép so sánh của chính nó vô nghĩa.

**Và nó không nằm im trong DB — nó có một endpoint cho người dùng.** ⭐

`GET /cargo/:id/decision` → `CargoService.getAssignmentDecision` (`cargo.service.ts:246`),
đọc dòng `task_status_transitions` gần nhất có `trigger = ASSIGNMENT_ENGINE` và
`to_status = PICKING_UP`, trả về:

| Trường | Nghĩa |
|---|---|
| `vehicleName`, `decidedAt` | Xe nào, lúc nào |
| `matcher` | Thuật toán đã dùng |
| `matchedRequestCount` | Lô đó có bao nhiêu việc được ghép cùng lúc |
| `distanceToSource`, `approachDistance` | Quãng đường tới điểm lấy / tới đầu làn đích |
| `alternative` | **Thuật toán kia sẽ chọn xe nào, và xa bao nhiêu** |

- **Đời thường:** người vận hành bấm vào một kiện hàng và hỏi *"vì sao hệ thống chọn xe
  này?"* — hệ thống trả lời: xe nào, xa bao nhiêu, lúc đó đang ghép mấy việc một lượt, **và
  nếu dùng cách chọn đơn giản hơn thì đã là xe nào**.
- **Vì sao đáng nói:** đây là **explainability** cho một quyết định thuật toán, có thật,
  có endpoint, có trên UI (đúng UC 70 trong SRS). Rất nhiều đồ án tối ưu hoá dừng ở "hệ
  thống chọn xe X" mà không giải thích được. Đây là **một câu trả lời có sẵn cho câu hỏi
  hay bị hỏi nhất**.

---

### 1.4 `TransportTaskSaga` — điều phối 3 chặng

`src/cargo/transport-task.saga.ts` (523 dòng)

Mỗi lệnh WES = **ba transport order** gửi xuống kernel, phân biệt bằng tiền tố tên:

| Chặng | Tên | Nội dung | Xong thì |
|---|---|---|---|
| TO1 | `PICKUP-…` | Tới điểm lấy, nâng hàng | Chốt ô trả → tạo TO2 → `DELIVERING` |
| TO2 | `APPROACH-…` | Chỉ **MOVE** tới đầu làn trả, không thao tác hàng | Tạo TO3 |
| TO3 | `DROPOFF-…` | **HAI drive order**: hạ hàng, rồi lùi ra | `DELIVERY_COMPLETED` + cargo `DELIVERED` |

Chặng nào đang chạy **không** suy ra từ tiền tố tên lệnh mà từ **property `wes:leg`** gắn
trên chính transport order (`domain/events.ts:21–24`), cùng với `wes:taskId`. Nhờ vậy lệnh
đỗ (`wes:leg=PARK`) bị cổng lọc của listener bỏ qua và **không bao giờ lọt vào saga**.

- **Đời thường:** một chuyến hàng được chẻ thành ba đoạn, mỗi đoạn kết thúc ở một mốc
  nghiệp vụ có thật. Huỷ giữa chừng hoặc đổi xe ở ranh giới đoạn đều xử lý được.
- **Vì sao TO3 gói hai đoạn (chi tiết đáng nói nhất):** xe hạ hàng xong phải **lùi ra** khỏi
  ô trả, nếu không nó bịt lối vào của xe kế. Nhưng WES **không** phát một lệnh lùi riêng —
  nó nhét đoạn lùi vào chính TO3 dưới dạng drive order thứ hai. Nhờ vậy đoạn lùi vẫn do
  kernel định tuyến, vẫn được bộ cấp phát tài nguyên cấp đường, và vẫn nằm trong tầm nhìn
  của tầng tránh va chạm. **Thứ tự (hạ xong mới lùi) do kernel cưỡng chế, không do WES
  canh giờ.** Một lệnh lùi phát riêng sẽ là chuyển động "ngoài luồng" mà tầng dưới không
  thấy — đúng loại lỗi sinh va chạm.

**Mốc trung gian `DROPOFF_UNLOADED`.** Listener phát sự kiện này khi drive order **thứ nhất**
của TO3 chuyển FINISHED trong lúc còn drive order khác
(`kernel-event-listener.service.ts:348 dropOffJustUnloaded`). Saga đóng dấu
`metadata.unloadedAt`. Dấu này về sau vừa dùng để **chống lặp**, vừa để hiển thị trạng thái
"đã hạ hàng, đang lùi ra" trên UI.

#### Phục hồi khi xe mất định vị — **có riêng cho từng chặng** ⭐

`transport-task.saga.ts:75–227`, `@OnEvent(FMS_EVENTS.TRANSPORT_ORDER_LOST_NAVIGATION)`

| Mất định vị ở chặng | Hành động phục hồi |
|---|---|
| **PICKUP** | `requeueAfterLostNavigation` — xoá `to1Name` + `assignedVehicleName`, null `assignedAt`/`startedAt`, đưa lệnh **về `READY_TO_ASSIGN`** ⇒ lệnh quay lại hàng đợi và có thể được **giao cho xe khác** |
| **APPROACH** | `recreateApproach` — phát lại TO2 tới **đúng điểm đầu làn đã ghi** (`approachPointName`). Chưa ghi được điểm nào → không làm gì, để `LegReconcileService` lo |
| **DROPOFF** | `recreateDropOff` — chưa chốt ô trả → nhường cho backstop. **Nếu `unloadedAt` đã có** ⇒ phát lại **chỉ phần lùi ra**, *không* hạ hàng lần hai. Nếu không còn gì để làm → gọi thẳng `onDropOffFinished` và kết thúc lệnh |

**Trần thất bại chung:** `MAX_LOST_NAVIGATION_RETRIES = 3`, đếm trên
`metadata.lostNavigationRetries`. Lần thứ 4 → lệnh `FAILED` với lý do
`"<chặng> lost navigation 3 times"`.

- **Đời thường:** xe đọc nhầm mã QR sàn và không biết mình đang ở đâu. Tuỳ **đang ở chặng
  nào** mà hệ thống xử lý khác nhau: đang đi lấy hàng thì **giao lại cho xe khác**; đang đi
  vào làn trả thì **phát lại đúng lệnh cũ**; đã hạ hàng xong rồi thì **chỉ phát lại đoạn
  lùi ra** — tuyệt đối không hạ hàng lần thứ hai.
- **Vì sao đáng nói:** đây là **phục hồi có nhận thức ngữ cảnh**, không phải "thử lại".
  Cái khó nằm ở chỗ "thử lại" một chặng đã hạ hàng rồi sẽ khiến xe hạ hàng lần nữa vào ô đã
  có hàng. Dấu `unloadedAt` chính là thứ chặn điều đó. Và trần 3 lần ngăn vòng lặp vô hạn.

#### Bảo vệ khỏi sự kiện lặp / phát lại

Saga giữ **hai tập trong bộ nhớ** — `processing` và `unloading` (khoá theo `taskId`) — bao
quanh toàn bộ handler theo mẫu *kiểm-tra → thêm → `finally` xoá*. Cộng thêm ba chốt
idempotent theo dữ liệu: `if (to2Name) return`, `if (to3Name) return`,
`if (unloadedAt) return`. Và `findTask(taskId, requiredStatus)` chỉ trả về lệnh **đang đúng
trạng thái mong đợi**, nên một sự kiện phát lại cho lệnh đã đi tiếp là một **no-op**.
Chính ba chốt này là thứ cho phép `LegReconcileService` (§1.8) tự do phát lại sự kiện.

---

### 1.5 `DeliverySlotEngine` — chốt ô trả **muộn nhất có thể**

`src/cargo/delivery-slot.engine.ts` (166 dòng) + `src/zones/domain/zone-topology.ts`

Lúc tạo kiện hàng, hệ thống chỉ **giữ một chỗ** trong khu vực đích
(`cargo.destination_zone_id`, có kiểm sức chứa); **ô cụ thể vẫn để trống**. Ô thật được
chốt tại **rào chắn TO2** — đúng lúc xe đã đỗ ở đầu làn.

Cách chọn ô: dùng `hopsToExit` (BFS ngược từ các điểm ra) làm khoá cột, gom ô theo số bước
tới lối ra, mỗi cột sắp theo `y` rồi `x`, **duyệt cột từ xa nhất về gần nhất** — lấp từ
đáy làn ra. Ô không có đường ra bị loại **hẳn** (xe vào đó sẽ mắc kẹt).

**Luật thác nước** (`delivery-slot.engine.ts:139–145`) — đây mới là phần tinh:
cột gần lối ra nhất **luôn hợp lệ**; cột xa hơn `i` chỉ hợp lệ khi
`valid[i+1] && count[i] − count[i+1] <= 1`.

- **Đời thường:** không cho phép một cột sâu vượt lên trước cột nông hơn quá **một ô**. Kho
  được lấp thành một mặt phẳng nghiêng đều, không thành các mô hàng lởm chởm.
- **Vì sao quan trọng hơn nó trông:** luật này chính là thứ **bảo đảm hai ô mà xe sẽ lùi
  vào (theo định nghĩa là gần lối ra hơn) đang trống**. Bất biến đó là *hệ quả* của thứ tự
  lấp, **không** phải một phép kiểm tra riêng — xem cảnh báo ở §2.1.

Không có lối ra nào → rơi về "ô trống đầu tiên" (`delivery-slot.engine.ts:60–75`),
**không có thứ tự** — đây là nhánh dự phòng làm hỏng bất biến trên (§2.1).

- **Đời thường:** hệ thống không quyết định trước sẽ đặt hàng vào ô nào. Nó chỉ hứa "khu
  vực này còn chỗ cho anh", rồi tới lúc xe đứng ngay cửa làn mới chọn ô — vì lúc đó mới
  biết chắc trong làn đang có gì.
- **Vì sao đáng nói:** từ lúc tạo lệnh tới lúc xe tới nơi, các xe khác đã trả thêm hàng.
  Chốt sớm là chốt sai. Đây là ví dụ sách giáo khoa của **late binding**, và nó là lý do
  WES phải tự chọn ô trả thay vì nhận sẵn từ WMS.

---

### 1.6 `ChargeEngineService` — vòng đời trạm sạc

`src/cargo/charge-engine.service.ts` (330 dòng) + `src/cargo/domain/charge.policy.ts`

Chạy chặng 5 của flush. Hai nửa:

**Đưa đi sạc** — xe `energyLevel <= criticalBatteryThreshold`, đang rảnh, **không đang giữ
lệnh nào**, **không có task đang chạy** (`activeCargoVehicleNames`), **không đang đứng sẵn
trên điểm sạc**, không bị `IGNORED` → tạo lệnh `CHARGE-…` tới **trạm gần nhất còn chỗ**.

**Đếm chỗ trống là chỗ tinh tế** (`freeSlotsByLocation`, dòng 235):
`còn trống = tổng số điểm − số điểm đang có xe đứng − số xe ĐANG TRÊN ĐƯỜNG TỚI`.
Vế thứ ba (`chargeTargets`, một sổ trong bộ nhớ) là thứ chặn hai xe cùng nhắm một trạm.

**Thả khỏi trạm** — chỉ khi `energyLevel >= CHARGE_FULL_PCT` (mặc định **85%**), rồi gửi
`instantAction: stopCharging` (VDA5050).

**Chống kẹt:** hết chỗ ở mọi trạm → xe critical **đi ra chỗ đỗ** (không phải điểm sạc)
thay vì xếp hàng chờ ở trạm — `parkForNoSlot()`, dòng 206. Nếu sổ giữ chỗ chưa dựng lại
được thì bỏ qua nhánh dự phòng này nhưng **vẫn tiếp tục phát lệnh sạc** (dòng 173).

- **Vì sao đáng nói:** "trạm sạc" được mô hình hoá như **tài nguyên đếm được có sức chứa**,
  không phải như một điểm đến bình thường. Nhờ vậy "hết chỗ" là một câu trả lời hợp lệ,
  và hệ thống có hành vi đúng cho nó.

---

### 1.7 `ParkingEngineService` + `ParkClaimStore` — sổ giữ chỗ đỗ ⭐

`src/cargo/parking-engine.service.ts` (192 dòng), `src/cargo/park-claim.store.ts`,
`src/cargo/domain/parking.policy.ts`

WES **tắt** `parkIdleVehicles` của openTCS và tự làm, để chỗ đỗ tôn trọng được sổ giữ chỗ,
điểm sạc và hàng đợi việc.

**Cổng đội xe:** ngừng đỗ khi còn bất kỳ lệnh nào ở `CREATED` / `READY_TO_ASSIGN` /
`BLOCKED`. Ba trạng thái này là việc mà chặng gán **sắp** cần xe.
`PICKING_UP` / `DELIVERING` **không** chặn — chúng đã cầm xe rồi.

**Cổng từng xe:** bật điều phối, không ignore, kernel báo `IDLE`/`AWAITING_ORDER` +
`TO_BE_UTILIZED`, không cầm lệnh, không có task, trên ngưỡng nguy cấp, đã định vị được, và
**chưa đứng sẵn trên một điểm đỗ**. **Không có độ trễ chờ** — chặng gán vừa chạy ngay
trước đó trong cùng flush và đã từ chối chiếc xe này rồi.

**Điểm đỗ bị coi là không dùng được** khi một trong ba giai đoạn của cùng một hành trình:

| Giai đoạn | Nguồn |
|---|---|
| Lệnh vừa tạo, kernel chưa gắn vào xe | `ParkClaimStore.claimedPoints()` |
| Xe đang trên đường tới | giải mã từ **tên lệnh** đang gắn trên xe |
| Xe đang đứng trên đó | vị trí xe trong snapshot |

**Tên lệnh mang theo đích đến** (`src/cargo/domain/transport-order-name.ts`): mọi lệnh WES
phát ra đều có dạng `<LOẠI>-<xe>-<đích>-<uuid>`, LOẠI ∈ {PARK, CHARGE, PICKUP, APPROACH,
DROPOFF}. Nhờ vậy đích đến **đi kèm trong chính cái tên mà kernel lưu và trả về** — không
cần bảng tra cứu cục bộ, không có gì phải dựng lại sau restart.

**Luật nhả chỗ** (`reconcile()`, chạy đầu mỗi flush), xét theo đúng thứ tự, chỉ nhánh cuối
tốn một lần gọi HTTP:
1. xe đang đứng trên điểm đã giữ → nhả (vị trí xe tự bảo vệ nó rồi);
2. xe đang chạy đúng lệnh đó → nhả (tên lệnh tự bảo vệ nó rồi);
3. còn lại → hỏi kernel: 404 hoặc `FINISHED`/`FAILED`/`UNROUTABLE` → nhả;
   trạng thái khác → giữ; **kernel không trả lời → GIỮ**.

**`WITHDRAWN` không phải trạng thái cuối** trong openTCS 7.3.0 (nó thành `FAILED` sau đó),
nên lệnh bị thu hồi **vẫn giữ chỗ**.

**Dựng lại từ kernel, không bao giờ giả định là rỗng** (`OnApplicationBootstrap`): một lần
gọi `getTransportOrders()` toàn đội để dựng lại mọi giữ chỗ. **Cho tới khi dựng lại xong,
`isReady()` = false và không engine nào được phép phát lệnh đỗ.**

- **Đời thường:** một chỗ đỗ được ghi vào **một quyển sổ duy nhất mà cả hai bộ máy (sạc và
  đỗ) đều đọc**, và chỗ chỉ được nhả khi có bằng chứng chắc chắn.
- **Vì sao đáng nói — đây là mục "chống dao động" mạnh nhất:** trước khi có sổ này, hai bộ
  máy giữ hai danh sách loại trừ riêng ⇒ hai xe cùng nhắm một điểm. Đo được: 268 lệnh đỗ /
  16 hoàn tất trên một mẻ 14 kiện (~19 lệnh/kiện, một điểm nhận 75 lệnh) → sau khi vá còn
  **~0,21 lệnh/kiện**, xe kết thúc ở 15 điểm khác nhau.
- **"Fail closed":** sổ rỗng **không** có nghĩa "không ai giữ chỗ" — có thể chỉ là chưa
  dựng lại kịp. Khi chưa chắc, hệ thống **từ chối phát lệnh mới**. Đây là một nguyên tắc
  thiết kế phát biểu được thành một câu, và hội đồng sẽ nhận ra nó.
- **Lệnh đỗ là lệnh "bỏ được"** (`dispensable: true`) — có việc thật tới thì kernel tự bỏ
  lệnh đỗ. **WES không bao giờ thu hồi lệnh đỗ.** Nhờ vậy phần lớn việc "huỷ lệnh đỗ" xảy
  ra **không tốn một lần gọi API nào** và không thành cuộc chạy đua giữa hai bên.

---

### 1.8 `LegReconcileService` — mạng lưới an toàn cho sự kiện bị mất ⭐

`src/cargo/leg-reconcile.service.ts` — chặng 2 của mọi flush

Với **mỗi** lệnh đang sống, hệ thống **tự tính lại** xem lẽ ra nó phải đang ở chặng nào
(từ status + metadata của chính nó), rồi — **chỉ khi xe đã rời khỏi lệnh đó** — hỏi kernel
đúng **một** lệnh theo tên:
`FINISHED` → phát lại `fms.transport-order.finished`;
`FAILED`/`UNROUTABLE` → cho lệnh thất bại.

- **Đời thường:** đường truyền sự kiện có thể rớt gói (restart, hot-reload, mạng chớp).
  Cứ mỗi nhịp, hệ thống lại tự hỏi "theo sổ của tôi thì việc này đang ở đâu?" và đi xác
  minh, thay vì tin rằng tin nhắn nào cũng tới.
- **Vì sao đáng nói:** đây là khác biệt **edge-triggered vs level-triggered**. Sự kiện là
  đường nhanh; **tính đúng đắn không bao giờ phụ thuộc vào một sự kiện**. Nó cũng cố ý
  **không** kéo danh sách `/transportOrders` (lịch sử tăng vô hạn) — trường `transportOrder`
  trong snapshot của xe là bộ dò thay đổi rẻ tiền.

---

### 1.9 `TaskTerminationService` — thu hồi lệnh, chống lệnh mồ côi

`src/cargo/task-termination.service.ts`

Khi huỷ / xoá kiện hàng, nó thu hồi **hai** thứ và khử trùng lặp:
(a) lệnh mới nhất **ghi trên task** (`to3Name ?? to2Name ?? to1Name`), **và**
(b) lệnh mà **xe đang thực sự chạy** (đọc từ `VehicleStateStore`).

- **Vì sao đáng nói:** hai thứ này có thể **khác nhau** — nếu saga vừa mới chuyển chặng thì
  DB và thực tế lệch nhau một nhịp. Chỉ thu hồi theo sổ sẽ để lại một lệnh mồ côi đang chạy
  trên xe. Đây đúng là loại chi tiết mà "gọi withdraw API" trên slide che mất.
- Nếu trạng thái đã đổi khiến bước chuyển không hợp lệ → **thu hồi vẫn thực hiện**, chỉ bỏ
  qua bước đổi trạng thái (dòng 36–41).

---

### 1.10 Các dịch vụ hỗ trợ (mỗi cái một câu)

| Dịch vụ | File | Quyết định gì |
|---|---|---|
| `RoutingService` | `src/cargo/routing.service.ts`, `domain/routing.ts` | Dựng đồ thị đường đi (và **đồ thị ngược**) từ plant model; **loại path `locked`**; cache **theo identity đối tượng** (`plantModel === cachedModel`) nên tự vô hiệu khi model đổi. Dijkstra có MinHeap nhị phân tự viết |
| `ZoneGeometryService` | `src/cargo/zone-geometry.service.ts` | Suy ra hai trục `laneKey` / `depthKey` từ **các path đi vào khu vực từ bên ngoài**, tính tâm lối đi, chiếu từng ô lên hai trục, rồi **làm tròn về lưới 1.000 mm** (`GRID_ROUND`) — chống sai số toạ độ làm hai ô cùng làn bị coi là khác làn. Không có path vào → `null` (fail open) |
| `ApproachPointService` | `src/cargo/approach-point.service.ts` | Chọn **đầu làn** rẻ nhất mà xe tới được, làm đích cho TO2 — `computeFeederPoints()` rồi hỏi kernel `computeRoutes`, lọc `cost >= 0`, lấy min. Không có đầu làn nào → lùi về **toàn bộ** ô thành viên. Lỗi truy vấn → `null`, saga để lệnh nằm `PICKING_UP` cho backstop lo |
| `RetreatPointService` | `src/cargo/retreat-point.service.ts`, `domain/retreat-point.ts` | Tìm điểm lùi 2 ô ngay sau ô trả: **cùng x, Δy dương nhỏ nhất, mỗi bước phải đi được, không rẽ, không nhảy cóc**. Không giải được → cảnh báo và **TO3 vẫn đi** chỉ với ô trả: *một lỗ hổng topology không được phép chặn một chuyến giao hàng* |
| `VehicleCandidateService` | `src/cargo/vehicle-candidate.service.ts` | Ghép registry `AgvEntity` với telemetry sống → danh sách xe đủ điều kiện. **Loại hẳn mọi tên AGV bị trùng** |
| `DispatchDistanceService` | `src/cargo/dispatch-distance.service.ts` | Nguồn khoảng cách dùng chung trong một flush. Chạy Dijkstra trên **đồ thị NGƯỢC** từ điểm lấy hàng ⇒ **một lần chạy ra chi phí của mọi xe tới điểm đó** thay vì mỗi xe một lần |
| `DispatchPolicyService` | `src/cargo/dispatch-policy.service.ts` | Đọc **bộ trọng số đang hoạt động** mỗi flush; `activate()` chạy transaction *xoá hết cờ rồi bật một cái*; DB còn có **partial unique index** ép **tối đa một policy active** |
| `PickupOrderService` | `src/cargo/pickup-order.service.ts` | Tạo / thu hồi lệnh TO1, dùng chung cho gán và cho swap. `issue()` trả `false` khi kernel từ chối → engine cách li xe đó. `revoke()` tăng `metadata.swapCount` (đầu vào của luật trễ trượt) |

---

## 2. Ràng buộc an toàn & nghiệp vụ tinh tế

### 2.1 "Không được né vào ô có cargo" — chỗ này phải nói cho chính xác ⚠

Người dùng nêu ràng buộc này làm ví dụ. **Đã kiểm tra toàn bộ `wes/src`: không có luật nào
mang đúng ngữ nghĩa "khi tránh nhau thì đừng bước vào ô đang có hàng".** Nó nằm ở
**tầng kernel Java**, không ở backend WES.

**Gốc rễ:** *kiện hàng không phải là tài nguyên của kernel* (`ARCHITECTURE.md:452`). openTCS
biết vị trí xe, biết ô đường, nhưng **hoàn toàn không biết trong kho có thùng hàng nào**.
Mọi thông tin "ô này có hàng" chỉ tồn tại trong bảng `cargos` của WES. Đó là lý do WES phải
tự cưỡng chế mọi luật liên quan tới hàng — không có tầng nào bên dưới làm hộ.

**Năm nơi WES tra "ô này có hàng chưa" — đã đọc mã, đủ cả:**

| # | Nơi | Cơ chế |
|---|---|---|
| 1 | Chọn ô trả | `delivery-slot.engine.ts:122–130` — `cargoRepo.find({destinationLocationName IN members, status IN [ACTIVE, DELIVERED]})` |
| 2 | Luật lấy hàng (BR-10) | `pickup-dependency.policy.ts:28–40` — proxy chiếm chỗ = có task ở `AT_SOURCE` gắn với `sourcePickupLocationName` |
| 3 | An toàn làn lúc tạo hàng | `lane-safety.service.ts:191–194` — `cargoRepo.find({sourceZoneId, status: ACTIVE})` |
| 4 | Một ô một kiện | `cargo.service.ts:146–156` |
| 5 | Sức chứa khu vực | `cargo.service.ts:393–408` `assertZoneHasRoom` |

**Còn "né vào ô có hàng khi tránh nhau" thì sao:**

| Nơi | Cơ chế | Trạng thái |
|---|---|---|
| **Kernel Java (MAPF)** | `fms.mapf.cargoSlotSurcharge` — một điểm **đang có hàng** bị **cộng thêm 2 bước** vào chi phí, nên bộ giải tự né nó khi tìm chỗ tránh | Ghi trong SRS §II.1.4.3 mục #24. **CHƯA XÁC MINH bằng mã** — nằm ngoài repo này |
| **WES — điểm lùi sau khi trả hàng** | `resolveRetreatPath` **thuần hình học + topology** — cùng x, Δy dương nhỏ nhất, mỗi bước phải đi được, không lặp. `RetreatPointService` **chỉ tiêm `KernelApiService`**, không hề có repository `CargoEntity` | ✅ đã đọc mã — **không kiểm tra hàng** |

**Vậy vì sao ô lùi vẫn trống?** Vì **luật thác nước ở §1.5**: kho luôn được lấp từ đáy làn
ra, nên hai ô gần lối ra hơn — đúng hai ô mà xe sẽ lùi vào — **theo cấu trúc là trống**.
Đây là một **bất biến phát sinh (emergent invariant)**, không phải một phép kiểm tra.

> ⚠ **Lỗ hổng đã xác định, nên chủ động nói ra nếu bị hỏi:** nhánh dự phòng "không có lối
> ra" của `DeliverySlotEngine` (`delivery-slot.engine.ts:60–75`) chọn **ô trống đầu tiên,
> không theo thứ tự nào**. Nếu nhánh đó chạy, bất biến trên bị phá, và `resolveRetreatPath`
> sẽ vui vẻ lùi xe qua một ô đang có hàng. Không có gì trong `retreat-point.ts` chặn được.

> **Khuyến nghị cho slide:** nếu muốn dùng ví dụ này, hãy trình bày nó là **"phối hợp hai
> tầng"**: WES là nơi **duy nhất** biết ô nào có hàng (kernel mù hoàn toàn về việc này);
> kernel là nơi ra quyết định né (dữ liệu hình học + thời gian). Đó là một câu chuyện kiến
> trúc mạnh hơn nhiều so với một luật lẻ — và nó giải thích luôn **vì sao WES phải tồn tại**.

---

### 2.2 `LaneSafetyService` — luật an toàn tinh vi nhất trong toàn hệ ⭐⭐

`src/cargo/lane-safety.service.ts` (270 dòng, + `lane-safety.service.spec.ts` 300 dòng)
+ luật thuần `src/cargo/domain/lane-safety.policy.ts`

**Vấn đề:** kiện hàng **không phải là tài nguyên của kernel**. Nghĩa là không có tầng nào
dưới WES ngăn được việc đặt một kiện mới vào ô **nông** trong khi đã có một chiếc xe được
lệnh vào ô **sâu** của cùng làn đó. Xe sẽ bị nhốt.

**Cách giải:** khi tạo kiện hàng mới, với **mỗi** lệnh `PICKING_UP` có kiện nằm sâu hơn
trong cùng làn, WES đọc **`allocatedResources`** của chiếc xe đó — tức **những ô đường mà
bộ cấp phát của kernel ĐÃ CẤP cho nó** (chỉ lấy point; tài nguyên dạng `A --- B` là path,
bỏ qua) — và so với tập point của làn:

| Kết quả | Hành động |
|---|---|
| **Giao nhau** | `BadRequestException`, **không thu hồi gì, không tạo kiện hàng**. Thông báo nêu đích danh tên xe và ô nó đang tới |
| **Rời nhau** | Thu hồi TO1 → `changeStatus(BLOCKED)` với `trigger='CARGO_CREATE'`, `context.preempted=true`; xoá `to1Name`, `assignedVehicleName`, `assignedAt`, `startedAt` |

- **Đời thường:** trước khi cho phép đặt một kiện hàng mới vào làn, hệ thống hỏi tầng dưới:
  *"chiếc xe đang đi vào làn này, nó đã được cấp quyền đi tới đâu rồi?"*. Nếu nó đã được cấp
  quyền vào bên trong làn thì **quá muộn để gọi nó ra** — hệ thống từ chối nhận kiện hàng
  và nói rõ vì sao. Nếu nó chưa vào, hệ thống **gọi nó về** rồi mới nhận kiện.
- **Vì sao đáng nói (đây là điểm mạnh nhất về mặt kỹ thuật):**
  1. Nó ra quyết định dựa trên **trạng thái cấp phát tài nguyên của tầng dưới**, không dựa
     trên trạng thái của chính nó. Rất ít hệ sinh viên nhìn xuống sâu tới mức đó.
  2. **Lý do phải từ chối:** `withdrawTransportOrder(name, immediate=false)` **không**
     xoá hàng lệnh của xe — nên một chiếc xe đã được cấp tài nguyên trong làn
     **không đảm bảo dừng được trước khi vào**. Từ chối là câu trả lời **đúng**, không
     phải câu trả lời lười.
  3. **Thứ tự là thuộc tính an toàn, không phải giao dịch** (`cargo.service.ts`): thu hồi
     lệnh **không rollback được** và một DB transaction **không hoàn tác được nó**. Nên mọi
     thứ hỏng-rẻ chạy trước: resolve điểm lấy → tiền kiểm sức chứa (đọc không khoá) →
     cổng lane-safety → thu hồi + block **từng lệnh một** (thu hồi trước, để thu hồi hỏng
     thì lệnh vẫn `PICKING_UP` và thử lại được) → **cuối cùng** mới tới transaction có
     advisory lock để kiểm lại sức chứa và ghi cargo + task.
     **Không có lời gọi HTTP nào chạy bên trong transaction đó** — nó sẽ giữ advisory lock
     của cả khu vực suốt một timeout kernel 10 giây.
  4. **Đua được chấp nhận có ý thức:** chỗ trong khu có thể bị lấy mất giữa tiền kiểm và
     kiểm lại, để lại một lệnh `BLOCKED` không có ai chặn — flush kế tiếp `unblock()` sẽ
     trả nó về `READY_TO_ASSIGN`. Đây là *biết mình đánh đổi cái gì*, chứ không phải bỏ sót.
- **Nguồn `allocatedResources`:** đọc từ `VehicleStateStore` khi SSE còn nối; **đọc thẳng
  `GET /v1/vehicles`** khi mất kết nối — vì nhịp tim 5 giây là **quá cũ** cho biên độ này.

---

### 2.3 Khoá cấp Postgres theo khu vực (`pg_advisory_xact_lock`) ⭐

Hai chỗ, đúng hai chỗ: `src/cargo/cargo.service.ts:191` và `src/cargo/transport-task.saga.ts:442`
— cả hai đều `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)` với khoá là **zone id**.

- **Đời thường:** hai người quét hàng cùng lúc vào cùng một khu vực sẽ **xếp hàng** ở tầng
  CSDL, không phải ở tầng ứng dụng. Khoá tự nhả khi transaction kết thúc — kể cả khi tiến
  trình chết.
- **Vì sao đáng nói:** đây là khoá **phân tán, tự dọn dẹp**, không cần Redis, không cần
  thêm hạ tầng. Và nó đúng độ mịn: khoá **theo từng khu vực**, không khoá cả kho — hai khu
  vực khác nhau vẫn chạy song song.
- Trong saga, bên trong khoá còn có một bước **đọc lại** (`fresh.destinationLocationName`)
  để nếu ô đã được chốt rồi thì dùng luôn — làm cho `commitDropoffSlot` **idempotent**.

---

### 2.4 Máy trạng thái là **nơi duy nhất** gán `task.status`

`src/cargo/domain/transport-task.state-machine.ts` (63 dòng) qua
`src/cargo/transport-task.service.ts:55` (`changeStatus` — điểm ghi duy nhất)

Bảng chuyển **thực tế trong mã** (rộng hơn tài liệu, xem §6):

| Từ | Được phép sang |
|---|---|
| `CREATED` | READY_TO_ASSIGN, BLOCKED, CANCELLED, FAILED |
| `READY_TO_ASSIGN` | PICKING_UP, **BLOCKED**, CANCELLED, FAILED |
| `BLOCKED` | READY_TO_ASSIGN, CANCELLED, FAILED |
| `PICKING_UP` | DELIVERING, **READY_TO_ASSIGN** *(swap)*, **BLOCKED** *(lane-safety preempt)*, CANCELLED, FAILED |
| `DELIVERING` | DELIVERY_COMPLETED, CANCELLED, FAILED |
| `DELIVERY_COMPLETED` / `CANCELLED` / `FAILED` | — (cuối) |

- **Vì sao đáng nói:** hai bước lùi `PICKING_UP → READY_TO_ASSIGN` và `PICKING_UP → BLOCKED`
  **không phải lỗi thiết kế** — chúng là hai cơ chế preempt có chủ đích (đổi xe, và dọn làn).
  Một máy trạng thái "sạch" chỉ tiến một chiều sẽ **không cài được** hai luật an toàn ở §2.2
  và §1.2(d).
- Engine **không bao giờ** gọi thẳng máy trạng thái — mọi thứ đi qua `changeStatus()`:
  kiểm hợp lệ → ghi DB → ghi sổ audit → phát sự kiện. Sai bước là **ném exception**, không
  phải ghi log rồi đi tiếp.

---

### 2.5 Các luật nghiệp vụ nhỏ nhưng "người ngoài không đoán được"

| Luật | Ở đâu | Ý nghĩa |
|---|---|---|
| Xe **bị IGNORED** vẫn là **vật cản** | `agvs.service.ts` — `ignore` đặt kernel `TO_BE_RESPECTED` (không phải `TO_BE_IGNORED`) | "Không giao việc" ≠ "không tồn tại trên sàn". Tầng tránh va chạm **vẫn phải thấy** chiếc xe đó |
| `disconnect` mới là `TO_BE_IGNORED` | `agvs.service.ts` | Hai mức "loại khỏi hệ thống" khác nhau, có ý thức |
| Điểm sạc **bị loại khỏi** tập điểm đỗ | `parking-engine.service.ts:130 parkPool()` | Điểm sạc là tài nguyên hiếm; xe đầy pin đỗ lì ở đó chặn xe đang cạn |
| Xe **đang sạc** bị loại khỏi ứng viên điều phối | `domain/vehicle-availability.ts:11` — `state !== 'CHARGING'` | Một dòng, nhưng thiếu nó thì xe đang sạc bị lôi ra làm việc |
| Không tạo được kiện ở point đã có kiện chờ | `cargo.service.ts:146` | Một ô, một kiện |
| **Không xoá được kiện khi xe đang cầm/đang thao tác nó** | `cargo.service.ts:336–369` `assertVehicleIsNotHandlingTheLoad` — đọc `allocatedResources` của xe; với `PICKING_UP` so với `sourcePointName`, với `DELIVERING` so với điểm đích **nhưng chỉ khi `to3Name` tồn tại và `unloadedAt` chưa đóng dấu** | Xoá "kiện hàng" trên phần mềm trong lúc xe đang **thực sự nâng nó** ngoài kho ⇒ sổ sách và hiện thực lệch vĩnh viễn. Điều kiện `unloadedAt` là chỗ tinh: hạ hàng **xong rồi** thì xoá lại được |
| **Không tạo được kiện nếu khu vực đích thuộc bản đồ khác** | `cargo.service.ts` — đối chiếu với tên plant model **đang nạp** | Chống dùng nhầm cấu hình của bản đồ cũ |
| Khu vực **DROPOFF** phải chứng minh được **mọi ô đều tới được từ đầu làn** trước khi tạo | `zone.service.ts assertDropoffZoneReachable` | Từ chối cấu hình sai **tại lúc cấu hình**, không phải lúc xe kẹt |
| Không xoá được điểm/khu vực đang có hàng tham chiếu (BR-12) | `zone.service.ts remove()` — chỉ gỡ location khỏi kernel nếu không zone nào khác còn dùng | Cấu hình không được phép làm hỏng vận hành đang chạy |
| `positionIndex` / `locationName` trùng trong một khu → từ chối | `zone.service.ts validateMembers` | |
| Tên, loại, thành viên của khu vực **bất biến sau khi tạo**; chỉ đổi được màu | `zone.dto.ts UpdateZoneDto` | Đổi hình học khu vực dưới chân một lệnh đang chạy là không an toàn |
| Zone gắn cứng vào **`plant_model_name`** | `zone.service.ts:332` | Nhiều bản đồ dùng trùng tên point ⇒ trùng tên **không phải** bằng chứng cùng bản đồ |

---

## 3. Cơ chế chống hỏng

### 3.1 Bảng tổng hợp

| Cơ chế | Ở đâu | Chống cái gì |
|---|---|---|
| **Single-flight** `isFlushing` + `rerunWanted` | `dispatch-scheduler.service.ts:59` | Hai flush chạy chồng nhau ⇒ gán trùng. Yêu cầu đến trong lúc đang chạy được **gộp thành một lần chạy lại** |
| **Debounce 1,5s + trần 3,5s** | cùng file | Tính đi tính lại; và **chống đói** khi sự kiện dồn dập |
| **Nhịp tim 5s** | `kernel-event-listener.service.ts` | Không có sự kiện thì vẫn phải có tiến triển |
| **Advisory lock theo zone** | `cargo.service.ts:191`, `saga:442` | Hai lệnh cùng nhắm một ô trả |
| **Sổ giữ chỗ đỗ dùng chung** | `park-claim.store.ts` | Hai xe cùng nhắm một chỗ đỗ; hai engine mù nhau |
| **Sổ `chargeTargets`** | `charge-engine.service.ts:48` | Hai xe cùng nhắm một trạm sạc |
| **Fail closed khi sổ chưa dựng lại** | `parkClaims.isReady()` | Sau restart, "sổ rỗng" bị hiểu nhầm thành "không ai giữ chỗ" |
| **Cách li xe lỗi trong 1 chu kỳ** | `assignment-engine.service.ts:95` | Một xe hỏng nuốt cả hàng đợi |
| **Preempt có trễ trượt** | `domain/dispatch-swap.ts` (mặc định TẮT) | Đổi xe qua lại vô hạn |
| **Preempt bằng lane-safety** | `lane-safety.service.ts:157` | Xe bị nhốt trong làn |
| **Đối chiếu chặng (level-triggered)** | `leg-reconcile.service.ts` | Mất sự kiện ⇒ lệnh treo vĩnh viễn |
| **Đối chiếu xe (level-triggered)** | `kernel-event-listener.service.ts reconcileVehicleStates()` | Mất khung "→ IDLE" ⇒ xe rảnh mà không ai biết |
| **Thu hồi cả hai tên lệnh** | `task-termination.service.ts` | Lệnh mồ côi khi saga vừa chuyển chặng |
| **Hai tập chống tái nhập của saga** (`processing`, `unloading`) | `transport-task.saga.ts:33-34` | Hai sự kiện cùng lệnh tới song song ⇒ tạo hai chặng kế tiếp |
| **Ba chốt idempotent theo dữ liệu** (`to2Name` / `to3Name` / `unloadedAt`) | `transport-task.saga.ts:254, 345, 235` | Sự kiện phát lại (do backstop) tạo lệnh trùng. **Đây là thứ cho phép §1.8 tự do phát lại** |
| **`findTask(taskId, requiredStatus)`** | `transport-task.saga.ts:476` | Sự kiện tới muộn cho lệnh đã đi tiếp → no-op, không phải lỗi |
| **Trần 3 lần mất định vị** | `transport-task.saga.ts:28` | Vòng lặp phát-lại vô hạn khi xe hỏng định vị |
| **Tên lệnh sinh bằng `randomUUID()`** | mọi chỗ tạo order | Một lần thử lại **không bao giờ đụng tên** một lệnh còn sống |
| **Ghim lệnh khỏi bị swap** | `dispatch.policy.ts:139` + `assignment-engine:345` | Đổi xe cho một chiếc **đã được cấp tài nguyên vào làn** ⇒ nhốt xe |
| **Chống listener nhân bản** | `connectionGeneration` + `isCurrentConnection()` | Nhiều bản SSE listener trong một tiến trình ⇒ log & ghi trùng 12–26 lần |
| **Watchdog SSE đứng hình 60s** | `SSE_STALL_TIMEOUT_MS` | Kết nối "còn mở nhưng chết" — TCP không báo |
| **Reap phiên mồ côi** | `fleet-telemetry.service.ts reapOrphanedSessions()` | Phiên `ended_at IS NULL` sau khi tiến trình chết |
| **Chống trùng ở 2 tầng trước khi ghi DB** | `VehicleStateStore` fingerprint → `FleetTelemetry` 4-field snapshot | Ghi hàng triệu dòng telemetry không đổi |
| **Chống trùng khung lệnh** | `lastOrderSignature` trong listener | Xử lý lặp cùng một chuyển trạng thái |
| **Xoay refresh token một lần dùng** | `token.service.ts rotateRefreshToken` | Token bị đánh cắp dùng lại |
| **Partial unique index** `WHERE is_active` | migration `1794…` | Hai dispatch policy cùng active |

### 3.2 Xử lý xe mất kết nối / mất định vị

| Tình huống | Hệ thống làm gì | File |
|---|---|---|
| **Mất SSE với kernel** | `setConnected(false)` toàn đội; mọi AGV hiện `kernelStatus = unknown`; **các thao tác không phụ thuộc FMS vẫn chạy**; tự nối lại sau 3s, không giới hạn số lần | `vehicle-state.store.ts`, `agvs.mapper.ts resolveKernelStatus()` |
| **Xe không có trong store** | `kernelStatus = unreachable` | `agvs.mapper.ts` |
| **Xe mất định vị (`adapterLostNavigation`)** | Lệnh **KHÔNG** bị cho là thất bại. Phát `fms.transport-order.lost-navigation` → saga phục hồi **khác nhau theo từng chặng** (§1.4), trần 3 lần. `LegReconcileService` là **nơi duy nhất** phát sự kiện này — listener SSE không phát | `domain/vehicle-errors.ts`, `leg-reconcile.service.ts:94–108`, `transport-task.saga.ts:75–227` |
| **Xe không xác định trong kernel** | HTTP 404 → `NotFoundException` **bằng tiếng Việt**, hướng dẫn: nạp bản đồ có xe này, hoặc xoá AGV khỏi danh sách | `opentcs/vehicle-command-error.ts` |
| **Kernel không trả lời khi hỏi lệnh giữ chỗ** | **GIỮ** chỗ (fail closed) — phân biệt "kernel nói nó biến mất" với "kernel không trả lời" bằng `getTransportOrderStateStrict` | `park-claim.store.ts` |
| **Kernel ở chế độ OPERATING khi upload bản đồ** | 400/409 → dịch thành 503 kèm hướng dẫn chuyển sang MODELLING | `opentcs/save-plant-model.ts` |
| **Xe báo vị trí ngoài tuyến (openTCS đóng băng)** | **Chưa xử lý — cố ý.** Cờ đóng băng không phơi qua REST; bắt được nó cần một vòng quét lệnh `BEING_PROCESSED` không tiến triển | ghi trong `ARCHITECTURE.md` §6.6 |

**Chính sách lỗi chia đôi có chủ đích** (`kernel-api.service.ts`): đường **đọc** nuốt lỗi
(trả `[]`/`null`); đường **ghi/lệnh** ném exception. Lỗi gọi openTCS được bắt ở phía cargo
(`AssignmentEngineService.assign`, `TransportTaskSaga.createNextOrder`): ghi log và **bỏ
bước, KHÔNG đổi trạng thái lệnh** — nên flush kế tiếp tự thử lại. Đây là mẫu
*retry-by-idempotent-reconvergence*, không phải retry đếm lần.

---

## 4. Realtime & giám sát

### 4.1 Luồng sự kiện đầy đủ — **hai chặng SSE**

```
openTCS kernel
   │ SSE  GET /v1/sse?/events/transportOrders=true&/events/vehicles=true
   ▼
KernelEventListenerService        ← client HTTP thủ công (node:http), tự tách khung "\n\n"
   │  ├─ VehicleStateStore.set()  → lọc bằng fingerprint, chỉ phát khi THỰC SỰ đổi
   │  └─ phát 5 sự kiện fms.*
   ▼
EventEmitter2 (trong tiến trình — không có Kafka/Redis)
   ├─ TransportTaskSaga           ← finished / lost-navigation / dropoff-unloaded
   ├─ DispatchSchedulerService    ← vehicle.available  (+2 sự kiện transport-task.*)
   └─ VehicleErrorService         ← vehicle.error-changed → ghi 1 dòng vào DB
   ▼
VehicleStateStore.vehicleUpdates (RxJS Subject)
   ▼
@Sse('kernel/sse')  — maps.controller.ts:79           ← chặng SSE THỨ HAI
   ▼
Trình duyệt: EventSource("/api/maps/kernel/sse?token=<jwt>")
   → gom vào Map, xả vào react-query theo requestAnimationFrame
```

Năm sự kiện (`src/cargo/domain/events.ts`): `fms.transport-order.finished`,
`.lost-navigation`, `.dropoff-unloaded`, `fms.vehicle.available`, `fms.vehicle.error-changed`;
cộng 4 sự kiện nghiệp vụ `transport-task.created/status-changed/completed/failed`.

- **Vì sao đáng nói:**
  - **Không có message broker.** Toàn bộ tách rời (decoupling) làm trong tiến trình. Đây là
    quyết định kiến trúc có chủ đích, viết thành luật trong `ARCHITECTURE.md` §10.
  - **JWT truyền qua query param** vì `EventSource` của trình duyệt **không đặt được header**
    — `jwt.strategy.ts` chấp nhận cả `Authorization: Bearer` lẫn `?token=`. Một chi tiết
    tích hợp thật mà tài liệu chuẩn không nói (đánh đổi: token lọt vào URL/log).
  - **Chặng SSE thứ hai chỉ chở trạng thái xe** — sự kiện lệnh không rời khỏi backend.
  - **Lọc thay đổi ở tầng store**: fingerprint = JSON của cả trạng thái trừ `observedAt`.
    Giống hệt nhau ⇒ **không ghi, không phát**. Nhờ vậy luồng đẩy xuống trình duyệt chỉ
    chở **delta thật**.

### 4.2 Bốn bảng chỉ-ghi-thêm (append-only) — hạ tầng đo đạc

migration `1792000000000-AddInstrumentationTables.ts` + `1798…-AddVehicleErrorEvents.ts`

| Bảng | Một dòng = | Ai ghi | Ghi chú |
|---|---|---|---|
| `task_status_transitions` | một lần đổi trạng thái lệnh (kể cả dòng "khai sinh" `NULL → CREATED`) | **chỉ** `TransportTaskService` | Có `trigger` (API / CARGO_CREATE / RELEASE_ENGINE / ASSIGNMENT_ENGINE / SAGA / LEG_RECONCILE), `vehicle_name`, `reason`, và **`context` JSONB** — nơi chứa phản-thực-tế và cờ `preempted` |
| `vehicle_state_transitions` | một lần đổi vị trí / procState / state / lệnh của xe | `FleetTelemetryService` | Gom bộ đệm, xả theo lô mỗi **1.500 ms** |
| `vehicle_error_events` | một lần đổi tập lỗi của xe (`RAISED`/`CHANGED`/`CLEARED`) | `VehicleErrorService` | Không bao giờ UPDATE — phục hồi là **dòng mới** |
| `sse_sessions` | một lần nối/ngắt SSE với kernel | `FleetTelemetryService` | Để **không tính khoảng thời gian xuyên qua một khoảng mù** |
| `runs` | một cửa sổ thí nghiệm | script đánh giá | Dùng cắt dữ liệu theo mẻ |

Ba điểm tinh tế:
1. **Trạng thái lưu dạng `varchar`, không phải enum** — lịch sử sống sót qua các lần đổi
   tên trạng thái (đã đổi tên 2 lần: `IN_FLIGHT→PROCESSING→PICKING_UP`).
2. **Hai đồng hồ tách bạch** (migration `1792000001000`): `occurred_at` = giờ máy chủ WES
   (chuẩn để cắt cửa sổ), `observed_at` = giờ kernel (chỉ để chẩn đoán lệch đồng hồ).
   Nhầm hai cột này là một cái bẫy đã gặp.
3. **`sse_sessions` tồn tại chỉ để tính khoảng thời gian cho đúng** — metric trên
   `vehicle_state_transitions` phải dùng `LEAD()/LAG()` phân hoạch theo
   `(vehicle_name, session_id)` để một khoảng không bao giờ bắc qua một lần mất kết nối.
   Đây là mức độ nghiêm túc về đo đạc mà bài bảo vệ nên khoe.

### 4.3 KPI — tính sống, không chụp ảnh

`src/dashboard/dashboard.service.ts` + `src/dashboard/domain/kpi.ts`
Một endpoint duy nhất: `GET /dashboard/kpis?window=today|24h|7d` (mặc định `today`),
múi giờ `KPI_TIMEZONE` mặc định `Asia/Ho_Chi_Minh`. Năm truy vấn chạy `Promise.all`:

| KPI | Nguồn | Công thức / lưu ý |
|---|---|---|
| Đếm hoàn tất / thất bại / huỷ | `task_status_transitions` gom theo `to_status` | Đếm **lần chuyển**, không đếm lệnh |
| Thời gian vận chuyển TB | `transport_tasks` | `AVG(completed_at − started_at)`, `null` khi không có dòng |
| Thời gian chờ gán xe TB | `transport_tasks` | `AVG(assigned_at − created_at)` |
| Throughput theo khung giờ | `generate_series` LEFT JOIN transitions | Khung rỗng trả **0**, không mất khung |
| Ảnh chụp hàng đợi | `transport_tasks` sống | `CREATED, READY_TO_ASSIGN, BLOCKED, PICKING_UP, DELIVERING` |
| Ảnh chụp đội xe | `agvs` + **`VehicleStateStore` trong bộ nhớ** | online / executing / charging / idle / error / `kernelConnected` |

`failureRate = (failed + cancelled) / (completed + failed + cancelled)`, làm tròn 4 chữ số,
**`null` khi mẫu số = 0** (không phải 0 — không lệnh nào ≠ tỉ lệ hỏng 0%).

- **Vì sao đáng nói:** **không có bảng snapshot, không có cron gom số.** Mọi con số phản
  ánh nội dung bảng **tại thời điểm hỏi**. Đây là quyết định có chủ đích, viết thành luật
  ở `ARCHITECTURE.md` §7 ("đừng cache KPI trừ khi đo được nút thắt").
- **Cảnh báo trung thực:** `cancelled` bị tính là `failed`; và `VehicleStateStore`
  **không bao giờ xoá phần tử**, nên xe đã biến mất khỏi bản đồ vẫn được đếm.

### 4.4 Lịch sử theo từng xe — 4 đường đọc

`src/agvs/agv-history.service.ts` (admin-only, phân trang, đều khoá theo **tên xe**)

| Route | Bảng | Trả gì |
|---|---|---|
| `GET /agvs/:id/history` | `transport_requests ⋈ cargos` | **Sổ việc**: mã lệnh, điểm lấy, điểm trả, giờ bắt đầu/kết thúc, trạng thái |
| `GET /agvs/:id/state-log` | `vehicle_state_transitions` | Nhật ký telemetry thô |
| `GET /agvs/:id/errors` | `vehicle_error_events` | Lỗi của xe đó |
| `GET /agvs/error-frequency` | `vehicle_error_events` | **Bảng xếp hạng toàn đội** theo cửa sổ trượt 24h/7d/30d |

Ba cái bẫy đã được đóng, đáng để trong phụ lục Q&A:
- Chỉ đếm `RAISED` + `CHANGED`; **loại `CLEARED`** — nếu đếm cả, mọi xe biết phục hồi đều
  bị thổi phồng số lỗi.
- `withDeleted()` phải gọi **trước** khi join `cargos`, vì cargo là soft-delete và bị dọn
  thường xuyên (**641/646 dòng** trên một xe đã đo) ⇒ nếu không, điểm lấy và điểm trả
  **trắng gần hết** lịch sử.
- Route chữ `error-frequency` **phải khai báo trên** `@Get(':id')` — NestJS khớp theo thứ
  tự khai báo và `id` là cột uuid ⇒ đảo thứ tự biến truy vấn toàn đội thành lỗi 500.

### 4.5 Bộ dụng cụ đánh giá (không phải mã sản phẩm, nhưng rất đáng khoe)

`wes/scripts/` — `run-scenario.js`, `run-full.js`, `analyze.js`, `swap-report.js`,
`set-pin.js`, `trigger-fleet.js`, `trigger-lost-navigation.js`, `EVAL-RUNBOOK.md`,
và **11 kịch bản JSON** trong `scripts/scenarios/` (2 → 80 kiện, 2 → 5 khu vực, có kịch bản
so đồng hồ và kịch bản tải lệch nhịp).

- **Vì sao đáng nói:** nhóm không chỉ *xây* hệ thống, nhóm xây cả **bộ đo** cho nó, có
  runbook viết sẵn, có bảng `runs` để cắt dữ liệu theo mẻ. Đây là thứ tách một đồ án
  "chạy được" khỏi một đồ án **"chứng minh được"**.

---

## 5. Phân quyền & quản trị

### 5.1 Vai trò — đúng **hai**, mỗi người **một** vai

`src/users/entities/role.entity.ts`, `src/users/user.mapper.ts`, `src/auth/guards/roles.guard.ts`

Enum DB `user_role_enum` = `ADMIN | OPERATOR`; phía FE là `admin | operator` (chỉ đổi hoa/thường).
`UsersService.setRole` **xoá hết rồi ghi một dòng** ⇒ một người một vai. Không có vai → mặc
định `operator`.

**Trạng thái tài khoản là 3 cờ độc lập, không phải một enum:** `isLocked`, `isActive`,
`isInvited` → suy ra `active | locked | invited | inactive`. `isInvited = true` **chặn đăng
nhập** cho tới khi hoàn tất lời mời.

**Endpoint bị khoá vai `admin` — đúng 4 chỗ:**

| Controller | Phạm vi |
|---|---|
| `admin-users.controller.ts` | **toàn bộ** `/admin/users` |
| `agvs.controller.ts` | **toàn bộ** `/agvs` (gồm cả 4 route lịch sử) |
| `dispatch-policy.controller.ts` | **toàn bộ** `/dispatch-policies` |
| `maps.controller.ts` | **chỉ** `POST /maps/kernel-state` và `POST /maps/upload` |

**Còn lại chỉ yêu cầu đăng nhập, không chặn vai** — đáng chú ý: `POST /zones`,
`DELETE /zones/:id`, `POST /zones/sync`, `POST /zones/assign-map`, và
`POST /maps/kernel/transport-orders/:name/withdraw` **operator gọi được**.
`RolesGuard` **cho qua khi không có metadata `@Roles`** — tức mặc định là mở.
→ *Nếu hội đồng hỏi về phân quyền, đây là chỗ yếu nhất; nên chuẩn bị câu trả lời.*

### 5.2 Bảo mật — những thứ làm đúng

`src/auth/auth.service.ts`, `token.service.ts`, `strategies/jwt.strategy.ts`, `src/mail/mail.service.ts`

| Cơ chế | Chi tiết |
|---|---|
| Access token | JWT HS256, `JWT_ACCESS_TTL` (mặc định `1d`), payload `{sub, username, roles}` |
| Refresh token | `randomBytes(40)` hex, **lưu băm SHA-256**, TTL `REFRESH_TTL_DAYS` = 7 |
| **Xoay token một lần dùng** | mỗi `/auth/refresh` thu hồi dòng cũ, cấp dòng mới |
| Cookie | `wes_refresh`, `httpOnly`, `sameSite=lax`, `path=/api/auth` |
| Mật khẩu | bcrypt, cost 10 |
| Reset mật khẩu | **link**, không phải OTP; `randomBytes(32)`, **băm SHA-256**, TTL 30 phút, **một lần dùng** (`usedAt`) |
| **Chống dò tài khoản** | `forgotPassword()` **luôn** trả `{ok:true}` — email lạ, user bị khoá, user chưa kích hoạt đều trả như nhau; lỗi SMTP chỉ ghi log |
| Thu hồi phiên | reset mật khẩu → `revokeAllRefreshTokens()`; admin khoá/xoá → thu hồi token **và** đóng mọi phiên |
| Nhật ký phiên | mỗi lần đăng nhập ghi `user_sessions`: IP (kiểu `inet`), User-Agent, `login_at`; đăng xuất ghi `logout_at` |
| Tự phục vụ | `POST /account/sessions/revoke-others` — "đăng xuất khỏi mọi thiết bị khác" |

**Điểm yếu nên biết trước:** `jwt.strategy.validate()` **không tra DB** — vai trò / trạng
thái khoá chỉ có hiệu lực sau khi access token hết hạn (mặc định 1 ngày). `secure: false`
được viết cứng trên cookie. Không có phát hiện tái sử dụng refresh token (token family).
`randomToken()` dùng `Math.random()` khi sinh mật khẩu tạm. Admin **có thể tự khoá chính
mình** hoặc hạ vai admin cuối cùng.

### 5.3 Quản trị đội xe

`src/agvs/agvs.service.ts` — vòng đời WES-side: `isDispatchEnabled` × `isIgnored` →
`ENABLED | DISABLED | IGNORED`, mỗi thao tác có hệ quả xuống kernel:

| Thao tác | Hệ quả ở kernel |
|---|---|
| `ignore` | `integrationLevel = TO_BE_RESPECTED` ← **vẫn là vật cản** |
| `restore` | `TO_BE_UTILIZED` |
| `connect` | bật comm adapter + `TO_BE_UTILIZED` |
| `disconnect` | `TO_BE_IGNORED` + tắt adapter |

`POST /agvs/acceptance` là thao tác **theo lô**, trả kết quả **từng id**:
`changed | unchanged | failed` — một xe hỏng không làm hỏng cả lô.
Ngưỡng pin cấu hình **theo từng xe**: `criticalBatteryThreshold` (mặc định 20),
`sufficientBatteryThreshold` (mặc định 60).

### 5.4 Bản đồ & khu vực

| Việc | Cơ chế | Ghi chú |
|---|---|---|
| **Upload bản đồ = kích hoạt luôn** | `maps.service.ts upload()` → parse XML → `PUT /v1/plantModel` → **chỉ khi kernel nhận xong** mới ghi dòng `map_records` | **XML không lưu trong DB WES** — kernel là nơi lưu duy nhất. Migration `1782639025056` **xoá cột `is_active`**: WES cố ý không theo dõi bản đồ nào đang sống |
| Giới hạn upload | `FileInterceptor` 50 MB, **không kiểm mimetype/đuôi** | |
| Kernel đang OPERATING | 400/409 → 503 kèm hướng dẫn chuyển sang MODELLING | `save-plant-model.ts` |
| **Tạo/xoá khu vực = sửa bản đồ sống** | `opentcs/plant-model-locations.ts upsertMemberLocations` đọc model thô, tổng hợp location `Pick up`/`Drop off` tại toạ độ của point liên kết, PUT cả model về | **Tự dò "phương ngữ"** của kernel (`typeName` vs `type`, `links` mảng vs object) — vì payload kernel khác nhau giữa các bản |
| Đồng bộ khu vực (`POST /zones/sync`) | STALE là **một chiều** (sync không hồi sinh); một location chỉ thuộc **tối đa một** khu ACTIVE; khu thiếu point → STALE | `zone.service.ts:374–391` |
| Màu khu vực | Tự chọn **màu ít dùng nhất** trong bảng 20 màu | Chi tiết nhỏ nhưng thể hiện chăm chút UX |
| Phát hiện hành lang & sinh block tự động | `opentcs/domain/corridor-detector.ts` + `apply-blocks.ts` | **HIỆN ĐANG TẮT** — lời gọi bị comment ở `maps.service.ts:214–219` và `map-loader.service.ts:54–59`. Thuật toán có, có test, nhưng **không chạy**. ⚠ Đừng lên slide như tính năng đang bật |

`corridor-detector.ts` (nếu bật) làm gì: dựng đồ thị **vô hướng** từ path (bỏ path khoá và
tự-vòng), đi dọc các chuỗi đỉnh bậc 2 giữa hai đỉnh biên, khử trùng theo tập cạnh, quét
thêm các vòng toàn-bậc-2. Chỉ sinh block `SINGLE_VEHICLE_ONLY` cho **làn cụt** (có đầu bậc 1);
hành lang xuyên qua và vòng để cho scheduler của kernel tự lo.

---

## 6. Độ lệch tài liệu ↔ mã nguồn

> Đọc mục này **trước khi lên slide**. Mỗi dòng là một câu hỏi phản biện có thể tới.

| # | Tài liệu nói | Mã nguồn thực tế | Mức độ |
|---|---|---|---|
| 1 | `ARCHITECTURE.md` §7: realtime dùng **`@WebSocketGateway`** | **Không có gateway nào.** Realtime = `@Sse('kernel/sse')` ở `maps.controller.ts:79` | Trung bình — sửa tài liệu |
| 2 | `ARCHITECTURE.md` §8 + SRS #18 + OR-05: bảng **`event_log`/`audit_logs`** ghi mọi thao tác Admin, **cùng transaction** | **Không tồn tại trong `src/`.** Chỉ có `task_status_transitions` (lệnh vận chuyển) và `vehicle_error_events`. Ghi audit **ngoài** transaction và **nuốt lỗi** (`transport-task.service.ts:105`) | **Cao** — SRS §4.2.4 hứa "audit completeness" |
| 3 | Slide V.3 + BR-03: xe được thả khỏi trạm khi **"đủ pin VÀ có nhu cầu"** | `shouldRelease()` chỉ kiểm `energyLevel >= CHARGE_FULL_PCT` (mặc định **85%**). `sufficientThreshold` được nạp vào ứng viên nhưng **không hàm nào đọc** | **Cao** — slide đang mô tả thứ chưa có |
| 4 | `ARCHITECTURE.md` §4.3: `PICKING_UP` chỉ đi tới DELIVERING/CANCELLED/FAILED | Mã còn cho `PICKING_UP → READY_TO_ASSIGN` (swap) và `→ BLOCKED` (lane-safety) | Thấp — mã **đúng hơn** tài liệu |
| 5 | `ARCHITECTURE.md` nhắc `row-dependency.policy.ts` | Tên thật là `pickup-dependency.policy.ts` | Thấp |
| 5b | `ARCHITECTURE.md:443`: lệnh BLOCKED được xét lại qua `@OnEvent('transport-task.completed')` | **Không có handler nào như vậy.** Việc xét lại xảy ra vì `DispatchScheduler` nghe `status-changed` | Thấp |
| 5c | `ARCHITECTURE.md:491`: đỗ xe bị chặn bởi `CREATED` + `READY_TO_ASSIGN` + `BLOCKED` | `parking-engine.service.ts:28` chỉ liệt kê **`READY_TO_ASSIGN`** | Trung bình — hành vi thật hẹp hơn tài liệu |
| 5d | `ARCHITECTURE.md:242`: chặng suy ra từ tiền tố tên `TO1-`/`TO2-`/`TO3-` | Thực tế dùng property **`wes:leg`**; tiền tố tên là `PICKUP-`/`APPROACH-`/`DROPOFF-` | Thấp |
| 5e | `dispatch_policies.max_agv_per_block` được lưu và trả qua API | **Không engine nào đọc** | Thấp |
| 6 | SRS #32: sinh block hành lang tự động khi nạp bản đồ | Lời gọi **bị comment**, không có caller nào | **Cao** nếu đưa lên slide |
| 7 | SRS #10: đồng bộ telemetry **polling 2 giây** | Thực tế là **SSE đẩy** + nhịp tim đối chiếu 5 giây | Trung bình |
| 8 | SRS §4.2.4: withdraw hỏng → **retry backoff tối đa 3 lần** | Không có retry đếm lần ở đâu. Thay bằng "bỏ bước, flush sau tự thử lại" | Trung bình — cách làm khác, không tệ hơn |
| 9 | `database/schema.sql` có 32 bảng (`audit_logs`, `event_logs`, `kpi_snapshots`, `blocks`, `points`, `paths`, `operation_maps`, `agv_live_status`…) | Chỉ **18 bảng** có entity thật (SDS §1.3 xác nhận 18). `schema.sql` là **baseline cũ**, phần lớn là bảng chết | Trung bình — dễ bị bắt nếu chiếu ERD sai |
| 10 | Ba trọng số điều phối `weight_proximity`, `weight_inventory_position`, `weight_urgency` | **Đã bị drop khỏi schema** (migration `1796…`, `1797…`). Chỉ còn `weight_battery` | Trung bình |
| 11 | SRS §4.1 External Interfaces | **Bảng rỗng** — openTCS REST/SSE và VDA5050 MQTT chưa được đặc tả | Trung bình |
| 12 | `report/park-claims-findings.md` (được `ARCHITECTURE.md` §6.4 dẫn) | **Không có trên đĩa** | Thấp |
| 13 | `report/srs-1.4.3-non-ui-functions.md` (được `CLAUDE.md` dẫn làm ví dụ mẫu) | **Không có trên đĩa** | Thấp |
| 14 | `vehicle_error_events.kind` khai 5 giá trị | `RECOVERY_ATTEMPTED` / `RECOVERY_REFUSED` **không producer nào ghi** | Thấp |
| 15 | `CLAUDE.md`: "không hard-delete entity nghiệp vụ" | `AgvsService.remove()` dùng `repo.remove()` — **xoá cứng**. Soft-delete chỉ có ở `cargos` và `zones` | Thấp |
| 16 | OR-09: bộ đệm an toàn k-robustness | `kRobust` **cố định = 0** ở cả hai chỗ gọi ⇒ **không có bộ đệm nào được áp** | Trung bình (tầng kernel) |

---

## 7. Xếp hạng "đáng lên slide"

Xếp theo **mức gây ấn tượng với hội đồng phản biện**, không theo mức quan trọng kỹ thuật.
Cột cuối: đã có trong `slide/content.md` chưa.

| # | Thứ | Vì sao gây ấn tượng | Đã có? |
|---|---|---|---|
| 1 | **Hệ thống giải thích được quyết định của chính nó** — mỗi vòng giải bài toán ghép **2 lần**, thi hành 1, ghi lại cái kia; và phơi ra ở `GET /cargo/:id/decision` | Trả lời trực diện *"chứng minh Hungarian hơn greedy đi"* bằng **so cặp trên cùng ma trận, cùng khoảnh khắc** — không cần dựng A/B. Và người vận hành **bấm được nút để hỏi**. Rất hiếm ở đồ án | ❌ chưa |
| 2 | **`LaneSafetyService`** — đọc `allocatedResources` của kernel để quyết định **từ chối** hay **gọi xe về** | Ra quyết định dựa trên trạng thái **cấp phát tài nguyên của tầng dưới**; và biết **khi nào đã quá muộn để gọi về**, có lý do kỹ thuật chính xác (`immediate=false` không xoá hàng lệnh). Kèm nguyên tắc *"thứ tự là thuộc tính an toàn, không phải giao dịch"* | ⚠ mới có nửa (BR-10) |
| 3 | **Sổ giữ chỗ + "fail closed"** — sổ rỗng ≠ không ai giữ chỗ; chưa dựng lại xong thì **cấm phát lệnh** | Một nguyên tắc thiết kế phát biểu được thành **một câu**, kèm **số đo trước/sau: ~19 → ~0,21 lệnh đỗ / kiện** | ⚠ có ở VIII.3, chưa nêu tên nguyên tắc |
| 4 | **Phục hồi mất định vị theo từng chặng** — lấy hàng thì giao lại xe khác; vào làn thì phát lại; **đã hạ hàng rồi thì chỉ phát lại đoạn lùi** | Kể được thành một câu chuyện: *"thử lại" là câu trả lời sai — thử lại một chặng đã hạ hàng sẽ hạ hàng lần hai.* Dấu `unloadedAt` + trần 3 lần là hai chi tiết rất cụ thể | ❌ chưa |
| 5 | **Level-triggered reconcile** — "tính đúng đắn không bao giờ phụ thuộc vào một sự kiện" | Phân biệt edge- vs level-triggered là dấu hiệu tư duy hệ phân tán trưởng thành. Có **hai** backstop, mỗi cái cho một luồng, và ba chốt idempotent làm cho việc phát lại an toàn | ❌ chưa |
| 6 | **Late binding ô trả + luật thác nước + khoá advisory theo khu vực** | Giải thích được *vì sao* không thể chốt sớm; giải bằng **khoá cấp CSDL tự dọn dẹp**, không thêm hạ tầng; và luật thác nước **tự sinh ra** bất biến "ô lùi luôn trống" | ⚠ có ở V.2, thiếu khoá + thác nước |
| 7 | **Bốn bảng chỉ-ghi-thêm + hai đồng hồ + `sse_sessions`** | "Chúng tôi xây cả bộ đo cho hệ của mình" — có bảng `runs`, có runbook, có 11 kịch bản. Tách "chạy được" khỏi **"chứng minh được"** | ❌ chưa |
| 8 | **Tên lệnh mang theo đích đến** `<LOẠI>-<xe>-<đích>-<uuid>` | Mẹo thiết kế đẹp: **không cần bảng tra cứu, không cần dựng lại sau restart** — trạng thái đi kèm trong cái tên mà kernel đã lưu hộ | ❌ chưa |
| 9 | **Ba mức chi phí trong ma trận** (thật < không-biết < không-tới-được), có hệ số theo cỡ lô | Cho thấy nhóm hiểu bộ giải **chỉ tối thiểu tổng**, nên phải nhét thứ bậc ưu tiên vào chính con số. Kèm lý do bắt buộc: Hungarian **từ chối `Infinity`** | ⚠ VI có nhắc, chưa nói phần thang bậc |
| 10 | **Thu hồi cả hai tên lệnh** + **trần chống đói 3,5s** + **cách li xe lỗi** + **xe IGNORED vẫn là vật cản** | Bốn chi tiết nhỏ, mỗi cái một dòng, đều là lỗi kinh điển đã được nghĩ tới và vá. Rất hợp làm **slide phụ lục Q&A** | ❌ chưa (trừ IGNORED đã ghi để dành) |

**Bốn thứ KHÔNG nên lên slide (rủi ro cao hơn lợi ích):**
- Sinh block hành lang tự động — **mã bị comment**, không chạy (§5.4).
- "Đủ pin **và** có nhu cầu" mới rời trạm — **chưa cài** (§6 dòng 3); slide V.3 hiện đang mô tả sai.
- Bảng `audit_logs` cho thao tác Admin — **không tồn tại** (§6 dòng 2). Thay bằng
  `task_status_transitions`, và nói đúng phạm vi của nó (**chỉ** vòng đời lệnh vận chuyển).
- "Không né vào ô có cargo" như một luật của WES — **nó là luật của kernel** (§2.1). Nói
  đúng thì nó mạnh hơn: *chỉ WES biết ô nào có hàng, nên chỉ WES cưỡng chế được các luật hàng.*

**Ba câu hỏi phản biện dễ tới nhất, và chỗ tìm câu trả lời:**

| Câu hỏi | Trả lời ở |
|---|---|
| *"Sao biết Hungarian tốt hơn?"* | §1.3 — phản-thực-tế ghi trên **mọi** lần chạy thật, so cặp |
| *"Mất kết nối / mất sự kiện thì sao?"* | §1.8 + §3.2 — hai backstop level-triggered + phục hồi mất định vị theo chặng |
| *"Hai người quét hàng cùng lúc thì sao?"* | §2.3 — advisory lock theo khu vực ở cả hai điểm ghi, có đọc lại trong khoá |

---

## Phụ lục A — 33 hàm phi giao diện (SRS §II.1.4.3) đối chiếu với mã nguồn

Nguồn: `report/specs/report3-srs.md` **dòng 305–343**. Bảng gốc đánh số 1→12, 14→18, 20→37
(**thiếu số 13 và 19**) = **33 mục**. Cột cuối là kết quả đối chiếu của khảo sát này.

| # | Tên trong SRS | Ở đâu | Xác minh |
|---|---|---|---|
| 1 | Scanner Cargo Ingestion API | `cargo.controller.ts` `POST /cargo` → `CargoService.create` | ✅ |
| 2 | Pickup Location Resolver & Source Validation | `cargo.service.ts:136–186` | ✅ |
| 3 | Drop-off Point Calculator (BR-11) | `delivery-slot.engine.ts` | ✅ §1.5 |
| 4 | Cargo Debounce Timer (OR-07) | `dispatch-scheduler.service.ts:11` `DEBOUNCE_MS` | ✅ §1.0 |
| 5 | Conflict Check Engine | Thực tế là `ReleaseEngine` + `PickupDependency` | ✅ (tên khác) |
| 6 | Transport Order Creator | `pickup-order.service.ts`, `transport-task.saga.ts` | ✅ |
| 7 | FMS Withdrawal Caller | `kernel-api.service.ts withdrawTransportOrder` | ✅ |
| 8 | Task Release Engine | `release-engine.service.ts` | ✅ §1.1 |
| 9 | Task Assignment Engine (Hungarian) | `assignment-engine.service.ts` + `domain/hungarian.ts` | ✅ §1.2 |
| 10 | AGV Telemetry Sync | `kernel-event-listener.service.ts` | ⚠ **SSE đẩy**, không phải polling 2s như SRS mô tả |
| 11 | Map Auto-Load to FMS | `map-loader/map-loader.service.ts`, `OPENTCS_MAP_AUTO_LOAD` (mặc định false) | ✅ |
| 12 | Map Activation Push | `maps.service.ts upload()` → `putRawPlantModel` | ✅ (upload **là** activate) |
| 14 | SSE Push Service | `maps.controller.ts:79 @Sse('kernel/sse')` | ⚠ chỉ đẩy **trạng thái xe**, không đẩy trạng thái lệnh |
| 15 | Email Delivery Service | `mail/mail.service.ts` | ⚠ chỉ **một** loại mail (reset/kích hoạt); không có TTL 48h riêng cho lời mời |
| 16 | Refresh Token Cleanup | `token.service.ts purgeExpired()` | ❌ **hàm có nhưng KHÔNG được lên lịch chạy** |
| 17 | FMS Kernel Health Check | `kernel-sync.service.ts` — 30 lần × 2s = 60s | ✅ |
| 18 | Audit Log Writer (`audit_logs`) | — | ❌ **KHÔNG TỒN TẠI.** Chỉ có `task_status_transitions` (§6 dòng 2) |
| 20 | Charge Engine | `charge-engine.service.ts` | ⚠ điều kiện thả khác SRS (§6 dòng 3) |
| 21 | Parking Engine | `parking-engine.service.ts` + `park-claim.store.ts` | ⚠ cổng đội xe hẹp hơn tài liệu (§6 dòng 5c) |
| 22 | Fleet MAPF Router (LaCAM\*) | **kernel Java** | ⛔ ngoài phạm vi |
| 23 | Per-Visit Precedence & Acyclicity Gate | **kernel Java** | ⛔ ngoài phạm vi |
| 24 | PIBT Step Generator & Anti-Starvation | **kernel Java** — chứa `fms.mapf.cargoSlotSurcharge` (§2.1) | ⛔ ngoài phạm vi |
| 25 | Lane Safety Guard & Pickup Preemption | `lane-safety.service.ts` | ✅ §2.2 — khớp SRS rất sát |
| 26 | Dispatch Counterfactual Recorder | `domain/dispatch-counterfactual.ts` | ✅ §1.3 |
| 27 | Fleet Re-Solve Pacing & Plan Retention | **kernel Java** | ⛔ ngoài phạm vi |
| 28 | openTCS Event Stream Consumer (SSE) | `kernel-event-listener.service.ts` | ✅ §4.1 |
| 29 | Transport Task Saga | `transport-task.saga.ts` | ✅ §1.4 |
| 30 | Leg Reconciliation Backstop | `leg-reconcile.service.ts` | ✅ §1.8 |
| 31 | Approach Point Selector | `approach-point.service.ts` | ✅ |
| 32 | Corridor Detection & Auto Block Generation | `opentcs/domain/corridor-detector.ts` | ❌ **mã có, test có, nhưng lời gọi BỊ COMMENT** (§5.4) |
| 33 | Pickup Swap | `pickup-order.service.ts revoke()` + `domain/dispatch-swap.ts` | ✅ (mặc định **TẮT**) |
| 34 | Goal Claim and Resolution | **kernel Java** | ⛔ ngoài phạm vi |
| 35 | Plant Model → MAPF Roadmap Adapter | **kernel Java** | ⛔ ngoài phạm vi |
| 36 | Reroute Drive-Order Merger | **kernel Java** | ⛔ ngoài phạm vi |
| 37 | openTCS Component Replacement (Guice) | **kernel Java** | ⛔ ngoài phạm vi |

**Tổng kết:** 33 hàm → **8 thuộc kernel Java** (22, 23, 24, 27, 34, 35, 36, 37) ·
**22 xác minh có trong `wes/src`** (11 trong số đó có sai lệch mô tả nhỏ) ·
**3 KHÔNG có thật** trong `wes/src`: #16 (dọn refresh token — có hàm, không có lịch chạy),
#18 (`audit_logs`), #32 (sinh block hành lang — bị comment).

**Nhóm theo tính năng, dùng làm slide "phạm vi hệ thống":**
Transport Request & Cargo **10** (1–7, 25, 28–30) · Multi-Agent Traffic Coordination **8**
(22–24, 27, 34–37) · Dispatch Orchestration **4** (8, 9, 26, 33) · Warehouse Map & Topology
**4** (11, 12, 31, 32) · AGV Fleet Management **3** (10, 20, 21) · System **2** (17, 18) ·
User & Access **2** (15, 16) · Monitoring **1** (14).

> Lưu ý: `report/srs-1.4.3-non-ui-functions.md` mà `wes/CLAUDE.md` dẫn làm "ví dụ mẫu"
> **không có trên đĩa** — bản duy nhất của nội dung này là mục §II.1.4.3 trong bản mirror SRS.

---

## Phụ lục B — 15 Business Rule (SRS §5.1) và nơi cưỡng chế

| BR | Nội dung (rút gọn) | Cưỡng chế ở |
|---|---|---|
| BR-01 | `critical < sufficient` | `agvs.dto.ts` validate |
| BR-02 | Ứng viên phải `battery > critical` | `domain/dispatch.policy.ts:31` `isEligible` |
| BR-03 | Vòng đời sạc & điều kiện thả | `charge-engine.service.ts` ⚠ **chỉ cài một phần** (§6 dòng 3) |
| BR-04 | Một lệnh ↔ tối đa một xe | `metadata.assignedVehicleName` + máy trạng thái |
| BR-05 | Một xe ↔ tối đa một lệnh đang chạy | `task-queries.ts activeCargoVehicleNames` + `hasActiveTask` |
| BR-06 | IGNORED bị loại khỏi điều phối **nhưng vẫn là vật cản** | `agvs.service.ts` → `TO_BE_RESPECTED` (§2.5) |
| BR-07 | Nguồn phải PICKUP point, đích phải DROPOFF location, fail-fast | `cargo.service.ts:136–186` |
| BR-08 | Chỉ xoá cargo trước khi `DELIVERING` | `cargo.service.ts:336–369` — thực tế **chặt hơn**: chặn theo `allocatedResources` thật |
| BR-09 | Không huỷ từ `DELIVERY_COMPLETED`/`CANCELLED` | `TransportTaskStateMachine` — trạng thái cuối không có lối ra |
| BR-10 | Lấy hàng: ngoài trước, trong sau | `domain/pickup-dependency.policy.ts` |
| BR-11 | Trả hàng: lấp từ sâu ra, theo thác nước | `delivery-slot.engine.ts:117–145` |
| BR-12 | Không sửa/xoá khu vực khi còn hàng tham chiếu | `zone.service.ts` |
| BR-13 | Sạc ở trạm gần nhất còn chỗ, có giữ chỗ | `domain/charge.policy.ts pickChargeLocation` + `chargeTargets` |
| BR-14 | Sạc ưu tiên hơn đỗ | Thứ tự chặng 5 trước chặng 6 trong flush (§1.0) |
| BR-15 | Chỗ đỗ không lấn vào điểm sạc | `parking-engine.service.ts:130 parkPool()` |
