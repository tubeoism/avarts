# Avarts Analytics — ghi chú cho Claude Code

Ứng dụng cá nhân theo dõi & phân tích tiến độ tập luyện, dựng từ dữ liệu bulk export của Strava.
Astro (static output, không SSR) + Chart.js thuần, host trên Cloudflare Pages, deploy qua GitHub
push. Không có backend/database — toàn bộ dữ liệu là JSON tĩnh sinh bởi pipeline ETL Node.js.

## Kiến trúc

```
export_<athlete_id>/         <- thư mục export gốc Strava, KHÔNG phải git repo (chỉ có khi chạy local)
├── activities.csv, profile.csv, ...  <- goals.csv không còn được dùng
├── activities/*.fit.gz|.gpx.gz|.tcx.gz   <- GPS/HR/cadence raw
└── app/                      <- git repo thật, root deploy Cloudflare Pages
    ├── download/              <- đổ export Strava vào đây để build qua GitHub Actions thay vì local
    ├── scripts/etl/           <- pipeline Node.js: đọc export gốc -> ghi JSON
    ├── src/pages/*.astro      <- các trang, import JSON từ src/data/ lúc build
    ├── src/lib/               <- format.js (date/số), stats.mjs (tổng hợp), data.mjs (loader)
    ├── public/data/*.json     <- BẢN THẬT DUY NHẤT, fetch được lúc runtime
    └── src/data/*.json        <- symlink -> public/data/*.json (trừ goal-targets.json — file thật
                                   riêng), để trang import lúc build
```

**Chạy ETL:** `npm run etl` (đọc từ thư mục cha, hoặc set `STRAVA_EXPORT_DIR`). Ghi đè
`public/data/`, làm mới symlink `src/data/`. Chạy lại mỗi khi có export mới, rồi `npm run build`.

**`retained-raw/`** (ở repo root, commit vào git) là bản sao lâu dài của đúng tập file ETL cần đọc
(`activities.csv`, `shoes.csv`, `bikes.csv`, `components.csv`, `events.csv`, `activities/*.gz`) —
KHÔNG phải toàn bộ export Strava (loại hẳn file không liên quan: orders, logins, messaging, media
ảnh, contacts...). Tồn tại vì môi trường Claude Code remote không có ổ đĩa persistent ngoài git —
thiếu nó, session sau chỉ còn stream đã downsample (200 điểm/activity), không tính lại chính xác
được splits/PR/routes/heatgrid full-resolution. `STRAVA_EXPORT_DIR=retained-raw npm run etl` chạy
thẳng được, không cần chuẩn bị gì thêm.

Khi có export Strava mới, ghi đè `retained-raw/` bằng export mới sau khi ETL chạy xong — không giữ
song song 2 bản. **Ngoại lệ:** `profile.csv` cố tình KHÔNG nằm trong `retained-raw/` (chứa PII thô
— Email/Tên/Weight thật, khác các CSV còn lại chỉ có số liệu tập luyện; `profile.json` build ra
chỉ giữ City/State/Country). `parseProfile()` tự bỏ qua nếu thiếu file (giữ nguyên `profile.json`
đã commit, không crash ETL).

**Vì sao JSON tĩnh, không Cloudflare D1:** dữ liệu cá nhân quy mô nhỏ, lọc/tổng hợp bằng JS trên
trình duyệt nhanh hơn D1 round-trip, khớp luồng "push GitHub → Cloudflare tự build" không cần
migrate/seed riêng.

**Vì sao `src/data/` chỉ là symlink:** build chạy bằng Node.js thường (filesystem đầy đủ), không
cần 2 bản JSON độc lập như thời còn dùng adapter Cloudflare (xem mục Deploy bên dưới).
`writeJsonBoth()` (`scripts/etl/lib/paths.mjs`) ghi 1 bản thật vào `public/data/`, symlink
`src/data/` trỏ vào đó — áp dụng cho file "core" (activities, gear, records, events, profile,
fitness, best-efforts), không gồm `streams/`, `routes.json`, `heatgrid.json` (chỉ tồn tại ở
`public/data/`, fetch runtime).

## Lệnh thường dùng

```bash
npm run etl       # chạy ETL khi có export Strava mới
npm run dev       # dev server (có Astro dev toolbar, có thể gây điều hướng lạ khi test bằng automation)
npm run build     # build ra dist/ static thuần
npm run preview   # serve bản build production — dùng cái này để verify trước khi push
```

