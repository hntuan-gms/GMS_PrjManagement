# Thiết kế lại Resource thành Booking, và Clockwork xuyên dự án — 2026-11-11

Bản này để một phiên khác đọc rồi làm. Nó gồm: nghiệp vụ, phân quyền, luồng dùng, giao diện, dữ liệu, API và thứ tự làm.

**Xuất phát điểm.** Quản lý nói hai điều:

1. "Phần Resource phải là booking, không phải Clockwork."
2. "Cột đứng bên trái có phạm vi là toàn bộ dự án của một người."

Quản lý chưa nói gì thêm. Mọi thứ còn lại trong bản này là đề xuất, dựa trên cách các công cụ cùng loại làm (Tempo Planner, Float, Resource Guru cho booking; Clockwork, Tempo Timesheets cho chấm công). Các điểm cần quản lý chốt nằm ở [mục 9](#9-câu-hỏi-cho-quản-lý); mỗi câu đã có lựa chọn mặc định, nên việc làm không phải chờ.

**Chưa kiểm ở phiên viết bản này:** chưa chạy app, chưa đọc kỹ `ResourceView.tsx` và các file `Timesheet*.tsx`. Hiện trạng lấy từ `CLAUDE.md` và từ việc đọc `routes/resources.ts`, `timesheet.ts`, `Toolbar.tsx`, migration 001. Phiên làm cần đọc lại các file ở [mục 8](#8-thứ-tự-làm) trước khi sửa.

---

## Trạng thái (2026-11-11, cuối phiên)

Giai đoạn 1, 2 và 3 đã làm xong, theo các lựa chọn mặc định ở [mục 9](#9-câu-hỏi-cho-quản-lý). Giai đoạn 4 chưa làm. Mô tả ngắn cho người làm tiếp nằm trong `CLAUDE.md`, mục "Booking and Clockwork: a person across projects".

Khác với bản thiết kế bên dưới:

- **Trục thời gian của màn Booking là trục tuyến tính riêng** (một bề rộng cho mỗi ngày), không dùng cột flex của bảng Mức tải. Kéo để tạo và đổi booking cần đổi pixel sang ngày, và trục tuyến tính làm việc đó bằng phép chia.
- **Một lịch làm việc cho cả màn** (lịch của dự án đang mở), không phải mỗi booking theo lịch dự án của nó.
- **Route nghỉ phép là `/api/bookings/absences`**, không phải `/api/me/absences`: cùng một route cho "của mình" và "quản lý nhập cho người khác".
- **Không có `canAdminProject` riêng**: `resourceRoles.isProjectAdmin`.
- **Chưa có:** "+ Thêm việc" ở Clockwork tìm trên mọi dự án (hiện chọn từ kế hoạch của tab và việc đang mở của mình ở dự án khác); huy hiệu trên lăng kính Resource vẫn đếm theo Mức tải; kéo một booking sang người khác; phím `N`, J/K trong màn Booking; bộ nhớ đệm 60 giây cho Clockwork "Của tôi" (chỉ "Cả nhóm" có, 30 giây).
- **Chưa kiểm với Jira thật:** đọc nhóm bằng `GET /myself?expand=groups`, `GET /user/bulk`, JQL `worklogAuthor = currentUser()` không kèm dự án, và ghi worklog cho việc của dự án khác với dự án của tab. Đã thêm mục vào danh sách kiểm tay.

---

## 1. Nghiệp vụ

Quản lý nguồn lực có ba lớp số cho mỗi người, mỗi ngày:

| Lớp | Câu hỏi | Nguồn | App hiện có |
|---|---|---|---|
| **Công suất** | Người này có bao nhiêu giờ? | giờ/ngày, trừ nghỉ phép và ngày lễ | Có (`resource_profile`, `resource_absence`, lịch làm việc) |
| **Booking** | Giờ đó đã hứa cho dự án nào, khi nào? | PM hoặc quản lý nguồn lực đặt | **Chưa có** |
| **Thực tế** | Đã làm bao nhiêu giờ, vào việc nào? | worklog Jira | Có (Clockwork), nhưng chỉ trong một dự án |

Hai phép so sánh sinh ra giá trị quản lý:

- **Công suất so với Booking:** ai quá tải, ai còn trống, tháng sau có đủ người cho dự án mới không.
- **Booking so với Thực tế:** dự án hứa 40 giờ của Quang, Quang ghi 25 giờ. Lệch ở đâu, vì sao.

### Booking khác "Mức tải" hiện nay ở đâu

Mức tải hiện nay là hệ quả của việc giao task: có task mới có tải. Booking đi trước task:

- Đặt được khi dự án chưa có task nào ("Quang 50% cho GPM cả tháng 12").
- Đơn vị là người × dự án × khoảng ngày × giờ mỗi ngày. Không gắn vào issue.
- Cộng được xuyên dự án. Mức tải thì không, vì mỗi dự án chỉ đọc task của chính nó.
- Là dữ liệu của app (Postgres). Jira không có khái niệm này.

Mức tải không bị bỏ. Trong một dự án nó trả lời câu hỏi kế tiếp: "Đã book Quang 20 giờ tuần này, task giao cho Quang tốn 32 giờ" nghĩa là giao quá phần đã book.

### Câu thứ hai của quản lý

"Cột đứng bên trái" có hai cách hiểu, và thiết kế này đúng với cả hai:

- **Rail (thanh dọc bên trái của app):** những gì nằm trên rail có phạm vi là mọi dự án của một người. Lăng kính trên header có phạm vi là một dự án. Đây là luật chung từ nay.
- **Cột tên trong bảng:** mỗi dòng là một người, mở ra là mọi dự án người đó đang được book.

Hiện trạng trái luật này: Clockwork nằm trên rail nhưng chỉ đọc worklog của dự án đang mở (`timesheet.ts:106`, JQL có `project = "KEY"`).

---

## 2. Vai và quyền

Ba vai. Hai vai đầu đã có trong code, vai thứ ba là mới.

| Vai | Xác định bằng | Đã có? |
|---|---|---|
| **Thành viên** | Đăng nhập được và xem được dự án | Có |
| **Quản lý dự án (PM)** | Đọc được role của dự án trên Jira (`listMembers().rolesReadable`), tức có Administer Projects | Có, đang dùng cho tab Resource, SLA, Lịch làm việc |
| **Quản lý nguồn lực** | Thuộc nhóm Jira có tên trong biến `RESOURCE_MANAGER_GROUP` | **Mới** |

Vai quản lý nguồn lực giao cho Jira quyết định, giống cách app đã làm với đăng nhập (`ALLOWED_SITE_HOSTS`): thêm bớt người ở Jira, app không giữ danh sách. Đọc nhóm của chính mình bằng `GET /rest/api/3/myself?expand=groups`. **Chưa kiểm** là token 3LO với scope hiện tại trả về `groups`. Nếu không, dùng biến `RESOURCE_MANAGER_ACCOUNT_IDS` (danh sách accountId, cách nhau bằng `;` vì deploy action tách `env_vars` theo dấu phẩy). Cả hai là repo variable trong `.github/workflows/deploy.yml`.

### Bảng quyền

| Việc | Thành viên | PM | QL nguồn lực |
|---|---|---|---|
| Xem booking của chính mình, mọi dự án | Có | Có | Có |
| Xem booking của người khác | Không | Người trong dự án mình quản lý | Tất cả |
| Thấy tên dự án khác trong dòng của một người | — | Chỉ dự án mình xem được trên Jira; còn lại gộp thành "Dự án khác" kèm số giờ | Tất cả |
| Tạo, sửa, xoá booking | Không | Trong dự án mình quản lý | Mọi dự án |
| Sửa công suất, vai trò, kỹ năng của một người | Không | Có (như hiện nay) | Có |
| Nhập nghỉ phép | Của mình | Của người trong dự án | Của mọi người |
| Ghi giờ | Của mình | Của mình | Của mình |
| Xem giờ đã ghi của người khác | Không | Người trong dự án mình quản lý, trong các dự án đó | Tất cả những gì Jira cho đọc |

Ba điểm cần giữ:

- **"Dự án khác" là cố ý.** PM cần biết Quang đã bị giữ 4 giờ mỗi ngày ở nơi khác để không book chồng lên, nhưng không cần biết đó là dự án gì nếu Jira không cho họ xem dự án ấy. Tổng giờ lấy từ bảng của app, tên dự án chỉ hiện khi dự án có trong danh sách dự án người xem duyệt được (`projectScope.findAccessibleProject`).
- **Ghi giờ luôn là của người đăng nhập.** Jira ghi tác giả worklog theo token và không cho app 3LO ghi thay. Không thiết kế "PM ghi giờ hộ".
- **Thành viên thường nhập nghỉ phép của mình là quyền mới.** Hiện `routes/resources.ts` chặn cả router cho người không phải PM. Cần một route riêng cho nghỉ phép của chính mình.

---

## 3. Luồng dùng

### PM lên kế hoạch người cho dự án

1. Mở dự án, lăng kính **Resource**, chế độ **Booking** (mặc định).
2. Thấy từng người của dự án: tổng đã book trên mọi dự án theo tuần, và dòng của dự án này.
3. Kéo trên dòng của một người, từ ngày này đến ngày kia. Một ô nhỏ hiện ra: giờ/ngày (gõ `4h` hoặc `50%`), Dự kiến hay Chắc, ghi chú. Enter là xong.
4. Nếu tổng vượt công suất, cột tuần đó đỏ. Không chặn. Toast "Quang vượt 2h/ngày, 17–21/11" có nút Hoàn tác.
5. Thêm người chưa có trong dự án: "+ Người" mở `PersonPicker`.

### Quản lý nguồn lực xem toàn cảnh

1. Bấm **Booking** trên rail. Thấy mọi người, mọi dự án.
2. Lọc nhanh: Quá tải n · Còn trống n. Tìm theo tên, vai trò, kỹ năng.
3. Mở một người: mỗi dự án một dòng, nghỉ phép một dòng. Kéo mép thanh để rút ngắn, kéo thân để dời, sang dòng người khác để chuyển người.
4. Đổi Dự kiến thành Chắc khi đã chốt với các PM.

### Thành viên

1. Bấm **Booking** trên rail: chỉ thấy dòng của mình, đã mở sẵn, chỉ đọc. Biết tuần này và các tuần tới mình thuộc dự án nào, bao nhiêu giờ.
2. Bấm **Clockwork**: lưới tuần, việc xếp theo dự án, gõ giờ vào ô. Cuối mỗi dự án có "đã ghi 14h / book 20h".
3. Nhập nghỉ phép của mình từ menu avatar hoặc từ dòng "Nghỉ" trong Booking.

### PM đối chiếu cuối tuần

1. **Clockwork**, chế độ **Nhóm**: mỗi người một dòng, cột cuối là Book · Đã ghi · Lệch.
2. Lọc "Còn thiếu" (chưa ghi đủ ngày) hoặc "Lệch booking" (ghi khác book quá 20%).
3. Mở một người: theo dự án, rồi theo việc. Xuất CSV.

---

## 4. Giao diện

Đọc `design-system/gms-prjmanagement/MASTER.md` trước khi làm. Các luật áp dụng ở đây: nhãn ngắn, không câu giải thích, không số 0, không chữ in hoa ở tiêu đề, mực là màu chính, đỏ chỉ cho quá tải.

### Rail và lăng kính

```
Rail:      Dự án · Hôm nay · Booking · Clockwork · … · Trợ lý · avatar
Lăng kính: List · Board · Resource · Report        (chỉ khi đang ở Dự án)
```

- **Booking** (rail, `G B`, `?view=booking`): mọi dự án. Không vẽ trên điện thoại, như Clockwork.
- **Resource** (lăng kính, `3`): ba chế độ **Booking · Mức tải · Kỹ năng**. Booking ở đây là cùng một component với rail, lọc sẵn về dự án đang mở. Mức tải và Kỹ năng giữ nguyên.
- **Clockwork** (rail, `G T`): mọi dự án của người đăng nhập.

Một component, hai phạm vi. Không viết hai màn.

### Màn Booking

```
[ tìm người ]  Tất cả 12 · Quá tải 2 · Còn trống 5        Tuần | Tháng   Hôm nay   ⋯
──────────────────────────────────────────────────────────────────────────────────
Người                │ 10/11 │ 17/11 │ 24/11 │ 01/12 │ 08/12 │
▾ Nguyễn Anh    8h   │ ▇▇▇▇  │ █████ │ ▇▇    │ ▇▇    │       │   ← tổng, vẽ kiểu skyline
    GPM              │ ├──── 4h ──────────┤                 │
    AI               │ ├─ 4h ─┤├── 6h ──┤                   │
    Dự án khác       │               ├──── 2h ─────┤        │   ← chỉ PM thấy dòng gộp này
    Nghỉ             │         ░░ 20–21/11                   │
▸ Trần Bình     8h   │ ▇▇    │ ▇▇    │       │       │       │
```

- **Dòng tổng** dùng lại skyline của Mức tải (`.rv-sky`, bốn dải của `ratioBand`): cao là tỉ lệ book trên công suất, đỏ có gạch chéo khi vượt. Ô trống là không vẽ gì. Rê chuột: "32h / 40h".
- **Dòng dự án** là thanh ngang. Chắc: nền mực. Dự kiến: viền đứt, nền trống. Chữ trên thanh là giờ/ngày.
- **Tạo:** kéo trên vùng trống của một dòng dự án, hoặc trên dòng tổng (khi đó ô nhỏ có thêm chọn dự án). Ở lăng kính Resource dự án đã được chọn sẵn.
- **Sửa:** kéo mép đổi ngày, kéo thân dời, bấm vào thanh mở lại ô nhỏ. `Delete` xoá, toast có Hoàn tác. Mỗi thay đổi lưu ngay, hiện trước rồi xác nhận sau, như mọi chỗ khác trong app.
- **Ô nhỏ** (popover, không phải hộp thoại): giờ/ngày · Dự kiến/Chắc · ghi chú. Ba trường, không nút Lưu. Enter hoặc bấm ra ngoài là lưu, Esc bỏ.
- **Trục thời gian** dùng `timeZoom.ts` và cách cuộn của Mức tải: cuộn ngang theo thời gian, cột tên dính trái, header dính trên, Ctrl+lăn để zoom, mở ra ở hôm nay. Mặc định cột tuần.
- **Bộ lọc người** dùng lại `.rv-scope`. "Quá tải" và "Còn trống" tính trong hai tuần tới, cùng cửa sổ với huy hiệu của lăng kính (`resourceColumns.overloadWindow`).
- **⋯**: Sắp xếp · Chú giải · Xuất CSV · "Book từ việc đã giao" (xem [mục 7](#7-ngày-đầu-chưa-có-booking-nào)).
- **Bàn phím:** J/K đi dòng, Enter mở/đóng người, `N` tạo booking cho người đang chọn, Delete xoá thanh đang chọn. Thêm vào `shortcuts.ts`, và `shortcutsWired.test.ts` sẽ đòi có trình xử lý.

Trong lăng kính Resource (một dự án), dưới mỗi người có thêm một dòng mảnh khi có lệch: "Việc đã giao 32h · book 20h" cho tuần đang lệch. Đây là chỗ Mức tải và Booking gặp nhau; không vẽ khi khớp.

### Màn Clockwork

```
Của tôi | Nhóm          ‹  10–16/11  ›   Hôm nay                 Đã ghi 31h · book 40h
──────────────────────────────────────────────────────────────────────────────────
                           T2   T3   T4   T5   T6  │ Đã ghi │ Book
GPM                                                │  18h   │ 20h
   GPM-104 Viết API         4    4    2            │
   GPM-110 Sửa lỗi nhập          2         4    2  │
AI                                                 │  13h   │ 20h
   AI-33 Kịch bản kiểm thử  4    2    2    1    4  │
+ Thêm việc
──────────────────────────────────────────────────────────────────────────────────
                            8    8    4    5    6  │  31h   │ 40h
```

- **Của tôi:** giữ nguyên toàn bộ cách gõ hiện nay (`TimesheetMine`, `planCell`, `parseHours`, chuỗi ghi theo ô, hoàn tác). Thay đổi: các dòng gom theo dự án, dòng đầu nhóm là tên dự án với hai số Đã ghi và Book; "+ Thêm việc" tìm trên mọi dự án; việc gợi ý lấy từ các dự án đang book mình tuần này.
- **Nhóm:** PM và quản lý nguồn lực mới có. Người × ngày như `TimesheetTeam`, thêm ba cột cuối Book · Đã ghi · Lệch, và mở một người ra là theo dự án rồi theo việc. Lọc: Tất cả · Còn thiếu · Vượt công suất · Lệch booking.
- Cột Book không vẽ khi tuần đó người ấy không có booking nào. Không vẽ "0h".
- Chân ngày so với công suất như hiện nay (`dayState`).

---

## 5. Dữ liệu

Migration mới `server/migrations/018_resource_booking.sql` (017 là file mới nhất lúc viết; kiểm lại trước khi đặt số).

```sql
CREATE TABLE IF NOT EXISTS resource_booking (
  id            bigserial     PRIMARY KEY,
  cloud_id      text          NOT NULL,
  account_id    text          NOT NULL,
  project_key   text          NOT NULL,
  from_date     date          NOT NULL,
  to_date       date          NOT NULL,
  hours_per_day numeric(4, 2) NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 16),
  status        text          NOT NULL DEFAULT 'tentative' CHECK (status IN ('tentative', 'confirmed')),
  note          text,
  created_by    text          NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT resource_booking_range CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS resource_booking_person_idx  ON resource_booking (cloud_id, account_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS resource_booking_project_idx ON resource_booking (cloud_id, project_key, from_date, to_date);
```

Các quyết định:

- **Lưu giờ/ngày, không lưu phần trăm.** Gõ `50%` được đổi sang giờ theo công suất của người đó lúc nhập. Lưu phần trăm thì khi công suất đổi, mọi booking cũ đổi nghĩa.
- **Khoá theo `cloud_id`** như mọi bảng khác.
- **Ngày không làm việc tính 0.** Một booking trải giờ trên các ngày làm việc của lịch dự án nó thuộc về (`workCalendar.ts`). Nghỉ phép của người đó cũng tính 0. Hệ quả đã biết: ngày lễ nhập ở dự án A không làm trống booking của dự án B. Chấp nhận ở bản này; danh sách ngày lễ chung cả site là việc riêng.
- **Hai booking cùng người, cùng dự án, trùng ngày thì cộng lại.** Không chặn. Giống luật "không ai bị loại vì bận" đang dùng ở gợi ý giao việc.
- **Tên người** không lưu trong booking. Lấy từ `project_member_cache` và `resource_profile.display_name`; ai thiếu thì hỏi Jira theo accountId một lần rồi nhớ.
- **Không ghi gì vào Jira.**

Luật tính (thuần, có test, ở `client/src/bookingModel.ts`): từ danh sách booking, công suất, nghỉ phép, lịch làm việc, cho ra mỗi người mỗi ngày: giờ book theo dự án, tổng, công suất, dải. Gom tuần và tháng dùng lại `aggregateWeeks/Months`. Server chỉ kiểm dữ liệu đầu vào, không tính tải, nên không cần bản soi ở server. Riêng công cụ của trợ lý (mục 8, giai đoạn 4) nếu cần số thì viết bản soi nhỏ và ghi "đổi cả hai".

`client/public/privacy.html` §1 và §3 phải thêm: app lưu ai được book vào dự án nào, bao nhiêu giờ, do ai đặt; và người quản lý thấy tổng giờ của một người ở dự án họ không xem được, không kèm tên dự án.

---

## 6. API

Route theo site, không qua `requireProject`, vì phạm vi là mọi dự án. `requireAuth` vẫn che vì được gắn bằng `apiRouter.use`.

| Route | Ai | Việc |
|---|---|---|
| `GET /api/bookings?from&to[&project=KEY]` | mọi người | Trả booking mà người gọi được thấy theo [bảng quyền](#bảng-quyền), kèm `role` (`member`/`pm`/`manager`), danh sách người, công suất, nghỉ phép. Booking của dự án người gọi không xem được trả về với `projectKey: null` |
| `POST /api/bookings` | PM của dự án đó, QL nguồn lực | Tạo |
| `PATCH /api/bookings/:id` | như trên, theo dự án của booking | Sửa ngày, giờ, trạng thái, ghi chú, người |
| `DELETE /api/bookings/:id` | như trên | Xoá. Không phải của mình quản thì 404, không phải 403 (như `saved_filter`) |
| `PUT /api/me/absences`, `DELETE /api/me/absences/:id` | mọi người | Nghỉ phép của chính mình |
| `GET /api/clockwork?from&to&tzOffsetMinutes` | mọi người | Worklog của người gọi trên mọi dự án |
| `GET /api/clockwork/team?from&to&tzOffsetMinutes[&project=KEY]` | PM, QL nguồn lực | Worklog của nhóm |

Chi tiết cần đúng:

- **Kiểm quyền PM cho một dự án bất kỳ**, không chỉ dự án của phiên: `TaskService` hiện được dựng theo dự án của phiên. Cần một hàm `canAdminProject(client, projectKey)` gọi `GET /project/{key}/role`, nhớ 5 phút theo (site, tài khoản, dự án). Đây là cùng phép thử với `rolesReadable`.
- **Vai quản lý nguồn lực** giải một lần mỗi phiên, nhớ 10 phút (`server/src/resourceRoles.ts`, thuần phần quyết định để test được).
- **Clockwork của tôi:** JQL `worklogAuthor = currentUser() AND worklogDate >= … AND worklogDate <= …`, nới mỗi đầu một ngày rồi cắt theo `started` và `tzOffsetMinutes` như `timesheet.ts` đang làm. Một lần tìm, cộng đọc lại từng issue có hơn 20 worklog. Tách phần đọc và cắt worklog trong `TimesheetService` ra để hai phạm vi dùng chung, đừng chép.
- **Clockwork nhóm:** `project in (…các dự án người gọi là PM…)`, hoặc mọi dự án duyệt được với quản lý nguồn lực; có `project=KEY` thì chỉ dự án đó. Token của người gọi quyết định đọc được gì.
- **Quota Jira là chung cả app.** Đọc nhóm trên nhiều dự án là đọc nặng: giới hạn khoảng thời gian tối đa 5 tuần, nhớ câu trả lời trong bộ nhớ 60 giây theo (site, tài khoản, khoảng), và không tải sẵn chế độ Nhóm (`warmViews.ts` chỉ tải sẵn "Của tôi").
- Mọi `fetch` mới phía client thêm `projectHeaders()` như luật trong `CLAUDE.md`, dù các route này không cần nó.
- Ghi, sửa, xoá worklog dùng lại route hiện có (`POST /api/timesheet/worklogs`…). Chúng qua `requireProject`, nên client gửi `X-Project-Key` là dự án của issue đang ghi, không phải dự án của tab. Kiểm `projectHeaders()` cho phép ghi đè theo từng lời gọi; nếu không thì thêm tham số.

---

## 7. Ngày đầu, chưa có booking nào

Màn Booking trống là đúng nhưng vô dụng. Hai việc để không trống:

- **"Book từ việc đã giao"** (menu ⋯ trong lăng kính Resource, PM mới thấy): lấy Mức tải hiện có của dự án, gom mỗi người thành các đoạn liền nhau theo tuần, làm tròn giờ/ngày lên 0.5, tạo thành booking **Dự kiến**. Hiện danh sách trước ("12 booking cho 5 người"), bấm Tạo mới ghi. Chạy lại không nhân đôi: chỉ đề xuất cho những tuần người đó chưa có booking ở dự án này.
- **Dòng lệch** trong lăng kính Resource ("Việc đã giao 32h · chưa book") chỉ đúng chỗ thiếu.

Màn rail Booking chỉ đọc bảng booking. Nó không đọc task xuyên dự án: việc đó cần đọc Jira của mọi dự án, tốn quota, và phụ thuộc quyền xem của từng người nên hai người sẽ thấy hai con số khác nhau cho cùng một nhân viên.

---

## 8. Thứ tự làm

Mỗi giai đoạn tự đứng được và giao được riêng.

### Giai đoạn 1: dữ liệu, quyền, API booking

- `server/migrations/018_resource_booking.sql`
- `server/src/bookingStore.ts` (SQL, theo lô như `store`), `server/src/booking.ts` (kiểm đầu vào, thuần), `server/src/resourceRoles.ts`, `server/src/routes/bookings.ts`; gắn vào `routes/api.ts`
- Route nghỉ phép của chính mình
- Test: `server/test/booking.test.ts` (kiểm đầu vào, luật ai thấy gì, che tên dự án), `resourceRoles.test.ts`
- Thêm vào `e2e/mock-api.mts`: booking trong bộ nhớ, ba vai đổi được

### Giai đoạn 2: màn Booking

- `client/src/bookingModel.ts` + `client/test/bookingModel.test.ts`
- `client/src/components/BookingView.tsx` (prop `scope: "site" | "project"`), `BookingRow`, `BookingPopover`; CSS `design/booking.css`, không màu thô (`noRawColors.test.ts`)
- Đọc trước khi viết: `ResourceView.tsx`, `ResourcePersonBlock.tsx`, `resourceColumns.ts`, `timeZoom.ts`, `resourceAllocation.ts`. Dùng lại cột, zoom, skyline; đừng viết trục thời gian thứ ba
- `lenses.ts`: view `booking`; `Toolbar.tsx`: nút rail giữa Hôm nay và Clockwork; `ResourceModes.tsx`: thêm Booking làm chế độ đầu; `shortcuts.ts`: `G B`
- Huy hiệu trên lăng kính Resource: đếm người vượt công suất theo **booking** trong hai tuần tới; không có booking nào thì giữ cách đếm theo Mức tải
- "Book từ việc đã giao"
- e2e: `e2e/booking.e2e.mjs` (tạo bằng kéo, sửa, xoá + hoàn tác, vai thành viên chỉ thấy mình, PM thấy "Dự án khác", một dòng ở 1280px), cập nhật `resource-layout.e2e.mjs` và `header-toolbar.e2e.mjs`

### Giai đoạn 3: Clockwork xuyên dự án

- Tách phần đọc worklog khỏi `TimesheetService`; `server/src/routes/clockwork.ts`
- `timesheetModel.ts`: gom dòng theo dự án, cột Book, bộ lọc "Lệch booking"; cập nhật `timesheetModel.test.ts`
- `TimesheetMine`, `TimesheetTeam`, `useTimesheet`: nguồn dữ liệu mới, ghi theo dự án của issue
- Chế độ Nhóm ẩn với thành viên
- e2e: cập nhật `timesheet.e2e.mjs`; thêm ca hai dự án
- Phần ghi vào Jira thật vẫn kiểm tay: thêm mục vào `docs/test-reports/2026-10-15-jira-that-checklist.md`

### Giai đoạn 4: nối vào phần còn lại (làm sau, từng mục độc lập)

- Trợ lý: công cụ đọc `bookings` ("tuần sau ai còn trống?"), và `suggest_assignees`/`rankCandidates` trừ giờ đã book ở dự án khác. `assignHints.ts` là bản soi của `rankCandidates`: đổi cả hai
- `planSprint`: công suất của người = công suất trừ booking ở dự án khác
- Nhịp dự án: dòng "Cần bạn quyết" khi việc đã giao vượt booking
- Duyệt bảng công theo tuần (xem câu 3 ở mục 9)

### Sau mỗi giai đoạn

`cd server && npm test && npm run typecheck:test`, `cd client && npm test && npm run typecheck:test && npm run lint && npm run build`, `cd e2e && npm test`. Cập nhật `CLAUDE.md` (mục Resource view, Timesheet, đoạn về rail), `MASTER.md` (thuật ngữ: Booking, Dự kiến, Chắc), `privacy.html`.

---

## 9. Câu hỏi cho quản lý

Mỗi câu có mặc định. Trả lời khác thì phần bị ảnh hưởng ghi ở cột cuối.

| # | Câu hỏi | Mặc định trong bản này | Nếu khác |
|---|---|---|---|
| 1 | Book theo dự án và khoảng ngày, hay book vào từng task? | Theo dự án và khoảng ngày | Book theo task thì bỏ bảng mới, làm lại Mức tải xuyên dự án: khác hẳn, phải viết lại mục 5–7 |
| 2 | Ai được book: PM tự book người vào dự án mình, hay chỉ quản lý nguồn lực? | PM book được trong dự án mình, quản lý nguồn lực book mọi nơi | Chỉ quản lý nguồn lực: bỏ quyền ghi của PM ở mục 6, PM chỉ đọc |
| 3 | Có cần duyệt không: duyệt booking, duyệt bảng công cuối tuần? | Không duyệt. Booking có Dự kiến/Chắc, ai có quyền ghi thì đổi được | Duyệt booking: thêm trạng thái `requested` và hàng chờ cho quản lý nguồn lực. Duyệt bảng công: bảng `timesheet_period`, khoá phía app thôi vì worklog ở Jira vẫn sửa được từ Jira |
| 4 | Thành viên có được thấy booking của đồng đội không? | Không, chỉ của mình | Cho thấy: nới luật đọc ở `GET /api/bookings`, chú ý nghỉ phép của người khác cũng lộ theo |
| 5 | Đơn vị quen dùng: giờ/ngày hay phần trăm? | Lưu giờ/ngày, gõ được cả hai, thanh hiện giờ | Chỉ đổi cách hiện |
| 6 | Tên trên rail và lăng kính: "Booking" và "Resource", hay tên khác? | Rail "Booking", lăng kính "Resource" | Chỉ đổi nhãn |
| 7 | Nhóm Jira nào là quản lý nguồn lực? | Biến `RESOURCE_MANAGER_GROUP`, chưa có giá trị; để trống thì không ai có vai này và PM vẫn làm việc được | — |

---

## 10. Không làm trong bản này

- Chi phí và đơn giá (`resource_profile.cost_per_day` đã có cột, chưa dùng).
- Booking cho vai trò chưa có người ("cần 1 tester tháng 12").
- Ghi giờ hộ người khác: Jira không cho.
- Danh sách ngày lễ chung cả site.
- Thông báo khi bị book hoặc bị đổi booking.
- Gantt tính theo ngày làm việc.
