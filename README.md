# Avarts Analytics

Ứng dụng cá nhân theo dõi & phân tích tiến độ tập luyện (chạy bộ, đạp xe, bơi, đi bộ, tập thể lực…),
dựng hoàn toàn từ dữ liệu sao lưu (bulk export) của Strava. Không phải SaaS, không có tài khoản
người dùng, không backend, không database — chỉ 1 người dùng duy nhất (chủ repo) và toàn bộ "cơ sở
dữ liệu" là các file JSON tĩnh nằm ngay trong repo.

## 1. Dự án này là gì và để làm gì

Strava free tier giới hạn khá nhiều thứ hữu ích cho việc tự phân tích sâu (lịch sử biểu đồ, so sánh
nhiều buổi tập, CTL/ATL/TSB, personal record theo nhiều cự ly, heatmap tuyến đường riêng...). Thay
vì trả phí Strava Premium, dự án này tự dựng lại đúng những phân tích cần thiết từ dữ liệu **export
gốc** mà Strava đã cho phép mọi người tải miễn phí, cộng với đồng bộ activity mới hàng ngày qua
Strava API — kết quả là một trang thống kê cá nhân, riêng tư, chạy hoàn toàn tĩnh và miễn phí
(Cloudflare Pages free tier).

Nguyên tắc thiết kế xuyên suốt:

- **Không backend, không database.** Một pipeline ETL (Node.js, chạy local hoặc trong GitHub
  Actions) đọc dữ liệu Strava rồi ghi ra JSON tĩnh, commit thẳng vào repo. Astro build site ở dạng
  `output: 'static'` — không SSR, không adapter Cloudflare Workers (xem mục Deploy trong
  `CLAUDE.md` — adapter đó từng gây lỗi 522/524 ngắt quãng dù build luôn thành công). Deploy chỉ là
  "push code lên GitHub, Cloudflare Pages tự build lại".
- **Dữ liệu là của chính mình, lưu trong repo của chính mình.** Không gửi dữ liệu tập luyện cho bên
  thứ 3 nào ngoài Strava (nguồn) và Cloudflare (nơi host). Vì vậy repo **bắt buộc phải để private**
  — xem mục Quyền riêng tư bên dưới.
- **3+1 nguồn dữ liệu bổ sung cho nhau**, không phụ thuộc duy nhất vào 1 con đường: ETL local chạy
  tay với export mới nhất, đồng bộ đêm qua Claude Code + Strava MCP, đồng bộ dự phòng qua GitHub
  Actions gọi thẳng Strava REST API, và build/restore trực tiếp trong GitHub Actions khi cần dựng
  lại toàn bộ lịch sử. Chi tiết đầy đủ ở mục 3 bên dưới.
- **Mọi phép tính "hay" (personal record, best-effort theo năm, CTL/ATL/TSB, heatmap mật độ tuyến
  đường...) đều tự tính từ GPS/nhịp tim thô**, không phải số Strava hiển thị sẵn — vì vậy cần giữ
  lại dữ liệu GPS full-resolution trong repo (`retained-raw/`) thay vì chỉ giữ bản đã downsample.

### Công nghệ dùng

- **Astro** (static output) cho toàn bộ trang `.astro`, không dùng framework UI nào (React/Vue) —
  tương tác client-side là JS thuần trong `<script>` của từng trang.
- **Chart.js** cho mọi biểu đồ (đường/cột/scatter/combo).
- **MapLibre GL** + tile server bên thứ 3 (OpenFreeMap) cho bản đồ tuyến đường (`/activities/[id]`,
  `/routes`).
- **Node.js** (script thuần, không framework) cho toàn bộ pipeline ETL ở `scripts/etl/`.
- **Cloudflare Pages** để host — build output tĩnh, không Worker, không binding nào.

### Các trang & chức năng

