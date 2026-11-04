# Tổng kết GMS PrjManagement — ưu điểm, nhược điểm và các vấn đề lớn đã xử lý

> Cập nhật: 03/11/2026 · Dành cho: người quản lý / người ra quyết định về hướng đi tiếp theo của tool.
> Nguồn: mã nguồn, lịch sử commit (từ 09/2026), `CLAUDE.md` và các báo cáo kiểm thử trong `docs/test-reports/`.

## 1. Tool là gì

Một công cụ quản lý dự án kiểu MS Project (Gantt + WBS + phụ thuộc FS/SS/FF/SF + xem nguồn lực + Scrum/Kanban + chấm công + báo cáo tiến độ + trợ lý AI) **đặt trên Jira Cloud, đồng bộ hai chiều**.

- Mỗi người đăng nhập bằng **tài khoản Atlassian của chính mình** (OAuth 2.0), thấy đúng những dự án họ được phép xem. Không có tài khoản dùng chung.
- Dữ liệu việc (tên, trạng thái, người làm, ngày) **nằm ở Jira**. Phần Jira không có chỗ lưu (loại phụ thuộc + độ trễ, baseline, % hoàn thành, hồ sơ nguồn lực, nghỉ phép, cấu hình SLA/lịch) nằm ở Postgres của tool.
- Chạy trên Cloud Run, DB `gms` trên Cloud SQL dùng chung với các app khác (cô lập database).

## 2. Ưu điểm

### 2.1. Làm được những thứ Jira không làm (hoặc làm rất yếu)
| Năng lực | Giá trị |
|---|---|
| Gantt + WBS phân cấp, kéo thả đổi lịch, **tự động đẩy/kéo các task phụ thuộc** (cascade) | Đổi một mốc là cả chuỗi phụ thuộc tự cập nhật, đẩy ngược lại Jira |
| 4 loại phụ thuộc FS/SS/FF/SF + độ trễ, đường găng, baseline, milestone, release line | Jira chỉ có issue link không có loại/độ trễ, không có baseline |
| Bản đồ nhiệt nguồn lực theo giờ, kéo thả giao việc, ngày nghỉ, kỹ năng | Thấy ai quá tải đúng tuần cần, không chỉ tải trung bình tháng |
| Lịch làm việc & ngày lễ theo dự án, SLA theo giờ làm việc | Quá hạn/SLA tính theo giờ làm thật, không phải giờ lịch |
| Báo cáo tiến độ: % thực tế vs kế hoạch, SPI, sức khoẻ dự án, đường găng | **Mọi con số do code tính**; AI chỉ giải thích — không có "phần trăm bịa" |
| Bảng Scrum/Kanban, backlog, sprint, velocity, burndown/burnup, CFD, cycle time | Dùng board thật của Jira, kéo thả ghi ngược về Jira |
| Chấm công (worklog) theo tuần, ai chưa log | Ghi thẳng vào worklog của Jira, không có bản sao lệch |
| Nhập KBKT (workbook test-case → Story/Sub Testcase/Sub Bug) | Thay script Python của tester, chạy bằng quyền Jira của chính người dùng, nhập lại không tạo trùng |
| Nhập CSV/Excel, xuất CSV (chống formula injection, đúng tiếng Việt trong Excel) | Dựng cả WBS từ một bảng tính |

### 2.2. Trợ lý AI có kiểm soát
- Cái gì **chạm Jira** thì làm qua cùng một tầng nghiệp vụ như giao diện (cascade, luật Epic, phạm vi board đều áp dụng).
- Việc nguy hiểm (xoá task, đóng sprint, tạo task trùng) **bị chặn ngay trong tool**, không chỉ dặn trong prompt.
- Kế hoạch lớn (chia việc cả dự án) chỉ vào bảng nháp, **con người duyệt rồi mới tạo trên Jira**.
- Chi phí token tính theo từng tin nhắn, theo cấu hình giá; cuộc trò chuyện riêng tư theo tài khoản.

### 2.3. An toàn & phân quyền
- Quyền xem do Jira quyết định (token của chính người dùng); ngay cả bản sao issue trong Postgres cũng được lọc theo danh sách id mà token đó nhìn thấy.
- Truy cập "uỷ quyền cho Jira" (`ALLOWED_SITE_HOSTS`) thay vì danh sách email — khách (guest) vào được mà không cần bảo trì danh sách.
- Phiên là cookie mã hoá (AES-GCM), không mất khi Cloud Run đổi container; refresh token nằm Postgres.
- Mỗi tab trình duyệt giữ **dự án riêng** — mở hai dự án song song không lẫn.

