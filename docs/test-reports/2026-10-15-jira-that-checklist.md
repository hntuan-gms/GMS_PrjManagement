# Checklist kiểm thử tay trên Jira thật (phase 2 · giai đoạn 0.1)

Phase 1 mới được kiểm thử với máy chủ giả (`e2e/`) và test logic thuần. Những việc **ghi lên Jira** hoặc **dựa vào hành vi của Jira** chưa từng được thử thật; danh sách này là những gì cần chạy tay. Điền kết quả vào cột cuối; mỗi lỗi thành một dòng ở cuối file.

**Trạng thái: chưa chạy.** Cần một dự án Jira thử và người có quyền Browse/Edit/Comment trên đó.

## Chuẩn bị
- [ ] Một dự án Jira **thử** (không phải dự án đang chạy thật), có ít nhất: 1 Epic, vài Story/Task/Sub-task, 2–3 người thật (để @mention gửi được email), board Scrum.
- [ ] Chạy dev qua `:5173` (không phải `:4000`) với Cloud SQL Auth Proxy: `cloud-sql-proxy bof-intern:asia-southeast1:intern-portal-db`, `DATABASE_URL` trỏ `localhost:5432`. **Chú ý:** local không có `GEMINI_API_KEY`, nên nhóm AI phải thử trên bản đã deploy.
- [ ] Mở Jira của dự án thử ở tab bên cạnh để đối chiếu.

## Cách đọc
Mỗi dòng: thao tác trong app → điều phải thấy **trong Jira** (không chỉ trong app).

### Chi tiết task (rủi ro cao nhất — ghi thật lên Jira)
| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| 1 | Viết bình luận thường | Có ở tab Comments của issue trong Jira, đúng tác giả | |
| 2 | Bình luận có `@` một người khác (chọn từ danh sách) | Jira hiển thị mention (nền xanh); **người đó nhận email/thông báo từ Jira** | |
| 3 | Hai thành viên **trùng tên hiển thị** (nếu có thể tạo): nhắc cả hai trong một bình luận | Mỗi người được nhắc đúng tài khoản của mình; ô soạn thảo hiện `@Tên` và `@Tên (2)` | |
| 4 | Sửa bình luận của mình có link + mention | Link và mention còn nguyên trong Jira sau khi lưu | |
| 5 | Sửa/xoá bình luận của người khác | App không cho (hoặc Jira từ chối với thông báo rõ) | |
| 6 | Bình luận được viết trong editor của Jira (có danh sách, trích dẫn) rồi mở trong app | Nội dung còn, danh sách thành các dòng `•` | |
| 7 | Tab Lịch sử | Khớp tab History trong Jira (cùng thay đổi, cùng thứ tự, mới nhất trước); không có dòng Rank/worklog | |
| 8 | Task có >100 thay đổi (nếu có) | Thay đổi mới nhất không bị cắt | |
| 9 | Đổi Độ ưu tiên | Priority trong Jira đổi | |
| 10 | Thêm 2 nhãn, bỏ 1 nhãn, nhãn có dấu cách | Labels trong Jira đúng (dấu cách thành `-`); bỏ nhãn thật sự bỏ | |
| 11 | "+ Sub-task" dưới một Story, và dưới một Epic | Sub-task nằm dưới task cha trong Jira và trên WBS; cha là Epic thì loại mặc định không phải Sub-task | |
| 12 | Gõ khóa lạ vào URL: `/api/tasks/ABC-1%2F..%2Fx/comments` (đã đăng nhập) | 400, không có request nào tới Jira (xem log máy chủ) | |

### Gantt / bộ lọc / hàng loạt
| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| 13 | Lọc người + trạng thái | Dòng cha của kết quả vẫn hiện; tải lại trang vẫn còn bộ lọc | |
| 14 | Chọn 3 task → gán người | Assignee đổi trong Jira cho cả 3 | |
| 15 | Chọn Epic + Task → gán | Epic bị bỏ qua và báo rõ; Task được gán | |
| 16 | Đổi trạng thái hàng loạt | Status đổi trong Jira theo **workflow thật** (kể cả tên trạng thái khác chuẩn) | |
| 17 | Dời ngày +N | Ngày trong Jira đổi; task có phụ thuộc kéo theo (cascade) | |
| 18 | Xoá hàng loạt Epic cùng các Story của nó | Cả Epic và Story đều bị xoá trong Jira | |
| 19 | Xuất CSV, mở bằng Excel | Không lỗi dấu tiếng Việt; chỉ có các dòng khớp bộ lọc | |
| 20 | **Nhấp đúp một hàng WBS** (ô tên, rồi ô cột phụ), kể cả khi trước đó chưa chọn gì | Mở đúng modal của hàng đó (đã sửa ở 0.2; e2e đã kiểm với dữ liệu giả) | |
| 21 | Nút "Hôm nay" khi lọc ra task toàn nằm trước/sau hôm nay | Có dòng ghi chú "Hôm nay nằm trước/sau…" và biểu đồ cuộn tới mép gần nhất | |

