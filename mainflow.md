# Main Workflows (Business Processes)

Tài liệu này mô tả các luồng nghiệp vụ chính (main business processes) của hệ thống WES (Warehouse Execution System) điều phối AGV, được trình bày dưới dạng **swim-lane diagram**. Mỗi workflow gồm: mục tiêu nghiệp vụ, các lane (actor/hệ thống tham gia), điều kiện kích hoạt, sơ đồ swim-lane, mô tả theo từng lane, bảng các bước, luồng ngoại lệ và hậu điều kiện.

## Quy ước chung

**Các lane (actor / hệ thống) xuất hiện trong các sơ đồ:**

- `Operator`: người vận hành tại hiện trường, quét mã và theo dõi vận hành cơ bản.
- `Admin`: người quản trị, cấu hình hệ thống và giám sát điều phối.
- `Barcode Scanner / Handheld App`: thiết bị hoặc client bên ngoài WES dùng để quét QR sàn và barcode kiện hàng. Nếu chỉ là thiết bị nhập liệu, nó hoạt động dưới thao tác của `Operator`; nếu có app/client gọi API sang WES, nó được xem là external input client.
- `WES`: lớp quản lý và điều phối nghiệp vụ (hệ thống đang xây dựng).
- `FMS (openTCS)`: tầng thực thi đội xe (dispatch, routing, execution).
- `AGV`: xe tự hành thực hiện di chuyển và thao tác nghiệp vụ.

**Ký hiệu sơ đồ:** Sơ đồ dùng cú pháp Mermaid `flowchart LR` (flow chạy từ trái sang phải). Mỗi `subgraph` là một lane (làn bơi) được bố trí thành một cột dọc nhờ `direction TB`. Các node là bước xử lý bên trong lane, mũi tên đi ngang giữa các lane thể hiện việc bàn giao trách nhiệm (handoff). Mỗi workflow kèm một bảng các bước với cột `Lane` để truy vết ai/hệ thống nào chịu trách nhiệm từng bước.

---

## WF-01 — Vòng đời yêu cầu vận chuyển (End-to-End Pickup & Delivery)

**Mục tiêu nghiệp vụ:** Đưa một kiện hàng từ điểm lấy hàng đến đúng location trả hàng, từ thao tác quét mã tại hiện trường cho đến khi AGV hoàn tất nhiệm vụ.

**Điều kiện kích hoạt:** Operator sử dụng `Barcode Scanner / Handheld App` hoặc API caller gửi yêu cầu gồm vị trí hiện tại của hàng và `location đích`; tại hiện trường, dữ liệu này thường phát sinh từ thao tác quét QR sàn, quét barcode kiện hàng và chọn hoặc resolve `location đích` từ đơn/hệ thống bên ngoài.

**Tiền điều kiện:** Bản đồ vận hành và location đã được cấu hình; có ít nhất một AGV đủ điều kiện tham gia điều phối.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph OP[Operator]
    direction TB
    A1[Quét QR sàn xác định vị trí hàng] --> A2[Quét barcode trên kiện hàng]
    A2 --> A3["Xác định location đích (barcode/order hoặc chọn thủ công)"]
    A3 --> A4[Gửi yêu cầu vận chuyển qua API]
  end
  subgraph WES[WES]
    direction TB
    B1[Tiếp nhận request: vị trí hàng + location đích] --> B2{Dữ liệu hợp lệ?}
    B2 -- Không --> R1[Ghi nhận yêu cầu không hợp lệ → WF-03]
    B2 -- Có --> B3["Tạo & gán mã yêu cầu vận chuyển"]
    B3 --> B4[Xác định điểm lấy hàng hợp lệ]
    B4 --> B5[Chọn điểm trả hàng theo rule không gian]
    B5 --> B6[Đưa vào hàng đợi điều phối]
    B6 --> B7[Gửi yêu cầu đã chuẩn bị sang FMS]
    B8["Cập nhật trạng thái & lưu mốc thời gian"]
  end
  subgraph FMS["FMS (openTCS)"]
    direction TB
    C1[Nhận yêu cầu thực thi] --> C2[Dispatch: chọn AGV phù hợp]
    C2 --> C3[Routing: tính tuyến đường]
    C3 --> C4[Gửi lệnh điều khiển cho AGV]
    C5[Đồng bộ trạng thái về WES]
  end
  subgraph AGV[AGV]
    direction TB
    D1[Di chuyển đến điểm lấy hàng] --> D2[Thực hiện lấy hàng]
    D2 --> D3[Di chuyển đến điểm trả hàng]
    D3 --> D4[Thực hiện trả hàng]
    D4 --> D5[Báo hoàn tất nhiệm vụ]
  end

  A4 --> B1
  B7 --> C1
  C4 --> D1
  D5 --> C5
  C5 --> B8
