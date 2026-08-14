# Nội dung mục VI–VIII

## VI. Bài toán 1 — Gán xe (Assignment)

### VI.1 — Mô hình hoá: biến "chờ lâu" thành một bài toán có lời giải

**Slide:**

Trước khi tính bất cứ thứ gì, tách hai câu hỏi vốn bị gộp làm một:

| Câu hỏi | Trả lời ở đâu |
|---|---|
| Lệnh này đã được phép chạy chưa? | Luật lấy hàng theo lớp — chưa được thì lệnh nằm ở trạng thái *bị chặn*, có ghi lý do |
| Trong số lệnh được phép, xe nào nhận lệnh nào? | Bài toán gán |

Đây là điều kiện để đọc lại con số 309 giây ở mục II: có một trạng thái *bị chặn* riêng thì thời gian chờ mới tách được thành **chờ đúng luật** và **chờ do điều phối**. Hệ thống cũ không có trạng thái đó nên hai loại chờ trộn vào nhau, và không có cách nào biết 309 giây đó là hệ thống chậm hay hàng chưa dọn.

Bài toán gán, mỗi chu kỳ điều phối:

- Lấy N lệnh sẵn sàng cũ nhất, với **N = số xe rảnh**.
- Dựng bảng chi phí **N lệnh × N xe**.
- Chi phí một ô = quãng đường xe phải **chạy rỗng** tới điểm lấy hàng, nhân với hệ số pin của chính chiếc xe đó:

```
chi phí(xe, lệnh) = quãng đường tới điểm lấy  ×  ( 1 + trọng-số-pin × (1 − pin/100) )
```

- Quãng đường là **đường đi ngắn nhất trên bản đồ kho**, không phải đường chim bay: bản đồ đo có **905 đoạn đường, 678 trong đó một chiều (75%)** — đường chim bay sai hệ thống trên một bản đồ như vậy.
- Khi trọng số pin bật, quãng đường đưa vào tích còn cộng thêm chặng chở hàng ước lượng từ điểm lấy tới khu đích, để hình phạt pin bám cả chuyến chứ không chỉ đoạn chạy rỗng.

Ba loại ô trong bảng, xếp theo **thứ tự từ điển**:

```
tối đa số cặp ghép được  →  tối thiểu số cặp "chưa biết đường"  →  tối thiểu tổng quãng đường
```

**Concept:**

- **Chạy rỗng (deadhead)** — đoạn xe chạy không tải từ chỗ nó đang đứng tới chỗ lấy hàng. Đây là **thứ duy nhất phép gán đổi được**: chặng chở hàng từ nguồn tới đích giống hệt nhau bất kể ai nhận việc. Mọi con số phần trăm ở mục VI đều là phần trăm của chạy rỗng, không phải của tổng quãng đường đội xe.
- **Bảng chi phí có ô "chưa biết" và ô "không tới được"** — hai chuyện khác nhau. *Chưa biết* là thiếu dữ liệu (xe chưa định vị, chưa có bản đồ) và vẫn cho phép điều xe. *Không tới được* là bản đồ khẳng định không có đường, cặp đó bị loại. Hai loại được gán hai giá trị phạt lồng nhau, giá trị lớn hơn đắt hơn toàn bộ quãng đường của một lô đầy — nhờ vậy thứ tự ưu tiên là thứ tự từ điển thật, không phải một sự đánh đổi ngẫu nhiên giữa các mục tiêu.
- **Chi phí là một tích, không phải một tổng** — hệ quả toán học đáng nhớ: cộng một hằng số vào **cả một hàng** của bảng không bao giờ đổi được lời giải, và nhân **cả bảng** với một hệ số cũng vậy. Chặng chở hàng chỉ có tác dụng vì nó được nhân với hệ số pin **riêng của từng xe**; nếu chỉ cộng vào, nó là hằng số trên một hàng và hoàn toàn vô hiệu.

---

### VI.2 — Thuật toán Hungarian: tối ưu toàn cục và tất định

**Slide:**

Gán tham lam có thể "cướp" chiếc xe mà một lệnh khác cần hơn:

```
                     V1 (đang ở S2)    V2 (ở xa)
  lệnh t1 (lấy ở S1):      4               6
  lệnh t2 (lấy ở S2):      0              10

  Tham lam theo thứ tự:  t1 lấy V1 (4);  t2 đành lấy V2 (10)   → tổng 14
  Ghép tối ưu:           t1 → V2 (6);    t2 → V1 (0)           → tổng  6
```

Thuật toán Hungarian giải bài toán ghép cặp một–một chi phí nhỏ nhất **tối ưu toàn cục**, thời gian đa thức. Bản dùng ở đây là biến thể thế năng + đường tăng luồng ngắn nhất, độ phức tạp `O(n²·m)` — với đội vài chục xe là dưới một mili-giây, nên chi phí tính toán không phải là một cân nhắc.

Hai tính chất phải có, ngoài tính tối ưu:

