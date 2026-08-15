# Khảo sát giao diện & đặc tả WES — phục vụ slide bảo vệ

Nguồn: `wes-client/src/` (mã nguồn giao diện), `wes/report/r6-assets/` (36 ảnh chụp thật),
`wes/report/specs/report1-vision-scope.md`, `wes/report/specs/report3-srs.md`.

Quy ước: mỗi mục có một câu mô tả cho người không chuyên. Phần "truy vết" ghi đường dẫn
file để kiểm chứng. Chỗ nào chưa mở file/ảnh để xác nhận thì ghi rõ **chưa xác minh**.

---

## 1. Bảng màn hình ↔ chức năng

### 1.1 Cấu trúc điều hướng

Phần mềm là một trang quản trị web duy nhất, chia hai nhóm menu bên trái:
**Vận hành** và **Quản trị**; dưới cùng là thanh trạng thái kết nối tới hệ thống
điều khiển xe, trên cùng bên phải là chuông thông báo và menu tài khoản.

| Nhóm | Màn hình | Đường dẫn | Ai vào được |
|---|---|---|---|
| — (chưa đăng nhập) | Đăng nhập | `/login` | mọi người |
| — | Quên mật khẩu | `/forgot-password` | mọi người |
| — | Đặt lại mật khẩu qua liên kết email | `/reset-password?token=…` | người có liên kết |
| Vận hành | Bảng điều khiển | `/dashboard` | quản trị + nhân viên vận hành |
| Vận hành | Yêu cầu vận chuyển | `/cargo` | quản trị (xem mục 1.7) |
| Vận hành | Đội AGV | `/fleet` | quản trị |
| Quản trị | Bản đồ kho | `/map` | quản trị |
| Quản trị | Người dùng & Quyền | `/admin/users` | quản trị |
| Tài khoản | Hồ sơ / Bảo mật / Tùy chọn | `/account`, `/account/security`, `/account/preferences` | mọi tài khoản |

Truy vết: `wes-client/src/App.tsx` (khai báo đường dẫn),
`wes-client/src/components/AppShell.tsx` (menu `NAV`, phân quyền, thanh trạng thái).

### 1.2 Bảng điều khiển (Dashboard)

Một câu: *màn hình mở đầu ca làm, cho biết hôm nay kho chạy tốt hay không — bao nhiêu
đơn xong, bao nhiêu hỏng, chờ bao lâu, xe đang làm gì.*

| Thành phần | Nội dung |
|---|---|
| Chọn kỳ | Hôm nay / 24 giờ qua / 7 ngày qua + nút Làm mới; tự cập nhật mỗi 15 giây |
| 6 ô số lớn | Yêu cầu hoàn thành (kèm tỉ lệ thành công); Tỉ lệ thất bại (kèm số lỗi/số hủy); Thời gian vận chuyển trung bình; Thời gian chờ được gán xe trung bình; Số AGV đang chạy lệnh (kèm số xe trực tuyến / đã đăng ký); Số yêu cầu đang xử lý (kèm số đang bị chặn) |
| Biểu đồ sản lượng | Số đơn giao xong theo từng giờ (hoặc từng ngày); có nút chuyển sang dạng bảng |
| Thẻ "Hàng đợi yêu cầu" | Đếm theo trạng thái: Mới tạo, Chờ gán xe, Bị chặn, Đang lấy hàng, Đang giao |
| Thẻ "Đội AGV" | Đếm theo trạng thái xe: Đang chạy lệnh, Rảnh, Đang sạc, Lỗi, Đã đăng ký |
| Cảnh báo | Băng vàng khi mất kết nối hệ thống điều khiển — số liệu đội xe khi đó không khả dụng |

Truy vết: `wes-client/src/features/dashboard/DashboardView.tsx`,
`wes-client/src/types/dashboard.ts`, `wes-client/src/api/dashboard.ts`.

### 1.3 Yêu cầu vận chuyển

Một câu: *nơi tạo và theo dõi từng kiện hàng cần chuyển, và xem hệ thống đã chọn xe nào,
vì sao chọn xe đó.*

| Thành phần | Nội dung |
|---|---|
| Danh sách | Bảng: mã hàng, điểm lấy (kèm tên vị trí lấy), vị trí trả, trạng thái công việc, trạng thái hàng, xe được gán, thời gian tạo, nút xóa |
| Tìm & lọc | Ô tìm kiếm (trễ 300 ms), bộ lọc theo trạng thái công việc, thêm mục lọc gộp **"Hàng đợi điều phối"** (yêu cầu đang chờ xe + yêu cầu bị chặn) |
| Phân trang | 20 dòng/trang (riêng chế độ hàng đợi lấy tới 200 dòng, không phân trang) |
| Lý do bị chặn | Hiển thị ngay dưới trạng thái, và có băng cam riêng trong ngăn chi tiết |
| Ngăn chi tiết (trượt phải) | Tab **Tổng quan**: điểm lấy, vị trí lấy hàng, vị trí trả, xe được gán, thời gian tạo, thời gian đã chờ |
| Ngăn chi tiết | Tab **Lý do chọn AGV**: thuật toán đã dùng (Hungarian / greedy), xe được chọn, số yêu cầu ghép cùng mẻ, quãng đường tới điểm lấy, thời điểm ra quyết định, và **phương án thay thế** của thuật toán còn lại để so sánh |
| Tạo yêu cầu | Cửa sổ "Tạo hàng mới": mã hàng (tùy chọn), **chọn nhiều điểm lấy cùng lúc** (gom nhóm, có chip), chọn khu trả hàng kèm số ô còn trống / tổng số ô |
| Xóa | Cửa sổ xác nhận, không cho xóa yêu cầu đã hủy |