### 2.4. Chất lượng kỹ thuật
- Tách rõ: Jira sở hữu gì, tool sở hữu gì; bảng nào cũng khoá theo `cloudId`.
- Logic thuần (tiến độ, cascade, SLA, lịch, bộ lọc, nhập CSV…) có **unit test** cả server lẫn client, cộng **e2e** chạy Chrome thật với API giả (chạy `computeProgress` thật).
- Giao diện có design system 3 tầng token, không dùng hộp thoại trình duyệt, hỗ trợ bàn phím.

## 3. Các vấn đề lớn đã xử lý

### 3.1. Hiệu năng tải dự án lớn (vấn đề lớn nhất)
**Triệu chứng.** Dự án AI (4.044 issue) mất **35–51 giây** mỗi lần mở/làm mới. Postgres chỉ ~40 ms, đối chiếu ~250 ms — gần như toàn bộ thời gian là chờ Jira.

**Nguyên nhân.** `/search/jql` phân trang bằng token "trang kế" nên 4.044 issue = 41 request **phải chờ nhau**, mỗi request tối đa 100 issue.

**Cách xử lý (theo thứ tự đã làm):**
1. **Đọc song song theo id** (`parallelSearch.ts`): xin trước danh sách id (Jira trả tới 5.000 id/trang khi chỉ hỏi id), rồi đọc **16 nhóm × 100 id cùng lúc**. Đo thực tế qua server local: 35–51 s → 21 s (cắt theo ngày tạo) → 7,5 s (8 nhóm) → **~4,5 s (16 nhóm)**. Dự án 174 issue: 3,0 → 1,9 s; dự án 15 issue: 0,9 s (đã là sàn của một lần gọi Jira).
2. **Phương án dự phòng nhiều tầng**: theo id → cắt theo thời gian tạo → truy vấn tuần tự cũ; mỗi tầng được đối chiếu với số lượng Jira báo, lệch thì chuyển tầng và ghi lý do vào log `[perf]`.
   - *Đã thử và bỏ:* cắt theo dải key (`key >= P-1 AND key <= P-300`) chỉ lấy được 3.513/4.044 issue; chia đôi khoảng thời gian cần ~20 vòng đếm.
3. **Bản sao issue trong Postgres** (`jira_issue_cache`): vì quota Jira tính theo **app** (một hồ chứa theo giờ cho mọi người), đọc đầy đủ mỗi lần mở không mở rộng được. Giờ chỉ hỏi Jira: danh sách id người này được thấy (làm bộ lọc quyền), những gì đã thay đổi gần đây, các dòng chính app vừa ghi, các id còn thiếu. Ghi vào Jira đánh dấu dòng cũ ngay lập tức để chỉ mục tìm kiếm trễ không làm lịch bị kéo ngược.
4. **Bảng Scrum/Kanban đọc từ bản sao** (trước đó 8–9 s mỗi lần mở) — và **được kiểm chứng**, không tin mù: mỗi giờ so khớp với API board; lệch thì tự quay về API (lần chạy đầu thấy 704 thẻ trong bản sao so với 68 từ API, nên đã sửa luật "chỉ status gắn vào cột mới lên board").
5. **Dùng chung các lần đọc đang chạy** (`shareInflight`), danh sách thành viên cache 1 giờ trong Postgres, lấy vai trò/nhóm thành viên **song song** (trước đây 9–10 s lạnh trên GPM).
6. **Phía trình duyệt**:
   - Mở dự án bằng **bản sao lần trước** rồi thay bản mới (không còn trang trắng chờ).
   - Dự án quá lớn cho localStorage (2,7 MB) chuyển sang **IndexedDB** — trước đó cache âm thầm bị bỏ, F5 ra trang trắng.
   - **Tải trước** tab Bảng, Chấm công, Báo cáo khi mở dự án; tab mở lại bằng câu trả lời cuối.
   - **Nén gzip** phản hồi (Cloud Run không tự nén; `/api/tasks` 4.000 task 2,7 MB nhỏ đi ~10 lần), file `/assets` cache bất biến 1 năm.
   - **Vẽ Gantt theo cửa sổ** khi >250 dòng (chỉ ~120 dòng trong DOM) và **vá thư viện Gantt** lúc build để cuộn không render lại cả cây; có test fail nếu khung hình >100 ms trên 1.500 dòng.
   - Kế hoạch hiện **ngay khi task về**, không chờ danh sách thành viên.