```

**Mô tả theo từng lane:**

- **Operator:** Sử dụng `Barcode Scanner / Handheld App` để quét QR dưới sàn nhằm xác định vị trí hiện tại của kiện hàng, quét barcode trên hàng, và xác định `location đích` (resolve từ barcode/đơn hàng, chọn thủ công, hoặc do hệ thống/API caller bên ngoài cung cấp). Gửi hai input tối thiểu (vị trí hàng + location đích) qua API. **Handoff → WES.**
- **WES:** Tiếp nhận request, kiểm tra hợp lệ nghiệp vụ. Nếu không hợp lệ → chuyển WF-03. Nếu hợp lệ → tạo & gán mã, xác định điểm lấy hợp lệ, chọn điểm trả theo rule không gian, đưa vào hàng đợi điều phối. **Handoff → FMS.** Cuối luồng, nhận đồng bộ ngược từ FMS để cập nhật vòng đời và mốc thời gian.
- **FMS (openTCS):** Nhận yêu cầu đã chuẩn bị, dispatch chọn AGV, tính routing, gửi lệnh điều khiển. **Handoff → AGV.** Khi có cập nhật, đồng bộ trạng thái ngược về WES.
- **AGV:** Di chuyển đến điểm lấy, lấy hàng, di chuyển đến điểm trả, trả hàng, báo hoàn tất. **Handoff → FMS** (báo kết quả thực thi).

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Operator | Dùng Barcode Scanner / Handheld App quét QR sàn, quét barcode, xác định location đích | Hai input: vị trí hàng + location đích |
| 2 | Operator / Handheld App → WES | Gửi yêu cầu vận chuyển qua API | WES tiếp nhận request |
| 3 | WES | Kiểm tra hợp lệ nghiệp vụ | Hợp lệ → tiếp; không → WF-03 |
| 4 | WES | Tạo & gán mã, xác định điểm lấy, chọn điểm trả | Yêu cầu sẵn sàng điều phối |
| 5 | WES → FMS | Đưa vào hàng đợi & gửi yêu cầu đã chuẩn bị | FMS nhận yêu cầu thực thi |
| 6 | FMS → AGV | Dispatch chọn AGV, routing, gửi lệnh | AGV nhận nhiệm vụ |
| 7 | AGV | Lấy hàng → di chuyển → trả hàng → báo hoàn tất | Hàng ở location đích |
| 8 | FMS → WES | Đồng bộ trạng thái ngược | Cập nhật vòng đời & mốc thời gian |

**Luồng ngoại lệ:**

- Dữ liệu đầu vào không hợp lệ hoặc không có điểm lấy/trả hợp lệ → chuyển WF-03.
- Yêu cầu bị giữ lại quá lâu trong hàng đợi điều phối → xử lý trong WF-02.
- Operator hoặc Admin hủy/dừng yêu cầu ở trạng thái cho phép → xử lý theo WF-09.

**Hậu điều kiện:** Kiện hàng đã ở location đích; yêu cầu vận chuyển ở trạng thái `Completed` cùng đầy đủ mốc thời gian.

---

## WF-02 — Điều phối & xử lý thứ tự lấy hàng (Dispatch Orchestration)

**Mục tiêu nghiệp vụ:** Sắp xếp thứ tự thực hiện yêu cầu sao cho khả thi về mặt vật lý, tránh out-of-order pickup và giảm nhu cầu switch order, đồng thời hạn chế ùn tắc/deadlock.

**Điều kiện kích hoạt:** Có yêu cầu vận chuyển mới được đẩy vào hàng đợi điều phối của WES.

**Tiền điều kiện:** Đã cấu hình chính sách điều phối; topology, block và rule không gian đã sẵn sàng.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph AD[Admin]
    direction TB
    G1["Cấu hình & cập nhật chính sách điều phối"]
    G2["Xem hàng đợi, yêu cầu bị chặn & lý do"]
    G3[Theo dõi cảnh báo ùn tắc / deadlock]
  end
  subgraph WES["WES - Orchestration"]
    direction TB
    O1[Nhận yêu cầu trong hàng đợi điều phối] --> O2[Xác định quan hệ phụ thuộc giữa các hàng]
    O2 --> O3{Hàng phía ngoài đã được lấy?}
    O3 -- Chưa --> O4[Giữ lại yêu cầu - blocked, ghi lý do]
    O4 --> O10["Chờ sự kiện tái đánh giá: hoàn tất / giải phóng resource / timeout / Admin can thiệp"]
    O10 --> O2
    O3 -- Rồi --> O5[Kiểm tra topology, block, hướng tiếp cận, năng lực khu vực]
    O5 --> O6{"Khả thi & không over-assignment?"}
    O6 -- Không --> O7[Điều tiết: trì hoãn / xếp lại thứ tự]
    O7 --> O10
    O6 -- Có --> O8[Đẩy yêu cầu khả thi xuống FMS]
    O9[Giám sát hotspot / nguy cơ deadlock]
  end
  subgraph FMS["FMS (openTCS)"]
    direction TB
    F1["Dispatch & routing thực thi"] --> F2[Phản hồi trạng thái route / congestion]
  end

  G1 --> O1
  O8 --> F1
  F2 --> O9
  O9 --> G3
  O9 --> O10
  O4 --> G2
```

**Mô tả theo từng lane:**

- **Admin:** Cấu hình và cập nhật chính sách điều phối (đầu vào chi phối hành vi sắp xếp của WES); theo dõi hàng đợi, các yêu cầu bị chặn kèm lý do, và các cảnh báo ùn tắc/deadlock. **Handoff → WES.**
- **WES (Orchestration):** Với mỗi yêu cầu, xác định quan hệ phụ thuộc vật lý giữa các hàng trong cùng khu lấy. Vì AGV không đi xuyên qua hàng, nếu hàng phía ngoài chưa được lấy thì yêu cầu lấy hàng phía trong bị giữ (blocked) kèm lý do và chờ sự kiện tái đánh giá (hàng phía ngoài hoàn tất, point/location được giải phóng, FMS phản hồi route mới, quá timeout, hoặc Admin can thiệp). Khi khả thi, kiểm tra topology/block/hướng tiếp cận/năng lực khu vực để tránh over-assignment; nếu chưa đạt thì điều tiết (trì hoãn/xếp lại). Chỉ yêu cầu khả thi mới đẩy xuống FMS. **Handoff → FMS.**
- **FMS (openTCS):** Thực hiện dispatch/routing và phản hồi trạng thái route/congestion. **Handoff → WES** (để giám sát hotspot/deadlock).

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Admin → WES | Cấu hình/cập nhật chính sách điều phối | Input chi phối hành vi WES |
| 2 | WES | Nhận yêu cầu, xác định quan hệ phụ thuộc vật lý | Biết hàng nào lấy được trước |
| 3 | WES | Kiểm tra hàng phía ngoài đã lấy chưa | Chưa → giữ blocked + lý do |
| 4 | WES | Chờ sự kiện tái đánh giá (hoàn tất/giải phóng/timeout/Admin) | Quay lại đánh giá khi có sự kiện |
| 5 | WES | Kiểm tra topology, block, hướng tiếp cận, năng lực khu vực | Khả thi → tiếp; không → điều tiết |
| 6 | WES → FMS | Đẩy yêu cầu khả thi xuống thực thi | FMS dispatch/routing |
| 7 | FMS → WES | Phản hồi route/congestion | WES giám sát hotspot/deadlock và tái đánh giá khi cần |
| 8 | WES → Admin | Hiển thị queue, yêu cầu bị chặn, cảnh báo | Admin theo dõi & can thiệp |

**Luồng ngoại lệ:**

- Yêu cầu bị giữ quá ngưỡng thời gian → nâng cảnh báo cho Admin.
- FMS báo route không khả thi/congestion → WES phối hợp điều tiết lại luồng và đưa yêu cầu quay lại bước tái đánh giá.