| Tính chất | Vì sao cần |
|---|---|
| **Tất định** | Cùng đầu vào phải cho cùng kết quả. Quy tắc phá hoà cố định khiến kết quả tái lập được, và một hệ điều phối không tái lập được thì không mổ được lỗi. |
| **Không phụ thuộc thời gian chạy** | Điều kiện dừng không dựa vào đồng hồ, nên máy nhanh hay máy chậm cho cùng một phép ghép. |

Kiểm chứng tính tối ưu bằng **oracle vét cạn**: với mọi bảng chi phí tới kích thước 4×4, so tổng chi phí của lời giải với tìm kiếm vét cạn toàn bộ — luôn bằng nhau.

**Concept:**

- **Bài toán gán (assignment problem)** — cho một bảng chi phí, chọn đúng một ô mỗi hàng sao cho không hai hàng nào dùng chung một cột, và tổng các ô được chọn là nhỏ nhất. Khác bài toán "mỗi hàng tự chọn ô rẻ nhất" ở chỗ có ràng buộc không dùng trùng cột.
- **Tối ưu toàn cục vs. tham lam** — tham lam quyết định từng lệnh một và không rút lại được; tối ưu toàn cục nhìn cả lô cùng lúc. Ví dụ trên là ca kinh điển: quyết định rẻ nhất cho lệnh đầu làm hỏng lệnh sau.
- **Mục tiêu là tổng, không phải xe tệ nhất** — thuật toán tối thiểu **tổng** quãng chạy rỗng của cả lô, chứ không tối thiểu quãng đường của chiếc xe phải đi xa nhất. Đây là một lựa chọn thiết kế: có thể để một xe đi khá xa nếu điều đó làm tổng nhỏ đi.
- **Oracle vét cạn** — cách kiểm thử một thuật toán tối ưu: chạy song song một cách giải chậm nhưng chắc chắn đúng (thử mọi khả năng) trên các đầu vào nhỏ, rồi so kết quả. Nó chứng minh được tính đúng ở quy mô nhỏ mà một bộ test viết tay không làm được.

---

### VI.3 — Kết quả thực nghiệm: phép ghép tối ưu suy biến về tham lam

**Slide:**

Cách đo: mỗi chu kỳ điều phối **giải cả hai** cách ghép — tối ưu và tham lam — trên **cùng một bảng chi phí**; điều xe theo cách đang bật, và ghi lại lựa chọn của cách kia. Mỗi lần chạy tự mang theo một so sánh theo cặp trên đúng cùng một tồn đọng và cùng vị trí xe.

Kết quả: **phép ghép tối ưu cho ra đúng kết quả của tham lam trong phần lớn chu kỳ.** Hai nguyên nhân độc lập, cùng dẫn tới một kết luận:

| Tình huống | Bảng chi phí | Vì sao trùng tham lam |
|---|---|---|
| **Việc nhiều hơn xe** — xe bận hết, rảnh nhỏ giọt từng chiếc | **1 hàng** | Bảng một hàng thì "ghép tối ưu" đúng bằng "chọn ô nhỏ nhất của hàng đó". Đây chính là tham lam. |
| **Việc ít hơn xe** — phần lớn xe đang đậu ở bãi | nhiều hàng | Mọi tuyến từ bãi đỗ đi ra đều chui qua cùng một cổ chai — đo được **13 nút chung trên mọi tuyến**. Bảng khi đó có dạng **cộng tính** (chi phí = phần của xe + phần của lệnh), mà trên bảng cộng tính **mọi cách ghép đều cho cùng một tổng**. Đo: chênh lệch giữa cách ghép tốt nhất và tệ nhất = **0,0%**. |

Nhịp điều phối hiện tại — mỗi xe vừa rảnh sinh một lần chạy — **chủ động đẩy hệ vào dòng đầu của bảng**.

Phát biểu đúng của kết quả này: thuật toán vẫn tối ưu, **cái tối ưu đó tầm thường vì cấu trúc nhà kho làm nó tầm thường**. Đây không phải "Hungarian chạy khó", mà là "Hungarian không có việc gì để làm".

Khi nào nó **không** tầm thường — đo ngoại tuyến, 2000 lô:

| Kích thước lô | Tham lam thừa bao nhiêu chạy rỗng | Tỉ lệ lô hai cách cho kết quả như nhau |
|---|---|---|
| 2 | +2,5% | 79% |
| 5 | +5,7% | 31% |
| 10 | +7,2% | 7% |

> **Điều kiện tạo ra bảng trên:** xe được rải rác khắp bản đồ và kích thước lô bị **ép sẵn**, trọng số pin đặt bằng 0. Nhịp điều phối thật hiếm khi tự tạo ra điều kiện đó. Đây là số của một thí nghiệm, không phải lợi ích quan sát được trong vận hành.

Đòn bẩy thật nằm ở hai chỗ, và cả hai đều được chỉ ra bởi chính phép đo trên:

