# PRD

## 1. Overview

Tài liệu này mô tả Product Requirements Document (PRD) cho hệ thống điều phối AGV trong môi trường kho/xưởng.

Hệ thống được xây dựng để hỗ trợ bài toán vận chuyển hàng hóa đã được đặt sẵn tại các điểm lấy hàng. Sau khi nhận thông tin từ thao tác quét mã, hệ thống tạo yêu cầu vận chuyển, xác định vị trí trả hàng phù hợp, gửi yêu cầu thực thi sang openTCS, và theo dõi quá trình vận hành của đội AGV.

Phạm vi của hệ thống bao gồm quản lý đội AGV, quản lý warehouse map và location, quản lý yêu cầu vận chuyển, điều phối và routing ở mức orchestration, theo dõi dashboard vận hành thời gian thực, và tích hợp với openTCS.

Trong phạm vi hiện tại, hệ thống này đóng vai trò là lớp quản lý và điều phối bên trên, trong khi openTCS chịu trách nhiệm fleet execution và giao tiếp thực thi với AGV.

Trong giai đoạn hiện tại, hệ thống được kiểm thử chủ yếu trên AGV ảo. Vì vậy, phạm vi PRD này chưa bao gồm việc xử lý các lỗi vật lý thực tế của AGV như mất line, lệch vị trí, hỏng phần cứng, hoặc các lỗi vận hành phát sinh từ thiết bị thật. Dù AGV ảo có thể mô phỏng một số tình huống lỗi, các kịch bản đó không nằm trong phạm vi xử lý chính của giai đoạn này.

## 2. Problem Statement

Bài toán hiện tại là điều phối AGV để lấy hàng từ khu lấy hàng và vận chuyển đến vị trí phù hợp trong khu trả hàng, dựa trên thông tin phát sinh từ thao tác quét mã và các quy tắc vận hành thực tế trong kho.

Trong quá trình vận hành, hệ thống cần đồng thời xử lý nhiều ràng buộc như hướng tiếp cận, thứ tự lấy hàng, quy tắc sắp xếp vị trí trả hàng, khả năng di chuyển của AGV, và luồng giao thông trong kho. Các ràng buộc này khiến việc điều phối không chỉ là gửi lệnh di chuyển, mà còn là bài toán tối ưu khả năng thực thi trong điều kiện không gian và lưu lượng thực tế.

Hiện tại, việc thực thi dựa nhiều vào cơ chế mặc định của openTCS, bao gồm greedy dispatch và dijkstra routing. Cách tiếp cận này có thể hoạt động ở mức cơ bản, nhưng chưa phù hợp hoàn toàn với đặc thù vận hành hiện tại. Các vấn đề chính đang gặp phải bao gồm deadlock, tắc nghẽn, throughput thấp trong giờ cao điểm, và tỷ lệ thất bại cao ở một số nhóm lệnh vận hành.

Một vấn đề quan trọng khác là greedy dispatch hiện tại ra quyết định gán việc dựa trên trạng thái tức thời như AGV đang rảnh, đủ pin, và gần điểm lấy nhất, nhưng chưa mô hình hóa đầy đủ quan hệ phụ thuộc vật lý giữa các hàng trong cùng khu lấy hàng. Trong thực tế, có những trường hợp hàng phía trong chỉ có thể được lấy sau khi hàng phía ngoài đã được lấy trước. Nếu hệ thống vẫn tiếp tục gán yêu cầu mới cho AGV gần nhất tại thời điểm đó, thứ tự gán việc logic có thể mâu thuẫn với thứ tự thực thi thực tế ngoài hiện trường.

Điều này dẫn đến hiện tượng out-of-order pickup: một AGV được giao lấy một hàng phía trong nhưng khi tiếp cận thực tế lại gặp hàng phía ngoài trước do không thể đi xuyên qua hàng. Để xử lý tình huống này, hệ thống phải bổ sung cơ chế switch order trong lúc vận hành. Tuy nhiên, đây chỉ là một cơ chế khắc phục hậu quả của quyết định điều phối ban đầu, đồng thời làm tăng mạnh độ phức tạp xử lý trạng thái giữa yêu cầu vận chuyển, AGV, thứ tự hàng hóa, và đồng bộ với openTCS. Cơ chế này cũng là nguồn phát sinh nhiều lỗi trong hệ thống hiện tại.