Verify bằng preview tool: `preview_screenshot` có thể reload ngầm khiến state UI trông như bị reset
giữa 2 lần gọi — không phải bug thật. Dùng `preview_eval` để click + kiểm tra state trong cùng 1
lệnh gọi sẽ đáng tin cậy hơn.

## Nguyên tắc quan trọng khi sửa ETL/code

**Deploy:** KHÔNG dùng adapter `@astrojs/cloudflare`, kể cả khi host trên Cloudflare Pages — adapter
này luôn sinh `_worker.js` dù `output: 'static'`, khiến Cloudflare Pages chuyển sang Advanced Mode
và route MỌI request qua Worker ở edge (từng gây lỗi ngắt quãng 522/524/1101 dù build luôn thành
công). Build ra `dist/` static thuần; Cloudflare **Build output directory = `dist`**.

**Thời gian/timezone:**
- CSV Strava lưu giờ UTC không có hậu tố timezone — luôn parse bằng `Date.UTC(...)`
  (`lib/csv.mjs#toIso`), KHÔNG dùng `new Date(chuỗi)` trần (phụ thuộc múi giờ máy chạy script).
- Hiển thị giờ **per-activity** dùng timezone suy từ GPS (`geo-tz` → `activity.timezone`, fallback
  `Asia/Ho_Chi_Minh` nếu không có GPS). `geo-tz` gộp các timezone cùng offset dưới 1 tên khác nhau
  (VD trả `Asia/Jakarta` cho toạ độ Việt Nam) — xác định "có phải nước ngoài" phải so **offset UTC
  thực tế tại thời điểm đó** (`isForeignTimezone` trong `format.js`), không so tên chuỗi.
- Gộp nhóm theo ngày/tuần/tháng/năm (Dashboard, Goals, calendar, CTL/ATL/TSB) dùng lệch cố định
  **GMT+7** qua `toVnDate()`/`vnMidnightUtc()` (nhân bản ở `scripts/etl/lib/tz.mjs` và
  `src/lib/format.js`) — KHÔNG dùng `.getUTCFullYear()`/`Date.UTC()` trần cho ranh giới ngày/tuần/
  tháng/năm.

**CSV quirks (`scripts/etl/lib/csv.mjs`):**
- Dòng thiếu dấu phẩy cuối (cột cuối rỗng) → `readCsv()` phải pad, không lọc bỏ dòng.
- Cột trùng tên trong `activities.csv` (VD `Elapsed Time` xuất hiện 2 lần) → dùng
  `colIndexer().first()`/`.last()`, không `indexOf` ngây thơ.
- `Distance` tính bằng km cho mọi type, riêng **Swim tính bằng MÉT** — `parse-activities.mjs` chia
  `distanceKm` cho 1000 khi `type === 'Swim'`. Guard pace/speed: chỉ tính khi `distanceKm >= 0.3`
  và tốc độ suy ra `<= 80km/h`, ngược lại để trống. Sync qua API/MCP nhận `distanceMeters` tường
  minh nên không dính lỗi đơn vị này.
- Cột `Activity Gear` lưu `"<Brand> <Model>"` cho giày (nối thêm nickname nếu "Shoe Name" không
  rỗng: `"<Brand> <Model> <Nickname>"`), nhưng lưu **tên riêng xe** (`Bike Name`) cho xe đạp, không
  phải model. `shoeKey(brand, model, nickname)` (`lib/gear.mjs`) build key giày đúng convention
  này và idempotent (không nối trùng nếu nickname truyền vào đã là chuỗi ghép sẵn — 1 số nguồn API
  trả về dạng đã ghép) — luôn dùng hàm này, đừng tự ghép chuỗi tay.
- Cột `Athlete Weight`/`Bike Weight` (cân nặng thật, PII) đã bị loại khỏi `FIELD_MAP` và xoá trắng
  trong `retained-raw/activities.csv` — KHÔNG được thêm lại vào `activities.json`. Mỗi lần ghi đè
  `retained-raw/` bằng export mới, phải xoá trắng lại 2 cột này (workflow "Build từ download" tự
  động hoá bước này).

