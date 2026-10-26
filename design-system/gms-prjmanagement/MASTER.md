# Design System Master — GMS PrjManagement

> **Cách dùng:** khi làm một màn hình, đọc file này trước, rồi xem `pages/<tên-trang>.md`.
> Nếu file trang tồn tại, luật trong đó **ghi đè** file này. Không có thì theo file này.
>
> **Nguồn sự thật cho giá trị là code**, không phải file này:
> [client/src/design/tokens.css](../../client/src/design/tokens.css) (token) và
> [client/src/design/controls.css](../../client/src/design/controls.css) (giao diện mặc định của input/select/textarea, hộp thoại).
> File này nói *vì sao* và *quy tắc*; khi hai nơi lệch nhau, sửa file này theo code.

**Loại sản phẩm:** công cụ nội bộ quản lý dự án (Gantt/WBS, bảng, chấm công, báo cáo) trên Jira Cloud.
**Mật độ:** dày (dashboard) — điều khiển 32px trong toolbar, 36px trong header.
**Chuyển động:** tối thiểu — chỉ chuyển trạng thái (hover, mở menu), 150–200ms.
**Ngôn ngữ giao diện:** tiếng Việt. Chuỗi mới phải là tiếng Việt.

> Bản gốc do `ui-ux-pro-max --design-system` sinh ra (teal + cam, Fira, mẫu landing page) đã bị bỏ:
> nó không khớp với một app đang chạy. Các luật chung của skill (checklist, điều cần tránh) được giữ ở cuối file.

---

## 1. Token: ba tầng

```
Primitive  (giá trị thô, không ý kiến)   --blue-600, --space-2, --radius-md
   ↓
Semantic   (giá trị để LÀM GÌ)           --color-primary, --color-border, --color-danger
   ↓
Component  (một loại control dùng nó)    --control-*, --menu-*, --dialog-*
```

- Chỉ `tokens.css` được viết màu hex, bán kính, bóng đổ, kích thước thô.
- `App.css` và component chỉ tham chiếu tầng semantic và component. Cần giá trị mới thì **thêm hoặc sửa token**, đừng viết hex vào luật.
- Đổi giao diện của mọi ô nhập = sửa `--control-*`; đổi mọi menu/popover/danh sách select = sửa `--menu-*`.

### Màu (semantic)

| Vai trò | Token | Giá trị |
|---|---|---|
| Nền trang | `--color-bg` | slate-50 |
| Mặt phẳng (card, panel) | `--color-surface` | trắng |
| Viền / viền hover | `--color-border` / `--color-border-hover` | slate-200 / 300 |
| Chữ chính / phụ / mờ | `--color-text-primary` / `-secondary` / `-muted` | slate-900 / 600 / 500 |
| Hành động chính | `--color-primary` (hover `-hover`, nền nhạt `-light`) | blue-600 / 700 / 50 |
| Focus | `--color-focus` | blue-500 |
| Nguy hiểm | `--color-danger` (+ `-light`, `-border`) | red-600 |
| Thành công | `--color-success` (+ `-light`, `-border`) | green-600 |
| Cảnh báo | `--color-warning` (+ `-light`, `-border`), chữ dùng `--color-warning-text` | amber |

- `--color-text-muted` (4.76:1 trên trắng) là chữ nhạt nhất còn đạt AA. Không dùng nhạt hơn cho chữ.
- `--color-warning` (3:1) chỉ làm viền/nền/icon, **chữ cảnh báo dùng `--color-warning-text`**.
- Không dùng màu làm tín hiệu duy nhất: trạng thái luôn có chữ hoặc icon đi kèm.
- Màu thanh Gantt là băm id → bảng sắc độ cố định (`PALETTE_HUES`), không thuộc token UI.

### Chữ

- Phông hệ thống: `-apple-system, "Segoe UI", Roboto, …` (không tải phông web — công cụ nội bộ, ưu tiên tải nhanh và tiếng Việt đủ dấu).
- Cỡ: `--font-size-xs` 11.5 · `sm` 12.5 (cỡ của ô nhập) · `md` 13 · `lg` 14 · `title` 17.
- Số/mã (issue key, thời lượng): `ui-monospace` chỉ khi cần thẳng cột.

### Khoảng cách, bo góc, bóng, lớp

- Khoảng cách theo `--space-1…5` (4/8/12/16/24). Mật độ dày: padding menu 4px, mục menu 7×10px.
- Bo góc: `sm` 6 (mục menu, nút nhỏ) · `md` 8 (ô nhập, panel) · `lg` 12 · `xl` 16 (hộp thoại).
- Bóng: `sm` cho nút nổi, `lg` cho menu/popover, `modal` cho cửa sổ/hộp thoại.
- Lớp chồng: popover < modal < dialog (`--z-popover`, `--z-modal`, `--z-dialog`). Không đặt z-index tuỳ ý.

---

## 2. Thành phần

### Ô nhập (input, select, textarea)