Ngoài ra, bài toán còn có các ràng buộc nghiệp vụ đặc thù như AGV không thể đi xuyên qua hàng, hàng cần được lấy theo thứ tự ngoài cùng hoặc gần lối ra nhất, và vị trí trả hàng cần được phân bổ theo quy tắc không gian xác định trước. Nếu không có lớp quản lý và điều phối phù hợp ở phía trên openTCS, hệ thống sẽ khó đảm bảo tính đúng đắn nghiệp vụ và hiệu quả vận hành tổng thể.

Vì vậy, cần xây dựng một hệ thống quản lý và điều phối bên trên openTCS nhằm kiểm soát tốt hơn việc tạo yêu cầu vận chuyển, lựa chọn điểm lấy và điểm trả, tổ chức luồng vận hành, giám sát realtime, và hỗ trợ cải thiện hiệu quả điều phối AGV trong môi trường thực tế.

## 3. Goals and Non-Goals

### 3.1 Goals

- Xây dựng một lớp quản lý và điều phối bên trên openTCS, phù hợp với đặc thù vận hành thực tế của bài toán.
- Quản lý đội AGV, bản đồ vận hành, location, và yêu cầu vận chuyển trong cùng một hệ thống thống nhất.
- Đảm bảo việc tạo và xử lý yêu cầu vận chuyển tuân theo các ràng buộc nghiệp vụ và ràng buộc vật lý của kho.
- Giảm các trường hợp điều phối sai thứ tự lấy hàng do greedy dispatch không phản ánh đúng quan hệ phụ thuộc giữa các hàng.
- Hạn chế nhu cầu sử dụng các cơ chế sửa thứ tự trong lúc chạy như switch order.
- Cải thiện hiệu quả điều phối tổng thể, đặc biệt ở các chỉ số như throughput, fail rate, assign time, và completion time.
- Hỗ trợ giám sát vận hành theo thời gian thực thông qua dashboard và live preview.
- Tích hợp với openTCS theo hướng rõ ràng vai trò: hệ thống của bạn quản lý và điều phối nghiệp vụ, openTCS thực thi đội xe.

### 3.2 Non-Goals

- Không thay thế hoàn toàn openTCS trong vai trò fleet execution hoặc giao tiếp điều khiển mức thấp với AGV.
- Không tập trung phát triển hoặc thay thế toàn bộ thuật toán lõi bên trong openTCS trong giai đoạn này.
- Không xử lý các lỗi vật lý thực tế của AGV như hỏng phần cứng, mất line, lệch vị trí, hoặc các sự cố cơ khí/điện tử trên xe thật.
- Không bao gồm các kịch bản kiểm thử hoặc vận hành chuyên sâu trên AGV thật trong phạm vi chính của giai đoạn hiện tại.
- Không xây dựng phạm vi quản lý kho toàn diện theo kiểu WMS, như quản lý tồn kho đầy đủ, tối ưu slotting, hoặc nghiệp vụ kho ngoài bài toán điều phối AGV hiện tại.
- Không giải quyết mọi trường hợp deadlock hoặc tắc nghẽn chỉ bằng tối ưu routing; hệ thống cần kết hợp cả logic điều phối ở tầng nghiệp vụ.

## 4. Users / Actors

Hệ thống hiện tại có hai actor chính tham gia vào quá trình vận hành:

- `Operator`: là người vận hành trực tiếp tại hiện trường. Operator thực hiện quét mã để phát sinh yêu cầu vận chuyển và theo dõi trạng thái vận hành ở mức cơ bản.
- `Admin`: là người cấu hình và quản trị hệ thống. Admin quản lý đội AGV, bản đồ vận hành, location, rule điều phối, dashboard theo dõi, và cấu hình tích hợp với openTCS.

## 5. Operational Context

Môi trường vận hành của hệ thống được xây dựng trên một tập hợp các grid QR dùng để định vị AGV. Mỗi AGV di chuyển và xác định vị trí của mình dựa trên các QR grid này trong bản đồ vận hành.