**2 pipeline ghi chung 1 file — quy tắc chung:** `run.mjs`/`parse-streams.mjs` (full ETL từ CSV) và
`sync-strava.mjs`/`sync-gear.mjs` (incremental, qua MCP hoặc REST API) đều ghi vào cùng các file
JSON. Logic tính các field sau PHẢI dùng chung helper ở `scripts/etl/lib/`, không viết riêng ở
từng pipeline — quên đồng bộ 1 chỗ sẽ làm activity mới nhất thiếu field dù activity cũ vẫn đúng:
`routes.json` (`lib/routes.mjs`), `best-efforts.json` (`lib/best-efforts.mjs`), `heatgrid.json`
(`lib/heatgrid.mjs`), `records.json` (`lib/records.mjs`), splits km/mile
(`lib/resample.mjs#splitsForType`), chuẩn hoá sport type (`lib/sport-type.mjs`, xem mục riêng bên
dưới). Field chỉ CSV export mới có (trống khi sync qua API/MCP): `trainingLoad`, `intensity`,
`elevationLoss`, `maxGrade`/`avgGrade`, `totalSteps`, các field Strength Training.

**Records/Best-effort/Splits:**
- Personal Records tự tính bằng sliding-window trên GPS thô — có thể lệch nhẹ số Strava hiển thị
  (thuật toán nội bộ khác), không phải bug cần sửa cho khớp.
- Chỉ tính từ hoạt động có GPS thật (`foldRecords`/`foldBestEfforts` gate theo `lat`/`lng` hợp lệ)
  — loại hoạt động trong nhà (trainer/footpod) dù có `distance`/`time` từ thiết bị. `routes.json`/
  `heatgrid.json` tự lọc GPS từ trước, không cần gate thêm.
- Strava đôi khi gán CÙNG 1 file GPS thô cho 2 activity ID (buổi tập bị tách khi tạm dừng tracking)
  — `parse-streams.mjs` phát hiện filename dùng chung và set `hasStream: false` cho các activity đó
  thay vì tính PR sai trên dữ liệu gộp.
- `routes.json`'s `coords` dùng `simplifyToCount()` (Ramer-Douglas-Peucker theo ngân sách điểm, giữ
  hình dạng khúc cua) — KHÁC `downsample()` (đều theo index, dùng cho `streams/*.json`'s `points`,
  đúng cho biểu đồ theo trục thời gian). Đừng lẫn 2 hàm khi sửa resample.
- `RECORD_TARGETS` (records.json) và `BEST_EFFORT_TARGETS` (best-efforts.json) là 2 danh sách cự
  ly KHÁC NHAU dù cùng ý tưởng — đừng gộp làm 1.
- Splits Ride/Swim dùng bước cố định (5km/250m, `computeFixedSplits()`), bỏ qua toggle km/mile; Run
  dùng per-km/per-mile (`splitsAtStep()`). `splitsForType()` chọn engine theo `activity.type`.
- File stream cũ (trước khi có field `splitsMi`) không có mile splits chính xác — client tự nội
  suy xấp xỉ từ mốc km (`approximateMileSplits()` trong `activities/[id].astro`), không phải số
  thật.
- Stream `watts` (power) rất thưa — chỉ 1 phần activity Run gần đây (thiết bị đo running power) có,
  Ride hầu như KHÔNG có field power thật (số `avgWatts` hiển thị cho Ride phần lớn là Strava tự ước
  tính, không nằm trong raw stream). Chart/cột Power trống là bình thường, không phải bug.
- `heatgrid.json` gộp GPS thành lưới ô ~30m, trọng số mỗi ô = **số activity đi qua** (dedupe trong
  1 activity), KHÔNG PHẢI số điểm GPS — tránh GPS đứng yên (dừng đèn đỏ) thổi phồng trọng số so với
  đoạn chạy nhanh qua đúng ô đó.

**Fitness (`compute-fitness.mjs`):** ưu tiên `relativeEffort` trước `trainingLoad` khi tính CTL/
ATL/TSB hằng ngày — 2 thang đo khác nhau (`trainingLoad` đọc cao gấp ~12 lần cho cùng activity),
đảo thứ tự sẽ tạo "vách đá" giả trên chart Fitness & Freshness đúng lúc đổi thiết bị đo.

**Cadence:** Run/Walk trong FIT/API lưu theo "1 chân" (strides/phút) — phải nhân đôi để khớp Strava
hiển thị (steps/phút), qua `normalizeCadence()` (`lib/cadence.mjs`). Ride KHÔNG nhân đôi (1 vòng
đạp = 2 chân, RPM thô đã đúng).

