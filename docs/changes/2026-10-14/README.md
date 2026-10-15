# Thay đổi ngày 2026-10-14 — hoàn thiện 5 module phase 1

- **Commit:** `f611d8f` — "feat: implement CSV export functionality and task filtering system" (44 file, +3549 / −260)
- **Nền:** `1ce8904` (thêm timesheet)
- **Kế hoạch gốc:** [`docs/plans/2026-10-14-phase1-hoan-thien-5-module.md`](../../plans/2026-10-14-phase1-hoan-thien-5-module.md)
- **Bối cảnh:** phạm vi phase 1 chốt 5 module (WBS/Gantt, Nguồn lực, Bảng, Báo cáo + Phân tích, Trợ lý AI), không thêm gì mới; yêu cầu là làm đủ tính năng cơ bản (filter, assignee, status…) và đưa chi tiết task lên gần Jira.
- **Triển khai:** GitHub Actions deploy thành công, revision Cloud Run `gms-prjmanagement-00047-vdh`; migration `006` đã áp dụng lúc khởi động.

---

## 1. Đã thay đổi gì

### Dùng chung
| Thay đổi | File chính |
|---|---|
| Bộ lọc dùng chung trên `Task[]` (người, "Của tôi", trạng thái, loại, Epic, nhãn, quá hạn), nhớ theo site + dự án trong localStorage | `client/src/taskFilter.ts`, `components/FilterBar.tsx` |
| Xuất CSV (UTF-8 có BOM, chặn công thức độc hại `= + - @`) | `client/src/csv.ts` |
| Labels và Priority đọc/ghi cùng search và cùng PATCH; API `GET /priorities`, `/labels`, `/issue-types` | `server/src/taskService.ts`, `jiraClient.ts`, `routes/api.ts` |
| Dịch các chuỗi tiếng Anh còn sót (tab Chấm công, "+ Bảng", "Vượt giới hạn", "Họp nhanh hôm nay", thông báo của planner…) | nhiều file |

### WBS / Gantt
- Thanh lọc; tìm theo chữ khớp cả tên người phụ trách; cột **Nhãn**.
- Thanh chọn: **gán người, đổi trạng thái, dời ngày, xoá hàng loạt** (chạy tuần tự, báo lỗi từng task, bỏ qua Epic khi gán/dời).
- Xoá hàng loạt không còn báo lỗi sai khi chọn cả task cha lẫn sub-task (chỉ bỏ sub-task có cha cũng được chọn; Story dưới Epic vẫn được xoá).
- Mở/thu gọn tất cả, nút "Hôm nay", tự cuộn tới kết quả tìm kiếm, danh sách **"Chưa có ngày"**, xuất CSV, tooltip và nhãn Ngày/Tuần/Tháng bằng tiếng Việt.
- Sửa **Priority** và **Labels** trong modal.

### Nguồn lực
- Sửa lỗi: panel chi tiết giữ vai trò/capacity của người trước (thiếu `key`).
- Lọc theo trạng thái/loại/Epic/nhãn/quá hạn, kèm cảnh báo "mức tải chỉ tính phần khớp bộ lọc".
- Trạng thái task trong panel, danh sách chưa gán xem được hết, ô chọn người (ngoài kéo thả) cho mọi thành viên kể cả người rảnh, xuất CSV.

### Bảng
- Lọc thêm loại/trạng thái/Epic/ưu tiên; thông báo khi lọc ra rỗng.
- Đổi người ngay trên thẻ và backlog (`AssigneePicker`), hiện ưu tiên.
- Tạo nhanh chọn được loại (theo loại thật của dự án) và người.

### Báo cáo + Phân tích
- Lọc dashboard theo người / Epic / loại và chọn ngày tính; `computeProgress(tasks, asOf, scope)` thu hẹp **sau** khi xác định task lá, đường găng tính trên toàn đồ thị.
- Xoá báo cáo đã lưu (xoá mềm, chỉ nhân viên, migration `006_report_soft_delete.sql`).
- Danh sách chi tiết có tìm kiếm, sắp xếp, xuất CSV. Không còn cảnh báo "số liệu đã đổi" sai khi đang lọc.

