# GMS PrjManagement

Ứng dụng quản lý dự án kiểu **Microsoft Project** (Gantt chart, WBS phân cấp,
task dependencies, resource view) tích hợp 2 chiều với **Jira** — lấy task từ
một Jira project (mặc định: `HHBJ` trên `gimasys.atlassian.net`), cho phép
assign / update / delete ngay trên giao diện Gantt và đẩy thay đổi ngược lại Jira.

## Kiến trúc

```
server/   Node.js + Express + TypeScript — REST API, gọi Jira REST API v3
          bằng API token, lưu các trường lịch trình MS-Project-only
          (start date, dependencies FS/SS/FF/SF + lag, baseline) trong
          data/overlay.json vì Jira Cloud không có sẵn các trường này.
client/   React + TypeScript + Vite — Gantt chart (gantt-task-react) + bảng
          WBS tuỳ biến, Resource view, modal tạo/sửa/xoá task.
```

Vì sao không gọi thẳng MCP Atlassian Rovo? MCP chỉ khả dụng bên trong phiên
Claude Code có OAuth riêng cho phiên đó — một ứng dụng độc lập sau khi deploy
không truy cập được. Nên backend dùng **Jira REST API v3** chính thức (API
token, Basic Auth) — đây cũng là cơ chế mà chính Atlassian MCP server dùng ở
tầng dưới.

### Model dữ liệu

Mỗi Task = 1 Jira issue (Epic/Story/Task/Bug/Sub-task) + một "overlay" cục bộ
chứa các trường mà Jira Cloud chuẩn không có:

| Trường            | Nguồn                                             |
|-------------------|----------------------------------------------------|
| summary, status, assignee, parent | Jira (đọc/ghi 2 chiều)             |
| dueDate           | Jira field `duedate` — luôn = start + duration, tự đẩy lên Jira khi lịch thay đổi |
| startDate, durationDays, % hoàn thành, predecessors, baseline | Overlay cục bộ (`server/data/overlay.json`) |

Khi đổi ngày/thời lượng của một task, server tự động **cascade** các task phụ
thuộc (Finish-to-Start / Start-to-Start / Finish-to-Finish / Start-to-Finish +
lag) để chúng không bắt đầu sớm hơn mức cho phép — tương tự cách MS Project
tính lại lịch khi kéo thanh Gantt.

## Chạy thử (mock mode — không cần Jira)

Không cấu hình `.env` thì server tự chạy ở **mock mode** với dữ liệu mẫu mô
phỏng đúng cấu trúc thật của project HHBJ (Epic → Story → Sub-task), đủ để
demo toàn bộ tính năng (tạo/sửa/xoá/assign/dependency) mà không đụng vào Jira
thật.

```bash
# Terminal 1 — backend (http://localhost:4000)
cd server
npm install
npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd client
npm install
npm run dev
```

Mở http://localhost:5173. Badge góc trên bên trái hiển thị `○ Mock data` khi
chưa nối Jira thật, hoặc `● Live — Jira HHBJ` khi đã cấu hình.

## Kết nối Jira thật

1. Tạo API token tại https://id.atlassian.com/manage-profile/security/api-tokens
2. Copy `server/.env.example` thành `server/.env` và điền:

```env
JIRA_BASE_URL=https://gimasys.atlassian.net
JIRA_EMAIL=your.email@gimasys.com
JIRA_API_TOKEN=xxxxxxxxxxxxxxxx
JIRA_PROJECT_KEY=HHBJ
PORT=4000
```

3. Khởi động lại `npm run dev` trong `server/` — toàn bộ task của project sẽ
   được kéo về khi tải trang hoặc bấm **"⟳ Đồng bộ từ Jira"**.

Tài khoản dùng token cần có quyền Browse/Edit/Assign/Transition/Delete issue
trên project đó (delete issue thường yêu cầu quyền admin project).

## Deploy trên máy của bạn

Chế độ "dev" ở trên chạy 2 process riêng (Vite :5173 + API :4000) — tiện để
sửa code. Để **deploy chạy lâu dài trên máy của bạn**, dùng một trong hai
cách dưới đây: cả hai đều build client + server thành **một process duy nhất**
phục vụ cả giao diện lẫn API trên **một cổng** (mặc định `4000`).

### Cách 1 — Docker (khuyên dùng, không cần cài Node)

```bash
cp server/.env.example server/.env   # điền thông tin Jira thật nếu có, để trống = mock mode
docker compose up -d --build
```

Mở http://localhost:4000. Dữ liệu lịch trình cục bộ (`overlay.json`) được lưu
trong Docker volume `gms-data` nên không mất khi restart container. Xem log:
`docker compose logs -f`. Dừng: `docker compose down`.

### Cách 2 — không cần Docker (cần sẵn Node.js ≥ 18)

```bash
./deploy.sh
```

Script này tự: cài dependencies, build client, copy vào `server/public`, build
server, rồi chạy `node dist/index.js` phục vụ mọi thứ trên
http://localhost:4000. Nếu `server/.env` chưa có, script tự tạo từ
`.env.example` (mock mode) — sửa file này rồi chạy lại `./deploy.sh` để nối
Jira thật. Muốn đổi cổng: `PORT=8080 ./deploy.sh`.

Để chạy nền lâu dài (không cần giữ terminal mở), dùng `pm2` hoặc `systemd`,
ví dụ:

```bash
npm install -g pm2
cd server && pm2 start dist/index.js --name gms-prjmanagement
pm2 save && pm2 startup   # tự khởi động lại cùng máy
```

## Tính năng

- **Gantt + WBS**: cây phân cấp Epic → Story/Task/Bug → Sub-task, thu gọn/mở
  rộng, kéo-thả để đổi ngày/thời lượng, kéo tay cầm để đổi % hoàn thành.
- **Dependencies**: thêm/xoá predecessor với 4 loại (FS/SS/FF/SF) + lag ngày,
  hiển thị mũi tên nối trên Gantt, tự động dời lịch task phụ thuộc.
- **Assign / update / delete**: modal sửa task đầy đủ — tên, ngày, %, người
  phụ trách, trạng thái Jira, predecessors; xoá task (kèm sub-task) đẩy thẳng
  lên Jira.
- **Tạo task mới**: chọn loại issue, task cha (WBS), ngày, người phụ trách —
  tạo issue Jira thật ngay lập tức.
- **Resource view**: bảng workload theo từng người phụ trách, giống Resource
  Sheet của MS Project.
- **Đồng bộ 2 chiều**: mọi thay đổi (trừ dates/duration/%/dependencies — vốn
  là khái niệm MS-Project không có sẵn trong Jira) được đẩy ngay lập tức lên
  Jira qua REST API; nút "Đồng bộ từ Jira" kéo lại toàn bộ để lấy thay đổi từ
  phía Jira (người khác sửa trực tiếp trên Jira).

## Giới hạn đã biết (MVP)

- Chưa tính **critical path** / **baseline so sánh trực quan** (mới lưu được
  baseline, chưa hiển thị so sánh trên Gantt).
- Cascade phụ thuộc là forward-only (không phải full CPM 2 chiều như MS
  Project thật).
- Trạng thái Jira đổi qua danh sách cố định (Backlog/To Do/In Progress/Done);
  nếu workflow project có transition tên khác, cần sửa `STATUS_OPTIONS` trong
  `client/src/components/TaskEditModal.tsx`.
- Xoá issue trên Jira Cloud yêu cầu quyền admin; nếu API trả lỗi 403 khi xoá,
  cần cấp quyền tương ứng cho tài khoản API token.
