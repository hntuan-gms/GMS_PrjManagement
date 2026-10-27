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

---

# Giai đoạn 2 — Chi tiết task và Gantt

- **Phạm vi làm:** 2.1–2.11. **Chưa deploy.** Không có migration mới (bộ lọc đã lưu dùng bảng `saved_filter` của nhánh kia, `010_saved_filter.sql`). Không có biến môi trường mới.
- **Đã gộp với `origin/main`** (7 commit của người khác): hai nhánh cùng làm *bộ lọc đã lưu* và *baseline trên thanh*. Giữ bản của họ (đã deploy, có bảng thật) và đắp phần mình lên: bộ lọc đã lưu giờ chứa cả thành phần/phiên bản/sprint/JQL; baseline dùng `BaselineOverlay` + ô "Baseline…" trên thanh chọn, `TimelineMarkers` chỉ còn mốc và đường phát hành. Đã bỏ: `filterStore.ts`, `009_saved_filter.sql`, `BaselineMenu`, `POST /tasks/baseline`.
- Dựa trên nền đã commit (`ca51c41`): giai đoạn 0 và 1 đã nằm trong lịch sử git.

## 1. Đã thay đổi gì

| Mục | Thay đổi | File chính |
|---|---|---|
| 2.1 | **Thành phần** và **phiên bản** (fix versions): xem, sửa trong modal (chỉ *chọn* từ danh sách của dự án, vì Jira không nhận tên lạ), lọc, cột trên WBS; trợ lý sửa được qua `update_task` và tự khớp tên với tên của dự án | `NamePicker`, `taskService.ts`, `editTools.ts` |
| 2.2 | **Issue link của Jira** (blocks, relates…): xem, thêm, gỡ, hiện *cạnh* phụ thuộc chứ không lẫn vào, có ghi chú "không dời lịch". Route `/issue-links` (tên `/links` đã dành cho liên kết web) | `taskExtras.ts`, `TaskLinks.tsx` |
| 2.3 | **Người theo dõi**: xem danh sách (nếu có quyền), theo dõi / bỏ theo dõi chính mình | `TaskWatchers.tsx` |
| 2.4 | **Đổi việc cha và đổi loại** có kiểm tra trước khi gọi Jira (không vòng lặp, Sub-task không làm cha, Epic không có cha và không có người phụ trách) | `structure.ts` (server + client) |
| 2.5 | **Baseline trên thanh** (dải mỏng dưới thanh, đỏ khi trễ) và đặt/xoá baseline cho việc đã chọn; chỉ lưu trong ứng dụng — phần này **là của nhánh kia**, mình chỉ dùng lại | `BaselineOverlay`, ô "Baseline…" |
| 2.6 | **Bộ lọc đã lưu và chia sẻ** theo dự án (của nhánh kia); mình mở rộng để lưu thêm thành phần/phiên bản/sprint/JQL | `savedFilters.ts` (cả hai phía) |
| 2.7 | **Lọc bằng JQL**: chuỗi đi thẳng sang Jira (không tự viết bộ phân tích), chạy bằng token của người dùng, kết quả cắt về đúng dự án | `taskExtras.jqlKeys` |
| 2.8 | **Trường Sprint** trên task: cột, bộ lọc; đọc qua trường Sprint của API thường nên *không* cần `JIRA_AGILE` | `fieldDiscovery.ts`, `pickSprint` |
| 2.9 | **Mốc và phiên bản phát hành trên trục thời gian**: hình thoi cho task nhãn `milestone`, đường dọc tại ngày phát hành | `TimelineMarkers`, `timelineGeometry.ts` |
| 2.10 | **Hoàn tác thao tác kéo** (nút + Ctrl/Cmd+Z), trong phiên, gồm cả việc bị cascade đẩy đi | `undo.ts`, `ProjectWorkspace` |
| 2.11 | **Nhập từ CSV / dán từ Excel**: tự nhận cột, xem trước, chỉ ra dòng lỗi, "việc cha" là mã hoặc số dòng nên một bảng mô tả được cả cây; gửi theo đợt 25 dòng | `csvImport.ts`, `ImportModal`, `importTasks` |

Kèm theo: `TaskEditModal` giờ có `key` theo task (mở task khác từ chat không còn giữ form của task cũ); `DependencyOverlay` dùng chung `useBarRects`; e2e tự chọn cổng trống và có `/api/__restore` để các file không dẫm lên dữ liệu của nhau.

## 2. Quyết định đáng biết