Truy vết: `wes-client/src/features/cargo/` (`CargoManager.tsx`, `CargoDetailDrawer.tsx`,
`CreateCargoModal.tsx`, `StatusBadges.tsx`), `wes-client/src/types/cargo.ts`,
`wes-client/src/api/cargo.ts`.

### 1.4 Đội AGV

Một câu: *sổ đăng ký xe: khai báo xe, bật/tắt kết nối, xem lịch sử chạy việc và lịch sử
lỗi của từng xe, và biết xe nào hay hỏng nhất.*

Có hai thẻ: **Danh sách AGV** và **Thống kê lỗi**.

| Thành phần | Nội dung |
|---|---|
| Danh sách | Mỗi dòng: tên xe, mã, model, điểm khởi đầu, huy hiệu trạng thái (Rảnh / Đang chạy lệnh / Sạc / Lỗi…), huy hiệu kết nối (Đã kết nối / Không có trong hệ thống điều khiển / Không có dữ liệu) |
| Hành động trên dòng | Kích hoạt hoặc Ngừng kết nối xe; Xem lịch sử; Sửa; Xóa |
| Lọc & tìm | Lọc theo trạng thái xe, tìm theo mã/tên (trễ 300 ms), phân trang |
| Thêm / Sửa xe | Cửa sổ nhập: Code, Tên xe trong hệ thống điều khiển, Model. **Bị khóa khi hệ thống đang ở chế độ Vận hành** |
| Cảnh báo | Băng vàng khi không liên lạc được hệ thống điều khiển |
| Cửa sổ "Chi tiết AGV" | Tab **Lịch sử hoạt động**: mã lệnh, điểm lấy, vị trí trả, giờ bắt đầu/kết thúc, trạng thái; lọc theo khoảng ngày |
| Cửa sổ "Chi tiết AGV" | Tab **Lịch sử lỗi**: thời điểm, phát sinh / đã hết lỗi, mức độ (Lỗi nặng / Cảnh báo), tên lỗi thiết bị, điểm đang đứng, mã lệnh liên quan |
| Thống kê lỗi | Bảng xếp hạng 10 xe hỏng nhiều nhất theo kỳ 24 giờ / 7 ngày / 30 ngày, kèm số lần lỗi và lần lỗi gần nhất, bấm sang thẳng lịch sử lỗi của xe đó |

Truy vết: `wes-client/src/features/agv/` (`AgvFleet.tsx`, `AgvFormModals.tsx`,
`AgvHistoryModal.tsx`, `HighErrorAgvs.tsx`, `AgvBadges.tsx`),
`wes-client/src/api/agvs.ts`, `wes-client/src/types/agv.ts`.

### 1.5 Bản đồ kho

Một câu: *bản đồ sống của nhà kho — nạp bản đồ, khoanh khu vực lấy/trả hàng, và xem xe
chạy theo thời gian thực.*

Bốn khu vực làm việc: **Quản lý**, **Debug**, và hai màn hình con mở từ Quản lý là
**Xem vận hành** và **Khu vực**.

**(a) Quản lý bản đồ** — thẻ bản đồ đang dùng (tên, số điểm, số đường, số xe, tên file và
giờ tải lên), vùng kéo–thả file XML để thay bản đồ, nút tải lên. Khi hệ thống đang Vận hành
thì chặn thay bản đồ và hiện băng nhắc chuyển sang chế độ Thiết kế.
Truy vết: `wes-client/src/features/map/MapManageTab.tsx`, `wes-client/src/api/maps.ts`.

**(b) Xem vận hành (bản đồ trực tiếp)** — chi tiết ở mục 1.6.

**(c) Khu vực (Zone)** — cùng khung bản đồ nhưng ở chế độ chọn điểm; sổ bên phải liệt kê
các khu vực của bản đồ đang tải (tên, màu, loại Lấy hàng/Trả hàng, số điểm), các khu vực
chưa gán bản đồ và khu vực của bản đồ khác. Có nút **Đồng bộ bản đồ này** (đối chiếu khu vực
với bản đồ đang chạy, đánh dấu khu vực đã lạc hậu), **Gán vào bản đồ này**, đổi màu, xóa.
Truy vết: `wes-client/src/features/map/MapZoneTab.tsx`, `MapZoneSidebar.tsx`,
`useZoneManagement.ts`, `wes-client/src/features/zones/CreateZoneModal.tsx`,
`wes-client/src/api/zones.ts`.

**(d) Debug** — ảnh chụp thô trạng thái hệ thống điều khiển: danh sách xe kèm trạng thái
kỹ thuật (state / procState / mức tích hợp / vị trí / tạm dừng) và danh sách lệnh vận chuyển
đang chạy kèm từng chặng, có nút thu hồi lệnh.
Truy vết: `wes-client/src/features/map/MapDebugTab.tsx`, `MapDebugWidgets.tsx`.

