# Kế hoạch phase 2 — đưa 5 module lên ngang Jira trong công việc hằng ngày

> Lập ngày 2026-10-15, sau phase 1 (commit `f611d8f`, mô tả ở [`docs/changes/2026-10-14/`](../changes/2026-10-14/README.md)).
> **Trạng thái: bản đề xuất, chưa được sếp duyệt.** Phạm vi phase 2 chưa từng được chốt chính thức; danh sách dưới đây xuất phát từ mục C của [kế hoạch phase 1](2026-10-14-phase1-hoan-thien-5-module.md), các lỗi/nợ còn lại và các tool chatbot còn thiếu. Mục "Câu hỏi cần chốt" ở cuối cần có câu trả lời trước khi bắt đầu.

## 1. Mục tiêu

Phase 1 làm đủ tính năng **cơ bản** cho 5 module (WBS/Gantt, Nguồn lực, Bảng, Báo cáo + Phân tích, Trợ lý AI). Phase 2 có hai mục tiêu:

1. **Người dùng không phải mở Jira cho việc hằng ngày**: những việc còn buộc phải sang Jira (lọc đã lưu, baseline, xem velocity/burnup, issue link, watcher…) thì làm ngay trong app.
2. **Trả nợ chất lượng của phase 1**: phase 1 mới kiểm thử với máy chủ giả, chưa thử với Jira thật, và repo chưa có test tự động nào.

Nguyên tắc giữ nguyên: **không thêm module mới**; chuỗi hiển thị bằng tiếng Việt; số liệu do code tính, AI chỉ giải thích; mọi ghi lên Jira đi qua đúng đường hiện có (`updateTask`, cascade, luật Epic không có người phụ trách).

Kích cỡ: **S** vài giờ, **M** 1–2 ngày, **L** nhiều ngày.

---

## 2. Giai đoạn 0 — Nợ từ phase 1 (làm trước tất cả)

| # | Việc | Cỡ | Ghi chú |
|---|---|---|---|
| 0.1 | **Chạy kiểm thử tay trên Jira thật** theo mục "Kiểm thử" của kế hoạch phase 1, rồi sửa lỗi phát sinh | M | Chỗ rủi ro nhất: bình luận/lịch sử/priority/labels ghi lên Jira, @mention có gửi thông báo, nút Dừng chat ngắt được Gemini, tạo/xoá báo cáo AI. Cần một dự án Jira thử |
| 0.2 | **Sửa nhấp đúp hàng WBS không mở modal** | S | Có từ trước (đã so với `1ce8904`). Nghi ngờ `TaskListTable` định nghĩa trong hàm render nên hàng bị dựng lại sau cú nhấp đầu (`GanttView.tsx`). Cần xác nhận nguyên nhân trước khi sửa |
| 0.3 | **Dựng test tự động cho logic thuần** | M | Hiện không có framework test. Đưa 18 phép kiểm tra đã viết thành test thật: `computeProgress` có scope, ADF/mention, CSV, `taskFilter`. Thêm script `test` vào hai package |
| 0.4 | **Biến bài kiểm tra trình duyệt thành test lặp lại được** | M | 41 bước Chrome + máy chủ giả đã chạy ở phase 1 nhưng chưa nằm trong repo. Chỉnh đường dẫn, đặt dưới `e2e/`, chạy được bằng một lệnh |
| 0.5 | **Các điểm nhỏ còn lại từ rà soát** | S | Trùng tên hiển thị trong @mention (khoá theo `accountId`); "Hôm nay" khi ngoài vùng biểu đồ; CSV Gantt kèm dòng cha không khớp; dùng `assertOwnKey` thay kiểm tra tiền tố trong `ownKey` |
| 0.6 | **Route kế hoạch AI chưa kiểm tra cloudId** | S | `discard`, `delete item`, `updateItem` trong `routes/ai.ts` chỉ `getRun` có phạm vi cloud. Có từ trước nhưng nay dễ chạm tới hơn qua nút "Huỷ kế hoạch" |
| 0.7 | **Đổi mật khẩu `gms_app`** (việc vận hành) | S | Mật khẩu đã xuất hiện trong một cuộc trò chuyện. Chạy lại `scripts/setup-gcp-db.ps1` (sẽ tự deploy lại). Người có quyền project `bof-intern` làm |

