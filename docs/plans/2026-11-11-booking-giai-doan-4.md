# Booking, giai đoạn 4: nối vào phần còn lại — bàn giao 2026-11-11

Bản này cho phiên làm tiếp. Đọc trước, theo thứ tự:

1. `CLAUDE.md`, mục "Booking and Clockwork: a person across projects": những gì đã có và vì sao.
2. [2026-11-11-booking-va-clockwork.md](2026-11-11-booking-va-clockwork.md): nghiệp vụ, ba vai, bảy câu hỏi còn chờ quản lý (mục 9), và mục "Trạng thái" ở đầu file.
3. `design-system/gms-prjmanagement/MASTER.md` trước khi đụng vào giao diện.

Giai đoạn 1–3 đã xong và **chưa commit**. Chưa có gì chạy với Jira thật.

## Trạng thái (cuối phiên làm giai đoạn 4)

Đã làm xong, có test và đã ghi vào `CLAUDE.md` (mục "Bookings feed the rest of the app"): **1.1** huy hiệu theo booking, **1.2** "+ Thêm việc" tìm mọi dự án, **1.3** kéo sang người khác và J/K/N/Enter, **2.1** gợi ý giao việc trừ giờ bị giữ (server và client), **2.2** công cụ `bookings` của trợ lý (chỉ đọc), **2.3** công suất sprint trừ giờ bị giữ, **2.4** dòng "được giao nhiều hơn booking" ở Nhịp dự án. Mục F13–F18 của danh sách kiểm tay là các lời gọi mới chưa chạy với Jira thật.

**Chưa làm, có chủ đích:** 2.5 (duyệt) chờ quản lý trả lời câu 3; mục 0.2 (commit/tách nhánh), 0.3 (danh sách kiểm F với Jira thật) và 0.4 (bảy câu hỏi) là việc của người dùng. `client/public/privacy.html` chưa nói gì về trợ lý, nay trợ lý còn đọc booking: để người giữ trang quyết.


---

## 0. Việc phải làm trước mọi thứ khác