### 1.6 Bản đồ trực tiếp — vẽ gì, làm được gì

Vẽ bằng canvas (thư viện react-konva), nhiều lớp chồng nhau để xe chạy mượt mà nền bản đồ
không phải vẽ lại.

**Hiển thị:**

| Đối tượng | Cách thể hiện |
|---|---|
| Lưới nền | Lưới ô vuông theo bước điểm của bản đồ |
| Điểm dừng (HALT) | Chấm tròn xanh dương |
| Điểm đỗ (PARK) | Chấm tròn cam |
| Điểm sạc | Chấm tròn xanh lá có biểu tượng tia sét |
| Đường đi | Đoạn nối kèm mũi tên chỉ chiều cho phép |
| Vị trí lấy hàng / trả hàng | Ô vuông xanh lá / đỏ; ô thuộc khu vực được tô theo màu khu vực đó |
| Xe AGV | Hình thân xe có tên, xoay theo hướng thật; màu theo trạng thái: Rảnh, Đang chạy, Sạc pin, Lỗi, Không nhận lệnh |
| Vùng chiếm chỗ của xe | Khung thân xe 840 × 500 mm; xe đang chở hàng và đang xoay thì vẽ vòng tròn quét Ø 1131 mm; **hai vùng chồng nhau thì đổi màu báo va chạm** |
| Ô/đoạn xe đang giữ | Tô riêng các tài nguyên hệ thống điều khiển đã cấp cho xe |
| Hàng hóa | Thanh màu: hàng chờ lấy, hàng đang trên AGV, hàng đã trả |
| Chú thích | Bảng "Chú thích" bật/tắt, liệt kê đủ ký hiệu ở trên |

**Tương tác:**

- Kéo để di chuyển bản đồ; lăn chuột để phóng to/thu nhỏ; ba nút Phóng to / Thu nhỏ / Vừa
  màn hình; ô hiển thị mức phóng hiện tại (ví dụ 0,17x).
- Rê chuột lên điểm hoặc vị trí → hiện chú thích tên điểm và các vị trí gắn với nó.
- Bấm chọn điểm / đường / vị trí → bảng thông tin (toạ độ X, Y theo mét, các điểm liên kết,
  khu vực chứa nó).
- Bấm chọn xe → **bảng điều khiển xe**: tên, trạng thái, phần trăm pin, vị trí, mức kết nối,
  danh sách lỗi đang có, và trạng thái nhận việc với ba hành động **Ngừng nhận việc / Bỏ qua /
  Cho nhận việc lại**; nếu xe đang chạy lệnh thì cảnh báo "sẽ bị loại sau khi hoàn tất".
- **Thanh cảnh báo xe**: danh sách xe đang lỗi hoặc cảnh báo, bấm vào là nhảy tới xe đó.
- **Sổ bên phải ba thẻ**: *Hàng* (danh sách hàng trên bản đồ, xóa được), *Xe* (chọn nhiều xe
  bằng ô tick rồi bật/tắt nhận việc hàng loạt), *Khu vực* (danh sách khu vực). Thu gọn được
  thành dải biểu tượng.
- Nút **Tạo cargo** ngay trên bản đồ, mở cùng cửa sổ tạo yêu cầu của màn hình Yêu cầu vận chuyển.
- Ở chế độ **Khu vực**: bấm từng điểm để chọn, hoặc **kéo khung chọn nhiều điểm một lúc**
  (khung nét đứt xanh), rồi mở cửa sổ tạo khu vực (tên, loại Lấy/Trả hàng, màu, danh sách
  điểm thành viên chỉnh sửa được).

**Cập nhật thời gian thực:** vị trí xe nhận qua luồng sự kiện đẩy từ máy chủ (SSE) và gom
theo khung hình để không giật; danh sách hàng và khu vực làm mới mỗi 5 giây; trạng thái hệ
thống điều khiển mỗi 10 giây.

Truy vết: `wes-client/src/features/map/MapCanvas.tsx`, `useMapShapes.tsx`,
`useMapCanvasInteractions.ts`, `VehicleShapes.tsx`, `VehicleFootprintShapes.tsx`,
`vehicleFootprint.ts`, `CargoShapes.tsx`, `MapCanvasPanels.tsx`, `VehicleControlPanel.tsx`,
`VehicleAlertBar.tsx`, `MapSidePanel.tsx`, `MapVehiclePanel.tsx`, `useVehicleTracking.ts`,
`queries.ts`.

### 1.7 Người dùng & Quyền

Một câu: *quản trị viên tạo tài khoản cho nhân viên, đổi vai trò, khóa/mở khóa và đặt lại
mật khẩu.*