| Đòn bẩy | Cứu tình huống nào | Cơ chế |
|---|---|---|
| **Bật trọng số pin** | Xe đậu ở bãi | Hệ số pin nhân theo **từng xe** ⇒ **phá tính cộng tính** của bảng ⇒ phép ghép tối ưu tách khỏi tham lam ngay cả khi mọi tuyến chung một cổ chai. Đo ngoại tuyến: tham lam thừa **+10,8%** thay vì +7,2%; quãng đường thô chỉ tăng **0,1–0,2%**, đổi lại tỉ trọng số mét dồn lên nửa đội xe yếu pin giảm **61% → 55%**. |
| **Nhìn trước xe sắp rảnh** | Xe rảnh nhỏ giọt | Đưa cả xe **sắp** xong việc vào bảng, và đổi đơn vị chi phí từ **mét** sang **giây**: chi phí = thời gian còn lại để xe xong việc hiện tại + thời gian chạy từ chỗ nó kết thúc tới điểm lấy hàng. Bảng trở thành nhiều-hàng-nhiều-cột **dù xe được giải phóng rời rạc**. Chỉ phát lệnh cho cặp mà xe **đã thật sự rảnh**; phần còn lại là kế hoạch tạm, chu kỳ sau giải lại. **Không thêm một mili-giây độ trễ nào** — không giữ xe lại để gom lô. |

**Concept:**

- **Suy biến (degenerate)** — một bài toán suy biến khi cấu trúc đầu vào làm lời giải tối ưu trùng với lời giải của một cách làm đơn giản hơn nhiều. Thuật toán không sai; miền đầu vào không có chỗ cho nó phát huy.
- **Ma trận cộng tính** — bảng mà chi phí mỗi ô tách được thành "phần chỉ phụ thuộc xe" cộng "phần chỉ phụ thuộc lệnh". Khi đó mọi cách ghép đều cộng lại ra cùng một tổng, nên tối ưu hoá không còn ý nghĩa. Nhà kho tạo ra dạng này vì mọi tuyến rời bãi đỗ đều đi qua cùng một cổ chai: khoảng cách từ xe tới cổ chai là "phần của xe", từ cổ chai tới hàng là "phần của lệnh".
- **Đo bằng cách chạy song song hai lời giải (shadow)** — chạy thuật toán thứ hai trên đúng dữ liệu thật nhưng **không** dùng kết quả của nó để điều xe, chỉ ghi lại. Chi phí gần như bằng không, đổi lại bằng chứng so sánh có sẵn trong mọi lần chạy mà không phải dựng lại thí nghiệm. **Chính cơ chế này làm phát hiện ở trên trở nên khả thi.**
- **Giới hạn của phép đo shadow** — nó là phản-thực-tế **một bước**: đo chất lượng của **từng quyết định**, không đo hệ quả tích luỹ như thời gian hoàn thành cả mẻ hay mức độ tắc đường. Muốn hệ quả tích luỹ thì phải chạy hai nhánh thật, nhiều lần mỗi nhánh.
- **Vì sao đây là kết quả nghiên cứu chứ không phải thất bại** — nhóm cài đặt lời giải tối ưu, rồi **đo**, và phát hiện cấu trúc của chính nhà kho này làm nó suy biến về tham lam trong phần lớn chu kỳ. Một phát biểu đo được, giải thích được, và chỉ ra chính xác hai chỗ đòn bẩy thật nằm ở đâu — có giá trị hơn một con số cải thiện không kiểm chứng được.
- **Hạn chế đã biết, nói thẳng** — phép gán hiện tại là **thiển cận**: chỉ ghép với xe **đang** rảnh, xe sẽ rảnh sau năm giây không có mặt trong bảng. Đó chính là gốc của nguyên nhân thứ nhất ở trên.

---

## VII. Bài toán 2 — Định tuyến đa xe (Routing / MAPF)

### VII.1 — Vì sao định tuyến từng xe độc lập là không đủ

**Slide:**

Bộ định tuyến mặc định trả lời câu hỏi: *"cho **một** xe và **một** đích, đường ngắn nhất là gì?"* — mỗi xe một lần gọi, không xe nào biết xe nào.

Với 11 xe trên bản đồ 75% một chiều, cách đó hỏng theo ba mức, nặng dần:

| Mức | Hiện tượng |
|---|---|
| Chậm | Hai xe cùng nhắm một hành lang; đến nơi mới phát hiện, một xe phải dừng chờ |
| Tắc | Xe xếp hàng trước miệng làn hàng; làn hàng là **đỉnh khớp** của bản đồ — cắt nó là cắt đôi đồ thị, nên không có đường vòng |
| **Deadlock** | Bốn xe đứng thành vòng: mỗi xe chờ xe kế nhả ô. Không xe nào sai luật, không xe nào tiến được, và **không cái nào tự thoát** |

Bài toán đúng là **tìm đường cho nhiều xe cùng lúc (MAPF)**: cho vị trí xuất phát và đích của **toàn đội**, tìm đồng thời đường đi cho mọi xe sao cho không xe nào va nhau. Đây là bài toán NP-khó ở dạng tối ưu.

Vì sao deadlock khó hơn va chạm:

