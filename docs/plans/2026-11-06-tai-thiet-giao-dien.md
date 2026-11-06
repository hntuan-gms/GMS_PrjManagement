# Tái thiết giao diện GMS PrjManagement — "Bàn làm việc"

> Lập ngày 2026-11-06. **Trạng thái: đã thực hiện phần lớn ngay trong ngày (chưa commit).** Các câu hỏi ở mục 13 đã được tự quyết theo đề xuất; xem "Trạng thái thực hiện" ngay dưới đây.

## Trạng thái thực hiện (2026-11-06)

| Giai đoạn | Đã làm | Chưa làm / làm khác kế hoạch |
|---|---|---|
| 0 Nền móng | Token "Giấy & Son" + chế độ tối + mật độ; Be Vietnam Pro + JetBrains Mono tự host; 368 mã hex trong App.css → token; test `noRawColors`; MASTER.md viết lại | **Không tách App.css** thành tệp theo component (giữ tên class cho e2e); CSS mới nằm ở `design/shell.css`, `plan.css`, `peek.css`, `today.css`, `views.css` |
| 1 Khung | Thanh bên, header 44px, 4 lăng kính, chỉ báo đồng bộ, `Ctrl K`, `?`, toast có hoàn tác, lớp phím tắt, `Ctrl P` đưa 5 dự án gần đây lên đầu, tìm không dấu | Chưa có ghim dự án, Hộp thư |
| 2 Kế hoạch | Cột mặc định mới, mã không cắt, StatusGlyph, dấu ưu tiên, "Tô màu theo", vạch son hôm nay, ngoặc Epic, baseline mờ khi đúng hạn, "+ Thêm việc", dòng 32px, **sửa ô Người/Trạng thái tại chỗ**, **phụ thuộc vi phạm tô đỏ + "Dời theo"**, **Bản nháp kế hoạch** (`Shift D`, bóng vị trí cũ, danh sách thay đổi, "Áp dụng" chỉ ghi việc bạn dời) | Chưa: `Tab` thụt dòng, vẽ thanh mới, bản đồ nhỏ, sửa tên/% tại chỗ; bản nháp chưa lưu qua F5 |
| 3 Chi tiết | Khung trượt phải không che kế hoạch, **đóng là lưu**, chuyển việc thì lưu trước, `DateField` (DD/MM, "t6", "+3n") | Chưa lưu tự động từng ô (chọn lưu-khi-đóng vì an toàn hơn với cascade) |
| 4 Tạo nhanh + Hôm nay | `quickAdd.ts` (44 test), tạo việc bằng câu trong `Ctrl K` / `C` / "+ Thêm việc", trang Hôm nay (đang chờ bạn, quá hạn, hôm nay, sắp tới, chưa xếp lịch, nút xong), tờ ghi giờ có gợi ý | — |
| 5 Bảng | Đầu cột không viết hoa, thẻ phẳng, đầu sprint gọn, bỏ ✦ và 🎯, **`j/k/h/l` đi giữa các thẻ** | Chưa: `Shift h/l` chuyển thẻ sang cột, đầu sprint một dòng thật sự |
| 6 Nhân lực | Ô "đường chân trời", bỏ vàng/xanh lá, ô trống khi rảnh, "Mức sử dụng", **sắp xếp Quá tải trước / Ít rảnh nhất / Rảnh nhất / Tên** | Chưa: hộp hỏi khi giao vào người quá tải, gợi ý cân tải |
| 7 Nhịp / Trợ lý | Câu kết luận do code dựng + thẻ "Cần bạn quyết" có nút hành động; khung AI bỏ gradient tím; trợ lý mở từ `Ctrl K`/thanh bên, bỏ viên nổi và dải token | Chưa: bullet chart thay donut, trang Cài đặt dự án, Hộp thư |

>
> Tài liệu này dựa trên ba nguồn:
> 1. Ảnh chụp 17 màn hình của app thật (client thật, API giả lập của `e2e/`, cửa sổ 1500×900 và 1280×800, dự án 9 task và 300 task).
> 2. Code: `client/src/App.css`, `design/tokens.css`, `Toolbar.tsx`, `GanttView.tsx`…
> 3. Tìm hiểu cách các công cụ khác làm: Linear, Superhuman, Raycast, Asana, Todoist, TeamGantt, Instagantt, MS Project, Runn, Float, Resource Guru, Teamwork, các hướng dẫn thiết kế của Vercel/IBM Carbon/Material 3/Apple, và phản hồi của người dùng Jira 2024–2026. Nguồn ở mục 14.
>
> Phần nhận xét viết thẳng, không giảm nhẹ. Phần kế hoạch viết đủ chi tiết để giao việc được: từng nút, từng phím, từng hiệu ứng (bao nhiêu ms, đường cong nào).

---

## Mục lục