| Thành phần | Nội dung |
|---|---|
| Danh sách | Ảnh đại diện, tên, email, vai trò, trạng thái (Đang hoạt động / Bị khóa / Đã mời / Ngừng hoạt động), lần hoạt động gần nhất |
| Tìm & lọc | Tìm theo tên/tên đăng nhập/email; lọc theo vai trò và theo trạng thái |
| Thêm người dùng | Họ tên, tên đăng nhập, điện thoại, email, vai trò (Quản trị viên / Nhân viên vận hành), ca làm–bộ phận, công tắc "Gửi email mời kích hoạt tài khoản" |
| Ngăn chi tiết | Thông tin liên hệ, ca làm, ngày tạo, lý do khóa (nếu có); các nút Sửa, Đổi vai trò, Đặt lại mật khẩu, Khóa/Mở khóa/Kích hoạt; khu "vùng nguy hiểm" để ngừng hoạt động tài khoản |
| Tab Quyền | Bảng đối chiếu vai trò ↔ nhóm quyền (đội xe, bản đồ, yêu cầu, điều phối, bảng điều khiển, người dùng, nhật ký) với ba mức: toàn quyền / chỉ xem / không |

Truy vết: `wes-client/src/features/usersAdmin/` (`UsersAdmin.tsx`, `modals.tsx`,
`Permissions.tsx`), `wes-client/src/data/permissions.ts`, `wes-client/src/api/adminUsers.ts`.

> **Điểm lệch cần biết trước khi lên slide:** bảng quyền tĩnh (`data/permissions.ts`) ghi
> nhân viên vận hành *toàn quyền* với Yêu cầu vận chuyển và *chỉ xem* đội xe/bản đồ, nhưng
> mã điều hướng thực tế (`AppShell.tsx`, hằng `OPERATOR_VIEWS`) chỉ cho nhân viên vận hành
> vào Bảng điều khiển và Tài khoản. Nếu slide nói "phân quyền hai vai trò" thì nên nói theo
> hành vi thật, hoặc kiểm tra lại phía máy chủ. **Chưa xác minh** phía máy chủ.

### 1.8 Tài khoản của tôi

Một câu: *nhân viên tự sửa hồ sơ, đổi mật khẩu và chỉnh tùy chọn hiển thị mà không cần nhờ
quản trị viên.*

- **Hồ sơ:** ảnh đại diện (PNG/JPG/WebP, tối đa 5 MB), họ tên, liên hệ, ca làm.
- **Bảo mật:** đổi mật khẩu với **thanh đo độ mạnh** (Yếu → Mạnh) và ba điều kiện hiện rõ:
  ít nhất 8 ký tự, có chữ số, có chữ hoa & chữ thường; chặn đặt lại trùng mật khẩu cũ.
- **Hiển thị & ngôn ngữ:** chuyển **tiếng Việt / tiếng Anh**, bật/tắt thông báo trong ứng
  dụng, bật/tắt âm thanh cảnh báo.

Truy vết: `wes-client/src/features/account/` (`AccountArea.tsx`, `AccountPanels.tsx`),
`wes-client/src/i18n.ts`, `wes-client/src/api/account.ts`.

### 1.9 Đăng nhập & khôi phục mật khẩu

Một câu: *cổng vào hệ thống, có luồng quên mật khẩu gửi liên kết qua email.*

- Đăng nhập bằng tên đăng nhập + mật khẩu, có ô "ghi nhớ", phiên lưu bằng thẻ truy cập.
- Quên mật khẩu: nhập email; **luôn hiện cùng một thông báo thành công dù email có tồn tại
  hay không** (chống dò tài khoản).
- Đặt lại mật khẩu bằng liên kết có mã thời hạn.
- Màn hình đăng nhập song ngữ Việt/Anh.

Truy vết: `wes-client/src/features/auth/AuthScreens.tsx`, `wes-client/src/api/auth.ts`.

> Lưu ý: ba con số ở cột trái màn hình đăng nhập (142 AGV trực tuyến, 99,2% thời gian hoạt
> động, 3 ca/ngày) là **số trang trí cố định trong mã nguồn**, không phải dữ liệu thật —
> đừng trích lên slide như một kết quả đo.

### 1.10 Công tắc chế độ hệ thống (nằm ở thanh menu trái)

Một câu: *một công tắc lớn để chuyển kho giữa "đang thiết kế" (sửa bản đồ, sửa xe) và "đang
vận hành" (nhận và chạy lệnh), kèm cảnh báo hậu quả.*

- Chấm màu + nhãn: Mất kết nối (đỏ) / Đang vận hành (xanh) / Đang thiết kế (vàng).
- Chỉ quản trị viên thấy nút chuyển chế độ; có cửa sổ xác nhận nêu rõ: chuyển sang Thiết kế
  sẽ **dừng toàn bộ lệnh đang chạy**, còn chuyển sang Vận hành thì **không sửa được bản đồ và
  cấu hình xe nữa**.

Truy vết: `wes-client/src/components/AppShell.tsx` (`KernelBar`, `SwitchModeModal`),
`wes-client/src/api/maps.ts`.

---

## 2. Bảng ảnh chụp ↔ tính năng

36 ảnh giao diện thật (1920×1080) nằm ở `wes/report/r6-assets/`. `image1.png` là logo trường,
không phải ảnh giao diện.

Cột **Đã mở** = đã xem ảnh gốc toàn màn hình để xác nhận. Các dòng còn lại đọc từ ảnh tổng hợp
`_contact.jpg` — nội dung màn hình đúng, nhưng chi tiết nhỏ **chưa xác minh**.