**Hậu điều kiện:** Yêu cầu được thực thi theo thứ tự khả thi vật lý, giảm thiểu out-of-order pickup và switch order.

---

## WF-03 — Xử lý yêu cầu không hợp lệ / không thể xử lý

**Mục tiêu nghiệp vụ:** Đảm bảo mọi yêu cầu lỗi đều được ghi nhận minh bạch với lý do rõ ràng để Operator/Admin truy vết và xử lý.

**Điều kiện kích hoạt:** Một yêu cầu vận chuyển thất bại ở bước kiểm tra hợp lệ hoặc không tìm được điểm lấy/trả hợp lệ.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph WES[WES]
    direction TB
    V1[Phát hiện request không hợp lệ] --> V2[Phân loại nguyên nhân: dữ liệu / không có điểm lấy-trả / vi phạm rule]
    V2 --> V3[Đánh dấu trạng thái Invalid và lưu lý do]
    V3 --> V4[Đưa vào danh sách yêu cầu không hợp lệ]
  end
  subgraph USER["Operator / Admin"]
    direction TB
    U1[Xem danh sách yêu cầu không hợp lệ] --> U2[Xem chi tiết nguyên nhân]
    U2 --> U3{Có thể khắc phục?}
    U3 -- Có --> U4[Sửa dữ liệu & tạo lại yêu cầu → WF-01]
    U3 -- Không --> U5[Bỏ qua / đóng yêu cầu]
  end

  V4 --> U1
```

**Mô tả theo từng lane:**

- **WES:** Khi phát hiện request không hợp lệ, phân loại nguyên nhân (dữ liệu sai, không có điểm lấy/trả hợp lệ, vi phạm rule không gian), đánh dấu trạng thái `Invalid` kèm lý do và đưa vào danh sách yêu cầu không hợp lệ. **Handoff → Operator/Admin.**
- **Operator/Admin:** Xem danh sách và chi tiết nguyên nhân. Nếu khắc phục được → sửa dữ liệu và tạo lại yêu cầu (quay về WF-01); nếu không → đóng yêu cầu.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | WES | Phát hiện & phân loại nguyên nhân không hợp lệ | Xác định loại lỗi |
| 2 | WES | Đánh dấu `Invalid` + lưu lý do, đưa vào danh sách | Yêu cầu lỗi được lưu vết |
| 3 | WES → Operator/Admin | Hiển thị danh sách & chi tiết nguyên nhân | Người dùng nắm lý do |
| 4 | Operator/Admin | Quyết định: khắc phục hay đóng | Khắc phục → WF-01; không → đóng |

**Hậu điều kiện:** Yêu cầu lỗi được lưu vết với lý do; có thể tái xử lý hoặc đóng.

---

## WF-04 — Quản lý pin & sạc AGV (Fleet Battery Management)

**Mục tiêu nghiệp vụ:** Đảm bảo AGV duy trì đủ pin để tham gia điều phối, tự động loại xe pin thấp khỏi nhận lệnh và đưa đi sạc.

**Điều kiện kích hoạt:** Mức pin AGV cập nhật theo thời gian thực vượt qua các ngưỡng đã cấu hình.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph AD[Admin]
    direction TB
    P1["Cấu hình ngưỡng pin vận hành & ngưỡng sạc"]
  end
  subgraph WES[WES]
    direction TB
    Q1["Theo dõi mức pin & trạng thái AGV realtime"] --> Q2{Pin dưới ngưỡng vận hành?}
    Q2 -- Không --> Q1
    Q2 -- Có --> Q3[Loại AGV khỏi danh sách nhận lệnh mới]
    Q3 --> Q4{AGV đang thực hiện nhiệm vụ?}
    Q4 -- Có --> Q5[Chờ hoàn tất nhiệm vụ / điểm dừng an toàn]
    Q5 --> Q6[Lập yêu cầu đưa AGV đi sạc]
    Q4 -- Không --> Q6
    Q7{Pin đạt ngưỡng đủ dùng?}
    Q7 -- Rồi --> Q8[Khôi phục khả năng nhận lệnh của AGV]
    Q8 --> Q1
  end
  subgraph FMS["FMS (openTCS)"]
    direction TB
    R1[Điều khiển AGV tới điểm sạc] --> R2[Đồng bộ trạng thái sạc về WES]
  end

  P1 --> Q1
  Q6 --> R1
  R2 --> Q7
  Q7 -- Chưa --> R2
```

**Mô tả theo từng lane:**

- **Admin:** Cấu hình ngưỡng pin vận hành và ngưỡng sạc. **Handoff → WES.**
- **WES:** Theo dõi mức pin realtime. Khi pin xuống dưới ngưỡng vận hành, loại AGV khỏi danh sách nhận lệnh mới. Nếu AGV đang chạy → chờ hoàn tất nhiệm vụ hiện tại hoặc đưa về điểm dừng an toàn theo policy rồi mới lập yêu cầu sạc; nếu rảnh → lập yêu cầu sạc ngay. Khi pin đạt ngưỡng đủ dùng, khôi phục khả năng nhận lệnh. **Handoff → FMS.**
- **FMS (openTCS):** Điều khiển AGV tới điểm sạc và đồng bộ trạng thái sạc về WES. **Handoff → WES.**

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Admin → WES | Cấu hình ngưỡng pin vận hành & sạc | Ngưỡng áp vào logic theo dõi |
| 2 | WES | Theo dõi pin realtime, so với ngưỡng | Dưới ngưỡng → xử lý sạc |
| 3 | WES | Loại AGV khỏi nhận lệnh mới | AGV không được giao việc mới |
| 4 | WES | Kiểm tra AGV đang chạy? Nếu có → chờ điểm dừng an toàn | Sẵn sàng đưa đi sạc |
| 5 | WES → FMS | Lập yêu cầu sạc | FMS điều khiển AGV tới điểm sạc |
| 6 | FMS → WES | Đồng bộ trạng thái sạc | WES theo dõi tiến độ sạc |
| 7 | WES | Khi đủ pin → khôi phục khả năng nhận lệnh | AGV quay lại nhóm khả dụng |

**Luồng ngoại lệ:**