### 3.2. Timeout / giới hạn của Jira API
| Vấn đề | Cách xử lý |
|---|---|
| **429 (hết quota)**: thử lại qua các đường khác chỉ tốn thêm request, từng gây 40 s chờ vô ích | 429 **không bao giờ** thử lại qua đường khác; chờ nếu `Retry-After` ngắn, báo ngay nếu dài (từng gặp 2.439 s = hết quota giờ) |
| Hết quota giữa chừng khi điền bản sao | Lưu theo từng nhóm 100 id, 429 giữa chừng thì **tiếp tục**, không làm lại từ đầu |
| Không biết quota còn bao nhiêu | Theo dõi toàn app (`jiraQuota.ts`): thấy `X-RateLimit-NearLimit` thì dừng làm mới nền, các request nền (warm-up tab) nhận 503 `JIRA_BUDGET_DEFERRED`; khi bị giới hạn thì phục vụ từ bản sao, trình duyệt hiện thông báo |
| 5xx thoáng qua từ Jira | Thử lại 2 lần, lỗi còn lại nêu đúng cuộc gọi nào hỏng |
| Cloud Run giới hạn 300 s/request | Nhập KBKT gửi theo lô 50 (`POST /issue/bulk`), chuyển trạng thái cache theo loại, chạy 4 cuộc gọi song song; nhập CSV chia lô 25 dòng; đóng stream thì dừng, nhập lại thì tiếp tục theo nhãn |
| Đo hiệu năng làm cạn quota app dev | Ghi nhận trong CLAUDE.md; thêm webhook (`JIRA_WEBHOOKS=on`) để làm mới theo sự kiện thay vì hỏi liên tục |

### 3.3. Đồng bộ hai chiều với Jira (báo cáo kiểm thử 09/2026)
Sáu lỗi tìm ra khi test trên Jira thật, đều đã sửa trừ phần cấu hình của BUG-05 (sau đó đã xử lý tận gốc):

| Mã | Mức | Lỗi | Kết quả |
|---|---|---|---|
| BUG-06 | Nghiêm trọng | Thêm phụ thuộc mới không kéo chính task đó vào đúng lịch, đẩy lịch sai lên Jira | Mỗi nút trong cascade tự kiểm tra lịch của mình trước khi đẩy tiếp |
| BUG-01 | Cao | Tạo task xong nhưng API báo "not found after create" | Sửa |
| BUG-03 | Cao | App chưa từng ghi "Start date" vào field thật của Jira | Ghi qua field phát hiện theo từng site (không còn hard-code `customfield_10059`) |
| BUG-02 | Trung bình | Đổi due date trực tiếp trên Jira, start/duration trong app không căn lại | `hydrate()` căn lại giữ nguyên duration |
| BUG-05 | Trung bình | Danh sách trạng thái cố định không khớp workflow thật | Lấy trạng thái từ **transition của chính issue**; khớp tên không phân biệt hoa thường/dấu |
| BUG-04 | Thấp | Ngày kết thúc lệch 1 ngày (UTC+7) | Client dùng getter local, server dùng UTC |

Các bài học ghi vào code: một transition có thể đòi thêm ô (ví dụ "RootCause" khi sang Done) — nay hiện đúng ô cần điền thay vì "Mở Jira để xem điều kiện thiếu"; chuyển trạng thái hàng loạt chỉ liệt kê đích đi được.

### 3.4. Đăng nhập & phiên
- **Đăng nhập thất bại vì cookie quá lớn**: tài khoản thuộc nhiều tổ chức Atlassian có refresh token to, vượt ngưỡng ~3.900 byte của cookie. Đã chuyển riêng refresh token sang Postgres (khoá `cloudId + accountId`); cookie không còn tăng theo token.
- **Không đăng nhập được ở tab thứ hai / thử tài khoản khác** (`invalid_state`): cookie OAuth giờ đặt tên theo từng `state`, các lần đăng nhập song song không giẫm lên nhau.
- Refresh token xoay vòng: làm mới sớm trong `requireAuth`, chống làm mới trùng, có cửa sổ ân hạn ~120 s.
- Đổi cách cấp quyền từ **miền email** sang **thành viên của site Jira** (hỗ trợ khách), và chọn site theo hostname thay vì `resources[0]`.
- Đăng xuất / đổi tài khoản không để lại dữ liệu cache hay cuộc trò chuyện của người trước.

