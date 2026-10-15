# Thay đổi ngày 2026-10-15 — phase 2, giai đoạn 0 (nợ từ phase 1)

- **Kế hoạch:** [`docs/plans/2026-10-15-phase2-ngang-jira.md`](../../plans/2026-10-15-phase2-ngang-jira.md), mục 2.
- **Phạm vi làm:** 0.2–0.6. **Không làm:** 0.7 (đổi mật khẩu `gms_app`, việc vận hành, theo yêu cầu). **Chưa làm được:** 0.1 (xem mục 3).
- **Chưa commit/deploy.** Các thay đổi đang ở working tree.

## 1. Đã thay đổi gì

| Mục | Thay đổi | File chính |
|---|---|---|
| 0.2 | **Nhấp đúp hàng WBS mở được modal.** Có **hai** nguyên nhân, sửa một mình thì chưa đủ: (a) `TaskListTable`/`TaskListHeader` được định nghĩa ngay trong hàm render nên mỗi lần render là một component *type* mới, React dựng lại cả hàng sau cú nhấp đầu → không có `dblclick`; nay là component cố định, dữ liệu mới nhất qua `WbsListContext`. (b) Thanh chọn chỉ hiện khi đã chọn, nên cú nhấp đầu làm bảng dịch xuống ~45px, cú nhấp thứ hai rơi vào **hàng khác** (đã thấy mở nhầm DEMO-7 thay vì DEMO-5). Nay thanh này luôn chiếm một chỗ cố định; lúc chưa chọn gì nó hiện gợi ý thao tác | `GanttView.tsx`, `ProjectWorkspace.tsx`, `App.css` |
| 0.3 | **Test tự động cho logic thuần** (`node:test` qua `tsx`): server 20 test (`computeProgress` có scope, planned theo baseline, ADF/mention), client 19 test (CSV, `taskFilter`, mention). Thêm script `test` và `typecheck:test` cho cả hai package; `tsx` thêm vào devDependencies của client | `server/test/`, `client/test/`, `*/tsconfig.test.json` |
| 0.4 | **Bài kiểm tra trình duyệt vào repo** (`e2e/`): Chrome thật + máy chủ giả; `npm test` tự dựng cả hai rồi tắt. 41 bước của phase 1 + 4 bước nhấp đúp + 3 bước Gantt nhỏ. Đã bỏ đường dẫn cứng của máy cũ (`channel: "chrome"`, import tương đối) | `e2e/` |
| 0.5 | @mention **trùng tên hiển thị**: khoá theo `accountId`, ô soạn thảo hiện `@Tên`, `@Tên (2)`; logic tách ra `mentions.ts` để test | `client/src/mentions.ts`, `TaskDiscussion.tsx` |
| 0.5 | "Hôm nay" khi nằm ngoài vùng biểu đồ: cuộn tới mép gần nhất và hiện ghi chú 5 giây (trước đây không làm gì) | `GanttView.tsx` |
| 0.5 | CSV Gantt chỉ gồm hàng **khớp** bộ lọc (bảng vẫn giữ dòng cha để thụt lề) | `GanttView.tsx` |
| 0.5 | `ownKey` dùng `assertOwnKey` (đúng dạng `KHOÁ-số`) thay vì kiểm tra tiền tố | `routes/api.ts` |
| 0.6 | Route kế hoạch AI (`PATCH/DELETE item`, `discard`, `apply`, `GET`) đều đi qua `getRun(cloudId, projectKey, runId)`: phạm vi theo site **và dự án**, id sai định dạng trả 404 thay vì 500. Sửa/xoá dòng chỉ được khi kế hoạch còn `proposed` | `ai/planStore.ts`, `routes/ai.ts` |

## 2. Cách kiểm tra đã làm

| Cách | Kết quả |
|---|---|
| `cd server && npm test` / `typecheck:test` / `npm run build` | 20/20, sạch, sạch |
| `cd client && npm test` / `typecheck:test` / `npm run build` | 19/19, sạch, sạch |
| `cd client && npm run lint` | không lỗi; còn 2 cảnh báo `set-state-in-effect` có từ trước (`ProjectPicker`, `useSession`), số cảnh báo y hệt trước khi sửa |
| `cd e2e && npm test` | 41/41 + 4/4 + 3/3, không lỗi console, không hộp thoại trình duyệt |
| Tái hiện lỗi 0.2 **trước** khi sửa | Nhấp đúp thật thất bại (2/2); sau khi chỉ sửa (a) vẫn mở nhầm hàng; sau khi sửa cả (a) và (b) đạt |

## 3. Chưa kiểm tra / còn tồn tại

- **0.1 chưa chạy.** Cần dự án Jira thử và người có quyền; từ phiên làm việc không có Jira/Cloud SQL/OAuth. Đã viết sẵn [checklist 38 dòng](../../test-reports/2026-10-15-jira-that-checklist.md) (bình luận/@mention có gửi thông báo, lịch sử, priority/labels, nút Dừng phía server, xoá báo cáo, tạo báo cáo AI…). Kết quả của nó có thể sinh thêm lỗi cần sửa.
- **0.6 chưa thử với Postgres thật:** chỉ kiểm bằng `tsc`. Câu SQL chỉ thêm điều kiện `project_key`; dòng 37–38 của checklist là phép thử.
- **0.5, mention trùng tên:** chỉ test đơn vị; chưa thử với hai người trùng tên thật trong Jira (checklist dòng 3).
- **Thanh chọn giờ luôn chiếm ~48px chiều cao** ở tab Gantt (đổi lấy việc không dịch bố cục). Nếu thấy tốn chỗ, phương án khác là thanh nổi phủ lên bảng — cần chọn lại.
- **0.7 chưa làm** theo yêu cầu: mật khẩu `gms_app` vẫn là mật khẩu đã lộ trong một cuộc trò chuyện.