### Trợ lý AI
- **Dừng** giờ ngắt cả phía server: `AbortSignal` tới Gemini và giữa các lượt/tool; giữ phần trả lời dở, vẫn ghi usage, không thêm câu xin lỗi.
- Nút Sao chép; duyệt kế hoạch có **Huỷ kế hoạch**, sửa tiêu đề và loại; dịch chuỗi tiếng Anh.

### Chấm công
- Lọc theo người / "Của tôi", hộp thoại xoá trong app (thay `confirm`/`alert`), xuất CSV.

### Chi tiết task (chung cho cả 5 module)
- **Bình luận + @mention** (`server/src/taskActivity.ts`, `adf.commentToAdf/adfToCommentText`): mention đi qua API dưới dạng `@[Tên](accountId)`, Jira là bên gửi thông báo.
- **Lịch sử thay đổi** từ changelog của Jira (phân trang, bỏ Rank/worklog).
- **Labels**, nút **"+ Sub-task"** mở form với task cha điền sẵn (cha là Epic thì mặc định loại không phải sub-task).

---

## 2. Cách kiểm tra đã làm

| Cách | Kết quả |
|---|---|
| `tsc`, `oxlint`, `npm run build` (client + server) | sạch |
| 18 phép kiểm tra logic (phạm vi báo cáo, ADF/mention, CSV, bộ lọc) | 18/18 đạt |
| Chrome thật chạy client với máy chủ giả thay Jira (số liệu báo cáo dùng `computeProgress` thật) | 41/41 bước đạt, không lỗi console, không hộp thoại trình duyệt |
| Kiểm tra bản đã deploy (không cần đăng nhập) | giao diện mới có trong bundle; các route mới trả 401 (không phải 404); log khởi động có `applied migration 006` |
| Rà soát độc lập bằng agent | 13 điểm; sửa 7 điểm thật (xem mục 3) |

## 3. Lỗi tìm ra khi rà soát và đã sửa trong commit này
1. Xoá Epic cùng các Story của nó chỉ xoá Epic (Jira chỉ xoá kèm *sub-task*).
2. Sửa bình luận có link làm mất URL.
3. Esc khi đang gõ bình luận đóng cả modal, mất bản nháp.
4. Mức "điểm thay đổi" trên báo cáo sai khi đang lọc.
5. Lịch sử thay đổi bị cắt mất phần mới nhất khi task có rất nhiều thay đổi.
6. Ô gán người ở Nguồn lực thiếu người rảnh khi bật "Chỉ hiện người đang có việc".
7. Thiếu kiểm tra đầu vào `labels`/`priority`; id báo cáo sai định dạng trả 500 thay vì 404.

## 4. Chưa kiểm tra / còn tồn tại
- **Chưa thử với Jira thật:** bình luận và lịch sử thật, @mention có gửi thông báo, ghi priority/labels lên Jira, xoá báo cáo đã lưu, tạo báo cáo AI.
- **Nút Dừng phía server** (`ai/chat.ts`, `routes/ai.ts`): bài thử mới chứng minh trình duyệt ngắt kết nối, chưa chứng minh server dừng gọi Gemini.
- **Có từ trước, chưa sửa:** nhấp đúp vào *hàng* trong bảng WBS không mở modal (nhấp đúp vào thanh trên biểu đồ thì mở). Bản `1ce8904` cho kết quả y hệt; nghi ngờ do `TaskListTable` định nghĩa trong hàm render nên hàng bị dựng lại sau cú nhấp đầu.
- **Điểm nhỏ chưa sửa:** hai thành viên trùng tên hiển thị trong một bình luận bị gộp khi sửa; "Hôm nay" không làm gì nếu hôm nay nằm ngoài vùng biểu đồ; CSV Gantt kèm dòng cha không khớp bộ lọc; `ownKey` dùng kiểm tra tiền tố đơn giản; các route huỷ/sửa kế hoạch AI chưa kiểm tra cloudId.

## 5. Việc để phase 2
Xem mục C của kế hoạch: bộ lọc đã lưu/JQL, baseline trên Gantt, milestone, cumulative flow, quick filter của board, tóm tắt task bằng AI, v.v.
