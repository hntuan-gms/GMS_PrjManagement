# GMS PrjManagement

Ứng dụng quản lý dự án kiểu **Microsoft Project** (Gantt chart, WBS phân cấp,
task dependencies, resource view) tích hợp 2 chiều với **Jira Cloud**. Mỗi người
dùng **đăng nhập bằng tài khoản Atlassian của chính mình** (OAuth 2.0 3LO), rồi
chọn dự án Jira mà tài khoản đó có quyền xem — không còn credential dùng chung.

## Kiến trúc

```
server/   Node.js + Express + TypeScript — REST API, gọi Jira REST API v3 qua
          cổng OAuth https://api.atlassian.com/ex/jira/{cloudId}. Lưu các trường
          lịch trình MS-Project-only (start date, dependencies FS/SS/FF/SF + lag,
          baseline) trong data/overlay.v2.json vì Jira Cloud không có sẵn.
client/   React + TypeScript + Vite — màn hình đăng nhập, chọn dự án, Gantt chart
          (gantt-task-react) + bảng WBS tuỳ biến, Resource view, modal tạo/sửa/xoá.
```

### Vì sao mỗi người đăng nhập riêng?

Trước đây toàn bộ ứng dụng dùng chung một API token: mọi thao tác tạo / gán /
chuyển trạng thái / xoá đều được Jira ghi nhận dưới tên một người duy nhất, và ai
mở ứng dụng cũng có đúng quyền của tài khoản đó. Với OAuth, Jira ghi nhận đúng
người thực hiện và áp đúng quyền của họ.

### Model dữ liệu

Mỗi Task = 1 Jira issue (Epic/Story/Task/Bug/Sub-task) + một "overlay" cục bộ
chứa các trường mà Jira Cloud chuẩn không có:

| Trường | Nguồn |
|---|---|
| summary, status, assignee, parent | Jira (đọc/ghi 2 chiều) |
| dueDate | Jira field `duedate` — luôn = start + duration, tự đẩy lên Jira khi lịch thay đổi |
| startDate | Field "Start date" của site, **tự dò theo từng site**; nếu site không có thì lưu cục bộ |
| durationDays, % hoàn thành, predecessors, baseline | Overlay cục bộ (`server/data/overlay.v2.json`) |

Khi đổi ngày/thời lượng của một task, server tự động **cascade** các task phụ
thuộc (FS / SS / FF / SF + lag) để chúng không bắt đầu sớm hơn mức cho phép —
tương tự cách MS Project tính lại lịch khi kéo thanh Gantt.

> ⚠️ **Overlay hiện được lưu trên ổ đĩa tạm của container.** Ngày tháng vẫn an
> toàn (đồng bộ với Jira), nhưng **quan hệ phụ thuộc, baseline và % hoàn thành sẽ
> mất mỗi lần deploy lại**. Ứng dụng hiển thị cảnh báo này trên giao diện. Xem
> mục *Lưu overlay lâu dài* bên dưới để khắc phục.

## Cài đặt

### 1. Đăng ký ứng dụng Atlassian

Vào https://developer.atlassian.com/console/myapps → **Create** → *OAuth 2.0
integration*:

- **Permissions → Jira API** (scope kiểu classic, không trộn với granular):
  `read:jira-work`, `write:jira-work`, `read:jira-user`
- **Authorization → OAuth 2.0 (3LO)**: bật `offline_access`, và đặt
  **Callback URL** đúng bằng `<APP_BASE_URL>/api/auth/callback`

- **Permissions → User identity API**: bật `read:me`. Đây là sản phẩm **riêng** với
  Jira API — chỉ bật scope Jira thì `GET /me` trả 403 và đăng nhập sẽ hỏng.

Atlassian chỉ cho **một** Callback URL mỗi app, nên cần **hai app riêng**:

| Môi trường | Callback URL |
|---|---|
| Local dev | `http://localhost:5173/api/auth/callback` |
| Production | `https://<cloud-run-url>/api/auth/callback` |

### Cho người khác đăng nhập được

App mới tạo ở trạng thái *Development*: **chỉ chủ sở hữu app mới đăng nhập được**.
Người khác sẽ thấy màn hình *"You don't have access to this app"* ngay trên trang
consent của Atlassian, trước khi request đến được ứng dụng.

Khắc phục: **Distribution → Sharing → On**. Form yêu cầu tên đơn vị, URL chính sách
bảo mật (`https://<cloud-run-url>/privacy`, xem `client/public/privacy.html`), thông
tin liên hệ và khai báo về dữ liệu cá nhân.

> Bật Sharing đồng nghĩa **bất kỳ tài khoản Atlassian nào cũng có thể vào được màn
> hình consent**. Từ lúc đó, `ALLOWED_SITE_HOSTS` là thứ duy nhất chặn người lạ —
> hãy kiểm tra biến này thực sự đang được đặt trên Cloud Run, không chỉ trong file
> workflow.

### Ai được đăng nhập

