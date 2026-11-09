# Design System Master — GMS · "Giấy & Son"

> **Cách dùng:** khi làm một màn hình, đọc file này trước, rồi xem `pages/<tên-trang>.md`.
> Nếu file trang tồn tại, luật trong đó **ghi đè** file này.
>
> **Nguồn sự thật cho giá trị là code**, không phải file này:
> [client/src/design/tokens.css](../../client/src/design/tokens.css) (token, chế độ tối, mật độ, chuyển động),
> [controls.css](../../client/src/design/controls.css) (ô nhập, hộp thoại),
> [shell.css](../../client/src/design/shell.css) (thanh bên, header, ô lệnh, toast),
> [plan.css](../../client/src/design/plan.css), [peek.css](../../client/src/design/peek.css),
> [today.css](../../client/src/design/today.css), [views.css](../../client/src/design/views.css).
> Khi file này và code lệch nhau, sửa file này theo code.
>
> Vì sao giao diện như thế này: [docs/plans/2026-11-06-tai-thiet-giao-dien.md](../../docs/plans/2026-11-06-tai-thiet-giao-dien.md).

**Ý tưởng:** *giấy* (nền ấm), *mực* (chữ và nút chính), và một màu chữ ký *son* (đỏ cam) chỉ cho "bây giờ" và "của tôi". Khung lùi lại, dữ liệu dẫn đầu. Màu là **tín hiệu**, hiếm và có nghĩa.

**Ngôn ngữ giao diện:** tiếng Việt. Chuỗi mới phải là tiếng Việt.

---

## 1. Token: ba tầng

```
Primitive  --paper --sheet --raised --sunken --line --ink --ink-2..4 --son --info --ok --warn --risk --ai
   ↓
Semantic   --color-bg --color-surface --color-border --color-text-* --color-primary --color-danger …
   ↓
Component  --control-* --menu-* --dialog-*
```

- **Chỉ `tokens.css` được viết mã màu.** `client/test/noRawColors.test.ts` hỏng nếu có `#hex` trong CSS khác hoặc chuỗi `"#fff"` trong TS/TSX (ngoại lệ duy nhất: `theme.ts` cho `<meta name="theme-color">`).
- SVG không đọc được `var()` trong thuộc tính (`fill=`): dùng `themeColors.readPalette()` (đọc token lúc chạy, đổi theo chế độ tối).

### Màu

| Vai trò | Token | Ghi chú |
|---|---|---|
| Nền ứng dụng / mặt làm việc / lớp nổi / vùng trũng | `--paper` / `--sheet` / `--raised` / `--sunken` | Phân tầng bằng độ sáng, không bằng bóng |
| Đường kẻ | `--line`, `--line-strong`, `--line-stronger` | Dùng ít. Không kẻ dọc giữa cột bảng |
| Chữ | `--ink` · `--ink-2` · `--ink-3` (nhạt nhất cho chữ, ≥4.8:1) · `--ink-4` (**chỉ** icon/đường) | |
| Nút chính | `--color-primary` = **mực** | Không có nút xanh dương |
| "Bây giờ / của tôi" | `--son` | Vạch hôm nay, chấm chưa đọc, dấu "đang ở đây" trên thanh bên, chấm trong logo. **Không** dùng cho nút hay lỗi |
| Đang chọn / focus | `--info-wash` + viền trái 2px `--info` / vòng `--control-ring` | |
| Trạng thái | `--st-todo` ○ · `--st-doing` ◑ · `--st-done` ●✓ | Qua `StatusGlyph`, không phải viên màu |
| Nguy cơ | `--risk` (+ `-wash`, `-text`) | Quá hạn, quá tải, vi phạm. **Luôn** kèm icon, chữ hoặc gạch chéo |
| Cảnh báo | `--warn` (+ `-text` cho chữ) | Sắp hạn, thiếu dữ liệu. **Không** dùng cho tin tốt |
| AI | `--ai` (+ `-wash`, `-text`) | **Chỉ** nhãn chữ "AI" nhỏ (`.ai-tag`, `.ai-spark`). Không gradient, không ✦ |

