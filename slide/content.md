# Nội dung slide — WES / Aubot

## I. Bối cảnh — AGV trong logistics

### I.1 — AGV & tự động hoá kho

**Slide:**

- AGV là xe tự hành chạy trong kho theo hạ tầng dẫn đường có sẵn — ở dự án này là lưới mã QR dán trên sàn.
- Thay thế thao tác thủ công: đẩy xe, kéo pallet, di chuyển kiện hàng giữa các khu.
- Cái giá: quyết định trước đây nằm trong đầu người vận hành nay phải có phần mềm ra thay — việc nào làm trước, xe nào làm, đi đường nào.

**Concept:**

- **AGV** (Automated Guided Vehicle) — xe tự hành bám hạ tầng dẫn đường cố định (QR, từ tính, laser). Khác **AMR** (Autonomous Mobile Robot) ở chỗ AMR tự lập bản đồ và tự tìm đường, AGV đi theo mạng lưới điểm/cạnh đã định nghĩa trước.
- **Bản đồ QR-grid** — sàn kho được dán lưới mã QR; mỗi mã là một *điểm* trên bản đồ, xe định vị bằng cách đọc mã dưới bụng. Đường đi là chuỗi điểm liền kề.

---

### I.2 — Phân tầng điều khiển: WMS → WES → FMS → AGV

**Slide:**

| Tầng | Câu hỏi tầng đó trả lời | Trong dự án này |
|---|---|---|
| WMS | Hàng gì? Cần về **khu vực** nào? | Ngoài phạm vi — WES nhận đầu vào từ máy quét qua API |
| **WES** | Việc nào làm trước? **Xe nào làm? Trả vào đúng ô nào?** | **Hệ thống nhóm xây dựng** (NestJS) |
| FMS | **Đi đường nào?** Ai được vào ô trước? | openTCS (bản fork của nhóm) |
| AGV | Chấp hành lệnh di chuyển | Xe B300, giao tiếp chuẩn VDA5050 trên MQTT |

Đầu vào chỉ nói tới cấp **khu vực** — "kiện này về khu C". Chọn **ô cụ thể** nào trong khu đó là việc WES tự tính.

Câu chốt: **WES chọn xe và chọn chỗ. FMS chọn đường.**

**Concept:**

- **WMS** (Warehouse Management System) — quản lý tồn kho và đơn hàng. Biết *cái gì* cần đi đâu, không biết *khi nào* và *bằng xe nào*.
- **WES** (Warehouse Execution System) — tầng điều phối thực thi, nằm giữa WMS và thiết bị. Biến danh sách việc thành thứ tự thực thi và gán việc cho thiết bị cụ thể.
- **FMS** (Fleet Management System) — quản lý đội xe: định tuyến vật lý, cấp phát tài nguyên đường đi, giao tiếp phần cứng.
- **openTCS** — phần mềm mã nguồn mở làm tầng FMS. Vốn tự chọn xe; ở dự án này quyền chọn xe được lấy về WES, tầng FMS nhận lệnh đã chỉ định sẵn xe.
- **VDA5050** — chuẩn giao tiếp mở giữa hệ điều phối và AGV, chạy trên MQTT. Cho phép một hệ điều phối điều khiển xe của nhiều hãng khác nhau.

---

### I.3 — Thị trường AGV logistics tại Việt Nam

**Slide:**

- Chi phí logistics Việt Nam chiếm **16–17% GDP**, gấp đôi Singapore (~8%) — áp lực tự động hoá là có thật.
- **Viettel Post** (01/2024): tổ hợp chia chọn robot đầu tiên của Việt Nam, **1,4 triệu bưu phẩm/ngày**, giảm 60% chi phí nhân công. Đến 10/2024 vận hành **300 AGV tự sản xuất**; 06/2026 xuất khẩu robot sang Hàn Quốc.
- **Phenikaa-X** (04/2024): robot AMR tải 1.000 kg vào nhà máy Samsung Thái Nguyên — tích hợp qua chuẩn **VDA5050**.
- **Aubot**: hơn 300 AGV đã triển khai (công ty công bố), dòng T500 và **B300**; khách hàng Sumitomo, NITORI, BEING Holdings.
- Thị trường robot kho Việt Nam: **38,2 triệu USD (2025) → 85,1 triệu USD (2034)**, CAGR ~9%/năm.