Quyền đăng nhập **do chính Jira quyết định**: `ALLOWED_SITE_HOSTS` liệt kê hostname
của site Atlassian (ví dụ `gimasys.atlassian.net`), và ai đã được mời vào site đó
thì đăng nhập được — kể cả **khách mời dùng email cá nhân hoặc email của công ty
khách hàng**. Không cần duy trì danh sách email nào ở đây; mời người ta vào dự án
Jira là đủ.

Người chưa được mời sẽ thấy thông báo hướng dẫn xin quyền, thay vì bị chặn im lặng.

`STAFF_EMAIL_DOMAIN` **không** phải cổng đăng nhập. Nó chỉ đánh dấu tài khoản nội
bộ, và chỉ những tài khoản đó mới dùng được trợ lý AI (`/api/ai/*`) — vì tính năng
này tính phí trên Gemini key dùng chung. Khách mời vẫn dùng đầy đủ Gantt, nguồn lực
và mọi thao tác Jira; khung chat đơn giản là không hiện.

### 2. Chạy local

```bash
cp server/.env.example server/.env    # điền Client ID / Secret của app dev
# sinh khoá mã hoá cookie phiên:
node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64url'))"

# Terminal 1 — backend (http://localhost:4000)
cd server && npm install && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd client && npm install && npm run dev
```

Mở **http://localhost:5173** (không phải `:4000` — Vite proxy `/api` sang backend
để cookie phiên hoạt động đúng như trên production).

Server sẽ **dừng ngay khi khởi động** nếu thiếu `ATLASSIAN_CLIENT_ID`,
`ATLASSIAN_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEYS` hoặc `APP_BASE_URL` — không
còn chế độ chạy tạm nào.

## Deploy

Cả hai cách dưới đây build client + server thành **một process duy nhất** phục vụ
cả giao diện lẫn API trên **một cổng** (mặc định `4000`).

### Cách 1 — Docker

```bash
cp server/.env.example server/.env   # điền thông tin app production
docker compose up -d --build
```

### Cách 2 — không cần Docker (Node.js ≥ 18)

```bash
./deploy.sh
```

### Cách 3 — Google Cloud Run (tự động qua GitHub Actions)

`.github/workflows/deploy.yml` tự build image, đẩy lên Artifact Registry và deploy
mỗi khi push lên `main`. Xem phần chú thích đầu file để biết các biến cần đặt.

Lưu ý bảo mật: dịch vụ phải để `--allow-unauthenticated` vì Atlassian redirect
trình duyệt về `/api/auth/callback` và request đó không thể mang token của Google.
Vì vậy **cơ chế đăng nhập của chính ứng dụng là lớp bảo vệ duy nhất** — biến
`ALLOWED_SITE_HOSTS` giới hạn chỉ thành viên của site Jira mới đăng nhập được.

### Lưu overlay lâu dài

```bash
gcloud storage buckets create gs://YOUR_BUCKET --location=asia-southeast1
```

rồi bỏ chú thích hai flag `--add-volume` / `--add-volume-mount` trong
`deploy.yml`. Giữ `--max-instances=1` vì lowdb chỉ hỗ trợ một tiến trình ghi.

## Tính năng

- **Đăng nhập Atlassian + chọn dự án**: mỗi người dùng tài khoản riêng, chỉ thấy
  những dự án mình có quyền browse.
- **Gantt + WBS**: cây phân cấp Epic → Story/Task/Bug → Sub-task, thu gọn/mở rộng,
  kéo-thả để đổi ngày/thời lượng, kéo tay cầm để đổi % hoàn thành.
- **Dependencies**: thêm/xoá predecessor với 4 loại (FS/SS/FF/SF) + lag ngày,
  hiển thị mũi tên nối trên Gantt, tự động dời lịch task phụ thuộc.
- **Assign / update / delete**: modal sửa task đầy đủ; xoá task (kèm sub-task)
  đẩy thẳng lên Jira.
- **Tạo task mới**: chọn loại issue, task cha (WBS), ngày, người phụ trách.
- **Resource view**: bảng workload theo từng người phụ trách.
- **Đồng bộ 2 chiều**: mọi thay đổi được đẩy ngay lên Jira; nút "Đồng bộ từ Jira"
  kéo lại toàn bộ để lấy thay đổi từ phía Jira.

## Giới hạn đã biết

- Chưa tính **critical path** / so sánh baseline trực quan trên Gantt.
- Cascade phụ thuộc là forward-only (không phải full CPM 2 chiều).
- Phụ thuộc chỉ trong cùng một dự án; predecessor ở dự án khác bị từ chối.
- Trạng thái Jira lấy từ danh sách cố định trong `TaskEditModal.tsx`; nếu workflow
  của dự án có transition tên khác thì cần sửa danh sách đó.
- Danh sách loại issue cũng cố định (`Epic/Story/Task/Bug/Sub-task`); dự án
  team-managed đổi tên hoặc bỏ bớt sẽ gặp lỗi khi tạo task.
- Xoá issue trên Jira Cloud yêu cầu quyền tương ứng của chính tài khoản đăng nhập.
- **Đăng xuất chỉ xoá phiên phía ứng dụng.** Atlassian không có endpoint thu hồi
  refresh token 3LO; muốn thu hồi hẳn phải vào phần cài đặt tài khoản Atlassian.