**Tiến độ giai đoạn 0 (2026-10-15):** 0.2–0.6 đã làm và kiểm tra; 0.1 mới có checklist ([`docs/test-reports/2026-10-15-jira-that-checklist.md`](../test-reports/2026-10-15-jira-that-checklist.md)), **chưa chạy** vì cần dự án Jira thử; 0.7 theo yêu cầu **không làm** (việc vận hành). Chi tiết ở [`docs/changes/2026-10-15/`](../changes/2026-10-15/README.md).

---

## 3. Giai đoạn 1 — Trợ lý AI ngang giao diện (ưu tiên cao)

Chatbot hiện thua giao diện ở mọi tính năng mới của phase 1. CLAUDE.md đang ghi "Everything the UI can do to a task is also a sentence" nhưng điều đó không còn đúng.

| # | Việc | Cỡ | File chính |
|---|---|---|---|
| 1.1 | `update_task` nhận thêm `priority` và `labels` | S | `ai/editTools.ts`; tái dùng `TaskUpdateInput` |
| 1.2 | `search_tasks` lọc thêm theo sprint, nhãn, độ ưu tiên | S | `ai/editTools.ts`. Sprint cần dữ liệu từ board (xem 3.1) |
| 1.3 | `get_task_comments`, `add_comment` (mention theo tên người như `assign_task`) | M | Dùng `TaskActivity`; tên → `accountId` qua `resolvePerson` |
| 1.4 | `get_task_history` | S | `TaskActivity.listActivity` |
| 1.5 | **Tóm tắt một task** ("task này đang vướng gì?") từ mô tả, bình luận, lịch sử, phụ thuộc | M | Chỉ làm sau 1.3 và 1.4. Số liệu vẫn do code đưa vào, model chỉ diễn giải |
| 1.6 | **Câu tự nhiên → áp bộ lọc lên Gantt/Bảng** ("lọc việc quá hạn của Minh") | M | Tool trả về một `TaskFilter`; client áp lên `ProjectWorkspace`. Cần kênh sự kiện mới giống `mutated` |
| 1.7 | Viết mô tả và tiêu chí nghiệm thu cho task; gợi ý task trùng | M | Gợi ý trùng chỉ so tiêu đề/mô tả trong cùng dự án |
| 1.8 | Tạo lại câu trả lời, sửa tin đã gửi, hiện chi phí bằng tiền | M | Chi phí cần bảng giá theo `GEMINI_MODEL`; đừng viết cứng |
| 1.9 | Đính kèm ảnh/file vào chat | L | Chi phí token và đường tải lên chưa có; để cuối |

Sau khi xong, cập nhật lại đoạn tương ứng trong CLAUDE.md.

**Tiến độ giai đoạn 1 (2026-10-15):** 1.1–1.9 đã viết và kiểm tra bằng test đơn vị + e2e với máy chủ giả; **chưa chạy với Gemini và Jira thật** (xem [checklist, phần B](../test-reports/2026-10-15-jira-that-checklist.md)). Mục 1.2 lọc theo sprint dùng dữ liệu board nên cần `JIRA_AGILE`. Chi tiết và các quyết định ở [`docs/changes/2026-10-15/`](../changes/2026-10-15/README.md), mục "Giai đoạn 1".

---

## 4. Giai đoạn 2 — Chi tiết task và Gantt

### 4.1 Chi tiết task (cả 5 module hưởng)
| # | Việc | Cỡ |
|---|---|---|
| 2.1 | Components và Fix version: xem, sửa, lọc | M |
| 2.2 | Hiện **issue link của Jira** (blocks/relates…) bên cạnh phụ thuộc FS/SS/FF/SF | M |
| 2.3 | Watcher: xem, thêm/bớt chính mình | S |
| 2.4 | Đổi task cha (di chuyển trong WBS) và đổi loại task | M |

Lưu ý 2.4: đổi cha đụng tới `wbsParentId`, luật Epic, và cascade. Phải kiểm tra không tạo vòng cha–con.