- **Issue link không phải phụ thuộc.** Jira "blocks" không có kiểu FS/SS/FF/SF, không có lag và không dời thanh nào; gộp vào mục Phụ thuộc sẽ hứa một hành vi lập lịch mà nó không có.
- **Nhập .xlsx chưa làm**: cần thêm thư viện đọc bảng tính; "Lưu thành CSV UTF-8" và dán từ Excel phủ cùng nhu cầu. Nếu cần .xlsx thật, báo tôi.
- **JQL sai không làm trống biểu đồ**; lỗi của Jira hiện cạnh ô và phần còn lại của bộ lọc vẫn chạy.
- **Hoàn tác chỉ cho thao tác kéo** (thanh và %), không cho sửa trong modal, thao tác hàng loạt, trạng thái, người phụ trách — những cái đó là ghi lên Jira có hệ quả (chuyển trạng thái có thể gửi thông báo).
- **Milestone = nhãn `milestone`** vì Jira không có khái niệm này; chỉ đổi cách vẽ, không đổi lịch.
- **Vị trí các thứ không phải thanh được đo theo tỉ lệ của chính thanh gần nhất**, không theo một tỉ lệ chung: ở chế độ Tháng một cột 28–31 ngày nhưng cùng bề rộng nên tỉ lệ chung sẽ lệch dần.

## 3. Lỗi tìm được trong lúc làm

- Trình biên dịch báo trùng `POST /tasks/:id/links` với route liên kết web có sẵn — nếu không bắt được, thêm issue link sẽ làm hỏng việc đính kèm liên kết.
- `toLinkViews` sập với phần tử `null` (test bắt được).
- Test e2e cũ phụ thuộc múi giờ: máy chủ giả dùng ngày UTC còn client dùng ngày địa phương, nên sau nửa đêm giờ Việt Nam nhưng trước 07:00 UTC vài kiểm tra "trước/sau hôm nay" sai. Máy chủ giả giờ dùng ngày địa phương.

## 4. Cách kiểm tra đã làm

| Cách | Kết quả |
|---|---|
| `server`: `npm test` / `typecheck:test` / `npm run build` | 195 test đạt, sạch |
| `client`: `npm test` / `typecheck:test` / `npm run lint` / `npm run build` | 106 test đạt; lint chỉ còn 2 cảnh báo có từ trước |
| `cd e2e && npm test` | 7 file đạt, gồm **giai đoạn 2** (modal, bộ lọc, lưu bộ lọc có thành phần/JQL, mốc/phát hành, kéo + hoàn tác bằng chuột thật, nhập) cùng KBKT và overlay của nhánh kia |

## 5. Chưa kiểm tra / còn tồn tại

- **Chưa thử với Jira thật.** Chỗ chưa chắc nhất: (a) **chiều của issue link** (`inwardIssue`/`outwardIssue` — suy ra từ tài liệu, checklist D9 để kiểm tra); (b) gỡ việc cha bằng `parent: null` (D5); (c) đổi loại giữa hai quy trình khác nhau (D6); (d) vị trí đường phát hành ở chế độ Tháng.
- **Không có .xlsx**; tối đa 200 dòng mỗi lần nhập.
- **Bộ lọc trên tab Nguồn lực** dùng được JQL nhưng không có ô nhập JQL ở đó (chỉ áp bộ lọc đã đặt từ Gantt).
- **Trợ lý chưa lọc được theo thành phần/phiên bản/sprint** bằng `set_view_filter` (`search_tasks` thì có).
- **Hoàn tác không cứu được** việc đã bị người khác sửa trong lúc đó: nó ghi đè về giá trị cũ.

---

# Giai đoạn 3 — Bảng, Báo cáo, Nguồn lực

- **Phạm vi làm:** 3.1–3.15. **Chưa commit/deploy.** Một migration mới: `011_progress_snapshot.sql`. Một biến môi trường mới, tuỳ chọn: `JIRA_AGILE_DELETE` (đã thêm vào `deploy.yml` và `.env.example`).
- Kiểm tra: server 242 test, client 166 test, `typecheck:test`, build và lint sạch (2 cảnh báo có từ trước), e2e 14 file đạt (mới: `stage3.e2e.mjs`). **Chưa thử với Jira thật** — checklist mục E.

## 1. Đã thay đổi gì

