# Đại phẫu UX — 2026-11-07

> **Mục đích:** làm hết trong **một lượt** (đêm 07/11). Tài liệu viết để giao việc: mỗi mục có bằng chứng, thay đổi cụ thể, file cần sửa, e2e bị ảnh hưởng và cách kiểm tra là xong.
>
> **Nối tiếp** [2026-11-06-tai-thiet-giao-dien.md](2026-11-06-tai-thiet-giao-dien.md) (nhận diện "Giấy & Son", khung rail + lăng kính, `Ctrl K`, Hôm nay, khung chi tiết). Bản này **không** đổi nhận diện. Nó sửa **cấu trúc và luồng**: những chỗ bản 06/11 hứa mà chưa làm tới, những lối vào trùng nhau, và những luồng hằng ngày còn tốn 4–6 bước.
>
> **Luật giao diện vẫn là** [design-system/gms-prjmanagement/MASTER.md](../../design-system/gms-prjmanagement/MASTER.md) (đọc trước khi sửa bất kỳ màn nào), và quy tắc chữ "ít, ngắn, không giải thích".

---

## Mục lục

0. [Cách làm đêm nay](#0-cách-làm-đêm-nay)
1. [Chẩn đoán: năm gốc rễ](#1-chẩn-đoán-năm-gốc-rễ)
2. [Kiến trúc thông tin mới](#2-kiến-trúc-thông-tin-mới)
3. [Đợt 0: thành phần dùng chung (làm trước)](#3-đợt-0-thành-phần-dùng-chung)
4. [Đợt A: lỗi và nhất quán](#4-đợt-a-lỗi-và-nhất-quán)
5. [Đợt B: khung và điều hướng](#5-đợt-b-khung-và-điều-hướng)
6. [Đợt C: Kế hoạch](#6-đợt-c-kế-hoạch)
7. [Đợt D: khung chi tiết việc](#7-đợt-d-khung-chi-tiết-việc)
8. [Đợt E: một bộ lọc cho mọi lăng kính](#8-đợt-e-một-bộ-lọc-cho-mọi-lăng-kính)
9. [Đợt F: Nhân lực và Giờ làm](#9-đợt-f-nhân-lực-và-giờ-làm)
10. [Đợt G: Bảng và Backlog](#10-đợt-g-bảng-và-backlog)
11. [Đợt H: Hôm nay, Nhịp dự án, trợ lý, tạo việc](#11-đợt-h-hôm-nay-nhịp-dự-án-trợ-lý-tạo-việc)
12. [Bản đồ e2e: hợp đồng nào phải sửa](#12-bản-đồ-e2e)
13. [Kiểm tra cuối và tài liệu phải cập nhật](#13-kiểm-tra-cuối-và-tài-liệu)
14. [Không làm đêm nay](#14-không-làm-đêm-nay)
15. [Phụ lục: bằng chứng](#15-phụ-lục-bằng-chứng)

---

## 0. Cách làm đêm nay

### 0.1. Thứ tự

```
Đợt 0 (thành phần dùng chung)  ──►  A  ──►  B ─┬─► C + D (Kế hoạch, chi tiết)
                                               ├─► E (lọc chung)       ← sau B, trước F/G
                                               ├─► F (Nhân lực, Giờ làm)
                                               ├─► G (Bảng, Backlog)
                                               └─► H (Hôm nay, Nhịp, trợ lý, tạo)
                                  ──►  §12 sửa e2e  ──►  §13 kiểm tra cuối
```

- **Đợt 0 và A làm tuần tự, một người.** Chúng tạo ra những thứ mọi đợt sau dùng (`Avatar`, `TaskPicker`, `PersonPicker`, `TimeInput`, `dateLabels`, lớp phím).
- **B đụng `ProjectWorkspace.tsx` và `Toolbar.tsx`**, hai file mà gần như mọi đợt khác cũng chạm. Làm B xong, commit, rồi mới tách luồng.
- **C–H có thể chạy song song** nếu chia theo file như bảng dưới. Mỗi luồng **không sửa file của luồng khác**. Cần đổi `ProjectWorkspace.tsx` thì ghi vào cuối mục của mình ở dạng "cần ở ProjectWorkspace: …", để người ghép làm.

| Luồng | Đợt | Sở hữu file |
|---|---|---|
| L1 | C, D | `GanttView.tsx`, `ganttMapping.ts`, `ganttWindow.ts`, `TaskEditModal.tsx`, `TaskLinks.tsx`, `TaskAttachmentList.tsx`, `design/plan.css`, `design/peek.css` |
| L2 | E, G | `FilterBar.tsx`, `taskFilter.ts`, `BoardView.tsx`, `KanbanBoard.tsx`, `BacklogView.tsx`, `SprintHeader.tsx`, `boardModel.ts` |
| L3 | F | `ResourceView.tsx`, `ResourcePersonBlock.tsx`, `ResourceUnassigned.tsx`, `ResourceProfileDrawer.tsx`, `TimesheetView.tsx`, `resourceColumns.ts` |
| L4 | H | `TodayView.tsx`, `today.ts`, `ProgressReportView.tsx`, `AiBrief.tsx`, `projectPulse.ts`, `ChatDock.tsx`, `CreateTaskModal.tsx`, `CommandBar.tsx`, `design/today.css` |
| Người ghép | B + phần chung | `ProjectWorkspace.tsx`, `Toolbar.tsx`, `App.tsx`, `ProjectPicker.tsx`, `shortcuts.ts`, `design/shell.css`, `App.css` |

### 0.2. Quy tắc cho mọi mục

1. Đọc `MASTER.md` trước. Không mã màu ngoài `tokens.css` (`noRawColors.test.ts` sẽ hỏng).
2. Chuỗi mới bằng tiếng Việt. Dùng **"việc"**, không dùng "task" trong chuỗi hiển thị (xem A7).
3. Logic thuần (không React) để trong module `.ts` riêng và có test trong `client/test/`, đúng cách repo đang làm (`today.ts`, `quickAdd.ts`, `resourceColumns.ts`).
4. Mỗi đợt xong: `cd client && npm test && npm run typecheck:test && npm run lint && npm run build`. Sửa e2e liên quan (§12) **trong cùng commit**, đừng để dồn cuối đêm.
5. Mỗi đợt một commit, message dạng `ux(A): …`. Không push.
6. Trước khi bắt đầu, chụp ảnh "trước": khởi động API giả lập và client (§13.1) rồi chạy `node e2e/shots.mjs e2e/shots/truoc`. Cuối đêm chụp `e2e/shots/sau` để so sánh.

### 0.3. Định nghĩa "xong" của cả đêm

- Mọi mục §4–§11 ghi ✅ hoặc ghi rõ lý do bỏ qua, ngay trong file này (cột "Trạng thái" ở §15.2).
- `npm test` (client và server), `npm run build` (cả hai) và `cd e2e && npm test` đều xanh.
- Ảnh trước/sau cho 8 màn, sáng và tối, ở 1280 và 1500.
- Cập nhật `CLAUDE.md` và `MASTER.md` theo §13.3.

---

## 1. Chẩn đoán: năm gốc rễ

Kiểm tra bằng Playwright trên client thật với API giả lập (dự án 9 việc và 400 việc; 1024, 1280, 1440 px; sáng và tối), cộng với đọc code. Ảnh ở `.playwright-mcp/ux-*.png` (§15).

**R1. Một việc, nhiều lối vào. Một chữ, nhiều nghĩa.**
`Ctrl K` có 3 lối (nút Tìm ở rail, ô tìm ở header, nút Trợ lý ở rail đều dẫn về cùng chỗ). Tạo việc có 2 lối. Về Hôm nay có 2 lối (logo, nút). Đổi dự án có 2 lối. Trong khi đó "Hôm nay" vừa là trang chủ vừa là nút cuộn về hôm nay ở 3 màn. `G S` ghi "Cài đặt dự án" nhưng mở hộp SLA. Người dùng phải học thuộc thay vì suy ra được.

**R2. "Lăng kính" vẫn là bốn công cụ riêng.**
Bản 06/11 hứa "chung bộ lọc, chung lựa chọn". Thực tế Bảng có thanh lọc và trạng thái lọc riêng (`BoardFilter`), Nhịp dự án có ô chọn riêng, Nhân lực điều khiển tỉ lệ thời gian khác Kế hoạch. Cùng một người hiện 4 kiểu chữ tắt ở 4 màn ("A", "AN", "N", "NA"), do có 5 hàm `initials` riêng. Tháng viết 3 kiểu. Có 3 cách lưu: "đóng là lưu" (khung chi tiết), "Huỷ / Lưu thay đổi" có hỏi lại (hồ sơ nhân lực), nút lưu thường (SLA).

**R3. Kế hoạch giấu đúng thứ cần lập kế hoạch.**
Việc chưa có ngày không có dòng nào trong WBS. Khung chi tiết che toàn bộ phần thời gian ở 1440px. Muốn đặt ngày kết thúc phải tự tính thời lượng. Chọn việc cha hay phụ thuộc là `<select>` liệt kê mọi việc trong dự án (dự án AI có 4044 việc).

**R4. Quyết định thiếu thông tin ngay tại chỗ quyết định.**
Ô "Gán…" ở Nhân lực chỉ là danh sách tên, không cho biết ai rảnh trong đúng khoảng ngày của việc. Ở dự án lớn, mọi người đều "quá tải 85 ngày" mà không có đường nào đi tiếp. Tờ ghi giờ là ngõ cụt khi không có việc đang làm: không chọn được việc ngay trong tờ.

**R5. Lớp phủ và phím không có một chủ.**
`Esc` không đóng hộp chọn dự án (`Ctrl P`) và tờ ghi giờ. Khi hộp chọn dự án đang mở, phím vẫn chạy xuống workspace, nên `Ctrl K` + Enter mở biểu mẫu tạo việc nằm chồng bên dưới. Khi tờ ghi giờ đang mở, bấm "Trợ lý" không có phản ứng. `Shift D` không chạy khi vừa kéo xong một thanh và dòng còn đang chọn.

---

## 2. Kiến trúc thông tin mới

### 2.1. Nguyên tắc

- **Rail = của tôi, đi theo người.** **Header = của dự án, đi theo dự án.** Một thứ chỉ có một chỗ.
- **Mỗi hành động có đúng một nút nhìn thấy được**, cộng phím tắt và một dòng trong `Ctrl K`. Không có nút thứ hai.
- **Cùng khái niệm thì cùng điều khiển** ở mọi màn: lọc, tỉ lệ thời gian, người, ngày, lưu.

### 2.2. Rail (56px, icon + nhãn 10px)

```
 ┌────┐
 │ G  │  logo, về Hôm nay (giữ, vì logo về trang chủ là quy ước)
 ├────┤
 │ +  │  Tạo        (C)        ← lối nhìn thấy duy nhất để tạo
 │ ☀  │  Hôm nay    (G H)
 │ ▤  │  Dự án      (về lăng kính cuối của dự án đang mở)
 │    │
 │ …  │
 │ 💬 │  Trợ lý     (nhãn "Trợ lý")
 │ TT │  avatar: Giao diện · Mật độ · Phím tắt (?) · Đăng xuất
 └────┘
```

Bỏ khỏi rail: **Tìm** (ô tìm trên header đã là lối nhìn thấy), **Giờ làm** (vào Nhân lực, 2.4), **Phím tắt** (vào menu avatar; vẫn là phím `?`).

### 2.3. Header (44px), không đổi bố cục

```
[Dự án mẫu DEMO ▾]  Kế hoạch 1 · Bảng 2 · Nhân lực 3 · Nhịp dự án 4     ● Khớp Jira  [⌕ Tìm, tạo, hỏi…  Ctrl K]
```

- Menu tên dự án: **Đổi dự án** `Ctrl P` · **Cài đặt dự án** `G S` · (bỏ hai mục "Cài đặt SLA…" và "Lịch làm việc & ngày lễ…": giờ là mục con của trang cài đặt).
- Huy hiệu đỏ "4" cạnh "Nhân lực" có `title="4 người quá tải trong 2 tuần tới"`, và chỉ tính **2 tuần tới** (hiện đang tính cả dự án, nên ở dự án lớn luôn đỏ và mất nghĩa).

### 2.4. Nhân lực có ba chế độ

`Mức tải · Giờ đã ghi · Kỹ năng` (segmented hiện có, thêm mục giữa). "Giờ đã ghi" là `TimesheetView` hiện tại, đặt vào trong. Như vậy kế hoạch (mức tải), thực tế (giờ đã ghi) và năng lực (kỹ năng) của cùng những con người nằm cùng một chỗ.

- `G T` → Nhân lực / Giờ đã ghi. `?view=timesheet` vẫn chạy (ánh xạ sang `resource` + chế độ `ts`) để link cũ và e2e không gãy.
- **Ghi giờ cá nhân** vẫn ở Hôm nay (tờ "Ghi giờ") và ngay trong ô của chính mình (F6).
- **Quyền: phải đổi cách chặn.** Lăng kính Nhân lực hiện chỉ hiện khi `resourceAccess === "allowed"` (quản trị dự án; `Toolbar.tsx:142`, `ProjectWorkspace.tsx:1125-1127` và `:1486`, người thường bị đưa về Gantt). Bảng giờ thì ai cũng xem được. Quyết định: **lăng kính Nhân lực luôn hiện**. Người không có quyền chỉ thấy một chế độ là "Giờ đã ghi" (segmented ẩn, vì chỉ có một lựa chọn). Chặn chuyển xuống mức chế độ: `ResourceView` nhận `access` và chỉ dựng Mức tải/Kỹ năng khi `allowed`. Server vẫn chặn `/api/resources` như cũ, nên không có gì lộ thêm.

### 2.5. Trang Cài đặt dự án (`?view=settings`, `G S`)

Một trang, menu trái, nội dung phải. Tái sử dụng phần thân của các hộp thoại hiện có qua prop `embedded`. Không viết lại form.

| Mục | Nguồn hiện tại |
|---|---|
| Lịch làm việc | `WorkCalendarModal` |
| SLA | `SlaSettingsModal` |
| Nhập KBKT | phần cài đặt trong `KbktImportModal` (tên loại, trạng thái, map trường) |
| Board | tuỳ chọn thẻ (`cardOptions`) của board đang chọn |

Quyền như cũ: ai cũng đọc được, chỉ quản trị dự án được lưu (`SLA_ADMIN_ONLY`). Không phải quản trị thì hiện một dòng "Chỉ quản trị dự án được sửa", form ở dạng chỉ đọc.

### 2.6. Một mô hình lưu cho cả app

**Panel và tờ bên (side sheet): đóng là lưu.** Cụ thể là khung chi tiết việc, hồ sơ nhân lực, tờ ghi giờ. `Esc`, `×` hay bấm ra ngoài đều lưu rồi mới đóng. Nếu lưu lỗi thì tờ ở lại và hiện lý do. Không còn hộp hỏi "Bỏ thay đổi?".
**Hộp thoại có hậu quả (dialog):** nút "Lưu" rõ ràng, `Esc` = huỷ không hỏi. Cụ thể là cài đặt, xoá, hoàn thành sprint.
**Trang Cài đặt:** mỗi mục có một nút "Lưu" ở chân mục, chỉ bật khi có thay đổi.

---

## 3. Đợt 0: thành phần dùng chung

Làm trước mọi đợt khác. Mỗi thành phần có logic thuần trong `.ts` riêng và có test.

### 0-1. `Avatar` — một cách vẽ người

- File mới `components/Avatar.tsx` + `avatar.ts` (thuần: `initialsOf(name)`, `hueOf(accountId)` nếu cần).
- Quy tắc chữ tắt: **chữ đầu của từ cuối + chữ đầu của từ đầu**, kiểu tên Việt ("Nguyễn Anh" → "AN"; "Tuấn Test" → "TT"; một từ → 1 chữ). Lý do: người Việt gọi nhau bằng tên, tên ở cuối. `boardModel.initials` đang theo đúng kiểu này nên lấy nó làm chuẩn.
- Có `avatarUrl` (Jira trả cho mọi `JiraUser`) thì vẽ ảnh, lỗi tải thì về chữ tắt.
- Thay **cả 5 chỗ**: `boardModel.initials` (giữ export, chuyển sang gọi `avatar.ts`), `GanttView.initialsOf` (dòng ~456), `AiBrief.initials` (~85), `TimesheetView.initials` (~37), `ResourcePersonBlock` (`displayName.slice(0, 1)`, ~107).
- Test: `client/test/avatar.test.ts` (tên 1 từ, 2 từ, 3 từ, có dấu, rỗng, `null` = "?").

### 0-2. `TaskPicker` — chọn một việc bằng tìm kiếm

- File mới `components/TaskPicker.tsx`, dựa trên `CellPicker` (đã có bàn phím, popover). Ô tìm theo mã hoặc tên, không dấu (dùng chung `fold` của `CommandBar`), tối đa 30 kết quả, việc xong xếp cuối, có `exclude` (chính nó, con cháu khi chọn việc cha) và `filter` (ví dụ chỉ Epic/Story khi chọn cha).
- Dùng ở: Việc cha và Phụ thuộc trong khung chi tiết (D3), tờ ghi giờ (F6), ô giờ trong Giờ đã ghi (F5).

### 0-3. `PersonPicker` — chọn người, kèm mức tải trong khoảng của việc

- File mới `components/PersonPicker.tsx` + thuần `assignHints.ts`: `assignHints(task, people, load, calendar)` trả về `{ accountId, conflictDays, freeHours, away }` cho từng người, **chỉ trong khoảng ngày của việc**, tính từ `buildResourceLoad` đã có.
- Thứ tự: ít ngày trùng nhất trước, rồi rảnh nhiều giờ hơn. **Đây là cùng quy tắc với `autoAssign` phía server** (CLAUDE.md, "Auto-assignment"), nên gợi ý trên UI và gợi ý của trợ lý sẽ khớp nhau.
- Mỗi dòng: `Avatar · Tên · rảnh` / `trùng 3 ngày` / `nghỉ 12–14/11` (màu `--risk-text` khi trùng). Không có ngày thì chỉ hiện tên.
- Dùng ở: ô Người trên WBS (thay danh sách trong `CellPicker`), khung chi tiết, "Gán…" ở thẻ việc chưa gán, "Chuyển…" ở dòng việc trong Nhân lực, thanh chọn nhiều ("Gán cho…").
- Test: `client/test/assignHints.test.ts` (việc không ngày, người nghỉ, ngày lễ, hai việc chồng nhau).

### 0-4. `TimeInput` — giờ 24h

- `<input type="time">` hiện theo ngôn ngữ hệ điều hành (ảnh: "08:00 AM", "01:00 PM"). Thay bằng ô chữ `HH:mm` có kiểm tra (`timeInput.ts`: nhận "8", "8h", "8:30", "0830", "20h").
- Dùng ở `SlaSettingsModal` (khung giờ làm việc).

### 0-5. `dateLabels.ts` — một cách viết ngày

| Dùng cho | Định dạng | Ví dụ |
|---|---|---|
| Nhãn tháng đầy đủ | `Tháng M/YYYY` | Tháng 10/2026 |
| Nhãn tháng ngắn | `T M/YY` | T10/26 |
| Nhãn tháng rất ngắn | `T M` | T10 |
| Cột tuần | ngày đầu tuần `DD/MM` | 02/11 |
| Khoảng ngày | `DD/MM – DD/MM/YYYY` | 02/11 – 08/11/2026 |
| Ngày đơn trong câu | `D/M`, khác năm thì `D/M/YYYY` | 16/9/2027 |

- Bỏ "W44" trên trục Gantt (số tuần ISO, chữ tiếng Anh). Thay bằng ngày đầu tuần, khớp với cột tuần của Nhân lực.
- Thay ở: trục Gantt (calendar header, chỗ đang sửa nhãn bằng `MutationObserver` trong `GanttView`), `resourceColumns.monthLabel`, `TimesheetView`, `ProgressReportView` ("Dự kiến xong 16/9/2027" và "Thời hạn 16/09" đang khác nhau).
- Test: `client/test/dateLabels.test.ts`.

### 0-6. Lớp phủ có một chủ: `layers.ts`

Đây là gốc của R5.

- Module thuần `client/src/layers.ts`: một ngăn xếp `push(id, { onEscape })` / `pop(id)`, `top()`, `isOpen()`. Một listener `keydown` duy nhất trên `window` ở pha capture: `Esc` gọi `onEscape` của lớp trên cùng rồi `stopPropagation`.
- `overlayOpen()` mà `ProjectWorkspace` đang dùng để chặn phím tắt sẽ đọc từ `layers.isOpen()`.
- **Mọi lớp phủ phải đăng ký**: `ProjectPicker` (variant `modal`), tờ ghi giờ ở Hôm nay, `ResourceProfileDrawer`, `ResourceUnassigned` (khi mở), `ChatDock` (khi mở), `CommandBar`, `ShortcutSheet`, `Dialog`, khung chi tiết, mọi `modal-overlay`. Hook `useLayer(id, open, onEscape)` cho gọn.
- Khi có lớp mở: `Ctrl K`, `Ctrl P`, `C`, `1–4`, `G x` **không chạy** (trừ khi lớp đó tự xử lý).
- Bấm nút rail khi một tờ đang mở: đóng tờ (có lưu, theo 2.6) **rồi** làm việc của nút. Hiện tại bấm "Trợ lý" khi tờ ghi giờ mở thì không có gì xảy ra.
- Test: `client/test/layers.test.ts` (thứ tự, pop sai id, Esc chỉ đóng lớp trên cùng).

---

## 4. Đợt A: lỗi và nhất quán

| ID | Vấn đề (bằng chứng) | Sửa | File |
|---|---|---|---|
| A1 | `Esc` không đóng hộp chọn dự án. Phím vẫn chạy xuống dưới: gõ `2` thì thành chữ "2" trong ô tìm, `Ctrl K` thì mở ô lệnh phía sau (ux-32, ux-33) | Đăng ký `layers` (0-6). `ProjectPicker` variant `modal` không có xử lý Esc nào | `ProjectPicker.tsx`, `App.tsx` |
| A2 | `Esc` không đóng tờ "Ghi giờ hôm nay"; bấm Trợ lý khi tờ mở không phản ứng (ux-40, ux-41) | `layers` + 2.6 | `TodayView.tsx` (tờ ghi giờ) |
| A3 | `Ctrl K`: gõ "nháp" rồi Enter mở việc "Dựng API đăng **nhập**" thay vì lệnh "Bật bản nháp" (ux-63) | Xếp hạng chung cho việc và lệnh: (1) mã việc khớp đúng; (2) lệnh có nhãn **bắt đầu** bằng truy vấn; (3) khớp **đúng dấu**; (4) khớp bỏ dấu. Việc và lệnh cùng điểm thì lệnh trước. Tách hàm xếp hạng ra `commandRank.ts` có test | `CommandBar.tsx` (dòng 84–101) |
| A4 | `Shift D` không chạy khi vừa kéo thanh xong và dòng còn đang chọn | Tìm điều kiện chặn trong handler phím ở `ProjectWorkspace` (khoảng dòng 1240–1270). Nghi do `blockers` còn giữ trạng thái kéo/tooltip. Viết e2e nhỏ: kéo → `Shift D` → `.draft-bar` hiện | `ProjectWorkspace.tsx`, `GanttView.tsx` |
| A5 | 5 kiểu chữ tắt tên | 0-1 | nhiều |
| A6 | Emoji và ký tự làm icon: 🎯 (`BacklogView` ~347), ✎ (`BacklogView` ~320, `SprintHeader` ~107, `TimesheetView` ~422, `ChatDock` ~509), 📎 (`ChatDock` ~614, 732, 770), ➤ (`ChatDock` ~798), ☰ (`ChatDock` ~456) | Thay bằng `Icons.tsx` (thêm `Pencil`, `Paperclip`, `Send`, `Menu`, `Target` nếu chưa có). Mục tiêu sprint: bỏ icon, chữ `--ink-2` | các file trên |
| A7 | Lẫn "task" / "việc" / "công việc": "Task mới", "Tạo task & đẩy lên Jira", "Thêm task khác", "Chưa có task", "Chọn task...", "Kết quả tạo task", "Thuộc task cha (WBS)", "Tạo task thất bại." | Chuỗi hiển thị dùng **"việc"** (ngắn, khớp "Tạo việc" ở rail). "Sub-task" giữ nguyên (tên loại của Jira). Không đổi tên class, id hay khoá | `CreateTaskModal.tsx`, `TaskEditModal.tsx`, `GanttView.tsx`, `KbktImportModal.tsx`, … (grep `\btask\b` trong chuỗi JSX) |
| A8 | Ô ngày gốc của trình duyệt hiện `mm/dd/yyyy` ở SLA, hồ sơ nhân lực (Nghỉ từ – đến), khoảng ngày Nhân lực, lịch làm việc (ux-07, ux-23) | Đổi sang `DateField`. **e2e đang `fill()` thẳng vào các ô này** (CLAUDE.md, "Native date inputs remain only where e2e fills them directly"), nên sửa e2e cùng lúc (§12). `DateField` nhận "2026-11-15" khi dán, nên đổi `fill('2026-11-15')` thành `fill('15/11/2026')` | `SlaSettingsModal.tsx`, `ResourceProfileDrawer.tsx`, `ResourceView.tsx`, `WorkCalendarModal.tsx` |
| A9 | Giờ hiện AM/PM | 0-4 | `SlaSettingsModal.tsx` |
| A10 | Số đếm bằng 0 vẫn hiện, trái luật MASTER: "Đang làm 0 · Đến hạn tuần này 0" (Hôm nay), "0 Trễ baseline", "0 Chưa bắt đầu" (Nhịp), "Đang quá tải (0)" (Nhân lực) | Ẩn. Riêng pill lọc "Đang quá tải" thì giữ pill, bỏ "(0)" | `TodayView.tsx`, `ProgressReportView.tsx`, `ResourceView.tsx` |
| A11 | Tên "Hôm nay" bị dùng cho hai việc | Nút cuộn đổi thành **"Về hôm nay"** (phím `T` ghi ở `title`) trên Kế hoạch, Nhân lực, Giờ đã ghi | `GanttView.tsx`/`FilterBar.tsx`, `ResourceView.tsx`, `TimesheetView.tsx` |
| A12 | `G S` ghi "Cài đặt dự án" mà mở SLA | Trỏ sang trang Cài đặt (B4). Trước khi B4 xong thì đổi nhãn tạm thành "Cài đặt SLA" | `shortcuts.ts`, `ProjectWorkspace.tsx` |
| A13 | "Mức sử dụng" (thanh KPI) và "hiệu suất" (đầu hồ sơ: "8% hiệu suất") là cùng một số, hai tên | Dùng "mức sử dụng" ở mọi chỗ | `ResourceProfileDrawer.tsx` |
| A14 | Đơn vị lẫn trên thanh việc trong Nhân lực: "4n" và "16h" | Một đơn vị: giờ ("32h", "16h"). Nếu chưa có ước lượng thì giờ = ngày × công suất, có `title` ghi "ước tính" | `ResourcePersonBlock.tsx` |
| A15 | Thư mục `.playwright-mcp/` (ảnh, log) chưa nằm trong `.gitignore` | Thêm `.playwright-mcp/` | `.gitignore` |

**Xong khi:** e2e mới `e2e/layers.e2e.mjs` qua: `Ctrl P` → `Esc` đóng; `Ctrl P` → gõ `2` không đổi lăng kính; tờ ghi giờ → `Esc` đóng; tờ ghi giờ → bấm Trợ lý thì tờ đóng và trợ lý mở; `Ctrl K` "nháp" → dòng đầu là lệnh.

---

## 5. Đợt B: khung và điều hướng

| ID | Thay đổi | File | Ghi chú |
|---|---|---|---|
| B1 | Rail theo 2.2: bỏ nút Tìm, Giờ làm, Phím tắt; thêm nhãn 10px dưới icon; rail rộng 56px | `Toolbar.tsx:146-235` (`RailButton` `:40-71`), `design/shell.css:8-125` | `--rail-w` đã có (`tokens.css:207`, 48px), đổi thành 56px. Nó còn được dùng ở `App.css:45`, `shell.css:581`, `peek.css:209-212`. **Điện thoại:** `shell.css:695-719` ẩn `.cmdk-trigger` dưới 640px với lý do "rail đã có Tìm". Bỏ nút Tìm ở rail thì phải cho `.cmdk-trigger` hiện ở dạng icon dưới 640px, nếu không điện thoại mất `Ctrl K`. Rail rộng hơn 8px: chạy lại `resource-layout:85-95` (thanh lọc Nhân lực ≤ 56px ở 1280) và `header-toolbar:121-135` |
| B2 | "Phím tắt" vào menu avatar, ghi kèm `?` | `Toolbar.tsx` | |
| B3 | Nhân lực có ba chế độ (2.4). `WorkspaceView` bỏ `"timesheet"` khỏi điều hướng nhưng `?view=timesheet` và giá trị đã lưu `gms.view.*` = `timesheet` đều ánh xạ sang `resource` + chế độ `ts` | `ProjectWorkspace.tsx` (`initialView`, `go`), `ResourceView.tsx` (segmented), `lenses.ts`, `shortcuts.ts` (`go-time` = "Nhân lực · Giờ đã ghi") | Chế độ Nhân lực đang chọn lưu theo dự án như lăng kính |
| B4 | Trang Cài đặt dự án (2.5): `WorkspaceView` thêm `"settings"`, `?view=settings`, `G S`, menu tên dự án | mới `components/ProjectSettings.tsx`; `SlaSettingsModal`, `WorkCalendarModal` thêm prop `embedded` (không vẽ `.modal-overlay`, nút lưu ở chân mục). Phần cài đặt KBKT (`KbktImportModal.tsx:529`, `<details className="kb-settings">`, nạp ở `:127`, lưu ở `:704`) tách thành `KbktSettings.tsx`, dùng ở cả trang Cài đặt lẫn hộp nhập | **Giữ nguyên class gốc** `.sla-modal`, `.cal-modal`, `.kb-settings` trên phần tử gốc của từng mục, để `sla.e2e` và `work-calendar.e2e` chỉ phải đổi cách mở. Nút "Mở Lịch làm việc…" trong SLA (`onOpenCalendar`) đổi sang chuyển mục. Cờ `slaOpen`/`calendarOpen` đang chặn phím và hoàn tác (`ProjectWorkspace.tsx:530, 1219`); khi chúng thành trang thì phần chặn đó chuyển cho `layers` (0-6). Trang có `← Về <lăng kính trước>` ở trên cùng; ở trang này không gạch chân lăng kính nào. Lệnh trong `Ctrl K` ("Cài đặt SLA…", "Lịch làm việc & ngày lễ…", `ProjectWorkspace.tsx:1199-1200`) giữ, trỏ tới mục tương ứng |
| B5 | Huy hiệu Nhân lực: chỉ đếm 2 tuần tới, có `title` | `Toolbar.tsx` + nơi tính số (grep `overloaded` trong `ProjectWorkspace`) | |
| B6 | Hộp chọn dự án (`Ctrl P`): bỏ câu "Chọn dự án Jira bạn muốn lập kế hoạch."; nhãn "Gần đây" trên 5 dự án gần nhất (đã có `recentKey`, chỉ thiếu nhãn); bỏ nút "Đăng xuất" khỏi variant `modal` (đã có trong menu avatar); `↑↓ Enter` chọn | `ProjectPicker.tsx` | Variant `page` (màn đầu sau đăng nhập) giữ Đăng xuất |

**Xong khi:** `header-toolbar.e2e.mjs` và `redesign.e2e.mjs` đã sửa theo khung mới và qua. Bấm `1 2 3 4`, `G H`, `G T`, `G S`, `Ctrl P` ra đúng chỗ. Rail không có hai nút cùng một việc.

---

## 6. Đợt C: Kế hoạch

### C1. Việc chưa có ngày có dòng trong WBS, và kéo để xếp lịch

**Hiện tại:** `ganttMapping.toGanttTasks` bỏ việc không có `startDate`. Chỉ thấy chúng qua menu "⚠ Chưa có ngày (1)" (ux-12). Muốn xếp: mở menu → bấm việc → khung chi tiết → ô ngày → gõ → đóng.

**Mới:**
1. Việc không ngày vẫn là một dòng WBS **ở đúng vị trí cây** (con của Epic/Story của nó; không cha thì xuống nhóm cuối "Chưa xếp lịch"). Cột ngày ghi "—". Phía thời gian: dòng trống có viền chấm `--line` khi rê chuột.
2. **Kéo trên dòng trống để vẽ thanh**: nhấn chuột tại ngày X, kéo tới ngày Y, thả → `PATCH { startDate: X, durationDays: Y−X+1 }`. Bấm một cái (không kéo) = 1 ngày tại X. Con trỏ `crosshair`, trong lúc kéo có tooltip `12/11 – 14/11 (3 ngày)` giống tooltip khi kéo thanh (ux-60).
3. Bàn phím: chọn dòng, nhấn `Enter` mở chi tiết với con trỏ đặt ở ô "Ngày bắt đầu".
4. Menu "⚠ Chưa có ngày" thành **bộ lọc** (bấm = chỉ hiện các dòng chưa có ngày, kèm cha của chúng), không còn là danh sách thả xuống.

**Cách làm với `gantt-task-react`:** thư viện cần `start`/`end` cho mọi task. Đưa việc không ngày vào **dưới dạng thanh vô hình** giống `axisSentinels` (đặt `start = end` = ngày đầu trục, style trong suốt, `isDisabled`), để dòng và thanh vẫn khớp chỉ số (overlay đọc thanh theo chỉ số dòng: `useBarRects`, `DependencyOverlay`, `BaselineOverlay`). Phần "vẽ" là một lớp phủ của ta (cùng kỹ thuật portal vào SVG như `TimelineMarkers`), đổi pixel ra ngày bằng `timelineGeometry` dựa trên **thanh gần nhất** (vì tỉ lệ ở chế độ Tháng không đều; xem CLAUDE.md, "measured from the nearest bar's own pixels-per-day"). Chuyển đổi pixel ↔ ngày để ở `timelineGeometry.ts` và có test.

**Thư viện không nhận việc không ngày** (đã kiểm trong `node_modules/gantt-task-react`): `Task.start`/`end` là `Date` bắt buộc. `ganttDateRange` đọc `start`/`end` của mọi task, và `taskXCoordinate` với `Invalid Date` ném lỗi. Vì vậy thanh vô hình phải mang ngày thật, và **ngày đó không được nới trục**: đặt `start = end` = hôm nay, kẹp vào khoảng của các việc có ngày. Loại chúng khỏi `axisSentinels` (`ganttWindow.ts:42-60`) và khỏi phép tính độ rộng cột chế độ Tháng (`GanttView.tsx:1064-1077`).

**Chỗ phải sửa** (theo bản đồ code):
- `ganttMapping.orderByWbs` (`:12-35`) đã xếp việc không ngày cuối nhóm anh em (sắp theo `startDate ?? "9999"`). Giữ thứ tự đó: việc không ngày nằm cuối nhóm của cha nó, không gom hết xuống đáy bảng.
- `ganttMapping.toGanttTasks` (`:144-165`, bộ lọc `ranges.has` ở `:146`) và `GanttView` `rows = visible.filter(v => ranges.has(v.task.id))` (`:897-901`): cho việc không ngày đi qua, gắn cờ `unscheduled`.
- `goToToday` (`:922-940`) đang dùng `ranges.get(...)!`: bỏ qua dòng không ngày.
- `TooltipContent` (`:977-1001`): dòng không ngày ghi "Chưa có ngày · kéo để xếp lịch", không hiện khoảng ngày giả.
- Bảng WBS `buildTable` (`:1240-1322`): ô ngày của dòng không ngày là "—".
- Lớp phủ (`useBarRects`, `BaselineOverlay`, `DependencyOverlay`, `TimelineMarkers`) đã bỏ qua task không có `ranges.get`. Giữ việc không ngày **không** có trong `ranges`, chỉ có trong `rows`, thì lớp phủ không đổi gì.
- Menu "Chưa có ngày" (`:1361-1396`, `.warning-pill`, `.unscheduled-item`): giữ class `.warning-pill` cho nút lọc mới, bỏ danh sách thả xuống.
- Ghi `onScheduleChange(id, start, durationDays)` (`:1709-1721`), cùng đường với kéo thanh, nên hoàn tác và bản nháp tự có.
- `CLAUDE.md:426` ("Tasks without a startDate are dropped from the chart") phải viết lại.

**Chặn rủi ro:** `ganttWindow` (cửa sổ cuộn > 250 dòng) đếm dòng theo `rows`. Thêm dòng không ngày làm đổi số dòng, nên chạy `gantt-scroll.e2e.mjs` và kiểm tra thanh/dòng còn thẳng hàng ở đầu, giữa, cuối. Các thứ tính tiến độ, critical path, cascade **không** được thấy thanh vô hình: lọc chúng ra ở `toGanttTasks` trước khi đưa cho mọi thứ khác (giống sentinel).

**Kế hoạch dự phòng** (nếu vẽ thanh không xong trong đêm): dòng vẫn hiện, phía thời gian là nút nhỏ "Xếp lịch" mở `DateField` (popover chọn ngày bắt đầu, thời lượng mặc định 1). Vẫn từ 5 bước xuống 2.

### C2. Thanh công cụ một hàng

Hiện tại ở 1440 thanh công cụ hai hàng: hàng hai chỉ có cụm zoom bên phải (ux-02), phí 30px. Gộp thành một hàng:

```
[⌕ Tìm…  JQL] [Đã lưu ▾] [Của tôi] [Quá hạn] [Chưa có ngày 1] [+ Bộ lọc]  ·····  [Ngày|Tuần|Tháng] [Về hôm nay] [↶] [⇲⇱] [👁 ▾] [⇅ ▾] [?]
```

- Dưới 1440: "Đã lưu" thành icon, ô tìm co tới 160px, "Hiển thị" và "Nhập / Xuất" chỉ còn icon (như ở 1280 hiện nay, ux-13).
- Không thứ gì được xuống hàng. Hàng hai chỉ hiện khi có chip lọc đang bật (giữ như cũ).
- Kiểm tra ở 1024, 1280, 1440, 1500.

### C3. Mở đúng chỗ

- Lần đầu mở Kế hoạch (và khi bấm "Về hôm nay"), vạch hôm nay nằm ở **1/3 bề ngang** vùng thời gian, không sát mép phải (ux-50).
- Vạch chia WBS | thời gian mặc định `min(nhu cầu cột, 45% bề ngang)`. Ở 1024px hiện chỉ còn khoảng 390px cho thời gian (ux-43). Nếu người dùng đã kéo (`gms.gantt.listWidth`) thì vẫn tôn trọng, nhưng kẹp ở tối đa 60%.

### C4. Sửa ô kiểu bảng tính

Hiện chỉ sửa tại chỗ được Người và Trạng thái.

| Cột | Cách sửa | Ghi |
|---|---|---|
| Tên | `F2` hoặc bấm vào tên **của dòng đang chọn** (bấm lần hai, không phải nhấp đúp) | `PATCH summary` |
| Bắt đầu, Kết thúc | ô `DateField` trong ô | Kết thúc → tính lại thời lượng (D2) |
| Thời lượng | `NumberInput` | |
| % | `NumberInput` 0–100 | |
| Người | `PersonPicker` (0-3) | thay danh sách hiện tại |

- **Nhấp đúp vẫn mở chi tiết** (không đổi; `wbs-dblclick.e2e.mjs` là hợp đồng). Sửa ô chỉ bắt đầu bằng `F2`, `Enter` trên ô đang trỏ, hoặc bấm vào ô của **dòng đã chọn từ trước**. Chi tiết như vậy để không phá double-click: lần bấm thứ nhất chỉ chọn dòng, không mở ô sửa.
- `Tab` / `Shift Tab` sang ô kế. `Esc` huỷ ô. `Enter` lưu rồi xuống dòng dưới, cùng cột.
- Mọi lần lưu đi qua `onUpdate` hiện có (lạc quan + `seq`/`taskVersion`), vào được hoàn tác (`undo.ts`) với ngày/thời lượng/% (giống kéo thanh).
- `CellPicker` đã có cơ chế `cellEdit`; mở rộng loại ô thay vì viết lại. Chỗ trong code: `cellEdit: { task; kind: "assignee" | "status"; rect }` (`GanttView.tsx:1080`), `openCellEditor` (`:1082-1088`), `cellItems` (`:1089-1114`), phần quyết định ô nào sửa được (`:1291-1314`, kèm `onDoubleClick={() => setCellEdit(null)}` để nhấp đúp vẫn mở chi tiết). Cột: `COLUMNS` (`:287-454`). Thêm `kind` = `"summary" | "start" | "due" | "duration" | "pct"`. Ô ngày/số là ô nhập (`DateField`, `NumberInput`) trong popover cùng vị trí `rect`, không phải danh sách. Ghi: ngày và thời lượng qua `onScheduleChange`, % qua `onProgressChange`, tên qua `api.updateTask({summary})` như `TaskEditModal` (`ProjectWorkspace.tsx:1587-1591`).
- Dòng WBS đang `user-select: none` (CLAUDE.md). Ô nhập trong popover phải bật lại `user-select: text`.

### C5. Phụ thuộc: cho người ta biết là kéo được

- Chấm tròn ở hai đầu thanh hiện ra mà không gợi ý gì. Rê chuột vào chấm lần đầu trong phiên: `title` = "Kéo sang việc khác để nối". Đang kéo: dải co giãn đã có (`DependencyOverlay`); thả lên thanh đích thì toast "Đã nối DEMO-5 → DEMO-6 (FS)" có nút **Hoàn tác**.
- Thêm cột chọn hiển thị **"Phụ thuộc"** (tắt mặc định, bật trong menu cột) hiện `5FS+2, 7SS`, sửa tại chỗ kiểu MS Project bằng hàm thuần `parsePredecessors(text, keyPrefix)` (nhận "5", "DEMO-5", "5FS+2", "5ss-1", cách nhau dấu phẩy) có test. Ghi qua `PATCH predecessors` (cascade đi theo như cũ). Từ chối vòng lặp bằng cùng kiểm tra `reaches()` mà trợ lý dùng.

### C6. Bản nháp: bớt chữ

- Toast khi bật nháp ("Đang nháp: kéo thả thoải mái, chưa ghi gì lên Jira. Áp dụng khi đã ưng.", ux-63) là đoạn giải thích. Bỏ toast, thanh nháp đã nói đủ ("Nháp · chưa ghi lên Jira").
- Thanh nháp đang **chiếm chỗ trong luồng** (đẩy thanh lọc xuống 36px). Cho nó nằm trong hàng thanh công cụ (thay thế cụm lọc bên trái khi đang nháp) hoặc `position: sticky` đè lên hàng lọc. Không được đẩy bảng.

### C7. Nhãn ngoài thanh đè lên nhau

Nhãn tên vẽ ngoài thanh ngắn chạy đè sang thanh/nhãn hàng dưới-phải (ux-02: "Sửa lỗi hiển thị bảng", "Thiết kế cơ sở dữ liệu"). Cắt nhãn ngoài tại mép thanh kế tiếp **trên cùng dòng** hoặc tối đa 240px, có `…`. Nhãn đầy đủ vẫn ở tooltip.

---

## 7. Đợt D: khung chi tiết việc

### D1. Đẩy, không che

**Hiện tại:** `.peek-panel` rộng `min(920px, 64vw)`. Ở 1440 nó che toàn bộ vùng thời gian (ux-04), trái với điều MASTER.md hứa ("kế hoạch vẫn dùng được").

**Mới:**
- Rộng `--peek-w: clamp(400px, 34vw, 480px)`, **một cột**.
- Từ 1200px trở lên: khi khung mở, vùng làm việc có `padding-right: var(--peek-w)` (chuyển tiếp `--d-3`), nên Gantt co lại thay vì bị che. Thanh của việc đang mở được tô `--info-wash` và tự cuộn vào giữa vùng thời gian còn lại. Dưới 1200px: đè lên như cũ.
- Áp dụng cho mọi lăng kính có mở chi tiết (Bảng, Nhân lực, Hôm nay), không chỉ Kế hoạch.

### D2. Thứ tự theo tần suất dùng

```
DEMO-3  ◑ In Progress ▾                                  ⋯   ×
Phân tích yêu cầu                              ← textarea, trông như chữ, viền khi rê/focus
────────────────────────────────────────────────
Người        (A) Nguyễn Anh ▾
Lịch         30/10 → 02/11 · 4 ngày        ← 3 ô DateField / DateField / NumberInput, sửa ô nào tính lại ô kia
Hoàn thành   ▬▬▬▬▭▭▭▭  40%
Công sức     12h ước lượng · 0h đã ghi  [+ Ghi giờ]
Ưu tiên      ⌃ High ▾          Loại   Story ▾
Nhãn         urgent ×  +
Thuộc        DEMO-1 Giai đoạn 1 ▾                  ← TaskPicker
Sprint · Thành phần · Phiên bản                      ← một dòng, gập nếu trống
────────────────────────────────────────────────
Mô tả   (một dòng mờ "Thêm mô tả" khi trống; bấm thì mở ô)
────────────────────────────────────────────────
Phụ thuộc lịch (2) · Liên kết Jira (1) · Đính kèm (3)   ← chỉ phần có nội dung mới mở sẵn
+ Phụ thuộc   + Liên kết   + Đính kèm                    ← phần trống chỉ là một nút
────────────────────────────────────────────────
Bình luận (1) | Lịch sử
…
────────────────────────────────────────────────
                                    [Lưu  Ctrl ⏎]
```

- **Kết thúc sửa được.** Đổi kết thúc → thời lượng = kết thúc − bắt đầu + 1 (ngày lịch, như mọi chỗ khác). Đổi thời lượng → kết thúc tính lại. Đổi bắt đầu → giữ thời lượng, dời kết thúc. Logic ở `scheduleFields.ts` (thuần, có test), dùng chung cho C4.
- Bỏ nhãn nhóm thừa ("Con người", "Lịch", "Công sức", "Phân loại" đứng trên nhãn trường). Nhãn trường đã đủ.
- **Hợp đồng e2e phải giữ**: trường vẫn tìm bằng chữ trong `.field > span`, mã ở `.modal-id`, nút lưu là `.modal-footer .primary`. Đổi bố cục thì giữ các class này (CLAUDE.md, "keep those").
- **Giữ khung DOM** `.td-main` và `.td-side` (chỉ đổi lưới thành một cột: `.td-side` lên trước, `.td-main` sau), vì nhiều e2e bám vào chúng. Đó cũng chính là cách `peek.css:104-122` đang làm dưới 1200px, nên chỉ cần áp quy tắc đó cho mọi bề ngang. Các e2e **phải sửa** vì cố ý đổi hành vi: `transition-fields:93-101` (khẳng định hai cột, và tiêu đề nhóm bắt đầu bằng "Trạng thái", "Con người"), `task-detail-polish:144` (`.td-calc` là `OUTPUT`, tức Kết thúc chỉ đọc), `:158` (cả hai cột có thanh cuộn mảnh), `:145-156` (nhãn và giá trị cùng dòng: kiểm lại ở 440px).
- Logic Kết thúc hiện ở `TaskEditModal.tsx:607-611` (`<output className="td-calc">`, tính bằng `addDays` ở `:805-810`). State `startDate`/`durationDays` (`:86-87`), `changeDuration` (`:259-263`), `dirty` (`:227-243`). Bản vá vẫn chỉ gửi `startDate` + `durationDays`: Kết thúc là ô nhập, nhưng thứ được gửi lên vẫn suy ra thời lượng, server không đổi.
- `⋯` chứa: Mở trên Jira, Sao chép mã (`Ctrl .`), + Sub-task, Đổi loại (Jira Move), **Xoá** (cuối, màu `--risk-text`, có hỏi lại). Chân khung chỉ còn nút Lưu. Bỏ "Xoá" và "+ Sub-task" khỏi chân (hiện đang đứng cạnh nhau).
- Người theo dõi: gom vào `⋯` thành "Theo dõi / Bỏ theo dõi", thêm số người ở dòng meta trên cùng.

### D3. Bộ chọn có tìm kiếm

- Việc cha: `TaskPicker` lọc theo luật cấu trúc (`client/src/structure.ts`: không vòng lặp, Sub-task không làm cha, Epic không có cha).
- Phụ thuộc: `TaskPicker` + kiểu FS/SS/FF/SF + độ trễ, trên một dòng. Gõ "5fs+2" vào ô tìm cũng được (dùng `parsePredecessors` của C5).
- Liên kết Jira: ô mã đổi thành `TaskPicker` (vẫn cho gõ mã của dự án khác, vì liên kết Jira được phép liên dự án).

### D4. Ô trống không phải là một form

Phần "Đính kèm" hiện là một vùng thả tệp lớn khi chưa có tệp nào, "Phụ thuộc lịch" là một form ba ô khi chưa có phụ thuộc nào (ux-04). Bình luận vì thế bị đẩy xuống dưới màn hình. Theo D2: phần trống = một nút `+`. **Dán ảnh ở bất kỳ đâu trong khung vẫn thêm đính kèm** (giữ hành vi cũ). Kéo tệp vào khung thì cả khung sáng lên làm vùng thả.

---

## 8. Đợt E: một bộ lọc cho mọi lăng kính

### E1. Một trạng thái

- `TaskFilter` ở `ProjectWorkspace` (đang dùng chung cho Kế hoạch và Nhân lực) trở thành **nguồn duy nhất** cho Kế hoạch, Bảng, Nhân lực.
- Bảng: các facet chung (người, "của tôi", quá hạn, ưu tiên, Epic, loại, trạng thái, chữ tìm, thành phần, phiên bản, sprint, JQL) đọc từ `TaskFilter`. Chỉ hai thứ là của riêng Bảng và vẫn ở state cục bộ: **"Bị chặn"** và **bộ lọc nhanh của board Jira**. Viết hàm thuần `boardFilterFrom(taskFilter, boardOnly)` → `BoardFilter` (có test), để `matchesFilter` trong `boardModel` không phải đổi.
- `applyChatFilter` không cần `incomingFilter` riêng cho Bảng nữa: lọc từ trợ lý vào thẳng `TaskFilter`. Giữ `incomingFilter` cho phần riêng của board, nếu có.
- Lọc được nhớ theo site + dự án như hiện nay (`taskFilter` trong localStorage, trừ ô chữ).
- Nhịp dự án: phạm vi (`assignee`, `epic`, `type`) lấy **mặc định** từ `TaskFilter` khi nó chỉ có đúng một người, một Epic hoặc một loại. Nếu nhiều hơn thì hiện chip "Bộ lọc của Kế hoạch không áp dụng ở đây" trong `title`. Ô chọn riêng của Nhịp vẫn giữ, nhưng đổi sang kiểu chip giống thanh lọc.

### E2. Một thanh lọc, một thứ tự

```
[⌕ Tìm…] [Của tôi] [Quá hạn] [+ Bộ lọc ▾] [Đã lưu ▾]   ·····   [phần riêng của lăng kính]
```

| Lăng kính | Phần riêng bên phải |
|---|---|
| Kế hoạch | Chưa có ngày · Ngày/Tuần/Tháng · Về hôm nay · ↶ · gập/mở · Hiển thị · Nhập/Xuất · ? |
| Bảng | Bị chặn · Nhóm theo · Thẻ · Mở trên Jira |
| Nhân lực | Mức tải/Giờ đã ghi/Kỹ năng · Ngày/Tuần/Tháng · Về hôm nay · Khoảng · CSV |

- Bảng dùng `FilterBar` (thay thanh tự vẽ `.bd-filters`, `BoardView.tsx:890-1014`). **Giữ class `.bd-filters`** trên vỏ ngoài và `.bd-search`, `.bd-quick-filter`, `.bd-empty` cho từng phần, vì `board-kanban`, `phase1:279-290`, `stage3:131-139` và `chat-assistant:109-118` bám vào. Bảng **không** được thêm facet "Trạng thái" vào panel (cột của Bảng đã là trạng thái; `phase1:279-285` khẳng định điều này): khi `boardFilterFrom` nhận một bộ lọc trạng thái từ Kế hoạch, nó vẫn áp dụng và hiện chip, chỉ là không có mục chọn trong panel.
- Panel Epic/Phiên bản của Backlog (`BacklogPanels.tsx:8-9`, qua `BacklogView.tsx:45-47`) hiện ghi vào `BoardFilter` cục bộ. Đổi sang ghi vào `TaskFilter` chung (`epics`, `versions`).
- Hành vi đổi theo: trước đây lọc của Bảng "về trống mỗi lần mở tab" (CLAUDE.md, mục `set_view_filter`). Giờ nó giữ như Kế hoạch. Ghi lại trong CLAUDE.md. Avatar người trong thanh lọc Bảng chuyển vào panel "Bộ lọc" (facet Người), giống Kế hoạch.
- **Bộ lọc nhanh của board Jira** ("Việc của tôi", "Chỉ lỗi"…) đưa vào panel "Bộ lọc", thành mục "Của board". Chúng không còn là chip đứng cạnh "Của tôi" của app. Hiện tại "Của tôi" và "Việc của tôi" đứng cạnh nhau, trông y hệt nhưng là hai thứ khác nhau.
- **Nhân lực dùng `Ngày | Tuần | Tháng`** như Kế hoạch (cùng `timeZoom.DEFAULT_PIXELS_PER_DAY`), bỏ ô chọn "Cột: Tuần". Giữ menu "Khoảng".
- "Sắp" đổi thành "Sắp xếp".

---

## 9. Đợt F: Nhân lực và Giờ làm

| ID | Vấn đề | Sửa | File |
|---|---|---|---|
| F1 | "Gán…" và "Chuyển…" là `<select>` chỉ có tên (ux-21) | `PersonPicker` (0-3): thấy ngay ai rảnh trong khoảng ngày của việc | `ResourceUnassigned.tsx` (~210), `ResourcePersonBlock.tsx` (~275) |
| F2 | Dự án lớn: cả 4 người "85 ngày" quá tải, cả lưới đỏ, không có lối đi tiếp (ux-51) | (a) Nhãn đỏ cạnh tên = số ngày quá tải **trong 2 tuần tới** ("6 ngày"), cả dự án để ở `title`. (b) Bấm nhãn → mở người đó và cuộn tới ngày quá tải đầu tiên. (c) Trên dòng việc của người quá tải, hiện nút "Chuyển…" (đã có) ngay cả khi chưa rê chuột | `ResourcePersonBlock.tsx`, `resourceAllocation.ts` (thêm `overloadedDaysIn(range)`) |
| F3 | Thẻ việc chưa gán không cho biết việc nằm ở đâu trên lịch | Mỗi dòng thêm `12/11–14/11 · 3 ngày`. Rê chuột vào dòng thì vùng ngày đó được tô mờ trên lưới người, để thấy ai rảnh | `ResourceUnassigned.tsx` |
| F4 | Dòng việc trong một người: tên cắt còn khoảng 10 ký tự ("Phân tích yê…") vì cột trạng thái chiếm chỗ (ux-22) | Bỏ chữ trạng thái, thay bằng `StatusGlyph`. Tên có cả bề ngang cột tên. `title` = tên đầy đủ | `ResourcePersonBlock.tsx` |
| F5 | Ghi giờ ở Giờ đã ghi: bấm ô → panel bên → "+ Ghi giờ ngày này" → hộp thoại → chọn việc, nhập giờ → lưu (5 bước). Code: ô `TimesheetView.tsx:312-347`, panel `.ts-detail` `:383-436`, hộp `LogWorkModal` `:474-576` (gọi `api.logWork`). Gợi ý việc mặc định lấy từ `logSuggest.ts` (đang dùng cho tờ ghi giờ ở Hôm nay) | **Trên dòng của chính mình**, ô ngày là ô nhập: gõ số (`4`, `1.5`, `2h30`) → popover nhỏ hỏi việc (`TaskPicker`, mặc định là việc ghi gần nhất / việc đang làm) → `Enter` ghi. Ô đã có giờ thì bấm vào mở danh sách mục (như panel hiện tại). Dòng người khác chỉ đọc (Jira chỉ cho ghi giờ dưới tên người đăng nhập) | `TimesheetView.tsx`; hàm thuần `parseHours.ts` (có test) |
| F6 | Tờ "Ghi giờ hôm nay" là ngõ cụt khi không có việc đang làm (chỉ có câu "Mở một việc và dùng '+ Ghi giờ' trong đó") (ux-40) | Luôn có dòng "+ Việc khác" (`TaskPicker`). Bỏ hai đoạn giải thích. Thay bằng một dòng `--ink-3`: "Ghi bằng tài khoản Jira của bạn" | `TodayView.tsx` (tờ ghi giờ), `logSuggest.ts` |
| F7 | Hồ sơ người: kiểu lưu "Huỷ / Lưu thay đổi" + hỏi "Bỏ các thay đổi chưa lưu?" khác hẳn khung chi tiết; có lớp phủ tối; ô ngày `mm/dd/yyyy` (ux-23) | 2.6 (đóng là lưu, không lớp phủ, `useLayer`), `DateField` (A8). Bỏ câu "Đang dùng mặc định 8h/ngày." (placeholder "8" đã nói) | `ResourceProfileDrawer.tsx` |
| F8 | Dòng tóm tắt khi mở người: "64h đã giao / 776h khả dụng · 8% mức sử dụng" tính trên cả khoảng dự án nên gần như luôn rất thấp | Tính trên **khoảng đang hiện** (hoặc 4 tuần tới nếu khoảng là "Theo dự án") và ghi rõ: "4 tuần tới: 64h / 160h" | `ResourcePersonBlock.tsx` |
| F9 | Chú thích "Ngày nghỉ" trông như ô đánh dấu (ux-09) | Ô màu đặc, không viền như checkbox | `design/views.css` (`.rv-swatch.band-off`) |
| F10 | Giao vào người đang quá tải không có cảnh báo (bản 06/11 ghi "Chưa làm") | Thả hoặc chọn người có `conflictDays > 0`: toast "Chi đã kín 3 ngày trong 12–14/11" + **Hoàn tác**. Không chặn, không hỏi (đúng tinh thần `autoAssign`: không ai bị loại vì bận) | `ProjectWorkspace.handleAssign` (ghi chú cho người ghép) |

---

## 10. Đợt G: Bảng và Backlog

| ID | Vấn đề | Sửa | File |
|---|---|---|---|
| G1 | Đầu sprint cao khoảng 140px, có biểu đồ nhỏ (ux-08) | Một dòng: `Sprint 7 · 02/11 → 16/11 · còn 6 ngày · ▬▬▭ 17% · ▼ Chậm hơn nhịp      [Hoàn thành sprint] [⋯]`. Burndown vào popover khi bấm vào thanh %. Mục tiêu sprint ở `title` của tên sprint, và hiện thành dòng thứ hai chỉ khi có | `SprintHeader.tsx` |
| G2 | "Phân tích sprint (AI)", "Lập kế hoạch bằng AI" là viên thuốc tím, trái luật "AI chỉ là nhãn nhỏ" | Nút thường (`--control-*`) + nhãn `.ai-tag` "AI" nhỏ. "Phân tích sprint" đưa vào `⋯` của đầu sprint. "Lập kế hoạch" giữ nút (là hành động chính của sprint trống) | `SprintHeader.tsx`, `BacklogView.tsx` |
| G3 | Đầu cột "To Do 5 … 12": hai số không đơn vị | `To Do  5 việc · 12 điểm` (đơn vị từ trường ước lượng của board: điểm/giờ). Có WIP thì `5/4` màu `--risk-text` | `KanbanBoard.tsx` |
| G4 | Bộ lọc nhanh của Jira lẫn với lọc của app | E2 | `BoardView.tsx` |
| G5 | Backlog: `✎`, `🎯`, nút xoá sprint bằng icon thùng rác đứng cạnh `✎` | A6. Gom sửa/xoá sprint vào `⋯` | `BacklogView.tsx` |
| G6 | Thẻ "Việc con DEMO-901" có hai chỗ trống `–` và `?` (không ước lượng, không người) (ux-08) | Ẩn ước lượng khi trống. Avatar trống chỉ hiện khi rê chuột (để vẫn gán được bằng chuột) | `KanbanBoard.tsx` |
| G7 | Kéo việc chưa có ngày vào một sprint không gợi ý gì về lịch (Backlog và Gantt rời nhau) | Thả việc **chưa có ngày** vào sprint: toast "Xếp DEMO-9 vào 02/11–16/11?" có nút **Xếp** (đặt bắt đầu = ngày đầu sprint hoặc hôm nay nếu sprint đang chạy, thời lượng = ước lượng/8 hoặc 1). Không tự ghi | `BacklogView.tsx` |
| G8 | Thẻ Kanban: `Shift H/L` chuyển cột (bản 06/11 ghi chưa làm) | `Shift h/l` = chuyển thẻ đang chọn sang cột trái/phải tới trạng thái đầu tiên workflow cho phép (`moveCard` đã có). Thêm vào `shortcuts.ts` | `KanbanBoard.tsx`, `BoardView.tsx` |
| G9 | Avatar trên thẻ và dòng Backlog là `AssigneePicker`: một `<select>` gốc vô hình đè lên chữ tắt, không tìm được, không biết ai rảnh | `PersonPicker` (0-3) mở từ avatar. `AssigneePicker` thành vỏ mỏng gọi `PersonPicker`, để chỗ dùng không phải đổi | `AssigneePicker.tsx` |

---

## 11. Đợt H: Hôm nay, Nhịp dự án, trợ lý, tạo việc

### Hôm nay

| ID | Vấn đề | Sửa |
|---|---|---|
| H1 | Số 0 ("Đang làm 0 · Đến hạn tuần này 0") | A10 |
| H2 | Dưới tiêu đề "Chưa xếp lịch", từng dòng lại ghi "chưa có ngày" | Thay chữ đó bằng nút "Xếp lịch" (mở `DateField`) |
| H3 | "Sắp tới" nhóm theo **ngày bắt đầu** ("T4 11/11") nhưng bên phải ghi **hạn** ("hạn 20/11", "hạn 13/11") (ux-54) | Nhóm theo ngày bắt đầu và ghi rõ: tiêu đề nhóm "Bắt đầu T4 11/11", bên phải "hạn 20/11". Hoặc nhóm theo hạn. Chọn **nhóm theo ngày bắt đầu** vì "Sắp tới" trả lời "tuần này tôi bắt tay vào gì" (`today.ts`) |
| H4 | Câu chào "Hôm nay là ngày nghỉ. Không có gì gấp." vẫn hiện danh sách việc làm như thường | Giữ câu (đúng). Không đổi |
| H5 | Hôm nay chỉ cho dự án đang mở nhưng nằm ở rail, nơi đọc như "của mọi dự án" | Tiêu đề phụ dưới ngày: tên dự án mờ ("Dự án mẫu"). Bản đa dự án để sau (§14) |

### Nhịp dự án

| ID | Vấn đề | Sửa |
|---|---|---|
| H6 | Một ý nói ba lần: "Chậm tiến độ." → "Nguyên nhân chính: DEMO-3 đã trễ 1 ngày…" → dòng "DEMO-3 trễ 1 ngày · Phân tích yêu cầu · Nguyễn Anh" (ux-10). Dưới nữa, bảng điều khiển còn nhắc lại lần thứ tư và năm: danh sách lý do `pr-reasons` (`ProgressReportView.tsx:394-400`), chip chất lượng "chưa có baseline" (trùng hàng quyết định cùng tên) và khối "Cần xử lý ngay" `.pr-attn` = 5 việc quá hạn đầu (`:300`, `:464-488`, trùng hàng "N việc quá hạn") | Câu kết luận giữ phần **dự báo** ("Dự kiến xong 21/11"). Phần nguyên nhân chỉ nằm ở hàng "Cần bạn quyết": `pulseHeadline` (`projectPulse.ts:70-111`) bỏ câu "Nguyên nhân chính" khi nguyên nhân đó đã là một hàng trong `pulseDecisions` (`:196-332`). Bỏ khối `.pr-attn` (ô "Quá hạn" đã mở ngăn kéo cùng danh sách). Bỏ chip "chưa có baseline" khi hàng quyết định cùng loại đang hiện. Viết test trong `client/test/projectPulse.test.ts`: không mã việc nào xuất hiện ở cả `headline.detail` lẫn `decisions` |
| H7 | Tiêu đề hai màu ("Có rủi ro chậm" cam + "tiến độ." đen) | Một màu theo mức (`--warn-text` / `--risk-text` / `--ink`) |
| H8 | Nút "In" | Icon máy in, `aria-label="In"` và `title="In"` (`stage3:230-233` tìm nút có tên đúng "In"). Để ở `.pr-header-tools` |
| H9 | Khung AI chiếm khoảng 30% bề ngang dù trống: ô vuông tím "AI" to, đoạn giải thích, hai nút "Phân tích ngay" (`AiBrief.tsx`: một ở `.ai-head` `:137-159`, một ở `.ai-empty` `:195-199`) (ux-10) | Chưa có nhận định thì **không có khung**: nút "Phân tích ngay" + `.ai-tag` trên hàng tiêu đề trang, dashboard rộng hết. Có nhận định thì khung hiện như cũ |
| H10 | Ô "0 Trễ baseline", "0 Chưa bắt đầu" | A10 |
| H11 | "Mở DEMO-5" trên hàng "Nguyễn Anh quá tải 9–10/11" mở một việc tuỳ chọn, trong khi hành động đúng là xem lịch người đó | Đổi thành "Xem lịch Anh" → Nhân lực, mở người đó, cuộn tới ngày quá tải (dùng lại F2b) |

### Trợ lý

| ID | Vấn đề | Sửa |
|---|---|---|
| H12 | Ký tự làm icon (☰ ✎ 📎 ➤ ▾) | A6 |
| H13 | Khung trợ lý đè lên dải "Ghi giờ hôm nay" ở Hôm nay (ux-41) | Khi trợ lý mở, dải dưới của Hôm nay chừa `padding-right` bằng bề ngang khung trợ lý. Hoặc trợ lý mở thành tờ bên phải giống khung chi tiết (đẩy chứ không che, D1). **Chọn tờ bên phải** để mọi thứ bên phải dùng cùng một vị trí |

### Tạo việc bằng biểu mẫu

| ID | Vấn đề | Sửa |
|---|---|---|
| H14 | "Task mới" + câu phụ "Thêm một hoặc nhiều công việc vào dự án và đồng bộ với Jira", "+ Thêm task khác (hoặc nhấn Enter)", "Tạo task & đẩy lên Jira" (ux-33) | Tiêu đề "Tạo việc", bỏ câu phụ, "+ Thêm dòng", nút "Tạo" (đếm khi nhiều: "Tạo 3 việc"). A7 |
| H15 | Ô tên trong biểu mẫu không hiểu cú pháp tạo nhanh | Ô tên chạy `quickAdd.parse`: gõ "Dựng API @Chi t6 3n" thì người, ngày, thời lượng được điền vào các trường bên dưới, chip giống `Ctrl K`. Một cú pháp cho mọi chỗ tạo việc |

---

## 12. Bản đồ e2e

> Lập bằng cách đọc toàn bộ `e2e/*.e2e.mjs`. **Sửa e2e trong cùng commit với thay đổi**, không dồn cuối đêm.
>
> Lưu ý về Playwright: `hasText` dạng chuỗi là so khớp **chuỗi con, không phân biệt hoa thường**. Vì vậy `{ hasText: "Hôm nay" }` vẫn khớp nút "Về hôm nay". Còn `getByRole(..., { exact: true })` và `:text-is()` là so khớp đúng.

### 12.1. Cách mở trang và hợp đồng khung

- `e2e/run.mjs:72-73` đặt `E2E_APP = …/?view=gantt` cho mọi file. `ProjectWorkspace.tsx:71` (`VIEWS`) và `initialView()` (`:77-88`) đọc nó: `?view=` trước, rồi `gms.view.<site>.<dự án>`, rồi `"today"`. Thêm `"settings"` vào `VIEWS`. Với `"timesheet"`: giữ trong `VIEWS` như một **bí danh** (ánh xạ sang `resource` + chế độ `ts`), để link và giá trị đã lưu vẫn chạy.
- **Thêm vào `e2e/toolbar.mjs`** hàm `openTimesheet(page)` (bấm lăng kính Nhân lực, rồi `[data-mode=ts]`) và `openSettings(page, section)` (`?view=settings` hoặc menu tên dự án → "Cài đặt dự án", rồi mục). Mọi chỗ dưới đây gọi hai hàm này thay vì tự bấm.

### 12.2. Theo file

| File:dòng | Đang khẳng định | Do mục | Sửa thành |
|---|---|---|---|
| `header-toolbar:30-36` | rail có đúng 1 nút `aria-label='Tạo việc'` | B1 | Giữ (rail vẫn có Tạo) |
| `header-toolbar:121-135` | thanh Gantt một hàng ở 1500, cao ≤ 41, nút 28px, tràn ≤ 1 | C2, B1 | Giữ; thêm cùng phép thử ở 1280 và 1024 |
| `header-toolbar:51-67` | menu `.project-switch` có "Đổi dự án" | B4 | Giữ; thêm khẳng định có "Cài đặt dự án" |
| `header-toolbar:218-225` | `.warning-pill` khớp `/^Chưa có ngày \(\d+\)$/`; `.unscheduled-item` mở chi tiết | C1 | Pill giữ chữ (thành nút lọc). Bỏ phần `.unscheduled-item`; thay bằng: bấm pill → còn đúng các dòng chưa có ngày + cha của chúng |
| `phase1:81-85` | sau "Thu gọn tất cả nhóm" có **đúng 2** `.wbs-row` | C1 | 3 (DEMO-9 là việc gốc không ngày, `mock-api.mts:52`) |
| `phase1:87-93` | "Chưa có ngày" → `.unscheduled-item` DEMO-9 → `.modal-id` | C1 | Nhấp đúp dòng DEMO-9 trong WBS → `.modal-id` == DEMO-9 |
| `phase1:94`, `gantt-small-fixes:43,51` | nút `hasText "Hôm nay"` trên thanh Gantt | A11 | Không cần sửa (so khớp chuỗi con). `gantt-small-fixes:46` kiểm câu "Hôm nay nằm trước": giữ nguyên câu đó |
| `resource-layout:249` | `.rv-range button {hasText:"Hôm nay"}` đúng 1 | A11, E2 | Vẫn đúng nếu chỉ còn một nút "Về hôm nay" |
| `phase1:335`, `stage3:113`, `tab-cache:66,73`, `warm-views:47`, `work-calendar:114`, `resource-layout:612-614`, `shots.mjs:49` | `[data-view=timesheet]` trên rail | B3 | `openTimesheet(page)`. Sửa câu chú thích ở `resource-layout:612` ("Giờ làm … là một chỗ trên rail") |
| `stage3:47-48,65`, `resource-layout:103-104` | `.rv-modes` có "Mức tải", "Kỹ năng"; có `.sf-select` trên thanh lọc Nhân lực | B3, E2 | Thêm "Giờ đã ghi" vào danh sách mong đợi. Ở chế độ Giờ đã ghi, thanh lọc là của bảng giờ (không có `.sf-select`) |
| `redesign:38` | `[data-view=today][aria-current=page]` đúng 1 | B1 | Giữ (nút Hôm nay còn ở rail) |
| `redesign:56-81` | sửa tại chỗ Người: PATCH chỉ có `assigneeAccountId`; Epic không có `.is-editable` | C4, 0-3 | Ô Người giờ mở `PersonPicker`; giữ class `.cell-picker` và `.cell-picker-item` trên nó để phép thử không đổi |
| `wbs-dblclick:28-56` | nhấp đúp lên tên và lên ô `.wbs-col-extra` đầu tiên mở chi tiết; một cú bấm chỉ chọn | C4 | **Phải tiếp tục qua mà không sửa.** Đây là phép thử của C4 |
| `redesign:89-98`, `stage2:250`, `gantt-scroll:45-68,195-217` | `.wbs-row[i]` ↔ `g.bar > g[i]` cùng chỉ số | C1 | Thanh vô hình phải sinh ra đúng một `g.bar > g` ở cùng chỉ số. Chạy lại cả ba |
| `transition-fields:93-101` | chi tiết có **hai cột**; tiêu đề nhóm bắt đầu "Trạng thái", "Con người" | D2 | Một cột: `.td-side` nằm trên `.td-main`. Bỏ khẳng định tiêu đề nhóm |
| `task-detail-polish:144` | `.td-calc` là `OUTPUT` | D2 | Kết thúc là `.date-field input` sửa được; đổi nó thì thời lượng đổi theo |
| `task-detail-polish:145-158` | Ước lượng/Đã ghi cạnh nhau; nhãn và giá trị cùng dòng; hai cột có thanh cuộn mảnh | D1, D2 | Kiểm lại ở 440px; bỏ khẳng định thanh cuộn của `.td-side` |
| `task-detail-polish:52-67` | `.td-section` cho Đính kèm/Phụ thuộc/Liên kết Jira, đếm ở `.td-section-hint`; nút "Thêm liên kết" | D4 | Phần có nội dung vẫn là `.td-section` có đếm. Phần trống thành nút "+ Đính kèm"… Sửa phép thử: bấm nút để mở trước |
| `stage2:73-76,113-118` | `.field:has(> span:text-is('Việc cha')) select` option và `selectOption("DEMO-1")` | D3 | `TaskPicker`: bấm ô → gõ "DEMO-1" → Enter. Đếm lựa chọn bằng `.cell-picker-item` sau khi xoá ô tìm (phải có DEMO-1, DEMO-2, không có DEMO-5) |
| `stage2:78-99` | form "Liên kết Jira": `select` kiểu, `input` mã, "+ Liên kết", "gỡ" | D3, D4 | Bấm "+ Liên kết" để mở form trước, rồi chọn việc bằng `TaskPicker` |
| `sla.e2e:41-71` | menu → "Cài đặt SLA" → `.sla-modal`; `input[type=time]` có giá trị `08:00…`; `input[type=date]`.fill; `aria-label='Khung 1 kết thúc'`.fill("13:30"); "Huỷ" → `.dlg button.danger-solid` | B4, A8, A9 | `openSettings(page,"SLA")`. Ô giờ là `TimeInput` (ô chữ): đọc `value` của `[aria-label^='Khung']`, giữ các `aria-label`. Ô ngày: `.sla-modal .date-field input`.fill("dd/mm/yyyy"). "Huỷ" trên trang Cài đặt = trả về giá trị đã lưu, không hỏi (2.6) |
| `work-calendar:49-157` | `openMenuItem("Lịch làm việc…")` → `.cal-modal`; `.cal-add-range input[type=date]`; "Mở Lịch làm việc" từ SLA đóng `.sla-modal` | B4, A8 | `openSettings(page,"Lịch làm việc")`; ô ngày thành `DateField`; "Mở Lịch làm việc" chuyển mục (`.sla-modal` không còn hiện) |
| `kbkt-import:61-77` | trong `.kb-modal`: `.kb-settings > summary` … | B4 | Giữ (hộp nhập vẫn chứa `KbktSettings`) |
| `board-kanban:61-77` | `.bd-filters .tf-add`; tên facet đúng `["Loại","Epic","Nhãn","Ưu tiên","Phiên bản"]` | E2 | Thêm các facet chung mới (Người, Thành phần, Sprint…). Vẫn không có "Trạng thái" |
| `phase1:279-290` | panel lọc Bảng không có "Trạng thái"; `.bd-search`; `.bd-empty .primary` "Xoá lọc" | E2 | Giữ class; vẫn đúng |
| `stage3:131-139` | `.bd-quick-filter` đúng 2, bấm "Chỉ lỗi" thì lọc thẻ | E2 | Mở panel "Bộ lọc" trước; mục bộ lọc nhanh vẫn mang class `.bd-quick-filter` |
| `stage3:186-192` | Backlog: "Phiên bản" → "1.0" → có `.tf-chip` → `.tf-clear` | E1 | Vẫn đúng (chip giờ là của bộ lọc chung) |
| `chat-assistant:96-118` | sau `set_view_filter`, Gantt "2/9"; chuyển Bảng thì đúng 2 thẻ | E1 | Vẫn phải qua mà không sửa |
| `phase1:308-318` | `.pr-filters`: `.pr-filter` "Người phụ trách" `select`; "Đặt lại" | E1 | Nếu Nhịp đổi ô chọn thành chip thì sửa phép thử. Cách ít rủi ro: **giữ `select`** đêm nay, chỉ thêm việc lấy mặc định từ `TaskFilter` |
| `phase1:320-322` | `.pr-tile` "Sắp đến hạn" đúng 1 | A10 | Mock có việc hạn trong 7 ngày (DEMO-5/6/7) nên ô không bằng 0. Kiểm lại sau khi ẩn ô bằng 0 |
| `stage3:230-233` | `.pr-header-tools` có nút tên **đúng** "In" | H8 | Đổi sang icon thì giữ `aria-label="In"` |
| `sla.e2e:108-118` | ô "Trễ SLA" = 1, mở ngăn kéo DEMO-3 | A10 | Vẫn đúng |
| `redesign:41-47` | `.today-section` "Chưa xếp lịch"; dòng đầu mở chi tiết | H2 | Giữ tiêu đề. Bấm vào dòng vẫn mở chi tiết; nút "Xếp lịch" phải `stopPropagation` |
| `stage3:112-128` | Giờ làm: `.ts-person-btn` → `.ts-entries` → `.ts-entry-edit` → hộp "Sửa giờ đã ghi" | F5 | Giữ đường này (ô đã có giờ vẫn mở danh sách). Thêm e2e mới cho gõ thẳng vào ô |
| `phase1:334-348` | `.ts-person-filter`, `.ts-person-btn`, `.att-remove` → `.modal-confirm` "Huỷ"; CSV | F5, B3 | Chỉ đổi cách mở (`openTimesheet`) |

### 12.3. e2e mới cần viết

| File | Kiểm |
|---|---|
| `e2e/layers.e2e.mjs` | A1–A4: Esc đóng `Ctrl P`; phím không lọt qua lớp; tờ ghi giờ đóng bằng Esc; bấm Trợ lý khi tờ mở; `Ctrl K` "nháp" → lệnh đứng đầu; `Shift D` sau khi kéo thanh |
| `e2e/plan-scheduling.e2e.mjs` | C1: kéo trên dòng DEMO-9 → PATCH `startDate`/`durationDays` đúng → `Ctrl Z`. C4: `F2` sửa tên, `Tab`, `DateField` trong ô. D1: mở chi tiết ở 1440 thì `.gantt-body` hẹp lại (không bị che), đóng thì rộng lại. D2: đổi Kết thúc → thời lượng đổi |
| `e2e/shared-filter.e2e.mjs` | E1: "Của tôi" ở Kế hoạch → `2` → Bảng đang lọc; `Shift F` xoá ở cả hai; reload vẫn giữ |
| `e2e/assign-hints.e2e.mjs` | 0-3, F1: "Gán…" hiện "rảnh"/"trùng n ngày" theo khoảng của việc; gán người trùng → toast có Hoàn tác (F10) |
| `e2e/timesheet-inline.e2e.mjs` | F5: gõ "2" vào ô hôm nay của mình → chọn việc → POST worklog đúng `hours`, `started`; dòng người khác không nhận gõ |
| `e2e/settings-page.e2e.mjs` | B4: `G S` mở trang; ba mục; người không có quyền thấy dạng chỉ đọc |

---

## 13. Kiểm tra cuối và tài liệu

### 13.1. Chạy app với API giả lập

```bash
cd e2e && MOCK_PORT=4100 node --import tsx mock-api.mts            # API giả lập
cd client && VITE_PROXY_TARGET=http://localhost:4100 node node_modules/vite/bin/vite.js --port 5180 --strictPort
# Ảnh: E2E_APP=http://localhost:5180/ E2E_API=http://localhost:4100 node e2e/shots.mjs e2e/shots/sau
# Dự án lớn: curl -X POST localhost:4100/api/__tasks/generate -H 'content-type: application/json' -d '{"n":400}'
#            nhớ POST /api/__restore sau đó
```

### 13.2. Danh sách kiểm tra bằng tay (đi một vòng, 1440 sáng rồi 1280 tối)

1. Hôm nay → `C` tạo việc bằng câu → việc mới hiện trong "Sắp tới".
2. `1` → kéo trên dòng chưa có ngày để vẽ thanh → `Ctrl Z`.
3. Chọn dòng → `F2` sửa tên → `Tab` sang Bắt đầu → gõ "t6" → `Enter`.
4. Nhấp đúp dòng → khung chi tiết **đẩy** Gantt → đổi Kết thúc → thanh co giãn theo → `Esc` (lưu).
5. Chọn việc cha bằng gõ "giai" trong `TaskPicker`.
6. Bật "Của tôi" ở Kế hoạch → `2` → Bảng cũng đang lọc "Của tôi" → `Shift F` xoá → cả hai sạch.
7. `3` → bấm "Gán…" trên việc chưa gán → thấy "rảnh"/"trùng n ngày" → gán người trùng → toast có Hoàn tác.
8. Nhân lực → Giờ đã ghi → gõ "2" vào ô hôm nay của mình → chọn việc → `Enter`.
9. `G S` → Cài đặt → Lịch làm việc → thêm ngày lễ → Lưu → SLA thấy lịch mới.
10. `Ctrl P` → `Esc` đóng. `Ctrl K` → "nháp" → dòng đầu là lệnh.
11. `4` → không có khung AI trống. Không có số 0.
12. Lặp 2–4 ở dự án 400 việc: cuộn mượt, dòng và thanh thẳng hàng.

### 13.3. Tài liệu phải cập nhật

- `CLAUDE.md` (số dòng lúc lập kế hoạch: rail và lăng kính `:406`, Hôm nay/Nhịp `:410`, khung chi tiết `:412`, ô ngày gốc `:414`, cột WBS `:416`, nhấp đúp `:422`, việc không ngày `:426`):
  - "The shell is a rail…": rail mới, Nhân lực ba chế độ, trang Cài đặt, `?view=settings`, `?view=timesheet` ánh xạ.
  - "Task detail is a peek panel…": đẩy chứ không che, một cột, `⋯`, Kết thúc sửa được.
  - "Filters, bulk actions and CSV": Bảng đọc `TaskFilter`, chỉ "Bị chặn" và bộ lọc nhanh Jira là riêng.
  - "Resource view": `PersonPicker`/`assignHints` mirror quy tắc `autoAssign` (ghi rõ "change both").
  - Câu "Native date inputs remain only where e2e fills them directly": xoá (A8 đã đổi hết).
  - Thêm một đoạn về `layers.ts` (mọi lớp phủ đăng ký; Esc chỉ đóng lớp trên cùng).
- `MASTER.md`: §2 (rail mới, trang Cài đặt), §3 thêm `Avatar`, `TaskPicker`, `PersonPicker`, `TimeInput`, §2.6 mô hình lưu, bảng định dạng ngày (0-5).
- File này: điền cột "Trạng thái" ở §15.2.

---

## 14. Không làm đêm nay

| Việc | Lý do |
|---|---|
| Hôm nay đa dự án | Cần tìm `assignee = currentUser()` trên nhiều dự án, tốn quota Jira chung của app (bản 06/11, Q3) |
| Hộp thư (thông báo) | Chưa có nguồn dữ liệu |
| Thay `gantt-task-react` bằng lớp vẽ riêng | Ước tính 2 tuần (bản 06/11, Q5). C1 và C4 làm trên thư viện hiện tại. Nếu C1 đòi vá thêm thư viện thì dùng phương án dự phòng |
| Gantt/cascade tính theo ngày làm việc | Đụng mọi cạnh phụ thuộc và quy tắc thời lượng ↔ hạn (CLAUDE.md, "Working calendar · Not done") |
| Lưu tự động từng ô trong khung chi tiết | Giữ "đóng là lưu" (an toàn với cascade, quyết định 06/11) |
| Gợi ý cân tải tự động (đề xuất chuyển việc giữa người) | F1/F2/F10 cho người quyết đủ thông tin. Tự đề xuất là việc của trợ lý |
| Mọi thay đổi phía server | Đêm nay chỉ client. `assignHints` tính ở client từ dữ liệu đã có |

---

## 15. Phụ lục: bằng chứng

### 15.1. Ảnh

Tất cả ở `.playwright-mcp/` (API giả lập, Chrome, 1440×900 trừ khi ghi khác):

| Ảnh | Nội dung |
|---|---|
| ux-01-landing | Hôm nay, dự án 9 việc |
| ux-02-plan, ux-03-select | Kế hoạch, thanh công cụ hai hàng; chọn một dòng hiện thanh hàng loạt |
| ux-04-peek | Khung chi tiết che hết vùng thời gian |
| ux-06-create-typed | Tạo bằng câu (đang tốt) |
| ux-07-gs | `G S` mở Cài đặt SLA: `mm/dd/yyyy`, AM/PM, nhiều đoạn giải thích |
| ux-08-board | Bảng: đầu sprint cao, "Của tôi" và "Việc của tôi", nút AI tím |
| ux-09-resource, ux-20…23 | Nhân lực: "Gán…" chỉ có tên, dòng việc bị cắt tên, "4n"/"16h", hồ sơ `mm/dd/yyyy` và "hiệu suất" |
| ux-10-pulse | Nhịp: một ý ba lần, ô số 0, khung AI trống chiếm 30% |
| ux-11-timesheet | Giờ làm ở rail, không lăng kính nào được gạch chân |
| ux-12-undated, ux-13-plan-1280 | Việc chưa có ngày chỉ có trong menu; 1280 |
| ux-30-backlog | 🎯, ✎, "Lập kế hoạch bằng AI" tím |
| ux-31-cmdk | Ô lệnh |
| ux-32-ctrlp, ux-33-createform | `Ctrl P` không đóng bằng Esc, biểu mẫu tạo mở chồng bên dưới |
| ux-40-loghours, ux-41-chat | Tờ ghi giờ ngõ cụt, không đóng bằng Esc; trợ lý đè dải ghi giờ |
| ux-42-dark | Chế độ tối (ổn) |
| ux-43-1024 | 1024px: vùng thời gian còn khoảng 390px |
| ux-50…54 | Dự án 400 việc: hôm nay sát mép phải, mọi người "85 ngày" quá tải, "Sắp tới" nhóm theo bắt đầu nhưng ghi hạn |
| ux-60-dragging | Tooltip khi kéo thanh (đang tốt) |
| ux-63-draft2 | Bản nháp đẩy thanh lọc xuống; toast giải thích; `Ctrl K` "nháp" mở DEMO-6 |

### 15.2. Bảng theo dõi

| Mục | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| 0-1 … 0-5 | ✅ | đợt 0 | `Avatar`, `TaskPicker`, `PersonPicker` + `assignHints`, `TimeInput`, `dateLabels`; mỗi cái có test |
| 0-6 | ✅ | đợt 0 | `layers.ts`, `useLayer`. Đã đăng ký: hộp chọn dự án, ô lệnh, bảng phím tắt, `Dialog`, tờ ghi giờ, hồ sơ nhân lực, khung chi tiết. **Không đăng ký** trợ lý (`ChatDock`) và thẻ "chưa gán": cả hai không phải modal, đăng ký sẽ chặn phím `1–4` khi chúng mở |
| A1 … A4 | ✅ | đợt A | `layers.e2e.mjs`. A4 do vòng `Gantt` của thư viện gọi `preventDefault` cho mọi phím: nghe phím ở pha capture |
| A5 … A7 | ✅ | đợt A | A7 mới đổi chuỗi trong `CreateTaskModal`, `TaskEditModal`, `GanttView`, `PlanReviewModal`; còn ~70 chỗ "công việc" khác (e2e đang so khớp), để một lượt riêng |
| A8, A9 | ✅ | đợt A | `DateField` / `TimeInput` thay ô gốc, e2e sửa theo (`fillDate`) |
| A10 … A15 | ✅ | đợt A | |
| B1 … B3, B5, B6 | ✅ | đợt B | rail 56px; Nhân lực ba chế độ; huy hiệu 2 tuần tới; hộp chọn dự án |
| B4 | ✅ (thiếu mục Board) | đợt B | `ProjectSettings`: Lịch làm việc, SLA, Nhập KBKT. Mục "Board" (tuỳ chọn thẻ) chưa chuyển vì nó là state theo từng board trong `BoardView` |
| C1 | ✅ | | thanh vô hình + `UnscheduledLayer`; `plan-scheduling.e2e.mjs` |
| C2, C3 | ✅ | | kiểm bằng ảnh 1280/1500 |
| C4 | ✅ | | `WbsCellEditor`, `wbsCells.ts`; cần `onUpdate` ở `ProjectWorkspace` (đã nối) |
| C5 | ✅ | | gợi ý chấm nối, toast Hoàn tác, cột "Phụ thuộc" |
| C6 | ✅ | | bỏ toast bật nháp |
| C7 | ✅ | | nhãn ngoài thanh cắt 240px. Lỗi hiệu năng ban đầu (đo lại mọi nhãn ở mọi lần cuộn) đã sửa |
| D1 … D4 | ✅ | | khung chi tiết một cột, đẩy chứ không che từ 1200px; `scheduleFields.ts`, `predecessorsText.ts` |
| E1, E2 | ✅ | | `boardFilter.ts`; `shared-filter.e2e.mjs`. Nhịp dự án vẫn giữ các `select` (đã đọc mặc định từ bộ lọc chung) |
| F1 … F10 | ✅ | | F5 `timesheet-inline.e2e.mjs`; F1/F10 `assign-hints.e2e.mjs` |
| G1 … G9 | ✅ | | |
| e2e mới (§12.3) | ✅ trừ một | | có: `layers`, `plan-scheduling`, `shared-filter`, `assign-hints`, `timesheet-inline`, `settings-page`. Thay `task-detail-layout` bằng các bước trong `task-detail-polish`/`transition-fields` đã sửa; chưa viết `pulse-today.e2e.mjs` (H2/H3/H6 có test thuần ở `projectPulse.test.ts`, `today.test.ts`) |
| H1 … H15 | ✅ | | H13: trợ lý đẩy nội dung bằng `padding-right: var(--chat-w)` (vẫn là khung nổi, chưa thành tờ bên như khung chi tiết) |