```
Va chạm:  một tính chất của HAI xe, một thời điểm.  Nhìn từng cặp là thấy.
Deadlock: một tính chất của MỘT VÒNG xe.           Nhìn từng cặp KHÔNG thấy —
                                                    mọi cặp đều hợp lệ.
```

Đây là lý do trung tâm khiến bài toán này không giải được bằng cách sửa từng chỗ hỏng.

**Concept:**

- **MAPF** (Multi-Agent Path Finding) — tìm đường đồng thời cho một đội robot trên cùng một đồ thị sao cho không va chạm. Khác định tuyến thường ở chỗ lời giải là **kế hoạch không–thời gian**: không chỉ "đi qua ô nào" mà "đi qua ô nào **vào lúc nào**".
- **Deadlock (khoá chết)** — một vòng chờ khép kín: A chờ B, B chờ C, C chờ A. Đặc trưng là **không ai vi phạm luật nào** và hệ thống không tự thoát ra được; phải có can thiệp từ ngoài.
- **Đỉnh khớp (cut vertex)** — điểm mà bỏ nó đi thì đồ thị vỡ làm đôi. Làn hàng trong kho là đỉnh khớp: không có đường vòng, nên tắc ở đó là tắc thật.
- **Vì sao "chỉ cần thêm luật tránh va chạm" là chưa đủ** — tầng cấp phát tài nguyên bên dưới đảm bảo hai xe không bao giờ ở cùng một ô, và nó làm đúng việc đó. Nhưng nó **không có trục thời gian** — nó chỉ biết "ai đang giữ ô nào bây giờ", không biết "ai sẽ cần ô nào sau ba bước". Nó ngăn được va chạm và không ngăn được vòng chờ.

---

### VII.2 — Cửa sổ trượt, và an toàn cưỡng chế ở lúc thi hành

**Slide:**

Ba quyết định kiến trúc, mỗi cái giải một khó khăn cụ thể:

**(1) Đặt bộ não phối hợp ở tầng điều phối, không ở tầng định tuyến.**

| Tầng | Bản chất | Hợp với MAPF? |
|---|---|---|
| Định tuyến | Được hỏi cho **từng xe, từng lệnh**; không có lời gọi nào cho cả đội | Không — không có chỗ nào nhìn thấy toàn đội |
| **Điều phối** | Điểm **duy nhất** có trạng thái toàn cục của mọi xe và mọi lệnh | **Có** — đây là nhà của việc phối hợp |
| Cấp phát tài nguyên | Loại trừ lẫn nhau trên ô và đoạn đường; **không có trục thời gian** | Là tầng chống va chạm — hợp tác với nó, không thay nó |

**(2) Lập kế hoạch một đoạn ngắn, rồi lập lại (cửa sổ trượt).**

```
   trạng thái THỰC của đội  ──►  giải phối hợp cho ~10 bước tới
                                        │
                     phần đầu được thi hành thật
                                        │
                     phần đuôi là giấy nháp ──► bị ghi đè ở lần giải sau
                                        │
                          giải lại từ trạng thái THỰC  ──►  (lặp)
```

Nhịp có **sàn và trần**: không giải lại sớm hơn 1 giây (giải quá dày thì đường đi lật qua lật lại), và **ép** giải lại nếu đã 3,5 giây chưa giải (giải quá thưa thì đội đóng băng không ai cứu).

**(3) An toàn được cưỡng chế ở lúc thi hành, không ở lúc lập kế hoạch.**

Kế hoạch phối hợp không được coi là mệnh lệnh cứng. Nó được dịch thành **thứ tự qua điểm** — "xe B phải chờ tới khi xe A qua khỏi điểm R" — và thứ tự đó được cưỡng chế bằng cách **từ chối cấp phát ô** cho xe đến sớm. Xe chạy nhanh hay chậm, dừng hay đi tiếp, thứ tự vẫn được giữ.

Vì sao phải như vậy — số đo quyết định, 25 xe:

| | phần trong cửa sổ | sau khi nối đuôi ngoài cửa sổ |
|---|---|---|
| kế hoạch có va chạm | **0 / 448** | **448 / 448** |

Phần phối hợp **không sai một lần nào**. 100% chỗ hỏng nằm ở cái đuôi — đoạn ngoài cửa sổ, nơi mỗi xe tự đi đường ngắn nhất của mình mà không nhìn xe khác. Ở mật độ cao, đuôi đó **luôn** va chạm.

**Concept:**

