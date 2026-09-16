# Báo cáo kiểm thử — Đồng bộ 2 chiều GMS PrjManagement × Jira Cloud

| | |
|---|---|
| **Dự án** | GMS_PrjManagement |
| **Môi trường** | `gimasys.atlassian.net` · project `HHBJ` |
| **Chế độ** | Live (không phải mock) |
| **Nhánh** | `claude/add-dc-to-project-euht2f` |
| **Ngày kiểm thử** | 2026-09-10 → 2026-09-11 |
| **Phương pháp** | Thủ công, gọi trực tiếp REST API (`curl`), đối chiếu song song với Jira REST API v3 |
| **Commit liên quan** | `70da586`, `3e7a5aa` |

## Tóm tắt

| Ca kiểm thử | Đạt (sau retest) | Lỗi phát hiện | Đã sửa & xác nhận | Tồn đọng |
|---|---|---|---|---|
| 16 | 15 | 6 | 5 | 1 |

Tính năng đồng bộ 2 chiều hoạt động đúng trên toàn bộ luồng chính — đọc, tạo, sửa, xoá,
cascade phụ thuộc, và field Start date thật — sau khi vá 5/6 lỗi phát hiện được trong quá
trình test trên dữ liệu Jira thật. Lỗi còn lại (BUG-05) là giới hạn cấu hình cần quyết định
của chủ dự án, không phải lỗi logic đồng bộ.

Task thật duy nhất bị điều chỉnh trong lúc test (`HHBJ-8`, mã nội bộ *A1-01*) đã được khôi
phục đúng trạng thái gốc; các task tạo riêng để test (`HHBJ-54, 55, 56, 57`) đều đã bị xoá
khỏi Jira sau khi dùng xong.

## Ma trận ca kiểm thử

### Vòng 1 — Đọc dữ liệu & CRUD cơ bản

| Mã | Chức năng kiểm thử | Kết quả thực tế | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| TC-01 | GET `/api/meta` — xác nhận đã kết nối Jira thật | `mode:"live"`, đúng project/site | ✅ Đạt | `/api/meta` |
| TC-02 | GET `/api/tasks` — kéo danh sách task thật | 52 task thật, dữ liệu khớp Jira | ✅ Đạt | `HHBJ-1…HHBJ-52` |
| TC-03 | GET `/api/users` — danh sách người gán được | Trả đúng account thật của dự án | ✅ Đạt | `/api/users` |
| TC-04 | POST `/api/sync` — đồng bộ lại toàn bộ | `syncedAt` + đủ 52 task | ✅ Đạt | `/api/sync` |
| TC-05 | POST `/api/tasks` — tạo issue Task mới trên Jira | Issue tạo thành công thật, nhưng API trả lỗi giả "not found after create" | 🔧 Đạt sau sửa | `HHBJ-54` → `HHBJ-55`, BUG-01 |
| TC-06 | PATCH `/api/tasks/:id` — sửa % + lịch, đẩy due date | Due date trên Jira khớp đúng giá trị gửi lên | ✅ Đạt | `duedate` |
| TC-07 | DELETE `/api/tasks/:id` — xoá issue thật | GET sau xoá trả 404 trên Jira thật | ✅ Đạt | `404` |

### Vòng 2 — Lịch trôi khi Jira bị sửa trực tiếp

| Mã | Chức năng kiểm thử | Kết quả thực tế | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| TC-08 | Đổi due date thẳng trên Jira (ngoài app), sau đó sync lại | Due date cập nhật đúng, nhưng start date/duration giữ nguyên giá trị cũ → lệch với due thật | 🔧 Đạt sau sửa | `HHBJ-8`, BUG-02 |

### Vòng 3 — Field "Start date" thật trên Jira

| Mã | Chức năng kiểm thử | Kết quả thực tế | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| TC-09 | Sửa Ngày bắt đầu/Thời lượng qua modal, Lưu & đồng bộ Jira | Due date lên đúng, nhưng field Start date thật (`customfield_10059`) vẫn trống | 🔧 Đạt sau sửa | `HHBJ-8`, BUG-03 |
| TC-10 | Đối chiếu "Ngày kết thúc" hiển thị trong modal với Jira thật | Modal hiện 14/09, Jira thật là 15/09 — lệch 1 ngày do lỗi múi giờ ở client | 🔧 Đạt sau sửa | BUG-04 |

### Vòng 4 — Retest toàn diện (đợt hiện tại)