Khu lấy hàng và khu trả hàng được tổ chức dưới dạng các vùng gồm nhiều QR grid. Trong đó, chỉ một số vùng hoặc một số QR cụ thể mới được định nghĩa là nơi AGV được phép thực hiện hành động nghiệp vụ như lấy hàng hoặc trả hàng. Nói cách khác, không phải mọi QR trên bản đồ đều là điểm thao tác; phần lớn chỉ đóng vai trò định vị và dẫn đường.

Các ràng buộc điều hướng như hướng di chuyển, cho phép đi một chiều hay hai chiều, giới hạn số lượng AGV trong một block, hoặc chỉ cho phép di chuyển theo một hướng trong một số khu vực, không được quyết định cứng trong logic nghiệp vụ mà phụ thuộc hoàn toàn vào cấu hình map. Vì vậy, hành vi navigation của AGV được chi phối trực tiếp bởi topology và rule đã được cấu hình trên bản đồ.

Bên cạnh các ràng buộc navigation từ map config, bài toán còn có một ràng buộc nghiệp vụ quan trọng là AGV không thể đi xuyên qua hàng. Ràng buộc này ảnh hưởng trực tiếp đến logic xác định hàng nào có thể được lấy trước, thứ tự lấy hàng trong cùng một khu, và tính khả thi thực tế của yêu cầu vận chuyển.

## 6. End-to-End Business Flow

Luồng nghiệp vụ tổng thể bắt đầu từ thao tác quét mã tại hiện trường. Operator trước tiên quét QR code dưới sàn để xác định vị trí hiện tại của hàng, sau đó quét barcode trên hàng tại vị trí đó. Sau hai thao tác này, hệ thống phía hiện trường đã có đủ thông tin tối thiểu để phát sinh một yêu cầu vận chuyển thông qua API, bao gồm:

- hàng đang ở QR nào
- hàng cần được đưa đến location nào

Từ góc nhìn tích hợp, phần mềm chỉ cần cung cấp API để gửi lên hai input chính là vị trí hiện tại của hàng và location đích. Thành phần gọi API không cần biết AGV nào sẽ thực hiện, hàng sẽ được đưa đến QR cụ thể nào bên trong location, hoặc tuyến đường sẽ được tính như thế nào.

Sau khi nhận request, hệ thống quản lý và điều phối ở tầng trên sẽ tiếp nhận yêu cầu, kiểm tra tính hợp lệ nghiệp vụ, và chuyển yêu cầu đó sang luồng xử lý tiếp theo. Các quyết định kỹ thuật sau đó, như chọn điểm trả cụ thể bên trong location, tổ chức điều phối, và xử lý các logic vận hành liên quan, thuộc trách nhiệm của `WES`.

Ở tầng thực thi đội xe, `FMS (openTCS)` chịu trách nhiệm nhận yêu cầu đã được chuẩn bị, thực hiện dispatch, routing, và điều khiển AGV hoàn tất nhiệm vụ. Khi AGV hoàn thành hoặc phát sinh trạng thái trong quá trình vận hành, các trạng thái này sẽ được đồng bộ ngược trở lại hệ thống để phục vụ theo dõi và giám sát.

Tóm lại, ranh giới trách nhiệm trong luồng nghiệp vụ được xác định như sau:

- `Operator / API caller`: cung cấp dữ liệu đầu vào tại hiện trường
- `WES`: tiếp nhận yêu cầu, áp dụng logic nghiệp vụ và điều phối ở tầng trên
- `FMS (openTCS)`: thực hiện dispatch, routing, và execution với đội AGV

## 7. Major Features

Phạm vi hiện tại của hệ thống được tổ chức thành 7 major features:

- `FE-01` AGV Fleet Management
- `FE-02` Warehouse Map & Topology Management
- `FE-03` Transport Request Management
- `FE-04` Traffic Routing & Dispatch Orchestration
- `FE-06` Operational Monitoring Dashboard
- `FE-07` User & Access Management
- `FE-08` Event Log & Audit Trail

## 8. Functional Requirements

### FE-01 AGV Fleet Management