### 4.2 WBS/Gantt
| # | Việc | Cỡ | Ghi chú |
|---|---|---|---|
| 2.5 | **Hiện baseline trên thanh** và đặt baseline từ giao diện | M | Dữ liệu đã có (`baselineStart/Due` trong overlay); hiện chỉ đặt được qua chatbot. Vẽ thanh mờ phía dưới, phải đi qua cơ chế truy cập DOM của `gantt-task-react` đã có |
| 2.6 | **Bộ lọc đặt tên, lưu và chia sẻ** | M | Cần bảng mới theo `cloudId` + dự án. Chia sẻ trong phạm vi dự án |
| 2.7 | **Lọc kiểu JQL** | L | **Không tự viết bộ phân tích JQL.** Chuyển nguyên chuỗi cho Jira (`/search/jql`) bằng token của người dùng; Jira tự kiểm quyền và báo lỗi cú pháp |
| 2.8 | **Trường Sprint** trên `Task`: cột, bộ lọc | M | Cần thêm field sprint vào `SEARCH_FIELDS`; sprint là dữ liệu Agile nên phụ thuộc scope `JIRA_AGILE` |
| 2.9 | Milestone, Release/Version trên trục thời gian | L | Cần quyết định hiển thị; làm sau 2.1 |
| 2.10 | Hoàn tác thao tác kéo | M | Ngăn xếp hoàn tác ở `ProjectWorkspace`, phải khôi phục cả phần cascade. Chỉ undo trong phiên |
| 2.11 | Nhập từ Excel/CSV | L | Tái dùng `createTasksBulk`; cần màn xem trước và ánh xạ cột |

---

**Tiến độ giai đoạn 2 (2026-10-23):** 2.1–2.11 đã viết và kiểm tra bằng test đơn vị + e2e với máy chủ giả; **chưa chạy với Jira thật** ([checklist, phần C](../test-reports/2026-10-15-jira-that-checklist.md)). Chọn lựa khác kế hoạch: nhập từ Excel đọc **CSV và ô dán từ Excel, chưa đọc .xlsx**; mục 2.8 (trường Sprint) **không** cần `JIRA_AGILE` như kế hoạch dự đoán vì đọc qua trường Sprint của API thường; milestone = nhãn `milestone`. Chi tiết ở [`docs/changes/2026-10-15/`](../changes/2026-10-15/README.md), mục "Giai đoạn 2".

## 5. Giai đoạn 3 — Bảng, Báo cáo, Nguồn lực

### 5.1 Bảng
| # | Việc | Cỡ |
|---|---|---|
| 3.1 | Nạp quick filter của chính board Jira | M |
| 3.2 | Chọn trường hiển thị và màu thẻ; gắn cờ thẻ | M |
| 3.3 | Hiện sub-task trên thẻ cha | S |
| 3.4 | Panel Epic/Version trong backlog; thao tác hàng loạt trong backlog (gán người, đổi trạng thái); đổi trạng thái ở backlog | L |
| 3.5 | Xoá sprint | S |

### 5.2 Báo cáo + Phân tích
| # | Việc | Cỡ | Ghi chú |
|---|---|---|---|
| 3.6 | **Biểu đồ velocity** | S | Dữ liệu `velocity` đã có trong snapshot của board; chưa vẽ |
| 3.7 | **Sprint report và burnup** | M | Burndown hiện không biết phạm vi thêm giữa sprint (API board không có changelog) |
| 3.8 | **Cumulative flow, control chart, created-vs-resolved** | L | Cần changelog hàng loạt. Gọi từng issue là N+1 và dễ chạm giới hạn tốc độ của Jira; cân nhắc `expand=changelog` trong search, có giới hạn khoảng thời gian và bộ nhớ đệm |
| 3.9 | **Xu hướng không cần báo cáo AI** | M | Hiện biểu đồ xu hướng chỉ vẽ từ các báo cáo AI nên khách (guest) không bao giờ thấy. Cần bảng ảnh chụp số liệu theo ngày. Cloud Run co về 0 nên **không có tiến trình chạy nền**: ghi ảnh chụp khi có người mở trang (tối đa một lần/ngày/dự án), hoặc dùng Cloud Scheduler |
| 3.10 | So sánh hai báo cáo cạnh nhau; link chia sẻ; in/PDF | M | |

### 5.3 Nguồn lực
| # | Việc | Cỡ | Ghi chú |
|---|---|---|---|
| 3.11 | Ma trận kỹ năng | M | Server đã nhận `skills`/`notes` trong `resource_profile`, giao diện chưa có ô nhập |
| 3.12 | Sửa ngày nghỉ (hiện chỉ thêm/xoá) | S | Cần route cập nhật trong `resourceStore.ts` |
| 3.13 | Heatmap chế độ tháng, nút chuyển kỳ trước/sau | M | |
| 3.14 | Chấm công: sửa worklog | S | Jira cho sửa worklog của chính mình |
| 3.15 | Đưa capacity còn lại của từng người vào màn lập sprint | M | `planSprint` đã dùng `resource_profile`; phần còn thiếu là hiển thị |

---

## 6. Giai đoạn 4 — Chung