| Trang | Nội dung |
|---|---|
| `/` | Dashboard: tổng km/giờ theo tuần/tháng/năm/tất cả, biểu đồ khối lượng 30 tuần gần nhất, CTL/ATL/TSB, phân loại hoạt động, calendar heatmap 12 tháng, tiến độ mục tiêu đang active, 10 hoạt động gần nhất. |
| `/activities` | Nhật ký hoạt động dạng bảng: sort theo cột, filter live (năm/tháng, tên, loại, khoảng giá trị số kể cả pace/thời gian), chọn số dòng/trang. |
| `/activities/[id]` | Chi tiết hoạt động: bản đồ tuyến đường, biểu đồ HR/độ cao/cadence/power, bảng splits (km hoặc mile; Ride/Swim dùng bước cố định 5km/250m), badge múi giờ nếu hoạt động ở nước ngoài. |
| `/routes` | Toàn bộ tuyến đường GPS chồng lên 1 bản đồ + lớp heatmap mật độ, tô màu/filter theo loại hoạt động, click để mở chi tiết. |
| `/log` | Nhật ký tuần dạng cuộn vô hạn: mỗi tuần 1 hàng, mỗi hoạt động là 1 "bong bóng" (kích thước theo thời gian tập), điều hướng nhanh theo năm/tháng. |
| `/calendar` | Lịch tập luyện năm → tháng → ngày trên cùng 1 lưới, mỗi ô hiện loại hoạt động (chấm màu) + tổng cự ly/thời gian/calories. |
| `/records` | Personal records tự tính từ GPS thực tế (sliding-window): Run (1K → Marathon) và Ride (5K → 50K). |
| `/goals` | Tiến độ mục tiêu tự đặt (Tuần/Tháng/Năm) cho 5 nhóm hoạt động (Run/Ride/Swim/Walk/Crossfit), tính trực tiếp từ `activities.json` lúc build — không đồng bộ từ Strava. |
| `/gear` | Km tích lũy theo giày/sandal/chân đất/xe đạp, cảnh báo ngưỡng thay, đánh dấu đã nghỉ hưu. |
| `/stats` | Thống kê chuyên sâu: thẻ tổng hợp theo nhóm, phân loại hoạt động, khối lượng theo thời gian (ngày/tháng/năm), phân bố hoạt động dạng scatter, thói quen theo giờ/thứ trong tuần. |
| `/performance` | Fitness & Freshness đầy đủ lịch sử, xu hướng hiệu suất theo tháng (Run/Ride), tương quan các chỉ số bình quân, best-effort theo năm. |

Giao diện hỗ trợ song ngữ (VI/EN), đổi đơn vị (km/mile) và dark/light theme — toggle không giật
(zero-flash) qua CSS thuần, không cần JS chạy trước paint.

### Tính năng đã loại bỏ có chủ đích

Weight tracking (`/weight`), strength training log chi tiết set/rep (`/training`), segment & route
của Strava, và toàn bộ dữ liệu xã hội/tài khoản (comments, posts, clubs, followers, đơn hàng, đăng
nhập...) — không liên quan tới theo dõi tập luyện, hoặc dữ liệu quá thưa/không đáng tin để hiển thị.
Xem lý do chi tiết trong `CLAUDE.md`.

## 2. Kiến trúc dữ liệu

```
export_<athlete_id>/        <- thư mục export gốc Strava (chỉ có khi chạy local, KHÔNG phải git repo)
├── activities.csv, shoes.csv, bikes.csv, components.csv, events.csv, profile.csv
├── activities/*.fit.gz|.gpx.gz|.tcx.gz     <- GPS/HR/cadence/power thô
└── app/                     <- git repo này, root deploy lên Cloudflare Pages
    ├── download/            <- đổ export vào đây để build qua GitHub Actions thay vì local
    ├── retained-raw/        <- bản sao lâu dài (đã lọc PII) của CSV/GPS mà ETL đọc, commit vào git
    ├── scripts/etl/         <- pipeline Node.js: đọc export -> ghi JSON
    ├── src/pages/*.astro    <- các trang, build-time import JSON từ src/data/
    ├── src/lib/             <- format.js (date/số), stats.mjs (tổng hợp), data.mjs (loader)
    ├── public/data/*.json   <- JSON fetch được lúc runtime — BẢN THẬT DUY NHẤT
    └── src/data/*.json      <- symlink trỏ vào public/data/*.json (để trang .astro import lúc build)
```