Mỗi họ tín hiệu có 5 bậc: `-wash` (nền) · `-soft` · `-line` (viền) · màu đặc · `-text` (chữ đạt AA trên `-wash`).

**Chế độ tối:** `:root[data-theme="dark"]` đổi giá trị tầng primitive; mọi thứ khác đi theo. Script trong `index.html` đặt `data-theme` trước lần vẽ đầu (không nháy trắng). Lựa chọn Sáng / Tối / Theo máy ở menu avatar và `Ctrl K`, lưu `gms.theme` (`theme.ts`).

**Thanh Gantt:** không băm id ra màu. "Hiển thị › Tô màu thanh theo": Trạng thái (mặc định) · Người · Epic · Không (`ganttMapping.barStyles`). Quá hạn luôn là `--risk`. Epic có con là một **ngoặc** (`TimelineMarkers`), không phải thanh đặc.

### Chữ

- **Be Vietnam Pro** (`--font-sans`) cho mọi chữ: dấu vẽ cho tiếng Việt từ đầu. Tự host qua `@fontsource` (400/500/600/700).
- **JetBrains Mono** (`--font-mono`) cho mã issue, %, giờ, ngày trong lưới, con số lớn: **Be Vietnam Pro không có số đều độ rộng** (đã đo: `tnum` không đổi gì).
- Cỡ: `--font-size-xs` 11 · `sm` 12 · `md` 13 (mặc định) · `lg` 14 · `lead` 15 · `title` 18 · `page` 20 · `display` 30.
- **Không viết hoa** tiêu đề nhóm (chữ hoa có dấu chồng ở 11px khó đọc). Nhãn nhóm là `12px`, `--ink-3`, viết thường.
- Đã kiểm tra: chữ hoa có dấu chồng (Ấ Ặ Ỗ Ữ) không bị cắt trong dòng 28px.

### Khoảng cách, bo góc, bóng, mật độ

- Lưới 4px: `--space-1…7` = 4/8/12/16/24/32/48.
- Bo góc **nhỏ**: `sm` 4 · `md` 6 (nút, ô) · `lg` 10 (menu, thẻ) · `xl` 12 (cửa sổ). Góc con không lớn hơn góc cha.
- Bóng chỉ cho lớp nổi (`--shadow-lg`, `--shadow-modal`). Thẻ Kanban, nút, ô nhập: **không bóng**.
- Mật độ dòng (`html[data-density]`, `--row-h`): Gọn 28 · Vừa 32 (mặc định) · Thoáng 40. `GanttView` đọc cùng số qua `theme.ROW_HEIGHTS`.

