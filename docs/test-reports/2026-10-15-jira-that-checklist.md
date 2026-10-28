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
| C6 | File `AI-33_…` mà AI-33 là Story có sẵn trong dự án | Hộp thoại tự chọn "Story có sẵn" AI-33 (hiện tên); test case vào dưới AI-33; AI-33 không bị đổi tên, **không bị chuyển Epic** dù đang chọn Epic ở trên | |
| C6b | File `AI-xx_…`, chọn "Story có sẵn" → tìm theo tên một Story, áp dụng | Hàng chục Sub Testcase / Sub Bug nằm dưới đúng Story đã chọn; không có Story mới nào được tạo | |
| C6c | Workbook đã nhập vào Story riêng, nay chọn "Story có sẵn" khác rồi áp dụng | Các sub-task cũ **chuyển sang** Story mới chọn (Jira thật có cho đổi parent sub-task qua API không — ghi lại); có cảnh báo Story cũ không còn dùng | |
| C6d | Mở "Cấu hình dự án" → khối "Trường của Jira" | Test case (Sub Testcase): Nhóm → Module, Các bước thực hiện → Test Steps, Kết quả mong muốn → Expected Result, Kết quả hiện tại → Actual Result (đúng tên trường của dự án AI); "Đang tự khớp theo tên trường." | |
| C6e | Nhập lại một file **đã đồng bộ trước đây** (nội dung đang nằm hết trong Description) | Xem trước báo "Cập nhật [Actual Result, description, Expected Result, Module, Test Steps]"; sau khi áp dụng, các ô đó trên Jira có nội dung, Description chỉ còn Mục đích / Kết quả kiểm thử / Mã lỗi / Ghi chú / Nguồn; nhập lại lần nữa không còn gì cần ghi | |
| C6f | Sub Bug có trường Severity dạng chọn mà lựa chọn không khớp "Cao/Trung bình/Thấp" | Một cảnh báo cho mỗi giá trị, Mức độ vẫn ở Description, không issue nào bị lỗi khi tạo | |
| C7 | File của một workbook **đã đồng bộ bằng `jira_sync.py`** (dự án AI) | Xem trước: không có dòng "Tạo mới" nào — issue cũ được nhận ra theo nhãn | |
| C8 | Đặt một trạng thái không có bước chuyển (ví dụ đổi "Đạt" sang trạng thái không với tới được) | Kết quả báo "không chuyển được …" thay vì im lặng; phần còn lại vẫn ghi | |
| C9 | File lớn nhất có ảnh (~100 test case) | Áp dụng xong trong vòng 300 giây (giới hạn Cloud Run); nhật ký chạy dần | |
| C10 | Bấm **Dừng** giữa chừng, rồi áp dụng lại | Phần đã ghi giữ nguyên; lần sau chỉ làm phần còn lại, không trùng | |
| C11 | Tài khoản khách (không phải nhân viên) | Dùng được (không cần quyền AI); Jira từ chối nếu tài khoản không có quyền tạo issue, kèm thông báo rõ | |

## D. Giai đoạn 2 (chi tiết task và Gantt) — thử trên Jira thật

Test tự động đã chứng minh phần giao diện và logic của ta với máy chủ giả; mục này chứng minh **Jira nhận và trả đúng**. Dùng dự án thử.

| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| D1 | Mở một task, thêm 1 thành phần và 1 phiên bản, lưu | Components / Fix versions trong Jira đúng; bỏ đi cũng bỏ thật | |
| D2 | Dự án chưa có thành phần/phiên bản nào | Ô chọn ghi "Dự án chưa có…", không lỗi | |
| D3 | Cột Sprint trên WBS, lọc theo Sprint — **không bật JIRA_AGILE** | Có tên sprint đúng (đang chạy ưu tiên); site không có Jira Software thì cột trống, không lỗi | |
| D4 | Đổi việc cha của một Story sang Epic khác | Parent trong Jira đổi; Story chuyển nhóm trên WBS sau khi lưu | |
| D5 | Bỏ việc cha ("— Không có —") của một Story dưới Epic | Jira nhận (`parent: null`) hoặc báo lỗi dễ hiểu — **ghi lại kết quả**, đây là chỗ chưa chắc | |
| D6 | Đổi loại Task → Story (cùng quy trình), rồi thử loại khác quy trình | Cái đầu được; cái sau Jira từ chối và lời báo hiện trong modal | |
| D7 | Thử tạo vòng: đặt Epic A làm con của Story thuộc A (qua trợ lý: "chuyển GPM-1 vào GPM-5") | Bị chặn trước khi gọi Jira, thông báo "vòng lặp" | |
| D8 | Task đang có người phụ trách → đổi sang Epic | Bị chặn, nói phải bỏ người phụ trách | |
| D9 | Thêm issue link "blocks" từ A sang B | Trong Jira: A **blocks** B (B "is blocked by" A) — **kiểm tra chiều**, đây là chỗ dễ ngược | |
| D10 | Thêm link với task thuộc **dự án khác**; gỡ link | Được; gỡ xong biến mất trong Jira | |
| D11 | Link "blocks" có làm dời lịch không? | **Không** (khác với mục Phụ thuộc) | |
| D12 | Bấm Theo dõi / bỏ theo dõi | Jira hiện bạn trong Watchers; tài khoản không có quyền xem danh sách thì chỉ thấy số lượng + ghi chú | |
| D13 | JQL: `assignee = currentUser() AND status != Done ORDER BY created` | Lọc đúng; có câu "Jira trả N việc"; ORDER BY không gây lỗi | |
| D14 | JQL sai cú pháp / tên trường sai | Lỗi của Jira hiện cạnh ô, biểu đồ không bị trống | |
| D15 | JQL cố mở rộng phạm vi: `status = Done) OR (project = KHAC` | Chỉ còn việc của dự án đang mở | |
| D16 | Lưu một bộ lọc có **Thành phần** (hoặc **JQL**) + "Của tôi", chia sẻ; đăng nhập tài khoản khác mở | Người kia thấy bộ lọc; mở ra có đúng thành phần/JQL (JQL được Jira chạy lại bằng quyền của họ); "Của tôi" áp lên **chính họ**; họ không xoá/sửa được của bạn | |
| D17 | Chọn vài việc → ô "Baseline…" → Lưu baseline, rồi kéo vài thanh | Dải baseline đứng yên, thanh dời; dải đỏ khi trễ; Báo cáo (% kế hoạch) đổi theo | |
| D18 | Đặt/xoá baseline: Jira có bị ghi gì không? | **Không** có thay đổi nào trong History của issue | |
| D19 | Gắn nhãn `milestone` cho một task; tạo Version có ngày phát hành | Hình thoi ở cuối thanh; đường dọc cắm đúng ngày phát hành ở cả chế độ Ngày/Tuần/Tháng | |
| D20 | Kéo thanh có phụ thuộc (đẩy việc sau), rồi Hoàn tác / Ctrl+Z | Cả thanh kéo và việc bị đẩy về đúng chỗ cũ, **trong Jira** (đối chiếu Due date) | |
| D21 | Hoàn tác khi đang gõ ô tìm kiếm | Không hoàn tác bản kế hoạch | |
| D22 | Nhập ~40 dòng (dán từ Excel) gồm Epic → Story → Sub-task bằng cột "Việc cha" là số dòng | Đúng cây trong Jira; chia thành nhiều đợt vẫn đúng cha | |
| D23 | Dòng có ngày sai, người trùng tên, việc cha lỗi | Bị chặn/báo đúng số dòng của bảng; các dòng còn lại vẫn tạo | |
| D24 | Nhập 150 dòng | Không bị cắt giữa chừng (đợt 25 dòng/lần); thời gian chấp nhận được | |
| D25 | Trợ lý: "thêm thành phần Backend cho GPM-5", "chuyển GPM-5 vào Epic GPM-2", "đổi GPM-5 thành Bug" | Làm đúng; tên sai thì liệt kê tên có sẵn | |

## E. Giai đoạn 3 (Bảng, Báo cáo, Nguồn lực) — thử trên Jira thật

Cần `JIRA_AGILE=on` cho các mục Bảng. Dùng dự án thử có board Scrum, ít nhất một sprint đã hoàn thành.