**Concept:**

- **VDA5050 là chuẩn ngành, không phải lựa chọn riêng của đề tài** — Phenikaa-X dùng đúng chuẩn này để đưa robot vào nhà máy Samsung Thái Nguyên. Đây là cơ sở cho lựa chọn ở mục III.
- **Robot kho là một mảng con của tự động hoá kho** — 38,2 triệu USD là riêng robot; tính cả băng tải, kệ tự động và phần mềm thì thị trường là 256 triệu USD (2025).
- **Viettel Post có hai thế hệ robot** — hệ đầu (01/2024) là 160 robot LiBiao nhập ngoại; 300 robot "Made by Viettel Post" là thế hệ tự phát triển sau đó.
- **Số liệu Aubot lấy từ công bố của công ty** — website ghi hơn 300 AGV đã triển khai, đồng thời ghi riêng dự án Sumitomo là 500 AGV.

**Nguồn:**

| Nội dung | Nguồn | Ngày |
|---|---|---|
| Tổ hợp chia chọn, 1,4 triệu bưu phẩm/ngày, giảm 60% nhân công | [Tuổi Trẻ](https://tuoitre.vn/doanh-nghiep-viet-nam-dau-tien-dung-robot-chia-hang-giam-60-chi-phi-nhan-cong-20240121115633405.htm), [VnEconomy](https://vneconomy.vn/viettel-post-khai-truong-to-hop-cong-nghe-chia-chon-thong-minh-dau-tien-cua-viet-nam.htm) | 01/2024 |
| 300 AGV "Made by Viettel Post" | [GenK](https://genk.vn/dieu-thu-vi-ve-to-hop-robot-logistics-thong-minh-made-by-viettel-post-tai-innovate-viet-nam-2024-20241008175009502.chn) | 10/2024 |
| Xuất khẩu robot sang Hàn Quốc | [CafeBiz](https://cafebiz.vn/viettel-post-xuat-khau-robot-sang-han-quoc-tu-chu-cong-nghe-tu-a-z-nang-suat-dat-1000-buu-pham-nguoi-gio-176260629064922489.chn) | 06/2026 |
| Chi phí logistics 16–17% GDP; 160 robot LiBiao | [Rest of World](https://restofworld.org/2025/vietnam-viettel-post-delivery-robots/), [Parcel & Postal Tech](https://www.parcelandpostaltechnologyinternational.com/uncategorized/vtpost-launches-robot-based-parcel-sorting-in-vietnam.html) | 01/2025, 01/2024 |
| Phenikaa-X AMR 1.000 kg, VDA5050, Samsung Thái Nguyên | [VnExpress Int'l](https://e.vnexpress.net/news/business/first-samsung-electronics-factory-to-implement-phenikaa-x-s-amr-pallet-mover-robot-solution-4770812.html), [Phenikaa-X](https://portal.phenikaa-x.com/02-amr-pallet-mover-robots-delivered-to-sevt-samsung-thai-nguyen/) | 04–07/2024 |
| Aubot: >300 AGV, T500/B300, khách hàng | [aubot.vn](https://aubot.vn/) | truy cập 08/2026 |
| Thị trường robot kho VN | [IMARC Group](https://www.imarcgroup.com/vietnam-warehouse-robotics-market) | 2025 |

---

### I.4 — Aubot & phạm vi đề tài

**Slide:**

- Đề tài thực hiện trên hệ thống FMS đang vận hành của Aubot — doanh nghiệp AGV Việt Nam, dòng xe B300.
- Không phải bài toán giả định: số liệu trong bài lấy từ dữ liệu vận hành thật, không phải mô phỏng.
- Dữ liệu dùng xuyên suốt bài lấy từ CSDL vận hành thật của Aubot — 11 xe B300, 6.294 lệnh vận chuyển trong 5 tuần (13/4 – 18/5/2026).

| Nhóm làm | Nhóm không làm |
|---|---|
| Tầng WES: nghiệp vụ, điều phối, gán xe | WMS / quản lý tồn kho |
| Can thiệp tầng định tuyến của FMS | Phần cứng xe, firmware |
| Tích hợp thiết bị qua VDA5050 | Thiết kế bản đồ kho vật lý |

**Concept:**

- **B300** — dòng AGV của Aubot dùng trong triển khai này; toàn đội 11 xe cùng một loại.
- **Lệnh vận chuyển** (transport order) — đơn vị công việc gửi xuống tầng FMS: đi từ đâu, tới đâu, làm thao tác gì.
- **Kiện hàng** (cargo) — thực thể vật lý được quét vào hệ thống. Một kiện hàng có thể sinh ra nhiều lệnh vận chuyển; hai thứ này là hai thực thể tách biệt.

---

## II. Bài toán của Aubot — đo trên dữ liệu vận hành thật

### II.1 — Ngày cao điểm: gần một nửa số lệnh không hoàn tất

**Slide:**

Đo trên ngày tải cao nhất trong 5 tuần dữ liệu — nơi hệ thống lộ điểm yếu rõ nhất:

| Lệnh không hoàn tất | **44,2%** |
|---|---|
| **Thời gian chờ được gán xe** | **trung bình 309 giây** |

Ba điều rút ra:

- Gần một nửa số lệnh không về đích.
- Trung bình 5 phút trôi qua trước khi một lệnh có xe — chiếm khoảng 40% vòng đời. Nhưng dữ liệu cũ **không tách được** đâu là chờ hợp lệ (kiện phía ngoài chưa dọn) với đâu là chờ do điều phối: hệ thống cũ không có khái niệm "lệnh đang bị chặn".
- Mọi lệnh trong ngày đều đã được gán xe, và 85% số lệnh hỏng dồn vào đúng hai giờ cao điểm. Hỏng là do **tải**, và xảy ra **sau** khi gán — không phải vì hệ thống không gán nổi.

Dữ liệu chưa trả lời được: bảng bản đồ trong CSDL khách hàng rỗng, nên biết được mã vị trí hay xảy ra lỗi nhưng chưa quy chiếu sang nút vật lý.

**Concept:**

- **Luật lấy hàng theo lớp** — hàng xếp thành làn, chỉ lấy được kiện ngoài cùng; kiện phía trong phải đợi kiện ngoài đi trước. Vì vậy *chờ lâu chưa chắc là hệ thống chậm* — có thể là đang chờ đúng luật.
- **Thời gian chờ gán** — từ lúc lệnh được tạo đến lúc hệ thống chọn được xe. Gộp cả chờ hợp lệ lẫn chờ do điều phối. Tách bạch hai loại chờ này chính là một phần việc của mục VI.
- **Vòng đời lệnh** — từ lúc tạo đến lúc hoàn tất, gồm cả chờ gán lẫn thời gian xe chạy.

---

### II.2 — Hỏng nằm ở đâu

**Slide:**

Cùng ngày đó, bóc theo loại lệnh:

| Loại lệnh | Tỉ lệ không hoàn tất |
|---|---|
| Vận chuyển hàng | **6,3%** |
| Về chỗ đỗ | **56,2%** |
| Sạc pin | **89,5%** |

Lệnh chở hàng gần như không hỏng. Toàn bộ tỉ lệ 44% đến từ **sạc và đỗ**.

Nhưng phần lớn trong đó **không phải sự cố**. Cơ chế thật là:

> Xe rảnh → hệ thống ra lệnh đi sạc / về chỗ đỗ → đang trên đường thì có hàng cần lấy → hệ thống **thu hồi** lệnh đó để giao việc thật → lệnh bị thu hồi được ghi nhận là "hỏng".

Vậy 89,5% không đo lỗi. Nó đo **mức độ dao động của vòng đời xe rảnh**: hệ thống liên tục ra lệnh rồi tự rút lại. Cái mất thật nằm ở chỗ khác — quãng đường thừa, và xe đổi hướng giữa chừng ngay trong luồng giao thông.

Ba hiện tượng → ba bài toán của đề tài:

| Hiện tượng đo được | Bài toán | Mục |
|---|---|---|
| Chờ gán xe lâu, không rõ vì chặn hợp lệ hay vì điều phối | Gán xe (assignment) | VI |
| Hỏng dồn vào hai giờ tải cao — đông xe thì tắc | Định tuyến đa xe, tránh xung đột | VII |
| Xe rảnh bị điều đi rồi gọi về liên tục | Vòng đời xe: sạc & đỗ | VIII |

**Concept:**

- **Lệnh sạc / lệnh đỗ** — lệnh hệ thống tự sinh (không do người tạo) để đưa xe rảnh về trạm sạc hoặc về chỗ đỗ, tránh xe đứng chắn đường giữa kho.
- **Thu hồi lệnh** — huỷ một lệnh đang chạy để giải phóng xe cho việc khác. Lệnh bị thu hồi kết thúc ở cùng một trạng thái với lệnh gặp sự cố thật, nên tỉ lệ "hỏng" đọc thô sẽ cao hơn số sự cố thực tế.
- **Vì sao dao động này tốn kém** — mỗi lần điều xe đi rồi gọi về là một đoạn đường không sinh giá trị, cộng thêm một lần xe quay đầu giữa lối đi. Với AGV, quay đầu tốn thời gian hơn đi thẳng và chiếm chỗ rộng hơn, nên nó vừa làm chậm chính chiếc xe đó vừa cản các xe khác.

---

## III. WES — kiến trúc tổng thể

### III.1 — Sơ đồ tổng thể

**Slide:**

```
  Người vận hành / Máy quét QR-barcode
                │
        ┌───────▼────────────────────────────────┐
        │  wes-client   (React + Vite)           │  giao diện, không chứa logic nghiệp vụ
        └───────┬────────────────────────────────┘
                │  REST + WebSocket
        ┌───────▼────────────────────────────────┐
        │  WES          (NestJS, PostgreSQL)     │  ⬅ toàn bộ logic nghiệp vụ
        │   ├ nghiệp vụ: kiện hàng, lệnh, vòng đời
        │   ├ điều phối: chọn việc, chọn xe
        │   └ lớp giao tiếp với tầng FMS
        └───────┬────────────────────────────────┘
                │  REST (lệnh)  +  SSE (telemetry)
        ┌───────▼────────────────────────────────┐
        │  openTCS kernel   (Java, bản fork)     │  ⬅ định tuyến & điều khiển
        │   ├ định tuyến đa xe (MAPF)
        │   ├ cấp phát tài nguyên đường đi
        │   └ comm adapter VDA5050
        └───────┬────────────────────────────────┘
                │  MQTT — chuẩn VDA5050 v2.0
        ┌───────▼────────────────────────────────┐
        │  AGV B300                              │
        └────────────────────────────────────────┘
```

**Concept:**

- **Modular monolith** — WES là một khối triển khai duy nhất chia thành các module có ranh giới rõ, không phải microservices. Chọn kiểu này vì đội nhỏ và vì nghiệp vụ cần giao dịch nhất quán trên cùng một CSDL.
- **REST và SSE** — WES gửi *lệnh* xuống kernel bằng REST; kernel đẩy *trạng thái* ngược lên bằng SSE (Server-Sent Events, luồng sự kiện một chiều giữ mở liên tục).
- **MQTT** — giao thức nhắn tin theo chủ đề (publish/subscribe), là đường truyền mà chuẩn VDA5050 chạy trên đó.

---

### III.2 — Ranh giới: WES chọn xe, openTCS chọn đường

**Slide:**

| Việc | Ai làm |
|---|---|
| Tiếp nhận kiện hàng, sinh lệnh vận chuyển | WES |
| Quyết định việc nào làm trước | WES |
| **Chọn ô trả hàng cụ thể trong khu vực đích** | **WES** |
| **Chọn xe nào làm việc gì** | **WES** |
| Tính đường đi cụ thể | openTCS |
| Chống va chạm, cấp phát ô đường | openTCS |
| Nói chuyện với xe | openTCS (comm adapter) |

- openTCS vốn tự chọn xe. Ở đây quyền đó được lấy về WES: tầng FMS nhận lệnh **đã chỉ định sẵn xe**.
- Lý do: chọn xe cần dữ liệu nghiệp vụ mà tầng FMS không có — thứ tự lấy hàng theo chiều sâu làn, chính sách pin của đội xe, quan hệ giữa kiện hàng và lệnh.

**Concept:**

- **Chỉ định xe từ trước** — openTCS cho phép gửi kèm lệnh một xe đã chọn sẵn. Đây chính là "công tắc" để WES giành quyền chọn xe mà không phải sửa lõi openTCS.

---

### III.3 — Tầng thiết bị: VDA5050, MQTT, comm adapter

**Slide:**

- Giao tiếp với xe theo chuẩn mở **VDA5050 phiên bản 2.0** trên MQTT — không khoá cứng vào một hãng xe.
- Hai chiều thông điệp: hệ thống gửi xuống lộ trình và lệnh tức thời; xe trả về vị trí, mức pin và trạng thái lỗi.
- Giữa hai bên là **comm adapter** — kế thừa bản chuẩn có sẵn của openTCS, mở rộng phần riêng cho xe B300: ràng buộc lệnh sao cho xe chấp nhận, chuẩn hoá trạng thái xe gửi về, bù mã QR dán lệch hướng, ba mức tốc độ theo tải và theo cua, xử lý khi xe mất định vị.

Ý nghĩa: **đổi hãng xe chỉ cần viết adapter mới** — nghiệp vụ và định tuyến giữ nguyên.

**Concept:**

- **VDA5050** — chuẩn giao tiếp mở do hiệp hội công nghiệp ô tô Đức ban hành, quy định thống nhất cách một hệ điều phối nói chuyện với AGV của bất kỳ hãng nào. Phenikaa-X cũng dùng chuẩn này (mục I.3).
- **Comm adapter** (bộ chuyển giao tiếp) — thành phần dịch giữa mô hình lệnh nội bộ của openTCS và giao thức thực tế của xe. Mỗi loại xe một adapter.
- **`instantAction`** — lệnh gửi thẳng cho xe thực hiện ngay, không nằm trong lộ trình (ví dụ: bật/tắt cảm biến, dừng khẩn).
- **Vì sao phải có lớp "rewriter" và "filter"** — chuẩn là chuẩn, nhưng xe thật luôn có sai khác so với chuẩn: giới hạn độ dài định danh, quy ước góc quay riêng, mã QR dán không đúng hướng thiết kế. Đây là phần công việc tích hợp mà tài liệu chuẩn không nói.

---

## IV. Mainflow — các luồng nghiệp vụ chính

### IV.1 — Bản đồ 11 luồng nghiệp vụ

**Slide:**

| Nhóm | Luồng |
|---|---|
| Vận chuyển | WF-01 Vòng đời yêu cầu vận chuyển · WF-02 Điều phối & thứ tự lấy hàng · WF-03 Xử lý yêu cầu không hợp lệ · WF-09 Huỷ / dừng yêu cầu |
| Đội xe | WF-04 Quản lý pin & sạc · WF-11 Quản lý đội AGV & khả năng tham gia điều phối |
| Vận hành | WF-08 Giám sát & phát hiện bất thường · WF-10 Nhật ký sự kiện & audit trail |
| Quản trị | WF-05 Xác thực & tài khoản · WF-06 Người dùng & phân quyền · WF-07 Cấu hình bản đồ & topology |

Mỗi luồng được mô tả theo 4 tác nhân: Operator / Admin — WES — FMS — AGV.

---

### IV.2 — WF-01: vòng đời một yêu cầu vận chuyển

**Slide:**

| Bước | Ai làm | Việc |
|---|---|---|
| 1 | Operator | Quét QR sàn để xác định vị trí hàng, quét barcode kiện hàng, xác định location đích |
| 2 | Máy quét → WES | Gửi yêu cầu qua API |
| 3 | WES | Kiểm tra hợp lệ nghiệp vụ — không hợp lệ thì rẽ sang WF-03 |
| 4 | WES | Tạo kiện hàng và lệnh vận chuyển, xác định điểm lấy, chọn điểm trả theo quy tắc không gian |
| 5 | WES | Xét thứ tự lấy hàng, chọn xe, đẩy lệnh xuống FMS |
| 6 | FMS | Tính đường đi, cấp phát tài nguyên, gửi lệnh xuống xe |
| 7 | AGV | Tới điểm lấy → nâng hàng → di chuyển → hạ hàng → lùi khỏi ô trả |
| 8 | FMS → WES | Đồng bộ trạng thái ngược, WES cập nhật vòng đời và mốc thời gian |

Đầu vào tối thiểu chỉ có hai thứ: **vị trí hiện tại của hàng** và **location đích**. Mọi thứ còn lại hệ thống tự quyết.

**Concept:**

- **Kiện hàng (cargo) và lệnh vận chuyển là hai thực thể tách biệt.** Quét hàng tạo ra kiện hàng; hệ thống mới là bên quyết định khi nào sinh lệnh vận chuyển cho kiện đó. Tách ra vì một kiện có thể bị huỷ lệnh rồi cấp lệnh lại, mà bản thân kiện hàng vẫn còn nguyên ngoài kho.
- **Location và point** — *point* là một ô trên lưới QR, toạ độ vật lý. *Location* là vị trí nghiệp vụ (khu trả hàng, trạm sạc), gắn với point qua liên kết. Người vận hành chỉ định location, hệ thống tự dịch ra point.

---

### IV.3 — Vòng đời lệnh bên trong WES

**Slide:**

```
                   ┌──── BỊ CHẶN ◄────┐   kiện phía ngoài chưa được lấy
                   ▼                   │
  Mới tạo ──► Sẵn sàng gán ──► Đang lấy hàng ──► Đang giao ──► Hoàn tất
                    │                  │              │
                    └─ chọn xe         └─ chặng 1 xong └─ chặng 3 xong

  Huỷ được ở mọi trạng thái trước khi hoàn tất
```

Mỗi lệnh của WES được tách thành **ba chặng** gửi xuống tầng FMS:

| Chặng | Việc | Ghi chú |
|---|---|---|
| 1 | Đi tới điểm lấy và nâng hàng | |
| 2 | Tiến vào đầu làn trả hàng | Chỉ di chuyển, không thao tác hàng |
| 3 | Hạ hàng, rồi lùi ra khỏi ô trả | Gói **hai** đoạn di chuyển trong một chặng |

Việc lùi ra được gói vào chính chặng 3 thay vì phát lệnh riêng — nhờ vậy đoạn lùi vẫn do tầng FMS định tuyến, vẫn được cấp phát đường đi và vẫn nằm trong tầm nhìn của bộ tránh va chạm.

**Concept:**

- **Máy trạng thái** — bảng liệt kê đầy đủ các trạng thái hợp lệ và các bước chuyển được phép giữa chúng. Toàn hệ thống chỉ có duy nhất một chỗ được đổi trạng thái lệnh, nên không thể có đường tắt làm lệnh nhảy sai trạng thái.
- **Bị chặn** — lệnh hợp lệ nhưng chưa làm được vì kiện hàng phía ngoài cùng làn chưa được lấy đi. Xe không thể với qua kiện ngoài để lấy kiện trong.
- **Vì sao tách ba chặng** — mỗi chặng kết thúc là một mốc nghiệp vụ có thật (đã nâng hàng, đã vào làn, đã trả xong). Tách ra thì huỷ giữa chừng hoặc đổi xe ở ranh giới chặng đều xử lý được, thay vì phải bỏ cả lệnh.
- **Vì sao phải lùi ra sau khi trả hàng** — ô trả hàng nằm trong làn cụt. Xe hạ hàng xong mà đứng nguyên tại chỗ thì bịt luôn lối vào của xe kế tiếp.

---

## V. Nghiệp vụ & business rule

### V.1 — Ba luật chịu lực

**Slide:**

| | Luật |
|---|---|
| **Lấy hàng** | Chỉ được lấy kiện ngoài cùng — mọi ô nằm giữa nó và miệng làn phải trống. |
| **Trả hàng** | Lấp từ ô sâu nhất ra: kiện trả sau không chắn kiện trả trước, và xe vừa trả hàng phía trong vẫn đi ra được. |
| **Sạc & đỗ** | Xe dưới ngưỡng pin làm nốt việc đang dở rồi đi sạc, chỉ được thả ra khi vừa đủ pin vừa có nhu cầu. Sạc ở trạm gần nhất còn chỗ; sạc ưu tiên hơn đỗ; chỗ đỗ không lấn vào điểm sạc. |

**Concept:**

- **Business rule** — phát biểu chính sách kho mà người vận hành nói ra được mà không cần biết hệ thống cài đặt thế nào. Những thứ thuộc về cách xây phần mềm (cửa sổ gộp lệnh, tham số bộ giải) không nằm ở đây.
- **Vì sao chỉ ba luật này lên slide** — chúng sinh ra từ hình học kho và từ tài nguyên hữu hạn, tức là từ hiện thực vật lý. Các luật còn lại trong đặc tả là kiểm tra đầu vào thông thường (điểm lấy phải đúng loại, không huỷ được lệnh đã kết thúc, một lệnh một xe) — đúng nhưng không đặc thù cho bài toán này.
- **Một luật đáng để dành cho phần hỏi đáp** — xe bị loại khỏi điều phối **vẫn là vật cản**. "Bỏ qua khi chia việc" và "không tồn tại trên sàn" là hai chuyện khác nhau; tầng tránh va chạm vẫn phải thấy chiếc xe đó.

---

### V.2 — Hai luật hình học kho

**Slide:**

Hàng trong kho không xếp rời rạc, mà xếp thành **làn**. Điều đó sinh ra hai luật ngược chiều nhau:

| | Lấy hàng (BR-10) | Trả hàng (BR-11) |
|---|---|---|
| Luật | Ngoài trước, trong sau | Sâu trước, nông sau |
| Vì sao | Xe không với qua kiện ngoài để lấy kiện trong | Trả vào ô nông trước thì kiện đó chắn mất ô sâu |
| Áp ở đâu | Khi xét một lệnh có được phát đi hay không | Khi chốt ô trả cụ thể, ngay trước lúc xe vào làn |
| Không thoả thì | Lệnh bị giữ ở trạng thái *bị chặn*, kèm lý do | Chọn ô khác, hoặc báo hết chỗ |

Hai luật này là lý do **WES phải tự chọn ô trả** thay vì nhận sẵn từ trên: chỉ WES mới biết ô nào trong khu vực đang trống và ô nào sẽ bị chắn.

**Concept:**

- **Làn** — dãy ô xếp hàng nối tiếp nhau, chỉ có một miệng ra vào. Xe vào lấy hoặc trả rồi phải lùi ra theo đúng lối đã vào.
- **Vì sao BR-10 giải thích con số ở mục II** — thời gian "chờ được gán xe" gộp cả quãng lệnh nằm chờ đúng luật này. Kiện nằm trong chờ kiện ngoài được dọn đi là hành vi đúng, không phải hệ thống chậm.
- **Vì sao BR-11 khó hơn nó trông** — quyết định không thể chốt lúc tạo lệnh, vì từ lúc tạo tới lúc xe tới nơi, các xe khác đã trả thêm hàng vào khu vực đó. Ô phải được chốt ở thời điểm muộn nhất có thể, và phải khoá lại để hai xe không cùng nhắm một ô.

---

### V.3 — Vòng đời pin và chỗ đỗ

**Slide:**

Hai ngưỡng pin, và một vòng đời khép kín:

```
   pin ≤ ngưỡng nguy cấp   →   làm nốt việc đang dở   →   đi sạc
                                                            │
        được thả ra khi ĐỦ PIN  ─ và ─  CÓ NHU CẦU  ◄───────┘
                                          │
              có lệnh chờ ──────► nhận việc
              xe khác nguy cấp ──► nhường chỗ sạc, ra chỗ đỗ
              không có gì ───────► sạc tiếp tới đầy, rồi ra chỗ đỗ
```

Ba luật đi kèm:

- Sạc ở trạm **gần nhất còn chỗ**, và chỗ đó được giữ để hai xe không cùng tới (BR-13).
- Xe đang trên đường về chỗ đỗ mà tụt xuống ngưỡng nguy cấp thì **quay sang đi sạc** (BR-14).
- Xe rảnh về đỗ ở chỗ **không phải điểm sạc** — điểm sạc để dành cho việc sạc (BR-15).

**Concept:**

- **"Đủ pin" chưa đủ để rời trạm** — phải có thêm nhu cầu. Nếu thả xe ra ngay khi đủ pin mà không ai cần, xe chỉ đi lòng vòng rồi lại quay về, đúng kiểu dao động đã đo được ở mục II.
- **Nhường chỗ sạc thì đi đỗ, không đi làm việc** — xe vừa nhường chỗ là xe pin còn thấp; giao việc ngay cho nó thì lát nữa lại phải gọi đi sạc.
- **Vì sao chỗ đỗ tránh điểm sạc** — điểm sạc là tài nguyên hiếm. Một xe đầy pin đỗ lì ở đó sẽ chặn một xe đang cạn pin.

---

## VI. Bài toán 1 — Gán xe (Assignment)

## VII. Bài toán 2 — Định tuyến đa xe (Routing / MAPF)

## VIII. Bài toán 3 — Vòng đời xe: sạc & đỗ

## IX. Demo

## X. Kết quả & hạn chế

## XI. Hướng phát triển (Future works)

## XII. Kết luận

## XIII. Phụ lục — slide dự phòng Q&A