### Chuyển động

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--d-0` | 0 | Thao tác bằng phím, lặp lại nhiều (mở `Ctrl K`, `j/k`, đổi lăng kính bằng số) |
| `--d-1` | 90ms | Hover, nhấn (`scale(.98)`), bật/tắt |
| `--d-2` | 150ms | Menu, popover, chip, thanh chọn |
| `--d-3` | 220ms | Khung chi tiết, toast, tờ bên |
| `--d-4` | 320ms | Thay đổi lớn |
| `--e-out` / `--e-move` / `--e-in` | `(.23,1,.32,1)` / `(.2,0,0,1)` / `(.3,0,.8,.15)` | Vào / đổi chỗ / ra |

- Chỉ animate `transform`, `opacity` (và nền/viền/chữ khi hover). **Không `transition: all`.**
- `prefers-reduced-motion`: token rút về ≤ 90ms, các `animation` tắt.
- Không phụ thuộc `transitionend` để trạng thái đúng.

---

## 2. Khung ứng dụng

- **Thanh bên** (`.app-rail`, 56px, cố định trái, icon kèm nhãn 10px): logo (về Hôm nay) · Tạo việc · Hôm nay · Dự án · … · Trợ lý · avatar (Giao diện, Mật độ, Phím tắt `?`, Đăng xuất). Rail là của tôi, header là của dự án; một hành động chỉ có một nút (không còn nút Tìm, Giờ làm ở rail). Tooltip ghi kèm phím, hiện sau 400ms. Mục đang ở có dấu son ở mép.
- **Hai tầng, mỗi tầng một việc.** Rail chọn **nơi** (Hôm nay, Dự án, và sau này mỗi phần tích hợp thêm là một nút nằm sau Dự án); hàng lăng kính trên header là **các góc nhìn bên trong Dự án** và chỉ hiện khi đang ở một lăng kính. Ở Hôm nay không có lăng kính nào (không còn bốn chữ mà không chữ nào sáng). Trang Cài đặt dự án thuộc dự án: Dự án vẫn sáng trên rail, header không vẽ lăng kính. Nút Dự án mở lại lăng kính vừa dùng; phím 1–4 đi thẳng tới lăng kính từ bất cứ đâu.
- **Header** (`.toolbar`, 44px): tên dự án (menu: Đổi dự án `Ctrl P`, Cài đặt dự án `G S`) · bốn **lăng kính** chữ `Kế hoạch 1 · Bảng 2 · Nhân lực 3 · Nhịp dự án 4` (gạch mực dưới lăng kính hiện tại) · **chỉ báo đồng bộ** (`● Khớp Jira` / `Đang đọc Jira…` / `Jira đang giới hạn · n phút`; bấm = đọc lại) · nút giả ô tìm `Ctrl K`. **Không có nút đặc nào trong header.**
- **Thanh lọc** (`.tf-bar`, 40px, điều khiển 28px): dùng chung cho Kế hoạch và Nhân lực. Bộ lọc đang bật là nền mực.
- **Trang mặc định** là Hôm nay; sau đó nhớ lăng kính cuối theo dự án (`gms.view.<site>.<project>`). `?view=gantt|board|resource|report|settings|today` mở thẳng; `timesheet` là bí danh của Nhân lực · Giờ đã ghi.
- **Nhân lực có ba chế độ**: Mức tải · Giờ đã ghi · Kỹ năng. Người không được xem danh sách thành viên chỉ có "Giờ đã ghi". **Giờ đã ghi** có hai mặt: *Của tôi* (lưới việc × ngày, mỗi ô là một ô nhập: gõ `4`, `1,5`, `2h30`, Enter xuống dòng dưới, xoá ô là xoá giờ kèm "Hoàn tác") và *Cả nhóm* (chỉ đọc, bạn đứng đầu, rồi người thiếu nhiều ngày nhất). Ô tô đậm theo phần của một ngày, chỉ vượt công suất mới ấm màu.
- **Cài đặt dự án** (`ProjectSettings`): một trang, menu trái (Lịch làm việc, SLA, Nhập KBKT, Thẻ trên board), mỗi mục có nút Lưu ở chân, chỉ bật khi có thay đổi.
- **Mô hình lưu**: chi tiết việc lưu **từng trường** khi người dùng xong với nó (rời ô, Enter; Esc trả giá trị cũ), không có nút Lưu và không có "Chưa lưu"; góc trên có "Đang lưu…" / "Đã lưu". Tờ bên (hồ sơ nhân lực, tờ ghi giờ) đóng là lưu. Hộp thoại có hậu quả (xoá, hoàn thành sprint): nút rõ ràng, Esc = huỷ không hỏi. Trang Cài đặt: Lưu ở chân mục.
- **Lớp phủ** đăng ký ở `layers.ts` (`useLayer`): Esc đóng lớp trên cùng, phím tắt đứng yên phía sau.

## 3. Thành phần

- **Logo** (`BrandMark`): ô mực bo 8/32, chữ G màu giấy, gạch ngang của G là một dòng thời gian với chấm son ở "bây giờ". Chế độ tối tự đảo mực/giấy qua token. Cùng một hình ở ba chỗ, sửa cả ba: `components/BrandMark.tsx`, `public/favicon.svg`, màn chào trong `index.html`.
- **Màn chào** (`index.html` + `splash.ts`): vẽ từ byte đầu tiên (trước JS và font), không bao giờ giữ lại để trình diễn. Lần mở đầu trong tab: logo được vẽ (~0,6 s) rồi bay vào ô logo trên thanh bên; các lần tải lại: chỉ hiện nếu tải lâu hơn một cái chớp mắt. Giảm chuyển động: không hiệu ứng.

- **Ô lệnh** (`CommandBar`, `Ctrl K`): lệnh (kèm phím), tìm việc không dấu, tạo việc bằng câu (`quickAdd.ts`: `@người`, ngày, `3n`, `4h`, `!cao`, `^DEMO-2`, `sau DEMO-5`, `#nhãn`, `/bug`), hỏi trợ lý (`Tab`). Mở không hiệu ứng. Phím `C` mở thẳng chế độ Tạo.
- **Phím tắt**: một danh sách duy nhất trong `shortcuts.ts`; bảng `?` đọc từ đó. Phím chữ không chạy khi đang gõ hoặc có lớp nào mở.
- **Toast** (`toast()` + `Toaster`): góc dưới trái, nền mực, 5 giây, dừng khi rê chuột, có "Hoàn tác"/"Mở". Lỗi ghi Jira là toast đỏ, không phải dải chèn đẩy bảng xuống.
- **Chi tiết việc** (`TaskEditModal`, `design/detail.css`): một **lớp nổi giữa màn hình** trên nền mờ (z 48, dưới menu và bộ chọn), không đẩy kế hoạch sang bên. Rộng nhất có thể (tới 1320px) để khỏi cuộn, chia **hai khung riêng, mỗi khung cuộn riêng**: trái là việc này là gì (tên, mô tả, Liên quan, bình luận), phải là nó đang ở đâu (trạng thái · người · ưu tiên, lịch, thẻ "Chi tiết"). Dưới 900px một cột, khung phải lên trước. Esc, ×, bấm nền mờ: đóng; mở việc khác: đóng cái cũ.
  - **Giá trị là chữ cho tới khi bấm**: không vẽ ô nhập khi nghỉ; rê chuột thì nền dịu lại, bấm thì thành ô đúng chỗ, đúng cỡ (không làm lệch gì xung quanh). Rời ô hoặc Enter lưu, Esc trả giá trị cũ và **chỉ** thoát ô, không đóng khung. Mô tả đọc như một trang (đoạn, danh sách, liên kết bấm được) và chỉ thành ô sửa khi bấm vào chữ.
  - Mỗi trường là một yêu cầu riêng, hiện ngay trên kế hoạch (cập nhật lạc quan ở workspace, `taskPatch.ts`); Jira từ chối thì giá trị cũ trở lại và lý do là một toast. Chuyển trạng thái cần ô nhập (RootCause…) thì các ô hiện ngay dưới hàng trạng thái, kèm nút "Chuyển sang …".
  - Tệp và liên kết đính kèm lên Jira ngay khi thêm.