- Hệ thống phải quản lý danh sách tất cả AGV đang kết nối hoặc đang được theo dõi trong hệ thống.
- Hệ thống phải hiển thị và cập nhật theo thời gian thực các thông tin vận hành cơ bản của từng AGV, bao gồm mã xe, trạng thái hiện tại, vị trí hiện tại, mức pin, và khả năng tham gia điều phối.
- Hệ thống phải cho phép Admin cấu hình AGV có được phép nhận yêu cầu vận chuyển hay không.
- Hệ thống phải cho phép Admin cấu hình cách AGV được xử lý trong giám sát và điều phối, bao gồm hiển thị trên bản đồ nhưng vẫn chiếm resource, hoặc bị ignore khỏi phạm vi điều phối nghiệp vụ.
- Hệ thống phải phân biệt giữa AGV bị loại khỏi điều phối nghiệp vụ và AGV không hoạt động thực tế, đồng thời vẫn tiếp tục ghi nhận trạng thái từ các AGV đang active ở tầng thực thi.
- Hệ thống phải cho phép cấu hình các ngưỡng pin vận hành, áp dụng các ngưỡng này vào logic sạc và khả năng tham gia điều phối, đồng thời lưu và hiển thị lịch sử trạng thái, hoạt động, và lỗi của AGV.

### FE-02 Warehouse Map & Topology Management

- Hệ thống phải quản lý bản đồ vận hành dựa trên tập hợp các grid QR dùng cho định vị và di chuyển của AGV.
- Hệ thống phải cho phép Operator và Admin cấu hình các thực thể topology cần thiết cho vận hành, bao gồm ít nhất point, path, block, và location.
- Hệ thống phải cho phép xác định QR hoặc vùng QR nào được dùng cho định vị, dẫn đường, hoặc thao tác nghiệp vụ như lấy hàng, trả hàng, và sạc.
- Hệ thống phải cho phép cấu hình point như điểm đỗ hoặc điểm định vị, path như liên kết một chiều hoặc hai chiều giữa các point, và phân biệt rõ giữa khả năng đi lùi trên path với hành vi xoay đầu của AGV.
- Hệ thống phải cho phép cấu hình location như một tập hợp point phục vụ hành động nghiệp vụ và block như một tập hợp rule navigation áp lên một nhóm point hoặc path.
- Hệ thống phải phản ánh đúng các ràng buộc topology và rule không gian đã cấu hình vào logic điều phối và giám sát, bao gồm rule không đi xuyên hàng và hướng tiếp cận của khu lấy/trả hàng.
- Hệ thống phải hiển thị topology vận hành trên giao diện quản trị để phục vụ cấu hình, kiểm tra, và đối soát với layout thực tế.

### FE-03 Transport Request Management

- Hệ thống phải cung cấp API để tiếp nhận yêu cầu vận chuyển từ các thành phần bên ngoài.
- Hệ thống phải hỗ trợ tiếp nhận tối thiểu các thông tin đầu vào gồm vị trí hiện tại của hàng và location đích.
- Hệ thống phải kiểm tra tính hợp lệ của dữ liệu đầu vào trước khi tạo và lưu trữ yêu cầu vận chuyển.
- Hệ thống phải gán mã định danh và quản lý vòng đời của từng yêu cầu vận chuyển trong hệ thống.
- Hệ thống phải cho phép Operator và Admin xem danh sách, thông tin chi tiết, và trạng thái hiện tại của các yêu cầu vận chuyển.
- Hệ thống phải lưu các mốc thời gian chính, hỗ trợ phân loại theo trạng thái xử lý, và ghi nhận các trường hợp yêu cầu không hợp lệ hoặc không thể xử lý.
- Hệ thống phải cho phép hủy hoặc dừng xử lý một yêu cầu vận chuyển trong các trạng thái phù hợp.
- Hệ thống phải xác định được điểm lấy hàng hợp lệ từ dữ liệu đầu vào của yêu cầu vận chuyển.
- Hệ thống phải xác định được location đích và điểm trả hàng cụ thể phù hợp với các rule đã cấu hình.
- Hệ thống phải chỉ cho phép các quyết định lấy/trả hàng khả thi về mặt vật lý và phù hợp với topology vận hành.

### FE-04 Traffic Routing & Dispatch Orchestration

