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