Một script ETL (`npm run etl`) đọc export gốc của Strava (CSV + `.fit.gz`/`.gpx.gz`/`.tcx.gz`), lọc
bỏ dữ liệu không liên quan tới tập luyện (xã hội, tài khoản, ảnh, cân nặng thật...), tính toán sẵn
(CTL/ATL/TSB, personal records, best-effort theo năm, heatmap tuyến đường, km theo gear...) rồi ghi
ra `public/data/*.json` (bản thật) + symlink `src/data/*.json` (để Astro `import` lúc build) +
`public/data/streams/{năm}/{activityId}.json` (GPS/HR/cadence/power chi tiết, chỉ fetch khi mở
trang chi tiết hoạt động).

`goal-targets.json` (`src/data/`) là ngoại lệ duy nhất — file thật tự tay chỉnh (không do ETL sinh),
chứa chỉ tiêu Tuần/Tháng/Năm cho 5 nhóm hoạt động.

`retained-raw/` (commit vào git, ở repo root) là bản sao lâu dài của đúng tập file CSV/GPS mà ETL
đọc — đã lọc bỏ mọi dữ liệu nhạy cảm không liên quan (đơn hàng, đăng nhập, ảnh cá nhân, PII trong
`profile.csv`, cân nặng thật...). Mục đích: môi trường chạy Claude Code / GitHub Actions không có ổ
đĩa persistent ngoài git, nên nếu không giữ raw GPS trong repo, các thao tác cần dữ liệu
full-resolution (personal records, splits, heatmap...) sẽ không tính lại chính xác được. Nhờ đó
`STRAVA_EXPORT_DIR=retained-raw npm run etl` chạy được ở bất kỳ session nào, không cần export gốc
nằm ngoài repo.

Vì sao JSON tĩnh thay vì Cloudflare D1/database khác: quy mô dữ liệu cá nhân nhỏ (nén còn ~65KB cho
toàn bộ lịch sử tóm tắt), lọc/tổng hợp bằng JS trên trình duyệt nhanh hơn round-trip database, và
khớp đúng luồng "push GitHub → Cloudflare tự build" không cần bước migrate/seed riêng.

Toàn bộ quyết định thiết kế và các nguyên tắc/quy tắc rút ra từ quá trình phát triển được ghi chi
tiết trong [`CLAUDE.md`](./CLAUDE.md) — bắt buộc đọc trước khi sửa code liên quan tới ETL, timezone,
gear catalog, hoặc bất kỳ pipeline nào ghi ra JSON. [`audit_note.md`](./audit_note.md) là backlog
các phát hiện audit chưa xử lý, dùng khi cần biết việc gì còn tồn đọng.

## 3. Hướng dẫn set up

### Yêu cầu

- Node.js ≥ 22.12 (xem `package.json#engines`).
- Một tài khoản Strava có lịch sử hoạt động muốn phân tích.
- Một tài khoản Cloudflare (free tier đủ dùng) nếu muốn deploy.
- Repo GitHub **private** (bắt buộc — xem mục Quyền riêng tư).

### 3.1. Cài đặt lần đầu

```bash
git clone <repo-url>
cd avarts-analytics/app   # hoặc đúng thư mục chứa package.json
npm install
```

### 3.2. Nạp dữ liệu lần đầu (chọn 1 trong các cách sau)

Có 4 cách để có dữ liệu, tuỳ tình huống:

**Cách A — chạy ETL local với export Strava thật (đầy đủ nhất, nên dùng nếu có thể):**