- Pin giảm tới ngưỡng critical khi AGV đang thực hiện nhiệm vụ → WES nâng cảnh báo cho Admin và yêu cầu FMS đưa AGV về trạng thái an toàn theo policy.

**Hậu điều kiện:** AGV pin thấp không được giao việc mới; AGV sau sạc quay lại nhóm khả dụng.

---

## WF-05 — Xác thực & tài khoản tự phục vụ (Authentication & Self-service)

**Mục tiêu nghiệp vụ:** Cho phép người dùng (Operator/Admin) đăng nhập an toàn, quản lý thông tin cá nhân và mật khẩu của chính mình.

**Điều kiện kích hoạt:** Người dùng truy cập hệ thống và cần xác thực, muốn cập nhật profile, đổi/khôi phục mật khẩu, hoặc đăng xuất khỏi hệ thống.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph USER["Operator / Admin"]
    direction TB
    L1[Nhập tài khoản & mật khẩu]
    L2[Thao tác: xem/sửa profile, đổi mật khẩu]
    L3[Quên mật khẩu: gửi yêu cầu đặt lại]
    L4[Đăng xuất hệ thống]
  end
  subgraph WES["WES - Auth & Account"]
    direction TB
    M1{Thông tin đăng nhập đúng?}
    M1 -- Sai --> M3[Từ chối & ghi nhận lần đăng nhập thất bại]
    M1 -- Đúng --> M2[Tạo phiên đăng nhập]
    M4[Hiển thị / cập nhật thông tin cá nhân]
    M5{Mật khẩu hiện tại đúng?}
    M5 -- Sai --> M3
    M5 -- Đúng --> M6[Cập nhật mật khẩu mới]
    M7[Phát hành liên kết/mã đặt lại mật khẩu an toàn]
    M7 --> M8[Xác thực & cho phép đặt mật khẩu mới]
    M8 --> M6
    M9[Thu hồi phiên/token đăng nhập]
    M10[Ghi audit đăng xuất]
  end

  L1 --> M1
  M2 --> L2
  L2 --> M4
  L2 --> M5
  L3 --> M7
  L2 --> L4
  L4 --> M9 --> M10
```

**Mô tả theo từng lane:**

- **Operator/Admin:** Nhập tài khoản/mật khẩu để đăng nhập; sau khi vào hệ thống có thể xem/sửa profile, đổi mật khẩu và đăng xuất; khi quên mật khẩu thì gửi yêu cầu đặt lại. **Handoff → WES.**
- **WES (Auth & Account):** Xác thực đăng nhập và tạo phiên nếu đúng, hoặc từ chối và ghi nhận lần thất bại nếu sai. Hiển thị/cập nhật thông tin cá nhân. Với đổi mật khẩu, yêu cầu xác thực mật khẩu hiện tại trước khi cập nhật. Với quên mật khẩu, phát hành liên kết/mã đặt lại an toàn rồi cho đặt mật khẩu mới sau khi xác thực. Với đăng xuất, thu hồi phiên/token và ghi audit.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Operator/Admin → WES | Nhập tài khoản/mật khẩu | WES xác thực |
| 2 | WES | Xác thực: đúng → tạo phiên; sai → từ chối & ghi nhận | Phiên hợp lệ hoặc bị từ chối |
| 3 | Operator/Admin → WES | Xem/sửa profile | WES hiển thị/cập nhật thông tin |
| 4 | Operator/Admin → WES | Đổi mật khẩu | WES xác thực mật khẩu hiện tại rồi cập nhật |
| 5 | Operator/Admin → WES | Quên mật khẩu: yêu cầu đặt lại | WES phát hành liên kết/mã an toàn |
| 6 | WES | Xác thực liên kết/mã → cho đặt mật khẩu mới | Mật khẩu được cập nhật an toàn |
| 7 | Operator/Admin → WES | Đăng xuất | Phiên/token được thu hồi và ghi audit |

**Hậu điều kiện:** Người dùng được xác thực với phiên hợp lệ, hoặc phiên/token được thu hồi khi đăng xuất; thông tin cá nhân/mật khẩu được cập nhật an toàn.

---

## WF-06 — Quản trị người dùng & phân quyền (Admin User Management)

**Mục tiêu nghiệp vụ:** Cho phép Admin quản lý vòng đời tài khoản và phân quyền theo vai trò.

**Điều kiện kích hoạt:** Admin cần xem danh sách/chi tiết người dùng, tạo/sửa/khóa tài khoản, gán-gỡ vai trò hoặc đặt lại mật khẩu cho người dùng khác.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph AD[Admin]
    direction TB
    N1[Chọn thao tác quản trị người dùng]
    N1 --> N2[Tạo / cập nhật / xóa tài khoản]
    N1 --> N3[Khóa / mở khóa tài khoản]
    N1 --> N4[Gán / gỡ vai trò]
    N1 --> N5[Đặt lại mật khẩu người dùng]
    N1 --> N6[Xem danh sách người dùng]
    N1 --> N7[Xem chi tiết người dùng]
  end
  subgraph WES["WES - Access Management"]
    direction TB
    S1{Có quyền & dữ liệu hợp lệ?}
    S1 -- Không --> S2[Từ chối thao tác & ghi audit]
    S1 -- Có --> S3{Thao tác thay đổi dữ liệu?}
    S3 -- Không --> S4[Trả danh sách / chi tiết người dùng]
    S3 -- Có --> S5[Áp dụng thay đổi tài khoản / quyền]
    S5 --> S6[Cập nhật trạng thái truy cập của người dùng]
    S6 --> S7[Ghi nhật ký audit thao tác]
  end

  N2 --> S1
  N3 --> S1
  N4 --> S1
  N5 --> S1
  N6 --> S1
  N7 --> S1
```

**Mô tả theo từng lane:**

