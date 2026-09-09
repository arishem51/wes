# Deploy WES lên server dev

Gói này chạy frontend, backend, PostgreSQL và một openTCS kernel trong một Docker Compose project riêng. Kernel dùng broker MQTT có sẵn qua external network `fms_default`; stack WES không tạo, restart hay xóa broker đó. Tên container, network và volume của WES đều được Compose thêm prefix từ `COMPOSE_PROJECT_NAME`, vì vậy có thể chạy cạnh các kernel khác.

Cấu trúc này kế thừa cách tách service và cổng demo của `FMS-SRC`. REST của WES kernel chạy ở `59200` để tránh các kernel trên server đang dùng `55200`, `56200`, `57200` và `58200`. RMI registry dùng `1499`; toàn bộ RMI service dùng chung port `59000`. REST và RMI mặc định chỉ được publish trên loopback.

## Chuẩn bị server

- Linux x86_64 có Docker Engine và Docker Compose v2.
- Đăng nhập Docker Hub bằng tài khoản có quyền pull các image private trong namespace `aubot`.
- Các cổng trong `deploy/.env.dev` chưa bị tiến trình khác sử dụng.

Server chỉ cần bundle deploy, không cần source của frontend/backend/openTCS:

```text
~/products/wes-fms/
├── compose.dev.yml
├── database/
│   └── schema.sql
├── downloads/
│   ├── opentcs-wes-clients-dev-20260908-01.zip
│   ├── opentcs-wes-modeleditor-dev-20260908-01.zip
│   └── opentcs-wes-operationsdesk-dev-20260908-01.zip
└── deploy/
    ├── .env.dev.example
    ├── .env.dev
    └── opentcs-kernel.properties
```

## Cấu hình

```bash
cd ~/products/wes-fms
cp deploy/.env.dev.example deploy/.env.dev
chmod 600 deploy/.env.dev
```

Sửa tối thiểu các biến sau:

- `COMPOSE_PROJECT_NAME`: duy nhất trên server, chỉ dùng chữ thường, số, dấu `-` hoặc `_`.
- `DOCKERHUB_NAMESPACE`: tài khoản hoặc organization trên Docker Hub.
- `IMAGE_TAG`: cùng một version cho frontend, backend và openTCS, ví dụ commit SHA.
- `PUBLIC_URL`: URL mà người dùng mở frontend.
- `WES_HTTP_PORT`: cổng web trên server.
- `OPENTCS_HTTP_PORT`: cổng REST debug của kernel, chỉ bind loopback theo mặc định.
- `OPENTCS_RMI_BIND_ADDRESS`: địa chỉ Tailscale của server, hiện là `100.92.46.11`.
- `OPENTCS_RMI_ADVERTISED_HOST`: địa chỉ được ghi vào RMI stub, hiện là `100.92.46.11`.
- `MQTT_NETWORK_NAME`: Docker network đang chứa `mqtt-broker`, hiện là `fms_default`.
- `POSTGRES_PASSWORD` và `JWT_SECRET`: không dùng giá trị mẫu.

Kiểm tra xung đột cổng trước khi chạy:

```bash
ss -ltn | grep -E ':(1499|18080|59000|59200)\b' || true
```

## Cập nhật `opentcs-kernel.properties` lên server

File này được bind-mount read-only vào kernel (`./deploy/opentcs-kernel.properties` → `/opt/opentcs/config/opentcs-kernel.properties`). Kernel chỉ đọc nó lúc khởi động, nên sau khi copy phải recreate service `opentcs` thì cấu hình mới có hiệu lực.

Chạy từ thư mục `wes/` trên máy dev:

```bash
scp deploy/opentcs-kernel.properties root@171.244.54.218:~/products/wes-fms/deploy/
```

Trên PowerShell, bước 3 phía máy dev dùng `Get-FileHash deploy\opentcs-kernel.properties -Algorithm MD5` thay cho `md5sum`.

## Build và push image

Chạy trên máy build hoặc CI có đủ ba repository:

```bash
docker login
docker compose --env-file deploy/.env.dev \
  -f compose.dev.yml -f compose.build.yml \
  build frontend backend opentcs
docker compose --env-file deploy/.env.dev \
  -f compose.dev.yml -f compose.build.yml \
  push frontend backend opentcs
```

Ba image được push là `${DOCKERHUB_NAMESPACE}/wes-fe:${IMAGE_TAG}`, `${DOCKERHUB_NAMESPACE}/wes-be:${IMAGE_TAG}` và `${DOCKERHUB_NAMESPACE}/wes-opentcs:${IMAGE_TAG}`. Frontend image build Vite thành static artifact rồi dùng Nginx để serve; image runtime không chạy Vite dev server.

## Khởi động và cập nhật trên server

```bash
docker login
docker compose --env-file deploy/.env.dev -f compose.dev.yml config --quiet
docker compose --env-file deploy/.env.dev -f compose.dev.yml pull
docker compose --env-file deploy/.env.dev -f compose.dev.yml up -d
docker compose --env-file deploy/.env.dev -f compose.dev.yml ps
```

Với database mới, chạy seed đúng một lần sau khi backend healthy:

```bash
docker compose --env-file deploy/.env.dev -f compose.dev.yml \
  exec backend node dist/database/seed.js
```

Seed tạo tài khoản ban đầu `quan.tran` với mật khẩu `Wes@1234`; đổi mật khẩu ngay sau lần đăng nhập đầu tiên. Không chạy seed trong mỗi lần deploy vì script sẽ đặt lại mật khẩu tài khoản này.

Nginx trên host proxy domain WES tới frontend container đang bind loopback:

```nginx
location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Hai client openTCS được frontend container phục vụ trực tiếp từ bundle. Link sau tải một ZIP chứa cả hai distribution:

```text
http://171.244.54.218/downloads/opentcs-wes-clients-dev-20260908-01.zip
```

Máy khách phải cài Tailscale, tham gia đúng tailnet và kết nối được hai port sau trước khi mở client:

```powershell
Test-NetConnection 100.92.46.11 -Port 1499
Test-NetConnection 100.92.46.11 -Port 59000
```

Hai distribution đã có bookmark `WES Dev|100.92.46.11|1499`.

Xem log:

```bash
docker compose --env-file deploy/.env.dev -f compose.dev.yml logs -f --tail=200
```

Khi phát hành version mới, đổi `IMAGE_TAG`, chạy lại `pull` rồi `up -d`. Compose chỉ thay các service thuộc project được chỉ định, không dừng container hoặc kernel của project khác.

## Kiểm tra

```bash
curl -f http://127.0.0.1:18080/
curl -f http://127.0.0.1:59200/v1/kernel/version
docker compose --env-file deploy/.env.dev -f compose.dev.yml ps
```

Không mở PostgreSQL. REST openTCS và frontend mặc định chỉ truy cập được từ chính server; Nginx host là điểm truy cập public. MQTT tiếp tục dùng broker `mqtt-broker` đang publish cổng `1883`.

## Dừng và rollback

```bash
docker compose --env-file deploy/.env.dev -f compose.dev.yml down
```

Không thêm `-v` khi dừng vì tùy chọn đó xóa dữ liệu PostgreSQL và dữ liệu runtime của kernel. Để rollback, đổi `IMAGE_TAG` về version trước rồi chạy lại `pull` và `up -d`.