| Mục | Thay đổi | File chính |
|---|---|---|
| 3.1 | **Quick filter của board** hiện thành nút trên thanh lọc; bật thì Jira chạy JQL (nhiều cái = AND như Jira), ta lọc theo mã trả về. JQL lỗi thì không lọc gì và có dòng báo | `boardService.quickFilterKeys`, `BoardView` |
| 3.2 | **Thẻ**: chọn trường hiện (loại, mã, ưu tiên, ước lượng, hạn, người, Epic, nhãn, phiên bản, sub-task), **màu thẻ** theo ưu tiên/loại/Epic/người, **gắn cờ** bằng trường "Flagged" tìm theo site. Lưu theo board trên trình duyệt | `cardOptions.ts`, `KanbanBoard`, `boardService.setFlag`, `fieldDiscovery.getFlaggedFieldId` |
| 3.3 | **Sub-task trên thẻ cha**: "x/y sub-task" + danh sách; tuỳ chọn gộp (ẩn thẻ riêng khi cha đang hiện) | `cardOptions.ts`, `KanbanBoard` |
| 3.4 | **Panel Epic / Phiên bản** ở Backlog (tiến độ, bấm để lọc); **hàng loạt** (gán, đổi trạng thái theo workflow, gắn/bỏ cờ); đổi trạng thái từng dòng; `fixVersions` trên thẻ và snapshot | `BacklogPanels`, `BacklogView`, `boardModel.epicRollup/versionRollup` |
| 3.5 | **Xoá sprint** chưa chạy (việc về backlog trước, xoá sau) | `boardService.deleteSprint` |
| 3.6 | **Biểu đồ vận tốc** | `AgileCharts.VelocityChart` |
| 3.7 | **Sprint report + burnup** dựng lại từ changelog trường Sprint | `agile/sprintReport.ts` |
| 3.8 | **Luồng công việc (CFD), thời gian xử lý (control chart: cycle/lead, P50/85/95), tạo-vs-xong** từ một lần search `expand=changelog` (≤90 ngày, ≤1000 việc, cache 10 phút) | `flowMetrics.ts`, `flowReports.ts` |
| 3.9 | **Xu hướng theo ngày không cần báo cáo AI**: bảng `progress_snapshot`, ghi khi có người mở trang (cập nhật tối đa mỗi 3 giờ, chỉ khi xem toàn dự án và ngày hợp lý) | `progressSnapshotStore.ts`, migration 011 |
| 3.10 | **So sánh hai báo cáo AI**, **liên kết chia sẻ** (`/?project=KEY&report=ID`, sống qua đăng nhập), **In / Lưu PDF** | `reportCompare.ts`, `deepLink.ts`, `ReportCompare`, `@media print` |
| 3.11 | **Ma trận kỹ năng** (bấm ô bật/tắt) + ô nhập kỹ năng và ghi chú trong hồ sơ người | `skillMatrix.ts`, `SkillMatrixView` |
| 3.12 | **Sửa kỳ nghỉ** (PATCH) | `resourceStore.updateAbsence` |
| 3.13 | Heatmap: **cột theo tháng**, chọn Ngày/Tuần/Tháng, **kỳ trước/sau**, "Tháng này" | `resourceAllocation.ts` |
| 3.14 | **Sửa worklog** của chính mình (chỉ gửi phần đổi) | `timesheet.update`, `TimesheetView` |
| 3.15 | **Năng lực còn lại** từng người: nút "Năng lực" ở sprint trong Backlog và trong dialog lập kế hoạch AI | `CapacityTable`, `boardModel.capacityRows` |

## 2. Quyết định đáng biết

- **Xoá sprint cần scope riêng** (`delete:sprint:jira-software`) và nằm sau công tắc `JIRA_AGILE_DELETE`: thiếu một scope trên app Atlassian là cả `/authorize` hỏng với mọi người. Chưa bật thì nút nói rõ thay vì làm hỏng đăng nhập.
- **Sprint report không lấy được "cam kết" chuẩn của Jira** (không có API công khai) nên dựng lại từ changelog; điểm là điểm *hiện tại*, và việc bị gỡ khỏi sprint rồi không quay lại thì không còn được tìm thấy. Trang nói rõ hai giới hạn này.
- **Không có tiến trình nền** nên ảnh chụp xu hướng ghi lúc có người mở trang; chưa làm Cloud Scheduler. Các ngày trước khi có tính năng này không có số.
- **Quick filter chỉ đọc**; tạo/sửa quick filter vẫn ở Jira.
- **Cờ ghi qua trường "Flagged"** vì API agile chỉ *đọc* cờ.
- **Panel Backlog đếm theo cả board, không theo bộ lọc**, để còn chọn được Epic kế tiếp.
- **Thanh chọn của Backlog vẫn chỉ hiện khi chọn ≥2 việc** (hiện ở 1 việc sẽ làm bảng dịch giữa hai cú nhấp của nhấp đúp — cùng lỗi đã gặp ở WBS).
- **Thay đổi test cũ**: `board-kanban.e2e.mjs` nay chấp nhận nút "Thẻ" ở góc phải, facet "Phiên bản", và đo chiều cao thẻ không tính thẻ cha có sub-task.

## 3. Chưa làm / còn tồn tại

- **Chưa thử Jira thật** (checklist E). Chỗ chưa chắc nhất: gắn cờ (E3), scope xoá sprint (E9), `expand=changelog` trên `/search/jql` có kèm changelog đủ không (E13–E14), xoá ghi chú worklog (E21).
- Chưa có Cloud Scheduler cho snapshot; chưa có test e2e cho so sánh báo cáo và liên kết (chỉ test đơn vị).
- Control chart/CFD chỉ đọc tối đa 100 thay đổi gần nhất của mỗi việc (giới hạn của Jira).