- **Người**: `Avatar` (chữ tắt = chữ đầu của từ cuối + chữ đầu của từ đầu: "Nguyễn Anh" → AN), một cách vẽ ở mọi màn. Chọn người: `PersonPicker` (kèm rảnh / trùng n ngày trong khoảng của việc). Chọn một việc bằng tìm kiếm: `TaskPicker`. Giờ trong ngày: `TimeInput` (HH:mm, 24h).
- **Cách viết ngày** (`dateLabels.ts`): tháng `Tháng 10/2026` · `T10/26` · `T10`; cột tuần là ngày đầu tuần `02/11`; khoảng `02/11 – 08/11/2026`; ngày đơn trong câu `16/9` (khác năm: `16/9/2027`). Không còn "W44".
- **Ô ngày**: dùng `DateField` (luôn DD/MM/YYYY, nhận "t6", "mai", "+3n", "15/11"). Không dùng `<input type="date">` trần cho ngày người dùng đọc lại (nó hiện theo ngôn ngữ trình duyệt: "10/29/2026").
- **Trạng thái**: `StatusGlyph` + tên workflow mờ. **Ưu tiên**: `PriorityMark` (chỉ hiện cạnh tên khi cao/thấp). **Loại**: `IssueTypeIcon` nét mảnh; Bug/Sub Bug đỏ, Issue cam, Task/Sub-task xanh (`--type-*`), còn lại mực.
- **Ô nhập**: mặc định từ `controls.css` (`:where()`), cao 34px trong cửa sổ, 28–30px trên thanh. `<select>` dùng `appearance: base-select`. Không `<datalist>` (dùng `SuggestInput`). Không `window.confirm/prompt` (dùng `useDialogs()`).
- **Số liệu**: `Metric` (`components/Metric.tsx`): số lớn font sans 600, nhãn `--ink-3`, không viền, không icon, xếp một hàng (`MetricRow`); số 0 thì không vẽ. Dùng ở Nhịp dự án và Giờ đã ghi. Pill lọc người ở Mức tải vẫn là pill vì nó là bộ lọc.
- **Lọc nhanh**: "Của tôi", "Quá hạn" và công tắc riêng của từng màn là hàng công tắc ở đầu panel "Bộ lọc" (`FilterBar` `quick`), hiện thành chip khi bật. Thanh Kế hoạch: tìm · Bộ lọc · Đã lưu | Ngày/Tuần/Tháng · Về hôm nay | ↶ · `⋯` (nhóm, hiển thị, nhập/xuất, phím tắt).
- **Icon**: `Icons.tsx`, lưới 24, nét 1.75. Không emoji làm icon (kể cả 🎯, ✦).

