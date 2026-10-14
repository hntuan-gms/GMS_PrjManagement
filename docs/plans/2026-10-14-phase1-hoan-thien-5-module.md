# Kế hoạch hoàn thiện 5 module GMS Prj Management (phase 1) + backlog phase 2

> Rà soát ngày 2026-10-14, trên commit `1ce8904`.
>
> **Trạng thái (2026-10-14):** đã viết code cho toàn bộ mục A0–A9 và B1–B4; `tsc`, `oxlint` và `npm run build` (cả client lẫn server) đều sạch. **Chưa kiểm thử với Jira thật** (không có Cloud SQL/OAuth trong phiên làm việc), nên các mục trong phần "Kiểm thử" bên dưới vẫn phải chạy tay trước khi phát hành. Migration mới: `server/migrations/006_report_soft_delete.sql`.

## Bối cảnh

Phạm vi phase 1 đã chốt gồm 5 module: WBS/Gantt, Nguồn lực, Bảng, Báo cáo + Phân tích, Trợ lý AI. Không thêm module mới; phần mở rộng để sang phase 2. Yêu cầu: **làm đủ tính năng cơ bản (filter, assignee, status…) của 5 module.**

Code không có TODO/FIXME nào. Tính năng nâng cao (cascade, AI, heatmap, burndown) đã có. Phần còn thiếu chủ yếu là bộ lọc, thao tác hàng loạt, xuất dữ liệu, chuỗi tiếng Anh, một lỗi dữ liệu thật, và màn chi tiết task còn quá mỏng so với Jira (không có comment, lịch sử, labels).

**Quyết định đã chốt:**
- Tab **Timesheet** vẫn là tab riêng, đổi tên thành "Chấm công", có bổ sung lọc và xuất.
- Phase này làm **toàn bộ P0** (mục A), cộng **4 tính năng chi tiết task để ngang Jira** (mục B).

## Kết quả rà soát (tóm tắt)

| Module | Đã tốt | Thiếu cơ bản |
|---|---|---|
| **WBS/Gantt** | Cột tuỳ chọn, tạo một hoặc nhiều task, kéo đổi ngày, phụ thuộc, đường găng, zoom, chọn nhiều để xoá | Chỉ lọc theo chữ (key và tiêu đề). Chọn nhiều chỉ để xoá. Không sửa được Priority và Parent. Không xuất file. Không có mở/thu gọn tất cả hay nút "Hôm nay". Day/Week/Month và tooltip còn tiếng Anh. Task bị xoá ngày bắt đầu biến mất khỏi Gantt. |
| **Nguồn lực** | Heatmap, cảnh báo quá tải, kéo thả để gán, capacity, ngày nghỉ | **Lỗi: panel người giữ dữ liệu của người trước** (`ResourceView.tsx:352` thiếu `key`). Không lọc task. Không thấy trạng thái task. Danh sách chưa gán bị cắt ở 12. Không sửa được ngày nghỉ. Không xuất file. |
| **Bảng** | Tìm kiếm, lọc người, "Của tôi", bị chặn, quá hạn, swimlane, sprint, xếp hạng, ước lượng, burndown, AI | Không có ô chọn người trên thẻ hoặc trong backlog. Thiếu lọc trạng thái/Epic/priority; lọc loại chưa có nút. Tạo nhanh luôn là "Task". Không hiện priority. Không có thông báo khi lọc ra rỗng. |
| **Báo cáo** | Số liệu tính sẵn, biểu đồ, xem chi tiết task, lịch sử AI, phân quyền | Không có bộ lọc (người/Epic/loại/asOf). Không xoá được báo cáo. Không xuất file. TaskDrawer không sắp xếp và không tìm kiếm được. |
| **Trợ lý AI** | 24 tool, phiên chat riêng, phân quyền | Dừng chỉ ở phía client (server vẫn chạy, phần chữ dở bị mất). Không có Copy. Duyệt kế hoạch thiếu nút Huỷ và không sửa được tiêu đề/loại. Còn chuỗi tiếng Anh. |
| **Chi tiết task (chung)** | Tiêu đề, mô tả, trạng thái, người phụ trách, ngày, %, ước lượng, phụ thuộc, đính kèm, log work | **Không có comment, lịch sử thay đổi, labels, tạo sub-task.** Server chưa gọi API comment hay changelog nào. |