- Hệ thống phải điều phối yêu cầu vận chuyển theo logic nghiệp vụ và ràng buộc vận hành thực tế, thay vì chỉ dựa trên tối ưu cục bộ tại thời điểm gán việc.
- Hệ thống phải xét đến các quan hệ phụ thuộc giữa các hàng trong cùng khu lấy hàng để tổ chức thứ tự thực hiện phù hợp với khả năng tiếp cận thực tế.
- Hệ thống không được tạo hoặc đẩy xuống tầng thực thi các yêu cầu vận chuyển dẫn đến thứ tự lấy hàng không khả thi về mặt vật lý hoặc có nguy cơ out-of-order pickup.
- Hệ thống phải giảm nhu cầu sử dụng cơ chế switch order bằng cách kiểm soát thứ tự xử lý và điều tiết luồng điều phối trước khi đưa yêu cầu vào thực thi.
- Hệ thống phải xét đến topology, block, hướng di chuyển, và năng lực tiếp cận của từng khu vực để tránh over-assignment và hạn chế ùn tắc cục bộ.
- Hệ thống phải hỗ trợ phối hợp với tầng thực thi để xử lý các tình huống route không khả thi, congestion, hoặc deadlock, đồng thời hướng tới cải thiện throughput tổng thể.
- Hệ thống phải cho phép Admin cấu hình các rule điều phối chính và giám sát các tình huống điều phối bất thường như dồn nhiều AGV vào cùng một khu hoặc chờ thực thi quá lâu.
- Hệ thống phải áp dụng các rule không gian nghiệp vụ, bao gồm rule không đi xuyên hàng và thứ tự tiếp cận thực tế trong khu lấy hàng.
- Hệ thống phải quản lý trạng thái khả dụng của các point hoặc location dùng cho các hành động nghiệp vụ như lấy hàng, trả hàng, hoặc sạc.

### FE-06 Operational Monitoring Dashboard

- Hệ thống phải cung cấp dashboard vận hành theo thời gian thực để hỗ trợ theo dõi toàn bộ hệ thống.
- Hệ thống phải hiển thị live preview của đội AGV và topology vận hành trên bản đồ hoặc canvas.
- Hệ thống phải hiển thị các thông tin vận hành chính, bao gồm trạng thái AGV, trạng thái yêu cầu vận chuyển, và tình trạng các khu vực vận hành.
- Hệ thống phải cung cấp các chỉ số giám sát chính như throughput, fail rate, assign time, và completion time.
- Hệ thống phải hỗ trợ phát hiện và hiển thị các tín hiệu bất thường trong vận hành, như hotspot, ùn tắc, hoặc AGV lỗi nhiều.

### FE-07 User & Access Management

- Hệ thống phải cho phép người dùng đăng nhập bằng tài khoản và mật khẩu, đồng thời quản lý phiên đăng nhập và cho phép đăng xuất.
- Hệ thống phải cho phép người dùng xem và cập nhật thông tin cá nhân của chính mình.
- Hệ thống phải cho phép người dùng tự đổi mật khẩu sau khi xác thực mật khẩu hiện tại.
- Hệ thống phải hỗ trợ luồng quên mật khẩu, cho phép người dùng yêu cầu đặt lại mật khẩu thông qua cơ chế xác thực an toàn.
- Hệ thống phải cho phép Admin quản lý tài khoản người dùng, bao gồm tạo, cập nhật, xóa, khóa, và mở khóa tài khoản.
- Hệ thống phải hỗ trợ phân quyền theo vai trò, cho phép gán và gỡ vai trò cho từng người dùng.
- Hệ thống phải cho phép Admin đặt lại mật khẩu cho người dùng.

### FE-08 Event Log & Audit Trail

- Hệ thống phải ghi nhận toàn bộ sự kiện vận hành và thao tác người dùng vào nhật ký hệ thống.
- Hệ thống phải cho phép Operator và Admin xem, tìm kiếm, và lọc nhật ký sự kiện.
- Hệ thống phải lưu lịch sử thay đổi của các thực thể quan trọng như AGV, topology, và cấu hình điều phối.
- Hệ thống phải hỗ trợ xuất báo cáo nhật ký phục vụ kiểm tra và truy vết sự cố.

## 9. Business Rules