| Mã | Chức năng kiểm thử | Kết quả thực tế | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| TC-11 | Tạo 2 task test A, B kèm start date + duration ngay khi tạo | Cả `duedate` và `customfield_10059` đúng ngay lần tạo đầu | ✅ Đạt | `HHBJ-56, 57` |
| TC-12 | Chuyển trạng thái Jira sang "To Do" | Lỗi: workflow thật không có transition "To Do", chỉ có Backlog / Selected for development / In Progress / Done | ⚠️ Đã biết | BUG-05 |
| TC-13 | Gán người phụ trách + chuyển "In Progress" (hợp lệ) + % | Assignee, status, % đều cập nhật đúng trên Jira thật | ✅ Đạt | `HHBJ-56` |
| TC-14 | Thêm predecessor mới (B phụ thuộc FS vào A) cho task chưa có ràng buộc | B giữ nguyên lịch cũ, vi phạm ràng buộc vừa thêm — đẩy thẳng lịch sai lên Jira | 🔧 Đạt sau sửa | `HHBJ-56/57`, BUG-06 |
| TC-15 | Dời lịch predecessor đã có sẵn ràng buộc (cascade xuôi gốc) | Successor tự dời theo đúng, khớp Jira thật | ✅ Đạt | `HHBJ-57` |
| TC-16 | Xoá 2 task test, xác nhận xoá thật trên Jira | DELETE trả 204; GET sau đó trả 404 cho cả hai | ✅ Đạt | `404 × 2` |

## Danh sách lỗi phát hiện

Sắp xếp theo mức độ nghiêm trọng giảm dần.

### BUG-06 · Nghiêm trọng — Thêm dependency mới không kích hoạt cascade cho chính task đó

- **Kịch bản lỗi**: Task A kết thúc 2026-09-17. Thêm predecessor FS (A→B) cho Task B — lẽ ra
  B phải dời sang bắt đầu 2026-09-18, nhưng B vẫn giữ 2026-09-15. Trạng thái vi phạm ràng
  buộc này bị đẩy thẳng lên Jira thật mà không có cảnh báo nào.
- **Nguyên nhân gốc**: `applyDependencyCascade()` bắt đầu duyệt (BFS) từ task vừa sửa, nhưng
  chỉ dùng lịch hiện tại của nó để đẩy các task phụ thuộc VÀO nó — chưa bao giờ kiểm tra lại
  lịch của chính task đó so với predecessor của nó.
- **Khắc phục**: Mỗi bước trong cascade giờ tự đối chiếu ngày bắt đầu của chính nó với tất cả
  predecessor trước khi lan tiếp — `server/src/taskService.ts:250-303`, commit `3e7a5aa`.
- **Trạng thái**: ✅ Đã sửa · retest Đạt

### BUG-01 · Cao — Tạo task báo lỗi giả "not found after create"

- **Kịch bản lỗi**: POST tạo task mới — issue được tạo thật trên Jira (xác minh bằng GET trực
  tiếp) nhưng API trả lỗi 502 ngay sau đó, khiến người dùng tưởng tạo thất bại và có nguy cơ
  tạo trùng.
- **Nguyên nhân gốc**: `createTask()` gọi lại `listTasks()` (JQL search toàn project) ngay
  sau khi tạo để lấy dữ liệu trả về; chỉ số tìm kiếm của Jira Cloud trễ vài giây so với thời
  điểm tạo, nên issue mới chưa xuất hiện trong kết quả search dù đã tra được bằng key.
- **Khắc phục**: Đổi sang lấy trực tiếp theo key (`jira.getIssue(key)`) thay vì search toàn
  project — `server/src/taskService.ts:346-353`, commit `70da586`.
- **Trạng thái**: ✅ Đã sửa · retest Đạt

### BUG-03 · Cao — App chưa từng ghi start date vào field thật trên Jira

- **Kịch bản lỗi**: Dự án HHBJ có field gốc "Start date" (`customfield_10059`) trên Jira. App
  trước đây chỉ giữ start date cục bộ — sau khi Lưu & đồng bộ Jira, panel chi tiết Jira vẫn
  hiện "Add date" (trống), khiến người xem trực tiếp trên Jira không thấy lịch trình.
- **Nguyên nhân gốc**: Kiến trúc ban đầu giả định Jira Cloud không có field start date nào
  (README), nên toàn bộ start date được thiết kế overlay-only. Dự án cụ thể này (Team-managed)
  thực tế có field đó.