- **Admin:** Chọn và thực hiện các thao tác quản trị: xem danh sách/chi tiết người dùng, tạo/cập nhật/xóa tài khoản, khóa/mở khóa, gán/gỡ vai trò, đặt lại mật khẩu cho người dùng khác. **Handoff → WES.**
- **WES (Access Management):** Kiểm tra quyền và tính hợp lệ của dữ liệu; nếu không đạt → từ chối và ghi audit. Với thao tác xem, trả danh sách/chi tiết theo phạm vi quyền. Với thao tác thay đổi, áp dụng thay đổi tài khoản/quyền, cập nhật trạng thái truy cập của người dùng và ghi nhật ký audit.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Admin | Chọn thao tác quản trị (xem danh sách/chi tiết, tạo/sửa/xóa/khóa/role/reset) | Gửi yêu cầu quản trị |
| 2 | Admin → WES | Gửi thao tác kèm dữ liệu hoặc tiêu chí truy vấn | WES kiểm tra quyền & dữ liệu |
| 3 | WES | Kiểm hợp lệ: không đạt → từ chối & ghi audit | Thao tác bị chặn nếu sai |
| 4 | WES | Nếu là thao tác xem → trả danh sách/chi tiết người dùng | Admin xem dữ liệu quản trị |
| 5 | WES | Nếu là thao tác thay đổi → áp dụng thay đổi tài khoản/quyền | Cập nhật trạng thái truy cập |
| 6 | WES | Ghi nhật ký audit cho thao tác nhạy cảm/thay đổi | Thao tác được lưu vết |

**Hậu điều kiện:** Admin xem được dữ liệu người dùng theo quyền; tài khoản và quyền được cập nhật khi có thay đổi; mọi thao tác nhạy cảm/thay đổi đều được lưu vết trong audit trail.

---

## WF-07 — Cấu hình bản đồ & topology vận hành

**Mục tiêu nghiệp vụ:** Thiết lập bản đồ QR grid, point, path, location, block làm nền tảng cho định vị, dẫn đường và điều phối.

**Điều kiện kích hoạt:** Admin hoặc Operator được phân quyền cấu hình upload/thay thế bản đồ, hoặc cấu hình các thực thể topology.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph USER["Admin / Authorized Operator"]
    direction TB
    T1[Upload / thay thế bản đồ vận hành]
    T2[Cấu hình point, path]
    T3[Cấu hình location & gán point]
    T4[Cấu hình block & rule navigation]
  end
  subgraph WES["WES - Topology"]
    direction TB
    W1{Topology hợp lệ với layout?}
    W1 -- Không --> W2[Báo lỗi & yêu cầu chỉnh sửa]
    W1 -- Có --> W3[Lưu cấu hình dạng draft/version mới]
    W3 --> W4[Preview và validate với topology hiện tại]
    W4 --> W6{"Đủ điều kiện kích hoạt? (không còn active operations / trong maintenance window)"}
    W6 -- Không --> W9["Giữ ở draft hoặc lên lịch theo maintenance window"]
    W9 --> W4
    W6 -- Có --> W7[Kích hoạt version topology và giữ bản rollback]
    W7 --> W10{"Kích hoạt thành công & ổn định?"}
    W10 -- Không --> W11[Rollback về version trước và cảnh báo]
    W11 --> W2
    W10 -- Có --> W8[Áp rule không gian vào điều phối & giám sát]
    W8 --> W5[Hiển thị topology trên giao diện quản trị]
  end

  T1 --> W1
  T2 --> W1
  T3 --> W1
  T4 --> W1
```

**Mô tả theo từng lane:**

- **Admin / Authorized Operator:** Upload/thay thế bản đồ và cấu hình point, path, location (gán point), block cùng rule navigation (một chiều/hai chiều, giới hạn AGV trong block...). Operator chỉ tham gia khi được phân quyền cấu hình; mọi thay đổi topology được kiểm quyền và ghi audit. **Handoff → WES.**
- **WES (Topology):** Kiểm tra tính hợp lệ với layout thực tế; nếu lỗi → yêu cầu chỉnh sửa. Khi hợp lệ → lưu cấu hình thành draft/version mới, preview và validate với topology hiện tại, active operations và các resource đang bị chiếm. Chỉ kích hoạt khi đủ điều kiện theo policy (không còn nhiệm vụ/AGV đang chạy phụ thuộc hoặc đang trong maintenance window); nếu chưa đủ điều kiện → giữ ở draft hoặc lên lịch kích hoạt theo maintenance window. Sau kích hoạt, nếu phát hiện lỗi/không ổn định → rollback về version trước và cảnh báo; nếu thành công → áp rule không gian (gồm rule không đi xuyên hàng, hướng tiếp cận) vào điều phối/giám sát và hiển thị topology để đối soát.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Admin/Authorized Operator | Upload/thay thế bản đồ, cấu hình point/path/location/block | Gửi cấu hình topology |
| 2 | … → WES | Gửi cấu hình để kiểm tra | WES kiểm hợp lệ với layout |
| 3 | WES | Không hợp lệ → báo lỗi & yêu cầu chỉnh sửa | Quay lại bước cấu hình |
| 4 | WES | Hợp lệ → lưu draft/version mới, preview và validate | Cấu hình sẵn sàng kích hoạt |
| 5 | WES | Kiểm tra active operations/resource và maintenance window | Đủ điều kiện → activate; không → giữ draft/lên lịch |
| 6 | WES | Kích hoạt version topology và giữ bản rollback | Topology được kích hoạt có khả năng rollback |
| 7 | WES | Kiểm tra ổn định sau kích hoạt; lỗi → rollback version trước & cảnh báo | Giữ vận hành an toàn |
| 8 | WES | Áp rule không gian & hiển thị topology | Phản ánh vào điều phối/giám sát |

**Hậu điều kiện:** Topology vận hành được lưu theo version, kích hoạt có kiểm soát, có khả năng rollback và phản ánh đúng vào logic điều phối.

---

## WF-08 — Giám sát vận hành & phát hiện bất thường

**Mục tiêu nghiệp vụ:** Cung cấp bức tranh vận hành thời gian thực và cảnh báo sớm các bất thường (hotspot, ùn tắc, AGV lỗi nhiều).

**Điều kiện kích hoạt:** Hệ thống vận hành liên tục; dữ liệu trạng thái AGV và yêu cầu được cập nhật realtime.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph FMS["FMS (openTCS) / AGV"]
    direction TB
    K1["Phát sinh trạng thái AGV & tiến độ thực thi"]
  end
  subgraph WES["WES - Monitoring"]
    direction TB
    X1["Thu thập & tổng hợp dữ liệu realtime"] --> X2[Tính KPI: throughput, fail rate, assign time, completion time]
    X2 --> X3[Phát hiện bất thường: hotspot, ùn tắc, AGV lỗi cao]
    X3 --> X4[Cập nhật dashboard & live preview bản đồ]
    X3 --> X5[Nâng cảnh báo khi vượt ngưỡng]
  end
  subgraph USER["Operator / Admin"]
    direction TB
    Y1[Xem dashboard tổng quan & bản đồ realtime]
    Y2[Xem KPI & danh sách khu vực/AGV bất thường]
    Y3[Ra quyết định can thiệp vận hành]
  end

  K1 --> X1
  X4 --> Y1
  X2 --> Y2
  X5 --> Y2
  Y2 --> Y3
```