**Sport type:** Strava API trả `sport_type` (enum chi tiết hơn CSV, VD `TrailRun`/`Badminton`/
`WeightTraining`) — `normalizeSportType()` (`lib/sport-type.mjs`) map về 7 type gốc
(Run/Ride/Swim/Walk/Weight Training/Workout/Yoga). Phải gọi hàm này ở **mọi** pipeline tạo activity
entry — kể cả `parse-activities.mjs` (CSV) — ngay trước khi field khác đọc `type` (cadence, gộp
goal/stat, màu badge đều key theo type).

**Gear catalog (`gear.json`):**
- `applyGearDelta()` (trong `sync-strava.mjs`) chỉ cộng dồn km/thời gian cho entry ĐÃ tồn tại,
  không tự tạo entry mới/cập nhật `retired`. `sync-gear.mjs` mới đảm nhiệm việc đó — full-recompute
  riêng, chạy sau, nhận input từ `fetch-gear.mjs` (REST API: `GET /athlete` + `GET /gear/{id}`) hoặc
  MCP `get_gear`.
- `mergeGearCatalog()` (không phải full-replace) — cập nhật field khả biến cho entry đã có hoặc
  thêm entry mới, KHÔNG BAO GIỜ xoá entry chỉ vì nó vắng mặt trong response API lần này (`GET
  /athlete` không liệt kê gear đã retired). Full-replace (`buildGearCatalog()`) chỉ dùng ở pipeline
  CSV (`parse-gear.mjs`, khi build/restore từ export thật).
- Entry đã có trong catalog nhưng vắng mặt ở response API lần chạy này → suy luận `retired: true`.
  Guard: chỉ áp dụng khi response không rỗng (tránh 1 lần gọi lỗi/rỗng đánh retired oan toàn bộ
  catalog).
- `shoeKind()` nhận diện barefoot/sandal ưu tiên so khớp CHÍNH XÁC brand, có fallback so substring
  trên "brand+model+nickname" (`"chân đất"`/`"barefoot"`/`"xỏ ngón"`/`"sandal"`) cho trường hợp tín
  hiệu nằm ở model/nickname thay vì brand.

**File GPS trong export:** `activities/` trộn lẫn file nén (`.fit.gz`/`.gpx.gz`/`.tcx.gz`) và file
KHÔNG nén (`.fit`/`.gpx`/`.tcx` trần — hành vi Strava tự xác nhận) — `loadRawSeries()`
(`parse-streams.mjs`) chỉ gunzip khi filename kết thúc bằng `.gz`, và `ACTIVITY_EXTENSIONS`
(`refresh-retained-raw.mjs`) phải liệt kê cả 2 dạng đuôi. `build-incremental-from-csv.mjs` chỉ dựa
vào việc activity ID đã có dòng CSV trong `retained-raw/` hay chưa để coi là "mới" — activity từng
bị mất file thô kiểu này (có dòng CSV nhưng thiếu file vật lý) sẽ KHÔNG tự được xử lý lại qua
`mode=incremental`, cần `mode=full-reset` để phục hồi.

**UI:**
- Chart.js: bọc `<canvas>` trong `<div>` height CSS cố định + `maintainAspectRatio: false` — chỉ
  set `height` trên `<canvas>` sẽ tính sai aspect-ratio, cắt mất legend trên mobile.
- Toggle ngôn ngữ/đơn vị dùng pattern "render sẵn cả 2 phương án lúc build, ẩn/hiện bằng CSS" để
  tránh flash. Text tĩnh mới PHẢI dùng `<T key="..." />` (`src/components/T.astro`), KHÔNG quay lại
  pattern `data-i18n="key"` cũ (gây flash tiếng Việt trước khi nhảy tiếng Anh). 3 rule CSS ẩn/hiện
  bắt buộc có `!important`. Ngoại lệ giữ pattern cũ (chấp nhận được, không flash thấy được):
  `<option>`, thuộc tính `aria-label`/`placeholder`/`title`, và `log.astro` (build client-side).
  `vars` truyền cho `<T>` phải là function `(lang) => object` nếu field bên trong tự nó cũng là
  chuỗi đã dịch. `units.js`/km-mi có glitch flash số liệu tương tự, CHƯA sửa.