1. Vào Strava → Settings → My Account → "Download or Delete Your Account" → yêu cầu xuất dữ liệu
   (Strava gửi email kèm link tải file ZIP sau vài phút tới vài giờ).
2. Giải nén ZIP ra thư mục **cha** của repo (tức `export_<athlete_id>/` nằm ngoài, `app/` — repo
   này — nằm bên trong nó), theo đúng cấu trúc ở mục 2. Đây chính là thư mục ETL đọc mặc định.
3. Chạy:
   ```bash
   npm run etl      # đọc từ thư mục cha; hoặc STRAVA_EXPORT_DIR=<đường dẫn khác> npm run etl
   npm run build    # build thử để kiểm tra
   ```
4. Commit + push kết quả trong `public/data/`, `src/data/` (symlink), và `retained-raw/` (ETL tự
   làm mới cả 2).

**Cách B — build từ export tải thủ công qua GitHub Actions** (không cần máy có Node/export nằm
sẵn cạnh repo — dùng khi làm việc từ môi trường remote/không có ổ đĩa persistent):

1. Copy toàn bộ nội dung export đã giải nén vào thư mục `download/` trong repo (xem
   `download/README.md` để biết chính xác cần file nào).
2. Commit + push.
3. Tab **Actions** trên GitHub → workflow **"Build from downloaded data"** → **Run workflow**,
   chọn `mode`:
   - `full-reset` (mặc định) — xoá sạch dữ liệu cũ, dựng lại toàn bộ từ đầu. Dùng khi bootstrap
     lần đầu hoặc disaster recovery.
   - `incremental` — chỉ xử lý các activity mới có trong `download/` mà chưa từng qua ETL đầy đủ,
     giữ nguyên dữ liệu cũ. Nhanh hơn nhiều khi phần lớn export đã trùng lần trước.
4. Action tự chạy ETL, làm mới `retained-raw/`, build thử, dọn sạch `download/`, rồi commit + push
   thẳng `main`.

**Cách C — để pipeline REST API tự backfill dần** (chậm nhất, chỉ nên dùng khi không có export
sẵn và không tiện dùng GitHub Actions thủ công): xem mục 4.2 bên dưới — `strava-api-sync.yml` tự
nhận ra dữ liệu rỗng và tự chạy backfill nhiều vòng, có thể mất vài giờ tới vài ngày tuỳ số lượng
hoạt động do giới hạn rate-limit của Strava.

**Cách D — restore từ `retained-raw/` đã có sẵn** (không cần export mới, chỉ tính lại): nếu repo
đã có `retained-raw/` (fork từ repo khác, hoặc vừa sửa 1 bug logic ETL cần áp dụng lại cho dữ liệu
cũ) — trigger tay workflow **"Restore from retained raw"** (gõ `RESTORE` để xác nhận), hoặc local
chạy `STRAVA_EXPORT_DIR=retained-raw npm run etl`.

Xem bảng so sánh đầy đủ 4 cách (tốc độ, khi nào dùng) trong `CLAUDE.md` mục "4 cách tạo lập dữ
liệu, tóm tắt khi nào dùng cách nào".

### 3.3. Chạy dev / build / preview local

```bash
npm run dev        # dev server (có Astro dev toolbar)
npm run build      # kiểm tra i18n parity rồi build ra dist/ (static thuần)
npm run preview    # serve bản build production — dùng cái này để verify trước khi push
npm run i18n:check # chỉ kiểm tra parity giữa src/i18n/vi và src/i18n/en, không build
```

`npm run preview` phản ánh đúng bản build sẽ deploy (không có dev toolbar, không hot-reload) — nên
dùng nó để verify trước khi push, đặc biệt để test toggle ngôn ngữ/đơn vị/theme và các trang có
bản đồ (MapLibre).

### 3.4. Deploy lên Cloudflare Pages

