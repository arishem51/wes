# UC Change Log — SWES SRS (Group 3 & Actors)

Tài liệu này ghi lại các UC cần **thêm mới** và **chỉnh sửa** trong SRS Draft 3,
phát sinh từ phân tích MF-01 (Lấy hàng) và việc làm rõ sự khác biệt giữa
**Cargo (hàng)** và **Transport Request (lệnh vận chuyển)**.

---

## 1. UC cần thêm mới

### 1.1 Nhóm mới: Cargo Management (đề xuất Group 3' hoặc Group 8)

> **Lý do tách nhóm**: Cargo và Transport Request là 2 entity độc lập trong hệ thống.
> Cargo được tạo từ bước quét hàng — đây là tiền điều kiện của Transport Request,
> không phải một bước bên trong Transport Request.
> Xem MF-01 step 1–3 trong `new-mainflow.md`.

| ID     | Use Case              | Actors              | Mô tả |
|--------|-----------------------|---------------------|-------|
| **3.0** | **Scan cargo (Quét hàng)** | Barcode Scanner | Barcode Scanner gọi WES API sau khi quét mã QR vị trí và barcode hàng. WES tự động tạo Cargo entity với source point và destination location. Không tạo Transport Request tại bước này. |
| **3.16** | **Delete cargo (Xóa hàng)** | Admin, Operator | Xóa một Cargo entity khỏi hệ thống. Nếu Cargo đang có Transport Request liên kết (trạng thái Pending hoặc Executing), hệ thống tự động cancel Transport Request đó (gọi openTCS withdrawal API) trước khi xóa. Khác với UC 3.7 (Cancel Transport Request) — 3.7 hủy lệnh nhưng giữ nguyên Cargo. |

---

#### UC 3.0 — Scan cargo (Quét hàng)

| Trường | Nội dung |
|--------|----------|
| **Primary Actor** | Barcode Scanner / Handheld App |
| **Secondary Actor** | WES (system) |
| **Mô tả** | Người quét hàng dùng thiết bị quét mã QR tại vị trí lấy hàng và barcode kiện hàng. Thiết bị gọi WES API. WES validate dữ liệu và tạo Cargo entity. |
| **Preconditions** | - Barcode Scanner đã kết nối với WES API<br>- Source point tồn tại trong Operation Map<br>- Destination location tồn tại trong hệ thống |
| **Postconditions** | Cargo entity được tạo trong WES với trạng thái `CREATED`. Task tương ứng được đưa vào Task Pool. |
| **Normal Flow** | 1. Scanner quét QR vị trí + barcode hàng<br>2. Scanner gọi WES API với payload `{source_point, destination_location, item_code}`<br>3. WES validate source point và destination location<br>4. WES tạo Cargo entity (`status = CREATED`)<br>5. WES tạo Task và đưa vào Task Pool<br>6. WES trả về `201 Created` cho Scanner |
| **Alternative Flows** | **AF-1 (Invalid source point)**: Source point không tồn tại trong Operation Map → WES trả `400 Bad Request`, ghi vào invalid log, không tạo Cargo.<br>**AF-2 (Invalid destination)**: Destination location không tồn tại → tương tự AF-1. |

---

#### UC 3.16 — Delete cargo (Xóa hàng)

| Trường | Nội dung |
|--------|----------|
| **Primary Actor** | Admin, Operator |
| **Secondary Actor** | FMS (openTCS) |
| **Mô tả** | Người dùng xóa một Cargo khỏi hệ thống. Khác với UC 3.7 (cancel lệnh): UC 3.7 chỉ hủy lệnh vận chuyển, còn UC 3.16 xóa chính bản thân kiện hàng. |
| **Preconditions** | - Cargo tồn tại trong hệ thống<br>- Người dùng có quyền xóa |
| **Postconditions** | Cargo bị xóa khỏi hệ thống. Nếu có Transport Request liên kết đang chạy, Transport Request đó bị cancel trước. |
| **Normal Flow** | 1. Người dùng chọn Cargo cần xóa<br>2. Hệ thống kiểm tra có Transport Request liên kết không<br>3a. Nếu **không có** TR liên kết → xóa Cargo trực tiếp<br>3b. Nếu **có** TR ở trạng thái Pending/Executing → auto-cancel TR (gọi openTCS withdrawal API), sau đó xóa Cargo<br>4. Hệ thống xác nhận xóa thành công |
| **Alternative Flows** | **AF-1 (TR đã Completed)**: Transport Request liên kết đã hoàn thành → cho phép xóa Cargo bình thường mà không cần cancel TR. |