---

## A. P0: tính năng cơ bản

### A0. Sửa lỗi
- `client/src/components/ResourceView.tsx:352`: thêm `key={selected.accountId}` cho `<ResourcePersonPanel>`. Panel chỉ đọc `role` và `capacity` lúc mount (`ResourcePersonPanel.tsx:59-60`), nên bấm Lưu sẽ ghi dữ liệu của người cũ sang người mới.

### A1. Bộ lọc dùng chung: `client/src/taskFilter.ts` (mới) + component `FilterBar`
- Dựa trên `BoardFilter`/`matchesFilter`/`isFiltering` trong `client/src/boardModel.ts:86-113`, nhưng chạy trên `Task`:
  - `text` (khớp key, tiêu đề, tên người phụ trách)
  - `people` (gồm "none" = chưa gán), "Của tôi"
  - `statuses` (theo `statusName`)
  - `types`, `epics`, `onlyOverdue`
- Lưu và khôi phục theo từng dự án qua localStorage (bọc try/catch như `gms.gantt.columns`).
- `FilterBar`: dropdown đa chọn, nút "Xoá lọc", đếm số kết quả.

### A2. WBS/Gantt (`GanttView.tsx`, `ProjectWorkspace.tsx`, `TaskEditModal.tsx`)
- Thay điều kiện khớp trong `matchIds` (`GanttView.tsx:390-400`) bằng `taskFilter`; `searchKeep` đã giữ lại các dòng cha.
- Thao tác hàng loạt trên thanh chọn (`ProjectWorkspace.tsx:513-524`):
  - Gán người: gọi `updateTask` cho từng task.
  - Đổi trạng thái: dùng `statusTransition` theo tên, server so khớp bằng `foldName`.
  - Dời ngày ±N.
  - Báo lỗi từng dòng như xoá hàng loạt; giữ guard `seq`/`taskVersion`.
- Sửa Priority: thêm `priority` vào `TaskUpdateInput` ở cả hai `types.ts`, thêm `GET /api/priorities`, `jiraClient` ghi `fields.priority`.
- Mở/thu gọn tất cả, nút "Hôm nay" (`viewDate`), cuộn tới kết quả tìm kiếm.
- Dịch "Ngày/Tuần/Tháng"; truyền `TooltipContent` tiếng Việt.
- Bộ lọc "Chưa lên lịch" cho task không có `startDate`, mở modal để đặt ngày.

### A3. Nguồn lực (`ResourceView.tsx`, `ResourcePersonPanel.tsx`)
- Áp `taskFilter` (trạng thái/loại/Epic) cho dữ liệu đầu vào của `buildResourceLoad`.
- Hiện trạng thái task trong panel người; nút "+N nữa" mở hết danh sách chưa gán.
- Ô chọn người (ngoài kéo thả), gọi `handleAssign` hiện có.

### A4. Bảng (`BoardView.tsx`, `KanbanBoard.tsx`, `BacklogView.tsx`, `boardModel.ts`)
- Thêm vào `BoardFilter`: `statuses`, `epics`, `priorities`, kèm nút lọc loại (logic đã có).
- Ô chọn người trên thẻ và dòng backlog, có "Bỏ gán", đi qua `updateTask` để giữ quy tắc Epic.
- Tạo nhanh: chọn loại và người phụ trách.
- Hiện priority trên thẻ và trong backlog; hiện "Không có thẻ nào khớp bộ lọc".

