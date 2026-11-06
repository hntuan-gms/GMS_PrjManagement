# Trang Kế hoạch (Gantt / WBS) — ghi đè so với MASTER.md

> Chỉ ghi chỗ khác `MASTER.md`. Còn lại theo Master.
> Code: `client/src/components/GanttView.tsx`, `FilterBar.tsx`, `ProjectWorkspace.tsx`, `TimelineMarkers.tsx`, `ganttMapping.ts`; CSS: `design/plan.css`.

**Loại trang:** dữ liệu dày (bảng WBS + biểu đồ). Mật độ cao nhất của app.

## Bố cục

- **Thanh lọc** một hàng 40px, điều khiển 28px.
  - Trái: tìm kiếm (công tắc JQL bên trong), bộ lọc đã lưu, "Của tôi" (`M`), "Quá hạn" (`O`), "Chưa có ngày (n)", "Bộ lọc".
  - Phải: Ngày/Tuần/Tháng, "Hôm nay" (`T`), hoàn tác / thu gọn / mở rộng (icon), "Hiển thị", "Nhập / Xuất", `?`.
  - Bộ lọc đang bật là chip ở hàng thứ hai, **hàng này chỉ tồn tại khi đang lọc**.
- **Bảng WBS** mặc định: Mã · Tên (icon loại, dấu ưu tiên nếu cao/thấp) · Trạng thái (`StatusGlyph` + tên) · Người (chữ cái đầu + tên) · %. Cột khác tick thêm trong "Hiển thị".
- **Cột Mã** rộng theo mã dài nhất (`--wbs-key-w`), chữ mono, không bao giờ "DEMO-10…".
- **Dòng** cao theo mật độ (28/32/40). Kẻ ngang mảnh, không sọc, không kẻ dọc. Dòng chọn: nền `--info-wash` + viền trái 2px.
- **"+ Thêm việc"** ngay dưới dòng cuối (khi danh sách không ảo hoá): gõ câu theo cú pháp tạo nhanh, `Enter` tạo; `Tab` trước khi `Enter` biến thành việc con của dòng đang chọn.
- **Thanh thao tác hàng loạt**: `position: fixed` ở đáy, không bao giờ chiếm chỗ trong luồng. Khi khung chi tiết đang mở, nó canh giữa phần kế hoạch còn lại.

## Biểu đồ

- Thanh: "Tô màu theo" Trạng thái (mặc định) / Người / Epic / Không. Chưa làm = `--line`, đang làm = `--info-soft` + phần xong `--info`, xong = `--ok-soft`, **quá hạn = `--risk-soft`** dù tô theo gì.
- Epic có con: không thanh đặc, chỉ nhãn + **ngoặc** `--ink-3` ở chân hàng.
- **Hôm nay**: vạch son 1.5px suốt chiều cao, chấm son ở đầu; cột hôm nay tô son 5% (tối 8%).
- Đường găng (khi bật): thanh trên đường găng nền `--son-wash`, phần xong `--son`; còn lại lùi về `--sunken`.
- Baseline: vạch dưới thanh; đúng kế hoạch thì gần như vô hình (12%), lệch thì rõ, trễ thì đỏ.
- Chữ thư viện (trục, nhãn ngoài thanh, tooltip) được phủ lại theo token trong `App.css` / `plan.css` (gắn với tên class đã biên dịch của `gantt-task-react@0.3.x`).

## Quy tắc riêng

- Chữ trong hàng WBS `user-select: none` (Shift+bấm chọn dải).
- Bấm đôi một hàng phải mở chi tiết: component danh sách phải có định danh cố định (module-level) và không gì được đổi bố cục khi chọn.
- Danh sách trạng thái đổi hàng loạt chỉ liệt kê bước mà quy trình cho phép, kèm "n/m".

## Kiểm tra

- 1280px và 1500px, sáng và tối: thanh lọc không tràn, popover không bị cắt.
- `e2e/header-toolbar.e2e.mjs` (khung + thanh lọc), `e2e/wbs-dblclick.e2e.mjs` (bấm đôi), `e2e/gantt-scroll.e2e.mjs` (cuộn, hiệu năng; dòng 32px).