**Mô tả theo từng lane:**

- **FMS (openTCS) / AGV:** Liên tục phát sinh trạng thái AGV và tiến độ thực thi. **Handoff → WES.**
- **WES (Monitoring):** Thu thập và tổng hợp dữ liệu realtime; tính các KPI chính (throughput, fail rate, assign time, completion time); phát hiện bất thường (hotspot, ùn tắc, AGV lỗi nhiều); cập nhật dashboard & live preview; nâng cảnh báo khi vượt ngưỡng. **Handoff → Operator/Admin.**
- **Operator/Admin:** Theo dõi dashboard, KPI và danh sách khu vực/AGV bất thường để ra quyết định can thiệp.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | FMS/AGV → WES | Phát sinh trạng thái AGV & tiến độ | WES nhận dữ liệu realtime |
| 2 | WES | Thu thập, tổng hợp & tính KPI | KPI vận hành |
| 3 | WES | Phát hiện bất thường, nâng cảnh báo khi vượt ngưỡng | Cảnh báo hotspot/ùn tắc/AGV lỗi |
| 4 | WES → Operator/Admin | Cập nhật dashboard, live preview, danh sách bất thường | Người dùng nắm tình hình |
| 5 | Operator/Admin | Ra quyết định can thiệp vận hành | Hành động vận hành |

**Hậu điều kiện:** Tình trạng vận hành được giám sát liên tục; bất thường được phát hiện và cảnh báo kịp thời.

---

## WF-09 — Hủy yêu cầu vận chuyển (Cancellation Handling)

**Mục tiêu nghiệp vụ:** Cho phép Operator/Admin hủy một yêu cầu vận chuyển trong các trạng thái cho phép, đồng bộ với openTCS qua withdrawal API và giải phóng resource liên quan.

**Điều kiện kích hoạt:** Operator/Admin chọn hủy một yêu cầu vận chuyển ở trạng thái được phép (`PENDING`, `VALIDATING`, `WAITING_DISPATCH`, `BLOCKED`, `DISPATCHING`, hoặc `EXECUTING`).

**Tiền điều kiện:** Yêu cầu vận chuyển tồn tại; người thao tác có quyền phù hợp; trạng thái hiện tại nằm trong nhóm được phép hủy.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph USER["Operator / Admin"]
    direction TB
    H1[Chọn yêu cầu cần hủy] --> H2[Nhập lý do & gửi lệnh hủy]
  end
  subgraph WES[WES]
    direction TB
    I1{Có quyền & trạng thái cho phép?}
    I1 -- Không --> I2[Từ chối thao tác và ghi audit]
    I1 -- Có --> I3{Yêu cầu đã gửi xuống FMS?}
    I3 -- Chưa --> I4[Đánh dấu CANCELLED và giải phóng resource đã reserve]
    I3 -- Rồi --> I5["Gọi openTCS withdrawal API (immediate=true/false)"]
    I5 --> I6{200 OK?}
    I6 -- Có --> I7[Cập nhật CANCELLED]
    I6 -- Không --> I8["Giữ EXECUTING, ghi event_log WARNING, cảnh báo Admin"]
    I9[Ghi audit và cancelled_at]
    I2 --> I9
    I4 --> I9
    I7 --> I9
    I8 --> I9
  end
  subgraph FMS["FMS (openTCS)"]
    direction TB
    J1["POST /v1/transportOrders/{name}/withdrawal"] --> J2[200 OK hoặc error]
  end

  H2 --> I1
  I5 --> J1
  J2 --> I6