- **Cửa sổ trượt (rolling horizon)** — lập kế hoạch cho một đoạn ngắn phía trước, thi hành phần đầu, rồi lập lại từ trạng thái thực. Vì mọi ước lượng đều xấu đi theo thời gian, kế hoạch dài không đáng tin hơn kế hoạch ngắn — nó chỉ đắt hơn và sai lâu hơn.
- **Vì sao đuôi "bẩn" mà vẫn chấp nhận được** — đuôi là giấy nháp: nó bị ghi đè trước khi xe kịp chạy tới đó. Điều kiện để lập luận này đứng vững là **xe tiêu thụ ít bước hơn độ dài cửa sổ trong mỗi nhịp giải lại**. Đây là một phép đo, và nó là **vết còn mở** — chưa đo trên hệ đang chạy.
- **Vì sao không đẩy thẳng kế hoạch không–thời gian xuống cho xe** — cách này đã thử và thất bại. Lệnh gửi xuống xe là một **danh sách điểm**, không có trường thời gian, nên thứ duy nhất không mã hoá được là **đứng yên chờ**. Đổ kế hoạch theo từng nhịp thời gian thành danh sách điểm sinh ra đường đi dao động vô nghĩa, và **vô hiệu hoá luôn cơ chế chống deadlock có sẵn** của tầng dưới — nó chỉ chống deadlock trên đường đi **do chính nó tính**.
- **Nhường đường thì giữ, đứng chờ thì bỏ** — lùi ra nhường rồi quay lại là một đường đi **hợp lệ** và được giữ nguyên; chỉ "đứng yên một nhịp" là bị bỏ, vì nó không diễn đạt được. Cái "chờ" mà nó biểu thị được thực hiện ở tầng cấp phát tài nguyên, chứ không bằng cách nhét thêm điểm vào đường đi.
- **Hạn chế phải nói thẳng** — hiện không còn tầng nào kiểm va chạm trên kế hoạch trước khi cài. Toàn bộ an toàn dựa vào tầng cưỡng chế thứ tự và tầng cấp phát **lúc thi hành**. Đây là hợp đồng cửa sổ trượt ở dạng triệt để; cái giá là **chất lượng kế hoạch không có ai canh — chỉ deadlock mới báo**.

---

### VII.3 — Ba sự cố tiêu biểu

**Slide:**

**Sự cố 1 — Kế hoạch hợp lệ hoàn toàn, mà bốn xe vẫn đứng chết.**

Bộ kiểm va chạm cho qua sạch: không hai xe nào ở cùng một ô, không hai xe nào đổi chỗ cho nhau. Nguyên nhân: kế hoạch là một **vòng xoay không có ô trống** — bốn xe cùng nhích một nhịp, mỗi xe vào ô của xe kế.

```
Nếu bốn xe nhích ĐỒNG THỜI:      hợp lệ, không va chạm.
Xe thật thì KHÔNG đồng thời:     V1 chờ V2 nhả ô → V2 chờ V3 → V3 chờ V4 → V4 chờ V1
                                  ⇒ vòng chờ khép kín ⇒ đứng vĩnh viễn.
```

Bộ thi hành chỉ cho xe vào **ô đã trống**, từng xe một. Tập kế hoạch hợp lệ theo chuẩn MAPF **rộng hơn** tập kế hoạch thi hành được, và khoảng chênh đúng bằng lớp "vòng xoay không ô trống". Bản vá: bác bỏ mọi cấu hình chứa vòng xoay đó **ngay khi sinh ra**, ở tầng thấp nhất mà mọi nhánh của bộ giải đều đi qua.

**Sự cố 2 — Cùng đầu vào, chạy 8 lần ra 4 kế hoạch khác nhau.**

Deadlock 20 xe chỉ tái hiện được 17% số lần ⇒ không mổ được. Nguyên nhân: bộ giải dừng theo **đồng hồ treo tường** — kế hoạch trở thành hàm của "máy bung được bao nhiêu phép tính trong một giây đó". Bản vá: đổi điều kiện dừng sang **số nút đã duyệt**.

Số đo đi kèm: chất lượng lời giải **phẳng tuyệt đối** khi tăng ngân sách tìm kiếm gấp 80 lần. Hệ đang đốt một giây để ra đúng thứ mà 24 mili-giây cũng ra. Và bản vá tất định này **là một thành phần của bản vá deadlock, không phải một tối ưu riêng**: cùng bộ kiểm tra, dừng theo đồng hồ đạt 3/6, dừng theo số nút đạt 6/6.

**Sự cố 3 — Xe không lọt trong một ô.**

Cả MAPF chuẩn lẫn mô hình thứ tự thi hành đều giả định *"robot hình tròn, lọt gọn trong một ô"*. Giả định đó sai ở đây:

| | xe rỗng | xe mang hàng |
|---|---|---|
| bán kính quét khi xoay 90° | 470,7 mm | **565,7 mm** |
| chìa ngang khi đứng yên | 212,5 mm | **400 mm** |

Khoảng cách hai ô kề nhau là 950 mm. Đi thẳng thì thân xe nằm gọn. **Chỉ cú xoay mới thò sang ô bên cạnh** — và `565,7 + 400 = 965,7 > 950`, nên **hai xe mang hàng ở hai ô kề nhau thì không con nào xoay được**; xe kia đứng yên cũng không cứu được, nó phải rời hẳn khỏi ô.

Hệ quả lên mô hình: luật thứ tự cũ chỉ nói được *"tại **cùng một** ô, ai trước ai sau"*. Ràng buộc thân xe là quan hệ giữa **hai ô khác nhau**, nên phải nới luật: đăng ký xe đến trước vào **điểm của xe đến sau**, kể cả khi hai xe không đi qua ô chung nào.