- Khu lấy hàng và khu trả hàng được tổ chức theo dạng hình chữ nhật.
- Việc lấy hàng và trả hàng được thực hiện theo nguyên tắc line by line.
- Đối với khu lấy hàng, hàng phải được lấy theo thứ tự từ ngoài vào trong, tương ứng với việc ưu tiên lấy từ hàng ở dưới lên trước theo hướng tiếp cận thực tế.
- Hệ thống không được cho phép lấy các hàng nằm phía trong nếu các hàng phía ngoài chưa được lấy, do AGV không thể đi xuyên qua hàng.
- Đối với khu trả hàng, hàng phải được trả từ phía trong ra trước để tối ưu không gian đặt hàng.

## 10. Use Cases

### FE-01 AGV Fleet Management

| ID    | Use Case                          |
| ----- | --------------------------------- |
| UC-01 | Tạo AGV                           |
| UC-02 | Cập nhật thông tin AGV            |
| UC-03 | Xóa AGV                           |
| UC-04 | Xem danh sách AGV                 |
| UC-05 | Xem chi tiết AGV                  |
| UC-06 | Cấu hình ngưỡng pin vận hành      |
| UC-07 | Cấu hình ngưỡng pin sạc           |
| UC-08 | Cho phép AGV nhận lệnh            |
| UC-09 | Dừng AGV nhận lệnh                |
| UC-10 | Ignore AGV khỏi hệ thống          |
| UC-11 | Khôi phục AGV bị ignore           |
| UC-12 | Xem trạng thái nhận lệnh của AGV  |
| UC-13 | Tìm kiếm AGV                      |
| UC-14 | Lọc AGV theo trạng thái           |
| UC-15 | Xem lịch sử hoạt động AGV         |
| UC-16 | Xem lịch sử lỗi AGV               |

### FE-02 Warehouse Map & Topology Management

**Map Management**

| ID    | Use Case                              |
| ----- | ------------------------------------- |
| UC-17 | Upload bản đồ vận hành mới            |
| UC-18 | Thay thế bản đồ vận hành hiện tại     |

**Point Management**

| ID    | Use Case                                  |
| ----- | ----------------------------------------- |
| UC-19 | Tạo point trên bản đồ vận hành            |
| UC-20 | Cập nhật point trên bản đồ vận hành       |
| UC-21 | Xóa point trên bản đồ vận hành            |
| UC-22 | Xem danh sách point trên bản đồ vận hành  |
| UC-23 | Xem chi tiết point trên bản đồ vận hành   |

**Path Management**

| ID    | Use Case                                  |
| ----- | ----------------------------------------- |
| UC-24 | Tạo path trên bản đồ vận hành             |
| UC-25 | Cập nhật path trên bản đồ vận hành        |
| UC-26 | Xóa path trên bản đồ vận hành             |
| UC-27 | Xem danh sách path trên bản đồ vận hành   |
| UC-28 | Xem chi tiết path trên bản đồ vận hành    |
| UC-29 | Cấu hình one-way path                     |
| UC-30 | Cấu hình bidirectional path               |

**Location Management**

| ID    | Use Case                         |
| ----- | -------------------------------- |
| UC-31 | Tạo location nghiệp vụ           |
| UC-32 | Cập nhật location nghiệp vụ      |
| UC-33 | Xóa location nghiệp vụ           |
| UC-34 | Xem danh sách location nghiệp vụ |
| UC-35 | Xem chi tiết location nghiệp vụ  |
| UC-36 | Gán point vào location           |
| UC-37 | Gỡ point khỏi location           |

**Block Management**

| ID    | Use Case                         |
| ----- | -------------------------------- |
| UC-38 | Tạo block topology               |
| UC-39 | Cập nhật block topology          |
| UC-40 | Xóa block topology               |
| UC-41 | Xem danh sách block topology     |
| UC-42 | Xem chi tiết block topology      |

### FE-03 Transport Request Management