### Nguồn lực / Bảng / Chấm công
| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| 22 | Mở người A rồi chuyển sang B | Panel hiện đúng vai trò/capacity của B | |
| 23 | Kéo task thả lên một người; thả vào "chưa gán" | Assignee trong Jira đổi / bị bỏ | |
| 24 | Bảng: đổi người trên thẻ; bỏ gán | Jira đổi | |
| 25 | Bảng: gán một Epic cho ai đó | 400 với thông báo tiếng Việt, Jira không đổi | |
| 26 | Bảng: lọc ra rỗng | Có thông báo + nút "Xoá lọc" | |
| 27 | Chấm công: ghi giờ, rồi xoá | Worklog có/mất trong Jira, đúng ngày (múi giờ UTC+7) | |

### Báo cáo
| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| 28 | Lọc theo người / Epic / loại | Số liệu đổi, khớp với danh sách mở từ biểu đồ | |
| 29 | Đổi ngày tính (asOf) | Số quá hạn/planned đổi theo | |
| 30 | **Tạo báo cáo AI** (bản deploy) | Có báo cáo, lưu được, mở lại thấy đúng nội dung | |
| 31 | **Xoá** báo cáo đã lưu (nhân viên) | Biến mất khỏi danh sách; số "Cả dự án" trong chi phí AI không giảm | |
| 32 | Đăng nhập bằng tài khoản khách (không phải nhân viên) | Không thấy nút tạo/xoá báo cáo và ô chat; trang báo cáo xem được | |

### Trợ lý AI (bản deploy)
| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| 33 | Hỏi câu cần nhiều tool rồi bấm **Dừng** giữa chừng | Phần chữ dở còn; không có tin xin lỗi; **log máy chủ ngừng gọi tool/Gemini** (e2e mới chứng minh trình duyệt ngắt kết nối, chưa chứng minh phía server) | |
| 34 | Nút Sao chép | Chép đúng nội dung | |
| 35 | Tạo kế hoạch → **Huỷ kế hoạch** | Kế hoạch chuyển `discarded`, không tạo issue nào | |
| 36 | Sửa tiêu đề/loại một dòng kế hoạch, rồi Áp dụng | Issue tạo đúng tiêu đề/loại đã sửa | |
| 37 | (Mới ở 0.6) Dùng id kế hoạch của **dự án khác** trong cùng site cho `PATCH/DELETE /api/ai/plans/:id/items/:itemId` và `POST …/discard` | 404, không có gì đổi | |
| 38 | (Mới ở 0.6) Id kế hoạch sai định dạng, ví dụ `/api/ai/plans/abc` | 404, không phải 500 | |

## Lỗi tìm được
_(chưa có)_

---

## B. Trợ lý AI giai đoạn 1 — thử trên bản deploy (cần Gemini + Jira thật)

Test tự động đã chứng minh phần code của ta; mục này chứng minh **model chọn đúng tool** và các ghi lên Jira. Chỉ nhân viên dùng được (route AI chỉ cho nhân viên). Dùng dự án thử.