| Ảnh | Màn hình / tính năng minh hoạ | Đã mở |
|---|---|---|
| image1.png | Logo Đại học FPT (không phải ảnh giao diện) | ✔ |
| image2.png | **Bảng điều khiển** kỳ 24 giờ: 6 ô KPI, biểu đồ sản lượng theo giờ, hai thẻ hàng đợi & đội AGV | ✔ |
| image3.png | **Yêu cầu vận chuyển** + ngăn chi tiết mở, thấy rõ hai tab *Tổng quan* / *Lý do chọn AGV* | ✔ |
| image4.png | **Bản đồ trực tiếp**: 7 xe có nhãn tên, điểm HALT/PARK, điểm sạc, mũi tên chiều đường, bảng Chú thích đầy đủ, sổ Hàng bên phải, mức phóng 0,17x | ✔ |
| image5.png | Đội AGV + cửa sổ **Thêm AGV** | |
| image6.png | **Lịch sử lỗi AGV**: mốc thời gian phát sinh/hết lỗi, mức Cảnh báo, tên lỗi thiết bị, điểm đứng, mã lệnh | ✔ |
| image7.png | Tài khoản của tôi — tab **Bảo mật** (đổi mật khẩu) | |
| image8.png | **Danh sách Đội AGV**: huy hiệu trạng thái + kết nối, nút Kích hoạt/Ngừng kết nối, Xem lịch sử, phân trang 17 AGV | ✔ |
| image9.png | Người dùng & Quyền + menu hành động trên dòng | |
| image10.png | Yêu cầu vận chuyển + cửa sổ **Tạo hàng mới** | |
| image11.png | **Màn hình đăng nhập** | |
| image12.png | Bảng điều khiển (kỳ khác) | |
| image13.png | Bảng điều khiển kỳ **7 ngày** (2.041 đơn, 0,2% thất bại) | |
| image14.png | Cửa sổ **Chi tiết AGV → Lịch sử hoạt động**: mã lệnh, điểm lấy, vị trí trả, giờ bắt đầu/kết thúc, lọc theo ngày | ✔ |
| image15.png | Yêu cầu vận chuyển — danh sách | |
| image16.png | Đội AGV + cửa sổ **Sửa AGV** | |
| image17.png | Tạo hàng mới — đang mở danh sách **khu trả hàng kèm số ô còn trống** | |
| image18.png | **Bản đồ toàn kho thu nhỏ (0,02x)**: thấy trọn hai dãy khu vực tô màu và cả đội xe | ✔ |
| image19.png | Bản đồ trực tiếp — nhiều xe trên trục chính | |
| image20.png | Màn hình đăng nhập | |
| image21.png | Yêu cầu vận chuyển — đang tìm kiếm | |
| image22.png | **Quản lý bản đồ**: thẻ bản đồ đang dùng (611 điểm, 912 đường, 15 xe) + vùng kéo–thả XML + nút tải lên | ✔ |
| image23.png | Đội AGV — danh sách | |
| image24.png | Yêu cầu vận chuyển — bộ lọc **"Hàng đợi điều phối"** và trạng thái rỗng | ✔ |
| image25.png | **Quản lý Khu vực**: bản đồ tô màu theo khu + sổ khu vực (Đồng bộ bản đồ, khu chưa gán, số điểm mỗi khu) | ✔ |
| image26.png | Yêu cầu vận chuyển + Tạo hàng mới | |
| image27.png | Đội AGV + Thêm AGV | |
| image28.png | **Thống kê lỗi**: xếp hạng 10 AGV lỗi nhiều nhất theo 24h/7d/30d | ✔ |
| image29.png | Tài khoản — Bảo mật | |
| image30.png | Tài khoản — **Hồ sơ cá nhân** | |
| image31.png | Người dùng & Quyền + cửa sổ **Thêm người dùng mới** (vai trò, ca làm, gửi email mời) | ✔ |
| image32.png | Yêu cầu vận chuyển — danh sách | |
| image33.png | Tạo hàng mới — đang mở danh sách **điểm lấy hàng** | |
| image34.png | Tài khoản — **Hiển thị & ngôn ngữ** (đổi Việt/Anh, thông báo, âm thanh) | |
| image35.png | Bảng điều khiển | |
| image36.png | **Bản đồ kho → Debug**: 15 xe kèm trạng thái kỹ thuật + lệnh vận chuyển đang chạy, có nút thu hồi | ✔ |
| image37.png | Người dùng & Quyền — danh sách | |

Ảnh trùng nội dung (chọn một là đủ): {2, 12, 35} dashboard · {11, 20} đăng nhập ·
{10, 17, 26, 33} tạo hàng · {5, 27} thêm AGV · {8, 23} danh sách AGV ·
{15, 21, 32} danh sách yêu cầu · {9, 37} người dùng · {4, 19} bản đồ trực tiếp ·
{7, 29} bảo mật.

---

## 3. Danh sách Major Feature theo đặc tả

Nguồn: `wes/report/specs/report1-vision-scope.md` §4.1 (Bảng I-8, dòng 250-261) và
`wes/report/specs/report3-srs.md` (nhóm use case, dòng 154-249).
**Hai tài liệu viết hoàn toàn bằng tiếng Anh.**

SRS không có bảng "Major Features" riêng — nó dùng lại đúng 8 feature của Report 1, đặt
thành 7 nhóm use case (FE-08 cố ý không có use case nào).