```
A: ô1 → ô2 → ô3        B: ô4 → ô5 → ô6        (không chung ô nào)
luật cũ:  không ràng buộc gì
luật mới: B đợi tới khi A rời ô2  (vì thân hai xe chồng nhau nếu cùng lúc)
```

Chi phí đo được của việc đưa hướng xe vào không gian tìm kiếm: số nút tăng 37%, thời gian giải gần như không đổi.

**Concept:**

- **Vòng xoay không ô trống** — bốn xe nhích một vòng khép kín, không ô nào trống. Hợp lệ nếu mọi xe chuyển động đồng thời; bất khả thi nếu xe phải vào ô đã trống, từng chiếc một. Đây là điểm khác biệt giữa **mô hình lý thuyết** và **bộ thi hành thật**, và là ví dụ rõ nhất cho việc một kế hoạch đúng theo định nghĩa vẫn hỏng khi chạy.
- **Bất định là kẻ thù số một** — lỗi ngẫu nhiên không mổ được: không tái hiện được thì không biết bản vá có tác dụng hay chỉ gặp may. Ở đây tính tất định được lập lại **trước**, và mọi bản vá deadlock sau đó đều dựa trên nền đó.
- **Điều kiện dừng theo đồng hồ vs. theo khối lượng công việc** — dừng theo đồng hồ khiến kết quả phụ thuộc vào máy, tải hệ thống, và cả những tiến trình khác đang chạy. Dừng theo số phép tính cho kết quả giống nhau ở mọi nơi, đổi lại phải chọn đúng ngưỡng.
- **Tăng ngân sách tìm kiếm không phải lúc nào cũng tốt hơn** — chất lượng phẳng nghĩa là bộ giải đã chạm trần chất lượng từ rất sớm; phần còn lại chỉ là đốt thời gian. Giá trị đúng là **giá trị nhỏ nhất còn chạm trần đó**.
- **Vết còn mở, ghi thẳng** — bản đồ 75% một chiều, mà lõi đẩy-nhau của bộ giải chỉ có bảo đảm hoàn thành trên đồ thị **hai chiều**. Bảo đảm lý thuyết của bộ giải hiện tại **không có hiệu lực trên chính bản đồ này**; hệ vẫn chạy được nhờ nhịp giải lại và tầng cưỡng chế thứ tự, chứ không nhờ một chứng minh.

---

## VIII. Bài toán 3 — Vòng đời xe rảnh: sạc & đỗ

### VIII.1 — Đọc lại con số 89,5%: cái hỏng thật là dao động

**Slide:**

Nhắc lại số đo ở mục II, cùng một ngày:

| Loại lệnh | Tỉ lệ không hoàn tất |
|---|---|
| Vận chuyển hàng | 6,3% |
| Về chỗ đỗ | 56,2% |
| Sạc pin | **89,5%** |

Cơ chế đằng sau con số đó không phải sự cố:

```
xe rảnh → ra lệnh đi sạc/về đỗ → đang trên đường thì có hàng
        → thu hồi lệnh để giao việc thật → lệnh bị thu hồi ghi nhận là "hỏng"
```

Nên 89,5% **không đo lỗi, nó đo tần suất hệ thống tự rút lại quyết định của chính mình**. Cái mất thật nằm ở ba chỗ khác:

- Quãng đường đi rồi quay đầu, không sinh giá trị.
- Một cú quay đầu giữa lối đi — với xe này, xoay tốn thời gian hơn đi thẳng **và chiếm chỗ rộng hơn** (mục VII.3), nên nó vừa làm chậm chính chiếc xe đó vừa cản xe khác.
- Xe rảnh đứng lì trên đường trục **giữ tài nguyên** mà xe khác đang cần.

Điểm thứ ba là lý do vòng đời xe rảnh không thể bỏ qua: **"không làm gì" không phải là một lựa chọn trung tính.** Một chiếc xe đứng yên giữa kho là một vật cản, và không có tầng nào bên dưới tự dọn nó đi.

**Concept:**

- **Lệnh tự sinh** — lệnh sạc và lệnh đỗ không do người tạo; hệ thống tự phát ra khi thấy xe rảnh. Chúng dùng chung đường ống với lệnh chở hàng nên kết thúc ở cùng một tập trạng thái, và vì thế bị đếm chung khi đọc thô.
- **Thu hồi ≠ sự cố** — hai chuyện kết thúc ở cùng một trạng thái nhưng có ý nghĩa ngược nhau: một cái là hệ thống hỏng, một cái là hệ thống **đổi ý đúng lúc**. Bất kỳ chỉ số nào gộp chúng lại đều đọc sai.
- **Đo dao động chứ không đo lỗi** — chỉ số đúng cho vấn đề này không phải "tỉ lệ hỏng" mà là **số lệnh tự sinh trên mỗi kiện hàng thật**. Đó là số dùng ở mục VIII.3.

---