| # | Nói với trợ lý | Phải thấy | Kết quả |
|---|---|---|---|
| B1 | "đặt GPM-5 ưu tiên cao" / "khẩn cấp" | Priority trong Jira đổi đúng tên của site | |
| B2 | "thêm nhãn urgent cho GPM-5", rồi "bỏ nhãn urgent" | Labels trong Jira đúng; các nhãn cũ còn nguyên | |
| B3 | "liệt kê việc có nhãn backend ưu tiên cao trong sprint hiện tại" | Danh sách khớp Jira (cần JIRA_AGILE) | |
| B4 | "nhắn @<tên một đồng nghiệp> trong GPM-5: cần chốt trước thứ Sáu" | Bình luận có mention thật; **người đó nhận email từ Jira** | |
| B5 | Như B4 nhưng nêu tên mơ hồ (hai người cùng tên) | Trợ lý **hỏi lại**, không đăng gì | |
| B6 | "GPM-5 có ai bình luận gì không?" / "ai đổi trạng thái GPM-5 lúc nào?" | Khớp tab Comments / History trong Jira | |
| B7 | "GPM-5 đang vướng gì?" | Trả lời dẫn các *signals* (quá hạn, đang chờ…) và mã issue; **không có con số nào không có trong dữ liệu** | |
| B8 | "lọc việc quá hạn của <tên>" | Gantt lọc đúng; thanh lọc hiện số; có ghi chú dưới câu trả lời; "bỏ lọc" gỡ được | |
| B9 | "lọc việc của mình" / "chỉ hiện bug đang mở" trên tab Bảng | Bảng lọc đúng | |
| B10 | "tạo task Thiết kế màn hình đăng nhập" khi đã có việc gần giống | Trợ lý **không tạo**, nêu việc giống và hỏi; đồng ý mới tạo | |
| B11 | "đã có việc nào giống … chưa?" | Danh sách có điểm và từ chung | |
| B12 | "viết mô tả và tiêu chí nghiệm thu cho GPM-7" (việc chưa có mô tả, rồi việc đã có) | Chưa có: ghi thẳng; đã có: đưa bản nháp, chưa ghi đè | |
| B13 | Hỏi một câu rồi bấm **Tạo lại**; rồi **Sửa** câu hỏi | Chỉ còn một câu trả lời; chi phí/token tăng (vẫn tính lượt cũ) | |
| B14 | Sau khi trợ lý tạo một việc, thử Tạo lại / Sửa | Không có nút; hover giải thích lý do | |
| B15 | Đặt `GEMINI_PRICING` (repo variable) rồi deploy; mở panel thống kê | Có chi phí bằng tiền cho phiên và cả dự án; đối chiếu một lượt với bảng giá Google | |
| B16 | Không đặt giá cho mô hình đang dùng | Chỉ token, có dòng giải thích — không có "0" | |
| B17 | Dán ảnh chụp lỗi + "tạo bug từ ảnh này" | Trợ lý đọc được ảnh, tạo bug; bong bóng hiện tên tệp | |
| B18 | Đính kèm PDF và một file .md | Trợ lý đọc nội dung | |
| B19 | Gửi tệp .exe hoặc >5 MB | Bị từ chối ngay, nói rõ lý do | |
| B20 | Sau lượt có tệp, hỏi "như ảnh lúc nãy thì sao" | Trợ lý nói không còn thấy ảnh (không bịa nội dung) | |

---

## C. Nhập kịch bản kiểm thử (KBKT .xlsx) — cần Jira thật

Test tự động đã chứng minh: đọc file giống hệt `jira_sync.py` (cùng số test case, nhãn, tiêu đề, mô tả, ảnh — đối chiếu trên 5 file mẫu), logic đồng bộ trên Jira giả, và luồng hộp thoại trong trình duyệt (`e2e/kbkt-import.e2e.mjs`). Mục này chứng minh **Jira thật** nhận đúng. Nút **Nhập KBKT** ở thanh công cụ Gantt, cạnh "Xuất CSV". Dùng dự án thử có loại issue Story / Sub Testcase / Sub Bug (hoặc sửa trong "Cấu hình dự án").

| # | Thao tác | Phải thấy trong Jira | Kết quả |
|---|---|---|---|
| C1 | Mở "Cấu hình dự án" | Danh sách loại issue / trạng thái / ưu tiên / kiểu liên kết là của dự án này; giá trị không có trong dự án được đánh dấu | |
| C2 | Nhập một file `AI-xx_…xlsx`, chọn Epic, Xem trước | Không có gì đổi trong Jira (xem trước không ghi) | |
| C3 | Áp dụng | Story mới dưới Epic; mỗi dòng test là một Sub Testcase dưới Story, đúng trạng thái (P→Passed, F→Failed, PE→Pending, trống→Not run); Sub Bug có ưu tiên theo Mức độ; ảnh trong sheet "Hình ảnh lỗi" được đính kèm đúng lỗi; test ↔ lỗi có liên kết Relates; hạn hoàn thành = ngày đã chọn; nhãn `kbkt-…`, `tc-…`, `bug-…`, `result-…` | |
| C4 | Áp dụng lại đúng file đó | Xem trước báo "Không có gì cần ghi lên Jira"; không có issue trùng | |
| C5 | Sửa một kết quả trong file (P → F), nhập lại | Chỉ test đó đổi trạng thái + nhãn result; lỗi tương ứng mở lại | |
| C6 | File `AI-33_…` mà AI-33 là Story có sẵn trong dự án | Test case vào dưới AI-33; AI-33 không bị đổi tên | |
| C7 | File của một workbook **đã đồng bộ bằng `jira_sync.py`** (dự án AI) | Xem trước: không có dòng "Tạo mới" nào — issue cũ được nhận ra theo nhãn | |
| C8 | Đặt một trạng thái không có bước chuyển (ví dụ đổi "Đạt" sang trạng thái không với tới được) | Kết quả báo "không chuyển được …" thay vì im lặng; phần còn lại vẫn ghi | |
| C9 | File lớn nhất có ảnh (~100 test case) | Áp dụng xong trong vòng 300 giây (giới hạn Cloud Run); nhật ký chạy dần | |
| C10 | Bấm **Dừng** giữa chừng, rồi áp dụng lại | Phần đã ghi giữ nguyên; lần sau chỉ làm phần còn lại, không trùng | |
| C11 | Tài khoản khách (không phải nhân viên) | Dùng được (không cần quyền AI); Jira từ chối nếu tài khoản không có quyền tạo issue, kèm thông báo rõ | |