| ID | Tên | Một câu cho người không chuyên | Nhóm UC trong SRS | Số UC | Gap |
|---|---|---|---|---|---|
| **FE-01** | AGV Fleet Management | Sổ đăng ký xe: khai báo xe, đặt ngưỡng pin, cho phép hoặc cấm xe nhận việc, và luôn biết xe đang ở trạng thái nào | AGV-FM | 16 | GAP-01 |
| **FE-02** | Warehouse Map & Topology Management | Nạp bản đồ kho vào hệ thống và khoanh vùng đâu là chỗ lấy hàng, đâu là chỗ trả hàng | WMT | 12 | GAP-02 |
| **FE-03** | Transport Request Management | Vòng đời một yêu cầu chuyển hàng, từ lúc tạo tới lúc giao xong hoặc bị hủy | TR | 17 | GAP-03 |
| **FE-04** | Dispatch Orchestration & Release Control | Bộ não chọn xe: quyết định lúc nào thả việc ra và giao việc nào cho xe nào, sao cho tổng quãng đường chạy rỗng là ít nhất | DOR | 7 | GAP-04 |
| **FE-05** | Operational Monitoring Dashboard | Màn hình theo dõi: bản đồ xe chạy thời gian thực cộng với các chỉ số hiệu quả của cả ca làm | OMD | 14 | GAP-05 |
| **FE-06** | User & Access Management | Ai được vào hệ thống và được làm gì — đăng nhập, phân vai trò, khóa tài khoản, đặt lại mật khẩu | UAM | 16 | GAP-06 |
| **FE-07** | Event Log & Audit Trail | Nhật ký: mọi thay đổi trạng thái việc, trạng thái xe và mọi thao tác người dùng đều được ghi lại để truy nguyên | LOG | 5 | GAP-07 |
| **FE-08** | Multi-Agent Traffic Coordination (tầng FMS) | Thay bộ tìm đường "mỗi xe một mình" của openTCS bằng bộ lập kế hoạch cho **cả đội cùng lúc**, để đường chồng nhau và tình huống đối đầu được gỡ **trước khi** xe nhận lệnh chạy | *(không có)* | **0** | GAP-04 |

**Tổng 87 use case.** Dãy số UC có lỗ là do xóa có chủ ý, không phải thiếu dữ liệu:
UC 19-30 (bỏ chức năng sửa topology — việc đó làm ở Model Editor của openTCS),
UC 49-50 (bỏ khi hàng không hợp lệ chuyển sang từ chối ngay, không lưu bản ghi),
UC 67 (gộp vào UC 82), UC 100-103 và **UC 109 xuất nhật ký** (đã xóa 04/08/2026).
UC 40, 41 **chưa xác minh** lý do.

Bảy khoảng trống nghiệp vụ (GAP-01…GAP-07) tương ứng bảy điểm đau đã khảo sát ở Aubot:
quản lý thời gian chết của đội xe; lệch giữa bản đồ lý tưởng và ràng buộc vật lý; điều phối
thủ công; tắc nghẽn/deadlock sau khi gán xe; mù thông tin lúc cao điểm; can thiệp tay không
kiểm soát; thiếu vết truy nguyên.

### 3.1 Bảy actor (SRS dòng 140-148)

Operator · Admin · **Máy quét mã vạch / app cầm tay** · **FMS (openTCS)** · **Gmail** ·
**AGV** · **System** (chính hệ thống tự hành động: hẹn giờ, sự kiện kernel, chu kỳ điều phối).
Câu đáng nhớ trong đặc tả: *"Bộ điều phối mặc định của openTCS đã bị WES tiếp quản."*

---

## 4. Phạm vi và giới hạn đã cam kết

### 4.1 Trong phạm vi

Tám Major Feature ở mục 3. Điểm chốt về ranh giới trách nhiệm (OR-06):
**WES chọn xe rồi gửi lệnh kèm chỉ định xe cụ thể; openTCS không tự chọn xe, chỉ lo tìm
đường và điều khiển phần cứng.**

### 4.2 Ngoài phạm vi — tuyên bố rõ trong Report 1 §4.2 (Bảng I-9)

> Bảng này bị **rỗng trong bản `.md`** do lỗi đồng bộ (ô nằm trong `w:sdtContent`); nội dung
> dưới đây khôi phục từ `wes/report/specs/.cache/report1-vision-scope.docx`.

**Giới hạn chức năng**

| ID | Không làm | Lý do |
|---|---|---|
| **LI-01** | Nhiều tầng, nhiều kho; đội xe quá 20 chiếc | Chỉ tập trung một tầng, **tối đa 20 AGV chạy đồng thời** |
| **LI-02** | Bản địa hóa tiếng Việt và các ngôn ngữ khác | Hạn chế thời gian; *"giao diện chỉ có tiếng Anh"* — **xem cảnh báo mâu thuẫn bên dưới** |
| **LI-03** | ERP, kế toán, tài chính, tích hợp tồn kho hai chiều | Đây là tầng thực thi, không phải bộ quản trị doanh nghiệp; chỉ đọc dữ liệu tồn kho |
| **LI-04** | Dự báo nhu cầu bằng AI | Điều phối phải **đoán trước được**, nên dùng luật tất định |
| **LI-05** | Digital Twin thật và mô phỏng 3D vật lý | Chỉ dùng **biểu diễn 2D logic** của bản đồ kho |