| # | Thao tác | Phải thấy | Kết quả |
|---|---|---|---|
| E1 | Bảng: bật một quick filter của board (Board settings → Quick filters) | Nút cùng tên hiện trên thanh lọc; bật lên thì thẻ lọc **giống Jira**; bật hai cái = giao (AND) | |
| E2 | Quick filter có JQL sai/hàm Jira từ chối | Có dòng "Jira không chạy được bộ lọc nhanh", bảng **không** bị trống | |
| E3 | Gắn cờ một thẻ từ nút cờ trên thẻ; bỏ cờ | Jira hiện cờ (Impediment) / bỏ cờ thật; site không có trường "Flagged" thì báo rõ. **Chỗ chưa chắc**: ghi lại nếu Jira đòi trường nằm trên màn hình sửa | |
| E4 | Bảng → "Thẻ": tắt/bật trường, màu theo ưu tiên/Epic/người, tải lại trang | Giữ lựa chọn theo từng board; thẻ bị chặn vẫn viền đỏ dù có màu | |
| E5 | Thẻ Story có sub-task | Hiện "x/y sub-task", mở ra thấy từng sub-task và trạng thái; "Gộp sub-task" ẩn thẻ riêng | |
| E6 | Backlog: panel Epic và Phiên bản | Số xong/tổng khớp Jira; bấm một dòng lọc backlog; phiên bản chưa phát hành lên trước | |
| E7 | Backlog: chọn nhiều việc → Gán cho…, Đổi trạng thái…, Gắn cờ | Từng việc ghi lên Jira; việc bị workflow chặn được liệt kê; trạng thái cần RootCause mở hộp nhập | |
| E8 | Backlog: bấm nhãn trạng thái của một dòng | Chỉ liệt kê trạng thái workflow cho phép | |
| E9 | Xoá sprint chưa chạy (sau khi bật `JIRA_AGILE_DELETE` **và** scope `delete:sprint:jira-software` trên cả hai app) | Việc trong sprint về backlog, sprint biến mất. **Chưa bật scope**: nút báo "cần quyền riêng", đăng nhập vẫn bình thường. Phiên cũ chưa có scope: báo đăng nhập lại | |
| E10 | "Năng lực" ở sprint chưa chạy / đang chạy | Ngày làm = ngày làm việc trong cửa sổ trừ ngày nghỉ; board tính bằng giờ thì có "Còn lại", bằng điểm thì không | |
| E11 | Kế hoạch AI → "Năng lực nhóm" | Bảng đổi theo ô tích chọn | |
| E12 | Báo cáo → Agile → Vận tốc | Cột khớp biểu đồ Velocity của Jira (phần *hoàn thành*; Jira còn có *cam kết*) | |
| E13 | Sprint & burnup của sprint đã đóng, có việc thêm giữa kỳ | "Cam kết/Thêm giữa kỳ/Hoàn thành" gần khớp Sprint Report của Jira; bậc scope tăng đúng ngày thêm. **Ghi lại chênh lệch** (điểm hiện tại so với điểm lúc đó, việc bị gỡ) | |
| E14 | Luồng công việc / Thời gian xử lý / Tạo và xong (30, 60, 90 ngày) | Thời gian chấp nhận được (vài giây); dự án >1000 việc có cảnh báo cắt; số tạo/xong khớp `created`/`resolved` trong JQL; lần mở lại trong 10 phút nhanh (bộ nhớ đệm) | |
| E15 | Mở Báo cáo bằng tài khoản **khách** | Thấy "Xu hướng theo ngày" sau vài ngày, không cần báo cáo AI; cần chờ ≥2 ngày mới vẽ | |
| E16 | So sánh hai báo cáo AI; Sao chép liên kết rồi dán vào tab ẩn danh/đăng nhập tài khoản khác | Đổi gì hiện đúng; liên kết mở thẳng đúng báo cáo **sau khi đăng nhập**; tài khoản không thấy dự án thì có thông báo, không lộ nội dung | |
| E17 | In / Lưu PDF ở trang Báo cáo | Không có thanh công cụ/chat; biểu đồ còn màu; không bị cắt ngang thẻ | |
| E18 | Nguồn lực → Kỹ năng: thêm cột, bấm ô; nhờ trợ lý gợi ý người cho một việc | Hồ sơ lưu; kế hoạch AI dùng kỹ năng khi gợi ý người | |
| E19 | Sửa kỳ nghỉ (đổi ngày/lý do) | Heatmap đổi ngay; không sinh kỳ nghỉ thứ hai | |
| E20 | Heatmap: kỳ trước/sau, "Tháng này", cột theo tháng | Cửa sổ dời đúng (tháng nguyên → tháng nguyên) | |
| E21 | Chấm công: sửa giờ của mình (đổi giờ; đổi ngày; xoá ghi chú) | Worklog trong Jira đổi; đổi giờ không đổi giờ-trong-ngày; xoá ghi chú được hay Jira báo lỗi — **ghi lại**; giờ của người khác không có nút sửa | |
