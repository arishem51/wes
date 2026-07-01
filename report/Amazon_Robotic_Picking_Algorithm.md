# Amazon Robotic Picking Algorithm — Tóm tắt & Ứng dụng cho WES

> Ghi chú đọc bài báo: **"Algorithm for Robotic Picking in Amazon Fulfillment Centers Enables Humans and Robots to Work Together Effectively"**
> Tác giả: Russell Allgor, Tolga Cezik, Daniel Chen (Amazon).
> Đăng trên *INFORMS Journal on Applied Analytics (Interfaces)*, vol. 53(4), tr. 266–282, 07/2023. DOI: `10.1287/inte.2022.1143`.
>
> Link gốc (ResearchGate): https://www.researchgate.net/publication/366912253_Algorithm_for_Robotic_Picking_in_Amazon_Fulfillment_Centers_Enables_Humans_and_Robots_to_Work_Together_Effectively
> (ResearchGate/INFORMS chặn crawl — nội dung dưới đây tổng hợp từ bản PDF công khai + thông cáo báo chí, xem mục Nguồn.)

---

## 1. Bài báo nói về cái gì?

### 1.1 Bối cảnh — mô hình "goods-to-person"

Trong các trung tâm hoàn tất đơn hàng (Fulfillment Center — FC) dùng **Amazon Robotics (AR)**, con người **không** đi tới kệ hàng để lấy/xếp hàng. Thay vào đó:

- **Robot (drive)** — robot di động dạng đĩa — chui xuống dưới **pod** (kệ hàng di động) và chở nguyên cả pod tới **workstation**.
- **Associate (nhân viên)** đứng cố định tại workstation, nhặt (pick) hoặc xếp (stow) item từ pod mà robot mang tới.

Đây là mô hình **goods-to-person**: hàng tự tìm đến người, thay vì người đi tìm hàng.

### 1.2 Bài toán cốt lõi

Thuật toán picking phải quyết định: **để hoàn tất tập đơn hàng (shipment), nên lấy đơn vị hàng (unit) nào, trên pod nào?**

Vì mỗi item thường tồn ở **nhiều pod** khác nhau, cùng một đơn có thể được phục vụ bởi nhiều tổ hợp pod. Chọn sai → robot phải chạy nhiều chuyến, đi xa hơn → tốn năng lượng, kẹt giao thông, giảm throughput.

### 1.3 Hai khái niệm hiệu năng then chốt

| Khái niệm | Ý nghĩa | Hướng tối ưu |
|---|---|---|
| **Pile-on** | Số unit nhặt được **trên mỗi chuyến pod** (một pod được mang tới thì nhặt được bao nhiêu item cho các đơn) | **Tăng** — càng nhặt nhiều/chuyến càng tốt |
| **Drive distance per pick** | Quãng đường robot đi chia cho số unit nhặt được | **Giảm** — đây là hàm mục tiêu chính |

`drive distance per pick` giảm khi (a) **tăng pile-on** (nhặt nhiều unit mỗi lần pod tới), và (b) **giảm quãng đường mỗi chuyến pod** (ưu tiên pod ở gần).

### 1.4 Thuật toán cũ vs mới

- **Cũ — greedy/myopic:** gán đơn vào pod tuần tự theo chi phí tức thời của từng đơn, **không** tối ưu toàn cục. Kết quả: pile-on thấp, pod bị dùng chưa hiệu quả.
- **Mới — tối ưu hóa liên hợp (joint optimization):** đồng thời quyết định **hai việc**:
  1. **Shipment selection** — chọn tập đơn nào đưa vào "pick window" (cửa sổ nhặt hiện tại);
  2. **Pick-to-pod assignment** — gán từng pick cho pod cụ thể;

  sao cho **tổng drive distance per pick nhỏ nhất** trên cả cửa sổ kế hoạch.

### 1.5 Mô hình tối ưu (tóm tắt)

- **Mục tiêu:** minimize tổng quãng đường robot / số unit nhặt trên cả pick window.
- **Biến quyết định (binary):** (1) đơn nào được chọn vào pick window; (2) mỗi pick được gán cho pod nào.
- **Ràng buộc:** sức chứa/số item khả dụng trên pod, tồn kho theo đơn, ràng buộc thời gian của pick window, tính khả thi của gán đơn↔pod, quan hệ tiên quyết giữa các thao tác.

### 1.6 Kết quả

- **Giảm 62%** quãng đường robot đi trên mỗi unit nhặt, **không** ảnh hưởng vận hành.
- **Giảm 31%** tổng số chuyến robot cần trong các AR FC.
- Tiết kiệm ước tính **~nửa tỷ USD**.
- Đã triển khai trên **toàn bộ** AR FC.