**Giới hạn kỹ thuật**

| ID | Không làm | Lý do |
|---|---|---|
| **LI-06** | Triển khai và kiểm thử trên AGV thật | Kiểm thử trong **môi trường mô phỏng** (plant model openTCS + xe ảo VDA5050, quan sát qua chính bản đồ 2D của hệ thống) |
| **LI-07** | Chế tạo phần cứng, firmware, cánh tay gắp | WES thuần **phần mềm** |
| **LI-08** | SLAM bằng camera, dẫn đường thị giác, né vật cản động | Giao cho **cảm biến trên xe** |
| **LI-09** | Viết adapter riêng cho AGV giao thức độc quyền | Giả định nhà cung cấp AGV có sẵn giao diện **REST hoặc MQTT tương thích openTCS SDK** |

> ⚠️ **Mâu thuẫn tài liệu phải chốt trước khi lên slide:** LI-02 nói giao diện *chỉ có tiếng
> Anh*, còn **OR-04 trong SRS §5.3** nói *ngôn ngữ mặc định là **tiếng Việt**, lưu theo từng
> người dùng*. **Thực tế mã nguồn theo OR-04**: quy ước bắt buộc toàn bộ chữ trên giao diện
> là tiếng Việt, và có công tắc đổi Việt/Anh (`wes-client/CLAUDE.md`, `wes-client/src/i18n.ts`).
> Kết luận nên dùng: **LI-02 đã lỗi thời, sản phẩm giao ra là tiếng Việt có kèm tiếng Anh.**

### 4.3 Yêu cầu phi chức năng (SRS §II.4, dòng 1954-2023)

Đặc tả **không đánh mã kiểu NFR-01**; các yêu cầu xếp theo nhóm. Nếu slide cần mã thì phải tự đặt.

**Dễ dùng** — Operator học **≤ 30 phút**, Admin **≤ 2 giờ**; **mọi thao tác phá hủy phải có
hộp xác nhận**; cấm hiện thông báo rỗng hay lỗi thô; chạy tốt từ độ phân giải 1280×720 trên Chrome.

**Hiệu năng** — đồng bộ trạng thái xe **≤ 2 giây**; API đọc **≤ 1 giây**; từ lúc yêu cầu vào
hàng đợi tới lúc gửi lệnh cho FMS **≤ 5 giây**; nạp chỉ số bảng điều khiển **≤ 3 giây**; đẩy
vị trí xe lên trình duyệt **≤ 1 giây**; chịu tối thiểu **20 AGV và 50 yêu cầu đồng thời**.

**An toàn** — thẻ truy cập JWT hạn 15 phút; thẻ làm mới hạn 7 ngày, **lưu dạng băm SHA-256**
(cấm lưu nguyên văn) và **xoay vòng mỗi lần làm mới**, gửi qua cookie httpOnly; mật khẩu băm
bcrypt 10 vòng; liên kết đặt lại mật khẩu hạn 30 phút, **dùng một lần**; **chống dò tài khoản**
(luôn trả cùng một kết quả); phân quyền ADMIN/OPERATOR chặn ở từng endpoint, sai quyền trả 403;
ba cờ tài khoản (bị khóa / đang hoạt động / mới được mời); **đổi mật khẩu là thu hồi hết phiên
trên mọi thiết bị**; mỗi lần đăng nhập ghi lại **IP và trình duyệt**; sai nhiều lần thì khóa
**30 phút** (MSG-29).

**Tin cậy** — bộ điều phối phải đạt **≥ 99,5%** thời gian hoạt động trong giờ kho chạy; mất
kết nối FMS thì hiện "đồng bộ lần cuối lúc …" chứ không sập; thu hồi lệnh thất bại thì thử lại
**tối đa 3 lần theo cấp số nhân**, vẫn hỏng thì báo quản trị viên và **giữ nguyên trạng thái
việc**; **nhật ký kiểm toán phải ghi xong TRƯỚC KHI** trả kết quả thành công về máy khách.

**Tương thích** — Chrome bản mới; tối thiểu 1280×720, **không bắt buộc chạy trên điện thoại**;
PostgreSQL; openTCS **bản fork tùy biến**.

**Yêu cầu khác (OR)** — giữ nhật ký kiểm toán **180 ngày** (OR-02); ngôn ngữ mặc định tiếng
Việt (OR-04); nhật ký phải ghi **giá trị trước/sau của từng trường** (OR-05); WES bắt buộc chỉ
định xe, không lo tìm đường (OR-06); **chờ gộp 1,5 giây** sau khi tạo hàng rồi mới chạy chu kỳ
điều phối (OR-07); bộ đệm an toàn `kRobust` của kế hoạch đội xe **hiện đang cố định bằng 0,
tức chưa áp dụng đệm** (OR-09).

**15 luật nghiệp vụ BR-01…BR-15** — đáng nhớ nhất: một xe chỉ một việc và ngược lại (BR-04,
BR-05); xe bị "bỏ qua" thì **không nhận việc nhưng vẫn là vật cản khi tính đường** (BR-06);
**lấy hàng phải lấy từ ngoài vào trong** (BR-10); **trả hàng phải lấp từ ô sâu nhất ra** (BR-11);
**đi sạc ưu tiên hơn về chỗ đỗ** (BR-14).