| ID    | Use Case                                                                      |
| ----- | ----------------------------------------------------------------------------- |
| UC-43 | Operator tạo yêu cầu vận chuyển từ dữ liệu quét mã                            |
| UC-44 | Operator tạo yêu cầu vận chuyển thủ công                                      |
| UC-45 | Operator hoặc Admin xem danh sách yêu cầu vận chuyển                          |
| UC-46 | Operator hoặc Admin xem chi tiết yêu cầu vận chuyển                           |
| UC-47 | Operator hoặc Admin tìm kiếm yêu cầu vận chuyển                               |
| UC-48 | Operator hoặc Admin lọc yêu cầu vận chuyển                                    |
| UC-49 | Operator hoặc Admin hủy yêu cầu vận chuyển                                    |
| UC-50 | Operator hoặc Admin xem danh sách yêu cầu vận chuyển không hợp lệ             |
| UC-51 | Operator hoặc Admin xem chi tiết nguyên nhân yêu cầu vận chuyển không hợp lệ  |
| UC-52 | Operator hoặc Admin xem AGV được phân công cho yêu cầu vận chuyển             |
| UC-53 | Operator hoặc Admin xem tiến độ thực hiện yêu cầu vận chuyển                  |
| UC-54 | Operator hoặc Admin xem lý do yêu cầu chưa được nhận thực hiện                |
| UC-55 | Operator hoặc Admin xem điểm lấy hàng được chọn cho yêu cầu vận chuyển        |
| UC-56 | Operator hoặc Admin xem điểm trả hàng được chọn cho yêu cầu vận chuyển        |
| UC-57 | Operator hoặc Admin xem nguyên nhân yêu cầu không có điểm lấy/trả hợp lệ      |

### FE-04 Traffic Routing & Dispatch Orchestration

| ID    | Use Case                                                        |
| ----- | --------------------------------------------------------------- |
| UC-58 | Admin cấu hình chính sách điều phối AGV                         |
| UC-59 | Admin cập nhật chính sách điều phối AGV                         |
| UC-60 | Admin xem hàng đợi điều phối yêu cầu vận chuyển                 |
| UC-61 | Admin xem chi tiết một yêu cầu trong hàng đợi điều phối         |
| UC-62 | Admin xem các yêu cầu bị chặn điều phối                         |
| UC-63 | Admin xem lý do yêu cầu bị giữ lại                              |
| UC-64 | Admin xem cảnh báo ùn tắc giao thông                            |
| UC-65 | Admin xem cảnh báo nguy cơ deadlock                             |
| UC-66 | Admin xem tuyến đường dự kiến của AGV                           |
| UC-67 | Admin xem lý do hệ thống chọn AGV cho yêu cầu vận chuyển        |
| UC-68 | Admin quản lý trạng thái khả dụng của station/location          |

### FE-06 Operational Monitoring Dashboard

| ID    | Use Case                                                          |
| ----- | ----------------------------------------------------------------- |
| UC-69 | Operator/Admin xem dashboard vận hành tổng quan                   |
| UC-70 | Operator/Admin xem bản đồ vận hành thời gian thực                 |
| UC-71 | Operator/Admin xem live preview AGV trên bản đồ                   |
| UC-72 | Operator/Admin xem KPI số lượng yêu cầu hoàn thành               |
| UC-73 | Operator/Admin xem KPI thời gian vận chuyển trung bình            |
| UC-74 | Operator/Admin xem KPI tỷ lệ sử dụng AGV                         |
| UC-75 | Operator/Admin xem KPI số lượng AGV đang hoạt động               |
| UC-76 | Operator/Admin xem KPI tỷ lệ thất bại yêu cầu vận chuyển         |
| UC-77 | Operator/Admin xem KPI thời gian chờ phân công AGV trung bình     |
| UC-78 | Operator/Admin xem KPI throughput theo khung giờ                  |
| UC-79 | Operator/Admin xem danh sách khu vực ùn tắc hoặc hotspot          |
| UC-80 | Operator/Admin xem danh sách AGV có tần suất lỗi cao              |

### FE-07 User & Access Management

**Account & Profile (Operator, Admin)**

| ID    | Use Case                                  |
| ----- | ----------------------------------------- |
| UC-81 | Đăng nhập hệ thống                        |
| UC-82 | Đăng xuất hệ thống                        |
| UC-83 | Xem thông tin cá nhân                     |
| UC-84 | Cập nhật thông tin cá nhân (profile)      |
| UC-85 | Đổi mật khẩu                              |
| UC-86 | Quên mật khẩu / yêu cầu đặt lại mật khẩu  |

**User Administration (Admin)**