1. Push repo lên GitHub (bắt buộc **private**).
2. Cloudflare dashboard → Workers & Pages → Create → Pages → kết nối repo GitHub.
3. Framework preset: **Astro**. Build command: `npm run build`. **Build output directory: `dist`**
   (không phải `dist/client` — repo này không dùng adapter Cloudflare, xem `CLAUDE.md` mục Deploy).
4. Deploy — các lần push sau tự động build lại. Vì dữ liệu JSON đã commit sẵn trong repo,
   Cloudflare không cần chạy ETL/gọi Strava lúc build — build chỉ đơn thuần bundle static site.

## 4. Vận hành hàng ngày (giữ dữ liệu luôn mới)

Sau khi đã có dữ liệu lịch sử đầy đủ (mục 3.2), có 2 cơ chế **tự động** chạy song song để bổ sung
activity mới mỗi ngày mà không cần export lại toàn bộ:

### 4.1. Đồng bộ đêm qua Claude Code + Strava MCP

Một routine (Claude Code Remote) chạy lúc **2h sáng GMT+7** hàng ngày:

1. Đọc `date` lớn nhất trong `activities.json`, gọi Strava MCP connector (`list_activities`) lấy
   các activity mới hơn mốc đó.
2. Với mỗi activity mới: lấy chi tiết + GPS stream đầy đủ qua MCP, resolve gear.
3. Gọi `get_gear` để lấy toàn bộ catalog xe/giày hiện tại, merge vào `gear.json`.
4. Merge activity mới vào `activities.json`/`streams/`/`records.json`/`best-efforts.json`/
   `fitness.json` qua `scripts/etl/sync-strava.mjs`.
5. `npm run build` để kiểm tra — build lỗi thì dừng, không commit.
6. Build ok thì commit + push thẳng `main` (không qua PR) để Cloudflare Pages tự deploy.

Đây là pipeline tách biệt với `npm run etl` đầy đủ — không đọc CSV/GPS gốc, chỉ đọc/ghi JSON đã
commit + gọi Strava API, nên vài trường chỉ CSV export mới có (`trainingLoad`, `intensity`,
`athleteWeight`...) sẽ tạm trống cho tới lần chạy ETL đầy đủ kế tiếp.

Không cần thiết lập gì thêm cho cơ chế này ngoài việc connector Strava đã được authorize sẵn cho
Claude Code Remote — không cần đăng ký API key riêng.

### 4.2. Đồng bộ dự phòng qua GitHub Actions (Strava REST API)

Độc lập hoàn toàn với Claude Code — dùng khi routine MCP gián đoạn, hoặc khi cần backfill toàn bộ
lịch sử mà không có export sẵn. `.github/workflows/strava-api-sync.yml` chạy:

- **2 lần/ngày** tự động: `0 22 * * *` và `0 10 * * *` UTC (tức 5h sáng và 5h chiều GMT+7) — đồng
  bộ activity mới kể từ lần chạy trước, đồng thời tiếp tục backfill nếu đang dở dang.
- **1 lần/tuần** (`0 2 * * 0` UTC, Chủ nhật 9h sáng GMT+7) — tự audit lại **toàn bộ** lịch sử để
  phát hiện/phục hồi activity nào đó bị bug nào bỏ sót (rẻ trong trường hợp bình thường nhờ dedup
  theo id).
- Trigger tay bất cứ lúc nào: tab Actions → **"Strava API sync"** → Run workflow → chọn `mode`
  (`auto`/`forward-only`/`backfill`).
- Sau vòng đồng bộ activity, luôn gọi `GET /athlete` + `GET /gear/{id}` để đồng bộ lại catalog
  gear (`gear.json`) — tạo entry mới, cập nhật trạng thái "đã nghỉ hưu".

