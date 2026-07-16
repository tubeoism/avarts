# `download/` — đổ dữ liệu export Strava vào đây

Đây là nơi bạn đặt bản export gốc tải về từ Strava để dựng lại **toàn bộ** dữ liệu lịch sử nhanh
nhất có thể — thay vì đợi backfill dần qua Strava API (bị giới hạn rate-limit, có thể mất nhiều
giờ). Xem CLAUDE.md phần "3 cách tạo lập dữ liệu" để biết khi nào nên dùng
cách này so với 2 cách còn lại (MCP hàng đêm / API GitHub Actions hẹn giờ).

## Cách dùng

1. Xin export từ Strava (trang cài đặt tài khoản Strava → mục xuất dữ liệu, thường mất vài phút
   tới vài giờ để Strava chuẩn bị file ZIP rồi gửi link tải qua email).
2. Giải nén ZIP. Copy **toàn bộ nội dung bên trong** thư mục export (không phải cả thư mục, không
   phải chính file ZIP) vào thẳng `download/` này — tức sau khi copy, bạn sẽ có
   `download/activities.csv`, `download/activities/`, v.v. nằm trực tiếp trong `download/`.
3. Commit + push nhánh này (hoặc `main`).
4. Vào tab **Actions** trên GitHub → chọn workflow **"Build from downloaded data"** → **Run
   workflow** (trigger thủ công, `workflow_dispatch`).
5. Action sẽ tự chạy ETL đầy đủ, làm mới `retained-raw/`, build thử để kiểm tra, rồi **tự xoá
   sạch nội dung bên trong `download/`** (giữ lại đúng file `.gitkeep` và `README.md` này) và
   commit/push thẳng lên `main`.

## File nào thực sự cần

ETL chỉ đọc đúng các file/thư mục sau — có thể chỉ copy đúng chừng này nếu muốn gọn:

- `activities.csv`
- `shoes.csv`, `bikes.csv`, `components.csv`
- `events.csv`
- `activities/` (chứa `*.fit.gz` / `*.gpx.gz` / `*.tcx.gz` — dữ liệu GPS/HR/cadence thô)
- `profile.csv` (tuỳ chọn — chỉ dùng để lấy City/State/Country hiển thị, thiếu cũng không sao)

Mọi file khác trong export gốc của Strava (`orders.csv`, `logins.csv`, `messaging.json`,
`media/`, `contacts.csv`, v.v.) **không được ETL đụng tới** và **không bao giờ được copy vào
`retained-raw/`** dù bạn có lỡ đổ cả export vào đây — script `refresh-retained-raw.mjs` chỉ copy
đúng danh sách allowlist ở trên, không copy "mọi thứ có trong download/".

## ⚠️ Lưu ý quan trọng về quyền riêng tư

Action chỉ xoá nội dung **trên working tree** rồi commit — **không xoá lịch sử git**. Nghĩa là
bất kỳ file nào bạn từng push vào `download/` (kể cả `profile.csv` có Email/Tên thật, hay bất kỳ
file nhạy cảm nào khác nếu bạn lỡ copy cả export) vẫn **còn nguyên trong lịch sử commit**, xem lại
được qua `git log`/`git show` bất cứ lúc nào sau này — dù bạn không còn thấy nó trong thư mục nữa.

Repo này đang để **private**, nên đây là đánh đổi đã chấp nhận (giống `retained-raw/` — xem
CLAUDE.md phần "Quyền riêng tư"). Nhưng để giảm rủi ro, **chỉ nên copy đúng danh sách file cần
thiết ở trên**, đặc biệt tránh copy `profile.csv` nếu không cần City/State/Country hiển thị, và
tuyệt đối tránh các file rõ ràng không liên quan (ảnh trong `media/`, `orders.csv`,
`logins.csv`, `messaging.json`, `contacts.csv`...).