**Goal system:** không còn dựa vào `goals.csv`/Strava. Chỉ tiêu tĩnh ở `src/data/goal-targets.json`
(`{week, month, year} × {Run, Ride, Swim, Walk, Crossfit}`, tự tay sửa, không do ETL sinh). Tiến độ
tính trực tiếp từ `activities.json` lúc build (`GOAL_GROUPS`/`goalGroupTotals` trong `stats.mjs`) —
không có file JSON trung gian cho goal progress.

**Vận hành REST API sync (GitHub Actions):**
- Rate limit thật của Strava: 200 read/15 phút, 2000/ngày (đo qua header
  `X-ReadRateLimit-Usage`/`-Limit`). Cap nội bộ hiện đặt 370 (`MAX_READ_CALLS_PER_RUN` trong
  `strava-client.mjs`) — tăng cẩn thận, và tránh trigger tay `workflow_dispatch` liên tiếp trong
  vòng 15 phút (nguyên nhân duy nhất từng gây 429 thật).
- Backfill cursor (`oldestEpoch`) chỉ được cập nhật SAU KHI activity đã fetch thành công, không
  phải ngay khi bắt đầu xét — cập nhật sớm sẽ làm mất đúng 1 activity vĩnh viễn ở mỗi ranh giới
  rate-limit (`before` filter của Strava là exclusive nên không tự phục hồi qua các lần chạy sau).
  Cron audit hàng tuần (Chủ nhật, tự reset cursor về "bây giờ" ở `mode=backfill`) tự phát hiện +
  phục hồi gap nhờ dedup theo id — không cần dò tay so với bản backup.
- Refresh token phải mint với scope `activity:read_all` — scope khoá cứng lúc user bấm Authorize
  lần đầu, KHÔNG tự "xin thêm" qua `grant_type=refresh_token`. Thiếu scope phải làm lại từ đầu:
  mở `https://www.strava.com/oauth/authorize?client_id=<ID>&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all`
  → lấy `code` trên URL redirect → đổi lấy `refresh_token` qua `POST
  https://www.strava.com/oauth/token` với `grant_type=authorization_code` → verify lại bằng
  `grant_type=refresh_token` trước khi cập nhật GitHub secret. Refresh token ổn định lâu dài,
  không cần cập nhật lại secret sau mỗi lần chạy.
- REST API's `start_date_local` có hậu tố `Z` giả (giá trị thực chất là giờ địa phương thô, không
  phải UTC) — `buildSyncInputActivity()` phải strip `Z` trước khi coi là "no offset".

**Khác:** `streams/` chia theo năm (`streams/{year}/{id}.json`) vì GitHub web UI cắt hiển thị thư
mục >1000 file (không ảnh hưởng git/build, chỉ hiển thị).

## Tạo lập & đồng bộ dữ liệu

| Cách | Trigger | Tốc độ | Dùng khi |
|---|---|---|---|
| Build từ download, `mode=full-reset` | Tay (`workflow_dispatch`) | Nhanh nhất | Bootstrap toàn bộ lịch sử, disaster recovery |
| Build từ download, `mode=incremental` | Tay | Rất nhanh | Có export mới, phần lớn activity đã xử lý rồi |
| MCP + Claude Code | Tự động, nightly | Tức thời | Vận hành thường ngày |
| REST API + GitHub Actions | Tự động, 2 lần/ngày | Chậm (rate-limit) | Dự phòng khi MCP gián đoạn; backfill khi không có export |
| Restore from retained raw | Tay | Nhanh | Recompute sau khi sửa bug logic ETL, không cần export mới |

### Đồng bộ tự động — MCP (nightly, 2h sáng GMT+7, cron `0 19 * * *` UTC)

Routine agent-driven (không phải script cố định — cần gọi MCP tool):
1. `git fetch && checkout -B main origin/main`.
2. Đọc `date` lớn nhất trong `activities.json`, `list_activities` (Strava MCP) từ mốc đó, dedup id.
3. `get_gear` 1 lần/run (không điều kiện theo có activity mới hay không) — dùng để resolve
   `gear_id` → key (`shoeKey()`) cho activity mới, và làm input bước 5.
4. Activity mới (nếu có): `get_activity_performance` + `get_activity_streams` (full-res, gồm
   `watts`) → ghi file JSON tạm → `node scripts/etl/sync-strava.mjs <file>`.