- Giao diện mặc định đến từ `controls.css`, viết trong `:where()` (độ ưu tiên 0). **Ô mới không cần class** để khớp với phần còn lại; component nào tự định kiểu thì thắng.
- Cao 32px trong toolbar (`--control-h`), 36px trong header (`--control-h-header`), **36px cho mọi ô một dòng trong cửa sổ/hộp thoại/`.field` (`--control-h-form`)** — ô chữ, ngày, số, select không được lệch nhau vài pixel; nút nằm cùng hàng với ô cũng cao bằng ô. Focus: viền `--control-border-focus` + vòng `--control-ring`, luôn nhìn thấy.
- Nhãn luôn hiện (không dùng placeholder thay nhãn); lỗi nằm cạnh ô, kèm gợi ý cách sửa.
- **`<select>` dùng `appearance: base-select`** (Chrome 135+) để danh sách mở ra là của app: cùng panel, hàng, dấu tick như mọi menu. Trình duyệt cũ rơi về danh sách của hệ điều hành nhưng ô đóng và mũi tên vẫn đúng. **Không gán `appearance` hay mũi tên riêng cho `<select>`.**
- **Không dùng `<datalist>`** (trình duyệt tự vẽ danh sách gợi ý, không tuỳ biến được): dùng `SuggestInput` (cùng panel `--menu-*`).
- Danh sách của select: dòng đang trỏ bằng bàn phím chỉ đổi màu nền, không có viền focus; chữ dài kết thúc bằng dấu `…`; thanh cuộn mảnh.
- Chỉ ô ngày là còn dùng bảng chọn ngày của trình duyệt (không tuỳ biến được; định dạng ngày theo ngôn ngữ trình duyệt).

### Nút

- Một nút **solid** duy nhất cho mỗi vùng (header: "Task mới"). Hành động phụ là ghost: không viền khi nghỉ, nền `--color-ghost-hover` khi hover, chỉ nút đang bật mới có nền nhấn.
- Nút chỉ có icon bắt buộc có `aria-label` (và `title`). Nút nguy hiểm: `danger-solid`, chỉ xuất hiện trong hộp thoại xác nhận.
- Mọi phần tử bấm được có `cursor: pointer` và trạng thái focus bàn phím.

### Menu / popover / hộp thoại

- Menu và popover dùng `Popover.tsx`: đóng khi bấm ra ngoài, Tab đi chỗ khác, Esc; `role="menu"` nhận phím mũi tên; luôn nằm trọn trong cửa sổ (không bị cắt).
- **Không dùng `window.confirm/prompt/alert`.** Dùng `useDialogs()` (`confirm`, `prompt`). Xác nhận phá huỷ tự focus vào "Huỷ".
- Esc ở trong popover/hộp thoại chỉ đóng chính nó, không lan lên xoá lựa chọn của Gantt.

### Icon

- Chỉ SVG, từ bộ `components/Icons.tsx` (một bộ nét thống nhất). Không emoji làm icon. Cần icon mới: thêm vào `Icons.tsx`, đừng nhúng SVG lẻ.

### Cửa sổ chi tiết công việc

- Hai cột dưới một header và trên một footer cố định: cột chính là *việc này là gì* (tiêu đề, mô tả, đính kèm, phụ thuộc, liên kết, bình luận); cột phải là *quản lý nó thế nào*, dùng nhiều nhất lên đầu (trạng thái, con người, lịch, công sức, phân loại).
- Hỏi trước khi đóng nếu có thay đổi chưa lưu; Ctrl+Enter lưu; Tab không thoát khỏi cửa sổ.

---

## 3. Luật bố cục dày đặc

- Toolbar một hàng, điều khiển 32px; chi tiết đẩy vào popover ("Bộ lọc", "Hiển thị", "Nhập / Xuất", `?`). Dưới 1400px các nút trong toolbar giữ icon, mất chữ.
- **Không có thứ gì chiếm chỗ trong luồng khi chọn** (thanh thao tác hàng loạt là `position: fixed`), vì nó làm bảng nhảy giữa hai lần bấm của một double-click.
- Chữ không bị cắt trong badge/chip; chip dài xuống dòng hoặc rút gọn có `title`.
- Kiểm tra ở 1280px và 1500px (màn hình làm việc thật). Mobile không phải mục tiêu của các màn hình Gantt/WBS.

---

## 4. Điều cần tránh

- Màu hex, bóng, bán kính viết thẳng vào `App.css`/component.
- `<select>` có `appearance` hoặc mũi tên riêng; hộp thoại của trình duyệt.
- Nhiều nút solid trong một vùng; viền xám trên mọi nút phụ ("box fever").
- Dùng màu làm tín hiệu duy nhất; chữ nhạt hơn `--color-text-muted`.
- Chuyển động tức thì (0ms) hoặc hover làm lệch bố cục (scale).
- Phụ thuộc `animationend`/`transitionend` để đảm bảo trạng thái đúng.
- z-index tuỳ ý ngoài thang `--z-*`.

---

## 5. Checklist trước khi giao một thay đổi giao diện

- [ ] Không emoji làm icon; icon từ `Icons.tsx`
- [ ] Mọi phần tử bấm được có `cursor: pointer`, hover mượt (150–200ms), focus bàn phím nhìn thấy
- [ ] Chữ ≥ 4.5:1 (dùng token, đừng tự chọn xám)
- [ ] Nút chỉ icon có `aria-label`
- [ ] Không hex/radius/shadow mới ngoài `tokens.css`
- [ ] Ô nhập mới khớp mặc định mà không cần class; `<select>` không tự đặt `appearance`
- [ ] Không `<datalist>`; mọi ô một dòng trong cửa sổ cao bằng nhau
- [ ] Không `window.confirm/prompt`
- [ ] Không bị cắt ở 1280px và 1500px; popover nằm trọn trong cửa sổ
- [ ] `prefers-reduced-motion` được tôn trọng
- [ ] Chuỗi mới bằng tiếng Việt
- [ ] Chạy `cd client && npm run lint && npm run build` và e2e liên quan (`e2e/header-toolbar.e2e.mjs` kiểm tra bố cục toolbar/header)