### Thuật ngữ: một khái niệm, một tên

| Dùng | Bỏ |
|---|---|
| Người | Người phụ trách |
| Ưu tiên | Độ ưu tiên |
| Epic | Giai đoạn (Epic), Theo giai đoạn |
| Công suất | Năng lực (của một người hay nhóm: số giờ có thể làm) |
| Giờ đã ghi | Giờ làm |
| Sub-task | Việc con, Công việc con |
| Loại việc | Loại issue |
| việc | công việc (trừ "ngày làm việc", "Giờ làm việc", "Lịch làm việc": đó là khái niệm khác) |

`grep` các tên ở cột phải trong chuỗi JSX phải trống. Phần nhận dạng dữ liệu nhập (tiêu đề cột CSV, JQL) vẫn chấp nhận cả hai cách gọi.

## 4. Luật bố cục dày đặc

- **Không có thứ gì chiếm chỗ trong luồng khi chọn** (thanh thao tác hàng loạt `position: fixed`), vì nó làm bảng nhảy giữa hai lần bấm của một double-click.
- Mã issue không bao giờ bị cắt: cột Mã rộng theo mã dài nhất (`--wbs-key-w`).
- **Bảng WBS hẹp lại** (khung chi tiết hay trợ lý mở, kéo vách ngăn vào): cột Tên việc giữ tối thiểu 200px (`wbsFit.ts`). Cột phụ bỏ dần từ bên phải, rồi Người chỉ còn avatar, rồi Trạng thái chỉ còn glyph. Người và Trạng thái không bao giờ bị bỏ hẳn.
- Ô Nhân lực không có việc thì **trống** (không "0%"); tải là chiều cao cột, chỉ quá tải mới đỏ.
- Kiểm tra ở 1280px và 1500px; sáng và tối.

## 5. Điều cần tránh

- Mã màu ngoài `tokens.css`; gradient trang trí; tím/indigo ngoài nhãn AI; ✦.
- Nút đặc màu xanh; nhiều nút đặc trong một vùng; viền xám trên mọi nút phụ.
- Màu làm tín hiệu duy nhất; vàng cho tin tốt; chữ nhạt hơn `--ink-3`.
- Tiêu đề viết hoa toàn bộ; bóng đổ trên thẻ khi nghỉ; bo góc > 12px.
- `transition: all`; hiệu ứng trên thao tác bàn phím lặp lại; hover làm lệch bố cục.
- Cỡ chữ ngoài thang `--font-size-*` (không 12.5px, 10.5px…).

### Chờ dữ liệu: một vòng xoay, đủ rồi mới hiện, hiện một lần

Một màn hình không được điền dần từng mảnh (một ô, rồi một danh sách, rồi một con số): đó là cái giật. Chưa đủ thì **chỉ có `Spinner`**, đủ rồi mới hiện **cả vùng một lần**.

