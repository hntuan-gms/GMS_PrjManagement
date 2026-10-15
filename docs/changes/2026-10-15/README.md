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

---

# Giai đoạn 1 — Trợ lý AI ngang giao diện

- **Phạm vi làm:** 1.1–1.9. **Chưa commit/deploy.** Migration mới: `007_chat_regenerate.sql`, `008_chat_attachments.sql`.
- **Biến môi trường mới (tuỳ chọn):** `GEMINI_PRICING`, `GEMINI_PRICING_CURRENCY` — đã thêm vào `deploy.yml`; cần đặt ở GitHub repo variables nếu muốn hiện chi phí bằng tiền.

## 1. Đã thay đổi gì

| Mục | Thay đổi | File chính |
|---|---|---|
| 1.1 | `update_task` nhận `priority` (nói tự nhiên: "cao", "khẩn cấp" → tên ưu tiên *của site*) và `addLabels`/`removeLabels` (tự gộp thành bộ nhãn đầy đủ Jira cần) | `editTools.ts`, `toolUtils.ts` |
| 1.2 | `search_tasks` lọc thêm theo nhãn, ưu tiên, **sprint** (tên/số/`active`/`next`/`backlog`) | `editTools.ts` |
| 1.3 | `get_task_comments`, `add_comment`. Tên người cần nhắc được tra **trước khi đăng**; tên mơ hồ → không đăng gì, hỏi lại | `editTools.ts`, `mentionText.ts` |
| 1.4 | `get_task_history` | `editTools.ts` |
| 1.5 | `task_digest`: gom và **đo** sẵn (quá hạn mấy ngày, đang chờ việc nào và việc đó trễ bao nhiêu, ai đang chờ, giờ đã ghi vs ước lượng, mấy ngày không có thay đổi, lần đổi trạng thái cuối, bình luận gần nhất) rồi đưa `signals` bằng tiếng Việt; model chỉ diễn giải | `taskDigest.ts` |
| 1.6 | `set_view_filter`: câu nói → bộ lọc áp lên Gantt, Nguồn lực và Bảng như bộ lọc tay (sự kiện SSE `filter`); đếm số việc khớp | `viewFilter.ts` (server + client), `ProjectWorkspace.tsx`, `BoardView.tsx` |
| 1.7 | `find_similar_tasks` + `create_task` **tự kiểm tra trùng và không tạo** nếu trùng cho tới khi người dùng đồng ý (`allowDuplicate`). Viết mô tả/tiêu chí nghiệm thu là quy tắc trong prompt (`get_task` đưa thêm tên việc cha, việc cùng cha) | `similarity.ts`, `tools.ts`, `chat.ts` |
| 1.8 | **Tạo lại** và **Sửa** câu hỏi cuối (không xoá gì, đánh dấu `superseded`, token vẫn tính; bị từ chối 409 nếu lượt đó đã ghi lên Jira). **Chi phí bằng tiền** theo bảng giá cấu hình, tính theo từng mô hình | `chatStore.ts`, `routes/ai.ts`, `pricing.ts`, `ChatDock.tsx` |
| 1.9 | **Đính kèm** ảnh/PDF/văn bản (tối đa 4 tệp, 5 MB/tệp, 12 MB tổng). Nội dung tệp **không được lưu**, chỉ lưu tên/loại/dung lượng; dán ảnh chụp màn hình được | `attachments.ts`, `chatAttachments.ts`, `ChatDock.tsx` |

## 2. Quyết định đáng biết

- **"Tạo lại"/"Sửa" bị chặn sau lượt có ghi lên Jira** (tạo việc, bình luận, ghi giờ…) vì làm lại sẽ ghi lần nữa (task trùng, bình luận đôi, giờ gấp đôi). Nút ẩn trên giao diện và máy chủ cũng từ chối.
- **Tệp đính kèm không lưu nên lượt có tệp cũng không làm lại được**; lượt sau chỉ được báo "đã có tệp, nội dung không còn".
- **Chi phí không bao giờ bịa:** không có giá cho mô hình thì chỉ hiện token và nói lý do. Định dạng `model=vào/ra[/đệm];…` (dấu chấm phẩy vì `env_vars` của action tách theo dấu phẩy).
- **Bộ phân tích trùng bỏ dấu rồi so từ**, nên "đang"/"đăng", "bằng"/"bảng" trùng nhau và **không** nằm trong danh sách từ bỏ qua. Test bắt được lỗi này lúc viết.
- **"mình" ≠ tôi:** bỏ dấu "mình" thành "minh" — trùng tên người rất phổ biến. "lọc việc của Minh" phải lọc Minh. Cũng có test (lỗi này do tôi viết ra rồi tự rà ra, trước khi có test).
- **Parser JSON lớn (20 MB) của `/api/ai/chat` đặt sau bước xác thực**, parser toàn cục bỏ qua riêng route đó, để người chưa đăng nhập không bắt được máy chủ công khai đọc hàng chục MB.
- **e2e giờ tự chọn cổng trống** (từ 4000 và 5173 trở lên) thay vì đòi hai cổng đó, để không đụng `npm run dev` đang chạy. `client/vite.config.ts` đọc thêm `VITE_PROXY_TARGET` cho việc này.

## 3. Cách kiểm tra đã làm

| Cách | Kết quả |
|---|---|
| `server`: `npm test` / `typecheck:test` / `npm run build` | 102 test đạt (mới: so trùng, mention, digest, giá, tool với ngữ cảnh giả, tệp đính kèm) |
| `client`: `npm test` / `typecheck:test` / `npm run lint` / `npm run build` | 42 test đạt; lint không lỗi |
| `cd e2e && npm test` | 4 file đạt: 41 bước phase 1 + nhấp đúp + Gantt nhỏ + **trợ lý** (tạo lại, sửa, bị chặn sau lượt có ghi, lọc bằng lời sang Gantt và Bảng, chi phí, tệp đính kèm) |
| Test chéo server↔client | `client/test/viewFilter.test.ts` chạy bộ đếm của server và bộ lọc của client trên 11 trường hợp để hai bản sao không lệch |

## 4. Chưa kiểm tra / còn tồn tại

- **Chưa gọi Gemini thật.** Mọi test dùng ngữ cảnh giả: chứng minh phần code của ta (tra tên, từ chối, không ghi khi mơ hồ…) chứ **không** chứng minh model *chọn đúng tool* với 30 tool. Cần thử các câu mẫu trong [checklist, phần B](../../test-reports/2026-10-15-jira-that-checklist.md).
- **Chưa thử với Postgres thật:** migration 007/008 và các câu SQL mới (`GROUP BY model`, `latestTurn`, `supersede`) chỉ qua `tsc`. Chúng chạy khi khởi động bản deploy.
- **`privacy.html` không nhắc gì tới trợ lý AI** (tin nhắn và dữ liệu dự án đã gửi cho Google Gemini, nay thêm cả tệp người dùng đính kèm). Đây là quyết định của người phụ trách văn bản này; tôi không tự sửa.
- **Chưa có giá thật:** `GEMINI_PRICING` chưa đặt; cần lấy giá hiện hành của Google cho mô hình đang dùng.
- **Lọc theo sprint (1.2) cần `JIRA_AGILE=on`**; không có thì tool trả thông báo thiếu board.
- **Bộ lọc của trợ lý trên Bảng:** Bảng không có ô lọc nhãn, nên một nhãn được đưa vào ô tìm kiếm, nhiều nhãn chỉ áp lên Gantt.
- **Không làm:** gửi lại *ảnh* khi "Sửa" một câu hỏi có tệp (bị chặn thay vì làm sai).
