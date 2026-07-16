# Audit notes — backlog cần theo dõi & cải thiện

Danh sách phát hiện **CHƯA sửa** từ các đợt audit codebase (thiết kế/toàn vẹn/an ninh/hiệu suất).
Phát hiện nào đã có fix cơ học thì áp dụng thẳng vào code, không liệt kê ở đây. Dùng checkbox để
đánh dấu khi xử lý xong; khi 1 mục được giải quyết thật, port kết quả thành 1 rule mới trong
`CLAUDE.md` rồi xoá dòng tương ứng ở đây.

## Mức High

- [ ] **`fetchActivity()` (`scripts/etl/api/run-api-sync.mjs`) không try/catch quanh
      `getActivityDetail()`** (chỉ `getActivityStreams()` có xử lý 404). 1 activity lỗi/404 khi
      fetch detail (VD bị xoá/đổi private giữa lúc `list` và lúc fetch detail) sẽ crash cứng cả
      forward-pass sync (chặn watermark "ngày mới nhất" tiến lên, lặp lại lỗi mỗi lần chạy sau) lẫn
      audit backfill tự phục hồi hàng tuần (crash đúng tại điểm đó mỗi Chủ nhật, vô hiệu hoá cơ chế
      tự phục hồi vốn thiết kế riêng để bắt loại bug này).
      **Cần quyết định:** skip-and-log (bỏ qua activity lỗi, tiếp tục phần còn lại của batch) vs.
      retry ở lần chạy kế vs. giới hạn số lỗi liên tiếp + lưu danh sách ID đã biết lỗi để không thử
      lại vô ích mỗi lần.

## Mức Medium