- **Khắc phục**: Thêm `JIRA_START_DATE_FIELD_ID` (mặc định `customfield_10059`); ghi start
  date vào field này ở mọi thao tác tạo/sửa/cascade; đọc ưu tiên giá trị thật từ Jira khi có
  — `server/src/jiraClient.ts`, `server/src/taskService.ts`, commit `70da586`.
- **Trạng thái**: ✅ Đã sửa · retest Đạt

### BUG-02 · Trung bình — Start date không tự căn lại khi due date đổi trực tiếp trên Jira

- **Kịch bản lỗi**: Đổi due date thẳng trên Jira (không qua app), sau đó bấm "Đồng bộ từ
  Jira": due date hiển thị đúng giá trị mới, nhưng start date/duration (overlay cục bộ) giữ
  nguyên cũ → Gantt bar lệch khỏi due date thật.
- **Nguyên nhân gốc**: Start date/duration là overlay cục bộ, chỉ được suy ra từ due date
  **một lần duy nhất** lúc app thấy task lần đầu (`hydrate()`) — không bao giờ tự đối chiếu
  lại với due date mới từ Jira sau đó.
- **Khắc phục**: `hydrate()` giờ so sánh due date suy ra từ overlay với due date thật mỗi lần
  đọc; nếu lệch, tự dời start date để khớp lại, giữ nguyên số ngày làm việc — commit
  `70da586`.
- **Trạng thái**: ✅ Đã sửa · retest Đạt

### BUG-05 · Trung bình — Danh sách trạng thái Jira cố định không khớp workflow thật

- **Kịch bản lỗi**: Chuyển trạng thái sang "To Do" trả lỗi: workflow thật của HHBJ không có
  transition tên này, chỉ có *Backlog, Selected for development, In Progress, Done*.
- **Nguyên nhân gốc**: `STATUS_OPTIONS` trong `TaskEditModal.tsx` là danh sách cố định, không
  khớp tên transition thật của từng workflow — giới hạn đã được ghi chú sẵn trong README dự
  án.
- **Khắc phục**: Chưa sửa trong đợt này — cần quyết định: sửa cứng theo danh sách thật của
  HHBJ, hay đổi sang lấy động qua `GET /issue/:id/transitions`.
- **Trạng thái**: ⚠️ Đã biết · chưa sửa

### BUG-04 · Thấp — Lệch 1 ngày ở ô "Ngày kết thúc" hiển thị trong modal

- **Kịch bản lỗi**: Modal sửa task hiển thị "Ngày kết thúc" = 14/09/2026 trong khi giá trị
  thật đã đẩy lên Jira là 15/09/2026 — dữ liệu gửi đi vẫn đúng, chỉ preview hiển thị sai.
- **Nguyên nhân gốc**: Hàm `addDays()` phía client parse theo giờ local rồi convert qua
  `toISOString()` (luôn UTC) — với múi giờ UTC+7, phép convert làm lùi ngày hiển thị đi 1
  ngày.
- **Khắc phục**: Tính theo UTC nhất quán với server — `TaskEditModal.tsx`. Đồng thời vá phòng
  ngừa cùng nguyên nhân tại thao tác kéo-thả Gantt (`GanttView.tsx`, hàm `toIso`) — chưa có ca
  kiểm thử trực tiếp qua thao tác chuột trên trình duyệt.
- **Trạng thái**: 🔧 Đã sửa · modal đã retest, Gantt cần xác nhận thêm

## Khuyến nghị

1. Quyết định hướng xử lý BUG-05: hard-code lại danh sách theo workflow thật của HHBJ, hoặc
   lấy động qua API transitions.
2. Xác nhận thêm phần vá trong `GanttView.tsx` (BUG-04) bằng thao tác kéo-thả thực tế trên
   trình duyệt — hiện mới được xác minh qua rà soát code, chưa qua kiểm thử UI trực tiếp.
3. Cân nhắc bổ sung bộ test tự động cho luồng đồng bộ, vì toàn bộ 16 ca kiểm thử ở trên đều
   thực hiện thủ công qua `curl` — tốn công lặp lại mỗi khi có thay đổi code.
4. Toàn bộ dữ liệu test tạm đã được dọn dẹp khỏi Jira thật; không có tác động còn sót lại
   ngoài các commit mã nguồn liệt kê ở trên.
