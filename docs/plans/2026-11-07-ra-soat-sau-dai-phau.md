# Rà soát sau đại phẫu: lỗi thao tác và phân cấp giao diện — 2026-11-07

Đi một vòng toàn bộ app **sau** các commit đại phẫu (`8ef5df1` → `81e6209`, kế hoạch [2026-11-07-dai-phau-ux.md](2026-11-07-dai-phau-ux.md)), bằng Playwright trên API giả lập (`e2e/mock-api.mts`, dự án DEMO, hôm nay = Thứ Bảy 07/11/2026). Đã bấm qua: rail, header, bốn lăng kính, ba chế độ Nhân lực, Hôm nay, Cài đặt (4 mục), Ctrl K, C, ?, Ctrl P, menu avatar, menu dự án, khung chi tiết, thanh chọn nhiều, kéo thanh Gantt + hoàn tác, popover Bộ lọc / Hiển thị / Nhập-Xuất / Thẻ, đổi board Scrum ↔ Kanban, Backlog, trợ lý, tờ ghi giờ. Ở 1440, 1280 và 390px; sáng và tối.

Ảnh ở `.playwright-mcp/audit/` (bị `.gitignore`, chụp lại bằng cách chạy mock + Vite rồi mở các `?view=`).

**Không kiểm được ở đây:** mọi thứ ghi vào Jira thật, đăng nhập OAuth, dự án lớn (> 250 dòng). Dữ liệu giả có chỗ tự mâu thuẫn (mục L16), nên những gì chỉ sai vì nó được ghi riêng.

---

## Mục lục