| # | Việc | Vì sao |
|---|---|---|
| 0.1 | Chạy đủ ba bộ test (lệnh ở [mục 4](#4-kiểm-tra-sau-mỗi-mục)) trên cây làm việc hiện tại, khi máy không chạy gì khác | Cuối phiên trước bộ e2e được chạy cùng lúc với các bộ test khác; kết quả của lần chạy đó ghi ở [mục 5](#5-kết-quả-kiểm-tra-cuối-phiên-trước) |
| 0.2 | Hỏi người dùng có commit không, rồi tách nhánh khỏi `main` trước khi commit | Đang ở `main`, chưa được yêu cầu commit |
| 0.3 | Làm mục F của `docs/test-reports/2026-10-15-jira-that-checklist.md` với Jira thật (người dùng làm tay) | Bốn lời gọi Jira mới chưa từng chạy thật: `GET /myself?expand=groups`, `GET /user/bulk`, `GET /user/search`, JQL `worklogAuthor = currentUser()` không kèm dự án. Giai đoạn 4 xây trên chúng |
| 0.4 | Hỏi người dùng quản lý đã trả lời bảy câu ở mục 9 của bản kế hoạch chưa | Câu 1 (book theo dự án hay theo task) và câu 3 (có duyệt không) đổi cả mô hình dữ liệu. Đừng xây thêm lên một lựa chọn sắp bị đổi |

Nếu 0.3 cho thấy token không đọc được nhóm: đặt `RESOURCE_MANAGER_ACCOUNT_IDS` (repo variable, cách nhau bằng `;`) và ghi kết quả vào `CLAUDE.md` thay cho câu "unverified against real Jira".

---

## 1. Ba thứ còn nợ từ giai đoạn 2–3

Nhỏ, độc lập, làm trước giai đoạn 4 vì chúng là chỗ người dùng sẽ chạm vào đầu tiên.

### 1.1 Huy hiệu trên lăng kính Resource đếm theo booking

- **Hiện tại:** `ProjectWorkspace.tsx` tính `overloadedPeople` từ `nearLoad` (Mức tải, hai tuần tới) và đưa cho `Toolbar`. Chế độ mặc định của lăng kính giờ là Booking, nên con số trên huy hiệu và con số "Quá tải n" trong màn không cùng nguồn.
- **Sửa:** khi dự án có ít nhất một booking trong hai tuần tới, huy hiệu = `bookedCounts(...).over` của phạm vi dự án; không có booking nào thì giữ cách đếm theo Mức tải.
- **Lưu ý:** không được gọi thêm `GET /api/bookings` chỉ để vẽ huy hiệu ở mọi lần mở dự án nếu tránh được. `useBookings` đã ghi `viewCache` ("bookings"); đọc bản đó khi có, và để `warmViews.ts` tải sẵn cùng lúc với timesheet (đánh dấu `X-GMS-Background`). Route này không gọi Jira ngoài việc kiểm quyền (đã nhớ 5 phút), nên rẻ.
- **File:** `ProjectWorkspace.tsx` (quanh dòng 585–601), `warmViews.ts`, `api.ts` (`getBookings` thêm `background`), `e2e/warm-views.e2e.mjs` đếm số request: cập nhật con số.

### 1.2 "+ Thêm việc" ở Clockwork tìm trên mọi dự án

- **Hiện tại:** `TimesheetMine` đưa cho `TaskPicker` kế hoạch của tab cộng `sheet.openWork` (việc đang mở giao cho mình ở dự án khác, ≤30). Việc của dự án khác mà không giao cho mình thì không chọn được.
- **Sửa:** `TaskPicker` nhận thêm `remote?: (q: string) => Promise<Array<{ key; summary; issueType }>>`, gọi sau 250 ms khi `q` ≥ 2 ký tự, nối kết quả sau kết quả tại chỗ, bỏ trùng theo key. Server: route `GET /api/clockwork/issues?q=` (đã viết rồi gỡ ở phiên trước vì chưa có ai gọi; xem lịch sử `routes/clockwork.ts` trong diff, hoặc viết lại: khoá chính xác thì `key = "X-1"`, còn lại `summary ~ "q*" AND statusCategory != Done AND issuetype != Epic`, ≤15, bỏ `"` và `\` khỏi `q`).
- **Lưu ý:** dòng được thêm phải có tên. `buildMyRows` lấy tên từ `tasks`, từ worklog đầu tiên, rồi từ `openWork`; việc tìm từ xa không nằm ở đâu trong ba chỗ đó. Giữ một `Map` các việc đã chọn trong `TimesheetMine` và truyền vào `openWork` của `buildMyRows`.
- **File:** `TaskPicker.tsx`, `taskPickerModel.ts` (+ test), `TimesheetMine.tsx`, `routes/clockwork.ts`, `api.ts`, `e2e/mock-api.mts`, `e2e/booking.e2e.mjs`.

### 1.3 Kéo một booking sang người khác, và bàn phím

- **Kéo sang người khác:** `PATCH /api/bookings/:id` đã nhận `accountId`. Trong `BookingView`, khi kéo thân thanh ra khỏi dòng của người đó, tìm `.bk-person` dưới con trỏ (`document.elementFromPoint`) và gửi `{ accountId }` kèm ngày nếu ngày cũng đổi. Chỉ cho thả vào dòng tổng hoặc dòng cùng dự án của người kia. `useBookings.update` hiện chỉ nhận ngày, giờ, trạng thái, ghi chú: thêm `accountId`.
- **Bàn phím:** `N` mở khung tạo cho người đang mở (dùng `bookNextWeek`), J/K đi giữa các dòng người, Enter mở/đóng. Thêm vào `shortcuts.ts` và `LOCAL_SHORTCUTS` (xử lý tại chỗ trong `BookingView`); `client/test/shortcutsWired.test.ts` sẽ hỏng nếu một phím có trong bảng `?` mà không ai xử lý. `N`, `J`, `K` đã có nghĩa ở màn khác: kiểm `shortcutIdFor` không trả hai id cho một phím.

---

## 2. Giai đoạn 4

Mỗi mục độc lập, giao được riêng. Thứ tự dưới đây là thứ tự giá trị cho người quản lý.

### 2.1 Gợi ý giao việc biết booking ở dự án khác

**Vấn đề.** "Ai nhận việc này?" hiện chỉ biết task của dự án đang mở. Một người rảnh ở dự án này nhưng đã bị book kín ở dự án khác vẫn được xếp đầu.

**Hai nơi tính, phải đổi cả hai** (CLAUDE.md: "change both"):

- Server: `server/src/workload.ts` — `buildWorkload` (tải theo ngày) và `rankCandidates` (ít ngày trùng trước, rồi theo tải). Dùng bởi `autoAssign`, `suggest_assignees`, `team_workload` trong `ai/tools.ts`.
- Client: `client/src/assignHints.ts` — cùng luật, cho mọi `PersonPicker`.

**Sửa.** Thêm vào đầu vào của cả hai một danh sách "giờ đã bị giữ ở nơi khác" theo người theo ngày: booking của người đó trên **dự án khác dự án đang xét**, đúng luật `hoursOn` của `bookingModel.ts` (ngày làm việc, không nghỉ phép). Giờ đó cộng vào tải trước khi so với công suất. Booking trên chính dự án đang xét **không** cộng: task của dự án đó đã là cách tiêu phần giờ ấy, cộng nữa là đếm hai lần.

- Server: `WorkloadInput` thêm `heldElsewhere?: Booking[]`; `ToolContext` thêm `bookings?: () => Promise<Booking[]>` nạp một lần mỗi lượt (như `workCalendar`), đọc `bookingStore.listInRange` rồi lọc `projectKey !== ctx.projectKey`. Trợ lý chạy với quyền của người hỏi nhưng con số "giờ bị giữ" không lộ tên dự án, nên dùng thẳng danh sách đầy đủ của site, **không** qua `shapeForViewer`; kết quả trả cho model chỉ nói "đã bị giữ n giờ ở dự án khác", không bao giờ kèm mã dự án.
- Client: `assignHints` nhận thêm `held?: Map<accountId, Map<date, hours>>`, dựng từ `BookingSheet` của phạm vi dự án (`viewCache` "bookings"; các dòng `projectKey !== dự án đang mở`, kể cả `null`).
- Nhãn trong picker: thêm "bị giữ 4h/ngày" cạnh "trùng n ngày" khi phần trùng đến từ booking chứ không từ task. Một nhãn, không câu giải thích.
- Viết bản soi nhỏ của `hoursOn` ở server (`server/src/bookingLoad.ts`), ghi "mirror of client/src/bookingModel.ts hoursOn — change both", và một test chạy cùng các ca trên cả hai (cách `client/test/workCalendar.test.ts` đang làm).

**Test.** `server/test/tools.test.ts` (ca: A rảnh theo task nhưng bị giữ 8h ở dự án khác thì xếp sau B), `client/test/assignHints.test.ts` (cùng ca), `e2e/assign-hints.e2e.mjs`.

### 2.2 Trợ lý đọc được booking

Công cụ **chỉ đọc**, đăng ký trong `ai/tools.ts` cạnh `team_workload`:

- `bookings` — tham số: `person?` (tên nói, qua `resolvePerson`), `from?`, `to?` (mặc định hôm nay + 4 tuần). Trả mỗi người: công suất, giờ book theo tuần, tuần nào vượt, còn trống bao nhiêu. Trả lời được "tuần sau ai còn trống?", "tháng 12 Quang ở dự án nào?".
- **Quyền:** dựng `Viewer` bằng `resolveViewer` và đi qua `visibleAccounts` + `shapeForViewer`, đúng như route. Thành viên hỏi về người khác thì công cụ trả "bạn chỉ xem được booking của mình", không phải danh sách rỗng (rỗng làm model bịa).
- Dự án bị ẩn trả về là `"dự án khác"`, không mã.
- Thêm một dòng vào system prompt: booking là giờ đã hứa cho dự án, khác với việc đã giao; hỏi "ai rảnh" thì gọi `bookings` trước `team_workload`.

**Chưa làm công cụ ghi** (`create_booking`…). Lý do giống `create_plan`: một câu hiểu sai giữ nhầm cả tháng của một người, và hiện chưa có luồng duyệt. Chờ câu 3 ở mục 9.

**Test.** `server/test/tools.test.ts`: ba vai, dự án ẩn không lọt mã vào kết quả.

### 2.3 Lập kế hoạch sprint trừ giờ đã book ở dự án khác

`agile/sprintMetrics.ts` `availability(...)` tính giờ có của từng người trong sprint = ngày làm việc trừ nghỉ phép × công suất. Dùng bởi `planSprint` (`ai/sprintAi.ts`) và `GET /board/sprints/:id/capacity` (`CapacityTable`).

- Thêm tham số `heldElsewhere` (cùng dữ liệu với 2.1) và trừ khỏi `capacityHours`; trả thêm `heldHours` để bảng hiện "bị giữ 16h".
- `CapacityTable`: một cột "Dự án khác", chỉ vẽ khi có ai bị giữ (không cột toàn số 0).
- Cảnh báo của `planSprint` thêm: "X bị giữ hết ở dự án khác trong sprint".

Làm sau 2.1 vì dùng lại `bookingLoad.ts`.

### 2.4 Nhịp dự án: việc đã giao vượt booking

`client/src/projectPulse.ts` `pulseDecisions` sinh tối đa ba dòng "Cần bạn quyết". Thêm một loại dòng: người có việc đã giao trong hai tuần tới vượt booking trên dự án này quá 8 giờ. Con số lấy từ cùng phép tính với `.bk-gap` trong `BookingView` (`gapOf`): tách `gapOf` ra `bookingModel.ts` (thuần, có test) để hai nơi dùng chung, đừng tính lại.

- Hành động của dòng: "Book thêm" (mở Resource › Booking, mở sẵn người đó: `focusPerson` đã có cho Mức tải, thêm cho Booking) và "Xem lịch".
- Chỉ sinh khi dự án đã có ít nhất một booking: dự án chưa dùng booking thì mọi người đều "vượt", dòng đó vô nghĩa.
- `projectPulse.test.ts` và `e2e/pulse-today.e2e.mjs`.

### 2.5 Duyệt (chỉ khi quản lý trả lời "có" ở câu 3)

Không làm khi chưa có câu trả lời. Phác để ước lượng:

- **Duyệt booking:** thêm trạng thái `requested` (PM tạo) → quản lý nguồn lực chuyển sang `confirmed` hoặc xoá. Migration sửa CHECK của `status`; `booking.ts` thêm luật "PM không tự đặt `confirmed` khi có quản lý nguồn lực được cấu hình"; màn Booking thêm bộ lọc "Chờ duyệt n".
- **Duyệt bảng công:** bảng `timesheet_period (cloud_id, account_id, week_start, status, decided_by, decided_at)`. Khoá chỉ ở phía app: worklog trong Jira vẫn sửa được từ Jira, và phải nói rõ điều đó trên màn hình thay vì giả vờ khoá được.

---

## 3. Những điều dễ làm sai

- **Đừng đọc task xuyên dự án để tính tải.** Màn rail Booking chỉ đọc bảng `resource_booking`. Đọc task của mọi dự án tốn quota Jira dùng chung cả app, và phụ thuộc quyền xem của từng người nên hai người thấy hai con số cho cùng một nhân viên.
- **Tên dự án bị ẩn không được lọt ra bất kỳ đâu:** JSON trả về, CSV, kết quả công cụ của trợ lý, log. `e2e/booking.e2e.mjs` kiểm trang; mục mới phải có kiểm tương ứng.
- **Booking trên chính dự án đang xét không cộng vào tải task của dự án đó** (2.1). Đây là chỗ dễ đếm hai lần nhất.
- **Mọi thay đổi chỉ gửi trường đã đổi** (PATCH từng trường), và hiện trước rồi xác nhận sau. `e2e/booking.e2e.mjs` có bước kiểm `{ status: "confirmed" }` và `["to"]`.
- **Route theo site không qua `requireProject`.** Dự án của tab chỉ là gợi ý (`resolveProject` trong `try`), không bao giờ là lỗi.
- **Ghi worklog cho việc của dự án khác** đi qua `issueProjectHeader` trong `api.ts`. Lời gọi `fetch` mới nào ghi theo issue phải dùng nó, không dùng `projectHeaders()` của tab.
- **Bash tool trên máy này hỏng khi một lệnh có heredoc chứa backtick hoặc nhiều heredoc.** Ghi file bằng Write/Edit; script vá thì ghi ra file trong scratchpad rồi chạy.
- **Đừng sửa `client/src` trong lúc bộ e2e đang chạy:** Vite tải lại trang giữa chừng và làm hỏng bước đang chạy.
- Chữ trên màn hình: nhãn ngắn, không câu giải thích, không số 0, không viết hoa cả tiêu đề (`MASTER.md`, "Chữ trên màn hình"). Thuật ngữ: Booking, Dự kiến, Chắc, book, Mức tải.

---

## 4. Kiểm tra sau mỗi mục

```bash
cd server && npm test && npm run typecheck:test && npm run build
cd client && npm test && npm run typecheck:test && npm run lint && npm run build
cd e2e && npm test                      # cần Chrome; đừng chạy gì khác cùng lúc
cd e2e && E2E_ONLY=booking npm test     # chỉ file booking
```

Cập nhật khi xong: `CLAUDE.md` (mục Booking and Clockwork; dòng "Not built" ở cuối mục đó), `client/public/privacy.html` nếu thêm dữ liệu được lưu hay được gửi cho Gemini (2.2 gửi booking vào prompt của trợ lý: trang này hiện **không nói gì** về trợ lý, CLAUDE.md đã ghi đó là quyết định của người giữ trang), mục F của danh sách kiểm tay.

---

## 5. Kết quả kiểm tra cuối phiên trước

Chạy ngày 2026-11-11 (thứ Tư), trên cây làm việc chưa commit.

| Bộ | Kết quả |
|---|---|
| `server`: `npm test`, `typecheck:test`, `build` | 449/449 qua, sạch |
| `client`: `npm test`, `typecheck:test`, `build` | 640/640 qua, sạch. Lint: 0 lỗi; các cảnh báo đều có từ trước, không cái nào ở file mới |
| `e2e`: 39 file | 35 qua, 4 hỏng (bảng dưới) |

Bốn file e2e hỏng **đã hỏng sẵn trên `main` trước phiên này**: đã cất toàn bộ thay đổi (`git stash -u`), chạy lại đúng bốn file trên cây đã commit, kết quả giống hệt. Chúng không thuộc việc Booking, nhưng ai làm tiếp nên biết là bộ e2e hiện không xanh.

| File | Bước hỏng | Ghi chú |
|---|---|---|
| `gantt-drag-jitter.e2e.mjs` | "zoom Tuần: kéo tới 3 ngày", "zoom Ngày: kéo tới 3 ngày" | Chưa tìm nguyên nhân |
| `gantt-tooltip.e2e.mjs` | "zoom Ngày", "zoom Tháng", "zoom Tuần" | Chưa tìm nguyên nhân |
| `stage2.e2e.mjs` | "cột Sprint, Thành phần, Phiên bản chọn được và có dữ liệu" | `locator.check` hết giờ trong menu cột |
| `timesheet.e2e.mjs` | "Esc khi đang gõ trả giá trị cũ và không ghi gì" | Phụ thuộc ngày chạy: bước này gõ vào ô thứ ba của tuần (thứ Tư) và mong ô trống, nhưng dữ liệu giả có sẵn 4h vào **hôm nay**. Chạy đúng thứ Tư thì hỏng. Sửa: chọn một ô không phải hôm nay |

`gantt-scroll.e2e.mjs` hỏng ở hai lần chạy với hai bước khác nhau (lần đầu ba bước khi máy đang chạy các bộ test khác; lần chạy riêng chỉ còn bước đo khung hình "p95 dưới 100ms"). Đây là phép đo thời gian, phụ thuộc tải của máy; chưa chạy nó trên cây đã commit để so.

Các file e2e đã sửa trong phiên này và lý do:

- `assign-hints`, `phase1`, `phase3-overlay`, `resource-layout`, `stage3`, `work-calendar`: lăng kính Resource giờ mở ở Booking, nên mỗi file bấm chọn "Mức tải" một lần sau khi mở lăng kính.
- `tab-cache`, `warm-views`: lưới giờ đọc `/api/clockwork` thay cho `/api/timesheet`.
- `mock-api.mts`: thêm booking và Clockwork, chạy luật thật của `server/src/booking.ts`; `POST /api/__booking/role` đổi vai, `POST /api/__booking/reset` trả dữ liệu booking về ban đầu.