### A5. Báo cáo (`ProgressReportView.tsx`, `server/src/routes/progress.ts`, `server/src/ai/reportStore.ts`)
- Thêm tham số `assignee`, `epic`, `type` cho `GET /api/progress`. Lọc task **trước** `computeProgress` để vẫn một nguồn tính duy nhất. Thêm ô chọn ngày `asOf`.
- `DELETE /api/progress/reports/:id`, chỉ nhân viên, xoá mềm; thêm nút xoá trên chip lịch sử.
- TaskDrawer: ô tìm kiếm và sắp xếp theo hạn/người.

### A6. Trợ lý AI (`ChatDock.tsx`, `chatStream.ts`, `server/src/routes/ai.ts`, `server/src/ai/chat.ts`, `PlanReviewModal.tsx`)
- Dừng: server lắng nghe `req.on("close")`, truyền `AbortSignal` vào vòng `streamChat`; client giữ phần chữ dở.
- Nút Copy cho mỗi câu trả lời.
- PlanReviewModal: nút "Huỷ kế hoạch" (`api.discardPlan`), sửa tiêu đề và loại (API đã nhận).
- Dịch chuỗi tiếng Anh ở `chatStream.ts:47`, `ChatDock.tsx:392-398,532`, `server/src/ai/planner.ts`.

### A7. Xuất dữ liệu: `client/src/csv.ts` (mới)
- CSV UTF-8 có BOM để Excel đọc đúng tiếng Việt; không thêm thư viện.
- Nút xuất ở: bảng WBS (theo cột đang hiện và bộ lọc hiện tại), heatmap Nguồn lực, TaskDrawer Báo cáo, Chấm công.

### A8. Chấm công (giữ tab riêng)
- Đổi nhãn tab `Toolbar.tsx:67` thành "Chấm công".
- Lọc theo người và "Của tôi" trong `TimesheetView.tsx`.
- Thay `confirm()`/`alert()` (`TimesheetView.tsx:176,182`) bằng hộp thoại trong ứng dụng.

### A9. Rà chuỗi tiếng Việt
- "+ Board", "Vượt WIP", "Stand-up hôm nay", "Task mới", "Original estimate", "Unknown" (`taskService.ts:161`).
- Cập nhật `README.md:174-179`, vốn đã lỗi thời.

---

## B. Bổ sung để ngang Jira: chi tiết task (vẫn làm trong phase 1)

Cả 5 module mở chung `TaskEditModal`, nên làm một lần là cả 5 module được hưởng. Tất cả dùng scope `read:jira-work`/`write:jira-work` sẵn có, không cần xin thêm scope.

### B1. Bình luận + @mention
- `jiraClient`: `GET/POST/PUT/DELETE /rest/api/3/issue/{key}/comment`.
- Ghi: tái dùng `textToAdf()` trong `server/src/adf.ts`, thêm node `mention` theo accountId. Đọc: chuyển ADF sang text/React giống cách đọc `description`.
- Route `/api/tasks/:id/comments`, chỉ cho sửa/xoá comment của chính mình (Jira cũng kiểm tra quyền lần nữa).
- Ô gợi ý @ lấy danh sách từ `projectMembers.ts`.
- Jira tự gửi thông báo cho người được nhắc tên và watcher, nên không tự làm thông báo.

### B2. Lịch sử thay đổi (Activity)
- `GET /rest/api/3/issue/{key}/changelog` (có phân trang), chỉ đọc.
- Tab "Hoạt động" trong modal: ai đổi trường gì, từ giá trị nào sang giá trị nào, lúc nào.
- Sau này tái dùng cho cumulative flow, control chart, burndown chính xác và tóm tắt task bằng AI (phase 2).

### B3. Labels
- Thêm `labels` vào `SEARCH_FIELDS` (`taskService.ts:22-33`), vào `Task` ở cả hai `types.ts` và vào `TaskUpdateInput`.
- Gợi ý nhãn từ `GET /rest/api/3/label`.
- Thêm vào `taskFilter` (A1) và cột tuỳ chọn của WBS.