| ID    | Use Case                                  |
| ----- | ----------------------------------------- |
| UC-87 | Tạo tài khoản người dùng                  |
| UC-88 | Cập nhật tài khoản người dùng             |
| UC-89 | Xóa tài khoản người dùng                  |
| UC-90 | Xem danh sách người dùng                  |
| UC-91 | Xem chi tiết người dùng                   |
| UC-92 | Khóa tài khoản người dùng                 |
| UC-93 | Mở khóa tài khoản người dùng              |
| UC-94 | Gán vai trò cho người dùng                |
| UC-95 | Gỡ vai trò khỏi người dùng                |
| UC-96 | Đặt lại mật khẩu người dùng               |

### FE-08 Event Log & Audit Trail

| ID     | Use Case                                      |
| ------ | --------------------------------------------- |
| UC-97  | Xem danh sách sự kiện hệ thống                |
| UC-98  | Xem chi tiết sự kiện hệ thống                 |
| UC-99  | Tìm kiếm sự kiện hệ thống                     |
| UC-100 | Lọc sự kiện hệ thống                          |
| UC-101 | Xem lịch sử thay đổi AGV                      |
| UC-102 | Xem lịch sử thay đổi topology                 |
| UC-103 | Xem lịch sử thay đổi cấu hình điều phối       |
| UC-104 | Xem lịch sử thao tác người dùng               |
| UC-105 | Xem chi tiết một phiên thao tác người dùng    |
| UC-106 | Xuất báo cáo nhật ký hệ thống                 |

## 11. Success Metrics

### 11.1 Current Baseline

- Dữ liệu hiện có bao phủ từ `2026-04-13` đến `2026-05-18`.
- Ngày tải cao nhất hiện ghi nhận là `2026-04-21`.
- Trong ngày `2026-04-21`, tổng số yêu cầu vận chuyển là `1874`.
- Trong ngày `2026-04-21`, số yêu cầu hoàn tất là `1044`.
- Trong ngày `2026-04-21`, số yêu cầu thất bại là `829`, tương đương fail rate khoảng `44.2%`.
- Trong ngày `2026-04-21`, thời gian trung bình từ tạo yêu cầu đến khi được assign là `309` giây.
- Trong ngày `2026-04-21`, thời gian hoàn tất end-to-end trung bình là `780` giây.
- Trong ngày `2026-04-21`, thời gian trung bình từ sau khi assign đến hoàn tất là `255` giây.
- Số lượng AGV active hiện ghi nhận là `11`.
- Khung giờ suy giảm nghiêm trọng hiện ghi nhận là từ `05:00` đến `06:59` ngày `2026-04-21`.
- Trong ngày `2026-04-21`, nhóm lệnh `Charge` và `Park` có tỷ lệ thất bại cao bất thường so với nhóm lệnh vận chuyển chính.
- Trong ngày `2026-04-21`, dữ liệu vehicle history cho thấy tần suất trạng thái `ERROR` lặp lại cao, trong đó `E_STOP` là lỗi nổi bật nhất.

### 11.2 Success Metrics To Improve

- Giảm fail rate tổng thể của yêu cầu vận chuyển so với baseline hiện tại.
- Giảm thời gian trung bình từ lúc tạo yêu cầu đến lúc được đưa vào thực thi.
- Giảm thời gian hoàn tất end-to-end của yêu cầu vận chuyển.
- Tăng throughput trong các khung giờ tải cao, đặc biệt ở các khung giờ tương tự `05:00` đến `06:59`.
- Giảm số lượng yêu cầu bị giữ quá lâu trong hàng chờ orchestration.
- Giảm số lượng tình huống out-of-order pickup phải xử lý bằng logic khắc phục như switch order.
- Giảm số lượng khu vực hoặc line xuất hiện tín hiệu ùn tắc và deadlock trong quá trình vận hành.
- Tăng tính ổn định của điều phối trên cùng quy mô đội xe hiện tại là `11` AGV hoặc cao hơn trong tương lai.

### 11.3 Notes

- Các target số cụ thể cho từng metric sẽ được chốt ở giai đoạn tiếp theo sau khi thống nhất baseline đo lường và phạm vi thử nghiệm.
- Trong giai đoạn hiện tại, mục tiêu chính của success metrics là chứng minh hệ thống orchestration mới cải thiện hiệu quả vận hành so với cơ chế mặc định hiện tại.
