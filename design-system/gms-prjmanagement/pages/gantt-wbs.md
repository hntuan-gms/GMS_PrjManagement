# Trang Gantt / WBS — ghi đè so với MASTER.md

> Chỉ ghi chỗ khác `MASTER.md`. Còn lại theo Master.
> Code: `client/src/components/GanttView.tsx`, `FilterBar.tsx`, `Toolbar.tsx`, `ProjectWorkspace.tsx`.

**Loại trang:** dữ liệu dày (bảng WBS + biểu đồ). Mật độ cao nhất của app.

## Bố cục

- **Header** (36px): huy hiệu dự án là bộ chuyển dự án; tab gạch chân; "Đồng bộ từ Jira" ghost; "Task mới" là nút solid duy nhất; menu avatar chứa tên và "Đăng xuất".
- **Toolbar** một hàng 48px, điều khiển 32px.
  - Trái: tìm kiếm (có công tắc JQL bên trong), bộ lọc đã lưu, "Của tôi", "Quá hạn", "Chưa có ngày (n)", một panel "Bộ lọc" với mục thu gọn cho từng facet.
  - Phải: Ngày/Tuần/Tháng (segmented), "Hôm nay", hoàn tác / thu gọn / mở rộng (icon), "Hiển thị", "Nhập / Xuất", `?`.
  - Bộ lọc đang bật là chip xoá được ở hàng thứ hai, **hàng này chỉ tồn tại khi đang lọc**.
- **Bảng WBS** bắt đầu với: loại, trạng thái, ưu tiên, phụ trách, %. Cột khác tick thêm trong "Hiển thị".
- **Thanh chia** bảng/biểu đồ nằm ở mức vừa đủ cho các cột và một tên đọc được, **nhớ vị trí người dùng đã kéo** (`gms.gantt.listWidth`).
- **Thanh thao tác hàng loạt**: `position: fixed` ở đáy cửa sổ. Không bao giờ chiếm chỗ trong luồng và không che toolbar.

## Quy tắc riêng

- Chữ trong hàng WBS `user-select: none` (Shift+bấm chọn dải, bôi xanh chữ đè lên là sai).
- Bấm đôi một hàng phải mở chi tiết: component danh sách phải có định danh cố định (module-level) và không gì được đổi bố cục khi chọn.
- Danh sách trạng thái đổi hàng loạt chỉ liệt kê bước mà quy trình cho phép, kèm "n/m"; bước cần nhập thêm ghi rõ "Cần nhập: …".
- Màu thanh Gantt không thuộc token UI (băm id → hue cố định); Bug luôn đỏ.

## Kiểm tra

- 1280px và 1500px: toolbar không tràn, không chồng, popover không bị cắt.
- `e2e/header-toolbar.e2e.mjs` (bố cục), `e2e/wbs-dblclick.e2e.mjs` (bấm đôi), `e2e/gantt-scroll.e2e.mjs` (cuộn, hiệu năng).