- **Cái đã có thì hiện ngay, không vòng xoay.** Đáp án đã giữ (`detailCache.ts`, `useDetail`) có ở khung hình đầu tiên và được đọc lại phía sau mà không đổi gì trên màn hình; vòng xoay chỉ có khi còn thiếu thứ gì để vẽ.
- **Vòng xoay** (`components/Spinner.tsx`): một vòng, không chữ (chỉ `aria-label`), chỉ hiện nếu chờ quá 120ms để đáp án nhanh không loé. `block` đặt nó giữa vùng đang chờ. Không "Đang tải…", không khung xương, không bản xem trước từng phần.
- **Chi tiết việc chờ đủ mười một thứ** (mô tả, bình luận, đính kèm, liên kết, bước chuyển trạng thái, người theo dõi, sáu danh sách của dự án) rồi mới hiện; trong lúc chờ chỉ có khung đúng cỡ cuối cùng, nút × và vòng xoay, nên lúc nội dung hiện ra khung không đổi kích thước. Một lần đọc lỗi cũng tính là xong (không chờ mãi). Đã hiện thì không quay lại chờ.
- **Tab Bảng, lần mở đầu của kế hoạch, Hôm nay, Cài đặt, danh sách dự án, danh sách thành viên** đều là một vòng xoay cho tới khi đủ.
- **Phần mới mở bằng nút "+"** (Phụ thuộc, Liên kết, Đính kèm) hiện đúng chỗ nút vừa bấm, mờ vào, không đẩy phần đã có: thứ tự các phần cố định lúc khung hiện ra rồi chỉ nối thêm, ô đầu tiên của phần mới được trỏ tới và phần đó được cuộn vào tầm nhìn.
- Khi dữ liệu về, **không được làm xô lệch** những gì đã nằm trên màn hình.

### Chữ trên màn hình: ít, ngắn, không giải thích

Giao diện không được trông như máy viết (đánh giá 2026-11-06: chữ thừa là dấu hiệu rõ nhất).

- Nhãn thay cho câu. Không có đoạn giải thích dưới công tắc, ô nhập hay màn trống; chi tiết, nếu cần, ở bảng `?` hoặc `title`.
- Không dấu gạch dài (—) trong chuỗi hiển thị; dùng dấu chấm, phẩy hoặc `·`. (`—` đứng một mình cho ô trống thì được.)
- Không song ngữ trong ngoặc ("Nhãn (labels)"), không "(hiện tại)". Số đếm bằng 0 thì ẩn.
- Không nói một ý hai lần trên cùng màn (tiêu đề, huy hiệu và thẻ cùng nói "chậm 34 ngày").
- Không ví dụ bịa (`DEMO-2` trong dự án GPM), không câu hỏi mẫu trong ngoặc kép ở màn trống của trợ lý.
- Tooltip là tên và phím tắt, không phải đoạn hướng dẫn.
- Không thẻ viền trái màu, không donut trang trí: con số là thứ được đọc, một thanh ngang là đủ.
- Văn do AI viết (Nhịp dự án) theo cùng luật: prompt cấm từ phóng đại và dấu gạch dài (`server/src/ai/report.ts`, quy tắc 8).

## 6. Checklist trước khi giao

- [ ] Không mã màu mới ngoài `tokens.css` (`npm test` có `noRawColors`)
- [ ] Đúng ở chế độ sáng **và** tối
- [ ] Mọi phần tử bấm được có hover 90ms và focus bàn phím; nút chỉ icon có `aria-label`
- [ ] Hành động mới có phím tắt (thêm vào `shortcuts.ts`) và/hoặc lệnh trong `Ctrl K`
- [ ] Ngày hiện DD/MM; số trong cột là mono
- [ ] `prefers-reduced-motion` được tôn trọng
- [ ] Chuỗi mới bằng tiếng Việt
- [ ] `cd client && npm test && npm run lint && npm run build`, và e2e liên quan (`header-toolbar.e2e.mjs` là hợp đồng của khung)