5. Luôn chạy (kể cả không có activity mới): build mảng gear thô từ kết quả bước 3 →
   `node scripts/etl/sync-gear.mjs <file>`.
6. `npm run build` xác nhận — lỗi thì KHÔNG commit/push.
7. Commit + `git push origin main` thẳng.

**Lưu ý:** đây là thiết kế ĐÚNG cần có. Trigger đang chạy (`trig_014apvBsMpHZFjquxnQsCxxa`) có thể
chưa khớp mô tả này (đặc biệt bước 3/5 về gear) — kiểm tra nội dung trigger thực tế trước khi giả
định nó đã đúng, sửa tay nếu cần (không sửa được qua code trong repo).

### Đồng bộ tự động — REST API (GitHub Actions, dự phòng)

`.github/workflows/strava-api-sync.yml` — gọi thẳng Strava REST API, không qua MCP. Chạy 2
lần/ngày (5h sáng/5h chiều GMT+7) + trigger tay (`workflow_dispatch`, input `mode`:
`auto`/`forward-only`/`backfill`) + 1 cron Chủ nhật hàng tuần tự audit toàn bộ lịch sử
(`mode=backfill`).

Kiến trúc (tái dùng `sync-strava.mjs`, không sửa file đó):
- `api/strava-client.mjs` — refresh token, fetch wrapper theo dõi rate-limit header, ném
  `RateLimitStopError` khi chạm ngân sách/quota/429 (dừng sạch, exit 0, không coi là lỗi thật).
- `api/build-sync-input.mjs` — map response REST API sang schema "raw activity" của
  `sync-strava.mjs`.
- `api/backfill-state.mjs` + `backfill-state.json` (commit git) — lưu cursor giữa các lần chạy.
- `api/run-api-sync.mjs` — entrypoint 1 mẻ: refresh token → forward pass → backfill pass (nếu
  chưa `done`) → `sync-strava.mjs`. KHÔNG tự lặp — vòng lặp nằm ở workflow YAML.
- `api/fetch-gear.mjs` — `GET /athlete` + `GET /gear/{id}`, gọi 1 lần sau vòng lặp sync activity,
  hand off cho `sync-gear.mjs`.

**Backfill:** kích hoạt khi `activities.json` rỗng hoặc `mode=backfill` chủ động. Phân trang
`before=<cursor>` từ mới → cũ tới khi hết ngân sách hoặc hết trang (`done: true`).

**Vòng lặp tăng tốc** nằm trong 1 step bash của job (không phải nhiều cron entry) — mỗi vòng:
`run-api-sync.mjs` → build → commit+push ngay → đọc lại state → dừng nếu `done` hoặc
`lastRunStopReason` là `daily-quota`/`short-term-429` (giới hạn thật), ngược lại `sleep 900` rồi
lặp tiếp, tối đa 20 vòng. Guard chống kẹt: cursor không đổi giữa 2 vòng liên tiếp → `exit 1`.
Steady-state (không backfill) thoát ngay ở vòng 1.