---

## 2. Chúng ta dùng bài này để làm gì?

WES của chúng ta điều phối **AGV chở cargo** (transport order → dispatch → assignment) — về bản chất là **cùng một lớp bài toán goods-to-person / vehicle routing** như Amazon, chỉ khác quy mô và việc AGV chở cargo đơn lẻ thay vì pod đa-item.

Giá trị tham khảo cho WES:

1. **Định hình lại tư duy hàm mục tiêu.** Thay vì tối ưu từng transport task riêng lẻ (greedy — giống thuật toán cũ của Amazon), nên hướng tới **tối ưu liên hợp**: chọn *task nào* release + gán *AGV nào* sao cho tối thiểu tổng quãng đường / công vận chuyển. Liên hệ trực tiếp tới **Release Engine** và **Assignment Engine** trong [UC3](UC3_Transport_Request_Analysis.md).

2. **Chỉ số vận hành cần đo.** Áp dụng tương tự cặp metric:
   - *"pile-on"* → **số cargo/việc hoàn thành trên mỗi hành trình AGV** (gộp nhiều pick/drop trên một tuyến khi khả thi);
   - *"distance per pick"* → **quãng đường AGV / số cargo giao thành công** — làm KPI theo dõi hiệu quả dispatch.

3. **Bài học "myopic → global".** Bằng chứng thực tế rằng chuyển từ gán tham lam sang tối ưu có cửa sổ (windowed optimization) mang lại cải thiện rất lớn (62%). Củng cố định hướng thiết kế **pickup-row dependency / lane-aware dispatch** đang có (xem memory `pickup-row-dependency-design`).

4. **Con người + robot cùng làm.** Mô hình workstation cố định + robot mang hàng tới là tham chiếu thiết kế cho các luồng có thao tác thủ công (scan/confirm) xen kẽ AGV trong WES.

> **Phạm vi dùng:** đây là tài liệu tham khảo học thuật/định hướng thiết kế, **không** phải spec bắt buộc. Dùng để biện luận khi thiết kế thuật toán dispatch/assignment và chọn KPI, không dùng để copy mô hình MILP nguyên trạng (bài báo không công bố công thức chi tiết).

---

## 2.1 Ánh xạ tới tầng Release của chúng ta

> **Về thuật ngữ:** "Release" là tên **tự đặt** trong kiến trúc của chúng ta — và mapping này đúng chuẩn: **Release = chọn *task nào* được đi tiếp (pick task nào)**; **Assignment = gán AGV cho task đã được release**. Chính là cặp "shipment selection vào pick window" ↔ "pod → station" của bài báo.

→ Nên các bài học của bài báo (rolling re-eval backlog, chống greedy, priority theo due-time, cân tải giữa zone) **thuộc về tầng Release** của chúng ta.

Và thực tế **ReleaseEngine của chúng ta đã đang làm đúng tinh thần đó rồi**: re-evaluate mọi at-source task mỗi lần dispatch (`release-engine.service.ts:34-52`), demote/preempt để giữ ổn định. Bài báo chủ yếu là **từ vựng + xác nhận** cho cái ta đã có, cộng gợi ý mở rộng tương lai (priority theo due-time, throughput target theo zone) — nếu sau này cần.

> **Đừng nhầm:** bài báo này là **picking policy**. Bài toán chọn **dropoff-slot** của chúng ta là **storage policy** (Cezik et al. 2021, Yuan et al. 2018/2019), được chốt tại **barrier TO2 trong saga** — KHÔNG thuộc Release. Đừng gộp việc chọn slot vào Release, nếu không sẽ quay lại đúng bug chọn slot quá sớm.

---

## 3. Nguồn

- INFORMS (paywall): https://pubsonline.informs.org/doi/10.1287/inte.2022.1143
- Bản PDF công khai (Bilkent IE479): https://courses.ie.bilkent.edu.tr/ie479/wp-content/uploads/sites/16/2024/11/Algorithm-for-Robotic-Picking-in-Amazon-Fulfillment-CentersEnables-Humans-and-Robots-to-Work-Together-Effectively.pdf
- TechXplore (thông cáo): https://techxplore.com/news/2023-02-amazon-algorithm-collaboration-robots-humans.html
- EurekAlert: https://www.eurekalert.org/news-releases/981022
- EEJournal: https://www.eejournal.com/industry_news/amazon-develops-algorithm-to-improve-collaboration-between-robots-and-humans/
- dblp: https://dblp.org/rec/journals/interfaces/AllgorCC23.html