```

**Mô tả theo từng lane:**

- **Operator/Admin:** Chọn yêu cầu cần hủy và nhập lý do. Operator chỉ hủy trong phạm vi trạng thái được phép; Admin can thiệp rộng hơn theo policy. **Handoff → WES.**
- **WES:** Kiểm tra quyền và trạng thái. Không hợp lệ → từ chối + ghi audit. Hợp lệ → nếu chưa gửi FMS (PENDING/VALIDATING/WAITING_DISPATCH/BLOCKED) → đánh dấu `CANCELLED` ngay và giải phóng resource đã reserve. Nếu đã gửi FMS (DISPATCHING/EXECUTING) → gọi openTCS withdrawal API (synchronous). 200 OK → `CANCELLED`; error → giữ nguyên `EXECUTING`, ghi `event_log` WARNING kèm `correlation_id` và cảnh báo Admin — openTCS tiếp tục thực thi và WES nhận đồng bộ khi transport order kết thúc tự nhiên. Cuối cùng ghi audit và `cancelled_at`. **Handoff ↔ FMS.**
- **FMS (openTCS):** Nhận lệnh withdrawal, xử lý immediate hoặc regular, trả 200 OK hoặc error code. Hành vi AGV (dừng an toàn, hoàn tất chặng hiện tại) do FMS quản lý nội bộ.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Operator/Admin → WES | Chọn yêu cầu & gửi lệnh hủy kèm lý do | WES kiểm tra quyền & trạng thái |
| 2 | WES | Không hợp lệ → từ chối & ghi audit | Kết thúc |
| 3 | WES | Chưa gửi FMS → CANCELLED ngay & giải phóng resource | Kết thúc sớm, resource sẵn sàng |
| 4 | WES → FMS | Đã gửi FMS → gọi withdrawal API | FMS xử lý hủy transport order |
| 5 | FMS → WES | 200 OK → CANCELLED; error → giữ EXECUTING + log WARNING + cảnh báo | Trạng thái nhất quán |
| 6 | WES | Ghi audit và cancelled_at | Audit trail hoàn chỉnh |

**Luồng ngoại lệ:**

- openTCS trả lỗi (withdrawal thất bại): WES giữ `EXECUTING`, ghi `event_log` WARNING kèm `correlation_id`. Transport order tiếp tục chạy ở FMS và khi kết thúc tự nhiên, WES nhận đồng bộ và cập nhật `COMPLETED` hoặc `FAILED`.
- Yêu cầu đã `COMPLETED` trước khi lệnh hủy tới FMS: giữ `COMPLETED`, ghi audit thao tác hủy thất bại do trạng thái đã thay đổi.

**Hậu điều kiện:** Yêu cầu kết thúc ở `CANCELLED` hoặc tiếp tục `EXECUTING` nếu withdrawal thất bại (sẽ chuyển sang `COMPLETED`/`FAILED` khi kết thúc tự nhiên); audit trail đầy đủ.

---

## WF-10 — Nhật ký sự kiện & audit trail (Event Log & Audit Trail)

**Mục tiêu nghiệp vụ:** Ghi nhận đầy đủ sự kiện vận hành và thao tác người dùng để phục vụ giám sát, truy vết sự cố, kiểm tra thay đổi cấu hình và xuất báo cáo.

**Điều kiện kích hoạt:** Có sự kiện vận hành phát sinh từ WES/FMS/AGV, hoặc có thao tác người dùng làm thay đổi dữ liệu/trạng thái quan trọng như AGV, topology, cấu hình điều phối, tài khoản, yêu cầu vận chuyển.

**Tiền điều kiện:** Các module nghiệp vụ phát sinh event theo format thống nhất; người dùng có quyền phù hợp khi xem, lọc hoặc xuất log.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph SRC["WES / FMS / AGV / User Action"]
    direction TB
    E1[Phát sinh event vận hành hoặc thao tác người dùng] --> E2[Đính kèm context: actor, entity, trạng thái trước/sau, timestamp, correlation id]
  end
  subgraph WES["WES - Event & Audit"]
    direction TB
    F1[Chuẩn hóa schema event] --> F2{Event hợp lệ và đủ context?}
    F2 -- Không --> F3[Ghi nhận event lỗi schema để điều tra]
    F3 --> F4["Lưu event log / audit trail bất biến"]
    F2 -- Có --> F4
    F4 --> F5[Index phục vụ tìm kiếm, lọc và đối soát]
    F5 --> F6[Liên kết event với transport request, AGV, topology hoặc user session]
    F6 --> F7[Chuẩn bị dữ liệu xuất báo cáo]
  end
  subgraph USER["Operator / Admin"]
    direction TB
    G1[Xem danh sách event] --> G2[Tìm kiếm / lọc theo thời gian, entity, actor, severity]
    G2 --> G3[Xem chi tiết event và chuỗi liên quan]
    G4[Xuất báo cáo nhật ký]
  end

  E2 --> F1
  F5 --> G1
  F6 --> G3
  F7 --> G4
```

**Mô tả theo từng lane:**

- **WES / FMS / AGV / User Action (nguồn):** Phát sinh event (vận hành hoặc thao tác người dùng) kèm context tối thiểu: actor/source, entity liên quan, loại hành động, timestamp, severity, correlation id. **Handoff → WES (Event & Audit).**
- **WES (Event & Audit):** Chuẩn hóa schema, kiểm tra context, lưu event/audit theo hướng bất biến và index để phục vụ tìm kiếm. Với thay đổi quan trọng, lưu trạng thái trước/sau hoặc diff đủ để truy vết. Liên kết event với transport request, AGV, topology, cấu hình điều phối hoặc user session để dựng được chuỗi nguyên nhân–kết quả. **Handoff → Operator/Admin.**
- **Operator/Admin:** Xem danh sách, lọc/tìm kiếm, mở chi tiết event và xuất báo cáo theo quyền. Operator xem phạm vi vận hành; Admin xem đầy đủ audit và lịch sử thay đổi cấu hình.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | WES/FMS/AGV/User | Phát sinh event + đính kèm context | Gửi event sang Event & Audit |
| 2 | WES | Chuẩn hóa schema & kiểm tra context | Thiếu context → ghi nhóm lỗi schema |
| 3 | WES | Lưu event/audit bất biến & index | Sẵn sàng tìm kiếm/lọc |
| 4 | WES | Liên kết event với entity & dựng chuỗi liên quan | Truy vết nguyên nhân–kết quả |
| 5 | WES → Operator/Admin | Cung cấp danh sách, chi tiết & dữ liệu báo cáo | Người dùng xem/lọc/xuất |
| 6 | Operator/Admin | Tìm kiếm, xem chi tiết, xuất báo cáo | Phục vụ giám sát & truy vết |

**Luồng ngoại lệ:**

- Event thiếu context bắt buộc → vẫn ghi nhận dưới nhóm lỗi schema để không mất dấu, đồng thời cảnh báo đội vận hành/kỹ thuật.
- Người dùng không đủ quyền xem audit nhạy cảm → từ chối truy cập và ghi audit cho chính thao tác bị từ chối.
- Xuất báo cáo quá lớn → yêu cầu lọc hẹp hơn hoặc xử lý bất đồng bộ theo policy.

**Hậu điều kiện:** Sự kiện và thao tác quan trọng được lưu vết đầy đủ; người dùng có thể tìm kiếm, lọc, xem chi tiết chuỗi liên quan và xuất báo cáo phục vụ truy vết.

---

## WF-11 — Quản lý đội AGV & khả năng tham gia điều phối (AGV Fleet Management)

**Mục tiêu nghiệp vụ:** Quản lý danh sách AGV, trạng thái vận hành, khả năng nhận lệnh, chế độ ignore/restore và lịch sử hoạt động/lỗi để WES chỉ điều phối các AGV phù hợp.

**Điều kiện kích hoạt:** Admin xem/tìm kiếm/lọc AGV, xem chi tiết/lịch sử, tạo/cập nhật/xóa AGV, bật/tắt khả năng nhận lệnh hoặc ignore/khôi phục AGV; FMS/openTCS đồng bộ trạng thái AGV theo thời gian thực.

**Tiền điều kiện:** Admin có quyền quản lý đội xe; mã AGV/mapping với openTCS được định nghĩa rõ; WES nhận được dữ liệu trạng thái tối thiểu từ FMS hoặc cấu hình nội bộ.

**Swim-lane diagram:**