### 3.5. Tính đúng của dữ liệu
- **Epic không có người làm** (cưỡng chế ở mọi cửa vào): Epic phủ cả giai đoạn sẽ "đặt kín lịch" chủ nó, làm sai toàn bộ số liệu tải.
- **Danh sách thành viên sai**: `assignable users` trên site company-managed cho cả người có giấy phép toàn site; nay ưu tiên **vai trò dự án** (mở rộng cả nhóm), tự lùi về assignable khi không đủ quyền và hiển thị đang dùng nguồn nào.
- **Chặn vòng phụ thuộc** (khi tạo bằng câu lệnh chat), chặn cấu trúc WBS sai (cha là chính nó, Sub-task làm cha…).
- **Hai người dùng chung máy** không còn thấy chat của nhau; xoá mềm để không làm mất sổ cái chi phí AI.
- **Tránh ghi trùng**: tạo lại/sửa câu hỏi AI bị từ chối nếu lượt trước đã ghi vào Jira.
- **Báo cáo không "tự đẹp"**: tính % theo baseline, SPI chỉ khi kế hoạch ≥10%, việc không có baseline được cảnh báo (vì không bao giờ trông trễ).

### 3.6. Giao diện / trải nghiệm
- Gantt: nhấp đúp vào dòng WBS từng không hoạt động vì component bị tạo lại giữa hai cú nhấp và thanh chọn đẩy bảng xuống ~45 px — đã sửa cả hai; pinch-zoom từng làm cuộn dòng; zoom nay liên tục (`pixelsPerDay`).
- Thanh công cụ ~35 nút rút còn hai lớp; tab Nguồn lực bỏ thanh trượt, cuộn như Gantt, không còn mất dòng ngoài khoảng đang xem.
- Tab Nguồn lực không còn "nhảy ra" cuối cùng làm xô lệch tab Báo cáo.

## 4. Nhược điểm và rủi ro còn tồn tại

### 4.1. Phụ thuộc vào Jira
- **Quota Jira là điểm nghẽn của cả app** (một hồ chứa theo giờ cho mọi người dùng). Bản sao và webhook đã giảm nhiều nhưng không loại bỏ: khi bị 429, **ghi vào Jira vẫn lỗi** (có chủ đích chưa xếp hàng đợi ghi).
- Trong khoảng hết quota, dữ liệu chỉ được phục vụ từ bản sao (tối đa ~1 giờ cũ).
- **Webhook chưa kiểm chứng trên Jira thật**: app dev chưa có scope và URL HTTPS; cấu trúc token bearer chưa có tài liệu đầy đủ.
- Bảng đọc từ bản sao dựa vào luật đã suy ra từ API board; vì vậy phải kiểm chứng mỗi giờ. Nếu Atlassian đổi luật, hệ thống tự lùi về API (chậm hơn) chứ không sai, nhưng cần đọc log `[board] … does NOT match`.
- Agile API cần scope chi tiết, phải bật theo thứ tự (console → biến repo) kẻo hỏng đăng nhập của mọi người.

### 4.2. Dữ liệu chỉ tồn tại trong Postgres của tool
- Mất DB thì ngày tháng lấy lại được từ Jira nhưng **mất đồ thị phụ thuộc (loại + độ trễ), baseline**, % hoàn thành, hồ sơ nguồn lực, cấu hình SLA/lịch. Cần có sao lưu/phục hồi rõ ràng cho `gms`.
- Cơ sở dữ liệu dùng chung instance với hai app khác (`intern_db`, `hnxcis`): cô lập logic nhưng chung hạ tầng và firewall.