| # | Việc | Cỡ |
|---|---|---|
| 4.1 | Phím tắt kiểu Jira: `c` tạo task, `/` tìm (Bảng đã có `/`) | S |
| 4.2 | Tìm kiếm toàn dự án (mọi tab) | M |
| 4.3 | Giao diện dùng được trên điện thoại | L |

---

## 7. Thứ tự đề xuất

1. **Giai đoạn 0** — bắt buộc trước, vì mọi thứ sau đều dựa trên phase 1 đã được kiểm chứng thật.
2. **Giai đoạn 1 (chatbot)** — việc nhỏ, giá trị rõ, và đúng với yêu cầu "đủ tính năng cho 5 module".
3. **3.6, 2.5, 3.11, 3.12** — các mục S/M mà dữ liệu đã có sẵn, chỉ thiếu giao diện.
4. **2.8 → 1.2 → 3.7** — trường Sprint mở khoá lọc theo sprint trong chat và báo cáo sprint.
5. **2.6, 2.7, 2.1–2.4** — lọc đã lưu/JQL và chi tiết task.
6. **3.8, 3.9** — biểu đồ cần changelog và ảnh chụp theo ngày: tốn công nhất, làm khi đã có số liệu thật để thử.
7. **Còn lại** (milestone, undo, nhập Excel, điện thoại, đính kèm chat) theo ưu tiên sếp chọn.

## 8. Rủi ro và phụ thuộc kỹ thuật

- **Scope Atlassian:** trường Sprint, quick filter, sprint report cần scope Agile chi tiết, chỉ bật khi `JIRA_AGILE=on` (xem CLAUDE.md). Mọi scope mới phải bật trên app Atlassian **trước** khi đưa vào code, vì thiếu một scope là `/authorize` hỏng với tất cả mọi người.
- **Giới hạn tốc độ Jira:** 3.8 và 2.7 gọi nhiều. Thiết kế bộ nhớ đệm và giới hạn khoảng thời gian ngay từ đầu.
- **Không có tiến trình nền:** Cloud Run co về 0 và chạy tối đa một instance; mọi việc "hằng ngày" phải theo kiểu ghi khi có người dùng hoặc Cloud Scheduler.
- **Dữ liệu mới của ta:** bộ lọc đã lưu (2.6) và ảnh chụp theo ngày (3.9) là bảng mới, mỗi bảng khoá theo `cloudId`, thêm bằng migration `007+`.
- **Chi phí Gemini:** 1.5–1.9 làm tăng lượt gọi. Giữ nguyên rào chắn hiện có: các route AI chỉ cho nhân viên (`requireStaff`).
- **Chưa có test tự động** cho tới khi xong 0.3/0.4. Không nên làm khối lượng lớn ở giai đoạn 2–3 khi chưa có lưới an toàn này.

## 9. Cách kiểm chứng

- Từng mục: chạy test tự động của 0.3/0.4 và `npm run build`, `oxlint`, `tsc` của cả hai package.
- Mọi mục ghi lên Jira: thử trên **dự án Jira thử** rồi đối chiếu bằng giao diện Jira (lịch sử, bình luận, trường).
- Mục chatbot: thử trên bản deploy (local không có `GEMINI_API_KEY`).
- Cuối mỗi giai đoạn: viết một thư mục `docs/changes/<ngày>/` như đã làm ở phase 1, nói rõ cái gì đã kiểm tra thật và cái gì chưa.

## 10. Câu hỏi cần chốt

1. **Phạm vi:** sếp có duyệt danh sách này làm phase 2 không, hay chỉ một phần? Phần nào là bắt buộc?
2. **Chatbot ở phase nào:** nhóm 1.1–1.4 (tool còn thiếu) có thuộc phase 1 chưa xong hay thuộc phase 2? Tôi đề xuất làm ngay vì đó là phần "đủ tính năng" của Trợ lý AI.
3. **Dự án Jira thử:** có dự án nào dùng để kiểm thử ghi thật không, và ai có thể cấp quyền cho 0.1?
4. **Lọc kiểu JQL (2.7):** có cần cho mọi người dùng, hay chỉ nhân viên? Chuỗi JQL chạy bằng token của chính người đó nên không vượt quyền, nhưng cần chốt có hiển thị cho khách không.
5. **Giao diện điện thoại (4.3):** có nhu cầu thật không? Đây là mục lớn nhất.
6. **Ngày/nguồn lực:** ai làm và trong bao lâu, để chia giai đoạn thành mốc có hạn.