1. [Lỗi thao tác](#1-lỗi-thao-tác) — cái gì bấm mà không chạy hoặc chạy sai
2. [Vấn đề chung của giao diện](#2-vấn-đề-chung-của-giao-diện) — màu, thuật ngữ, chữ thừa, số 0
3. [Từng màn](#3-từng-màn) — phân cấp lại
4. [Thứ tự làm](#4-thứ-tự-làm)
5. [e2e và kiểm tra](#5-e2e-và-kiểm-tra)

Mức: **P0** hỏng chức năng hoặc nói dối người dùng · **P1** làm việc chậm/sai đáng kể · **P2** khó chịu, thiếu đẹp.

---

## 1. Lỗi thao tác

| # | Mức | Hiện tại (cách tái hiện) | Sửa | File |
|---|---|---|---|---|
| L1 | P0 | **URL không đi theo lăng kính.** Mở `?view=today` → bấm "Bảng" → URL vẫn `?view=today`. F5 quay về Hôm nay (đã thử: không còn `.bd-switcher`). Bấm 1 rồi 2 từ `/` rồi Back: thoát khỏi app thay vì về Kế hoạch. Gửi link cho đồng nghiệp ra sai màn | `setView` ghi `?view=` bằng `history.pushState` (đổi lăng kính) / `replaceState` (đổi chế độ Nhân lực, mục Cài đặt). Lắng nghe `popstate` để Back/Forward đổi lăng kính. Giữ các tham số khác (`project`, `report`) | `components/ProjectWorkspace.tsx:82` (chỉ đọc lúc mount), `lenses.ts` |
| L2 | P0 | **Bảng `?` hứa phím không tồn tại.** `shortcuts.ts` liệt kê S (đổi trạng thái), A (giao người), Alt ←/→ (dời 1 ngày), Ctrl . (sao chép mã), Ctrl A (chọn tất cả), J/K/Enter trên Kế hoạch, `/` ngoài Bảng. Listener trong `ProjectWorkspace.tsx:1286-1342` chỉ xử lý `? c 1-4 Shift+R m o Shift+D Shift+F t i Delete` và chuỗi `g`. Đã thử: chọn DEMO-6, bấm S, A: không có gì xảy ra | Làm các phím còn thiếu (S mở `BulkStatusMenu` cho việc đang chọn, A mở `PersonPicker`, Alt ←/→ gọi đúng đường dời ngày của thanh chọn, Ctrl . copy mã + toast, Ctrl A chọn các dòng đang hiện, J/K/Enter đi dòng trong WBS, `/` focus ô tìm của lăng kính hiện tại). Đổi listener thành bảng phát lệnh theo `Shortcut.id`, để một unit test bắt được id nào không có trình xử lý | `shortcuts.ts`, `ProjectWorkspace.tsx`, `GanttView.tsx`, test mới `client/test/shortcutsWired.test.ts` |
| L3 | P1 | **Ctrl Z ngay sau khi kéo không hoàn tác.** Kéo thanh DEMO-6 sang phải 3 ngày → Ctrl Z: thanh đứng yên. Bấm ra chỗ trống rồi Ctrl Z: chạy. Thanh vừa kéo giữ focus và nuốt keydown; listener hoàn tác đăng ký ở pha bubble (listener phím tắt đã được chuyển sang capture vì đúng lý do này, hoàn tác thì chưa) | Đăng ký listener `Ctrl Z` ở pha capture, hoặc gộp vào listener phím tắt chung (L2). Sau khi kéo, hiện toast "Đã dời DEMO-6 · Hoàn tác" (hiện không có toast nào) | `ProjectWorkspace.tsx:560-572` |
| L4 | P1 | **Mở khung chi tiết hoặc trợ lý làm cột Tên việc co lại còn ~119px** ("Giai đo…", "Viế…", "P…"), trong khi Trạng thái (112px) và Người (120px) giữ nguyên. Tên là thứ duy nhất để nhận ra dòng | Khi vùng bảng hẹp lại: Tên việc giữ tối thiểu 200px; bỏ dần theo thứ tự `%` → Người chỉ còn avatar → Trạng thái chỉ còn glyph. Cùng luật khi kéo vách ngăn | `GanttView.tsx` (`WbsListHeader`/`WbsListTable`, `--wbs-*`), `plan.css` |
| L5 | P1 | **Phím ghi trên nút sai.** Nút "Ghi giờ" ở chân Hôm nay ghi `G T`, nhưng `G T` mở Nhân lực · Giờ đã ghi chứ không mở tờ ghi giờ. Bảng `?` vẫn gọi `G T` là "Giờ làm" (tên đã bỏ) | Bảng `?`: "Giờ đã ghi". Nút "Ghi giờ" bỏ `G T`; nếu cần phím thì dùng phím riêng (đề xuất `L`, thêm vào `shortcuts.ts`) | `shortcuts.ts:27`, `TodayView.tsx` |
| L6 | P1 | **Biểu đồ "Theo người phụ trách" gãy dòng.** Thanh xếp chồng của Trần Bình và Lê Chi tách thành hai thanh trên hai dòng; mọi thanh chỉ rộng ~120px trong thẻ 640px | Một thanh `flex-wrap: nowrap`, chiếm hết cột giữa; số "mở" và cờ quá hạn ở cột phải cố định | `components/progressCharts.tsx`, `views.css` |
| L7 | P2 | Trợ lý: placeholder ô nhập dài hai dòng trong ô một dòng (chữ "hoạch" lòi nửa dưới). Esc không đóng khung trợ lý, trái luật "Esc đóng lớp trên cùng" | Placeholder ngắn ("Hỏi về dự án…"); ô tự cao theo nội dung. Đăng ký dock vào `layers.ts` với `onEscape` = thu gọn | `ChatDock.tsx` |
| L8 | P2 | Tạo nhanh "mai" khi mai là Chủ nhật: xếp việc vào ngày nghỉ, không nhắc. Dòng xem trước nói mọi thứ hai lần (chip "Nguyễn Anh · CN 8/11 · 3 ngày · Cao" rồi dòng "Task · Viết test · Nguyễn Anh · 8/11 → 10/11 · Cao") | Chip ngày rơi vào ngày nghỉ theo lịch dự án thì có viền `--warn` + title "Ngày nghỉ". Bỏ dòng tóm tắt thứ hai, chỉ giữ khoảng ngày "8/11 → 10/11" ở chip ngày | `quickAdd.ts`, `CommandBar.tsx` |
| L9 | P2 | Kanban: cột rỗng (Backlog, Selected for development) vẫn mở rộng, ghi "0 việc", chiếm 2/5 bề ngang | Cột rỗng mặc định gập (người dùng mở ra thì nhớ như hiện nay); ẩn "0 việc" | `KanbanBoard.tsx` |
| L10 | P2 | Nhân lực: vạch hôm nay ở lưới tải nằm ở mép đầu cột tuần (02/11), còn ở các dòng việc mở ra nằm đúng ngày 07/11. Hai vạch lệch nhau trên cùng một trục | Một vị trí: phân số của cột theo ngày (như `placeBar`) | `ResourceView.tsx`, `resourceColumns.ts` |
| L11 | P2 | "Vì sao?" ở Nhịp dự án chèn khối lý do xuống giữa trang (sau bộ lọc), xa câu kết luận nó giải thích, và là thẻ viền trái đỏ (MASTER cấm). Nút đổi thành "Ẩn lý do" nền xanh | Lý do mở ngay dưới câu kết luận, dạng danh sách chữ thường không viền. Nút giữ kiểu nút phụ | `ProgressReportView.tsx` |
| L12 | P2 | Cài đặt › Thẻ trên board không nói đang chỉnh board nào (Bảng DEMO hay Kanban) | Tiêu đề phụ: "Bảng DEMO · Scrum" + menu đổi board | `BoardCardSettings` trong `ProjectSettings.tsx` |
| L13 | P2 | Giờ đã ghi: chú giải "Nghỉ nghỉ phép" | `<span class="ts-away">Nghỉ</span> nghỉ phép` → chỉ ô mẫu + "nghỉ phép" | `TimesheetView.tsx:416` |
| L14 | P2 | Hôm nay › Xếp lịch: placeholder bị cắt "dd/mm/yyy" | Ô rộng đủ 10 ký tự mono | `today.css` |
| L15 | P2 | Popover "Thẻ" ở Bảng bị cắt đáy, "Sub-task" che nửa, cuộn trong 410px dù màn còn chỗ | `max-height: calc(100vh - top - 16px)` | `Popover.tsx` / `views.css` |
| L16 | P2 | **Dữ liệu giả tự mâu thuẫn:** `base.durationDays = 4` trong khi `startDate/dueDate` của nhiều việc cách 7–8 ngày. Hậu quả thấy được: khung chi tiết DEMO-3 ghi kết thúc 02/11, thanh và thẻ ghi 06/11; hoàn tác sau khi kéo co thanh DEMO-6 từ 7 xuống 4 ngày; biểu đồ xu hướng ghi "Thực tế 30%" khi tiêu đề ghi 16.7%. Không phải lỗi production (server luôn giữ `due = start + duration − 1`), nhưng e2e đang chạy trên dữ liệu mà production không bao giờ có | Mock tính `durationDays` từ `startDate`/`dueDate`; điểm cuối của chuỗi snapshot = số đo hôm nay | `e2e/mock-api.mts:38` |

---

## 2. Vấn đề chung của giao diện

### G1. Xanh dương và tím còn sót làm tín hiệu thường (trái MASTER §1)

| Chỗ | Hiện tại | Đúng luật |
|---|---|---|
| Thanh tiến độ sprint (dải sprint ở Bảng, hàng Sprint ở Backlog) | Xanh dương | Mực, vạch "nên ở đây" như thanh Tiến độ ở Nhịp dự án |
| Viên trạng thái ở Backlog ("In Progress" xanh, "Done" xanh lá, "Đang chạy") | Viên màu | `StatusGlyph` + tên (G2) |
| Giờ đã ghi: ô và thanh tổng | 4 sắc xanh | Cùng thang mực với Mức tải (F3 bên dưới) |
| Nhịp dự án › Thời hạn: phần còn lại | Xanh nhạt | `--sunken` |
| Khung chi tiết › Liên kết Jira: mã "DEMO-5" | Xanh, gạch chân | Mã mono `--ink`, gạch chân khi rê |
| Vạch phát hành "1.0" trên Gantt | Tím, nét đứt | `--ink-3` nét đứt (tím chỉ cho AI) |

### G2. Một trạng thái, ba cách vẽ

Kế hoạch dùng `StatusGlyph` (○ ◑ ●✓), Backlog dùng viên màu, Bảng dùng cột. Mọi danh sách dùng `StatusGlyph` + tên workflow; ô sửa được thì là glyph + tên + caret khi rê, không phải `<select>` có viền thường trực.

### G3. Một khái niệm, nhiều tên

Thêm bảng thuật ngữ vào MASTER.md và sửa chuỗi theo nó:

| Dùng | Bỏ | Đang thấy ở |
|---|---|---|
| Người | Người phụ trách | Cột "Người" nhưng panel Hiển thị, Bộ lọc, Thẻ, Nhịp dự án ghi "Người phụ trách" |
| Ưu tiên | Độ ưu tiên | Khung chi tiết "Ưu tiên", Hiển thị/Thẻ "Độ ưu tiên" |
| Epic | Giai đoạn (Epic), Theo giai đoạn | Nhịp dự án |
| Công suất | Năng lực | Nút "Năng lực" ở Backlog, tờ ghi giờ "năng lực 8h" ("năng lực" là *khả năng*, không phải *giờ có*) |
| Giờ đã ghi | Giờ làm | Bảng `?` |
| Sub-task | Việc con, Công việc con | Thẻ board "Việc con DEMO-902", SLA "Công việc con" |
| Loại việc | Loại issue | Cài đặt › Nhập KBKT |
| việc | công việc | Lý do sức khoẻ "1/5 công việc đang mở…" (`server/src/progress.ts`), "Luồng công việc" (`AgileReports.tsx:22,133`, `AgileCharts.tsx:176`) |

### G4. Chữ thừa (trái MASTER §5 "Chữ trên màn hình")

- Tooltip "Bộ lọc đã lưu" là một câu ("Lưu bộ lọc đang chọn thành bộ lọc có tên, áp dụng lại hoặc chia sẻ với cả dự án") → "Bộ lọc đã lưu".
- Menu Nhập / Xuất: mỗi mục có một dòng mô tả → chỉ tên.
- Cài đặt: đoạn giải thích dưới "Ngày lễ", "Ngày làm bù", năm đoạn ở SLA, một đoạn ở KBKT → bỏ, đưa vào `title` của nhãn nếu thật cần.
- Nhịp dự án: "toàn dự án · số đo, không cần báo cáo AI" → bỏ.
- Tờ ghi giờ: "Ghi bằng tài khoản Jira của bạn" → bỏ (đã nói ở bảng `?`).
- Kỹ năng: "4/4 người chưa có kỹ năng nào. Bấm vào ô để bật/tắt." khi không có ô nào → bỏ (F5).
- Trợ lý: màn trống lặp lại placeholder → màn trống không chữ.
- Bảng phím tắt: tiêu đề phụ "Không chạy khi đang gõ trong ô nhập." → bỏ.

### G5. Số 0 vẫn hiện

"0 việc" (dòng người ở Nhân lực, cột Kanban, Sprint 8), "Ngày lễ (0 ngày)" và "Ngày làm bù (0)" (hai kiểu viết khác nhau), "Vượt công suất 0 ngày-người", "0% vận tốc". Ẩn, theo A10 của bản đại phẫu.

### G6. Ba kiểu ô số liệu

Mức tải dùng pill, Giờ đã ghi dùng ba thẻ có viền, Nhịp dự án dùng thẻ có icon tròn màu + viền hồng. Một thành phần `Metric` (số mono lớn + nhãn `--ink-3`, không viền, xếp thành một hàng), dùng ở cả ba chỗ. Pill lọc người ở Mức tải vẫn là pill vì nó là bộ lọc, không phải số liệu.

---

## 3. Từng màn

### 3.1. Khung: rail và header

| # | Hiện tại | Sửa |
|---|---|---|
| K1 | Hai hệ điều hướng chồng nhau: rail có "Hôm nay", "Dự án" (tooltip "Dự án 1–4"), header có bốn lăng kính. Logo "G" và "Hôm nay" cùng đích. Bấm "Dự án" khi đang trong dự án không làm gì | Logo không còn là nút (hoặc là nút duy nhất về Hôm nay và bỏ mục "Hôm nay"). "Dự án" chỉ là dấu "đang ở đây"; tooltip "Dự án" |
| K2 | Menu tên dự án có tiêu đề "Example" (tên site Atlassian), không nghĩa gì với người dùng | Bỏ tiêu đề; site đã có ở menu avatar |
| K3 | Ở Cài đặt: không lăng kính nào gạch dưới, rail không đánh dấu, "← Về Hôm nay" luôn về Hôm nay | "← Quay lại" về lăng kính vừa rời (L1 cho sẵn bằng `history.back()` khi có) |
| K4 | Ctrl P mở "Chọn dự án": dự án đang mở không được đánh dấu; ô vuông xám trống thay avatar; nhãn "Tìm dự án" lặp placeholder | Dấu ✓ ở dự án hiện tại; bỏ ô vuông khi không có avatar; bỏ nhãn |

### 3.2. Hôm nay

- Tên dự án hiện hai lần (header và dòng phụ dưới ngày) → bỏ dòng phụ.
- Dòng đầu danh sách tô `--info-wash` + viền trái ngay khi mở trang, trông như đã chọn → chỉ tô khi đã bấm J/K hoặc rê chuột.
- Thanh cố định ở đáy "Ghi giờ hôm nay ……… [Ghi giờ G T]": nhãn và nút nói cùng một ý, chiếm một dải → một nút phụ "Ghi giờ" ở hàng tiêu đề trang.
- Tờ ghi giờ: đầu ghi "năng lực 8h · đã ghi 4h", chân ghi "Tổng 0h / 8h": hai tổng khác nhau cho cùng một ngày. Một con số: "Đã ghi 4h · thêm 0h / 8h". Ngày nghỉ (hôm nay là Thứ Bảy) không có 8h công suất.

### 3.3. Kế hoạch

| # | Hiện tại | Sửa |
|---|---|---|
| P1 | Thanh công cụ là 16 điều khiển một tầng. Ở 1280px (và khi khung chi tiết mở) "Của tôi", "Quá hạn" rơi về icon người và tam giác không nhãn, "Chưa có ngày" thành "⚠ (1)" | Ba nhóm, thứ tự đọc trái → phải: **[Tìm · Bộ lọc (n) · Đã lưu]** · **[Ngày/Tuần/Tháng · Hôm nay]** · **[↶ · ⋯]**. "Của tôi / Quá hạn / Chưa có ngày" thành ba công tắc đầu tiên trong panel Bộ lọc (phím M, O vẫn chạy) và hiện thành chip khi bật. Thu/Mở tất cả, Hiển thị, Nhập/Xuất, `?` vào menu `⋯` |
| P2 | Placeholder ô tìm bị cắt "Tìm theo mã hoặc tên việ" và đè nút JQL | Placeholder "Tìm việc…"; JQL là một chế độ của ô tìm (gõ `jql:` hoặc bấm nút), nằm trong ô không đè chữ |
| P3 | Icon ⇅ cho Nhập/Xuất đọc như "Sắp xếp" | Vào menu `⋯` (P1) với icon tải lên/tải xuống |
| P4 | Nhãn tháng bị cắt ở mép trái ("), 2026"); nhãn Epic "Giai đoạn 1 – Khảo sát" đè cờ "0.9"; nhãn ngoài thanh ("Sửa lỗi hiển thị bảng") đè vạch phát hành | Nhãn tháng dính mép trái (sticky) như Nhân lực; cờ phát hành vẽ trong dải trục ngày, không trong dòng đầu; nhãn có nền `--sheet` 2px khi đè vạch |
| P5 | Tuần hiện tại tô nền son cả cột **và** có vạch son hôm nay: hai tín hiệu "bây giờ" | Bỏ tô cột; giữ vạch |
| P6 | Panel Hiển thị: "Mặc định", "Tất cả" ở chân chữ ~18px đậm, ngoài thang chữ; nhãn "Biểu đồ" dính sát segmented phía trên | Nút chữ `--font-size-sm`; khoảng `--space-3` giữa các nhóm | 
| P7 | Thanh chọn: "‹ 1 › ngày" không có nhãn, không đoán được là dời lịch | "Dời ‹ 1 ngày ›" |
| P8 | Chọn dòng chỉ tô ở bảng; thanh tương ứng trên biểu đồ không đổi | Thanh đang chọn có viền `--info` |

`GanttView.tsx:1901` (nút "Mặc định"), `FilterBar.tsx`, `plan.css`, `TimelineMarkers`.

### 3.4. Khung chi tiết

- "Liên kết Jira": ô chọn "blocks" và "+ Chọn việc" luôn hiện dưới danh sách → gom sau một nút "+ Liên kết", như "+ Phụ thuộc" đã làm.
- Dòng liên kết "*blocks* DEMO-5 · Thiết kế cơ sở dữ liệu [To Do]": loại liên kết nghiêng tiếng Anh, trạng thái trong ngoặc vuông, "gỡ" đỏ luôn hiện → "chặn · DEMO-5 Thiết kế cơ sở dữ liệu ○", nút gỡ (×) chỉ hiện khi rê.
- "Công sức [12] h ước lượng 0h đã ghi + Ghi giờ" dồn bốn thứ vào một dòng → "Ước lượng [12] h" và dòng dưới "Đã ghi 0h · + Ghi giờ".

### 3.5. Bảng và Backlog

| # | Hiện tại | Sửa |
|---|---|---|
| B1 | Ba tầng chrome (~240px) trước thẻ đầu tiên: (switcher · Scrum · Sprint/Backlog · Thẻ · Mở trên Jira), (tìm · lọc · Nhóm theo), (dải sprint cao 90px với mục tiêu sprint một dòng riêng) | Hàng 1: switcher · Sprint/Backlog · tìm · lọc · `⋯` (Thẻ, Nhóm theo, Mở trên Jira). Dải sprint một dòng: "Sprint 7 · 02/11–16/11 · còn 6 ngày · ▬▬▭ 17% · [Hoàn thành sprint]"; mục tiêu sprint trong `title` hoặc dòng nhỏ khi rê |
| B2 | Huy hiệu đỏ "▼ Chậm hơn nhịp" lặp lại ý của thanh tiến độ có vạch | Bỏ huy hiệu; vạch "nên ở đây" trên thanh đỏ khi chậm |
| B3 | Thẻ: Epic chiếm một dòng riêng; Sub-task hiện thành thẻ riêng trong cột trong khi cha đã ghi "1/2 sub-task" | Epic vào hàng meta (cắt trước); "Gộp sub-task vào thẻ cha" bật mặc định |
| B4 | Việc chưa gán: Bảng để trống, Backlog vẽ "?" | Cùng một cách (để trống, như MASTER mô tả `Avatar`) |
| B5 | Backlog: nhãn Epic dạt mép phải xa tiêu đề; "86% vận tốc" không ai hiểu | Epic ngay sau tiêu đề, `--ink-3`; "18 / 21 điểm (trung bình 3 sprint)" |

### 3.6. Nhân lực

| # | Hiện tại | Sửa |
|---|---|---|
| F1 | **Ba chế độ, ba bố cục.** Công tắc Mức tải · Giờ đã ghi · Kỹ năng đổi vị trí và chiều cao khi bấm (y=67 → 78 → 67); Giờ đã ghi bỏ thanh lọc, có nút đặc "+ Ghi giờ"; Kỹ năng vẫn mang "Quá hạn", "Bộ lọc" (không có nghĩa với ma trận kỹ năng) | Một hàng cố định cho cả ba: **[chế độ] [tìm người]** ······ **[điều khiển riêng của chế độ]**. Lọc việc chỉ có ở Mức tải. "+ Ghi giờ" thành nút phụ (nút đặc duy nhất trên màn là thứ chính của màn; ở đây không có) |
| F2 | Mức tải: chú giải "<50%" là ô vuông rỗng, không giống cột tải thật | Chú giải vẽ đúng cột nhỏ như ô |
| F3 | Hai thang khác nhau cho cùng câu hỏi "người này bận thế nào": Mức tải mực, ngưỡng <50 / 50–100 / >100; Giờ đã ghi xanh 4 bậc, ngưỡng <50 / 50–95 / đủ / vượt | Một thang, một bảng màu mực; ngưỡng chung trong `resourceAllocation.ts` |
| F4 | Dòng việc mở ra dưới một người là khối đen đặc "32h" | `--ink-3` nền nhạt + số giờ; đen đặc chỉ khi đang kéo |
| F5 | Kỹ năng trống chỉ có "Chưa có kỹ năng nào." và ô "Thêm cột kỹ năng" (ngôn ngữ kỹ thuật) | Vẫn liệt kê mọi người; ô "+ Kỹ năng" ở đầu bảng; bấm tên người mở hồ sơ |

### 3.7. Nhịp dự án

| # | Hiện tại | Sửa |
|---|---|---|
| N1 | Tiêu đề "Nhịp dự án" lặp tên lăng kính; bộ lọc phạm vi nằm **dưới** câu kết luận, nên không rõ "Chậm tiến độ." nói về phạm vi nào | Bỏ tiêu đề; hàng đầu là "07/11/2026 · 7 việc · [Người ▾] [Epic ▾] [Loại ▾] [ngày]" · "AI Phân tích" · in. Câu kết luận ngay dưới, theo phạm vi đang chọn |
| N2 | "Giai đoạn (Epic)" song ngữ; ô "Loại" không có nhãn như hai ô kia | Ba ô cùng kiểu: nhãn nằm trong nút ("Người: Tất cả") |
| N3 | "16 . 7%" ở cỡ display: dấu chấm mono rộng bằng một chữ số | Số lớn dùng `--font-sans` 600 (chữ số Be Vietnam Pro đủ đều ở một con số đứng riêng); mono giữ cho cột |
| N4 | "SPI 0.5" không giải thích | "SPI 0.5" có `title` "Tiến độ thực / kế hoạch"; hoặc thay bằng "chậm 16.6 điểm %" đã có trong lý do |
| N5 | "Theo Epic": tên cắt "Giai đoạn 2 – Xây dựn" vì cột nhãn hẹp; biểu đồ xu hướng chỉ chiếm 1/3 bề ngang thẻ; thẻ "Xu hướng qua các lần phân tích" trống vẫn chiếm một khối | Cột nhãn co giãn; biểu đồ rộng hết thẻ; thẻ trống không vẽ |
| N6 | Ba ô Quá hạn / Sắp đến hạn / Chưa gán: icon tròn màu + viền hồng + số | `Metric` (G6), bấm mở ngăn như hiện nay |

### 3.8. Cài đặt dự án

- SLA chứa "Giờ làm việc" (khung giờ, múi giờ). Đó là một phần của lịch làm việc → chuyển sang mục Lịch làm việc; SLA chỉ ghi một dòng tóm tắt + liên kết (đã làm thế cho ngày lễ). `patchSlaSettings` đã tách quyền ghi theo trường nên chỉ đổi giao diện.
- Lưới thời hạn theo ưu tiên là 3 cột × (nhãn, ô, "giờ"), nên "High" đứng giữa hàng → bảng hai cột: Ưu tiên | Giờ.
- Nhập KBKT: ô chọn "Sub Bug (không có trong dự án)" xuống hai dòng trong ô; nhãn trường dài xuống dòng làm các ô trong cùng hàng lệch nhau → ô chọn một dòng có `text-overflow: ellipsis` + cảnh báo bên dưới; nhãn ngắn, phần giải thích vào `title`.
- Nút "Lưu" khi chưa có thay đổi là khối xám đặc, trông như đang bận → kiểu nút chính mờ (opacity) như các nút disabled khác.

### 3.9. Điện thoại (390px)

Vỡ hoàn toàn: header tràn (mất "Nhịp dự án", tên dự án bị cắt còn "DEMO"), thanh công cụ Kế hoạch đè chữ, cột WBS chồng nhau, thanh lọc Bảng tràn ngang; rail chiếm 56/390px. Đây là quyết định sản phẩm, không phải sửa CSS: đề xuất dưới 768px chỉ có **Hôm nay** và **Bảng dạng danh sách** (đọc + đổi trạng thái + ghi giờ), rail thành thanh dưới. Ghi lại ở "Không làm" cho tới khi có quyết định.

---

## 4. Thứ tự làm

| Đợt | Nội dung | Ước lượng | Xong khi |
|---|---|---|---|
| 1. Lỗi | L1, L2, L3, L4, L5, L6, L16; rồi L7–L15 | 1,5 ngày | e2e mới ở §5 xanh; bảng `?` không còn phím nào không chạy |
| 2. Hệ thống | G1 màu, G2 `StatusGlyph` khắp nơi, G3 bảng thuật ngữ (MASTER.md + sửa chuỗi), G4 chữ thừa, G5 số 0, G6 `Metric` | 1,5 ngày | `grep` các tên bị bỏ trong G3 không còn trong chuỗi JSX; `noRawColors` vẫn xanh; không còn `--info` làm màu thanh tiến độ |
| 3. Phân cấp | 3.3 thanh công cụ Kế hoạch; 3.5 chrome Bảng; 3.6 khung chung Nhân lực; 3.7 hàng đầu Nhịp dự án; 3.8 chuyển Giờ làm việc; 3.1, 3.2, 3.4 | 3 ngày | Ảnh 1440 và 1280, sáng và tối, cho mỗi lăng kính; ở 1280 không còn bộ lọc nào chỉ là icon |
| 4. Điện thoại | 3.9 | Chờ quyết định | |

Đợt 1 làm trước vì L1–L3 là lỗi người dùng gặp mỗi ngày và L16 làm e2e của các đợt sau đáng tin. Đợt 2 trước đợt 3 vì đợt 3 dựng lại màn bằng các thành phần của đợt 2.

## 5. e2e và kiểm tra

Mới:

- `e2e/url-view.e2e.mjs` (L1): đổi lăng kính → URL đổi; F5 giữ lăng kính; Back về lăng kính trước; `?view=timesheet` vẫn mở Nhân lực · Giờ đã ghi.
- `client/test/shortcutsWired.test.ts` (L2): mọi `SHORTCUTS[].id` có trình xử lý trong bảng phát lệnh.
- `e2e/keyboard.e2e.mjs` (L2, L3): chọn một dòng → S mở menu trạng thái, A mở bộ chọn người, Alt → dời 1 ngày; kéo thanh rồi Ctrl Z ngay (thanh còn focus) → thanh về chỗ cũ, có toast.
- Bổ sung `e2e/task-detail-polish.e2e.mjs` (L4): mở khung chi tiết ở 1440 → cột Tên việc ≥ 200px.

Phải sửa theo: `header-toolbar.e2e.mjs` (thanh công cụ ba nhóm, `⋯`), `board-kanban.e2e.mjs` (cột rỗng gập, chrome một hàng), `resource-layout.e2e.mjs` (hàng điều khiển chung ba chế độ), `pulse-today.e2e.mjs` (nút Ghi giờ), `settings-page.e2e.mjs` (Giờ làm việc ở Lịch làm việc).

Trước khi giao mỗi đợt: `cd client && npm test && npm run lint && npm run build`, `cd e2e && npm test`, và đi lại vòng ở đầu tài liệu này bằng Playwright ở 1440 sáng và 1280 tối. Cập nhật MASTER.md (thuật ngữ G3, `Metric`, luật cột WBS khi hẹp) và CLAUDE.md (URL theo lăng kính, bảng phát lệnh phím tắt, Giờ làm việc thuộc lịch).

---

## 6. Đã làm (cập nhật 2026-11-07)

Mọi mục của bản rà soát đã làm.

**Đợt 1, lỗi:** L1–L16. URL theo lăng kính (`?view=`, Back/Forward), bảng phát lệnh phím tắt (`shortcutIdFor` + `shortcutsWired.test.ts`), Ctrl Z ở pha capture kèm toast, cột Tên việc giữ 200px (`wbsFit.ts`), phím `L` thay `G T` trên nút Ghi giờ, biểu đồ theo người một dòng, mock dữ liệu khớp `due = start + duration − 1`.

**Đợt 2, hệ thống:** G1–G6 (thanh sprint/backlog/giờ đã ghi/hạn theo thang mực, vạch phát hành `--ink-3`, `StatusGlyph` thay viên màu, bảng thuật ngữ, chữ thừa, số 0, `Metric`).

**Đợt 3, phân cấp:** 3.1 (K1, K2, K4; K3: quay lại bằng lịch sử), 3.2, 3.3 (P1–P8: nhãn tháng dính mép trái, cờ phát hành trên nền, thanh đang chọn có viền), 3.4, 3.5 (B1–B5), 3.6 (F1–F5: ngưỡng chung `ratioBand`, thanh việc nhạt, Kỹ năng liệt kê mọi người, "+ Kỹ năng" ở đầu bảng, bấm tên mở hồ sơ), 3.7 (N1–N6), 3.8 (Giờ làm việc và múi giờ chuyển sang Lịch làm việc: `PUT /api/calendar` ghi đủ năm trường; bảng ưu tiên, ô chọn KBKT, nút Lưu mờ).

**Đợt 4, điện thoại (3.9):** dưới 768px chỉ có Hôm nay và Bảng dạng danh sách; thanh bên thành thanh dưới. Đây là đề xuất của bản rà soát, được làm theo đúng đề xuất; thay đổi lại bằng `PHONE_MAX_WIDTH` và `phoneView` trong `usePhone.ts`.