0. [Tóm tắt](#0-tóm-tắt)
1. [Nhận xét trần trụi](#1-nhận-xét-trần-trụi)
2. [Gốc rễ: vì sao nó trông và dùng như vậy](#2-gốc-rễ)
3. [Hướng đi: "Bàn làm việc"](#3-hướng-đi-bàn-làm-việc)
4. [Ngôn ngữ thiết kế mới "Giấy & Son"](#4-ngôn-ngữ-thiết-kế-mới-giấy--son)
5. [Khung ứng dụng](#5-khung-ứng-dụng)
6. [Thiết kế từng màn hình](#6-thiết-kế-từng-màn-hình)
7. [Bảng phím tắt](#7-bảng-phím-tắt)
8. [Bảng chuyển động](#8-bảng-chuyển-động)
9. [Ngôn từ](#9-ngôn-từ)
10. [Trạng thái rỗng, đang tải, lỗi](#10-trạng-thái-rỗng-đang-tải-lỗi)
11. [Lộ trình triển khai](#11-lộ-trình-triển-khai)
12. [Đo thành công](#12-đo-thành-công)
13. [Câu hỏi cần chốt](#13-câu-hỏi-cần-chốt)
14. [Nguồn tham khảo](#14-nguồn-tham-khảo)

---

## 0. Tóm tắt

**Chẩn đoán.** Bên trong, app mạnh hơn Jira ở nhiều chỗ: có phụ thuộc FS/SS/FF/SF, baseline, cân tải, trợ lý ghi thẳng lên Jira. Nhưng bên ngoài nó vẫn là một mẫu quản trị Tailwind: nền slate-50, nút blue-600, thẻ trắng bo 8px, phông hệ thống. Các tab chia theo *loại dữ liệu của Jira* (Gantt, Bảng, Chấm công, Nguồn lực, Báo cáo), không theo *câu hỏi người dùng đặt ra mỗi ngày*. Trước dòng dữ liệu đầu tiên có 146px "khung". Mỗi tab có một kiểu thanh công cụ riêng. Không có lớp bàn phím. Chi tiết task che mất kế hoạch. Màu sắc phần lớn không mang nghĩa.

**Năm quyết định lớn.**

1. **Một kế hoạch, nhiều lăng kính.** Gantt, Bảng và Nhân lực là ba cách nhìn cùng một tập việc. Chúng dùng chung bộ lọc, chung lựa chọn, chung thanh lệnh. Chuyển qua lại bằng phím `1` `2` `3`, có hiệu ứng biến hình: thanh Gantt "trở thành" thẻ trên bảng.
2. **"Hôm nay" là trang chủ.** Màn đầu tiên trả lời "tôi làm gì bây giờ, ai đang chờ tôi". Có một bước "ghi giờ cuối ngày" thay cho phần lớn tab Chấm công.
3. **Một ô cho mọi thứ (`Ctrl K`).** Gộp lệnh, tìm kiếm, tạo việc bằng câu tiếng Việt ("Dựng API @Chi t6 3n sau DEMO-5") và hỏi trợ lý vào một chỗ. Viên "Trợ lý dự án" nổi đè lên biểu đồ bị bỏ.
4. **Chi tiết là khung trượt bên phải, không phải cửa sổ che màn hình.** Nhấn `Space` để xem nhanh, `Enter` để mở. Sửa ô nào lưu ô đó, có hoàn tác. Nút "Lưu & đồng bộ Jira" biến mất.
5. **"Bản nháp kế hoạch".** Kéo thả thử lịch thoải mái mà chưa ghi gì lên Jira. Xem trước những gì sẽ dịch chuyển. Rồi "Áp dụng 7 thay đổi" một lần, gửi thông báo một lần. Jira không làm được điều này, và đây là lý do lớn nhất để một PM không mở Jira nữa.

**Nhận diện mới, "Giấy & Son".** Nền giấy ấm, chữ mực, phần lớn giao diện đơn sắc. Có đúng một màu chữ ký: **đỏ son**, chỉ dùng cho "bây giờ" (vạch hôm nay, chấm chưa đọc, việc đang làm của tôi). Phông Be Vietnam Pro, do người Việt thiết kế, dấu vẽ từ đầu chứ không ghép thêm. Bo góc nhỏ, rất ít bóng đổ, chuyển động dưới 240ms. Không gradient tím, không lấp lánh ✦, không thẻ bo tròn có bóng mờ.

**Lộ trình.** 8 giai đoạn, khoảng 9–12 tuần cho một người làm toàn thời gian (mục 11). Giai đoạn 0 (nền móng CSS) là bắt buộc. `App.css` hiện dài 10.783 dòng, có 1.010 class gốc và 368 mã màu viết thẳng (dù luật cấm), nên không thể "đổi token là xong".

---

## 1. Nhận xét trần trụi

Đánh số để dẫn chiếu. Cột "Mức" cho biết mức hại: **Nặng** là làm người dùng chậm hoặc hiểu sai, **Vừa** là khó chịu, **Nhẹ** là thẩm mỹ.

### 1.1. Nhận diện: trông như mọi trang quản trị khác

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| N1 | Bảng màu là Tailwind nguyên bản: `slate-50/200/500/900`, `blue-600`, `red-600`, `green-600` (`tokens.css`). Phông `-apple-system, "Segoe UI"`. | Nhìn qua không thể phân biệt với hàng nghìn admin template hay app do AI sinh. Không có gì để người dùng "nhận ra" và gắn bó. | Vừa |
| N2 | Logo cạnh chữ "GMS PrjManagement" là ba gạch ngang, giống hệt nút mở menu, nhưng thực ra là một `span` không bấm được (`Toolbar.tsx:86`). | Hứa một hành động mà không làm. Người dùng sẽ bấm vào đó. | Vừa |
| N3 | Khung AI trong Báo cáo dùng gradient tím, biểu tượng ✦ trong ô vuông tím, nút "Phân tích ngay" xuất hiện **hai lần** trong cùng một khung nhìn. | Đúng bộ "dấu hiệu giao diện AI" mà giới thiết kế 2025 đã gọi tên. Phần đắt tiền nhất của app lại trông rẻ nhất. | Vừa |
| N4 | Mọi tiêu đề nhóm viết hoa nhỏ (TRẠNG THÁI, CON NGƯỜI, LỊCH, CÔNG SỨC, TIẾN ĐỘ, THỜI HẠN…). | Thói quen của template. Chữ hoa tiếng Việt có dấu ở cỡ 11px rất khó đọc (Ấ, Ể). | Nhẹ |

### 1.2. Cấu trúc: chia theo dữ liệu chứ không theo công việc

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| C1 | 5 tab: Gantt / WBS · Bảng · Chấm công · Nguồn lực · Báo cáo. | Đây là danh mục *tính năng*. Người dùng không nghĩ "tôi cần tab Nguồn lực". Họ nghĩ "ai đang rảnh để nhận việc này?". Không tab nào trả lời câu hỏi đầu tiên của một lập trình viên: **hôm nay tôi làm gì?** | Nặng |
| C2 | Mỗi tab có thanh công cụ ngữ pháp riêng. Gantt: tìm kiếm + JQL + bộ lọc đã lưu + 3 nút nhanh + "Bộ lọc". Bảng: bộ chọn board + Scrum + segmented, hàng 2 là ô tìm + avatar + 5 nút nhanh. Nguồn lực: segmented + tìm thành viên + bộ lọc đã lưu, hàng 2 là các viên KPI. Chấm công: segmented + mũi tên ngày + "Mọi người". | Học một màn không giúp gì cho màn sau. Vị trí "Hôm nay" nhảy giữa các tab. | Nặng |
| C3 | Trên Bảng có cả "Của tôi" (nút có sẵn) lẫn "Việc của tôi" (quick filter của Jira) đứng cạnh nhau. | Hai nút cùng nghĩa. Người dùng không biết khác gì. | Vừa |
| C4 | Cài đặt SLA và Lịch làm việc nằm trong menu tên dự án. | Không ai tìm cài đặt trong cái tên. | Nhẹ |
| C5 | Nút "Đồng bộ từ Jira" luôn hiện trên đầu, cạnh chữ "Đã đồng bộ: 14:02:11". | Bắt người dùng phải nghĩ về việc đồng bộ, tức là thú nhận dữ liệu có thể đã cũ. Linear không có nút này: dữ liệu luôn đúng, hoặc báo rõ khi không đúng. | Vừa |

### 1.3. Mật độ và không gian

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| D1 | 52px header + 48px thanh công cụ + 46px tiêu đề bảng = **146px trước dòng đầu tiên**. Mỗi dòng cao 42px (`GanttView.tsx:31`). Ở 900px chiều cao chỉ thấy **17 dòng**. | Một PM có 300 task phải cuộn 18 trang. MS Project hiện 30–35 dòng trên cùng màn hình. | Nặng |
| D2 | Dự án 9 task: 45% màn hình là khoảng trắng chết dưới bảng. | Không có gì gợi ý bước tiếp theo, không có dòng "＋ thêm việc". | Vừa |
| D3 | Cột "Ưu tiên": 8/9 dòng là "Medium". Cột "Loại" lặp lại thông tin của icon ngay cạnh tên. | Hai cột chiếm khoảng 180px mà gần như không mang thông tin. | Vừa |
| D4 | Dự án 300 task: cột "Mã" bị cắt thành "DEMO-10…". | Mã bị cắt thì vô dụng, vì mọi task chỉ khác nhau ở phần bị cắt. | Nặng |
| D5 | Nguồn lực: bảng 4 người × 20 tuần = **80 ô "0%"**. | Mắt phải lọc 74 ô nhiễu để thấy 6 ô có nghĩa. Ô không có việc phải *trống*. | Nặng |
| D6 | Chấm công: 3 thẻ KPI cao 100px, mỗi thẻ chỉ một con số. | Có thể nói hết trong một dòng 28px. | Nhẹ |

### 1.4. Màu sắc không mang nghĩa, hoặc mang nghĩa ngược

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| M1 | Màu thanh Gantt là băm id → pastel ngẫu nhiên (`PALETTE_HUES`). Một task Done màu cam đất, Epic hồng giống Bug, "Thiết kế CSDL" xanh bạc hà. | Thanh to nhất, nổi nhất trên màn hình lại là phần màu *không nói gì*. Người dùng sẽ cố tìm ý nghĩa, rồi không thấy. | Nặng |
| M2 | Nguồn lực: **vàng = dưới 50% (còn rảnh)**, xanh lá đậm = 50–100%. | Ở mọi nơi khác, vàng là *cảnh báo*. Ở đây vàng lại là tin tốt. Còn xanh lá bão hoà (`#4ade80`) là màu chói nhất bảng, kéo mắt về ô *bình thường*. | Nặng |
| M3 | "Hiệu suất TB: 5%". | Đó là *mức sử dụng* chứ không phải *hiệu suất*. Ai đọc chữ "hiệu suất 5%" cũng hiểu là đội lười. Từ sai làm tổn thương con người. | Nặng |
| M4 | Chấm công: một hàng chấm cam dưới mỗi ngày "chưa ghi". | Giọng kết tội, kiểu giám sát. Người dùng sẽ ghét màn này. | Vừa |
| M5 | Đường baseline xám dưới **mọi** thanh, kể cả khi đúng kế hoạch. | Gấp đôi số nét trên biểu đồ mà không thêm thông tin. Chỉ nên hiện khi *lệch*. | Vừa |

### 1.5. Gantt

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| G1 | Chữ tên việc tràn ra ngoài thanh ngắn, đè lên vạch hôm nay và lên chữ của dòng khác ("Sửa lỗi hiển thị bảng" cắt qua vạch tím). | Rối, khó đọc. | Vừa |
| G2 | Thanh không có phần "đã xong" bên trong. % chỉ nằm ở một cột bên trái. | Gantt nào cũng tô tiến độ trong thanh. Đây là thứ mắt PM tìm đầu tiên. | Nặng |
| G3 | Vạch hôm nay là đường gạch tím mảnh, cờ "1.0" và "0.9" (version) cùng màu tím. | "Bây giờ" là mốc quan trọng nhất của Gantt mà lại hoà lẫn với ký hiệu phiên bản. | Vừa |
| G4 | Trạng thái là viên "To Do / In Progress / Done" tiếng Anh, giữa giao diện tiếng Việt. | Lẫn ngôn ngữ. (Tên trạng thái là của workflow Jira, không dịch được tuỳ tiện, xem mục 9. Nhưng có thể hiển thị bằng *biểu tượng nhóm* kèm tên mờ.) | Vừa |
| G5 | Không tạo được việc ngay trên bảng: không có dòng trống để gõ, không kéo trên vùng thời gian để vẽ thanh mới. | Mọi lần tạo việc đều phải qua cửa sổ 10 ô. MS Project, TeamGantt, Instagantt đều cho gõ thẳng vào lưới. | Nặng |
| G6 | Không sửa được ô tại chỗ. Muốn đổi người phụ trách thì phải nhấn đúp → cửa sổ → chọn → "Lưu & đồng bộ Jira". | 4 thao tác cho một việc lẽ ra chỉ cần 2. | Nặng |
| G7 | Phụ thuộc bị vi phạm (việc sau bắt đầu trước khi việc trước xong) không được tô đỏ. | Đây là lỗi kế hoạch hay gặp nhất. TeamGantt tô đỏ và cho sửa bằng 1 nút. | Vừa |

### 1.6. Chi tiết task và tạo task

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| T1 | Chi tiết là cửa sổ 1120px che toàn bộ kế hoạch, kèm lớp mờ. | Mất ngữ cảnh: không thấy việc trước, việc sau, người đang bận. Mở 5 việc liên tiếp = 5 lần mở/đóng. | Nặng |
| T2 | **Hai định dạng ngày trong cùng một cửa sổ**: "Ngày bắt đầu 10/29/2026" (ô date của trình duyệt, kiểu Mỹ), ngay dưới là "Kết thúc 01/11/2026" (kiểu Việt). | Người Việt đọc "10/29" là vô nghĩa, và có thể đọc "11/08/2026" thành 11 tháng 8. **Lỗi hiểu sai dữ liệu.** | Nặng |
| T3 | Phải bấm "Lưu & đồng bộ Jira" mới lưu. "Xoá task" màu đỏ nằm trên cùng thanh đáy với nút Lưu. | Mô hình biểu mẫu thời 2010. Nút nguy hiểm đặt ngang hàng nút chính. | Vừa |
| T4 | Các mục rỗng vẫn chiếm chỗ: hàng "Chọn task… / FS / 0 / + Thêm" luôn hiện dù chưa có phụ thuộc; ô mô tả rỗng cao 96px. | Đúng lời phàn nàn số 1 về Jira: "ô trống vẫn hiện". | Vừa |
| T5 | % hoàn thành là thanh trượt. | Khó đặt đúng 35%. Ít ai dùng. | Nhẹ |
| T6 | Tạo task là cửa sổ 10 ô. Nút chính viết "Tạo task & đẩy lên Jira". | Tạo một việc mà phải điền như khai hải quan. "Đẩy lên Jira" là chi tiết kỹ thuật, người dùng không cần biết. | Nặng |

### 1.7. Bảng, Backlog

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| B1 | Đầu sprint là một thẻ cao 120px: tên, thanh tiến độ, biểu đồ burndown tí hon không đọc được, 3 nút. | Biểu đồ 240×80px không đọc được thì chỉ là trang trí. Thẻ này đẩy cột xuống. | Vừa |
| B2 | Đầu cột "TO DO 5 … 12": hai con số không nhãn (số việc, số điểm). | Phải đoán. | Nhẹ |
| B3 | Người chưa gán hiện là vòng tròn "?". | Ký hiệu khó hiểu. | Nhẹ |
| B4 | Không có phím: không `j/k` để đi qua thẻ, không chuyển thẻ sang cột bằng phím. | Kanban là nơi thao tác lặp lại nhiều nhất. | Vừa |
| B5 | Backlog: mỗi dòng có 6 phần tử bên phải (Epic, trạng thái, ưu tiên, avatar, điểm). Trạng thái là dropdown viết hoa "TO DO". | Rối. | Nhẹ |

### 1.8. Báo cáo, Trợ lý

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| R1 | Donut cho *một* con số 16,7%. Donut thứ hai cho 3 nhóm trạng thái. | Donut là cách tốn chỗ nhất để hiện một tỉ lệ. Hai donut chiếm nửa màn hình đầu. | Vừa |
| R2 | "SPI 0.5" hiện trần. | 90% người dùng không biết SPI. | Vừa |
| R3 | Câu kết luận ("Chậm tiến độ") là một viên nhỏ góc phải, chữ "Vì sao?" mờ. | Thông tin quan trọng nhất trang lại nhỏ nhất. | Nặng |
| R4 | Viên "● Trợ lý dự án" nổi góc phải, đè lên thanh Gantt (che mốc kim cương của DEMO-8). Khung chat mở ra che 1/4 biểu đồ. | Vật thể nổi che dữ liệu. | Vừa |
| R5 | Chân khung chat: "Phiên: 0 token · vào 0 · ra 0 · nghĩ 0". | Số đo dành cho lập trình viên lại hiện cho người dùng cuối. | Vừa |
| R6 | Trợ lý là một chỗ riêng. Muốn nhờ thì phải mở khung, gõ, rồi tự quay về đúng chỗ. | AI tốt là AI nằm *trong ngữ cảnh* (Linear: gợi ý ngay trên ô, có lý do, có nhãn AI). | Vừa |

### 1.9. Bàn phím, chế độ, kỹ thuật

| # | Thấy gì | Vì sao tệ | Mức |
|---|---|---|---|
| K1 | Phím tắt toàn app chỉ có: `Esc`, `Ctrl+Z` (kéo thanh), `/` (tìm trên Bảng). Không có `Ctrl K`, không có `j/k`, không có `?`. | Tốc độ của Linear nằm ở đây. Người dùng thạo không có đường nào để nhanh hơn. | Nặng |
| K2 | Không có chế độ tối, không có chế độ mật độ. | Lập trình viên làm buổi tối, người thì muốn thoáng, người muốn dày. | Vừa |
| K3 | `App.css` 10.783 dòng, 1.010 class gốc, **368 mã hex** (dù `MASTER.md` cấm), 22 `!important`. | Không thể đổi giao diện bằng cách sửa token: một phần ba màu sắc không đi qua token. Đây là nợ chặn mọi thay đổi lớn. | Nặng |

---

## 2. Gốc rễ

Bốn nguyên nhân sinh ra gần hết các điểm ở trên. Sửa từng triệu chứng mà không sửa gốc thì 3 tháng sau lại như cũ.

1. **Mô hình tư duy "bản sao giao diện Jira, thêm Gantt".** Tab, biểu mẫu và nút "Lưu & đồng bộ" đều đi theo Jira, nên app thừa hưởng luôn cảm giác của Jira. Muốn thắng Jira thì phải dùng mô hình khác: *bàn làm việc* (một mặt phẳng, nhiều cách nhìn, sửa tại chỗ) thay vì *hồ sơ* (danh sách → mở biểu mẫu → lưu).
2. **Tính năng được thêm theo chiều ngang, mỗi màn tự lo phần mình.** Mỗi tab có thanh công cụ riêng, bộ lọc riêng, chỗ đặt "Hôm nay" riêng. Không có một *ngữ pháp* chung.
3. **Màu được dùng để trang trí.** Thanh Gantt băm màu, heatmap xanh lá chói, gradient tím. Khi mọi thứ đều có màu thì màu không còn là tín hiệu.
4. **Không có lớp tương tác thứ hai cho người thạo việc.** Mọi thứ đều qua chuột và cửa sổ. Người mới và người dùng 8 tiếng/ngày đi chung một con đường chậm.

---

## 3. Hướng đi: "Bàn làm việc"

### 3.1. Sáu nguyên tắc

Mỗi quyết định trong tài liệu này phải trả lời được: nó theo nguyên tắc nào?

| # | Nguyên tắc | Hệ quả cụ thể |
|---|---|---|
| P1 | **Trả lời câu hỏi, không phô dữ liệu.** | Mỗi màn bắt đầu bằng một câu trả lời ("Dự án chậm 4 ngày, vì DEMO-5 chưa có người"), dữ liệu đi sau. |
| P2 | **Sửa ở nơi bạn nhìn thấy nó.** | Ô trong bảng sửa tại chỗ; thanh kéo được; thẻ chuyển cột bằng phím. Không cửa sổ cho việc một ô. |
| P3 | **Màu là tín hiệu, hiếm và có nghĩa.** | Giao diện đơn sắc. Màu chỉ cho: trạng thái, nguy cơ, "bây giờ", lựa chọn. |
| P4 | **Nhanh là một tính năng.** | Phản hồi < 100ms. Không hiệu ứng trên thao tác lặp lại. Mọi hành động có phím. Spinner chỉ hiện sau 200ms. |
| P5 | **Một ngữ pháp cho mọi màn.** | Cùng thanh lệnh, cùng bộ lọc, cùng khung chi tiết, cùng phím, cùng vị trí. Học một lần, dùng mọi nơi. |
| P6 | **AI nằm trong ngữ cảnh, có nhãn, có lý do, hoàn tác được.** | Không còn khung AI riêng để "đi tới". Gợi ý xuất hiện đúng chỗ nó áp dụng, đánh dấu "AI", có "Vì sao?", chấp nhận từng cái. (Giữ luật sẵn có: code tính số, AI giải thích.) |

### 3.2. Tám tính năng "cách mạng"

Đây là những thứ làm người dùng *thích* app, ngoài việc nó không còn xấu. Mỗi mục ghi rõ có làm được với kiến trúc hiện tại không.

| # | Tính năng | Vì sao Jira không có | Làm được? |
|---|---|---|---|
| F1 | **Bản nháp kế hoạch.** Bật "Nháp" (`Shift D`): kéo thanh, đổi phụ thuộc, đổi người thoải mái. Cascade chạy ở trình duyệt (`dependencyCascade.ts` đã có), nhưng **không ghi gì lên Jira**. Thanh nào bị dịch đổi sang viền nét đứt, kèm bóng mờ vị trí cũ. Thanh dưới cùng ghi: "7 việc thay đổi · ngày kết thúc dự án 20/11 → 27/11 · [Xem từng thay đổi] [Bỏ nháp] [Áp dụng]". | Mọi thao tác trên Jira đều ghi ngay và gửi thông báo ngay. Jira không có khái niệm "thử". | Có. Cascade phía client đã có. Bước "Áp dụng" gọi `updateTask` tuần tự như `runBulk`. Nháp lưu trong `localStorage` theo dự án. |
| F2 | **Tạo việc bằng câu tiếng Việt.** `Ctrl K` hoặc `C`, gõ: `Dựng API đăng nhập @chi t6 3n !cao ^DEMO-2 sau DEMO-5 #backend`. Phần nào nhận ra được thì tô thành chip ngay khi gõ. Dòng xem trước tính sẵn ngày từ phụ thuộc. | Jira chỉ có ô tiêu đề, còn lại là biểu mẫu. | Có. Bộ phân tích thuần, có test. Tạo qua `createTask` + `updateTask(predecessors)`. Xem mục 6.4. |
| F3 | **"Ai đang chờ tôi".** Trên Hôm nay: những việc của tôi mà việc của người khác đang phụ thuộc vào (FS/SS…), kèm tên người chờ và số ngày họ sẽ bị trễ nếu tôi trễ. | Liên kết Jira không có loại, không có độ trễ, nên Jira không tính được ai bị chặn và chặn bao lâu. | Có. `task_dependency` + cascade. Đây là dữ liệu độc quyền của app. |
| F4 | **Ghi giờ cuối ngày trong 10 giây.** 17:00 (hoặc khi bấm), một tờ nhỏ hiện các việc tôi đã đụng hôm nay, kèm số giờ gợi ý. Mỗi dòng: `[2h] [−] [+]`, `Enter` để ghi tất cả. | Jira bắt mở từng issue, "Log work", gõ "2h", chọn ngày. | Gần như có. Gợi ý lấy từ: việc đang "Đang làm" của tôi, việc tôi đổi trạng thái/bình luận hôm nay (`updated`, `statuscategorychangedate`), chia đều theo năng lực ngày. Đây là *gợi ý*, không phải đo thời gian thật. Phải nói rõ như vậy trên giao diện. |
| F5 | **Cân tải có xem trước.** Ở Nhân lực, nút "Gợi ý cân tải": code tìm cách dời các việc còn slack, hoặc chuyển cho người cùng kỹ năng đang rảnh, để xoá ngày quá tải. Kết quả mở dưới dạng *Bản nháp* (F1). | Jira không có mô hình năng lực. | Có, làm theo giai đoạn. Bản đầu: chỉ dời trong slack, theo luật tham lam. Chuyển người dùng `suggest_assignees` sẵn có. |
| F6 | **Một ô cho mọi thứ.** `Ctrl K` là lệnh ("đổi trạng thái…"), tìm kiếm ("DEMO-12", "đăng nhập"), tạo việc (F2), và hỏi trợ lý (`Tab` để chuyển sang "Hỏi trợ lý"). | Jira có tìm kiếm, Rovo nằm riêng. | Có. Gộp `ChatDock` vào. Luồng SSE giữ nguyên. |
| F7 | **Phụ thuộc vi phạm tự báo và tự sửa.** Mũi tên đỏ, thanh có dấu ⚠. Rê chuột hiện "Bắt đầu sớm hơn 2 ngày so với DEMO-5 xong". Nút "Dời theo" chạy cascade cho riêng cạnh đó. | Jira không có loại phụ thuộc. | Có. `earliestStartFor` đã có. |
| F8 | **Nhịp dự án trong một câu.** Trang báo cáo mở bằng một câu do code dựng ("Chậm 4 ngày so với baseline. Nguyên nhân chính: 3 việc trên đường găng chưa có người."), rồi 3 thẻ "Cần bạn quyết", mỗi thẻ có nút hành động ngay. | Báo cáo Jira là biểu đồ, không có kết luận. | Có. `judgeHealth` đã sinh lý do. Chỉ cần đổi cách trình bày. |

### 3.3. Những thứ cố ý **không** làm

- **Không** tự động áp dụng gợi ý AI. Luôn có bước người duyệt, như luật hiện có của planner.
- **Không** hàng đợi ghi khi Jira giới hạn tần suất. Giữ quyết định trong CLAUDE.md.
- **Không** bản mobile cho Gantt và Nhân lực. Hôm nay, Bảng và chi tiết task thì phải dùng được ở 390px (xem 6.11).
- **Không** "AI-first". Height đóng cửa tháng 9/2025 sau khi đổi hướng sang "PM tự động bằng AI". AI ở đây là trợ thủ, không phải bản sắc.

---

## 4. Ngôn ngữ thiết kế mới "Giấy & Son"

### 4.1. Ý tưởng

**Giấy**: nền ấm, hơi ngà, như sổ kế hoạch. **Mực**: chữ gần đen, ấm. **Son**: màu đỏ cam của mực son, con dấu, nét bút sửa bài. Son là màu chữ ký duy nhất, dùng cho "bây giờ" và "của tôi". Mọi màu khác đều là màu *nghĩa* (trạng thái, nguy cơ), nhạt và ít.

Nguyên tắc của Linear 2026 được giữ: *"Đừng tranh sự chú ý mà bạn chưa xứng đáng"*, *"Cấu trúc cảm thấy được, không cần nhìn thấy"*. Ít đường kẻ, ít icon. Phân tầng bằng độ sáng chứ không bằng bóng.

### 4.2. Màu: token mới

Viết bằng OKLCH (dễ sinh chế độ tối và độ tương phản cao), có giá trị hex dự phòng. **Thay hoàn toàn** tầng primitive trong `tokens.css`. Tầng semantic giữ tên cũ nếu được, để code bớt phải sửa.

#### Nền và chữ (sáng)

| Token | Hex | Dùng cho |
|---|---|---|
| `--paper` | `#F6F5F1` | Nền ứng dụng (thanh bên, vùng ngoài) |
| `--sheet` | `#FCFBF9` | Mặt làm việc (bảng, bảng Kanban) |
| `--raised` | `#FFFFFF` | Lớp nổi: khung chi tiết, menu, ô lệnh |
| `--sunken` | `#EFEDE8` | Ô đang chọn, vùng trũng (thanh tìm kiếm), cuối tuần trên Gantt |
| `--line` | `#E6E3DC` | Đường kẻ mặc định (1px). Dùng **ít** |
| `--line-strong` | `#D3CEC4` | Viền ô nhập, viền nút phụ khi hover |
| `--ink` | `#1D1C1A` | Chữ chính |
| `--ink-2` | `#55524C` | Chữ phụ (≥ 7:1 trên `--sheet`) |
| `--ink-3` | `#6F6B64` | Chữ mờ, nhãn (≥ 4.8:1 trên `--sheet`, đạt AA) |
| `--ink-4` | `#A29D94` | **Chỉ** cho icon trang trí và đường. Không dùng cho chữ |

#### Màu chữ ký và màu nghĩa

| Token | Hex | Dùng cho | Không dùng cho |
|---|---|---|---|
| `--son` | `#E0531F` | Vạch hôm nay, chấm chưa đọc, viền trái việc "của tôi đang làm", logo | Nút, chữ thường, lỗi |
| `--son-wash` | `#FCEBE3` | Nền nhạt khi cần (cột hôm nay trên Gantt, 40% độ mờ) | |
| `--action` | `= --ink` | **Nút chính là nút mực đen**, chữ trắng. Một nút mỗi vùng | |
| `--focus` | `#2A6FDB` | Vòng focus bàn phím (2px, offset 2px), đầu kéo đang nắm | Trang trí |
| `--select` | `#E7EEFB` + viền trái 2px `--focus` | Dòng/thẻ đang chọn | |
| `--st-todo` | `#8A857C` | Biểu tượng "Chưa làm" (vòng rỗng) | |
| `--st-doing` | `#2A6FDB` | Biểu tượng "Đang làm" (vòng nửa), phần đã xong trong thanh Gantt | |
| `--st-done` | `#2F8A5B` | Biểu tượng "Xong" (vòng đặc + dấu tick) | |
| `--risk` | `#C2334D` | Quá hạn, vi phạm phụ thuộc, quá tải >100%. **Luôn kèm icon hoặc gạch chéo** | Trang trí |
| `--risk-wash` | `#FBE9EC` | Nền nhạt của ô quá tải | |
| `--caution` | `#B7791F` (chữ `#8A5A12`) | Sắp đến hạn, thiếu dữ liệu | Tin tốt |
| `--ai` | `#6B5BB5` | **Chỉ** nhãn chữ "AI" nhỏ cạnh gợi ý, và viền nét đứt của giá trị do AI đề xuất | Nền, gradient, nút |

Vì sao không lấy indigo/tím làm màu chính: `bg-indigo-500` là dấu hiệu "giao diện AI" mà chính tác giả Tailwind UI đã xin lỗi (8/2025). Vì sao nút chính màu mực: một app nhiều dữ liệu thì dữ liệu phải là thứ có màu, còn khung thì lùi lại.

#### Chế độ tối

| Token | Hex |
|---|---|
| `--paper` | `#121211` |
| `--sheet` | `#181816` |
| `--raised` | `#211F1D` |
| `--sunken` | `#0E0E0D` |
| `--line` | `#2B2926` |
| `--line-strong` | `#3B3833` |
| `--ink` | `#EDEBE6` |
| `--ink-2` | `#B9B4AA` |
| `--ink-3` | `#948F85` |
| `--son` | `#F26B38` |
| `--action` | `#EDEBE6` (nút sáng, chữ tối) |
| `--st-doing` | `#5B93EA` |
| `--st-done` | `#4FAE7C` |
| `--risk` | `#E5576F` |

Chọn theo hệ thống (`prefers-color-scheme`), có công tắc ở menu tài khoản (Sáng / Tối / Theo máy). Lưu vào `localStorage` (`gms.theme`). Áp trước lần vẽ đầu bằng script inline trong `index.html` để không nháy trắng.

#### Màu thanh Gantt: bỏ băm id

Thanh có **4 cách tô**, chọn ở "Hiển thị › Tô màu theo" (`gms.gantt.colorBy`):

1. **Trạng thái** (mặc định). Chưa làm: nền `--sunken`, viền `--line-strong`. Đang làm: nền `#DCE7FA`, phần đã xong tô `--st-doing`. Xong: nền `#DDEFE4` ở độ mờ 70%. Quá hạn: viền `--risk` và gạch chéo 45° `--risk` 12%.
2. **Người phụ trách.** 10 màu nhạt cố định theo thứ tự trong danh sách thành viên (không băm), có chú giải.
3. **Epic.** Cùng 10 màu, theo Epic cha.
4. **Không.** Mọi thanh `--sunken`. Chỉ còn tô tiến độ và nguy cơ.

Bug **không** còn đỏ cố định: đỏ đã dành cho *nguy cơ*. Bug được nhận ra qua icon loại ở đầu thanh.

### 4.3. Chữ

**Phông chính: Be Vietnam Pro** (OFL, Lâm Bảo, Tony Le, ViệtAnh Nguyễn). Dấu được vẽ cho tiếng Việt ngay từ đầu, mang bản sắc riêng, khác Inter mà mọi app đang dùng. Tự host 4 độ đậm: 400, 500, 600, 700. Mỗi độ đậm hai tệp woff2 (`latin` + `vietnamese`, chia theo `unicode-range`). Cache `immutable` như `/assets` hiện tại. Ước tính 4 × ~22KB.

**Phông số và mã: JetBrains Mono** 500, chỉ cho mã issue và cột số cần thẳng hàng.

**Việc phải kiểm tra trước khi chốt (giai đoạn 0):**

- Be Vietnam Pro có `tnum` (số đều độ rộng) không? Nếu không, mọi cột số dùng JetBrains Mono, hoặc đổi phông chính sang Inter (cũng có tiếng Việt, có `tnum`).
- Dòng 28px với chữ hoa có dấu chồng (Ấ Ể Ỗ Ặ Ữ) có bị cắt khi `overflow: hidden` không. Chuỗi thử: `ẤẦẨẪẬ ẮẰẲẴẶ Ếễệ ỐỒỔỖỘ Ởỡợ ừữự`.
- Chữ 12px ở độ đậm 400 trên màn Windows 100% (ClearType) có rõ không.

**Thang cỡ** (bỏ 11.5 và 12.5 lẻ):

| Token | Cỡ / dòng | Đậm | Dùng cho |
|---|---|---|---|
| `--t-micro` | 11 / 14 | 500 | Huy hiệu số, chú giải trục. **Không** viết hoa |
| `--t-small` | 12 / 16 | 400 | Chữ phụ, mô tả dưới nhãn |
| `--t-body` | 13 / 18 | 400 | Ô bảng, menu, ô nhập (mặc định) |
| `--t-strong` | 13 / 18 | 600 | Tên việc cha, tiêu đề nhóm |
| `--t-lead` | 15 / 22 | 500 | Tiêu đề khung chi tiết, câu kết luận nhỏ |
| `--t-title` | 20 / 26 | 600 | Tiêu đề trang (Hôm nay, Nhịp dự án) |
| `--t-display` | 32 / 36 | 600, `tnum` | Một con số lớn duy nhất mỗi màn |

Bỏ toàn bộ tiêu đề nhóm viết hoa (N4). Thay bằng chữ `--t-small` màu `--ink-3`, viết thường.

### 4.4. Khoảng cách, bo góc, đường, bóng

- **Lưới 4px**: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 24 · `--s-6` 32 · `--s-7` 48.
- **Bo góc nhỏ hơn**: `--r-1` 3px (chip, huy hiệu, thanh Gantt) · `--r-2` 6px (nút, ô nhập) · `--r-3` 10px (menu, khung nổi, thẻ Kanban). **Không** bo 16px ở đâu. Luật Vercel: góc con không bao giờ lớn hơn góc cha.
- **Đường**: chỉ kẻ ngang giữa các dòng (`--line`). Bỏ kẻ dọc giữa các cột của bảng WBS, căn thẳng là đủ (Linear: "cấu trúc cảm thấy được"). Gantt giữ vạch tuần ở `--line` 60%.
- **Bóng**: chỉ cho lớp nổi. `--shadow-float: 0 1px 0 rgb(0 0 0/.04), 0 8px 24px -6px rgb(30 25 15/.16)`. Thẻ Kanban **không** bóng khi nghỉ, có `--shadow-float` khi đang kéo. Mặt phẳng phân tầng bằng `--paper` → `--sheet` → `--raised`.

### 4.5. Icon

Giữ bộ SVG tự vẽ (`Icons.tsx`), nhưng vẽ lại theo một quy chuẩn: lưới 16px, nét 1.5px, đầu nét tròn, góc 1.5px. Bỏ icon trước mọi nút có chữ (chỉ giữ ở nút chỉ có icon và mục menu). Biểu tượng trạng thái mới, theo lối Linear, có thể nhận ra mà không cần màu:

```
○  Chưa làm         (vòng rỗng, --st-todo)
◔  Đang làm 1–49%   (vòng 1/4, --st-doing)
◑  Đang làm 50–99%  (vòng nửa)
●✓ Xong             (vòng đặc có tick, --st-done)
⊘  Huỷ / Won't do   (vòng gạch, --ink-4)
```

Lấy theo `statusCategory` của Jira (`new` / `indeterminate` / `done`). Tên trạng thái thật của workflow vẫn hiện bên cạnh, chữ `--ink-2`.

Ưu tiên: bỏ cột chữ "Medium". Chỉ hiện dấu khi khác mặc định: `‼` Khẩn (`--risk`), `↑` Cao, `↓` Thấp, `⇣` Rất thấp. "Trung bình" = không hiện gì.

### 4.6. Chuyển động: token

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--d-0` | 0ms | Thao tác bằng phím, thao tác lặp > 50 lần/ngày (`j/k`, đổi lăng kính bằng số, mở ô lệnh) |
| `--d-1` | 90ms | Hover, nhấn, bật/tắt, ô được chọn |
| `--d-2` | 150ms | Menu, popover, tooltip, chip xuất hiện |
| `--d-3` | 220ms | Khung chi tiết trượt vào, toast, dòng mới mở ra |
| `--d-4` | 320ms | Biến hình giữa lăng kính, bản nháp áp dụng (thanh trượt về chỗ mới) |
| `--e-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Vào (mạnh lúc đầu, êm lúc cuối) |
| `--e-move` | `cubic-bezier(0.2, 0, 0, 1)` | Vật đổi chỗ (thanh, thẻ, dòng) |
| `--e-in` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Ra, với 70% thời gian của chiều vào |

Luật:

- Chỉ animate `transform` và `opacity`. **Không** `transition: all`.
- Mọi hiệu ứng ngắt giữa chừng được: bấm lại thì đảo chiều từ vị trí hiện tại, không chạy hết rồi mới đảo.
- Spinner/skeleton chỉ hiện nếu chờ quá **200ms**. Đã hiện thì giữ ít nhất **400ms** để không nháy.
- `prefers-reduced-motion`: mọi `transform` đổi thành `opacity`, mọi thời lượng ≤ 90ms. Không có biến hình lăng kính.
- Bảng chi tiết từng hiệu ứng ở mục 8.

---

## 5. Khung ứng dụng

### 5.1. Bố cục

```
┌──┬───────────────────────────────────────────────────────────────────────────┐
│◉ │ Dự án mẫu ▾   Kế hoạch 1 · Bảng 2 · Nhân lực 3 · Nhịp 4     ●Khớp Jira  ⌘K │ 44px
│  ├───────────────────────────────────────────────────────────────────────────┤
│⌂ │ [Tìm…]  Của tôi  Quá hạn  + Lọc        (chip lọc)        Tuần ▾  Hiển thị │ 40px
│✉ ├───────────────────────────────────────────────────────────────────────────┤
│▦ │                                                                           │
│  │                       mặt làm việc (--sheet)                              │
│  │                                                                           │
│? │                                                                           │
│TT│                                                                           │
└──┴───────────────────────────────────────────────────────────────────────────┘
 48px
```

Khung trước dòng đầu tiên: 44 + 40 + 32 (tiêu đề bảng) = **116px** (hiện tại 146). Dòng 32px. Ở 900px thấy **24 dòng** (hiện 17, tăng 41%). Chế độ "Gọn" dòng 28px: **28 dòng**.

### 5.2. Thanh bên (rail), 48px

Nền `--paper`, không viền phải: tách bằng độ sáng với `--sheet`. Từ trên xuống:

| Phần tử | Hình | Bấm | Phím | Ghi chú |
|---|---|---|---|---|
| Logo | Ô vuông 24px nền `--son`, chữ "G" trắng 700 | Về Hôm nay | `G H` | Thay biểu tượng ≡ (N2) |
| Hôm nay | Icon mặt trời | Mở Hôm nay | `G H` | Chấm `--son` 6px khi có việc mới giao cho tôi |
| Hộp thư | Icon phong bì | Mở Hộp thư | `G I` | Số chưa đọc (giai đoạn 7) |
| Dự án | Icon lưới | Mở dự án đang chọn ở lăng kính gần nhất | `G P` | |
| (khoảng trống đẩy xuống dưới) | | | | |
| Trợ giúp | `?` | Bảng phím tắt + "Có gì mới" | `?` | |
| Tài khoản | Avatar 28px | Menu: tên, Giao diện (Sáng/Tối/Theo máy), Mật độ (Thoáng/Vừa/Gọn), Đăng xuất | | |

Mỗi icon có tooltip sau 400ms, ghi tên và phím ("Hôm nay  G H"). Hover: nền `--sunken`, `--d-1`. Mục đang mở: nền `--raised`, icon `--ink`. Mục khác: icon `--ink-3` (thanh bên "lùi lại" như Linear 2026).

### 5.3. Header dự án, 44px

**Trái: bộ chuyển dự án.** "Dự án mẫu ▾", chữ `--t-strong`, mã DEMO mờ bên cạnh. Bấm hoặc `Ctrl P` mở bảng chuyển nhanh:

- Ô tìm có focus sẵn.
- "Gần đây" (5 dự án cuối) rồi "Tất cả".
- Mỗi dòng: mã (mono) · tên · số việc của tôi trong đó (nếu đã có trong cache).
- `↑↓` di chuyển, `Enter` mở ở tab này, `Ctrl Enter` mở ở tab mới (giữ được mô hình "dự án theo tab" của CLAUDE.md).
- Ngôi sao để ghim. Dự án ghim luôn ở đầu.
- Mục cuối "Cài đặt dự án…" mở trang Cài đặt (SLA, lịch làm việc, KBKT). Gỡ khỏi menu tên dự án (C4).

**Giữa: lăng kính.** Bốn chữ, cách nhau 20px, không khung. Đang chọn: `--ink` 600 và một gạch 2px `--ink` dưới chân, gạch này *trượt* sang mục mới (transform, `--d-2`, `--e-move`). Không chọn: `--ink-3`. Hover: `--ink-2`. Phím `1` `2` `3` `4` (khi không gõ trong ô). Số phím hiện mờ cạnh chữ khi giữ `Alt`.

Nhân lực vẫn chỉ hiện với quản trị dự án (luật hiện có). Huy hiệu quá tải vẫn trên chữ "Nhân lực", nhưng là chấm `--risk` + số, không phải vòng đỏ đặc.

**Phải: trạng thái đồng bộ + ô lệnh.**

- **Chỉ báo đồng bộ** thay nút "Đồng bộ từ Jira" (C5). Chấm 6px + chữ `--t-small`:
  - `● Khớp Jira`, chấm `--st-done`. Rê chuột: "Đọc lần cuối 14:02 · bấm để đọc lại ngay".
  - `◌ Đang đọc…`, chấm quay chậm, chỉ hiện sau 200ms.
  - `● Đang ghi 2 thay đổi`, chấm `--st-doing` nhấp nháy 1.2s.
  - `● Jira đang giới hạn · còn 14 phút`, chấm `--caution`. Thay cho thông báo `X-Jira-Limited` hiện tại.
  - `● 1 thay đổi không ghi được`, chấm `--risk`. Bấm mở danh sách lỗi, mỗi lỗi có "Thử lại" và "Bỏ".
  - Bấm vào chỉ báo = đọc lại (hành vi của nút cũ). Phím `Shift R`.
- **Ô lệnh**: nút giả ô tìm kiếm rộng 220px, chữ mờ "Tìm, tạo, hỏi…" và `Ctrl K` bên phải. Bấm hoặc `Ctrl K` mở ô lệnh (6.3).

**Bỏ nút "Task mới" khỏi header.** Thay bằng `C` (tạo nhanh), "＋ Thêm việc" cuối mỗi danh sách/cột, và lệnh trong `Ctrl K`. Một app mà "tạo" chỉ cách một phím thì không cần nút xanh to.

### 5.4. Thanh lọc, 40px, dùng chung cho mọi lăng kính

Cùng một component, cùng vị trí, cùng phím trên Kế hoạch, Bảng, Nhân lực (P5):

| Phần tử | Hành vi |
|---|---|
| Ô tìm (200px, nền `--sunken`, không viền) | `/` để focus. Lọc khi gõ, độ trễ 120ms. Tìm trong mã, tên, người phụ trách. Gõ `jql:` thì chuyển sang chế độ JQL: nền ô đổi `--raised`, chữ mono, `Enter` mới chạy. |
| Của tôi | Bật/tắt. Bật: nền `--ink`, chữ trắng. Phím `M`. |
| Quá hạn | Như trên. Phím `O`. Kèm số khi > 0. |
| ＋ Lọc | Mở menu các mặt lọc: Trạng thái, Người, Loại, Ưu tiên, Epic, Nhãn, Sprint, Thành phần, Phiên bản, SLA. Chọn một mặt thì menu chuyển sang danh sách giá trị, có ô tìm, nhiều lựa chọn. Phím `F`. |
| Chip đang lọc | Nằm **cùng hàng**, sau "＋ Lọc", dạng `Người: Anh, Chi ×`. Bấm chip để sửa, `×` để bỏ. Nhiều hơn 3 chip thì gộp thành "+2". Không còn hàng thứ hai. |
| Bộ lọc đã lưu | Mục đầu của menu "＋ Lọc" ("Đã lưu ▸"). Không chiếm chỗ trên thanh. |
| Quick filter của board Jira | Cũng trong "＋ Lọc" ("Của board ▸"). Bộ lọc nào trùng với nút có sẵn (C3) thì ẩn: so JQL `assignee = currentUser()`. |
| (phải) Thang thời gian | `Ngày · Tuần · Tháng · Quý` dạng chữ, phím `-` `=` để thu/phóng. Chỉ có ở Kế hoạch và Nhân lực. |
| (phải) Hiển thị | Menu: Tô màu theo, Đường găng, Phụ thuộc, Baseline (chỉ khi lệch / luôn / tắt), Cột bảng, Mật độ. |
| (phải) ⋯ | Nhập CSV/Excel, Nhập KBKT, Xuất CSV, In. |

"Hôm nay" không còn là nút: phím `T`, và vạch son luôn có một nút nhỏ "◂ Hôm nay" ở mép khi nó trôi khỏi màn hình (6.1.6).

### 5.5. Thanh hành động khi chọn

Giữ luật quan trọng của CLAUDE.md: **`position: fixed`, không chiếm chỗ trong luồng**. Đổi hình thức:

- Viên nổi giữa đáy, nền `--ink`, chữ trắng, bo `--r-3`, cao 40px. Xuất hiện bằng trượt lên 8px + mờ dần vào, `--d-2` `--e-out`.
- Nội dung: `3 việc` · `Trạng thái S` · `Giao A` · `Dời ±` · `Baseline` · `Xoá ⌫` · `Esc`. Mỗi nút ghi phím ngay bên cạnh, chữ mờ (bài học Raycast: phím hiện ở nơi dùng).
- `A` mở chọn người ngay tại viên, `S` mở chọn trạng thái (chỉ bước workflow cho phép, kèm "n/m" như hiện tại), `Alt ←/→` dời 1 ngày, `Alt Shift ←/→` dời 1 tuần.

### 5.6. Toast

Góc dưới trái (để không đụng viên chọn ở giữa và khung chi tiết bên phải). Nền `--ink`, chữ trắng, rộng tối đa 420px. Vào: trượt lên 8px + mờ, `--d-3`. Tự đóng sau 5s, **dừng đếm khi rê chuột**. Tối đa 3 toast chồng lên nhau, toast cũ thu nhỏ 96% và lùi xuống.

Mỗi thay đổi hoàn tác được có toast "Đã chuyển DEMO-5 sang Đang làm · **Hoàn tác** `Ctrl Z`". Toast lỗi không tự đóng, có "Thử lại".

---

## 6. Thiết kế từng màn hình

### 6.1. Kế hoạch (Gantt / WBS)

#### 6.1.1. Bố cục

```
┌─────────────────────────────── bảng ──────────────────────┬─── thời gian ──────────────────────┐
│ Mã        Tên                       Người   Trạng thái  % │ T10    W44     W45 ┃   W46     W47   │
├───────────────────────────────────────────────────────────┼────────────────────┃───────────────┤
│ DEMO-1  ▾ ⚡ Giai đoạn 1 — Khảo sát                      40│  ▕▔▔▔▔▔▔▔▔▔▔▔▔▔▔▏   ┃               │
│ DEMO-4      ☐ Viết tài liệu BRD     Bình    ●✓ Done   100 │  ▕████████▏         ┃               │
│ DEMO-3      ◫ Phân tích yêu cầu     Anh  ↑  ◑ In Prog  60 │    ▕█████▒▒▒▒▏      ┃               │
│ DEMO-2  ▾ ⚡ Giai đoạn 2 — Xây dựng                       0 │                    ┃ ▕▔▔▔▔▔▔▔▔▔▔▔▔▏ │
│ DEMO-7      🐞 Sửa lỗi hiển thị     —    ‼  ○ To Do     0 │                    ┃ ▕▒▒▏ Sửa lỗi…  │
│ ＋ Thêm việc  (gõ để tạo, Tab để thụt vào)                │                    ┃               │
└───────────────────────────────────────────────────────────┴────────────────────┸───────────────┘
                                                                      vạch son = hôm nay
```

#### 6.1.2. Cột bảng mặc định

`Mã` (mono, **không bao giờ cắt**: độ rộng tính theo mã dài nhất của dự án) · `Tên` (icon loại + tên, giãn) · `Người` (avatar 18px + tên ngắn) · `Trạng thái` (biểu tượng nhóm + tên workflow mờ) · `%` (số, `tnum`, căn phải).

Bỏ khỏi mặc định: "Loại" (đã có icon) và "Ưu tiên" (đã thành dấu cạnh tên, chỉ khi khác mặc định). Vẫn bật lại được trong Hiển thị › Cột.

#### 6.1.3. Dòng

- Cao 32px (Vừa) · 28px (Gọn) · 40px (Thoáng). `ROW_HEIGHT` đọc từ cài đặt mật độ, vì cửa sổ ảo hoá dùng con số này.
- Hover: nền `--sunken` 50%, `--d-1`. Bên phải tên hiện hai nút mờ: `↗` (mở chi tiết) và `⋯` (menu dòng).
- Chọn: nền `--select`, viền trái 2px `--focus`. **Không đổi chiều cao, không đẩy gì** (giữ hợp đồng nhấp đúp).
- Việc cha: chữ `--t-strong`, mũi tên ▸/▾ xoay 90° trong `--d-2`. Đóng/mở: các dòng con mở ra bằng *chiều cao* trong `--d-3`. Khi > 30 dòng con thì không animate (dùng `--d-0`), vì một danh sách dài trượt ra là chậm.
- Việc "của tôi, đang làm": viền trái 2px `--son`. Đây là chỗ duy nhất trên bảng có màu son.
- Việc xong: chữ `--ink-3`, tên **không** gạch ngang (gạch ngang làm khó đọc tiếng Việt có dấu).

#### 6.1.4. Sửa tại chỗ, kiểu bảng tính

| Thao tác | Kết quả |
|---|---|
| `↑` `↓` hoặc `j` `k` | Di chuyển con trỏ dòng (viền focus 2px quanh dòng). `Shift` kèm theo để mở rộng vùng chọn. |
| `←` `→` | Di chuyển giữa các ô của dòng đang đứng (mặc định đứng ở ô Tên). Ô đang đứng có viền trong 1px `--focus`. |
| `Enter` trên dòng | Mở khung chi tiết. `Space`: xem nhanh (giữ `Space` để xem, nhả là đóng, như Linear). |
| `F2` hoặc gõ ký tự bất kỳ khi đang ở ô Tên | Sửa tên tại chỗ. `Enter` lưu, `Esc` huỷ. Ô sửa giữ đúng vị trí và cỡ chữ, chỉ thêm viền `--focus`. |
| Bấm ô Người | Mở danh sách người ngay dưới ô (popover 240px, có ô tìm, `↑↓ Enter`). Chọn xong là lưu. Toast có "Hoàn tác". |
| Bấm ô Trạng thái | Danh sách bước *workflow cho phép* (hỏi `/transitions` khi mở). Nếu bước cần nhập thêm ô (`TRANSITION_FIELDS_REQUIRED`) thì popover nở ra chứa các ô đó, không mở cửa sổ. |
| Bấm ô % | Ô số nhỏ. `↑↓` tăng/giảm 10, `Shift ↑↓` tăng/giảm 1. |
| Dòng "＋ Thêm việc" cuối mỗi nhóm | Gõ tên, `Enter` tạo việc anh em và mở sẵn một dòng mới bên dưới. `Tab` trước khi `Enter` thì thành việc con của dòng trên. Có thể gõ cú pháp nhanh (F2 ở mục 6.4) ngay trong ô này. |
| `Tab` / `Shift Tab` trên dòng đã chọn | Thụt vào (thành con của dòng trên) / thụt ra. Kiểm tra luật cấu trúc (`structure.ts`) **trước** khi gửi. Nếu không hợp lệ, dòng rung ngang 3px × 2 lần (120ms) và tooltip nói lý do ("Sub-task không làm cha được"). |
| `Alt ↑` / `Alt ↓` | Đổi thứ tự trong cùng cha (nếu dự án có Rank). |
| Dán (Ctrl V) nhiều dòng từ Excel vào dòng "＋ Thêm việc" | Mở thẳng màn xem trước nhập liệu (`csvImport.ts` đã có), không cần qua menu Nhập. |
| `Delete` | Hỏi xác nhận (`useDialogs`, nút Huỷ được focus sẵn), rồi xoá. |

**Lưu tức thì có hoàn tác** thay cho mô hình biểu mẫu. Lý do được phép: các thay đổi trên đều là ghi một trường, và ghi lại giá trị cũ là hoàn tác hợp lệ. Riêng chuyển trạng thái thì "hoàn tác" là *chuyển ngược*. Nếu workflow không cho chuyển ngược thì toast không có nút Hoàn tác và ghi "Không hoàn tác được: quy trình không cho quay lại To Do".

#### 6.1.5. Thanh và vùng thời gian

| Phần tử | Thiết kế |
|---|---|
| Thanh | Cao 18px (Vừa), bo `--r-1`. Phần đã xong tô đặc từ trái (theo %). Tên việc **nằm bên phải thanh**, chữ `--ink-2` 12px. Chỉ nằm trong thanh khi thanh đủ rộng hơn chữ + 16px. Không bao giờ đè chữ dòng khác (G1). |
| Epic / việc cha | Không vẽ thanh đặc. Vẽ một "ngoặc": đường 3px `--ink-3` có hai móc xuống 5px ở hai đầu. Nhìn là biết đây là phạm vi, không phải công việc. |
| Mốc (milestone) | Hình thoi 12px `--ink`, tên bên phải. |
| Hôm nay | Vạch dọc 1.5px `--son` suốt chiều cao, đầu vạch là nhãn son "6/11" ở tiêu đề trục. Cột ngày hôm nay nền `--son-wash` 40% (ở thang Ngày). |
| Cuối tuần, ngày lễ | Nền `--sunken` 60%. Ngày lễ có thêm nhãn nhỏ ở tiêu đề trục, rê chuột hiện tên. Ngày làm bù **không** tô. |
| Baseline | Mặc định "chỉ khi lệch": một vạch 2px `--ink-4` dưới thanh, chỉ vẽ khi lệch ≥ 1 ngày. Kèm số "+3n" màu `--risk` ở cuối nếu trễ. |
| Slack | Khi rê chuột lên một thanh: một đuôi nét chấm `--ink-4` kéo từ cuối thanh tới ngày muộn nhất mà không làm trễ việc sau. Nhãn "còn 4 ngày dư". Tính từ cascade, chỉ khi bật Đường găng. |
| Đường găng | Thanh trên đường găng có viền 1.5px `--ink` và một chấm son 4px ở đầu. Không tô đỏ cả thanh (đỏ dành cho nguy cơ). Lưu lựa chọn bật/tắt (MS Project bị chê vì mất khi tải lại). |
| Phụ thuộc | Mũi tên 1px `--ink-4`, góc vuông bo 4px. Rê lên một thanh: mũi tên của nó đậm lên `--ink-2`, các mũi tên khác mờ xuống 30%. **Vi phạm**: mũi tên `--risk` nét đứt, thanh sau có `⚠`. Rê lên ⚠: "Bắt đầu sớm hơn 2 ngày so với ràng buộc FS từ DEMO-5 · [Dời theo]". |
| Vẽ thanh mới | Trên một dòng *chưa có ngày*, kéo ngang trên vùng thời gian để vẽ thanh. Hình bóng `--focus` 20% theo chuột, bám theo ngày. Thả là đặt ngày bắt đầu + thời lượng. |
| Kéo thanh | Con trỏ `grab` → `grabbing`. Khi kéo: thanh nổi lên (`--shadow-float`), bóng mờ ở vị trí cũ (viền nét đứt), nhãn ngày nổi phía trên ("12/11 → 15/11 · 4 ngày"). Bám ngày. Mỗi lần vượt qua một ngày, nhãn đổi số trong `--d-0`. Các việc sau bị cascade đẩy theo hiện *bóng xem trước* ngay khi kéo (đã có `dependencyCascade.ts`). Thả: thanh trượt về đúng ô ngày trong `--d-2 --e-move`. |
| Kéo hai đầu | Đổi ngày bắt đầu / thời lượng. Tay nắm 6px hiện khi rê chuột, con trỏ `ew-resize`. |
| Nối phụ thuộc | Rê lên thanh thì hiện hai chấm 8px ở hai đầu. Kéo từ chấm sang thanh khác. Đường cong đi theo chuột. Thanh đích hợp lệ sáng viền `--focus`. Thả lên đầu trái là SS/FS, lên đầu phải là FF/SF, mặc định FS. Hoặc chọn 2+ dòng rồi `Shift L` để nối chuỗi FS theo thứ tự chọn (TeamGantt: Shift+D). |
| Bản đồ nhỏ | Dải 24px ở đáy vùng thời gian: toàn bộ dự án thu nhỏ (mỗi việc là một vạch 1px), khung xám là phần đang nhìn. Kéo khung để cuộn, bấm để nhảy. Tắt được trong Hiển thị. |
| Thu phóng | `Ctrl` + lăn chuột (đã có, giữ nguyên neo dưới con trỏ). `-` `=` theo nấc. Nhãn trục ở thang Ngày chỉ hiện số ngày, đầu tuần hiện "T2 4/11". |
| Cuộn tới hôm nay | `T`. Cuộn mượt 320ms `--e-move`. Khi vạch son nằm ngoài màn hình, mép bên đó có nút nhỏ "◂ Hôm nay" nền `--son`. |

#### 6.1.6. Bản nháp kế hoạch (F1)

- Bật: phím `Shift D` hoặc Hiển thị › "Chế độ nháp". Một dải 28px màu `--caution` 15% chạy ngang dưới thanh lọc: "Đang nháp: chưa ghi gì lên Jira · 0 thay đổi · [Bỏ nháp] [Áp dụng]". Viền trái của mặt làm việc đổi sang nét đứt `--caution` 2px.
- Trong nháp, mọi kéo thả, đổi ngày, đổi người, thêm/bỏ phụ thuộc chỉ đổi trạng thái cục bộ. Thanh đã thay đổi có viền nét đứt `--caution` và bóng mờ vị trí gốc.
- "Xem thay đổi" mở khung phải: danh sách theo việc, `DEMO-5 · bắt đầu 12/11 → 15/11 · do kéo` hoặc `DEMO-8 · bị đẩy theo DEMO-5`. Bỏ từng thay đổi được (bấm `×`, việc bị đẩy theo cũng tự quay lại).
- Tóm tắt luôn hiện: "Kết thúc dự án 20/11 → 27/11 (+5 ngày làm việc)".
- "Áp dụng": ghi lần lượt (như `runBulk`), thanh tiến độ trong dải nháp. Mỗi việc ghi xong thì viền nét đứt chuyển thành viền liền trong `--d-3`. Lỗi gom lại cuối cùng.
- Nháp tồn tại qua F5 (`localStorage` theo site + tài khoản + dự án). Khi dữ liệu Jira đổi dưới bản nháp (task bị người khác sửa), dải nháp báo "2 việc đã đổi trên Jira từ lúc bạn nháp · [Xem]".

#### 6.1.7. Thanh công cụ trên cùng của Kế hoạch

Không còn thanh riêng. Mọi thứ nằm ở thanh lọc chung (5.4) và Hiển thị. Hoàn tác / Thu gọn / Mở rộng chuyển thành phím (`Ctrl Z`, `Shift ←`, `Shift →`) và lệnh trong `Ctrl K`.

### 6.2. Khung chi tiết việc (thay `TaskEditModal`)

#### 6.2.1. Hình thức

- Khung trượt từ phải, rộng 560px (kéo được 440–880px, nhớ trong `gms.peek.width`). Nền `--raised`, viền trái `--line`, `--shadow-float`. **Không lớp mờ**: kế hoạch bên trái vẫn thấy và vẫn dùng được. Bấm dòng khác ở bảng thì khung đổi nội dung tại chỗ (chữ mờ ra rồi vào 90ms, khung không chạy lại).
- Vào: `translateX(24px) → 0` + mờ dần vào, `--d-3 --e-out`. Nội dung mờ vào chậm hơn 60ms. Ra: ngược lại với `--e-in`, 150ms.
- `Esc` đóng. `↑` `↓` (khi không ở trong ô) đổi sang việc trước/sau trong danh sách đang lọc. `Ctrl Enter` không còn cần.
- Nút "⤢" phóng toàn màn hình: mặt đọc rộng 760px ở giữa, cho mô tả dài và bình luận.
- `Space` trên một dòng: "xem nhanh", cùng khung nhưng chỉ đọc, đóng khi nhả `Space`.

#### 6.2.2. Bố cục

```
┌──────────────────────────────────────────────────────────┐
│ ◫ DEMO-3 · Story               ↗ Jira   ⧉   ⤢   ⋯   ✕   │ 40px, dính trên cùng
├──────────────────────────────────────────────────────────┤
│ Phân tích yêu cầu                                        │ --t-title, sửa tại chỗ
│                                                          │
│ ◑ In Progress ▾   ◉ Nguyễn Anh ▾   ↑ Cao ▾               │ 3 "viên" thuộc tính chính
│ 29/10 → 01/11 · 4 ngày ▾      ▓▓▓▓▓░░░ 60%               │
│                                                          │
│ Mô tả                                                    │
│ Thêm mô tả…  (bấm để viết; / để chèn)                    │ ô rỗng chỉ cao 1 dòng
│                                                          │
│ Phụ thuộc lịch                                       ＋  │ chỉ hiện tiêu đề khi rỗng
│  ← sau  DEMO-4 Viết tài liệu BRD   FS   ●✓              │
│  → trước DEMO-5 Thiết kế CSDL      FS   ○   chờ bạn 2n  │
│                                                          │
│ Thêm chi tiết ▾   (ước lượng, nhãn, sprint, thành phần,  │ gập: chỉ mở khi cần
│                    phiên bản, việc cha, liên kết Jira,   │
│                    người theo dõi, SLA)                  │
│                                                          │
│ Đính kèm 2                                           ＋  │
│ ▢ man-hinh-dang-nhap.png   ▢ dac-ta.pdf                  │
│                                                          │
│ Hoạt động       Bình luận · Lịch sử · Giờ đã ghi         │
│ ─────────────────────────────────────────────────────    │
│ Anh · 2 giờ trước                                        │
│ Đã gửi bản nháp cho @Chi xem                             │
│ ┌──────────────────────────────────────────────────┐     │
│ │ Viết bình luận… @ để nhắc tên        Ctrl ⏎  ➤  │     │ dính đáy
│ └──────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

Không còn footer "Xoá task / + Sub-task / Huỷ / Lưu & đồng bộ Jira" (T3). Xoá nằm trong `⋯` (cuối menu, chữ `--risk`, xác nhận). Sub-task là "＋" trong mục "Việc con". Lưu là tự động.

#### 6.2.3. Từng thuộc tính

| Thuộc tính | Hiển thị | Sửa | Lưu |
|---|---|---|---|
| Tiêu đề | `--t-title`, xuống dòng tự nhiên | Bấm để sửa. `Enter` lưu (không xuống dòng), `Esc` huỷ | Khi rời ô |
| Trạng thái | Viên: biểu tượng nhóm + tên | Bấm/`S`: danh sách bước cho phép. Ô bắt buộc của bước hiện ngay trong viên | Ngay. Toast + Hoàn tác (nếu workflow cho quay lại) |
| Người phụ trách | Viên: avatar + tên. "Chưa giao" mờ | Bấm/`A`: danh sách, đầu danh sách là **gợi ý**: 2 người ít xung đột nhất trong khoảng ngày của việc, mỗi người một dòng lý do ("rảnh 3/4 ngày", nhãn `AI` nếu từ trợ lý, nhãn `tính` nếu từ `autoAssign`). Epic: viên bị khoá, tooltip giải thích luật | Ngay + Hoàn tác |
| Ưu tiên | Viên dấu + tên. "Trung bình" chỉ là chữ mờ | Bấm: danh sách ưu tiên **của site** | Ngay |
| Lịch | `29/10 → 01/11 · 4 ngày` | Bấm mở **bộ chọn ngày của app** (không dùng `<input type=date>`, sửa T2): lịch tháng, kéo chọn khoảng, ô gõ nhanh nhận "t6", "15/11", "+3n". Luôn `DD/MM`. Thời lượng hiện "4 ngày (làm việc 4)" | Khi đóng bộ chọn. Cascade chạy, việc bị đẩy theo nhấp sáng viền 1 lần ở bảng bên trái |
| % | Thanh nhỏ + số | Bấm số để gõ, hoặc kéo trên thanh, bám theo 5% | Khi nhả |
| Mô tả | Chữ thường, link bấm được | Bấm để viết. Lưu tự động sau 1.2s ngừng gõ và khi rời ô. Có chữ mờ "Đã lưu" 1s. Vẫn giữ luật: chưa tải xong mô tả thì khoá ô và không gửi trường này | Debounce |
| Phụ thuộc | Hai nhóm "sau" và "trước", mỗi dòng: mã, tên, loại, trạng thái, và nếu tôi đang chặn ai thì "chờ bạn 2n" | "＋" mở ô tìm việc (gõ mã hoặc tên). `FS` là chip bấm để đổi loại, `+0` là chip bấm để nhập độ trễ. Chặn vòng lặp trước khi gửi | Ngay |
| Bình luận | Dòng thời gian, mới nhất dưới cùng | Ô dính đáy, `@` gợi ý tên, `Ctrl Enter` gửi. Gửi xong: bình luận hiện ngay ở trạng thái mờ 60% "đang gửi", rồi đậm lên | Khi gửi |

**Gom ghi để bớt thông báo Jira.** Mỗi lần `PUT /issue` có thể sinh một email thông báo. Vì vậy thay đổi ở các ô *không phải* trạng thái/người/bình luận (ngày, %, nhãn, ước lượng, mô tả) được gom trong 1.5s, hoặc khi đóng khung, thành **một** lần ghi. Trạng thái và người phụ trách vẫn ghi ngay, vì người dùng chờ thấy kết quả.

### 6.3. Ô lệnh `Ctrl K` (F6)

- Mở: `Ctrl K` hoặc `Cmd K` ở bất cứ đâu. **Không hiệu ứng** (`--d-0`, vì là thao tác bàn phím lặp lại). Khung 640px giữa màn hình, cách đỉnh 18vh, nền `--raised`, `--shadow-float`, lớp phủ `--ink` 8%.
- Ô nhập 48px, chữ `--t-lead`. Dưới là danh sách kết quả, tối đa 8 dòng nhìn thấy, mỗi dòng 36px.
- **Bốn chế độ, không phải chọn trước**:
  1. **Lệnh** (mặc định khi ô trống): "Gần đây" (5 lệnh cuối), rồi lệnh theo ngữ cảnh. Nếu đang chọn việc: "Đổi trạng thái… S", "Giao cho… A", "Dời ngày… D", "Đặt baseline", "Sao chép mã". Không chọn gì: "Tạo việc C", "Đi tới Hôm nay G H", "Chuyển dự án Ctrl P", "Bật chế độ nháp Shift D", "Đổi giao diện tối". Mỗi dòng có phím ở bên phải, mờ (Superhuman: ô lệnh dạy phím tắt).
  2. **Tìm**: gõ "DEMO-12" hoặc chữ thì nhóm "Việc" hiện các việc khớp (mã, tên, không dấu: "dang nhap" khớp "đăng nhập"), kèm biểu tượng trạng thái và người. `Enter` mở chi tiết. `→` xem nhanh ngay trong ô lệnh.
  3. **Tạo**: gõ câu có token (`@`, `!`, `^`, `#`, ngày, "sau …") hoặc bắt đầu bằng `+`, thì dòng đầu tiên thành "＋ Tạo: <tên>" kèm các chip đã nhận ra (6.4).
  4. **Hỏi trợ lý**: dòng cuối luôn là "✎ Hỏi trợ lý: “<câu đang gõ>”  Tab". `Tab` (hoặc câu kết thúc bằng `?`) chuyển ô lệnh thành khung hội thoại: ô cao lên thành 70vh, câu trả lời chảy vào bên dưới, kèm nút Dừng. Đây là `ChatDock` cũ, cùng luồng SSE, cùng công cụ, nhưng mở ra từ nơi người dùng đã đứng.
- Lọc kết quả khi gõ: độ trễ 0 cho lệnh (cục bộ), 150ms cho tìm việc (cũng cục bộ, trên `tasks` đã tải). Chỉ trợ lý mới gọi mạng.
- `Esc`: đóng (nếu đang trong hội thoại thì về ô lệnh trước, `Esc` lần nữa mới đóng).

### 6.4. Tạo nhanh bằng câu (F2)

Mở bằng `C` (ô lệnh ở chế độ Tạo), hoặc gõ thẳng ở dòng "＋ Thêm việc", "＋" trên cột Bảng.

**Cú pháp** (không phân biệt hoa thường và dấu):

| Token | Ví dụ | Nghĩa |
|---|---|---|
| `@tên` | `@chi`, `@lê chi`, `@tôi` | Người phụ trách (dùng `resolvePerson`: trùng nhiều người thì chip vàng "Chi? (2 người)", bấm để chọn) |
| Ngày | `mai`, `ngày kia`, `t6`, `thứ 6 tuần sau`, `15/11`, `15/11–20/11` | Ngày bắt đầu, hoặc khoảng |
| Thời lượng | `3n`, `3 ngày`, `2t` (tuần) | `durationDays` |
| Ước lượng | `4h`, `4g`, `1.5h` | Original estimate |
| `!` | `!khẩn`, `!cao`, `!thấp`, `!!` | Ưu tiên (map sang tên ưu tiên của site) |
| `^` | `^DEMO-2`, `^giai đoạn 2` | Việc cha / Epic (tìm theo mã hoặc tên) |
| `sau` / `trước` | `sau DEMO-5`, `sau "thiết kế csdl"` | Phụ thuộc FS. Ngày bắt đầu tự tính nếu không nói |
| `#` | `#backend` | Nhãn |
| `/loại` | `/bug`, `/story` | Loại issue (theo loại của dự án) |
| `*sprint` | `*sprint 8`, `*tiếp` | Sprint (cần `JIRA_AGILE`) |

**Hiển thị khi gõ**: token nhận ra được thì tô ngay trong ô, nền nhạt theo loại (người: `--select`, ngày: `--sunken`, ưu tiên: `--risk-wash`…), bo `--r-1`, xuất hiện trong `--d-1`. Dưới ô là một dòng xem trước: `☐ Task · Dựng API đăng nhập · Lê Chi · 15/11 → 17/11 (sau DEMO-5) · Cao · #backend`. Rê lên chip thì có `×` để bỏ token đó (chữ trở lại thành chữ thường của tên).

**`Enter`**: tạo, toast "Đã tạo DEMO-31 · Mở `Enter`". Ô vẫn mở và trống để tạo tiếp. `Shift Enter`: tạo rồi mở chi tiết. `Ctrl Enter`: tạo hàng loạt nếu dán nhiều dòng.

**Kiểm tra trùng** (đã có `create_task` + `similarity.ts`): nếu có việc giống, dòng xem trước hiện "Có thể trùng DEMO-12 “Dựng API login” · [Vẫn tạo] [Mở DEMO-12]" trước khi tạo.

Bộ phân tích là module thuần `client/src/quickAdd.ts`, có test cho từng token, và cho các trường hợp tiếng Việt dễ nhầm ("đang"/"đăng", "t6" vs mã issue "T6-1").

### 6.5. Hôm nay (trang chủ mới)

Mặc định mở trang này sau khi đăng nhập và khi bấm logo. Phạm vi: dự án đang chọn. Bản sau: mọi dự án, xem 13.Q3.

```
Thứ Sáu, 6 tháng 11                                           ◑ 3 đang làm · 2 đến hạn tuần này
Chào Tuấn. 2 người đang chờ việc của bạn.                      (câu do code dựng, không phải AI)

Đang chờ bạn ─────────────────────────────────────────────────────────────────────────
  ◑ DEMO-3 Phân tích yêu cầu      hạn hôm nay   → Chi chờ (DEMO-5, trễ 2n nếu bạn trễ)   ✓
  ○ DEMO-9 Chốt API              hạn 8/11      → Bình chờ (DEMO-12)                     ✓

Hôm nay ───────────────────────────────────────────────────────────────────────────────
  ◑ DEMO-14 Sửa form đăng ký                    đang làm từ 2 ngày
  ○ DEMO-17 Viết test API                        bắt đầu hôm nay
  ＋ Thêm việc cho hôm nay…

Sắp tới ───────────────────────────────────────────────────────────────────────────────
  T2 9/11   ○ DEMO-21 Review thiết kế
  T4 11/11  ○ DEMO-22 Demo khách hàng   ◆ mốc

Có thay đổi với việc của bạn ──────────────────────────────────────── (giai đoạn 7)
  Anh bình luận trong DEMO-3 · 20 phút trước: “@Tuấn xem giúp…”

───────────────────────────────────────────────────────────────────────────────────────
  Ghi giờ hôm nay  ·  chưa ghi  ·  gợi ý 7h trên 3 việc            [Ghi giờ  G T]
```

| Phần tử | Hành vi |
|---|---|
| Câu chào | Ghép bằng code từ số liệu: số người đang chờ, việc quá hạn của tôi, ngày nghỉ. Không có thì "Không có gì gấp. Chúc một ngày tập trung." |
| Dòng việc | Giống một dòng bảng: `j/k`, `Enter` mở khung chi tiết bên phải, `S` `A` `D` như mọi nơi. |
| Vòng ✓ cuối dòng | Bấm (hoặc `X` khi đang ở dòng) để chuyển sang bước "xong" của workflow. Hiệu ứng: vòng đổ đầy `--st-done` trong 150ms, dấu tick vẽ bằng `stroke-dashoffset` 180ms, dòng mờ xuống 50% rồi thu gọn chiều cao sau 1.2s (đủ để bấm Hoàn tác). Nếu workflow cần ô bắt buộc thì popover mở ngay tại vòng. |
| "Đang chờ bạn" | Tính từ `task_dependency`: việc của tôi chưa xong mà có việc sau thuộc người khác. Sắp theo ngày bắt đầu sớm nhất của việc sau. "Trễ 2n nếu bạn trễ" = slack âm khi việc của tôi trễ 1 ngày. |
| Kéo thả | Kéo từ "Sắp tới" lên "Hôm nay" thì đổi ngày bắt đầu sang hôm nay (có toast Hoàn tác). |
| "Ghi giờ hôm nay" | Dải dính đáy, chỉ hiện từ 15:00 hoặc khi còn ngày trong tuần chưa ghi. Bấm (hoặc `G T`) mở tờ ghi giờ (6.9). |

### 6.6. Bảng (Kanban / Scrum)

| Phần | Thay đổi |
|---|---|
| Đầu sprint | Thành **một dòng 36px**: `Sprint 7 · 01/11–15/11 · còn 6 ngày làm việc  ▓▓▓░░░ 17% xong · nhịp chậm ⚠  ⋯`. Bấm vào dòng mở popover: burndown đủ lớn để đọc (480×220), mục tiêu, "Phân tích sprint" (AI), "Hoàn thành sprint". Thôi chiếm 120px (B1). |
| Chọn board, Sprint/Backlog | Bộ chọn board vào menu ở tên board, cạnh dòng sprint. "Sprint đang chạy / Backlog" là hai chữ như lăng kính, phím `B` để đổi. |
| Đầu cột | `Chưa làm  5 việc · 12 điểm`. Có chữ, không đoán (B2). WIP: `3/4` ở góc phải, vượt thì số đổi `--risk` và cột có viền trên 2px `--risk`. |
| Thẻ | Nền `--raised`, viền `--line`, bo `--r-3`, **không bóng** khi nghỉ. Dòng 1: tên (2 dòng tối đa). Dòng 2: mã mono `--ink-3` · Epic (chữ mờ, không viên màu) · cảnh báo · điểm · avatar 20px. Chưa giao: không vẽ gì (bỏ "?", B3). Hover: viền `--line-strong`, `--d-1`. |
| Phím | `j/k` trong cột, `h/l` sang cột bên, viền focus quanh thẻ. `Shift h/l`: chuyển thẻ sang cột bên (kiểm tra bước workflow cho phép). Thẻ trượt sang trong `--d-3 --e-move`. Cột đích không cho phép thì thẻ rung ngang 3px. `Enter` mở chi tiết, `Space` xem nhanh. |
| Kéo thẻ | Thẻ nổi lên `--shadow-float`, nghiêng 1.5° (cảm giác cầm). Chỗ cũ để lại khung nét đứt. Cột đích được phép: nền `--select` 50%. Cột không được phép: mờ 40% (đã có logic hỏi `/transitions` khi bắt đầu kéo). Thả: thẻ trượt vào chỗ, hết nghiêng, `--d-2`. |
| Cột rỗng | Gập thành dải 40px (giữ hành vi hiện tại), tên cột dọc. |
| "＋ Thêm" | Cuối mỗi cột, hiện khi rê chuột. Gõ được cú pháp nhanh (6.4). |
| Làn | "Nhóm theo: Không / Người / Epic" vào Hiển thị. Đầu làn dính khi cuộn. |
| Backlog | Dòng 32px như bảng Kế hoạch: biểu tượng trạng thái (bấm để đổi, không phải dropdown "TO DO"), mã, tên, Epic mờ, điểm, avatar. Kéo dòng giữa các sprint. Chọn nhiều + `Shift ↑/↓` để chuyển nhanh lên/xuống sprint. |
| AI | "Lập kế hoạch sprint" và "Ước lượng" vẫn có, nhưng là lệnh trong `⋯` của sprint và trong `Ctrl K`. Kết quả là chip nét đứt `--ai` có nhãn "AI" + "Vì sao?" ngay trên dòng, chấp nhận từng cái (`Enter`) hoặc tất cả. |

### 6.7. Nhân lực

```
Mức tải · Kỹ năng       [Tìm người]  Sắp: Ít rảnh nhất ▾              Tuần ▾   ⋯
──────────────────────────────────────────────────────────────────────────────────────────
                       T10          │ W45 ┃ W46     W47     W48  …
Nguyễn Anh   8h/ngày   ▁▂▅█▆▂       │ ▅█▇ ┃ ▃▂      ·       ·
Lê Chi       8h/ngày                │ ▂▅█ ┃ ██▇█    ▲▲      ·          ← ▲ = quá tải (đỏ, có gạch)
Trần Bình    6h/ngày                │     ┃ ▇█▆     ▂       ·
Tuấn Test    8h/ngày   (nghỉ 10–12/11) ░░░ ┃
──────────────────────────────────────────────────────────────────────────────────────────
Chưa giao (3)  ▸   DEMO-7 Sửa lỗi hiển thị · DEMO-31 …                 kéo vào một người
```

| Phần | Thiết kế |
|---|---|
| Ô | **Biểu đồ cột trong ô** ("đường chân trời") thay số %. Chiều cao cột = mức tải ngày đó (0 → 100% = đầy ô). Màu: `--ink-4` khi ≤ 100%. Phần vượt 100% vẽ trồi lên trên đỉnh ô, màu `--risk` có gạch chéo. Ô 0% **để trống** (D5). Số chính xác chỉ hiện khi rê chuột ("Th 4 12/11 · 10h / 8h · 3 việc"). |
| Thang Tuần/Tháng | Mỗi ô là một tuần/tháng, cột là trung bình, kèm một vạch `--risk` nếu có ngày nào trong đó quá tải. |
| Ngày nghỉ, lễ | Nền gạch chéo `--sunken`. Có việc rơi vào ngày nghỉ: viền `--risk`. |
| Màu | Bỏ hẳn vàng/xanh lá (M2). Chỉ còn: bình thường (mực nhạt) và quá tải (đỏ). Rảnh là *khoảng trống*, mắt tự thấy. |
| Chỉ số | Bỏ "Hiệu suất TB" (M3). Thay bằng "Mức sử dụng 62% · 1 người quá tải · 3 việc chưa giao" một dòng `--t-small` dưới tiêu đề. |
| Sắp xếp | "Ít rảnh nhất" (Runn), "Rảnh nhất", "Tên", "Quá tải". Mặc định là "Quá tải trước". |
| Mở một người | Bấm tên (hoặc `Enter`): các việc của người đó mở ngay dưới, thanh trên cùng cột thời gian (đã có `ResourcePersonBlock`). Mở/đóng trong `--d-3`. |
| Giao việc | Kéo thanh việc từ người này sang dòng người khác. Khi đang kéo, các dòng người hiện **bóng xem trước** mức tải sau khi nhận (cột ma `--focus` 30%). Thả vào người sẽ quá tải: popover hỏi (Resource Guru) **"Lê Chi sẽ quá tải 2 ngày (12–13/11)"** với ba lựa chọn: `[Vẫn giao]` `[Giao và dời sang 14/11]` (tính từ lịch của người đó) `[Huỷ]`. |
| Chưa giao | Dải gập ở đáy (thay thẻ nổi kéo được). Mở ra là danh sách ngang các việc, kéo vào người. |
| Gợi ý cân tải (F5) | Nút trong `⋯` và lệnh `Ctrl K`. Mở *bản nháp* (6.1.6) với các thay đổi đề xuất, mỗi thay đổi có lý do ("dời DEMO-9 sang 14/11, còn dư 3 ngày nên không trễ ai"). |
| Hồ sơ người | Giữ ngăn kéo `ResourceProfileDrawer`, nhưng dùng chung khung phải với chi tiết việc (cùng kích thước, cùng hiệu ứng). |

### 6.8. Nhịp dự án (thay "Báo cáo")

```
Nhịp dự án · tính đến hôm nay 6/11                                         [So sánh] [Xuất PDF]

  Chậm 4 ngày so với kế hoạch.                                                  ← --t-title
  Nguyên nhân chính: 3 việc trên đường găng chưa có người, và DEMO-5 đã trễ 2 ngày.
  Dự kiến xong 24/11 (kế hoạch 20/11).

Cần bạn quyết ────────────────────────────────────────────────────────────────────────
  ┌───────────────────────────┐ ┌───────────────────────────┐ ┌─────────────────────────┐
  │ DEMO-7 chưa có người      │ │ DEMO-5 trễ 2 ngày          │ │ Lê Chi quá tải 12–13/11 │
  │ trên đường găng, bắt đầu  │ │ đang chặn DEMO-6, DEMO-8   │ │ 2 việc trùng ngày       │
  │ sau 3 ngày                │ │                            │ │                         │
  │ Gợi ý: Trần Bình (rảnh)   │ │                            │ │                         │
  │ [Giao cho Bình] [Chọn…]   │ │ [Nhắc Anh] [Xem phụ thuộc] │ │ [Cân tải] [Mở Nhân lực] │
  └───────────────────────────┘ └───────────────────────────┘ └─────────────────────────┘

Tiến độ ──────────────────────────────────────────────────────────────────────────────
  Thực tế   ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  17%
  Kế hoạch  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░  33%     (bullet chart, không donut)
  Đường tích lũy (burnup) theo tuần, thực tế vs baseline ………………………………

Theo giai đoạn · Theo người · Chất lượng số liệu                 (thẻ gập, bấm để mở)
```

| Phần | Thiết kế |
|---|---|
| Câu kết luận | Dựng bằng code từ `judgeHealth` (các lý do đã có) và `criticalPath`. Không phải AI, nên luôn có, luôn khớp số. Cỡ `--t-title`. Từ khoá ("Chậm 4 ngày") màu `--risk`. Đúng tiến độ thì màu `--st-done`. Sửa R3. |
| "Cần bạn quyết" | Tối đa 3 thẻ, chọn theo mức nghiêm trọng từ `computeProgress` + nhân lực. Mỗi thẻ có **một nút hành động thật** (giao, nhắc, cân tải), gọi đúng các đường sẵn có. Làm xong: thẻ thu lại và thẻ tiếp theo trượt lên, `--d-3`. |
| SPI và thuật ngữ | Ẩn khỏi bề mặt. Có trong "Chất lượng số liệu" kèm giải thích bằng lời ("SPI 0,5: mới làm được một nửa so với kế hoạch đến hôm nay"). Sửa R2. |
| Biểu đồ | Bullet chart cho thực tế vs kế hoạch. Burnup cho xu hướng. Bỏ hai donut (R1). Mọi phần tử bấm được để mở danh sách việc (giữ `TaskDrawer`, nhưng dùng khung phải chung). |
| AI | Bỏ khung tím (N3). Nút "Phân tích sâu" (chữ, không gradient) ở góc. Kết quả chèn ngay *dưới câu kết luận* dạng đoạn văn có viền trái 2px `--ai`, nhãn nhỏ "AI · viết lúc 09:12 · số liệu đã đổi từ đó ⚠" (giữ logic hai lớp hiện có). Rủi ro và khuyến nghị của AI là các dòng có mã issue bấm được, không phải thẻ màu. |
| So sánh | Bộ chọn hai mốc (giữ `ReportCompare`). |

### 6.9. Ghi giờ (thay phần lớn tab Chấm công)

**Tờ "Ghi giờ hôm nay"** (khung phải, 480px):

```
Ghi giờ · Thứ Sáu 6/11 · năng lực 8h

  DEMO-14 Sửa form đăng ký        đang làm         [ 3h ] − +
  DEMO-3  Phân tích yêu cầu       đổi trạng thái   [ 2h ] − +
  DEMO-17 Viết test API           bình luận        [ 2h ] − +
  ＋ Thêm việc khác…

  Tổng 7h / 8h                                       [Ghi tất cả  ⏎]
  Gợi ý dựa trên việc bạn đã đụng hôm nay, không phải đo thời gian thật.
```

- `Tab` qua các ô giờ, gõ "1.5" hoặc "1h30". `↑↓` ±0.5h. Ô để 0 thì không ghi.
- "Ghi tất cả": tạo worklog lần lượt (như `log_work`), ghi bằng tài khoản của chính người dùng, như luật hiện có. Mỗi dòng ghi xong hiện ✓ nhỏ.
- Gợi ý chia năng lực còn lại theo trọng số: đang làm (3) > đổi trạng thái hôm nay (2) > bình luận/sửa hôm nay (1). Làm tròn 0.5h.

**Màn "Giờ của nhóm"** (cho quản lý, mở từ `Ctrl K` hoặc menu dự án):

- Giữ lưới người × ngày, nhưng thay chấm cam bằng ô trống viền nét đứt `--line-strong` (trung tính, không kết tội, M4).
- 3 thẻ KPI gộp thành một dòng: "Đã ghi 10h / dự kiến 160h · 4 người còn ngày chưa ghi · 0 ngày vượt".
- Bấm ô ngày của mình: ô gõ giờ tại chỗ.

### 6.10. Trợ lý: còn lại gì sau khi gộp vào `Ctrl K`

- Bỏ viên nổi "Trợ lý dự án" (R4).
- Hội thoại mở trong ô lệnh (6.3), có nút "Ghim sang bên" để chuyển thành khung phải 440px (dùng chung chỗ với khung chi tiết) cho cuộc trò chuyện dài.
- Bỏ số token khỏi chân khung (R5). Đưa vào Cài đặt dự án › "Chi phí AI" cho người cần.
- Khi trợ lý sửa dữ liệu (sự kiện `mutated`), dòng bị ảnh hưởng trên bảng nhấp sáng nền `--select` một lần (600ms), để người dùng *thấy* nó đã làm gì.
- Lọc do trợ lý đặt (`set_view_filter`) hiện thành chip có nhãn `AI` trên thanh lọc, xoá như chip thường.

### 6.11. Đăng nhập, chọn dự án, cài đặt, hẹp màn hình

- **Đăng nhập**: một mặt `--paper`, logo son, câu "Lập kế hoạch trên Jira, nhanh hơn Jira.", một nút mực "Đăng nhập bằng Atlassian". Bên dưới, chữ nhỏ về quyền và link `privacy.html`. Lỗi (`?auth_error=`) là một dòng `--risk` trên nút, có câu giải thích và cách sửa.
- **Chọn dự án lần đầu**: chính là bảng `Ctrl P` (5.3), mở toàn trang.
- **Cài đặt dự án**: một trang, menu trái: Chung · Lịch làm việc & ngày lễ · SLA · Nhập KBKT · Chi phí AI. Gom các cửa sổ `SlaSettingsModal`, `WorkCalendarModal` thành trang (mỗi mục một route nội bộ, không cửa sổ). Ai không phải quản trị thì thấy chế độ chỉ đọc, như luật hiện có.
- **Màn hẹp** (< 900px): rail thành thanh đáy 56px (Hôm nay, Dự án, Tìm, Tài khoản). Khung chi tiết thành trang toàn màn hình. Hôm nay, Bảng và chi tiết dùng được ở 390px. Kế hoạch và Nhân lực hiện "Mở trên máy tính để xem đầy đủ" kèm danh sách việc dạng dòng.

---

## 7. Bảng phím tắt

Một module `client/src/shortcuts.ts` giữ toàn bộ danh sách, từ đó sinh: bảng `?`, phím hiện trong ô lệnh, và tooltip. Không phím nào chạy khi đang gõ trong ô nhập, trừ những phím có `Ctrl`/`Cmd`. Chuỗi hai phím (`G H`) có thời gian chờ 800ms; trong lúc chờ, góc dưới trái hiện "G…" mờ.

| Nhóm | Phím | Việc |
|---|---|---|
| **Chung** | `Ctrl K` | Ô lệnh |
| | `Ctrl P` | Chuyển dự án |
| | `?` | Bảng phím tắt |
| | `C` | Tạo việc nhanh |
| | `/` | Focus ô tìm/lọc |
| | `Shift R` | Đọc lại từ Jira |
| | `Ctrl Z` / `Ctrl Shift Z` | Hoàn tác / làm lại |
| | `Esc` | Đóng lớp trên cùng. Không còn lớp nào thì bỏ chọn |
| **Đi tới** | `G H` | Hôm nay |
| | `G I` | Hộp thư |
| | `1` `2` `3` `4` | Kế hoạch / Bảng / Nhân lực / Nhịp |
| | `G T` | Ghi giờ hôm nay |
| | `G S` | Cài đặt dự án |
| **Danh sách** | `j` `k` hoặc `↓` `↑` | Dòng/thẻ sau, trước |
| | `h` `l` | Cột bên (Bảng) |
| | `Shift ↓` `Shift ↑` | Mở rộng vùng chọn |
| | `X` | Chọn/bỏ chọn dòng (không làm xong việc. Ở Hôm nay, `X` trên vòng ✓ là xong) |
| | `Ctrl A` | Chọn tất cả (đang lọc) |
| | `Enter` | Mở chi tiết |
| | `Space` (giữ) | Xem nhanh |
| | `Shift ←` `Shift →` | Thu gọn / mở rộng nhóm |
| **Việc đang chọn** | `S` | Đổi trạng thái |
| | `A` | Giao người |
| | `I` | Giao cho tôi |
| | `P` | Ưu tiên |
| | `D` | Đổi ngày |
| | `F2` | Sửa tên |
| | `Alt ←` `Alt →` | Dời 1 ngày |
| | `Alt Shift ←` `Alt Shift →` | Dời 1 tuần |
| | `Tab` / `Shift Tab` | Thụt vào / ra (WBS) |
| | `Shift L` | Nối phụ thuộc FS theo thứ tự chọn |
| | `Ctrl .` | Sao chép mã |
| | `Delete` | Xoá (có xác nhận) |
| **Kế hoạch** | `T` | Cuộn tới hôm nay |
| | `-` `=` | Thu / phóng |
| | `Shift D` | Bật/tắt chế độ nháp |
| | `Shift C` | Bật/tắt đường găng |
| **Lọc** | `M` | Của tôi |
| | `O` | Quá hạn |
| | `F` | Mở "＋ Lọc" |
| | `Shift F` | Xoá mọi lọc |

---

## 8. Bảng chuyển động

| # | Khoảnh khắc | Thuộc tính | Thời gian | Đường cong | Ghi chú |
|---|---|---|---|---|---|
| A1 | Hover dòng, nút, thẻ | nền, viền | 90ms | linear | Không có hiệu ứng *ra*, đổi ngay khi rời |
| A2 | Nhấn nút | `scale(0.98)` | 90ms | `--e-out` | Chỉ nút có chữ. Không làm lệch bố cục (scale không đổi hộp) |
| A3 | Mở menu, popover | `opacity 0→1`, `translateY(-4px→0)`, `scale(.98→1)` từ phía nút | 150ms | `--e-out` | Đóng: 100ms `--e-in`, chỉ opacity |
| A4 | Tooltip | opacity | 120ms, trễ 400ms | linear | Tooltip thứ hai trong vòng 1s hiện ngay (không trễ) |
| A5 | Gạch chân lăng kính trượt | `translateX`, `scaleX` | 150ms | `--e-move` | Đổi bằng phím `1–4`: 0ms |
| A6 | Đổi lăng kính bằng chuột | View Transitions API: việc đang chọn biến hình (thanh ↔ thẻ ↔ dòng người), còn lại mờ chéo | 320ms | `--e-move` | Không hỗ trợ API hoặc giảm chuyển động: mờ chéo 90ms |
| A7 | Khung chi tiết vào | `translateX(24px→0)`, opacity | 220ms | `--e-out` | Nội dung trễ 60ms. Đổi việc trong khung: nội dung mờ 90ms, khung đứng yên |
| A8 | Khung chi tiết ra | `translateX(0→16px)`, opacity | 150ms | `--e-in` | |
| A9 | Ô lệnh mở/đóng | — | 0ms | — | Bàn phím, lặp lại (Raycast không có hiệu ứng mở) |
| A10 | Chip token trong tạo nhanh | nền từ trong suốt → màu, `scale(.96→1)` | 90ms | `--e-out` | |
| A11 | Toast vào | `translateY(8px→0)`, opacity | 220ms | `--e-out` | Chồng: toast cũ `scale(.96)`, `translateY(-6px)` |
| A12 | Toast ra | opacity, `translateY(4px)` | 150ms | `--e-in` | |
| A13 | Thanh Gantt thả | `translateX` về ô ngày | 150ms | `--e-move` | Trong khi kéo: 0ms, bám chuột tuyệt đối |
| A14 | Việc bị cascade đẩy | `translateX` tới chỗ mới + viền `--focus` sáng rồi tắt | 220ms + 600ms | `--e-move` | Lệch nhau 30ms theo thứ tự BFS (tối đa 10 thanh, quá thì đồng thời): người dùng *thấy* chuỗi đổ |
| A15 | Mũi tên phụ thuộc mới | `stroke-dashoffset` từ đầu tới đích | 220ms | `--e-out` | |
| A16 | Đánh dấu xong ở Hôm nay | vòng đổ đầy → tick vẽ → dòng mờ 50% → thu chiều cao | 150 + 180 + (chờ 1200) + 220ms | `--e-out` | Hoàn tác trong lúc chờ thì đảo ngược toàn bộ |
| A17 | Dòng mới (Enter ở "＋ Thêm") | chiều cao 0→32px, opacity | 150ms | `--e-out` | |
| A18 | Nhóm WBS đóng/mở | mũi tên xoay 90°; dòng con theo chiều cao | 150ms / 220ms | `--e-move` | > 30 dòng con: 0ms |
| A19 | Thẻ Kanban nhấc lên | `--shadow-float`, `rotate(1.5deg)`, `scale(1.02)` | 120ms | `--e-out` | Thả: ngược lại 150ms |
| A20 | Thẻ chuyển cột bằng phím | FLIP: `translate` từ chỗ cũ sang mới | 220ms | `--e-move` | |
| A21 | Từ chối (thả sai, thụt sai) | `translateX` 0 → 3 → -3 → 2 → 0 | 240ms | linear | Kèm tooltip lý do. Không âm thanh |
| A22 | Lưu tự động một ô | chữ "Đã lưu" mờ vào, giữ 1s, mờ ra | 90 / 1000 / 150ms | linear | Không spinner nếu < 200ms |
| A23 | Đang ghi lên Jira (dòng) | vạch 2px `--st-doing` chạy dưới dòng | lặp 1.2s | linear | Chỉ hiện sau 200ms |
| A24 | Dữ liệu mới đến (đọc lại) | dòng thay đổi: nền `--select` 0→60%→0 | 900ms | `--e-out` | Chỉ những dòng có giá trị khác |
| A25 | Thẻ "Cần bạn quyết" xong | thẻ thu `scale(.96)` + mờ; thẻ sau trượt vào chỗ | 150 + 220ms | `--e-move` | |
| A26 | Cuộn tới hôm nay | `scrollLeft` | 320ms | `--e-move` | Giảm chuyển động: nhảy ngay |
| A27 | Chỉ báo đồng bộ đang đọc | vòng chấm quay | 1s/vòng | linear | Hiện sau 200ms, giữ ít nhất 400ms |

Kiểm tra: mỗi hiệu ứng có một bước trong e2e chạy với `reducedMotion: "reduce"` để chắc chắn trạng thái cuối đúng mà không cần chờ `transitionend` (luật đã có trong MASTER.md).

---

## 9. Ngôn từ

| Hiện tại | Đổi thành | Lý do |
|---|---|---|
| Gantt / WBS | Kế hoạch | Người dùng nghĩ "kế hoạch", không nghĩ "WBS" |
| Báo cáo | Nhịp dự án | Nó trả lời "dự án đang thế nào", không chỉ là một báo cáo |
| Nguồn lực | Nhân lực | "Nguồn lực" nghe như máy móc |
| Task mới / Tạo task & đẩy lên Jira | Tạo việc | Một ngôn ngữ. Việc lên Jira là chuyện của hệ thống |
| Lưu & đồng bộ Jira | (tự lưu, không có nút) | |
| Đồng bộ từ Jira | Khớp Jira · đọc lại | |
| Hiệu suất TB | Mức sử dụng | Đúng nghĩa, không làm tổn thương (M3) |
| Chưa ghi (chấm cam) | Còn trống | Trung tính |
| Xoá task | Xoá việc | |
| Sub-task | Việc con | Giữ "Sub-task" trong ngoặc ở chỗ chọn loại, vì đó là tên loại Jira |
| Baseline | Kế hoạch gốc | Giữ "baseline" trong tooltip cho người quen |
| Đường găng | Đường găng | Giữ: thuật ngữ chuẩn tiếng Việt |
| SPI | (ẩn, giải thích bằng lời) | |
| Epic, Story, Bug, Sprint | Giữ nguyên | Tên loại Jira, người dùng đã quen |
| To Do / In Progress / Done | Biểu tượng nhóm + tên workflow thật | Tên là của workflow từng site, không dịch được an toàn (BUG-05). Biểu tượng mang nghĩa chung |
| Medium / High | Dấu ưu tiên. Tên hiện trong tooltip | |

Giọng văn: câu ngắn, chủ động, không "Vui lòng". Lỗi thì nói *chuyện gì xảy ra* và *làm gì tiếp*. Ví dụ: "Jira không cho chuyển sang Done: cần nhập Root Cause." kèm ô nhập ngay đó.

---

## 10. Trạng thái rỗng, đang tải, lỗi

| Tình huống | Thiết kế |
|---|---|
| Dự án mới, không có việc | Mặt Kế hoạch có một dòng "＋ Thêm việc" đã focus, kèm 3 gợi ý mờ: "Gõ “Khảo sát yêu cầu 5n @tôi”", "Dán từ Excel", "Nhờ trợ lý chia việc: Ctrl K rồi gõ mục tiêu". Không hình minh hoạ. |
| Lọc không ra gì | "Không có việc nào khớp “Người: Chi · Quá hạn”." + nút "Xoá lọc `Shift F`". |
| Lần tải đầu, chưa có bản lưu | Khung (rail, header, thanh lọc) vẽ ngay. Bảng là 12 dòng khung xương (skeleton) với độ rộng tên ngẫu nhiên cố định, nhấp nháy rất nhẹ (opacity .5↔.8, 1.4s). Chỉ hiện sau 200ms. |
| Đã có bản lưu, đang đọc mới | Vẽ bản lưu ngay. Chỉ báo đồng bộ "◌ Đang đọc…". Dòng nào đổi khi bản mới về thì nhấp sáng (A24). |
| Jira giới hạn | Chỉ báo đồng bộ vàng + số phút. Thao tác ghi bị từ chối thì toast giải thích, không lặp lại. |
| Mất mạng | Dải 28px `--caution` trên cùng: "Mất kết nối. Đang xem bản đã lưu, chưa ghi được gì." |
| Lỗi một ô | Ô có viền `--risk`, giá trị quay về giá trị cũ, tooltip có câu lỗi của Jira. Toast có "Thử lại". |
| Không có quyền (403) | Trang: "Bạn không có quyền xem dự án này trong Jira." + "Chọn dự án khác `Ctrl P`". Không đăng xuất (luật hiện có). |

---

## 11. Lộ trình triển khai

Cỡ việc: **S** < 1 ngày · **M** 1–3 ngày · **L** 3–5 ngày · **XL** > 1 tuần. Ước tính cho một người toàn thời gian, đã quen code.

### Giai đoạn 0 — Nền móng (bắt buộc làm trước) · ~2 tuần

| # | Việc | Cỡ | Chi tiết |
|---|---|---|---|
| 0.1 | Chụp ảnh "trước" thành công cụ | S | Đưa script chụp màn hình của buổi đánh giá này vào `e2e/shots.mjs` (chạy với API giả lập, 1500×900 và 1280×800, sáng/tối). Mỗi giai đoạn chụp lại để so. |
| 0.2 | Tách `App.css` | XL | Chia 10.783 dòng thành tệp theo component, đặt cạnh component (`components/gantt/gantt.css`…). Dùng `@layer reset, tokens, base, components, overrides` để bỏ 22 `!important`. **Giữ nguyên tên class** (e2e chọn theo class). Làm từng tệp, mỗi bước so ảnh 0.1 để chắc không đổi gì. |
| 0.3 | Xoá 368 mã hex | L | Đổi mỗi hex thành token. Thêm `client/test/noRawColors.test.ts`: quét CSS/TSX, hỏng nếu có hex ngoài `tokens.css`. Không cần thêm thư viện. |
| 0.4 | Token v2 | M | Viết tầng primitive "Giấy & Son" (4.2), thang chữ, khoảng cách, bo góc, chuyển động (4.6), chế độ tối. Tầng semantic giữ tên cũ trỏ sang giá trị mới, để bước này đổi giao diện toàn app *mà không sửa component*. |
| 0.5 | Phông | S | Tự host Be Vietnam Pro + JetBrains Mono, subset `vietnamese` + `latin`. Kiểm tra `tnum`, dấu chồng ở dòng 28px, chữ 12px trên Windows (4.3). Chốt hoặc đổi sang Inter. |
| 0.6 | Chế độ tối + mật độ | M | Script chống nháy trong `index.html`. Thuộc tính `data-theme`, `data-density` trên `<html>`. `ROW_HEIGHT` đọc từ mật độ (`ganttWindow.ts` dùng nó). |
| 0.7 | Cập nhật MASTER.md | S | Viết lại theo ngôn ngữ mới. Thêm trang `pages/today.md`, `pages/peek.md`. |

**Xong khi:** app trông khác hẳn (màu, chữ, bo góc, tối) mà mọi e2e cũ vẫn qua. Đây là bản phát hành được đầu tiên.

### Giai đoạn 1 — Khung và lớp bàn phím · ~1,5 tuần

| # | Việc | Cỡ | Chi tiết |
|---|---|---|---|
| 1.1 | Rail + header mới + lăng kính | L | `Toolbar.tsx` thành `AppRail.tsx` + `ProjectHeader.tsx`. Lăng kính đổi tên tab. Giữ `aria-current`. |
| 1.2 | Chỉ báo đồng bộ | M | Thay nút "Đồng bộ từ Jira". Gom `syncing`, `refreshing`, `X-Jira-Limited`, lỗi ghi thành một trạng thái. |
| 1.3 | `shortcuts.ts` + bảng `?` | M | Danh sách phím, chuỗi `G _`, chặn khi đang gõ. Có test thuần. |
| 1.4 | Ô lệnh (lệnh + tìm) | L | `CommandBar.tsx`. Chưa có tạo và hỏi. Tìm không dấu trên `tasks`. |
| 1.5 | Toast có hoàn tác | M | `toast.ts` + component. Nối với `undo.ts` hiện có. |
| 1.6 | Bộ chuyển dự án `Ctrl P` | M | Thay `ProjectPicker`. Gần đây, ghim, `Ctrl Enter` mở tab mới. |
| 1.7 | Thanh lọc chung | L | `FilterBar` một hàng, chip cùng hàng, đã lưu và quick filter vào "＋ Lọc". Bảng và Nhân lực dùng chung. |

**E2E phải viết lại:** `header-toolbar.e2e.mjs` (hợp đồng bố cục mới: 44px header, rail 48px, không nút solid trong header), `toolbar.mjs` (helper mở bộ lọc).

### Giai đoạn 2 — Kế hoạch · ~2 tuần

| # | Việc | Cỡ |
|---|---|---|
| 2.1 | Cột mặc định mới, mã không bao giờ cắt, biểu tượng trạng thái, dấu ưu tiên | M |
| 2.2 | Thanh mới: tô tiến độ, chữ bên phải, ngoặc Epic, vạch son, cuối tuần/lễ, baseline "chỉ khi lệch" | L |
| 2.3 | "Tô màu theo" (bỏ băm màu) | S |
| 2.4 | Điều hướng phím, sửa tại chỗ (tên, người, trạng thái, %), dòng "＋ Thêm việc", `Tab` thụt | XL |
| 2.5 | Phụ thuộc vi phạm + "Dời theo", slack khi rê, `Shift L` | M |
| 2.6 | Vẽ thanh trên dòng chưa có ngày | M |
| 2.7 | Bản đồ nhỏ | M |
| 2.8 | Bản nháp kế hoạch (F1) | XL |

**Phải giữ:** nhấp đúp mở chi tiết (`wbs-dblclick.e2e.mjs`), cửa sổ ảo hoá thẳng hàng (`gantt-scroll.e2e.mjs`), bản vá `vite.gantt-patch.ts`. Phần tô màu và chữ thanh vẫn đi qua DOM của `gantt-task-react`, theo cách `GanttView` đang làm. **Rủi ro:** nếu sửa tại chỗ và vẽ thanh mới vượt quá những gì thư viện cho phép, xem xét thay thư viện (Mục 13, Q5).

### Giai đoạn 3 — Khung chi tiết và bộ chọn ngày · ~1,5 tuần

| # | Việc | Cỡ |
|---|---|---|
| 3.1 | `TaskPeek.tsx` thay `TaskEditModal` (bố cục 6.2.2, giữ mọi khả năng hiện có: đính kèm, liên kết, bình luận, lịch sử, transition fields) | XL |
| 3.2 | Lưu tự động + gom ghi 1.5s (6.2.3) | M |
| 3.3 | `DatePicker.tsx` của app, luôn `DD/MM`, nhận "t6", "+3n" (sửa T2) | M |
| 3.4 | Xem nhanh bằng `Space`, `↑↓` đổi việc | S |
| 3.5 | Gợi ý người trong danh sách giao (dùng `suggest_assignees`/`autoAssign`) | M |

**E2E phải viết lại:** `task-detail-polish.e2e.mjs`, phần mở chi tiết trong `phase1`, `stage2`, `stage3`, `transition-fields`. Giữ: hỏi trước khi bỏ thay đổi *đang gõ dở*, không gửi `description` khi chưa tải xong.

### Giai đoạn 4 — Tạo nhanh và Hôm nay · ~1,5 tuần

| # | Việc | Cỡ |
|---|---|---|
| 4.1 | `quickAdd.ts`: bộ phân tích thuần + test | L |
| 4.2 | Chế độ Tạo trong ô lệnh + dòng "＋ Thêm" dùng chung | M |
| 4.3 | Trang Hôm nay (một dự án): đang chờ bạn, hôm nay, sắp tới, vòng ✓ | L |
| 4.4 | Tờ ghi giờ cuối ngày + gợi ý (F4) | M |
| 4.5 | `CreateTaskModal` còn lại cho "tạo nâng cao" (mở từ `⋯` của dòng xem trước) | S |

### Giai đoạn 5 — Bảng và Backlog · ~1 tuần

Đầu sprint một dòng, đầu cột có chữ, thẻ mới, phím `j/k/h/l` + `Shift h/l`, hiệu ứng kéo, Backlog dạng dòng, AI thành chip. **E2E viết lại:** `board-kanban.e2e.mjs`.

### Giai đoạn 6 — Nhân lực · ~1,5 tuần

Ô chân trời, bỏ vàng/xanh, chỉ số đúng tên, sắp xếp, bóng xem trước khi kéo, hộp hỏi khi quá tải, dải "Chưa giao", gợi ý cân tải ra bản nháp (F5). **E2E viết lại:** `resource-layout.e2e.mjs`.

### Giai đoạn 7 — Nhịp dự án, trợ lý, hộp thư · ~2 tuần

| # | Việc | Cỡ |
|---|---|---|
| 7.1 | Câu kết luận dựng bằng code + "Cần bạn quyết" (có test thuần trên `computeProgress`) | L |
| 7.2 | Bullet chart, burnup, bỏ donut, AI thành đoạn có nhãn | M |
| 7.3 | Gộp `ChatDock` vào ô lệnh, ghim sang bên, bỏ token khỏi giao diện | L |
| 7.4 | Hộp thư: thay đổi trên việc của tôi (bình luận nhắc tên, đổi người, đổi trạng thái). Nguồn: webhook (`JIRA_WEBHOOKS`) khi bật, nếu không thì đọc changelog các việc của tôi có `updated` mới, giới hạn theo quota | XL |
| 7.5 | Trang Cài đặt dự án (gom SLA, lịch, KBKT, chi phí AI) | M |

### Tổng

Khoảng **12–13 tuần** công cho một người. Có thể song song hai người từ giai đoạn 2: một người làm Kế hoạch + Nhân lực, một người làm khung chi tiết + Hôm nay + Bảng. Mỗi giai đoạn là một bản phát hành được: không giữ nhánh dài, đẩy lên `main` theo từng giai đoạn sau khi e2e qua.

### Thứ tự nếu chỉ có 3 tuần

0.4 + 0.5 + 0.6 (giao diện mới, chưa tách CSS) → 1.2 + 1.3 + 1.4 (đồng bộ, phím, ô lệnh) → 3.3 (bộ chọn ngày, sửa lỗi hiểu sai) → 2.1 + 2.3 (mã không cắt, bỏ băm màu) → 6.x phần màu Nhân lực. Được khoảng 60% cảm giác "app mới" với 25% công sức, nhưng nợ CSS vẫn còn đó.

---

## 12. Đo thành công

App không có analytics. Đề xuất một bảng `ui_event` nhỏ (chỉ tên sự kiện, thời điểm, cloudId + accountId, **không nội dung**) và một trang trong Cài đặt dự án. Phải cập nhật `privacy.html` trước khi bật.

| Chỉ số | Cách đo | Mục tiêu sau 1 tháng |
|---|---|---|
| **Số lần bấm "↗ Mở trên Jira" mỗi người/ngày** (chỉ số chính) | Đếm sự kiện | Giảm 70% so với 2 tuần trước khi phát hành |
| Thời gian tạo một việc | Từ `C`/bấm "＋" đến khi tạo xong | Trung vị < 6s (hiện ước tính > 25s qua cửa sổ 10 ô) |
| Tỉ lệ thao tác bằng phím | Thao tác từ phím / tổng | > 25% ở người dùng hằng ngày |
| Dùng bản nháp | Số lần "Áp dụng" | ≥ 1 lần/tuần/PM |
| Ghi giờ đúng ngày | Worklog có `started` = ngày tạo | Tăng 30% |
| Số dòng thấy được | Đo tĩnh | 24 dòng ở 900px (hiện 17) |
| Thời gian tới dòng đầu tiên (đã có bản lưu) | `performance.mark` | < 300ms |

Thêm hai buổi kiểm thử có người thật, mỗi buổi 5 người (2 PM, 2 dev, 1 tester), 30 phút, 6 nhiệm vụ cố định ("Giao DEMO-7 cho người đang rảnh", "Dời giai đoạn 2 sau một tuần và xem gì bị ảnh hưởng"…). Một buổi trước giai đoạn 2 (trên bản giai đoạn 0–1), một buổi sau giai đoạn 4.

---

## 13. Câu hỏi cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| Q1 | Chấp nhận nút chính màu mực và màu chữ ký son (bỏ xanh dương)? | Có. Đây là phần lớn của "không ai nhận ra nữa". |
| Q2 | Be Vietnam Pro hay Inter? | Be Vietnam Pro nếu qua 3 bài kiểm tra ở 0.5. Không qua thì Inter. |
| Q3 | Hôm nay theo một dự án hay mọi dự án? | Bắt đầu một dự án (dữ liệu đã có). Mọi dự án cần một lần tìm `assignee = currentUser()` trên nhiều dự án, tốn quota chung, nên làm sau khi đo quota. |
| Q4 | Lưu tự động: có chấp nhận việc mỗi lần đổi trạng thái/người là một thông báo Jira? | Có. Đó cũng là hành vi của Jira. Các trường khác được gom (6.2.3). |
| Q5 | Giữ `gantt-task-react` hay viết lớp vẽ Gantt riêng? | Giữ qua giai đoạn 2. Nếu sửa tại chỗ, vẽ thanh mới và bản nháp đòi vá thư viện thêm nhiều chỗ, thì viết lớp SVG riêng trên `ganttWindow.ts` + `timelineGeometry.ts` đã có (ước tính XL, 2 tuần). Thư viện đang bị vá ở 3 chỗ và phụ thuộc 3 class CSS đã biên dịch: đây là nợ đang tăng. |
| Q6 | Bỏ tab Chấm công khỏi lăng kính, chỉ còn tờ ghi giờ + màn "Giờ của nhóm"? | Có. |
| Q7 | Ai duyệt nhận diện (màu, phông, logo "G" son)? | Cần một người quyết. Đề xuất làm mẫu giai đoạn 0 rồi duyệt trên app thật, không duyệt trên ảnh tĩnh. |
| Q8 | Có bảng `ui_event` để đo không? Ai sửa `privacy.html`? | Có, chỉ đếm, không nội dung. Người sở hữu chính sách riêng tư sửa trước khi bật. |

---

## 14. Nguồn tham khảo

**Phản hồi về Jira**

- Độ trễ thao tác: community.atlassian.com/forums/Jira-questions/Since-the-update-a-week-or-two-ago-Jirea-has-been-painfully-slow/qaq-p/2763666 · jira.atlassian.com/browse/JRACLOUD-68845
- Quá nhiều lần bấm: capterra.com/p/19319/JIRA/reviews · g2.com/products/JIRA/reviews
- Điều hướng 2025 bị phản đối: community.atlassian.com/forums/Navigation-Refresh-articles/Keep-the-old-navigation-permanent-opt-out/ba-p/3003036
- Màn issue rối, ô trống vẫn hiện: jira.atlassian.com/browse/CLOUD-12559
- Rovo bật ép buộc: community.atlassian.com/forums/Jira-questions/About-this-week-s-forced-rollout-of-Rovo/qaa-p/3109690

**Sản phẩm tham chiếu**

- Linear, thiết kế lại 2024 (LCH, 3 đầu vào màu): linear.app/now/how-we-redesigned-the-linear-ui
- Linear, làm mới 3/2026 ("Đừng tranh sự chú ý…", thanh bên mờ, xám ấm): linear.app/now/behind-the-latest-design-refresh
- Linear, Triage Intelligence (gợi ý AI có nhãn, có lý do): linear.app/now/how-we-built-triage-intelligence
- Superhuman, tốc độ (< 100ms, ô lệnh dạy phím): blog.superhuman.com/superhuman-is-built-for-speed
- Raycast, thanh hành động hiện phím: raycast.com/blog/a-fresh-look-and-feel
- Todoist, tạo nhanh bằng ngôn ngữ tự nhiên: thesweetsetup.com/using-natural-language-with-todoist
- Asana My Tasks và Inbox: asana.com/resources/asana-tips-my-tasks · help.asana.com/s/article/inbox
- TeamGantt, phụ thuộc (Shift+D, vi phạm tô đỏ): support.teamgantt.com/article/8-dependencies
- Instagantt, đường găng, bản đồ nhỏ: instagantt.com/help-guide/critical-path
- MS Project for the web, đường găng mất khi tải lại: techcommunity.microsoft.com/blog/projectblog/critical-path-in-project-for-the-web/2827667
- SVAR Gantt, vẽ slack: docs.svar.dev/svelte/gantt/guides/configuration/add_slack
- Runn, sắp "ít rảnh nhất": help.runn.io/en/articles/4293043-people-planner-overview
- Resource Guru, hộp hỏi khi xung đột: help.resourceguruapp.com/en/articles/1955778
- Teamwork, kéo việc giữa người: support.teamwork.com/projects/workload/using-the-workload-planner
- Height đóng cửa sau khi đổi hướng AI: alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025

**Hướng dẫn thiết kế**

- Vercel Web Interface Guidelines (spinner trễ 150–300ms, giữ 300–500ms; chỉ animate transform/opacity): vercel.com/design/guidelines
- IBM Carbon Motion (thời lượng 70–700ms, đường cong "productive"): carbondesignsystem.com/elements/motion/overview
- Apple HIG Motion (không thêm chuyển động cho thao tác thường xuyên): developer.apple.com/design/human-interface-guidelines/motion
- Rauno Freiberg, chi tiết tương tác vô hình: rauno.me/craft/interaction-design
- NN/g, ba ngưỡng thời gian phản hồi: nngroup.com/videos/3-response-time-limits-interaction-design
- Dấu hiệu giao diện do AI sinh: prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- Chi tiết dấu tiếng Việt: vietnamesetypography.com/diacritical-details

Một số số liệu ở trên lấy từ nguồn thứ cấp hoặc gói token, chưa đối chiếu với trang gốc: đường cong Material 3 (trang gốc không tải được), con số "vài ms" của Linear, số liệu khảo sát ClickUp (do chính ClickUp thực hiện). Không quyết định nào trong kế hoạch chỉ dựa vào các số liệu này.