**Cần thiết lập 3 GitHub repository secrets** (Settings → Secrets and variables → Actions):
`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.

Cách lấy `STRAVA_REFRESH_TOKEN` đúng scope (bắt buộc `activity:read_all`, scope mặc định của màn
hình OAuth thường chỉ có `read` — sẽ báo lỗi 401 nếu thiếu):

1. Tạo 1 Strava API application tại https://www.strava.com/settings/api để có `Client ID` +
   `Client Secret`.
2. Mở URL sau (thay `<ID>` bằng Client ID), bấm **Authorize**:
   ```
   https://www.strava.com/oauth/authorize?client_id=<ID>&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
   ```
   Trình duyệt sẽ redirect tới `http://localhost/?code=<CODE>&scope=...` và báo lỗi "không kết nối
   được" — bình thường, chỉ cần lấy `code` trên thanh địa chỉ.
3. Đổi `code` lấy refresh token thật:
   ```bash
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=<ID> -d client_secret=<SECRET> \
     -d code=<CODE> -d grant_type=authorization_code
   ```
   Lấy field `refresh_token` trong response JSON.
4. Verify token trước khi lưu secret (tránh tốn 1 lần Action chạy fail):
   ```bash
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=<ID> -d client_secret=<SECRET> \
     -d refresh_token=<TOKEN> -d grant_type=refresh_token
   ```
   Phải trả về `200` kèm `access_token` mới — nếu vậy, lưu `<TOKEN>` (refresh token, không phải
   `access_token`/`code`) làm secret `STRAVA_REFRESH_TOKEN`.

Chi tiết đầy đủ về rate-limit thật của Strava (đã đo bằng header response, không phải suy luận) và
cơ chế backfill nhiều vòng — xem `CLAUDE.md` mục "Vận hành REST API sync" và "Đồng bộ tự động —
REST API (GitHub Actions, dự phòng)".

### 4.3. Các thao tác vận hành thủ công khác (GitHub Actions, trigger tay)

| Workflow | Khi nào dùng |
|---|---|
| **Build from downloaded data** | Có export Strava mới, muốn dựng lại toàn bộ hoặc bổ sung nhanh (xem mục 3.2 cách A/B). |
| **Restore from retained raw** | Vừa sửa 1 bug trong logic ETL, muốn áp dụng lại cho dữ liệu đã commit mà không cần export mới. Gõ `RESTORE` để xác nhận. **Rủi ro:** có thể âm thầm loại bỏ activity chỉ tồn tại nhờ sync đêm/API mà chưa từng vào `retained-raw/` — chạy "Build from download" trước nếu muốn tránh. |
| **Wipe data (reset for a fresh rebuild)** | Cần xoá sạch toàn bộ dữ liệu đã sinh ra để nạp lại từ đầu (VD chuẩn bị nạp export hoàn toàn mới). Gõ `WIPE` để xác nhận. Sau khi chạy, build sẽ lỗi cho tới khi 1 trong các cách ở mục 3.2 chạy lại — đây là hậu quả biết trước, Cloudflare Pages vẫn phục vụ bản deploy cũ cho tới khi có build mới thành công. |

Cả 4 workflow (`strava-api-sync`, `build-from-download`, `restore-from-retained-raw`, `wipe-data`)
dùng chung 1 `concurrency group` — GitHub tự xếp hàng, không bao giờ chạy chồng lên nhau vì tất cả
đều ghi cùng bộ file JSON và push thẳng `main`.

## 5. Quyền riêng tư

Repo này **phải để private** — không phải tuỳ chọn:

- `retained-raw/` (commit vào git) chứa CSV + file GPS thô đã qua lọc, nhưng vẫn là dữ liệu tập
  luyện chi tiết theo từng buổi.
- `public/data/streams/*.json` chứa toạ độ GPS chi tiết từng hoạt động — có thể lộ khu vực nhà ở
  qua điểm bắt đầu/kết thúc.
- Trang bản đồ (`/activities/[id]`, `/routes`) gọi trực tiếp tile server bên thứ 3
  (`tiles.openfreemap.org`) lúc runtime — bên thứ 3 này thấy được khu vực bounding box của tuyến
  đường đang xem.