### 4.3. Giới hạn nghiệp vụ
- **Thời lượng và cascade trên Gantt vẫn đếm theo ngày lịch**, chưa theo ngày làm việc (lịch dự án mới được heatmap, chấm công, sprint, SLA dùng). Đổi điều này chạm mọi cạnh phụ thuộc.
- Không có danh sách ngày lễ cấp site; mỗi dự án tự nhập. Lịch theo dự án nhưng hồ sơ nghỉ phép theo site → heatmap của một người dùng lịch của dự án đang xem.
- Không hỗ trợ phụ thuộc **liên dự án** (bị từ chối 400).
- Cascade là nhiều câu lệnh, không phải một giao dịch: hai cascade cùng lúc trên cùng task có thể đan xen (từng lệnh ghi đã nguyên tử).
- Hoàn tác (undo) chỉ cho kéo thanh/% trong phiên; sửa trong modal, hàng loạt, trạng thái, người làm không hoàn tác được (có tác dụng phụ trên Jira).
- `IssueTypeName` vẫn là union cố định ở một số chỗ; site đổi tên loại issue có thể gặp lệch.
- SLA chưa có: first-response, tạm dừng đồng hồ ở trạng thái chờ, thông báo khi vi phạm. Nhập chỉ đọc CSV/ô dán, chưa đọc `.xlsx` trực tiếp. Chưa có PRD/BRD upload + RAG (dù đã chọn Postgres/pgvector cho việc này).
- Đăng xuất chỉ ở phía app — Atlassian không có endpoint thu hồi refresh token 3LO.

### 4.4. Kiểm thử và vận hành
- **Mọi thứ ghi vào Jira thật** (bình luận, mention, ưu tiên/nhãn, worklog, Apply kế hoạch AI, nhập KBKT) chỉ kiểm bằng tay theo checklist; unit/e2e chạy trên dữ liệu giả. Báo cáo kiểm thử hai chiều gần nhất là trước khi chuyển sang OAuth.
- Môi trường dev cục bộ **hiện không có `DATABASE_URL`** (IP máy không nằm trong danh sách được phép, và sửa firewall ảnh hưởng hai app khác) — phải chạy Cloud SQL Auth Proxy.
- Biến môi trường của dịch vụ chỉ lấy từ `deploy.yml` (chế độ `overwrite`): chỉnh tay trên Cloud Run sẽ bị xoá ở lần deploy tới.
- `--min-instances=0` nên request đầu sau thời gian rảnh phải trả giá khởi động nguội.
- Bản vá thư viện Gantt dựa vào mã biên dịch của `gantt-task-react@0.3.x` (class CSS, đoạn code): đổi phiên bản có thể **làm hỏng build** (cố ý, để không âm thầm mất hiệu năng) và cần chỉnh lại.
- Chỉ có linter phía client; server chưa có lint.

### 4.5. AI và quyền riêng tư
- Nội dung chat, dữ liệu dự án và **tệp người dùng đính kèm** được gửi tới Google Gemini; `privacy.html` chưa nói gì về trợ lý — cần chủ sở hữu bản chính sách quyết định.
- Chi phí AI dùng chung một khoá Gemini → chỉ nhân viên (`STAFF_EMAIL_DOMAIN`) được dùng; khách không thấy chức năng này.
- Model Gemini đổi/ngừng liên tục; `GEMINI_MODEL` cũ chỉ lộ ra khi gọi lần đầu (404), không báo lúc deploy.

## 5. Đề xuất bước tiếp theo
1. **Kiểm chứng webhook trên Jira thật** (cấp scope `manage:jira-webhook` và URL HTTPS) — giảm tiếp lượng quota đọc.
2. **Quy trình sao lưu/phục hồi** cho database `gms` (đặc biệt `task_dependency`, baseline) và thử khôi phục.
3. **Chạy lại checklist ghi vào Jira thật** sau các thay đổi bản sao/quota, ghi báo cáo mới.
4. Quyết định **xếp hàng đợi ghi khi bị 429** (nếu quota là vấn đề thường xuyên khi nhiều người dùng).
5. Cập nhật **chính sách riêng tư** cho trợ lý AI.
6. Cân nhắc ngày làm việc cho thời lượng/cascade Gantt và danh sách ngày lễ cấp site.

## 6. Tóm tắt một dòng
Điểm mạnh là phần **lập kế hoạch kiểu MS Project nằm sát Jira**, số liệu do code tính và quyền theo Jira; điểm yếu là **phụ thuộc quota/độ trễ của Jira**, dữ liệu phụ trợ nằm một chỗ ở Postgres, và phần ghi lên Jira thật vẫn kiểm tay. Những vấn đề lớn nhất (tải 35–51 s, 429, timeout 300 s, cookie phiên quá lớn) đã xử lý bằng thiết kế, có đo đạc và có test bảo vệ.