**3 GitHub secrets cần có:** `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.

**Trùng lặp với nightly MCP:** an toàn nhờ dedup theo id; git push đụng nhau (hiếm) xử lý bằng
fetch+rebase+retry trong bước push.

### Build từ download (thủ công, `build-from-download.yml`)

Đổ export Strava (giải nén) vào `download/`, commit + push, trigger `workflow_dispatch` với input
`mode`.

- **`full-reset`** (mặc định): `wipe-data.mjs` xoá sạch `public/data/`/`retained-raw/` trước, rồi
  chạy `run.mjs` đầy đủ với `STRAVA_EXPORT_DIR=download`.
- **`incremental`**: KHÔNG wipe. `build-incremental-from-csv.mjs` chỉ xử lý activity có trong
  `download/activities.csv` nhưng CHƯA có trong `retained-raw/activities.csv`, merge vào state
  hiện có; activity đã có sẵn qua sync API/MCP không được "nâng cấp" lên bản CSV đầy đủ hơn (muốn
  vậy phải dùng `full-reset`). `gear`/`events`/`profile`/`fitness` vẫn recompute toàn bộ mỗi lần
  (rẻ). Nhanh hơn nhiều `full-reset` khi `download/` phần lớn trùng lần export trước.

Cả 2 mode: sau khi ETL xong, `npm run build` xác nhận trước (lỗi thì dừng, không đụng
`retained-raw/`/`download/`) → `refresh-retained-raw.mjs` làm mới `retained-raw/` từ `download/`
(allowlist cứng, tự xoá trắng `Athlete Weight`/`Bike Weight`) → reset `backfill-state.json` →
`clear-download.mjs` xoá nội dung `download/` (giữ `.gitkeep`/README) → commit + push.

**Rủi ro quyền riêng tư:** xoá `download/` chỉ xoá working tree, KHÔNG xoá lịch sử git — file từng
push vào đó vẫn xem được qua `git log`/`git show`. Chấp nhận được vì repo private.

### Restore from retained raw (thủ công, `restore-from-retained-raw.yml`)

Không lấy dữ liệu mới — chỉ tính lại toàn bộ `public/data/*.json` từ `retained-raw/` đã có sẵn.
Dùng sau khi sửa 1 bug logic ETL, muốn áp dụng cho dữ liệu đã commit mà không cần export mới. Luồng:
`wipe-data.mjs --keep-retained-raw` (giữ cả `profile.json` — `retained-raw/` không có `profile.csv`
nên không thể tái tạo lại) → `STRAVA_EXPORT_DIR=retained-raw npm run etl` → build → commit + push.
Input `confirm` phải gõ đúng `RESTORE`.

**Rủi ro chấp nhận:** `retained-raw/` có thể CŨ HƠN `activities.json` đang live (nightly/API sync
không đụng `retained-raw/`) — chạy restore sẽ ÂM THẦM LOẠI BỎ activity chỉ có qua sync mà chưa từng
vào `retained-raw/`, không có bước dò soát/merge lại. Muốn tránh, chạy "Build từ download" với
export mới nhất NGAY TRƯỚC khi restore.

### Wipe data (thủ công, `wipe-data.yml`)

Xoá sạch `public/data/*.json`/`streams/`/symlink/`retained-raw/` để dựng lại từ đầu. Input
`confirm` phải gõ đúng `WIPE`. KHÔNG đụng `goal-targets.json` hay `download/`. `backfill-state.json`
giữ `done: true` — API sync tự nhận ra `activities.json` rỗng và tự backfill lại. Build sẽ LỖI cho
tới khi 1 trong các cách trên chạy lại (chấp nhận được — Cloudflare Pages vẫn serve bản deploy cũ).

Cả 4 workflow GitHub Actions ở trên (REST API sync, build-from-download, restore-from-retained-raw,
wipe-data) dùng chung `concurrency: group: strava-api-sync` — GitHub tự xếp hàng, không bao giờ
chạy chồng lẫn nhau.

## Tính năng đã loại bỏ có chủ đích

- **Weight tracking** — cân nặng không đồng bộ đáng tin cậy, dữ liệu quá thưa.
- **Strength training log** — buổi Weight Training không ghi rep đầy đủ, log chi tiết không có giá trị.
- **Segment & route** (Strava) — theo yêu cầu, không dùng `segments.csv`/`routes.csv`.
- **Dữ liệu xã hội/tài khoản** (comments, posts, clubs, followers, logins, orders, privacy...) —
  không liên quan theo dõi tập luyện.

## Trang hiện có

- **`/`** Dashboard — tổng km/giờ theo tuần/tháng/năm/tất cả, biểu đồ khối lượng 30 tuần gần nhất,
  CTL/ATL/TSB, phân loại hoạt động, calendar heatmap 12 tháng, tiến độ goals đang active, 10 hoạt
  động gần nhất.
- **`/activities`** Nhật ký — bảng sort theo cột, hàng filter cố định (năm/tháng, tên, loại, min/max
  mọi cột số kể cả pace/thời gian dạng `m:ss`/`h:mm:ss`), áp dụng ngay khi gõ.
- **`/activities/[id]`** Chi tiết — bản đồ tuyến đường (MapLibre GL + OpenFreeMap), biểu đồ HR/độ
  cao/Cadence/Power chung 1 trục Y, bảng splits kèm HR TB/Power TB, badge múi giờ nếu ở nước ngoài.
  Ride/Swim splits dùng bước cố định 5km/250m; Weight Training/Workout/Yoga ẩn stat-card Quãng
  đường/Pace/Độ cao; Swim ẩn Độ cao, thêm Cadence.
- **`/routes`** — Mọi tuyến đường GPS chồng lên 1 bản đồ, tô màu theo loại, filter checkbox, click
  mở activity tương ứng. Có layer heatmap riêng.
- **`/log`** — Nhật ký tuần dạng cuộn vô hạn, mỗi tuần 1 hàng (7 ô ngày + tổng km/giờ/calories), mỗi
  hoạt động là 1 khối cầu. Điều hướng năm → tháng ở cột trái.
- **`/calendar`** — Lịch năm → tháng → ngày trên cùng 1 lưới (bấm để đào sâu cấp), mỗi ô hiện chấm
  màu theo loại hoạt động + tổng km/giờ/calories.
- **`/records`** — Personal records, 2 khối theo type: Run (1K–Marathon) và Ride (5K–50K).
- **`/goals`** — Tiến độ mục tiêu tự đặt theo Tuần/Tháng cho 5 nhóm (Run/Ride/Swim/Walk/Crossfit),
  cộng bảng mục tiêu Năm.
- **`/gear`** — Giày/sandal/chân đất/xe đạp: km tích lũy, ngưỡng cảnh báo thay (giày 2500km, sandal
  1500km), đánh dấu "Đã nghỉ hưu".
- **`/stats`** — Thẻ tổng hợp theo nhóm hoạt động, phân loại dạng bar ngang, khối lượng theo thời
  gian (combo chart, toggle Ngày/Tháng/Năm), phân bố theo thời gian dạng scatter, thói quen theo
  giờ/thứ trong tuần. Scatter tô màu theo năm bằng bảng màu cố định (`seriesVisual()` trong
  `lib/charts.js`) — dùng chung palette với `/performance`.
- **`/performance`** — Fitness & Freshness đầy đủ lịch sử, xu hướng hiệu suất theo tháng cho Run/Ride
  riêng, tương quan các chỉ số bình quân dạng scatter, best effort theo năm.

## Quyền riêng tư

Export gốc Strava (CSV, ảnh...) không commit vào git khi chạy ETL local. Ngoại lệ: `retained-raw/`
CÓ commit (chỉ đúng tập file ETL cần, xem "Kiến trúc"), và `public/data/streams/*`/`routes.json`/
`heatgrid.json` chứa toạ độ GPS chi tiết. Vì vậy repo **PHẢI để private**.

**Không workflow nào (wipe-data/build-from-download/restore-from-retained-raw/strava-api-sync)
rewrite lịch sử git** — cả 4 chỉ xoá/ghi working tree rồi commit tiếp. Dữ liệu thật đã từng commit
(`profile.csv` PII thô, `retained-raw/`, `streams/`, `routes.json`, `heatgrid.json` ở các lần build
trước khi wipe) vẫn xem được nguyên vẹn qua `git log`/`git show <sha>:<path>` dù working tree hiện
tại đã sạch. Với PR đã đóng/merge, dữ liệu còn tồn tại **độc lập** qua ref `refs/pull/<n>/head` trên
GitHub — không mất dù rewrite + force-push nhánh `main`. Chấp nhận được vì repo private; nếu sau
này cần public, rewrite lịch sử (`git filter-repo`) trên repo hiện tại KHÔNG đủ (không xoá được PR
ref qua git thường) — cách chắc ăn nhất là bắt đầu 1 repo mới hoàn toàn sạch (`git archive HEAD |
tar -x -C <thư mục mới>` rồi `git init` lại, KHÔNG `git clone` repo cũ).

Map (từ v2) gọi tile server bên thứ 3 (`tiles.openfreemap.org`) — bên thứ 3 thấy được bounding box
tuyến đường lúc runtime, thêm lý do giữ private.

`public/_headers` có CSP (chỉ Cloudflare Pages áp dụng, `npm run preview` local không đọc file
này). Whitelist đúng 1 origin ngoài (`tiles.openfreemap.org`, cả `img-src`/`connect-src`) +
`worker-src blob:` (MapLibre worker); `script-src`/`style-src` giữ `'unsafe-inline'` (cần cho
script `is:inline` bootstrap theme/lang + style attribute inline — đừng thắt chặt nếu chưa refactor
các script đó). Đổi tile server/thêm nguồn ngoài mới PHẢI cập nhật CSP cùng lúc — quên sẽ không
lỗi build, chỉ lỗi âm thầm production (map trắng, console báo CSP violation).