- File PII thô nhất (`profile.csv` — email/tên/cân nặng thật) **cố tình bị loại khỏi**
  `retained-raw/`; cột `Athlete Weight`/`Bike Weight` trong `activities.csv` cũng bị xoá trắng
  trước khi commit.
- `download/` chỉ xoá nội dung trên working tree sau khi build xong — **không xoá lịch sử git**,
  nên chỉ nên copy đúng file ETL cần (xem `download/README.md`), tránh đổ nguyên export gốc có
  ảnh/đơn hàng/tin nhắn vào đó.

`public/_headers` set Content-Security-Policy áp dụng lúc deploy trên Cloudflare Pages (không có
hiệu lực khi chạy `npm run preview` local) — whitelist đúng 1 origin ngoài (`tiles.openfreemap.org`).

## 6. Tài liệu tham khảo thêm

- [`CLAUDE.md`](./CLAUDE.md) — toàn bộ quyết định thiết kế, quy tắc/gotcha rút ra từ quá trình
  phát triển, chi tiết kiến trúc từng pipeline. Đọc trước khi sửa code liên quan tới ETL, timezone,
  gear catalog, hoặc bất kỳ pipeline nào ghi ra JSON.
- [`audit_note.md`](./audit_note.md) — backlog các phát hiện audit (thiết kế/toàn vẹn/an ninh/hiệu
  suất) chưa xử lý, xếp theo mức độ ưu tiên.
- [`download/README.md`](./download/README.md) — hướng dẫn chi tiết cách lấy export Strava và đổ
  vào `download/` cho workflow "Build from downloaded data".
- [`AGENTS.md`](./AGENTS.md) — ghi chú ngắn cho việc chạy dev server ở chế độ nền và link tài liệu
  Astro.

## 7. Bản quyền, giấy phép & miễn trừ trách nhiệm

**Bản quyền & giấy phép:** Ý tưởng và định hướng sản phẩm thuộc về Tú (tunt.pro). Toàn bộ code được
phát triển hoàn toàn bằng Claude Code. Phát hành theo giấy phép **MIT** — xem [`LICENSE`](./LICENSE)
— nghĩa là ai cũng được tự do dùng, copy, sửa, fork cho mục đích của riêng mình, kể cả thương mại,
miễn giữ lại thông báo bản quyền gốc; phần mềm cung cấp "nguyên trạng", không kèm bảo hành nào.

**Miễn trừ trách nhiệm:** Đây là công cụ cá nhân xử lý dữ liệu tập luyện — bao gồm toạ độ GPS chi
tiết từng buổi tập — nên rủi ro lớn nhất khi tự triển khai không phải lỗi phần mềm mà là **thiết
lập/sử dụng sai cách** (VD để repo public, đổ nhầm export chưa lọc vào nơi commit được, bỏ qua bước
xoá PII đã mô tả trong `CLAUDE.md`/`README.md`...). Trước khi thiết lập và sử dụng, người dùng tự
cân nhắc chi phí, lợi ích, và rủi ro lộ dữ liệu cá nhân của chính mình — tác giả không chịu trách
nhiệm cho hậu quả phát sinh từ việc tự triển khai hoặc tuỳ biến dự án.

**Khuyến nghị:** Dự án không có đội ngũ hỗ trợ hay hướng dẫn triển khai riêng ngoài tài liệu trong
repo. Muốn tuỳ chỉnh, xây dựng lại, hoặc bổ sung tính năng theo ý mình, khuyến nghị dùng 1 công cụ
AI có khả năng lập trình tốt — Claude Code, OpenAI Codex, hoặc Google Antigravity — để agent đọc
`CLAUDE.md`/`audit_note.md`/`README.md` rồi hỗ trợ trực tiếp (bao gồm cả hướng dẫn triển khai riêng
cho tình huống của bạn), thay vì tự đọc hiểu toàn bộ codebase từ đầu.