---

## 2. UC cần chỉnh sửa

### 2.1 UC 3.1 — Làm rõ "tạo lệnh" ≠ "tạo hàng"

**Vị trí**: SRS Section 1.3.2 — Group 3, dòng UC 3.1

| | Hiện tại (cần sửa) | Sau khi sửa |
|--|--------------------|----|
| **Tên UC** | Operator creates request from scanned data | Barcode Scanner creates transport request from cargo data |
| **Mô tả** | API endpoint to ingest request from scanner (QR + Barcode). | API endpoint to create a Transport Request for an existing Cargo. Triggered after UC 3.0 (Scan cargo) has already created the Cargo entity. Barcode Scanner passes `cargo_id` (hoặc `source_point + item_code`) để WES tạo lệnh vận chuyển. |
| **Ghi chú** | UC 3.1 hiện tại gộp "tạo hàng" và "tạo lệnh" làm 1. Sau khi tách, UC 3.0 = tạo hàng, UC 3.1 = tạo lệnh từ hàng đã scan. |

> **Lý do**: Trước đây nhóm hiểu nhầm scan = tạo lệnh trực tiếp. Thực tế: scan → tạo cargo (3.0) → (system quyết định) tạo transport request (3.1). Đây là 2 entity và 2 UC khác nhau.

---

### 2.2 Actor 4 (FMS / openTCS) — Sửa mô tả dispatch

**Vị trí**: SRS Section 1.3.1 — Actors table, dòng Actor #4

| | Hiện tại (cần sửa) | Sau khi sửa |
|--|--------------------|----|
| **Mô tả** | "...directly executes vehicle assignments **(dispatch)**..." | "...nhận Transport Order từ WES (đã gán sẵn `intendedVehicle`), thực thi routing, giao tiếp phần cứng AGV, và đồng bộ telemetry về WES. **Việc chọn AGV cho task (task assignment) do WES thực hiện** thông qua `intendedVehicle` parameter trong openTCS API." |
| **Ghi chú** | FMS không chọn xe — WES chọn xe qua Hungarian + intendedVehicle API. FMS chỉ execute lệnh đã gán. |

---

## 3. Tóm tắt thay đổi

| Loại | ID | Tên | Trạng thái |
|------|----|-----|-----------|
| Thêm | 3.0 | Scan cargo (Quét hàng) | Mới hoàn toàn |
| Thêm | 3.16 | Delete cargo (Xóa hàng) | Mới hoàn toàn |
| Sửa | 3.1 | Barcode Scanner creates transport request from cargo data | Rename + sửa mô tả |
| Sửa | Actor 4 | FMS (openTCS) description | Sửa mô tả dispatch |

---

## 4. Ghi chú phân biệt Cargo vs Transport Request

```
Cargo (hàng):
  - Entity: vật lý — kiện hàng cần vận chuyển
  - Tạo bởi: UC 3.0 (Barcode Scanner quét)
  - Xóa bởi: UC 3.16 (Delete cargo)
  - Tồn tại độc lập với Transport Request

Transport Request (lệnh vận chuyển):
  - Entity: logic — lệnh điều phối cho AGV
  - Tạo bởi: UC 3.1 (auto từ scan) hoặc UC 3.2 (manual)
  - Hủy bởi: UC 3.7 (Cancel transport request) — giữ Cargo
  - Phụ thuộc: cần Cargo tồn tại trước
```

Xem MF-01 trong `new-mainflow.md` để hiểu flow đầy đủ.