- [ ] **Biến thể hẹp của bug backfill cursor off-by-one (đã sửa — xem CLAUDE.md mục "Vận hành REST
      API sync") vẫn có thể mất 1 activity vĩnh viễn**: nếu 2 activity trùng epoch giây VÀ
      `RateLimitStopError` xảy ra đúng giữa 2 activity đó, activity thứ 2 vẫn bị loại vĩnh viễn
      (`before` filter của Strava là exclusive). Chưa có bằng chứng đã xảy ra thật. Không có fix cơ
      học đơn giản — cần độ chính xác dưới-giây từ Strava API (không có) hoặc theo dõi tập ID đã xử
      lý xuyên suốt nhiều lần chạy.

- [ ] **`shoeKind()` (`scripts/etl/lib/gear.mjs`) có thể false-positive "barefoot"/"sandal" trên
      tên giày thật chứa đúng từ khoá đó** (VD "Barefoot Ride") — fallback dùng `.includes()` khớp
      substring, sai `kind` kéo theo sai ngưỡng cảnh báo thay giày (`kmThreshold`) và sai label hiển
      thị. Chưa gặp thật, chỉ là rủi ro logic. Đổi sang regex word-boundary thu hẹp nhưng không loại
      bỏ hoàn toàn (tiếng Việt có dấu khớp `\b` kém) — đánh đổi cần cân nhắc.

- [ ] **Điều hướng chính không dùng được bàn phím** — `src/pages/index.astro:147` (bảng hoạt động
      gần đây), `src/pages/activities/index.astro:238-243` (nhật ký), `src/pages/log.astro:281`
      (bubble log) đều dùng `onclick`/click-listener trên `<tr>`/`<div>` trần, không
      `tabindex`/`role`/`keydown`. `calendar.astro`/`records.astro` làm đúng (dùng `<button>`/
      `<a href>` thật) — pattern có sẵn để tái dùng khi sửa.

- [ ] **Loading/error UI không nhất quán giữa các trang fetch client-side.** Một số trang có prompt
      "thử lại" khi fetch lỗi; `routes.astro` chỉ có error card, không có loading placeholder; chart
      Fitness ở `index.astro`/`performance.astro` không có loading/error UI nào (canvas trống trơn
      nếu fetch lỗi, dù không còn crash im lặng). Cần chọn 1 pattern UI chung áp dụng lại cho mọi
      trang fetch client-side.

- [ ] **`scripts/check-i18n-parity.mjs` không bắt được key i18n dựng động thiếu ở CẢ HAI ngôn
      ngữ** — chỉ diff key đã tồn tại ở ít nhất 1 file ngôn ngữ, không phát hiện được key kiểu
      `activityType.${type}` hoàn toàn không tồn tại ở cả `vi`/`en` (từng khiến literal key lộ ra UI
      thật cho tới khi phát hiện thủ công). `t()`'s fallback runtime ngăn crash nhưng không chặn
      được bug loại này ở build-time. **Cần quyết định:** enumerate tĩnh mọi giá trị
      `activityType`/`sport_type` hợp lệ để đối chiếu, hoặc thêm assertion runtime (throw thay vì
      fallback) ở môi trường dev/CI.

- [ ] **`zlib.gunzipSync()` (`scripts/etl/parse-streams.mjs`) không giới hạn dung lượng output**
      (không truyền `maxOutputLength`) — Node hiện tại hỗ trợ option này, chỉ cần chọn ngưỡng cụ thể
      (đề xuất 100-500MB; dữ liệu FIT/GPX/TCX thật khó vượt vài chục MB uncompressed).

- [ ] **`bestEffort()` (`scripts/etl/lib/resample.mjs`) không nội suy và không guard tính hợp
      lý.** Khác `splitsAtStep()` (có nội suy), snap thẳng vào sample thô gần nhất (sai lệch bảo
      thủ nhỏ có hệ thống); không guard chống 1 điểm GPS "teleport" (`duration` gần 0) hay timestamp
      không tăng dần (`duration` ÂM) — cả 2 có thể âm thầm "thắng" thành kỷ lục vô lý trong
      `records.json`/`best-efforts.json`. Đã kiểm mẫu dữ liệu đã downsample không thấy bất thường,
      nhưng chưa loại trừ được trên full-resolution GPS thật. **Cần quyết định:** thêm nội suy giống
      splits, và/hoặc guard `duration > 0`/tính hợp lý tốc độ trước khi chấp nhận 1 kết quả làm
      "record".

## Mức Low / Info

- [ ] GitHub Actions chỉ pin theo tag (`@v4`), không pin theo SHA (`actions/checkout@v4`,
      `actions/setup-node@v4`, cả 4 workflow). Rủi ro supply-chain thấp nhưng là thực hành chuẩn.

- [ ] Rebase conflict trong vòng lặp retry-push (cả 4 workflow YAML) giết script ngay lập tức thay
      vì thử đủ 4 lần hay báo lỗi rõ ràng — `git rebase origin/main` chạy trần dưới `set -e`. Không
      gây hỏng dữ liệu thật (runner ephemeral) nhưng log gây hiểu lầm. Cần chọn: tiếp tục retry qua
      conflict, fail-fast với message rõ ràng, hay fallback sang merge thường.

- [ ] `shoeKey()` (`scripts/etl/lib/gear.mjs`) chưa chuẩn hoá khoảng trắng nội bộ giữa nickname lưu
      trong catalog và nickname nhận từ 1 lần sync live (chỉ so không phân biệt hoa/thường + trim 2
      đầu) — có thể tái hiện bug duplicate-key nếu Strava API trả nickname spacing khác 1 chút, hoặc
      nếu cột `model` vô tình chứa lại tên `brand`.

- [ ] `src/pages/goals.astro:21,47,60` bake `t(DEFAULT_LANG,...)` thẳng vào JSX build-time (trộn
      nhãn đơn vị đã dịch với số đã format) thay vì dùng `<T>` — tái hiện 1 phiên bản nhẹ của bug
      flash i18n (giảm nhẹ bởi 1 client `repaint()` chạy sau paint đầu, nhưng chưa loại bỏ hoàn toàn
      timing gap). Cùng lớp vấn đề CLAUDE.md đã ghi nhận chưa giải cho `units.js` — cần bake sẵn 2
      chuỗi đã format số + dịch lúc build, không phải việc nhỏ.

- [ ] Pattern destroy+recreate Chart.js dùng cho MỌI trigger tương tác (không chỉ đổi theme) trên
      ~8 chart instance ở `stats.astro`/`performance.astro` — app đã biết dùng `chart.update()` cho
      case tần suất cao nhất (click legend) nhưng chưa mở rộng sang filter/select change. Cần tách
      "build config" khỏi "apply config" cho từng chart.

- [ ] `log.astro` dùng breakpoint mobile 760px/480px thay vì chuẩn 600px dùng ở mọi trang khác —
      không có comment giải thích, có thể chủ đích (sidebar cây điều hướng năm/tháng cần nhiều chỗ
      hơn trước khi collapse). Xác nhận rồi ghi chú lại, hoặc thống nhất về 600px nếu không có lý do
      thật.

- [ ] CSP `'unsafe-inline'` (`public/_headers`) có thể thu hẹp bằng cơ chế `security.csp` gốc của
      Astro (tự tính hash SHA-256 cho inline script/style, inject qua `<meta>`) — nhưng CSP qua meta
      không biểu đạt được `frame-ancestors`, nên vẫn cần giữ `_headers` song song, tức 2 cơ chế cần
      dung hoà thay vì thay thế nhau hoàn toàn. Không cấp bách, CSP hiện tại đã đủ chặt.

- [ ] Vài cơ hội tối ưu hằng số, chưa phải nút thắt hiệu suất ở quy mô hiện tại:
      `yearlyGoalTotals()` (`src/lib/stats.mjs`) lọc lại toàn bộ mảng activities 1 lần mỗi năm thay
      vì gộp vào 1 pass duy nhất (bị chặn bởi số năm, không phải số activity, nên chưa cấp bách);
      `foldRecords()`/`foldBestEfforts()` chạy 1 pass `bestEffort()` riêng biệt cho MỖI target
      distance (tới 10 cho Run) thay vì 1 pass co-optimize nhiều target cùng lúc.

- [ ] `writeJson()` (`scripts/etl/lib/paths.mjs`) không atomic (không dùng pattern temp-file +
      rename) — 1 process bị kill giữa lúc ghi (OOM, timeout runner, SIGKILL) có thể để lại file
      JSON cắt cụt. Phạm vi ảnh hưởng rộng (hàm ghi dùng chung cho hầu hết file JSON), nên đổi thiết
      kế cần cân nhắc kỹ trước khi làm.

- [ ] `STAT_GROUPS` (`src/pages/stats.astro`) là bản copy tay của `GOAL_GROUPS`'s Crossfit
      membership thay vì import trực tiếp `GOAL_GROUPS` rồi ghép thêm bảng `metric` per-group — hiện
      đang đồng bộ nhưng không có gì đảm bảo mãi mãi nếu `GOAL_GROUPS` đổi trong tương lai mà quên
      đổi theo ở đây.

- [ ] `scripts/etl/lib/tz.mjs`'s `vnMidnightUtc()` là dead code trong pipeline ETL — 0 importer
      ngoài chính file đó (bản dùng thật, cùng tên, ở `src/lib/format.js`). Vô hại, chỉ đáng dọn nếu
      có ai touch file này cho việc khác.

---

*Một số đánh giá ở trên dựa trên đọc code + mô phỏng local (không có token Strava sống/không
trigger workflow thật) — đối chiếu lại bằng traffic production nếu có nghi vấn cụ thể phát sinh sau
này.*