```mermaid
flowchart LR
  subgraph AD[Admin]
    direction TB
    Z1[Xem danh sách / tìm kiếm / lọc AGV]
    Z2[Xem chi tiết, lịch sử hoạt động và lỗi]
    Z3[Tạo / cập nhật / xóa AGV]
    Z4[Cho phép / dừng AGV nhận lệnh]
    Z5[Ignore / khôi phục AGV khỏi phạm vi WES]
  end
  subgraph FMS["FMS (openTCS)"]
    direction TB
    AA1[Đồng bộ trạng thái AGV: online, vị trí, pin, lỗi, tiến độ]
  end
  subgraph WES["WES (Fleet module)"]
    direction TB
    AB1{"Có quyền & dữ liệu hợp lệ?"}
    AB1 -- Không --> AB2[Từ chối thao tác và ghi audit]
    AB1 -- Có --> AB3{Thao tác xem?}
    AB3 -- Có --> AB4[Trả danh sách / chi tiết / lịch sử AGV]
    AB3 -- Không --> AB5[Cập nhật registry AGV và mapping với FMS]
    AB5 --> AB6[Cập nhật policy nhận lệnh / ignore / restore]
    AB7[Ghi nhận trạng thái realtime và lịch sử hoạt động/lỗi]
    AB8{AGV đủ điều kiện tham gia điều phối?}
    AB8 -- Có --> AB9[Đưa vào danh sách AGV candidate]
    AB8 -- Không --> AB10[Loại khỏi candidate nhưng tiếp tục theo dõi nếu còn active/resource]
  end
  subgraph ORC["WES (Orchestration module)"]
    direction TB
    AC1[Sử dụng danh sách AGV candidate khi điều phối]
  end

  Z1 --> AB1
  Z2 --> AB1
  Z3 --> AB1
  Z4 --> AB1
  Z5 --> AB1
  AA1 --> AB7
  AB6 --> AB8
  AB7 --> AB8
  AB9 --> AC1
  AB10 --> AB4
```

**Mô tả theo từng lane:**

- **Admin:** Quản lý danh sách AGV, xem trạng thái/chi tiết/lịch sử, cập nhật thông tin định danh, bật/tắt khả năng nhận lệnh và ignore/khôi phục AGV khỏi phạm vi điều phối nghiệp vụ. **Handoff → WES.**
- **FMS (openTCS):** Đồng bộ trạng thái thực thi của AGV như online/offline, vị trí, pin, lỗi và tiến độ nhiệm vụ. **Handoff → WES.**
- **WES (Fleet module):** Kiểm tra quyền và dữ liệu, quản lý registry AGV, mapping với FMS, policy nhận lệnh/ignore, trạng thái realtime và lịch sử hoạt động/lỗi. WES tính danh sách AGV candidate cho điều phối dựa trên policy nội bộ, trạng thái từ FMS, ngưỡng pin và trạng thái resource.
- **WES (Orchestration module):** Chỉ sử dụng danh sách AGV candidate khi gán việc, tránh giao nhiệm vụ cho AGV bị dừng nhận lệnh, bị ignore, offline, lỗi hoặc không đủ điều kiện vận hành.

> Lưu ý: `WES (Fleet module)` và `WES (Orchestration module)` là hai module bên trong cùng một hệ thống WES, được tách lane để thể hiện rõ ranh giới trách nhiệm (quản lý đội xe vs gán việc), không phải hai hệ thống riêng biệt.

**Bảng các bước:**

| Bước | Lane | Hành động | Đầu ra / Handoff |
| ---- | ---- | --------- | ---------------- |
| 1 | Admin → WES | Xem/tìm kiếm/lọc AGV hoặc xem chi tiết/lịch sử | WES kiểm quyền và trả dữ liệu |
| 2 | Admin → WES | Tạo/cập nhật/xóa AGV hoặc cấu hình nhận lệnh/ignore | WES kiểm quyền & dữ liệu |
| 3 | FMS → WES | Đồng bộ trạng thái AGV realtime | WES cập nhật trạng thái và lịch sử |
| 4 | WES | Cập nhật registry, mapping FMS và policy điều phối | Dữ liệu đội xe nhất quán |
| 5 | WES | Tính AGV có đủ điều kiện tham gia điều phối hay không | Danh sách candidate được cập nhật |
| 6 | WES → Orchestration | Cung cấp danh sách AGV candidate | Orchestration dùng để gán việc |

**Luồng ngoại lệ:**

- Mã AGV trùng, thiếu mapping FMS hoặc dữ liệu cấu hình sai → từ chối thao tác và ghi audit.
- Admin muốn xóa AGV đang active, đang nhận nhiệm vụ hoặc còn chiếm resource → từ chối xóa; đề xuất dừng nhận lệnh hoặc ignore theo policy.
- FMS mất đồng bộ hoặc AGV không cập nhật quá ngưỡng → đánh dấu stale/offline, loại khỏi candidate và cảnh báo cho Admin.
- AGV bị ignore nhưng vẫn active ở tầng FMS → WES không giao việc mới nhưng vẫn hiển thị/ghi nhận trạng thái nếu AGV còn ảnh hưởng resource vận hành.

**Hậu điều kiện:** Registry AGV, trạng thái vận hành, policy nhận lệnh/ignore và danh sách AGV candidate được cập nhật nhất quán; lịch sử hoạt động/lỗi đủ để truy vết và phục vụ điều phối.

---

## Bảng ánh xạ Workflow ↔ Major Feature

| Workflow | Tên | Major Feature liên quan |
| -------- | --- | ----------------------- |
| WF-01 | Vòng đời yêu cầu vận chuyển | FE-03, FE-04 |
| WF-02 | Điều phối & thứ tự lấy hàng | FE-04 |
| WF-03 | Xử lý yêu cầu không hợp lệ | FE-03 |
| WF-04 | Quản lý pin & sạc AGV | FE-01 (battery/charging), FE-04 |
| WF-05 | Xác thực & tài khoản tự phục vụ | FE-07 |
| WF-06 | Quản trị người dùng & phân quyền | FE-07 |
| WF-07 | Cấu hình bản đồ & topology | FE-02 |
| WF-08 | Giám sát vận hành & bất thường | FE-06 |
| WF-09 | Hủy / dừng yêu cầu vận chuyển | FE-03, FE-04, FE-08 |
| WF-10 | Nhật ký sự kiện & audit trail | FE-08 |
| WF-11 | Quản lý đội AGV & khả năng tham gia điều phối | FE-01 (fleet management) |