---

## 5. Đối chiếu: đặc tả có — giao diện hiện tại chưa có

Đây là phần dễ bị hỏi nhất khi bảo vệ. Kết luận rút từ việc so danh sách use case/màn hình
trong SRS với cây thư mục thật `wes-client/src/features/` và `wes-client/src/api/`.

| Đặc tả yêu cầu | Trạng thái giao diện | Ghi chú |
|---|---|---|
| **Màn hình Dispatch Policy** (UC 61, 62; SRS §3.5 dòng 1832; nằm trong danh sách màn hình admin) | **Không có** trong `wes-client` — không có thư mục tính năng, không có lời gọi API tương ứng | Nên nói thẳng là chưa làm giao diện, tham số điều phối đặt bằng cấu hình |
| **Màn hình Audit Log** (UC 104-108; SRS §3.7 dòng 1915) | **Không có** trong `wes-client` | Nhật ký vẫn được ghi ở phía máy chủ theo OR-05, nhưng chưa có màn hình tra cứu. **Chưa xác minh** phía máy chủ |
| **Tạo yêu cầu từ dữ liệu quét mã** (UC 42, actor Máy quét mã vạch) | Giao diện web chỉ có **tạo tay bằng cách chọn điểm lấy và khu trả** | Luồng quét mã đi thẳng vào API, không qua màn hình web |
| **Cảnh báo nguy cơ deadlock** (UC 68) và **danh sách điểm tắc nghẽn** (UC 82) | Chưa thấy trên bảng điều khiển; bản đồ chỉ có **cảnh báo lỗi xe** và **báo chồng lấn vùng chiếm chỗ** | Nếu lên slide thì mô tả đúng cái đang có |
| **Xem đường đi dự kiến của AGV** (UC 69) | Bản đồ có tô **ô/đoạn xe đang giữ**, chưa thấy vẽ trọn tuyến dự kiến | **Chưa xác minh** |
| **KPI tỉ lệ sử dụng xe** (UC 77) | Bảng điều khiển hiện có 6 ô KPI, **không có ô tỉ lệ sử dụng** | Trùng với ghi chú đã biết: UC 77/82/83 từng bị hoãn |
| Nhân viên vận hành được **toàn quyền với Yêu cầu vận chuyển**, xem được Bản đồ trực tiếp và Cargo (SRS §1.4.2) | Mã điều hướng chỉ cho nhân viên vận hành vào **Bảng điều khiển + Tài khoản** | Xem lại mục 1.7 |

Ngược lại, giao diện có **những thứ đặc tả mô tả rất mờ** nhưng lại rất "ăn ảnh" khi bảo vệ:
tab **Lý do chọn AGV** (đúng UC 70), thẻ **Thống kê lỗi** (UC 83), tab **Debug** kernel,
**vòng tròn quét khi xe xoay Ø1131 mm và cảnh báo va chạm**, **chọn khung nhiều điểm** để lập
khu vực, và **công tắc chế độ Thiết kế ↔ Vận hành** (UC 38).

### 5.1 Lệch đánh số cần lưu ý

- Chú thích trong mã nguồn giao diện ghi *"FE-07"* cho phần tài khoản/đăng nhập
  (`wes-client/src/api/account.ts`, `auth.ts`), nhưng Report 1 định nghĩa **FE-06 = User &
  Access Management**, còn **FE-07 = Event Log & Audit Trail**. Mã nguồn dùng bộ số cũ.
- Cùng chỗ đó ghi *UC-81…UC-86* cho đăng nhập/hồ sơ/đổi mật khẩu, còn SRS hiện hành đánh
  **UC 84…UC 89**. Đừng trích số UC từ mã nguồn lên slide.

### 5.2 Điểm dễ bỏ sót nhất — FE-08 không có màn hình nào

Phần đóng góp thuật toán lớn nhất của đồ án (**lập kế hoạch đường đi cho cả đội bằng LaCAM\*/
PIBT thay cho Dijkstra từng xe**) **cố ý không có use case và không có màn hình** — đặc tả nói
rõ ở `report3-srs.md:249`: nó chạy bên trong kernel, được kích bởi chu kỳ điều phối chứ không
bởi người dùng, và chỉ quan sát gián tiếp qua các màn hình theo dõi. Vì vậy một bộ slide dựng
theo use case hoặc theo màn hình sẽ **bỏ sót trọn phần thuật toán chính**. Bằng chứng phải lấy
từ mục **Non-UI Functions** (SRS §1.4.3, các mục 22-24, 27, 34-37), không phải từ danh sách UC.

Các engine "vô hình" khác cũng nằm ở đó và cũng không có màn hình: **Charge Engine**,
**Parking Engine**, **Lane Safety Guard**, **Corridor Detection**, và đặc biệt
**Dispatch Counterfactual Recorder** — mỗi chu kỳ điều phối giải cùng một ma trận chi phí
**hai lần** (Hungarian và greedy), thi hành một, ghi lại phương án còn lại. Đó chính là nguồn
dữ liệu cho tab "Lý do chọn AGV" ở mục 1.3, và là câu trả lời sẵn sàng cho câu hỏi
"Hungarian hơn greedy bao nhiêu?".
