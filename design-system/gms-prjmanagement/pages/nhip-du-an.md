# Nhịp dự án — luật riêng (ghi đè MASTER.md khi khác)

Trang trả lời ba câu, theo thứ tự từ trên xuống, và không gì khác chen vào giữa:

1. **Có kịp không?** Một câu nhận định (`pulseHeadline`), màu chỉ ở phần nhận định ("Chậm 22 điểm."), dự báo đứng cạnh bằng chữ thường ("Dự kiến xong 22/11, hạn 20/11."). Ngay dưới là **một** thanh: phần tô là việc đã xong, vạch dọc là nơi kế hoạch mong đến hôm nay. Con số đi kèm thanh được viết **một lần** ("Đã xong 17% · kế hoạch đến nay 39% · còn 14 ngày").
2. **Vì sao?** Nút chữ ở cuối dòng số liệu. Lý do không lặp lại điều một dòng "Cần bạn quyết" đã nói. SPI chỉ xuất hiện ở đây, kèm câu giải thích.
3. **Tôi cần làm gì?** "Cần bạn quyết · n": tối đa ba dòng, mỗi dòng kết thúc bằng hành động **làm được ngay** (Dời hạn, Giao lại, Giao cho X, Xem lịch, Chụp baseline). Không dùng "Mở" làm hành động chính.

Sau đó là hai bảng chữ (Epic, Người) và xu hướng.

## Số

- Phần trăm luôn là số nguyên (`pct`). Số thập phân viết dấu phẩy (`decimal`: "0,43").
- Mỗi cặp số chỉ nói một lần trên màn: không thẻ "Tiến độ", không nhãn cuối đường trên biểu đồ xu hướng.
- Ô bảng là chữ: "chậm 57 điểm · 1 quá hạn", "chưa tới lịch", "chưa có ngày", "xong". Không "43% / 100%", không huy hiệu "!1".
- "Tải 2 tuần tới" là cùng một phép tính với huy hiệu của Nhân lực (`nearLoad`). Quá công suất: đỏ, có gạch chéo, kèm "n ngày quá tải".

## Điều khiển

- Một menu **Phạm vi** (Người, có "Của tôi"; Epic; Loại việc) và một menu **Đến** (ngày). Đang bật là nền mực. "Đặt lại" chỉ hiện khi có gì để đặt lại.
- In, So sánh, Sao chép liên kết, Báo cáo Agile nằm trong `⋯`. Nút duy nhất có chữ ở góc phải là "AI Phân tích" (khi chưa có phân tích).
- Đang xem một phần dự án: "Cần bạn quyết" chỉ còn những dòng thuộc phần đó; xu hướng (đo cho cả dự án) ẩn đi.
- Lỗi là toast tiếng Việt; câu tiếng Anh từ máy chủ ("Not Found") được thay bằng câu tiếng Việt.

## Biểu đồ xu hướng

Vẽ bằng pixel thật theo chiều rộng đo được, cao 160px, chữ trục 11px. Chỉ hiện khi có từ 3 ngày dữ liệu.