### B4. Tạo sub-task từ task cha
- Nút "Thêm sub-task" trong modal mở `CreateTaskModal` với parent đã điền sẵn.
- Lấy loại sub-task thật của dự án từ `listIssueTypes()`, không dựa vào union `IssueTypeName` (xem ràng buộc trong CLAUDE.md).

---

## C. Backlog phase 2 (không làm lần này)

**Chi tiết task:** Components, Fix version; hiện issue link của Jira (blocks/relates); Watcher; đổi Parent và loại task.

**WBS/Gantt:**
- Bộ lọc đã lưu có tên, chia sẻ được; ô lọc nâng cao kiểu JQL.
- Hiện baseline trên thanh (đặt baseline từ giao diện).
- Milestone, Release/Version trên trục thời gian.
- Undo thao tác kéo; import Excel.
- Trường, bộ lọc và cột Sprint trên Task.

**Bảng:**
- Quick filter của board; chọn trường hiển thị trên thẻ, màu thẻ.
- Flag thẻ; hiện sub-task trên thẻ.
- Panel Epic/Version trong backlog; thao tác hàng loạt trong backlog.
- Xoá sprint; đổi trạng thái trong backlog.

**Báo cáo:**
- Velocity chart (dữ liệu đã có), Sprint report, Burnup.
- Cumulative flow, Control chart (cần changelog từ B2), Created vs Resolved.
- Xu hướng không cần báo cáo AI (snapshot hằng ngày).
- So sánh hai báo cáo; chia sẻ link; in/PDF.

**Nguồn lực:**
- Đưa capacity vào màn lập sprint.
- Ma trận kỹ năng (server đã nhận `skills`/`notes`).
- Sửa ngày nghỉ; heatmap chế độ tháng; nút chuyển kỳ trước/sau.
- Chấm công: sửa worklog.

**Trợ lý AI:**
- Tóm tắt task (dựa trên comment và changelog).
- Câu tự nhiên → áp bộ lọc lên Gantt/Bảng.
- Viết mô tả và acceptance criteria; tìm task trùng.
- Lọc theo sprint trong `search_tasks`; tool cho priority/labels/comment.
- Đính kèm file; tạo lại câu trả lời; hiện chi phí bằng tiền.

**Dùng chung:** phím tắt kiểu Jira (`c` tạo task, `/` tìm), ô tìm kiếm toàn dự án, giao diện cho điện thoại.

---

## Thứ tự làm đề xuất
1. A0 (sửa lỗi), A9 (chuỗi tiếng Việt): nhanh, rủi ro thấp.
2. A1 + B3: làm bộ lọc dùng chung cùng lúc với labels để lọc theo labels luôn.
3. A2 → A4 → A3 → A5: áp bộ lọc và thao tác vào từng module.
4. B1, B2, B4: chi tiết task.
5. A6 (AI), A7 (CSV), A8 (Chấm công).

## Kiểm thử

Không có test framework, nên kiểm thử thủ công qua trình duyệt:
- `cd client && npm run lint && npm run build`
- `cd server && npm run build`
- Chạy dev qua `:5173` (cần Cloud SQL Auth Proxy cho `DATABASE_URL`), rồi theo từng nhóm:
  - **Gantt**: lọc người + trạng thái → dòng cha vẫn hiện; tải lại → bộ lọc còn; gán 3 task hàng loạt → Jira đổi; CSV mở bằng Excel không lỗi dấu.
  - **Nguồn lực**: mở A rồi chuyển sang B → panel đúng capacity của B.
  - **Bảng**: chọn người hoặc bỏ gán trên thẻ; giao một Epic → 400; lọc ra rỗng → có thông báo.
  - **Báo cáo**: lọc theo người → số liệu đổi; đổi asOf; xoá báo cáo.
  - **AI**: Dừng giữa chừng → server ngừng gọi tool, phần chữ dở vẫn giữ; Copy; Huỷ kế hoạch.
  - **Chi tiết task**: comment có @mention → người được nhắc nhận email từ Jira; tab Hoạt động khớp History trong Jira; thêm label → lọc được; tạo sub-task → hiện dưới task cha trên WBS.