### VIII.2 — Hai ngưỡng pin, và vì sao "đủ pin" chưa đủ để rời trạm

**Slide:**

Hai ngưỡng, hai vai trò khác nhau:

| Ngưỡng | Dưới ngưỡng thì |
|---|---|
| **Vận hành** | Xe bị loại khỏi danh sách nhận việc mới — nhưng **vẫn làm nốt việc đang dở** |
| **Nguy cấp** | Xe bị loại khỏi danh sách nhận việc **và** được phát lệnh đi sạc |

Tách hai ngưỡng là để có một vùng đệm: xe tụt xuống vùng giữa thì ngừng nhận việc mới nhưng không bị lôi ra khỏi việc đang làm giữa chừng.

Vòng đời khép kín ở trạm sạc:

```
   pin ≤ nguy cấp   →   làm nốt việc đang dở   →   đi sạc ở trạm gần nhất CÒN CHỖ
                                                        │
   được thả ra khi:   ĐẦY  ─ hoặc ─  ( ĐỦ  VÀ  CÓ NHU CẦU )  ◄────┘
                                          │
              có việc đang chờ ────────► nhận việc
              xe khác nguy cấp ────────► nhường chỗ sạc, ra CHỖ ĐỖ (không nhận việc)
              không có gì ─────────────► sạc tiếp tới đầy, rồi ra chỗ đỗ
```

Bốn điều kiện, mỗi cái chặn một cách hỏng đã gặp:

| Điều kiện | Chặn cái gì |
|---|---|
| "Đủ pin" **và** "có nhu cầu" | Thả xe ra khi không ai cần thì nó chỉ đi một vòng rồi quay lại — đúng kiểu dao động ở mục II |
| Chỗ sạc phải **còn chỗ trống**, và chỗ đó được **giữ** | Hai xe cùng nhắm một trạm; hết chỗ mọi nơi thì xe critical **đứng chờ**, không xếp hàng ở trạm |
| Xe vừa **nhường chỗ** thì đi đỗ, không nhận việc | Xe vừa nhường là xe pin còn thấp; giao việc ngay thì lát nữa lại phải gọi đi sạc |
| Chỗ đỗ **không lấn** vào điểm sạc | Điểm sạc là tài nguyên hiếm; một xe đầy pin đỗ lì ở đó chặn một xe đang cạn |

Một lỗ đã đo được và đã vá: xe đang **cầm hàng** vẫn bị điều đi sạc — **32 lần** trong một mẻ. Nguyên nhân không phải hệ thống mù: nó có chặn xe đang chạy lệnh. Lỗ đúng nằm ở **cửa sổ xe tạm rảnh giữa hai chặng** — lệnh chặng trước đã xong, chặng sau chưa phát, xe báo về là đang rảnh, mà tay thì vẫn đang giữ kiện hàng.

**Concept:**

- **Hai ngưỡng thay vì một** — một ngưỡng duy nhất buộc phải chọn giữa "cắt việc giữa chừng" và "để xe chạy tới cạn". Hai ngưỡng cho một vùng đệm để xe hạ cánh êm.
- **"Đủ pin" là điều kiện cần, không phải điều kiện đủ** — quyết định rời trạm là một quyết định **điều phối**, không phải một quyết định về pin. Thiếu vế "có nhu cầu" thì hệ thống tạo ra chính cái dao động mà nó đang cố chống.
- **Trạng thái "đang rảnh" của xe không đáng tin một mình** — dữ liệu xe gửi về không có trường nào nói "tôi đang cầm hàng". Thứ duy nhất biết điều đó là **trạng thái việc bên phía hệ thống**. Sự thật này chỉ tồn tại ở một tầng, nên mọi suy đoán từ tầng khác đều là suy đoán sai ở một số ca — và đúng cái cửa sổ hẹp đó là nơi nó sai.
- **Chỗ sạc là tài nguyên có sức chứa, không phải một đích đến** — mô hình hoá nó như một đích đến bình thường sinh ra xếp hàng và tranh chấp; mô hình hoá như tài nguyên đếm được thì hết chỗ là một câu trả lời hợp lệ.

---

### VIII.3 — Chống dao động: đo, vá, đo lại

**Slide:**

**Đo trước.** Một mẻ 15 xe, khoảng 14 kiện hàng:

| | Số lệnh về chỗ đỗ |
|---|---|
| Tạo ra | **268** |
| Hoàn tất | **16** |

Tức khoảng **19 lệnh đỗ cho mỗi kiện hàng thật**. Và chúng dồn cục: một điểm đỗ duy nhất nhận 75 lệnh.

**Bốn nguyên nhân, không phải một** — mỗi cái sinh dao động theo một đường khác nhau:

| Nguyên nhân | Cơ chế |
|---|---|
| Nhả chỗ quá sớm | Chỗ đỗ được coi là "đã nhả" ngay khi tín hiệu về xe tới trễ một nhịp ⇒ chỗ được phát lại cho xe khác trong khi xe đầu đang trên đường tới |
| Hai bộ máy mù nhau | Bộ máy sạc và bộ máy đỗ mỗi bên giữ **một danh sách loại trừ riêng**, không bên nào thấy chỗ bên kia vừa phát ⇒ hai xe cùng nhắm một điểm |
| Không có gate việc đang cầm | Xe đang cầm hàng bị điều đi sạc trong cửa sổ tạm rảnh giữa hai chặng (mục VIII.2) |
| **Chỗ sạc ảo** | Khai báo một khu sạc gồm 5 điểm, nhưng tầng dưới **sập cả 5 về 1** ⇒ hệ đếm 5 chỗ trống trong khi thực tế chỉ dùng được 1 ⇒ **4/5 chỗ là ảo** ⇒ mọi xe chụm vào một điểm, hết chỗ, sinh thêm lệnh đỗ dự phòng, nuôi vòng lặp |

Nguyên nhân thứ tư đáng kể riêng: nó **không phải lỗi logic**, nó là một giả định mô hình sai lệch giữa hai tầng, và nó làm ba nguyên nhân kia nặng hơn nhiều lần. Cách chữa cũng không nằm ở mã nguồn — tách khu sạc nhiều điểm thành nhiều khu một điểm, để con số đếm được khớp với thứ tầng dưới thật sự dùng.

**Đo lại sau khi vá** — mẻ 15 xe, 80 kiện hàng:

| | Trước | Sau |
|---|---|---|
| Lệnh đỗ trên mỗi kiện hàng | ~19 | **~0,21** |
| Dồn về một điểm | 75 lệnh vào một điểm | Không còn — xe kết thúc ở 15 điểm khác nhau |

> Cả hai lần đo đều trên **mẻ chạy có kịch bản** (đội 15 xe, số kiện đặt trước), không phải trên dữ liệu vận hành của khách hàng. Chúng đo **đúng hiện tượng dao động** — thứ đếm được không phụ thuộc kịch bản — chứ không đo hiệu quả tổng thể của hệ.

**Kết quả phụ, đo được và trái với trực giác ban đầu:** chi phí của việc sạc **không phụ thuộc mức pin trung bình của đội, mà phụ thuộc phân bố pin**.

| Phân bố pin lúc bắt đầu mẻ | Thời gian hoàn thành mẻ |
|---|---|
| Cao, **hoặc lệch** (vài xe thấp, phần còn lại cao) | ~455–520 giây |
| Thấp nhưng còn ~3 xe khoẻ | ~543 giây |
| **Cả đội cùng cạn** | ~615–630 giây |

Đội lệch pin gần như không tốn gì — xe khoẻ gánh thay. Chỉ khi **cả đội cùng qua ngưỡng một lúc** mới có bậc nhảy, và **dấu vân tay của nó rất rõ**:

```
thời gian mỗi việc  :  KHÔNG đổi   ⇒  xe không hề chạy chậm hơn
thời gian chờ xe    :  phình ra    ⇒  xe chỉ đơn giản là VẮNG MẶT
```

Xe chạy chậm và xe vắng mặt đẩy thời gian hoàn thành mẻ **giống hệt nhau** — hai nguyên nhân khác nhau, hai cách chữa khác nhau, một con số duy nhất. Chỉ khi tách hai chỉ số này ra mới phân biệt được, và đó là cách bậc nhảy trên được quy đúng cho việc sạc.

**Concept:**

- **Churn (dao động phát lệnh)** — hệ thống phát lệnh rồi tự rút lại, lặp đi lặp lại. Nó không làm hỏng kết quả cuối, nên không bao giờ xuất hiện trong chỉ số "tỉ lệ thành công" — chỉ lộ ra khi đếm **lệnh trên mỗi đơn vị công việc thật**.
- **Sổ giữ chỗ dùng chung** — một chỗ đỗ được ghi vào một sổ duy nhất mà **mọi** bộ máy đều đọc, và chỗ chỉ được nhả khi xe **tới nơi**, không phải khi có tín hiệu mơ hồ. Hai bộ máy giữ hai sổ riêng thì tất yếu phát trùng.
- **Fail closed** — sổ giữ chỗ rỗng **không** có nghĩa là "không ai giữ chỗ nào"; nó có thể chỉ là chưa dựng lại được sau khi khởi động. Khi chưa chắc, hệ thống từ chối phát lệnh mới thay vì cho qua.
- **Lệnh đỗ là loại lệnh có thể bị thay thế** — lệnh đỗ được đánh dấu là **bỏ được**: có việc thật tới thì tầng dưới tự bỏ lệnh đỗ để nhận việc. Nhờ vậy phần lớn "thu hồi lệnh đỗ" xảy ra **không tốn một lần gọi nào** và không phải một cuộc chạy đua giữa hai bên.
- **Thời gian hoàn thành mẻ là chỉ số hợp thành** — nó cộng gộp nhiều nguyên nhân độc lập, nên một mình nó không kết luận được điều gì. Hai chỉ số phân giải được nó là **thời gian mỗi việc** (xe đi nhanh hay chậm) và **thời gian chờ xe** (có xe rảnh hay không).
