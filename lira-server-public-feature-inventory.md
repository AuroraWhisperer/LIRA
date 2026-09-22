# LIRA Server 服务器端全量对外功能清单

> 盘点对象：`D:\Work\lira-server`（LIRA Server v0.6）。**本盘点只读，未修改目标仓库任何文件。**
> 用途：为后续编写「面向主播（电脑小白）」的使用文档提供事实底稿。
> 读者分类：**主播本人** / **平台管理员** / **观众**。
> 所有结论附证据文件路径（相对 `D:\Work\lira-server`）。**未证实的一律标注「需人工确认」，不臆造。**

---

## 0. 先说三个会直接影响文档写法的纠正

写文档前必须先纠正任务假设里的三处，否则会写出现实中不存在的东西：

| 任务里的说法 | 服务器端实际情况 | 证据 |
| --- | --- | --- |
| 「盲盒榜」 | **服务器端没有这个页面。** 但**客户端有一个叫「盲盒盈亏榜」的本机 OBS 浏览器源**（不是网页，也不是服务器路由）：`实时展示观众的盲盒开盒盈亏排名。标题、排行人数、仅显示盈利和仅显示心动盲盒都在礼物页的「盲盒盈亏榜」卡片设置。` 服务器侧盲盒相关内容只有礼物档案页的「盲盒参考概率」和礼物详情的「可开出礼物」奖池 | 服务器：`src/app.js:305-355`（全部页面路由，无榜单）；`src/routes/gifts-public.js:125-197`（全部公开礼物 API）；全仓库 grep「盲盒榜」0 命中。客户端：`D:\Work\Live\public\pages\admin\toolbox\usage-guide.html:801-806` |
| 「Fame Road/名人堂」 | **「名人堂」不存在**（服务器仓库 grep 0 命中）。「Fame Road」是浏览器本地小游戏《成名之路》，与直播间无关、不读服务器数据、进度只存本机 | `public/games/game-catalog.json:5-17`；`README.md:152-171` |
| 「抽卡活动」 | 服务器端**没有**抽卡活动页面。三个小游戏都是「公开、无需登录、无真实价值的浏览器本地概率模拟，不是 B 站官方活动，也不连接直播间」 | `README.md:160-166`；`public/games/index.html:59` |

> 结论：**服务器端没有荣誉榜、没有排行榜页面、没有真实抽卡活动。** 主播能看到的「排行榜」只有客户端本机渲染的 **盲盒盈亏榜**（OBS 浏览器源），不能写成服务器页面。

---

## 1. 四份入口文档描述的服务器职责与部署方式

### 1.1 `README.md`（332 行，面向部署者/维护者）

- **产品定位**：LIRA = **Live Interactive Room Assistant**（直播间互动助手），本仓库是服务端 **LIRA Server**。见 `README.md:3`。
- **版本主题**：v0.6 =「首次开户注册 + 多设备短效授权 + 设备硬件授权」。见 `README.md:1`。
- **核心职责**（`README.md:9-10`、`150-151`、`250-307`）：
  1. 多租户账号与设备授权（Admin 生成短效码 → 主播激活 → 设备挑战/验证 → 10 分钟短期 Device Token）；
  2. 每个主播独立的 SQLite 数据空间与公开子域名；
  3. 云端歌单（桌面客户端同步写入，网页只读查看）；
  4. 公开礼物特效目录（独立于 Admin 和任一主播租户）；
  5. 浏览器本地小游戏目录（服务器只做 Host allow-list 与静态文件响应）；
  6. B 站直播间持续监听（弹幕/礼物），供 OBS overlay 使用。
- **三类数据文件**（`README.md:79-87`）：
  ```text
  admin/admin.db                        # Admin、主播身份、密码哈希、激活码、License、设备、公钥、硬件指纹、Session、审计
  streamers/<data_dir>/db/streamer.db   # 该主播的直播监控、弹幕设置、礼物、SC、大航海、人数采样、B 站凭据
  streamers/<data_dir>/web/songs.db     # 该主播网页歌单
  ```
  新主播目录统一为 `<streamerId>-<subdomain>`，例如 `streamers/1-mlbb/`（`README.md:44-55`、`66`）。
- **部署方式**（`README.md:179-219`、`309-332`）：
  - DNS：`@`/`www`/`api`/`admin`/`*`/`games`/`*.games` 全部指向同一台生产服务器（`README.md:183-191`）。
  - TLS 证书必须覆盖 `lirahub.cn`、`www.lirahub.cn`、`api.lirahub.cn`、`admin.lirahub.cn`、`*.lirahub.cn`、`games.lirahub.cn`、`*.games.lirahub.cn`（`README.md:195`）。
  - **Node 只监听内部 `127.0.0.1:3000`**，Nginx 反向代理保留原始 Host（`README.md:197`）。3000 端口不得公开。
  - 环境变量：复制 `.env.example` → `.env`，必须替换 **7 个** `replace-with-...` 占位密钥，每个用 `openssl rand -base64 48` 单独生成：`ADMIN_JWT_SECRET`、`STREAMER_JWT_SECRET`、`DEVICE_JWT_SECRET`、`ACTIVATION_CODE_PEPPER`、`PASSWORD_RESET_PEPPER`、`BILI_CREDENTIAL_SECRET`、`GIFT_HISTORY_TOKEN_SECRET`（`README.md:207-215`）。
  - 管理员账号创建：`npm run create-admin -- admin "至少12位强密码"`，然后 `npm start`（`README.md:217-218`）。
  - 生产必备变量见 `README.md:229-242`（`NODE_ENV=production`、`HOST=127.0.0.1`、`BASE_DOMAIN`、`API_HOST`、`ADMIN_HOST`、`ADMIN_PUBLIC_ORIGIN`、`ADMIN_COOKIE_SECURE=true`、`STREAMER_COOKIE_SECURE=true`、`DEVICE_REQUIRE_VERIFIED_INTEGRITY=true`、`TRUST_PROXY=1`）。
  - Ubuntu 部署示例用 PM2（`ecosystem.config.cjs`），Node.js 20+（`README.md:309-332`）；实际生产用专用 Node 22.23.2，见 `docs/operations/deployment-runtime.md:8`。

### 1.2 `AGENTS.md`（23 行，面向代码贡献者/维护者）

不是产品文档，是**文档与代码治理规则**：
- 改设备授权、Session、API、租户边界、数据同步或 B 站连接前必须先读 `docs/README.md`（`AGENTS.md:3`）。
- `docs/audits/`、`docs/superpowers/plans/`、historical 文档**不是当前规范**（`AGENTS.md:5`）。
- 行为变化必须同一变更内更新 requirement、acceptance criteria、protocol/OpenAPI、自动化测试、ADR（`AGENTS.md:7-13`）。
- 分层：路由层只做输入/输出编排，签名与标准化在 `src/lib/`，领域流程在 `src/modules/`，租户数据库访问在 `src/storage/`（`AGENTS.md:21`）。

### 1.3 `docs/README.md`（62 行，文档索引，面向维护者）

- **阅读入口分工**（`docs/README.md:3-16`）：部署与更新 → `operations/`；客户端接入 → `guides/`；改设备授权/通信 → `protocol/` + `requirements/`；改租户/存储 → `architecture/`。
- **文档权威顺序**（`docs/README.md:18-24`）：1. `protocol/` 与 `requirements/`（规范来源）→ 2. OpenAPI 与 fixtures → 3. Accepted ADR → 4. Tests → 5. `audits/`、`superpowers/plans/`（non-normative）、客户端实施指南（informative）、旧版本快照（historical）。
- **归档规则**（`docs/README.md:54-62`）：`operations/` 放运维操作，`guides/` 放客户端实施指南，`design/` 放设计稿，`history/` 放历史升级，`audits/` 放审计。
- 单文件 800 行上限由 `test/architecture-governance.test.js` 检查（`docs/README.md:41`）。

### 1.4 `docs/protocol/README.md`（101 行，协议总入口，normative）

- **协议版本**：当前服务端协议版本 `2`，适用服务版本 `lira-server-v0.6`（`docs/protocol/README.md:53`）。
- **生产 Origin 表**（`docs/protocol/README.md:35-42`）：

  | Surface | Production origin |
  | --- | --- |
  | 公开首页 | `https://lirahub.cn`（兼容 `https://www.lirahub.cn`） |
  | 公开礼物档案 | `https://gifts.lirahub.cn`（主站 `/gifts` 保留兼容） |
  | Device API 与桌面客户端公共礼物目录 | `https://api.lirahub.cn` |
  | Admin / Streamer 统一管理入口 | `https://admin.lirahub.cn` |
  | Streamer 公开歌单与 overlay | `https://<subdomain>.lirahub.cn` |
  | 小游戏目录与玩法 | `https://games.lirahub.cn`、`https://<slug>.games.lirahub.cn` |

- **HTTPS 强制**：除 `/health` 外，生产请求若代理规范化协议不是 HTTPS，应用在路由前返回 `426 { "error": "HTTPS_REQUIRED" }`（`docs/protocol/README.md:44`；实现见 `src/app.js:71-76`）。
- **健康探测**：`GET /health` 无需认证，返回 `ok`、`service`、`version`、`time`、`db`、`monitors`、`giftCatalog`；身份库摘要失败返回 503 + `ok=false` + `db=error`（`docs/protocol/README.md:48-51`；实现 `src/app.js:82-107`）。
- **公开礼物契约版本**：当前 `3.0.0`（图片直连基线 2.0.0；3.0.0 把目录类别替换为必填 `giftCategory`）（`docs/protocol/README.md:26`）。

---

## 2. 公开站点（观众与主播都能打开）

### 2.1 站点地图总表

Host 判定与页面路由集中在 `src/app.js:363-444`。管理员控制台内还内建了一份「站点目录」，可直接对照（`public/admin/index.html:88-175`）。

| # | URL 形态 | 给谁看 | 能做什么 | 需要登录 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P1 | `https://lirahub.cn/`、`https://www.lirahub.cn/` | 观众 + 主播 | LIRA 官网首页：品牌、功能介绍、公开工具入口、备案信息、中/EN 语言切换、Cookie 设置 | 否 | `src/app.js:380-385`；`public/site/index.html:1-129` |
| P2 | `https://<subdomain>.lirahub.cn/`、`/song`、`/song/` | 观众（主播也可打开） | **公开歌单页**：看歌单、搜索、筛选、复制点歌命令、随机点歌、看主播头像/直播间状态/跳转链接 | 否 | `src/app.js:438-440`；`public/song/index.html:1-198` |
| P3 | `https://<subdomain>.lirahub.cn/overlay/<token>` | 观众（实际给 OBS 浏览器源） | **弹幕姬画面**：实时弹幕、礼物、开播/下播通知全屏展示 | 否（URL 里的 `<token>` 就是只读凭证） | `src/app.js:429-436`；`docs/protocol/public-overlay-api.md:14-19` |
| P4 | `https://gifts.lirahub.cn/`、`https://lirahub.cn/gifts`、`/gifts/:groupId` | 观众 + 主播 | **礼物特效档案**：查礼物图片、价格、编号、特效、盲盒奖池、盲盒参考概率 | 否 | `src/app.js:310-321`；`public/gifts/index.html:1-151` |
| P5 | `https://games.lirahub.cn/` | 观众 | **小游戏目录**：列出已登记并通过校验的玩法 | 否 | `src/app.js:387-393`；`public/games/index.html:1-65` |
| P6 | `https://<slug>.games.lirahub.cn/` | 观众 | **单个玩法**（见 2.5） | 否 | `src/app.js:395-404`；`public/games/game.html` |
| P7 | `https://api.lirahub.cn/` | 开发者/客户端 | 返回 `{ ok: true, service: "LIRA API", version: "0.6.0" }` | 否 | `src/app.js:373-377` |
| P8 | `/health`（任意 Host） | 运维/探针 | 进程与身份库健康探测 | 否 | `src/app.js:82-107` |
| P9 | `https://admin.lirahub.cn/login` | 主播 + 管理员 | **统一登录页**（一个入口，两种身份） | 否（已登录会跳转） | `src/app.js:324-326`；`public/admin/login.html` |
| P10 | `https://admin.lirahub.cn/password-reset` | 主播 | **忘记密码：用一次性重置码设新密码** | 否（凭重置码） | `src/app.js:327-329`；`public/admin/password-reset.html` |
| P11 | `https://admin.lirahub.cn/admin`、`/admin/*` | 管理员 | 管理控制台（见第 3 节） | **是**（未登录 302 → `/login`；主播访问 403 `ADMIN_PAGE_FORBIDDEN`） | `src/app.js:149-157`、`350-355` |
| P12 | `https://admin.lirahub.cn/manage`、`/manage/` | 主播 | 主播中心（见第 3 节） | **是**（未登录 302 → `/login`；管理员访问 302 → `/admin/streamers`） | `src/app.js:159-165`、`337-349` |
| P13 | `https://admin.lirahub.cn/manage/streamers/<id>/*` | 管理员 | **管理员只读模式**「查看主播数据」 | **是**（`adminAuth`；主播访问 403 `ADMIN_TARGET_PAGE_FORBIDDEN`） | `src/app.js:167-175`、`331-336`；`public/streamer/admin-read-only.html:20-21` |
| P14 | `https://<subdomain>.lirahub.cn/manage` | 旧链接兜底 | 清除旧 Host 的 `lira_streamer` Cookie 并 **302** 到中央 `/login` | 否 | `src/app.js:411-414` |
| P15 | `https://admin.lirahub.cn/admin/login` | 旧链接兜底 | **302** → `/login` | 否 | `src/app.js:330` |

> 管理页面只在 `admin.lirahub.cn` 提供：`/admin`、`/login`、`/password-reset`、`/manage/assets` 全部套 `adminPageHostGuard`，其他 Host 返回 `404 {"error":"NOT_FOUND"}`（`src/app.js:113-125`、`244-255`）。

### 2.2 公开页面 API 清单（无需认证）

`src/routes/public.js` + `src/routes/gifts-public.js`：

| API | 限制 | 说明 | 证据 |
| --- | --- | --- | --- |
| `GET /api/public/streamers/:subdomain/songs` | **60 次/分钟/IP**，超限 `429 TOO_MANY_SONG_REQUESTS` + `Retry-After` | 启用中的歌单快照 + 背景 + 解析后的 `pageTitle`，`no-store` | `src/routes/public.js:33-43`、`169-181`；`docs/protocol/public-song-page-api.md:35-49` |
| `GET /api/public/streamers/:subdomain/profile` | **60 次/分钟/IP**，超限 `429 TOO_MANY_SONG_PROFILE_REQUESTS` | 只返回 `{roomId, owner, pageTitle}` | `src/routes/public.js:44-50`、`191-223`；`docs/protocol/public-song-page-api.md:189-210` |
| `GET /api/public/streamers/:subdomain/appearance` | 无独立限流 | 歌单页外观（背景效果/字体/配色），`no-store` | `src/routes/public.js:183-189`；`docs/protocol/song-page-appearance.md:21-23` |
| `GET /api/public/streamers/:subdomain/background` | — | 歌单页背景图，`Cache-Control: public, max-age=300`；未设置返回 `404 BACKGROUND_NOT_SET` | `src/routes/public.js:225-239` |
| `GET /api/public/streamers/:subdomain/status` | — | 直播状态、人气指标、标题 | `src/routes/public.js:147-167` |
| `GET /api/public/overlay/events?token=` | SSE 长连接 | 弹幕姬事件流（见 2.4） | `src/routes/public.js:74-145` |
| `GET /api/public/gifts` | **120 次/分钟/IP**，超限 `429 TOO_MANY_REQUESTS` | 礼物名称组列表，支持 `catalog`/`q`/`hasEffect`/`multiCode`/`page`/`limit`(≤100)/`sort`/`priceBucket`；ETag + 304 | `src/routes/gifts-public.js:15-21`、`125-135` |
| `GET /api/public/gifts/catalog` | 同上 | 桌面客户端扁平目录，`schemaVersion` 1/2/3，`Cache-Control: public, max-age=300, stale-while-revalidate=1800` | `src/routes/gifts-public.js:137-169` |
| `GET /api/public/gifts/by-code/:giftId` | 同上 | 按 B 站礼物 ID 查名称组 | `src/routes/gifts-public.js:171-183` |
| `GET /api/public/gifts/:groupId` | 同上 | 单个礼物组详情（含盲盒奖池） | `src/routes/gifts-public.js:185-197` |

统一错误：`CATALOG_NOT_READY`/`CATALOG_INVALID` → `503` + `Retry-After: 60`；`GROUP_NOT_FOUND`/`GIFT_NOT_FOUND` → `404`；`INVALID_GIFT_ID`/`INVALID_*` → `400`（`src/routes/gifts-public.js:7-13`）。

**共享入口总额度**：所有 `/api/*` 还先过一层全局限流「每归一化 IP 600 次/60 秒，跨 Host 共用」（`src/app.js:78`；`docs/operations/request-protection.md:46`）。

### 2.3 公开歌单页（P2）——观众能做什么 / 主播能配什么

**观众能做什么**（`public/song/index.html`、`docs/protocol/public-song-page-api.md:51-186`）：
- 搜索：`搜索歌名 / 歌手 / 分类 / 语言 / 标签`（`public/song/index.html:69`）。
- 筛选：首字母（按拼音）、分类（多选，命中任一）、语言（多选）、歌手（多选，带歌手名搜索与「已选 N 位」）、点歌价格（多选，选项可搜索）。`public/song/index.html:81-171`。
- 视图切换：`全部歌曲` / `付费歌单`（仅当存在非空且非「免费」的价格文本时出现）`public/song/index.html:156-159`；`docs/protocol/public-song-page-api.md:65-67`。
- 头部信息：主播头像、直播间状态（未直播/直播中）、标题、`直播间↗` 与 `个人空间↗` 链接（ID 缺失则隐藏）`public/song/index.html:28-43`；`docs/protocol/public-song-page-api.md:224-231`。
- **点歌**：点歌名即复制命令 `点歌 <歌名>`；另有「随机点歌」（从当前筛选结果均匀随机）和「清除筛选」。复制成功提示 `已复制：点歌 歌名`，失败提示 `自动复制失败，请手动复制`，过快提示 `操作太快，请稍后再试`。**不提交任何表单、不写服务器**（`docs/protocol/public-song-page-api.md:108-173`）。
- 价格徽章：只有完整文本命中白名单才显示舰长/提督/总督图标：舰=`舰,舰长,舰长可点,舰长才能点,舰长专属,舰长限定`；提=`提,提督,提督可点,提督才能点,提督专属,提督限定,提督及以上`；总=`总,总督,总督可点,总督才能点,总督专属,总督限定`（`docs/protocol/public-song-page-api.md:89-95`）。

**主播能配什么**（配置入口在 `/manage`，见第 3 节）：

| 可配项 | 生效位置 | 规则 | 证据 |
| --- | --- | --- | --- |
| 页面名称（标题）`titleName` | 浏览器标签 + 页面标题 | 最多 **40 个 Unicode 码点**；空/纯空白=恢复默认；拒绝控制字符、行/段分隔符、双向控制符 | `docs/design/song-page-title-design.md:5-21` |
| 标题取值优先级 | — | 自定义 `titleName` → 配置房间 UP 主非空显示名 → 主播 `display_name` → 子域名，再拼「的歌单」 | `docs/protocol/public-song-page-api.md:212-213` |
| 背景图 | 页面背景 | 上传 JPEG/PNG/WebP/GIF；有大小上限（超限 `413 PAYLOAD_TOO_LARGE`） | `src/routes/public.js:225-239`；`docs/protocol/management-api.md:158`；`src/app.js:451-453` |
| 背景效果 | 模糊与遮罩 | 默认清晰（0px 模糊 + 14% 浅色遮罩）；柔和=18px/60%；自定义可调同一组数值 | `docs/protocol/song-page-appearance.md:47-52` |
| 字体 | 正文 + 标题 | 四款中文字体随仓库发布（`public/song/fonts/`，共约 24 MiB），只能选本站资源，不能提供外部字 URL | `README.md:205`；`docs/protocol/song-page-appearance.md:39-45`、`54-57` |
| 卡片配色 | 卡片底色 + 强调色 | 4 套配色 + 自定义；自定义用 `#RRGGBB` | `docs/protocol/song-page-appearance.md:54-56`；`public/streamer/manage.html:237-238` |
| 重置行为 | — | 「恢复默认样式不会删除上传图片或歌单称呼」 | `README.md:203` |

写接口（需主播登录）：`GET/PUT /api/streamer/song-page/title`、`GET/PUT/DELETE /api/streamer/song-page/background`、`GET/PUT /api/streamer/song-page/appearance`（读写共享 60 次/租户/分钟，超限 `429 TOO_MANY_SONG_APPEARANCE_REQUESTS`；非法值 `400 INVALID_SONG_PAGE_APPEARANCE`）、`GET /api/streamer/song-page/qr`（`docs/protocol/management-api.md:77-80`；`docs/protocol/song-page-appearance.md:12-19`）。

**歌曲本身不可在网页编辑**：只读展示，编辑在已授权桌面客户端完成后自动同步（`README.md:150`；ADR-0027/0030，见 `docs/protocol/management-api.md:100-103`）。

**歌单页二维码（QR）**：主播中心有「网页歌单二维码」区块，含固定尺寸 `<img>`、公开歌单网址、复制/打开/下载动作，以及二维码样式（含 `style=avatar` 头像圆形变体）。二维码在**开户激活成功时**由服务器预生成为 `assets/song-page-qr.svg`（`docs/design/song-page-qr-design.md:5-9`、`15-24`；`docs/protocol/management-api.md:80`）。响应 `image/svg+xml` + `no-store` + `nosniff`。

### 2.4 弹幕姬 overlay（P3）——观众/主播看到什么

- **canonical URL**：`https://<subdomain>.lirahub.cn/overlay/<token>`，**token 是只读访问凭证**，每账号独立生成 12 个加密随机字节 → base64url 的 16 位 `[A-Za-z0-9_-]`，保存在租户数据库；样式更新和重启**不轮换**（`docs/protocol/public-overlay-api.md:14-19`）。
- **旧地址 `/overlay`（无 token）已拒绝**，不重定向也不泄露新地址（`docs/protocol/public-overlay-api.md:34`）。
- **事件类型**（`data.type`）：`overlay-state`、`live-started`、`danmaku`、`gift`、`live-ended`、`overlay-settings`（`docs/protocol/public-overlay-api.md:48-51`）。
- **无回放**：事件没有持久化 id；客户端发 `Last-Event-ID` **不产生补发**；浏览器重连后只先拿到当时的 `overlay-state`（`docs/protocol/public-overlay-api.md:48-54`）。
- **keepalive**：`retry: 3000`，之后每 **15 秒** 一条 `: keep-alive` 注释（`src/routes/public.js:116`、`139-144`）。
- **慢读者保护**：单响应缓冲上限 **256 KiB**、drain 等待 **15 秒**，超限只断开该连接（`docs/protocol/public-overlay-api.md:53`；ADR-0047）。
- **9 套静态样式**：`bubble`、`signal`、`minimal`、`ranked`、`transparent`、`identity`、`outline`、`cream`、`glow`，**默认 `signal`**（`docs/protocol/public-overlay-api.md:112`）。
- **可配项**（`/api/streamer/overlay-settings` 或 Device `/api/device/overlay-settings`）：样式、`styleOptions`（按样式保存的展示参数）、`fullscreenDurationSeconds` **2～30 秒整数，默认 6**、`textColor`（严格 `#RRGGBB`）、`fontFamily`（含本机字体族名，最多 402 字符）、屏蔽规则。非法值 `400 INVALID_OVERLAY_OPTIONS` / `400 INVALID_OVERLAY_DURATION`（`docs/protocol/public-overlay-api.md:104-114`）。
- **图片直连**：礼物图与 B 站图片直接从 `hdslb.com` 及子域加载，**服务器不下载、不缓存、不代理**（`README.md:261`；ADR-0015）。
- **隐私**：所有事件对象都**不含** B 站 UID、Cookie、CSRF、credential 密文、raw packet、`streamerId` 或任何可用于切换租户的字段（`docs/protocol/public-overlay-api.md:85-86`）。

### 2.5 礼物特效档案（P4）——观众/主播能做什么

页面文案原文（`public/gifts/index.html:25-26`）：`礼物特效档案` / `礼物图片、价格、编号与特效预览。`

- 目录类型切换：`金瓜子` / `免费 / 银瓜子`（`public/gifts/index.html:39-58`）。
- 搜索：`搜索名称或礼物编号`（最多 100 字符，超长 `400 QUERY_TOO_LONG`）`public/gifts/index.html:80-91`；`src/routes/gifts-public.js:37-38`。
- 筛选：`只看有特效`（`hasEffect`）；`价格范围`（**单选**，弹窗选择）`public/gifts/index.html:94-122`。
- 分页（`page`/`limit` ≤ 100）与排序（`name`、`codes_desc`、`effects_desc`、`price_asc`、`updated_desc`、`gift_id_desc`）`src/routes/gifts-public.js:43-66`。
- 页面显示北京时间资料版本（如 `2026-09-11 05:29:45`）`README.md:279`。
- **盲盒内容**：礼物详情里有「可开出礼物」内容框（输出项可跳 `/gifts/:groupId`）；非礼物权益用不可跳转卡片展示，并按玩法档位拆分概率（`docs/requirements/system-rules.md:1456-1458`）。
- **盲盒参考概率**：20 个盲盒的参考概率，页面注明来源 `概率参考：用户提供的修仙盲盒概率截图 · 2026-09-16`，并链到 `Bilibili 盲盒信息`（`public/gifts/blind-box-probabilities.js:78-88`、`blind-box-probability-data.js:11-268`）。
- **主播不能自定义这个页面**：它是**全局目录**，由服务器统一同步，与任何主播租户无关（`README.md:252`；`docs/architecture/data-boundaries.md:76`）。

### 2.6 小游戏（P5/P6）——观众能做什么

服务器不保存玩家进度，只做 Host allow-list 与静态文件响应（`README.md:164-166`）。三个玩法（`public/games/game-catalog.json`；管理员站点目录同步列出 `public/admin/index.html:136-153`）：

| slug | 名称 | URL | 一句话 | 证据 |
| --- | --- | --- | --- | --- |
| `fame-road` | **成名之路** | `https://fame-road.games.lirahub.cn/` | 沿五档奖励路线尝试点亮，本机完成无真实价值的概率模拟 | `public/games/game-catalog.json:5-17`；`public/admin/index.html:137-141` |
| `treasure-house` | **玲珑宝斋** | `https://treasure-house.games.lirahub.cn/` | 逐级开启六个容器获取目标材料 | `public/games/game-catalog.json:18-31`；`public/admin/index.html:142-147` |
| `constellation-echo` | **星座回响** | `https://constellation-echo.games.lirahub.cn/` | 依次召唤星座，八槽星盘概率模拟 | `public/games/game-catalog.json:32-45`；`public/admin/index.html:148-153` |

- 进度只存本机 `localStorage` 键 `lira-game-state-v1`，**不上传服务器、不进入 Session/数据库/租户同步、不提供跨设备恢复**（`README.md:164-166`）。
- 页面强制免责声明原文：`本页面为 LIRA 本地概率玩法演示，不是任何直播平台的官方活动，不连接直播间，不扣除真实电池，也不产生、赠送或兑换真实礼物。`（`public/games/index.html:59`）
- 缓存策略：HTML / `game-catalog.json` / loader 用 `no-cache` + ETag；`/games/assets/v1..v14/` 用 `public, max-age=31536000, immutable`（`README.md:173-177`；`src/app.js:238-304`）。

### 2.7 首页与备案信息（P1）

- 首页三大功能文案：`歌单与点歌`（管理曲目、价格与排序，观众通过链接查看歌单）、`弹幕与礼物`（集中查看直播间的弹幕、礼物与醒目留言）、`OBS 画面`（将直播状态与互动信息同步到 OBS 画面）（`public/site/index.html:62-79`）。
- 「公开工具」区，标注 `无需登录`，两个入口：`礼物特效档案` / `小游戏玩法`（`public/site/index.html:86-124`）。
- 页脚备案：`晋ICP备2026012266号`（工信部）与 `晋公网安备14010602111348号`（公安，图片 `public/site/police-registration.png`）（`public/site/index.html:147-155`）。
- Cookie 弹窗原文：`本页没有统计或广告 Cookie。登录只使用必要 Cookie；选择保存在本机。`，按钮 `同意并继续` / `仅必要功能`（`public/site/index.html:158-168`）。
- 中/英文切换按钮 `中` / `EN`（`public/site/index.html:38-41`）。

### 2.8 搜索收录与全局响应头

- 所有经应用的响应都带 `X-Robots-Tag: noindex`（在 HTTPS 网关、API 限流、body 解析和路由**之前**设置），**公开访问和页面内容不变**（`src/app.js:66-68`；`docs/protocol/search-indexing.md:15-20`）。
- 每个响应回显 `x-request-id`（有上游值则沿用，否则生成 uuid）（`src/app.js:62-65`）。
- **不要**再叠加全站 `robots.txt` 的 `Disallow: /`（`docs/protocol/search-indexing.md:29-35`）。

---

## 3. 统一管理控制台 / 主播管理台

### 3.1 一个入口、两种身份、两套权限域

- 生产中央管理 Host：`admin.lirahub.cn`；统一登录页 `/login`（`src/app.js:324-326`；ADR-0005）。
- 两枚 host-only Cookie：`lira_admin`、`lira_streamer`；两套 API 权限域：`/api/admin/*` + `adminAuth`、`/api/streamer/*` + `streamerAuth`。登录成功会清除另一枚 Cookie（`src/app.js:127-139`；`docs/protocol/management-api.md:63-65`）。
- 页面访问规则（实现）：未登录 → `/admin*` 与 `/manage*` 都 302 到 `/login`；主播访问 `/admin*` → `403 ADMIN_PAGE_FORBIDDEN`；管理员访问 `/manage` → 302 `/admin/streamers`；主播访问 `/manage/streamers/:id/*` → `403 ADMIN_TARGET_PAGE_FORBIDDEN`（`src/app.js:141-175`；设计表见 `docs/design/unified-management-console-modification-guide.md:238-242`）。

### 3.2 管理员控制台（`/admin`）

**全局导航只有 5 项**（`public/admin/index.html:28-60`；每项标题与副标题见 `public/admin/app.js:22-28`）：

| 顺序 | 标签 | 副标题原文 | 证据 |
| --- | --- | --- | --- |
| 1 | **概览** | `查看全局指标和需要处理的异常。` | `public/admin/index.html:29-36` |
| 2 | **主播** | `每个主播的连接、业务数据、设备和授权都从这里进入。` | `public/admin/index.html:37-42` |
| 3 | **激活码** | `发放首次注册码，以及用于其他电脑或重装后登录的短效登录码。` | `public/admin/index.html:43-48` |
| 4 | **设备** | `查看与远程控制所有已授权设备。` | `public/admin/index.html:49-54` |
| 5 | **审计日志** | `查看关键管理操作。` | `public/admin/index.html:55-60` |

侧栏 kicker `运营控制台`（`:27`），底部显示 `<用户名> · <角色>` 与 `退出登录`（`:63-64`）。

**客户端路由（`/admin` 是单页壳，所有视图共用一个 HTML）**：`/admin`=概览、`/admin/streamers`、`/admin/activations`、`/admin/devices`、`/admin/audit`；旧路径 `/admin/monitor`、`/admin/gifts` **已退役**，`replace` 重定向到 `/admin/streamers`；未知 `/admin/xxx` 回落到概览（`public/admin/app.js:138-152`）。

**各页面内容**：

| 页面 | 内容与管理员能做的事 | 证据 |
| --- | --- | --- |
| **概览** `/admin` | 指标卡（主播总数 / 直播中 / 连接正常 / 连接异常 / 授权设备 / 未用激活码）；`待处理异常` 可点击列表，空态 `当前没有需要处理的连接异常。`；`站点目录`（基础入口 / 公开工具 / 小游戏 / 主播页面 / 中转服务） | `public/admin/index.html:80-181`；`public/admin/app.js:175-202` |
| **主播** `/admin/streamers` | 表头 `主播管理` + `添加主播`。列：主播 / 直播间 / 24h 连接 / 授权设备 / 最近活动 / 账号 / 操作。行操作 `查看详情`、`更多操作`（`禁用`\|`恢复`、`删除`\|`重试删除`）。待删除时徽章 `清理待重试`。添加对话框字段：`显示名称`(必填)、`独立子域名（可选）`、`直播平台 UID（可选）`、`房间号（可选）` | `public/admin/index.html:183-207`、`323-337`；`public/admin/streamer-list.js:24-26` |
| **主播详情** `/admin/streamers/<id>/<tab>` | 头像 + 名称 + 状态徽章；`设置新密码`（仅 `super_admin`）；**`查看主播数据`** 链接 → `/manage/streamers/<id>/overview`；右上 `删除主播` | `public/admin/detail.js:34-45`；`public/admin/index.html:212-214` |
| **激活码** `/admin/activations` | 标题 `一次性授权码`；目标下拉 `授权码对应主播`：`新主播（首次开户注册）`（value 0）+ `已有主播：<名字> (#<id>)`（仅 active）。提交按钮文案动态：目标为 0 时 `生成注册码`，否则 `生成短效登录码`。生成的完整码**只存页面内存**，卡片带 `复制`，说明 `一次性，生成后 <ttl> 分钟有效；完整码仅保存在本页，撤销、使用或过期后自动移除`。表格列：ID / 类型 / 主播 / 前缀 / 生成来源 / 生成时间 / 状态 / 过期时间 / 使用记录 / 操作；类型标签 `首次注册码`、`设备设置生成`、`短效登录码`、`首次注册镜像`、`旧版设备码`；操作 `撤销码` 或（已使用）`撤销对应设备` | `public/admin/index.html:222-262`；`public/admin/app.js:105-136`、`232-275`；`public/admin/activation-target.js:13-19` |
| **设备** `/admin/devices` | 标题 `授权设备`。列：主播 / 设备 / 系统 / 版本 / 最近在线 / **`IP / 估算属地`** / 状态 / 操作；操作 `撤销`（active）或 `恢复`。属地文案：`暂无连接记录`、`内网或保留地址`、`纯真未返回属地`、`属地查询暂不可用`；来源标注 **`纯真官网`**；精度固定文案 `精度未知（纯真未提供估算半径）` | `public/admin/index.html:264-287`；`public/admin/app.js:292`；`public/admin/detail.js:139-173` |
| **审计日志** `/admin/audit` | 标题 `审计日志`，副标题 **`最近 200 条操作记录 · 每页 50 条`**。列：时间 / 操作人 / 操作内容 / 相关对象 / 来源 IP。分页 `←` / `N / M` / `→`，范围 `第 X-Y 条，共 N 条`；IP 缺失显示 `未记录`。操作名与对象名有中文映射表，未知显示 `其他操作（<action>）` | `public/admin/index.html:289-320`；`public/admin/audit-log.js:1-50`；`src/modules/admin/audit-logs.js:6` |

**主播详情 5 个 tab**（`public/admin/detail.js:1-7`，顺序）：**概览** → **24h 连接** → **礼物** → **设备** → **授权**。页面标题 `主播详情`，路由提示 `/admin/streamers/<id>/<tab>`，返回按钮 `← 返回主播列表`（`detail.js:41-42`、`65`；`index.html:212`）。

| tab | 面板与字段 | 证据 |
| --- | --- | --- |
| **概览** | `基本信息`（主播名称 / 账号 / 公开子域 / 直播平台 UID / 直播间 / 创建时间 / 最后活动；账号未设时显示 `未开户注册`）、`客户端连接`（最近连接 IP / IP 采集来源 `客户端连接记录` / **IP 属地（估算）** / 运营商 / 网络类型 / 估算半径 / 属地来源 / 最近连接设备 / 系统 / 版本 / 最近在线）、`最近礼物`（≤5 行：时间 / 赠送用户 / 礼物 / 数量 / 金额（元））、`连接与直播`、`授权状态`、`最近异常` | `public/admin/detail.js:200-275` |
| **24h 连接** | 面板 `直播账号与直播间`（**两个身份分开显示**：`直播平台登录账号` 与 `直播间主播`，后者含头像 + `UID <n>` + `房间 <n>` + 直播标题）、`24h 连接`（监听状态 / WebSocket / 直播状态 / 最后事件）、可折叠 `技术诊断`（房间接口指标、心跳人气值、最后轮询、连续运行、重连次数）、`连接诊断`、**`最近弹幕`** | `public/admin/detail.js:298-371` |
| **礼物** | 挂载**与主播端共用**的礼物组件，含只读徽章 **`只读查看 · 与主播端一致`**；子导航 `礼物视图`：`礼物流水`（默认）/ `数据分析`（`?view=analysis`）。数据来自 `/api/admin/streamers/:id/gift-events` 与 `/gift-statistics` | `public/admin/gifts.js:28-64` |
| **设备** | 面板 `主播设备`；列：设备 / 状态 / 系统 / 版本 / 最近在线 / 连接 IP / 操作；操作 `撤销设备` / `恢复设备`。空态 `当前主播还没有授权设备。` | `public/admin/detail.js:373-388` |
| **授权** | 面板 `主播授权`，说明 `短效登录码用于已有账号在其他电脑或重装后登录，需原账号密码。一次性，有效期以生成结果为准。`；按钮 `生成短效登录码`、`查看设备`、`暂停主播授权`\|`恢复主播授权`；汇总指标 授权状态 / 当前设备 / 最近验证；表格 前缀 / 类型 / 生成时间 / 状态 / 使用记录 / 操作。类型标签：`首次注册码`、`短效登录码`、`设备设置生成`、`重装登录验证`、`授权码` | `public/admin/detail.js:390-445` |
| **（授权 tab 内）主播密码重置** | **仅 `super_admin` 可见**（UI 与后端双重限制）：`生成密码重置码` 按钮，表格 前缀 / 状态 / 剩余尝试 / 过期时间 / 操作，含复制与 `撤销`。说明原文：`用户忘记密码时，凭原用户名和此码在网页设置新密码。15 分钟内一次有效…`、`仅 super_admin 可生成或撤销；用户名和设备授权保持不变。` | `public/admin/detail.js:447-466`；后端 `src/routes/admin.js:150,166,179,191`；`src/middleware/super-admin.js:1-6` |

**「最近弹幕」在这里**：属于主播详情的 `24h 连接` tab，说明原文 **`仅保留内存中的实时记录，服务器重启后清空。`**，空态 `目前没有弹幕；这里不会写数据库。`，最多 10 条（`public/admin/detail.js:365`）。

**管理员能力矩阵**（设计文档中的窄权限表，`docs/design/unified-management-console-modification-guide.md:412-420`）：

| 能力 | 主播/客户端 | 管理员汇总视图 |
| --- | --- | --- |
| 查看歌单/背景 | 允许 | 允许（target 必须显式存在） |
| 修改歌单/背景 | 允许 | **禁止** |
| 查看服务端 monitor/历史/统计 | 按客户端能力 | 允许（只显示已同步/已采集数据） |
| monitor 开关/轮询 | 按客户端能力 | **禁止** |
| 欢迎弹幕配置 | 按客户端能力 | **禁止** |
| B 站 Cookie/CSRF | 按客户端能力 | **禁止**（最多显示「已配置」状态） |
| 禁用/恢复主播、设备、授权码 | 禁止 | **允许** |

管理员专属端点（`docs/protocol/management-api.md:84-91`）：
`GET /api/admin/streamers/:id/read-model`、`GET /api/admin/devices`、`GET /api/admin/streamers/:id/bilibili-profile`、`DELETE /api/admin/streamers/:id`、`PUT /api/admin/streamers/:id/password`（**需 `super_admin`**）、`POST|GET /api/admin/streamers/:id/password-reset-codes`（**需 `super_admin`**）、`POST /api/admin/streamers/:id/password-reset-codes/:codeId/revoke`（**需 `super_admin`**）。

**管理员只读模式页面**（P13）：eyebrow `LIRA / ADMIN READ MODEL`，标题 `管理员只读模式`（JS 会替换为 `<显示名> · 管理员只读模式`），说明 **`此页面只读取服务器持久化的数据，不代表主播登录。`**，链接 `返回管理中心` → `/admin/streamers`。卡片：`主播概览`、`监控状态`、`历史事件（N）`。只调用 `GET /api/admin/streamers/<id>/read-model`（`public/streamer/admin-read-only.html:19-24`；`admin-read-only.js:25-43`；`docs/design/unified-management-console-phase-4-design.md:16`）。

**⚠️ 任务清单里点到、但实际不存在的区块**（对 `public/admin/` + `public/streamer/` 全量检索）：

| 任务里的说法 | 实际 |
| --- | --- |
| **数据导出** | **0 命中**，控制台没有任何导出功能 |
| **活动 / Activities** | 不是独立分区。`活动` 只出现在列头 `最近活动`（`index.html:197`）与字段 `最后活动`（`detail.js:248`） |
| **总览** | 0 命中，标签是 **`概览`** |
| **B 站资料 / B站** | 0 命中，区块叫 **`直播账号与直播间`**，字段叫 `直播平台登录账号` / `直播间主播` / `直播平台 UID` |
| **IP 归属地** | 作为标题 0 命中，标签是 **`IP / 估算属地`**（`index.html:278`）与 **`IP 属地（估算）`**（`detail.js:253`） |
| **设备授权** | 作为标题 0 命中，标签是导航 **`设备`**、标题 **`授权设备`**、详情 tab **`授权`**（面板 `主播授权`） |
| **礼物查询与统计** | 0 命中，标签是 **`礼物流水`** / **`数据分析`**，筛选面板叫 `查询条件` |
| **歌单（管理员侧）** | **管理员界面没有歌单 UI**。`GET/POST/PATCH/DELETE /api/admin/streamers/:id/songs*` 存在但**无任何前端调用**（`src/routes/admin.js:335-373`） |

### 3.3 主播中心（`/manage`）

**主播能看到的导航只有 4 项**，界面原文（`public/streamer/manage.html:37-53`）：

| 顺序 | 导航项 | 副标题原文 | 路由参数 | 主播能做什么 |
| --- | --- | --- | --- | --- |
| 1 | **礼物流水**（默认） | `收礼记录与明细` | `?page=gift-history` | 查询条件下拉 `统计范围`（`7 天`/`30 天`/`90 天`/`全部`，默认 30 天）、搜索 `搜索礼物或盲盒`、`查找送礼人昵称`、日期预设 `今天`/`昨天`/`本月`/`自定义日期`（含开始/结束日期）；`流水明细` 表：时间 / 礼物 / 送礼人 / 数量 / 价值，`按收礼时间倒序 · 北京时间`；分页 `第 X / Y 页` |
| 2 | **数据分析** | `收礼趋势与价值构成` | `?page=gift-analysis` | `收礼概览`：礼物价值（含提示 **`按礼物标价统计，非主播结算收入。`**）、收礼笔数、礼物件数、**盲盒盈亏**；`收礼趋势`（`按日汇总 · 北京时间`）；`礼物构成`（普通礼物、大航海与盲盒的价值占比）；可下钻当日流水并有 `返回原分析` |
| 3 | **网页歌单** | `歌曲、外观与分享` | `?page=song-page` | 见下表 |
| 4 | **直播弹幕姬** | `弹幕样式与 OBS 地址` | `?page=overlay` | 见下表 |

**旧路由参数仍兼容**：`?page=gifts`→`gift-history`、`insights`→`gift-analysis`、`broadcast`/`library`/`appearance`→`song-page`；旧 hash（`#giftsWorkspace` 等）会转成 `?page=` 并清空 hash；未知 `?page=` 回落到 `gift-history` 并从 URL 移除非法参数（`public/streamer/manage-navigation.js:6-32`）。

**网页歌单区（`?page=song-page`）**，标题 `网页歌单`，副标题 `查看同步歌单、设置页面名称与背景，并分享你的公开歌单。`（`public/streamer/manage.html:82-83`）：

| 子区块 | 内容 | 证据 |
| --- | --- | --- |
| **核对与分享** | `打开歌单`、`复制网址`、只读输入 `公开歌单网址`；`查看与下载二维码` 折叠区，样式单选 **`纯二维码`**（`大尺寸，密集码点`）/ **`圆形头像`**（`使用直播间房主头像`），动作 `下载二维码`、`重试二维码` | `public/streamer/manage.html:88-112` |
| **当前歌单**（只读） | 提示原文 **`歌曲请在本地客户端修改，修改后会自动同步到这里。`**；`刷新`、搜索框 `搜索当前云端歌单`、列 歌名 / 歌手 / 标签 / 状态（状态文字 `显示`/`隐藏`）。空态：`当前搜索无匹配歌曲，试试其他歌名、歌手或标签。` / **`当前没有歌曲，请在本地客户端添加歌曲后同步。`** | `public/streamer/manage.html:123-138`；`manage.js:207-236` |
| **歌单标签页 → 修改名称** | 字段 `歌单称呼`，实时预览 `<名字>的歌单`，动作 `保存名称` / `恢复默认` | `public/streamer/manage.html:147-161`；`manage.js:129` |
| **歌单页背景 → 修改背景** | `选择并替换背景`、`删除背景`；限制文案 **`支持 PNG / JPG / WebP / GIF，最大 5MB`**；删除确认 `删除歌单背景` / `删除后，歌单页会恢复默认水彩背景。` | `public/streamer/manage.html:171-197`；`manage.js:383-389`、`442` |
| **歌单外观 → 背景、字体与配色** | `背景效果`（背景模式 清晰/柔光/自定义，图片位置 居中/靠上/靠下，背景模糊，柔光遮罩）、`文字字体`（正文字体、标题字体）、`卡片颜色`（颜色风格、卡片底色、强调色、卡片不透明度）；动作 `保存外观` / `恢复默认样式` / `打开网页歌单` | `public/streamer/manage.html:210-243`；`manage.js:47-58` |

**直播弹幕姬区（`?page=overlay`）**，标题 `直播弹幕姬`，副标题 `与客户端共用服务器配置；先预览，保存后更新直播画面。`（`public/streamer/manage.html:262-263`）：

- 9 套样式的**中文界面名**（`public/streamer/manage.html:274-296`，服务器接受同一组 9 个，`src/modules/streamer/overlay-settings.js:10-13`）：

  | 内部名 | 界面名 |
  | --- | --- |
  | `signal` | **直播信号带**（默认） |
  | `bubble` | 聊天气泡 |
  | `minimal` | 蝴蝶结 |
  | `ranked` | 经典样式 |
  | `transparent` | 透明简约 |
  | `identity` | 身份横卡 |
  | `outline` | 全屏随机 |
  | `cream` | 奶油气泡 |
  | `glow` | 流光气泡 |

- 条件字段 `全屏随机停留时间（秒）`：**仅** `outline`/`cream`/`glow` 显示，范围 **2–30**（`manage.html:299-302`；`manage.js:188`、`319-320`）。
- 动作 `预览草稿`（打开带 `?preview=1&style=…&fullscreenDurationSeconds=…` 的 overlay 地址）与 `保存样式`。
- 字段 `OBS 浏览器源地址` + `复制地址`。
- 帮助文案原文：`预览不会保存；保存后，已连接的 OBS 浏览器源会更新。浏览器源背景为透明。`（`manage.html:331-333`）

**主播不能做的**（导航栏底部原文，`public/streamer/manage.html:57`）：
> `直播间连接与直播平台账号在桌面客户端中管理。`

结合管理 API 契约，主播中心还明确**不渲染**：歌曲编辑器、settings 配置、B 站凭据配置（`docs/protocol/management-api.md:100-104`）。以下 API **存在但 `/manage` 界面从不调用**：`POST/PATCH/DELETE /api/streamer/songs*`、`PUT /api/streamer/songs/sync`（`src/routes/streamer.js:346-419`）、`GET/PUT /api/streamer/cloud-settings`（`:264-281`）、`bilibili-credentials`/`bilibili-qr-login`（`:283-344`）。设备授权、审计日志、IP 属地、最近弹幕、B 站资料**属于管理员控制台，主播看不到**。

### 3.4 ⚠️ 一个重要发现：管理员的「数据分析」比主播的**更多**

`public/streamer/gift-workspace.js` 是**管理员与主播共用**的组件，但调用方式不同（`basicAnalysis` 开关）：

| 元素 | 主播 `/manage`（`basicAnalysis=true`） | 管理员礼物 tab（`basicAnalysis=false`） |
| --- | --- | --- |
| `查找送礼人昵称` 搜索 | ✅ | ❌ |
| 日期预设 `今天`/`昨天`/`本月` | ✅ | ❌ |
| `自定义日期` + 开始/结束日期 | ✅ | ❌ |
| `返回原分析` / 下钻当日流水 | ✅ | ❌ |
| 趋势指标切换 礼物价值/礼物件数 | ❌ | ✅ |
| `收礼频次与单笔价值`（收礼笔数、平均每笔价值） | ❌ | ✅ |
| 构成趋势图 | ❌ | ✅ |
| `礼物贡献`（按价值排名） | ❌ | ✅ |

证据：`public/streamer/gift-workspace.js:3-194`（`basicAnalysis=true` 在 `:194`）；`public/admin/gifts.js:38`（无 options → `basicAnalysis=false`）。
**写主播文档时必须按主播实际能看到的来写**（左侧列）。产品是否有意如此**需人工确认**。

分页实际值：服务端每页 **100 笔**（`HISTORY_PAGE_SIZE = 100`），前端分批渲染 **20** 行，页脚 `共 N 笔 · 每页 100 笔`（`public/streamer/gift-ledger.js:28-29`、`339`）。

### 3.5 管理员 / 主播权限边界（代码验证）

| 读者 | `/login` | `/password-reset` | `/admin/*` | `/manage` | `/manage/streamers/<id>/*` |
| --- | --- | --- | --- | --- | --- |
| 未登录 | 200 表单 | 200 | 302 `/login` | 302 `/login` | 302 `/login` |
| 管理员 | 302 `/admin` | 200 | **允许** | **302 `/admin/streamers`** | **允许** |
| 主播 | 302 `/manage` | 200 | **403 JSON** | 允许（仅自己租户） | **403 JSON** |

- 主播被拒时返回的是 **裸 JSON**（`403 {"error":"ADMIN_PAGE_FORBIDDEN"}` / `403 {"error":"ADMIN_TARGET_PAGE_FORBIDDEN"}`），**不是 HTML 错误页**（`src/app.js:149-175`）。
- 主播**不能**自己指定租户：租户只来自已验证的 Streamer Session，Host/子域不匹配返回 `403 STREAMER_HOST_MISMATCH`（`src/middleware/streamer-auth.js:6-23`）。
- **管理台设新密码 / 生成密码重置码都只有 `super_admin` 能做**，UI 与后端双重限制（`public/admin/detail.js:448`、`public/admin/streamer-password.js:5-6`；`src/routes/admin.js:150,166,179,191`；`src/middleware/super-admin.js:1-6`）。
- 管理员对接管主播私有数据是**只读**：礼物 tab 上有徽章 **`只读查看 · 与主播端一致`**（`public/admin/gifts.js:51`）；管理员从不获得 `lira_streamer` Cookie，只读页也从不调用 `/api/streamer/*`。

### 3.6 文档与代码冲突（写文档时以代码为准）

| # | 文档说法 | 代码实际 | 影响 |
| --- | --- | --- | --- |
| 1 | `docs/protocol/management-api.md:784`（**normative**）写 `INVALID_OVERLAY_STYLE` 只有 4 个值：`bubble`、`signal`、`minimal`、`ranked` | 服务器实际接受 **9 个**（+ `transparent`、`identity`、`outline`、`cream`、`glow`），界面也提供 9 个（`src/modules/streamer/overlay-settings.js:10-13`；`public/streamer/manage.html:288-296`） | **规范文档过时**，需人工确认由谁修 |
| 2 | `docs/design/unified-management-console-modification-guide.md:381-386`（proposal）说第一版 `/manage` 迁移包含**歌单创建/修改/删除/全量同步** | `/manage` 歌单**只读**，无任何写控件或写请求（`public/streamer/manage.html:123-138`；`manage.js:207-236`）。已被 ADR-0030 取代 | 该 guide 是 2026-08-30 的 proposal，**已过时** |
| 3 | 同上 guide `:147-148` 提议 `/manage/songs` 与 `/manage/streamers/17/songs` | 实际是 `?page=song-page` 与通用的 `/manage/streamers/<id>/…` 只读页；`/manage/songs` 会 404 | 不要照抄 guide 的 URL |
| 4 | `docs/superpowers/plans/2026-08-27-streamer-detail-page.md:81` 与 `2026-09-06-admin-layout-and-ip-location.md:35` 说主播详情有**七个** tab（含 `superchats`、`guards`） | 实际只有 **5 个**（`public/admin/detail.js:1-7`）；SC/大航海已退役，付费大航海并入礼物流水/分析 | 计划文档已过时 |
| 5 | `docs/superpowers/plans/2026-09-06-admin-event-pagination.md:42` 规定 `DETAIL_EVENT_PAGE_SIZE = 50` | 该常量在 `public/` + `src/` 中 **0 命中**；已换成共用礼物账本（每页 100、分批渲染 20）。只有**审计**分页仍是 50 | 计划已作废 |
| 6 | `docs/superpowers/plans/2026-09-13-admin-gift-workspace.md:13` 说「每页 10 行」 | 实际每页 **100 笔**，一次渲染 20 行（`public/streamer/gift-ledger.js:28-29`、`339`） | 计划已过时 |
| 7 | `docs/superpowers/plans/2026-09-08-streamer-console-pages.md:7` 用 `?page=insights\|broadcast\|library\|appearance` | 现行值 `gift-history\|gift-analysis\|song-page\|overlay`；旧值仅作兼容别名（`public/streamer/manage-navigation.js:6-12`） | 写文档用新值 |
| 8 | `docs/design/unified-management-console-modification-guide.md:481` 提议重置页放在 `public/auth/password-reset.*` | 实际在 `public/admin/password-reset.html` + `.js`（`src/app.js:327-329`） | 低 |

### 3.7 统一管理控制台的设计与实施计划文档

- `docs/design/unified-management-console-modification-guide.md`（428 行）：**status: proposal / normative: false**，审阅于 2026-08-30 的 revision `18a047c`（`…modification-guide.md:1-7`）。它给出目标架构（`…:121-143` 的 mermaid）、统一认证四个端点 `POST /api/auth/login`、`GET /api/auth/session`、`POST /api/auth/logout`、`POST /api/auth/password/reset`（`…:190-195`）、页面访问规则表（`…:238-242`）、Admin 能力矩阵（`…:412-420`）、密码策略（`…:299-320`）、密码重置流程（`…:346-355`）、6 个 REQ-CONSOLE 与 11 条 AC-CONSOLE（`…:536-660`）、6 阶段实施顺序（`…:664-734`）。
  > ⚠️ 该文档是**提案**，其中「第一版只迁移歌单/背景能力」（`…:379-388`）已被现实超越——现在 `/manage` 已有 4 个工作区（含礼物流水/数据分析/弹幕姬）。**写主播文档时以 `public/streamer/manage.html` 和 `management-api.md` 为准。**
- `docs/design/unified-management-console-phase-4-design.md`（52 行）：Phase 4 只读汇总视图 + 密码重置码的 EARS 需求、架构、错误契约（`400 PASSWORD_RESET_FIELDS_REQUIRED`、`400 PASSWORD_*`、`401 PASSWORD_RESET_INVALID`、`403 SUPER_ADMIN_REQUIRED`、`404 STREAMER_NOT_FOUND`、`429 TOO_MANY_PASSWORD_RESET_ATTEMPTS`）与验证清单（`…phase-4-design.md:41-52`）。
- `docs/superpowers/plans/2026-08-30-unified-management-console-phase-0.md` … `phase-4.md`：实施计划，**non-normative**（`docs/README.md:24`），仅供历史参考。本盘点未逐条核对其勾选状态——**需人工确认**其中是否有未落地项。
- 相关计划（同在 `docs/superpowers/plans/`，均 non-normative）：`2026-08-30-admin-overview-simplification.md`、`2026-08-30-admin-live-authorization-state.md`、`2026-08-30-admin-remove-streamer-configuration.md`、`2026-09-05-admin-streamer-detail-recovery.md`、`2026-09-06-admin-layout-and-ip-location.md`、`2026-09-06-admin-recent-danmaku.md`、`2026-09-06-admin-bilibili-profile.md`、`2026-09-06-admin-event-pagination.md`、`2026-09-06-audit-log-pagination.md`、`2026-09-05-admin-streamer-password.md`、`2026-09-05-streamer-removal.md`、`2026-09-08-streamer-console-pages.md`、`2026-09-08-streamer-console-workspace-redesign.md`、`2026-09-13-admin-gift-workspace.md`、`2026-09-10-gift-workspace-views.md`、`2026-09-13-admin-retired-event-tabs.md`、`2026-09-13-login-design.md`、`2026-09-13-site-registration-footer.md`。

---

## 4. 设备授权与账号体系

### 4.1 三种码的分工（记住这句话就够了）

| 码 | 谁生成 | 在哪里生成 | 默认有效期 | 一次性？ | 用途 |
| --- | --- | --- | --- | --- | --- |
| **新主播开户注册码**（首次开户） | **管理员**（任意 admin 都能发） | 管理台「激活码」页，目标选 `新主播（首次开户注册）` | **60 分钟** | **是** | 主播第一次开户：一次事务完成建号 + 建 License + 绑设备 |
| **已有主播短效登录码**（加第二台电脑 / 重装恢复） | **管理员**（任意 admin 都能发） | 管理台「激活码」页，目标选 `已有主播：<名字> (#<id>)` | **60 分钟** | **是** | 让同一主播的第二台/第三台电脑加入同一账号 |
| **密码重置码** | **仅 `super_admin`** | 管理台主播详情 → `授权` tab → `生成密码重置码` | **15 分钟** | **是**（最多 5 次尝试） | 主播忘记密码时设新密码 |

- ⚠️ **发码不需要 `super_admin`**：`src/routes/admin.js:392-403` 只挂 `adminAuth`，没有 `superAdmin` 中间件。`super_admin` 只用于「设置新密码」（`admin.js:148-150`）和「密码重置码」（`admin.js:166,179,191`）——**需人工确认**线上是否只有一个超级管理员、是否符合预期。
- **关键：设备自己不能发码了。** `POST /api/device/pairing-codes` 对有效设备固定返回 `403 {"error":"PAIRING_CODE_ADMIN_ONLY"}`，代码注释原文：`Retain an explicit rejection for older clients; only Admin can issue codes.`（`src/routes/device.js:244-247`；`docs/protocol/pairing.md:25`；`README.md:130-132`）。历史 `device_pairing` 码或带 `created_by_device_id` 的 unused 码也**不能**再消费（`src/modules/device/activation.js:86-91`、`257-259`）。

> ⚠️ **文档与代码冲突**：`docs/guides/client-onboarding.md:37-39` 仍写「已授权设备可以创建短效 pairing code」——**这是过时的**（该文件 `last_verified: 2026-08-29`，早于 0.6.2 的收紧）。写主播文档时必须写「找管理员要码」。

### 4.2 码的格式、存储与交付

- **格式**：**16 位**，字母表去掉易混字符 `I`/`O`/`0`/`1`，显示为 **4-4-4-4** 分组；校验时 trim + 转大写 + 去掉分隔符号（`src/lib/crypto.js:12-26`）。
- **存储**：数据库**只保存** 带 pepper（`ACTIVATION_CODE_PEPPER`）的 HMAC 摘要 + 4 位 prefix（`src/lib/crypto.js:4-10`、`28-30`；`docs/protocol/device-authentication-v2.md:125`）。重置码格式为 **`LIRA-RESET-<24>`**，用独立 `PASSWORD_RESET_PEPPER` 的 HMAC（`src/modules/auth/password-reset.js:20-25`、`107-130`）。
- **交付靠人工**：明文只在创建响应里出现一次；服务器**没有邮件/短信通道**（`package.json` 无相关依赖）→ **必须管理员手工转发给主播**。管理台生成的完整码只存在页面内存，卡片提示 `完整码仅保存在本页，撤销、使用或过期后自动移除`（`public/admin/app.js:105-136`）；刷新页面明文即丢失（需重新生成）。
- **有效期与钳制**（实测全表）：

  | 项目 | 默认 | 钳制 | env / 位置 |
  | --- | --- | --- | --- |
  | 激活码 / 登录码 TTL | **60 分钟** | **5–1440**，保留有限小数，非数字回落 60 | `ACTIVATION_CODE_TTL_MINUTES`（`src/config.js:84-91`） |
  | Device JWT | **10 分钟** | 无 | `DEVICE_TOKEN_TTL`（`src/config.js:83`） |
  | challenge | **2 分钟** | **硬编码，不可配** | `src/modules/device/challenge.js:28` |
  | 密码重置码 | **15 分钟** | **硬编码** | `src/modules/auth/password-reset.js:10`、`85`、`128` |
  | 密码重置尝试次数 | **5 次** | 失败递减，归零作废 | `password-reset.js:9`、`174-187` |
  | fingerprint 最少匹配项 | 2 | 1–3 | `DEVICE_MIN_FALLBACK_FINGERPRINT_MATCHES`（`src/config.js:100-106`） |
  | 网页控制台 Cookie | **12 小时** | `ADMIN_TOKEN_TTL` / `STREAMER_TOKEN_TTL` | `src/routes/admin-auth.js:37`；`src/routes/auth.js:23` |

  响应里的 `ttlMinutes` / `expiresAt` 反映实际值，**客户端不得假定恒为 60**（`docs/protocol/pairing.md:21`；`src/modules/admin/activation-codes.js:80`、`115`、`158`）。
  > ⚠️ `docs/operations/deployment-runtime.md` 全文**未提** `ACTIVATION_CODE_TTL_MINUTES`，生产实际取值**需人工确认**。

- **相关限流与错误码**：

  | 操作 | 限流 | 错误码 |
  | --- | --- | --- |
  | 激活 | 20 次 / 10 分钟 / IP | `429 TOO_MANY_ACTIVATION_ATTEMPTS`（`src/routes/device.js:33-39`） |
  | challenge / verify | 60 次 / 分钟 | `429 TOO_MANY_CHALLENGE_ATTEMPTS`（`src/routes/device.js:41-47`） |
  | 密码重置 | 10 次 / 15 分钟 / IP | `429 TOO_MANY_PASSWORD_RESET_ATTEMPTS`（`src/middleware/password-reset-limit.js:3-9`） |
  | Admin 改密 | 10 次 / 15 分钟 / 管理员 ID | —（`src/routes/admin.js:31-38`） |
  | 激活码消费失败 | — | 未知 → `404 ACTIVATION_CODE_INVALID`；历史设备自签码 → `403 PAIRING_CODE_ADMIN_ONLY`；签名错 → `401 ACTIVATION_PROOF_INVALID`；已用/已撤 → `409 ACTIVATION_CODE_NOT_USABLE`；过期 → `410 ACTIVATION_CODE_EXPIRED`（`src/modules/device/activation.js:83-194`） |

  > **注意判定顺序**：**签名检查早于状态检查**（`activation.js:154` 在 `:163-194` 之前）。

### 4.3 消费规则与首次开户做了什么

- 消费激活码**必须同时提交**：① 原账号名 + 密码；② 设备自己生成的公钥；③ 设备自己的 fingerprint / build / integrity / activation signature。**任何一项失败都在消费前终止，码保持 `unused`，可在原有效期内重试**（`docs/protocol/pairing.md:45`；`activation.js:106-160`）。
- 首次开户在**一个事务内**完成：建 streamer（`account_key` = `login_name` = `subdomain` = 账号名，bcrypt cost 12，`auth_epoch=1`）→ 分配租户目录 → 生成网页歌单二维码 SVG → 建 License（永久）+ device + fingerprint → 码置 `used` → 审计 `streamer.onboard`（`activation.js:219-228`、`241-350`、`352-365`、`411-443`、`445-460`、`462-492`）。
- 激活成功响应 **201**，含 `licenseId`、`deviceId`、`streamerId`、`streamer{songPageUrl, manageUrl}`，**不含 `accessToken`，也不含二维码字段**（`activation.js:542-559`）。**激活后仍必须在线 challenge/verify 才能拿到 token**（`docs/protocol/device-authentication-v2.md:16`、`137`）。

### 4.4 撤销规则（含一个容易踩的坑）

- **撤销未使用/已使用的码**：`POST /api/admin/activation-codes/:kind/:id/revoke`（`kind` = `onboarding` | `assigned`）。unused → `revoked`；**已使用的码被撤销时会连带撤销绑定到该码的设备**（`src/modules/admin/activation-codes.js:189-195`；`src/lib/activation-codes.js:56-86`：`status=revoked`、`auth_epoch+1`、活动 session 全撤）。错误：`400 INVALID_ACTIVATION_KIND`、`404 ACTIVATION_NOT_FOUND`。
- **撤销码不会删除账号与数据**（该流程没有任何 `UPDATE streamers`）。
- **设备撤销**：`POST /api/admin/devices/:id/revoke` 只改该设备行与其活动 session，**其他设备不受影响、无需重新激活**（`src/modules/admin/devices.js:82-105`）。设备侧表现 `403 DEVICE_REVOKED`，或 epoch 变化 `401 DEVICE_AUTH_EPOCH_CHANGED`。
- **恢复设备**：`POST /api/admin/devices/:id/restore`（`devices.js:107-130`，`auth_epoch+1`）；同机凭原密钥/fingerprint 重新 verify 即可。
- **踢下线**：`POST /api/admin/devices/:id/kick-sessions` 返回 `{ok:true,kicked:n}`，**但管理台前端没有按钮**（只存在于 API）——**需人工确认**是否有意为之。
- **License 没有单独撤销接口**：`licenses.status='revoked'` 只在**删除主播**时批量发生（`src/modules/admin/streamer-removal.js:56-60`，全库唯一）。
- **暂停主播** → 设备侧 `403 STREAMER_DISABLED`；**删除主播**才会清数据（`streamer-removal.js:42-70`、`:84` `removeStreamerData`）。
- 撤销 / 恢复 / 踢下线**都不动数据**：`data_dir` 是 streamer 级共享的（`src/db.js:38`、`267`）。

### 4.5 多设备如何处理

- **台数无上限**：服务端没有任何计数检查。文档原文 `台数和同时使用不受限制`（`docs/protocol/pairing.md:14`）；契约 `no device-count or account-wide concurrent-session limit`（`docs/protocol/device-api.openapi.json:2672`）；验收「四台不同已批准电脑可同时通过 DeviceBearer」（`docs/requirements/acceptance-criteria.md:703`）。
- **每台电脑独立**：`deviceId`、`licenseId`（新设备新建一条 licenses）、密钥对/公钥、fingerprint、`device_sessions` / `authEpoch`。
- **同一主播共享**：`streamerId`（**只从码解析，不接受客户端指定**）、账号密码、`data_dir`（默认 `<streamerId>-<subdomain>`）、子域名/公开歌单地址、歌库、直播凭据、云端设置。
- 关系示意（`docs/protocol/pairing.md:57-62`）：
  ```text
  Streamer mlbb
    ├─ Device A ─ License A ─ Session A
    └─ Device B ─ License B ─ Session B
         └─ pairing code 只负责建立上面的 Streamer 归属
  ```
- **同一台电脑开两个进程会互相顶**（后者把前者 Session 置 `superseded`）；**不同设备之间不互相顶**（`src/modules/device/session.js:184-199`）。
- **同机重装恢复**：删除 data 后重装仍需**管理员新登录码 + 原账号密码**。fingerprint 同租户唯一匹配（同 version、≥2 项 hash 相同、无可比较冲突）时**复用原 `deviceId` / `licenseId` / 首次授权来源 / 注册时间**，更新公钥、`auth_epoch+1`、撤销旧 session、旧 challenge 标记已用；**不会多出一台设备**。多个历史匹配返回 `409 DEVICE_IDENTITY_AMBIGUOUS`（`src/modules/device/fingerprint.js:5-25`；`activation.js:369-410`；`docs/protocol/pairing.md:47-53`）。

### 4.6 客户端界面原文（写主播文档可直接用）

以下文案来自桌面客户端仓库（`D:\Work\Live`，当前工作树 v5.0.3），**不是服务器仓库**，但这是主播真正看到的字：

| 场景 | 界面原文 | 位置 |
| --- | --- | --- |
| 加设备页标题 / 副标题 | `登录 LIRA` / `重装或使用新电脑，请向管理员获取短效登录码` | `public/js/license.js:151-153` |
| 帮助文案 | `由管理员下发，仅限本账号使用一次；同机重装保留原授权记录` | `public/js/license.js:165` |
| 设备被撤销 | `当前设备授权已被管理员撤销。` / `请联系管理员下发新的短效登录码。` | `public/js/license.js:78`、`86` |
| 会话被终止 | `当前设备会话已被管理员终止。` / `…已被替换…` | `public/js/license.js:90-93` |
| 同机双开 | `当前设备已由另一个 LIRA 进程登录…` | `public/js/license.js:91-92` |
| 阻断态 | `本机保留的旧设备授权已撤销，请获取新的短效登录码后重新登录。` | `public/js/license.js:221-226` |
| 重置成功 | `密码已重置，正在返回登录页…` | `public/admin/password-reset.js:53` |
| 管理台重置码说明 | `用户忘记密码时，凭原用户名和此码在网页设置新密码。15 分钟内一次有效；重新生成会使旧重置码失效。` / `仅 super_admin 可生成或撤销；用户名和设备授权保持不变。` | `public/admin/detail.js:465` |

### 4.7 面向主播（电脑小白）的操作步骤

#### A. 第一次开户（全新主播）

| 步骤 | 谁做 | 做什么（含界面原文） |
| --- | --- | --- |
| 1 | **主播** | 联系平台管理员，说明要开播账号 |
| 2 | **管理员** | 登录 `https://admin.lirahub.cn` → 左侧 **`激活码`** → 目标下拉选 **`新主播（首次开户注册）`** → 点 **`生成注册码`**（此时说明文案：`用于首次创建账号并授权第一台电脑。一次性，有效期以生成结果为准。`） |
| 3 | **管理员** | 点 **`复制`**，把 16 位码通过可信渠道发给主播。**服务器不会自动发短信/邮件**；刷新页面明文就没了 |
| 4 | **主播** | 安装并打开 LIRA → 点 **`注册新账号`** → 填 **用户名 / 密码 / 注册激活码** → 点 **`注册并进入`** |
| 5 | （界面） | 显示 `正在为你准备直播工具`（等待服务器建号） |
| 6 | （服务器自动） | 一次性完成：消耗激活码 → 建账号 → bcrypt 存密码 → 建永久 License → 绑设备公钥+硬件指纹 → 建主播私有目录与数据库 → 生成歌单二维码 → 建立 `<用户名>.lirahub.cn` 数据映射 |
| 7 | **主播** | 以后启动**不再输入激活码**；客户端自动完成 challenge/verify → 10 分钟短期 Device Token → 进入 LIRA |

- **用户名规则**（`README.md:68-73`）：2–32 字符；自动转小写；仅允许 `a-z`、`0-9`、`-`；必须以字母或数字开头/结尾；不能用 `admin`、`api`、`www`、`auth` 等保留名；全局唯一。**不支持中文**。
- **密码规则**（`README.md:75`）：8–64 个 Unicode 码点；至少涵盖大写字母、小写字母、其他文字、数字、标点/符号中的**三类**；不允许控制/格式字符；不超过 bcrypt 的 72 字节有效输入；拒绝常见弱密码及账号派生弱密码。实现见 `src/lib/password-policy.js`。
- 开完户白得两个地址（`README.md:59-60`）：
  - 公开歌单：`https://<用户名>.lirahub.cn/`
  - 主播网页管理：`https://admin.lirahub.cn/manage`

#### B. 加第二台电脑（笔记本/备用机）

| 步骤 | 谁做 | 做什么 |
| --- | --- | --- |
| 1 | **主播** | 告诉管理员「我要给 `<账号名>` 加一台电脑」 |
| 2 | **管理员** | 管理台 → 目标下拉切到 **`已有主播：<名字> (#<id>)`** → 点 **`生成短效登录码`** |
| 3 | **管理员** | 复制并发给主播（只显示一次） |
| 4 | **主播** | 新电脑装 LIRA → 点 **`登录已有账号`** → 填 **原用户名 + 原密码 + 短效登录码** → 点 **`登录并进入`**。**设备名不用填**，自动取电脑主机名 |
| 5 | （自动） | 新电脑自己生成新密钥和硬件指纹；服务器创建新的 `device_id` / `license_id`；仍绑定原 `streamer_id` |
| 6 | — | 两台电脑可**同时使用**；共享同一套主播数据目录和歌单地址 |

**会自动同步的 / 需要重设的**（客户端用户手册原文，`public/pages/admin/toolbox/usage-guide.html:498-500`）：
> `会自动同步：歌库、直播账号登录状态、直播间号、点歌规则和自定义盲盒设置…需要重新设置：音乐平台登录、点歌和播放队列、界面和直播画面样式。本地文件、日历、备忘和待办也分别保存在各台电脑上。`

**必须写进主播文档的警告**：`注意：不要直接复制旧电脑的数据文件夹`（同上）；服务端文档也说 `不要复制 A 的私钥或 userData 给 B`（`README.md:128`）。

#### C. 忘记密码

| 步骤 | 谁做 | 做什么 |
| --- | --- | --- |
| 1 | **主播** | 联系管理员说明忘记密码 |
| 2 | **管理员（必须是 `super_admin`）** | 管理台 → 主播详情 → `授权` tab → 点 **`生成密码重置码`**（15 分钟、一次性、最多 5 次尝试） |
| 3 | **管理员** | 把重置码交给主播。**别人看不到旧密码，也看不到新密码** |
| 4 | **主播** | 打开 `https://admin.lirahub.cn/password-reset`（或登录页点 `使用重置码`）→ 填 **账号 / 重置码 / 新密码 / 确认密码** → 点 **`确认重置`** |
| 5 | （界面） | `密码已重置，正在返回登录页…` |
| 6 | （自动） | 写入新 bcrypt hash、`auth_epoch+1`：**旧网页登录全部失效**；**已授权的电脑不用重新激活** |

证据：`README.md:150`；`src/modules/auth/password-reset.js:228-257`；`src/modules/admin/streamer-password.js:34-89`；ADR-0017。

#### D. 电脑丢了 / 被偷了

| 步骤 | 谁做 | 做什么 |
| --- | --- | --- |
| 1 | **主播** | 立刻联系管理员，说明是哪台设备（设备名 / 最近在线 / IP 属地可以帮助定位） |
| 2 | **管理员** | 管理台 → **`设备`** → 找到那台 → 点 **`撤销`**（其他电脑不受影响，数据不丢） |
| 3 | **管理员（建议同时做）** | 如担心对方用密码登录网页管理页，**再重设一次密码**——注意：**只改密码不会踢设备**，设备撤销必须单独做 |
| 4 | **管理员（如找回）** | 点 **`恢复`**，主播重开 LIRA 即可 |
| 5 | **主播** | 不要删登录文件、不要拷数据目录。换新电脑走上面 B 的流程 |

⚠️ **没有远程数据擦除能力**：被盗电脑上的本地文件仍在（`D:\Work\Live` 客户端本地数据）。是否接受这个边界**需人工确认**。

---

## 5. 客户端与服务器的关系

### 5.1 客户端同步给服务器的数据（上行）

| scope / 数据 | 端点 | 语义与规则 |
| --- | --- | --- |
| **songs**（云歌单） | `PUT /api/device/songs/sync` | **完整快照覆盖**，单次最多 **5000 首**；清空就发 `[]`；同一事务推进 song revision。建议只在用户点「同步到云端歌单」时调用，不要每敲一个字就上传。DTO 超过 **8 MiB** → `413 PAYLOAD_TOO_LARGE` |
| **settings**（云设置） | `PUT /api/device/cloud-settings` | **必须提交完整 scope**（缺 key → `INVALID_SYNC_SETTINGS`）。固定键：`roomId`、`enableBilibili`、`paused`、`queueLimit`、`userCooldownSeconds`、`onlyFromLibrary`、`allowDuplicate`；可选：`giftBlindBoxConfig`、`giftBlindBoxCustomConfigV2`、`giftEffectDanmakuEnabled`、`giftAutoThanksEnabled`、`giftStatsQueryEnabled`。成功后发布 `settings` revision；room/enable 变化时重同步该租户 RoomMonitor |
| **bilibili**（B 站登录态） | `PUT /api/device/bilibili-credentials`（body 仅 `cookie`）、`DELETE` | AES-GCM 密文存储；**Device 端点是唯一能把凭据交给客户端的接口，且只允许 main process**。保存成功才（重）启动该租户监听 |
| 弹幕姬样式/停留/参数 | `PUT /api/device/overlay-settings` | 与主播网页共用同一租户记录；**不属于三个 sync scope、不推进 revision**；保存后向在线 OBS 发布 `overlay-settings` |
| 弹幕屏蔽规则 | `PUT /api/device/overlay-filters` | 只抑制 overlay 的普通 `danmaku` 分发；规则和 UID 不进入公开事件 |
| 欢迎开关 + 欢迎词库 | `PUT /api/device/welcome-settings`、`PUT /api/device/welcome-settings/v2` | 词库落在租户库，与开关同一事务，**不在 sync revision 内** —— 这是「客户端离线也能自动欢迎」的前提 |
| PK 播报设置 | `PUT /api/device/pk-report-settings` | 租户设置 |
| daily bots 开关/导入 | `PUT /api/device/daily-bot-settings/:kind` 等 | 独立 DeviceBearer 开关，不进通用 sync scope；客户端无本地回退 |
| 歌单背景图 | `PUT/DELETE /api/device/song-page/background` | 二进制；候选文件 + DB 原子提交 |
| 心跳 | `POST /api/device/heartbeat` | 只更新 `last_seen_at` 与 IP（IP 变化记 `ip_changed`）；**不延长 JWT TTL** |
| 礼物账本清空（**唯一账本写操作**） | `POST /api/device/gift-history/clear` | 必须恰好 `{confirm:true}`；停 monitor → 一个 immediate transaction 删 `gift_events`（outbox 级联）→ 重置序列 → 轮换 `syncEpoch` → 关该租户 gift SSE → 恢复 monitor；**每分钟最多 5 次** |

证据：`README.md:142-148`；`docs/protocol/client-server-api.md:143-193`；`src/routes/device.js:518-689`；`src/routes/device-daily-bots.js:28-41`；`src/app.js:181`。

**「歌曲编辑是 client-only」但写端点仍然存在**：Device API **没有**单曲增删改，只有整库 `PUT /api/device/songs/sync`；Streamer 兼容写入口保留（`PUT /api/streamer/songs/sync`、`POST /api/streamer/songs`、`PATCH/DELETE /api/streamer/songs/:songId`，`src/routes/streamer.js:346-419`），Admin 亦然（`src/routes/admin.js:342-369`），都会推进 revision 并发通知，但 **`/manage` 不再调用**（ADR-0027、ADR-0030；`docs/protocol/management-api.md:74-76`、`100-104`）。

**禁止 / 不可能**：payload 里的 `streamerId` **不作授权依据**，租户只来自 DeviceBearer（`docs/protocol/client-server-api.md:135`、`141`）；客户端不能上传或修改单条礼物账本、不能改弹幕历史；不能自造 overlay 地址密钥（`docs/protocol/public-overlay-api.md:129-131`）。

### 5.2 服务器同步给客户端的数据（下行）

- **配置失效通知（cloud-state SSE）**：`GET /api/device/cloud-state/events`（DeviceBearer），事件名 **`cloud-state-changed`**，data 只含 `{scopes:{settings?,songs?,bilibili?}}` 形式的**非负 revision**；**不传**完整状态、歌库、Cookie、CSRF、token、密文或授权身份。settings / songs / Bilibili 三个 scope 成功提交新 revision 后发布；**没有订阅者时事件立即丢弃，不写数据库、不建立设备队列**（ADR-0007 决策 1-2，`docs/architecture/decisions/0007-sse-cloud-state-invalidation.md:22-23`；实现 `src/modules/streamer/cloud-state-events.js:28-49`）。
- **礼物事件（双通道）**：
  - 实时：`GET /api/device/gift-events/stream`，SSE 发 `event: gift-event`；握手头 `X-Lira-Gift-Sync-Epoch`，客户端声明 `X-Lira-Gift-Effects: 1` 时同连接追加 `gift-effect` 帧。**每个 Device 最多保留一条礼物 SSE，新连接关闭旧连接**；服务端**每 5 秒**复核授权状态，撤销/顶号/epoch 变化即关闭（ADR-0009 决策 3；`src/routes/device.js:549-580`；`src/modules/bilibili/gift-event-broker.js:65-78`）。
  - 恢复：`GET /api/device/gift-events`（cursor + `syncEpoch` 增量，单页最多 **200**，`limit` 默认 100）与 `GET /api/device/gift-history`（完整投影 bootstrap）。响应固定含 `historyBootstrapVersion:1`、`syncEpoch`、`earliestCursor`、`latestCursor`。**final 与 `gift_event_deliveries` cursor 在同一 SQLite 事务提交**，所以即使 SSE 发布前进程崩溃也能由 cursor pull 恢复；**progress 不补拉**（ADR-0009 决策 2-3）。
  - 世代失效错误码：`SYNC_EPOCH_MISMATCH`、`CURSOR_AHEAD`、`CURSOR_TOO_OLD`、`REBUILD_REQUIRED`、`INVALID_GIFT_CURSOR`。客户端必须**原子替换**来源投影与同步状态，再从 `gift-history` 第一页重建，**不得只改 cursor 或建立 latest baseline**（`docs/protocol/client-server-api.md:177-189`；`docs/operations/bilibili-monitoring-and-reconnect.md:111`）。
  - keepalive：Device gift SSE **每 25 秒**发无数据 comment；在 token 到期前或 **5 分钟**生命周期上限时关闭（`src/lib/device-sse.js:4-6`、`73-89`）。
- **服务器权威、客户端幂等**：Electron 停止本地 raw gift detector，收到 progress/final 后以 **public event ID** 做幂等投影，重复 pull/SSE 不重复统计、结算、历史、快照或 frame（ADR-0009 决策 5）。
- **10 分钟兜底**：SSE 只是「有新变化」的提醒，**正确性不依赖它**。Electron 在启动授权、系统 resume 和 SSE 重连成功后主动对账；另有**每 10 分钟**一次轻量 cloud-state 读取兜底（ADR-0007 决策 4，`…0007…md:25`）。
- **旧的「人工手动同步」模型已废弃**：ADR-0004 的「本地歌库为主、用户手动全量上传云端展示快照」被 ADR-0006 取代（`docs/architecture/decisions/0006-cloud-authoritative-streamer-sync.md:7`、`32`），但 `PUT /api/device/songs/sync` 的**整库覆盖语义**保留。

### 5.3 主播离线时，服务器还继续收弹幕/礼物吗？

**会。这是本架构的核心设计。**

- **连 B 站的是服务器，不是你的电脑。** `MonitorManager` 为「Streamer active + `monitor_settings.enabled` + 有 roomId + 该租户已保存登录凭据」的租户创建一个 `RoomMonitor`（`src/modules/bilibili/monitor-manager.js:57-67`），进程启动即 `startAll()`（`monitor-manager.js:45-56`，调用点 `src/server-lifecycle.js:34`）。启动条件里**没有任何 Device / SSE / 心跳依赖**，所以关掉 Electron 不影响。
- 云端 `RoomMonitor` **只依赖**云端 `roomId`、`enableBilibili` 开关和 Streamer active 状态；**Electron 本地监听关闭不停止云端监听**（ADR-0006 决策 5，`…0006…md:26`）。
- **全天候，含未开播**：`liveStatus=1` 与 `=0` 两个分支都会 `_connect()`，即**未开播仍建立并维持已认证 WebSocket**（`src/modules/bilibili/room-monitor.js:463`、`481`；ADR-0060:22-25）。`liveStatus=0` 可与 `state=running` 并存（ADR-0060:53-55）。文档原文：`RoomMonitor 的已认证上游连接全天运行，未开播时也接收礼物和进房事件`（`docs/protocol/public-overlay-api.md:63`）。
- 关闭 Electron 只停本地 listener，**不会向服务端发送 monitor stop**（`docs/operations/bilibili-monitoring-and-reconnect.md:97`）。
- **未开播收到的礼物也按既有规则记账及结算**，不截断 final/outbox，不重置累计（`docs/operations/bilibili-monitoring-and-reconnect.md:53`）。
- **服务器还会主动发弹幕**：进房事件 → `WelcomeService` → 共享发送器**由服务器向 B 站发送欢迎弹幕**；礼物答谢与弹幕礼物查询同样由服务器执行（`src/modules/danmaku/welcome-service.js:79-98`、`105-135`；`src/modules/danmaku/send-runtime.js:1-13`）。这是「电脑关了也能自动欢迎/答谢」的前提。
- 其他仍在跑：Super Chat 落库（`src/modules/history/event-store.js:22-44`）、viewer sample 落库（`event-store.js:46-77`）。
- **弹幕本身不存档**：服务器只把收到的弹幕实时 best-effort 转发给在线 overlay 订阅者，**不写 `danmaku_events`、不落库、不回放**（`src/modules/danmaku/overlay-events.js:28-41`；ADR-0008:27）。进程内只有最近 10 条的内存缓冲（`src/modules/danmaku/runtime.js:1-16`）。
- 主播历史与统计只读 ledger，不调用 detector/outbox/SSE broker（`docs/operations/bilibili-monitoring-and-reconnect.md:115`）。
- **停止条件只有服务端动作**：登录被移除、monitor 关闭、账号被禁用、换房/换凭据、进程关闭（ADR-0060:40-44；`monitor-manager.js:113-131`）。
- **明确不保证**（`docs/operations/bilibili-monitoring-and-reconnect.md:131-132`、ADR-0009 决策 6、ADR-0009:29）：
  - OBS/SSE 断线期间的离线队列或重新订阅后的**弹幕回放** —— 不做；
  - 配置变更、Streamer disable、monitor resync 或进程关闭触发 `stop()` 时**不合成 `live-ended`**（该事件只表示成功确认的 `liveStatus: 1→0`）；
  - B 站上游断线或服务端停机前**未 ingress 的事件仍不承诺零丢失或历史补偿**；
  - 重启**不复用** `liveSessionId`。

### 5.4 SSE / 心跳行为一览（逐字数值）

| 通道 | 端点 | 鉴权 | keepalive / 上限 | 断线语义 |
| --- | --- | --- | --- | --- |
| 公开弹幕 overlay | `GET /api/public/overlay/events?token=` | Host + token（URL 里的 16 位 token 就是只读凭证） | `retry: 3000`；**每 15 秒** 一条 `: keep-alive` 注释；单响应 **256 KiB / 15 秒 drain** | **无 `Last-Event-ID` 补发**；重连只先拿当前 `overlay-state` |
| cloud-state 失效 | `GET /api/device/cloud-state/events` | DeviceBearer | comment keepalive；token 到期前或连接生命周期上限时结束 | 断开按 **1–60 秒有界退避**重连；重连成功后主动对账 |
| Device 礼物流 | `GET /api/device/gift-events/stream` | DeviceBearer | **每 25 秒** comment；token 到期或 **5 分钟**上限关闭；每 Device 仅 1 条 | 重连后**必须**执行 cursor catch-up |
| 心跳 | `POST /api/device/heartbeat` | DeviceBearer | — | 更新 Device 与当前 Session 的 `last_seen_at` 和 IP（IP 变化记 `ip_changed`），返回 `serverTime`；**不创建 B 站连接、不延长 JWT 过期、不代表 WS 在线** |

**实现常量（逐字）**：
- `src/lib/device-sse.js`：`KEEPALIVE_MS = 25_000`（`:4`）、`SESSION_RECHECK_MS = 5_000`（`:5`）、`MAX_CONNECTION_MS = 5 * 60_000`（`:6`）；握手写 `retry: 1000\n\n: connected\n\n`（`:73`）；连接寿命 = `min(5 分钟, max(1000, token 到期时刻 - now))`（`:82-89`）；响应头 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`（`:52-57`）。
- `src/lib/sse-writer.js`：`MAX_BUFFER_BYTES = 256 * 1024`（`:1`）、`DRAIN_TIMEOUT_MS = 15_000`（`:2`）；超限或 drain 超时只 `res.destroy()` **该条**连接（`:30`、`:38-48`）。
- `src/routes/public.js`：overlay `retry: 3000`（`:116`）、15 秒 keepalive（`:139-144`）。
- **没有连接数量上限**：`src/lib/sse-connection-registry.js:1-14` 是一个无上限的 `Map`；`docs/protocol/sse-delivery.md:27` 明确 `Normal clients have no new message-rate or connection-count quota`。唯一硬约束是「每个 Device 只保留一条 gift SSE，新连接关旧」。
- **没有应用层空闲超时**：Device SSE 的 25 秒 keepalive 只为代理可见性；真正有超时的是上游 B 站侧（HTTP 升级 **8 秒**、auth **10 秒**、静默看门狗 **90 秒**、心跳 **30 秒**）。
- **`Last-Event-ID` 完全不被服务器读取**：`src/` 中 grep 无引用；礼物流显式声明「不提供 `Last-Event-ID` 回放」（`docs/protocol/client-server-api.md:191`），overlay 声明「不产生补发或恢复语义」（`docs/protocol/public-overlay-api.md:49-51`）。
- 服务器优雅退出时：**先**关闭并注销公开 overlay、cloud-state、Device gift 三类 SSE 并清理 timer/listener，**再**关闭租户存储；重复 cleanup 不产生副作用（`docs/operations/bilibili-monitoring-and-reconnect.md:79`）。

**上游 B 站连接参数**（影响主播感知的延迟）：HTTP 升级握手期限 **8 秒**（`src/modules/bilibili/room-monitor.js:264`）、房间轮询 `max(30, viewer_poll_seconds)` **默认 60 秒**（`:484-496`，`src/config.js:108-111`）、重连基础 **2/4/8/16/32 秒** + 50–100% jitter、最低 1 秒、默认上限 **60 秒**（`room-monitor.js:506-522`，`src/config.js:116-119`）。
> ⚠️ 生产必须显式保证 `BILIBILI_RECONNECT_MAX_SECONDS ≤ 60`：`src/config.js:116-119` **只设下限、不强制上限**，文档自认代码无硬上限（`docs/operations/bilibili-monitoring-and-reconnect.md:81`）。

### 5.5 Device Token 续期与主播会注意到什么

- **没有独立 refresh endpoint**；续期必须重新执行 `POST /api/device/challenge` + `POST /api/device/verify`（`docs/protocol/session-lifecycle.md:35`）。
- 同一应用进程内续期复用稳定 `runtimeId`；新进程必须生成新 `runtimeId`（`…session-lifecycle.md:36`）。
- **有条件续期（ADR-0052）**：自动续期在 verify 中携带上一次成功响应的 `renewalSessionId`；服务端在同一事务内校验该 Session 仍属当前 device/runtime/auth epoch 且 active。失败码：`401 SESSION_SUPERSEDED` / `401 SESSION_REVOKED` / `401 DEVICE_SESSION_INVALID` / `401 DEVICE_AUTH_EPOCH_CHANGED`（`docs/protocol/session-lifecycle.md:37`）。
- **不同 runtimeId 成功 verify 会把同一 Device 的其他活动 Session 标记为 `superseded`**，旧 token 立即失效（`…session-lifecycle.md:41`）。
- 每次受保护请求都重新查询 Device、License、Streamer 和 Session——**JWT 本身不是永久授权证明**（`…session-lifecycle.md:43`）。
- **主播实际会看到什么**（`docs/protocol/session-lifecycle.md:54-58`）：网络不通 → 客户端保留设备身份、显示可重试连接状态；明确的授权拒绝 → 进入阻断状态；`SESSION_SUPERSEDED` → 停止当前 runtime 的自动抢占，等待用户确认当前设备/进程归属。

### 5.6 一句话给主播

> **关掉直播软件，服务器还在看着你的直播间。** 只要你之前登录过 B 站、开着监听、并且账号是启用状态，服务器会**整天**连着你的直播间收礼物和弹幕（哪怕你没开播），礼物会照常记账。但**断线期间漏掉的弹幕不会补发**，OBS 画面重连后也是从当前状态重新开始。

---

## 6. 运维相关、但主播需要知道的部分

### 6.1 服务更新

- 更新是**人工流程**，按 `docs/operations/server-update.md` 执行；文档原文：依赖变更须先在隔离候选目录完成安装和验证，**再安排维护窗口**（`docs/operations/server-update.md:7`）。
- 常规路径：本地改 → `git commit/push` → 服务器 `git pull` → `pm2 restart lira-server`（纯 JS/HTML/CSS，`docs/operations/server-update.md:207-223`、`466-475`）。
- 维护窗口内执行 `pm2 startOrRestart ecosystem.config.cjs --only lira-server --update-env`，**这会重启服务**（`docs/operations/server-update.md:507`）。
- **没有零停机 / 蓝绿机制**（`docs/operations/server-update.md:7`「本文不是自动发布/回滚程序」）。优雅退出上限 **5000 ms**（`src/server-lifecycle.js:48`），仓库 PM2 `kill_timeout: 6000`（`ecosystem.config.cjs:16`）——PM2 默认 1600 ms 不够（`docs/operations/server-update.md:503-505`）。
- 重启的直接影响：**结束旧 SSE，客户端随后重连**（`docs/operations/request-protection.md:106`）。
- **直播监控会中断**：进程启动时 `monitorManager.startAll()` 重建 monitor（`docs/operations/bilibili-monitoring-and-reconnect.md:55`）；批量启动失败只记 `Monitor <streamerId> failed:` 并继续其他租户，**不自动重试**（`…:56`）。
- 不会删除或覆盖服务器上的 `.env`、管理员数据库、主播数据库和运行数据（`docs/operations/server-update.md:74`）。
- ⚠️ **`src/lib/maintenance.js` 不是「维护模式」**：它是每 **6 小时** 一次的后台清理，删除过期的 `device_challenges`（24 小时）和 30 天前的非 active `device_sessions`（`src/lib/maintenance.js:9-12`、`38-55`；挂载于 `src/server-lifecycle.js:41`）。**仓库中不存在代码级的 maintenance mode / 只读开关 / 停写升级（drain）。**文档里的「维护窗口 / 停写」是**纯人工操作流程**：`pm2 stop lira-server` + 停止所有写入者，然后 `npm run backup`（`docs/operations/sqlite-backup-and-restore.md:53-54`、`80`；`docs/operations/server-update.md:409`）。
  > 推论：服务器**没有**面向观众的「维护中」页面——**需人工确认**是否有反代/Nginx 层的维护页。

### 6.2 备份与恢复

- 手动：`npm run backup`（SQLite Online Backup API，逐库 `quick_check` 通过后才安装快照）（`docs/operations/sqlite-backup-and-restore.md:24-29`）。
- 自动：服务启动后**约 5 分钟**首次运行，之后**每 24 小时**一次；默认存到 `backups/YYYY-MM-DD/`（UTC），**同一天再次运行会替换当天快照**，默认**只保留最近 7 个日期目录**（`…sqlite-backup-and-restore.md:45`）。
- 备份范围：`admin/admin.db`、`catalog/catalog.db`、每租户 `<data_dir>/db/*.db` 与 `web/*.db`，以及 `assets`、`uploads`、`overlays`、`exports` 下的普通文件。**不包含** `cache`、`runtime`、`logs`、**配置密钥**和全局 JSON 清单（`…:31-41`）。
- 主播相关的重要事实：**签到累计、每日签到记录、抽签结果和开关设置都在租户 `db/streamer.db` 内，随整库一起备份**；恢复后直接沿用备份时的累计和每日结果——当天已签不重复增加，已有签文不重抽，次日继续累计。**客户端无需额外导入或确认旧数据**，开启和重启也不会清空这些记录（`…:39`）。
- **恢复是纯人工流程**：当前没有一键恢复命令、跨库原子恢复或自动恢复验收（`…:142`）。恢复后还必须为受影响租户**轮换 sync epoch**，客户端会丢弃旧世代数据并从 bootstrap 第一页重建（`…:116-138`；`docs/operations/bilibili-monitoring-and-reconnect.md:111`）。
- **数据可能丢什么**：逐库备份**不提供跨库同一时刻的事务快照**；只复制运行中 WAL 数据库的主 `.db`（不带 `-wal`）**可能缺少已提交事务**（`…:47`、`51`）。恢复旧快照后还需对照之后的删除审计，避免「复活」已删除账号（`…:115`）。

### 6.3 请求保护与限流（主播/观众会遇到的）

分层：云端 DDoS 清洗/WAF、Nginx 入口限制、应用额度、有界连接（`docs/operations/request-protection.md:14`）。

| 层级 | 限制 | 证据 |
| --- | --- | --- |
| 网站 API | **每归一化 IP 600 次/60 秒，跨 Host 共用**；解析正文前执行 | `docs/operations/request-protection.md:46`；`src/app.js:78` |
| 公开歌单 songs | **60 次/分钟/IP** → `429 TOO_MANY_SONG_REQUESTS` + `Retry-After` | `src/routes/public.js:33-43` |
| 公开歌单 profile | **60 次/分钟/IP** → `429 TOO_MANY_SONG_PROFILE_REQUESTS` | `src/routes/public.js:44-50` |
| 公开礼物 API | **120 次/分钟/IP** → `429 TOO_MANY_REQUESTS` | `src/routes/gifts-public.js:15-21` |
| 登录 | **20 次/10 分钟**（`consoleLoginLimiter`，Admin 与 Streamer 共用） | `docs/operations/request-protection.md:47`；`src/routes/auth.js:41` |
| 密码重置 | 独立 limiter + 每码最多 5 次尝试 → `429 TOO_MANY_PASSWORD_RESET_ATTEMPTS` | `docs/design/unified-management-console-phase-4-design.md:36`、`46`；`src/routes/auth.js:124` |
| 礼物账本清空 | 每 Device 每分钟最多 5 次 | `docs/operations/bilibili-monitoring-and-reconnect.md:105` |
| Nginx 请求速率 | 每 IP **20 次/秒、突发 80**；全站 **100 次/秒、突发 200**；超量立即拒绝 | `docs/operations/request-protection.md:48` |
| Nginx 并发 | 每 IP **32**、全站 **256**，跨子域共用 | `…:49` |
| 边缘拒绝码 | Nginx 本地拒绝返回 `TOO_MANY_EDGE_REQUESTS`；应用拒绝保留原错误码，且带 `no-store`/`Retry-After` | `…:145-146` |

**豁免**：`/api/device/*` 及其子路径、`/api/public/overlay/events` **不计入**新增的请求/并发额度，**不限制主播弹幕消息量、不增加弹幕连接数量上限，也不修改 OBS 重连逻辑**（`…:58-63`）。

**运维明说的限制**（`…:65-67`）：这是初始基线，**不是压测容量承诺**；学校/公司网络共享 IP、大量浏览器标签、初次字体加载和多设备同时上线**必须在预发布环境校准**；应用层额度**每进程独立，重启即重置**；多 worker/主机会成倍放大额度。

> 具体错误码原文：`TOO_MANY_SONG_REQUESTS`、`TOO_MANY_SONG_PROFILE_REQUESTS`、`TOO_MANY_REQUESTS`、`TOO_MANY_EDGE_REQUESTS`、`TOO_MANY_PASSWORD_RESET_ATTEMPTS`。**429 不能重写为 HTML 登录页或触发设备重新激活**（`…:146`）。

### 6.4 B 站监控与重连（主播会遇到的）

- **未登录不监听**：未保存 B 站登录凭据时，管理端列表显示 `waiting-login`，不启动房间轮询、WebSocket 或 detector；登录成功同步后才重新检查启动条件（`docs/operations/bilibili-monitoring-and-reconnect.md:46`）。
- **重连退避**：基础 **2、4、8、16、32 秒**，受配置上限约束；实际 delay 取基础值的 **50%–100% jitter 且不低于 1 秒**；**默认上限 60 秒**（`…:69`）。
- **握手期限**：每个上游 ws 的 HTTP 升级握手期限 **8 秒**；TCP 已连但升级不响应也会关闭并按 jitter 退避重连（`…:50`）。
- **凭据错误码**：无可解密非空 Cookie → `BILIBILI_CREDENTIALS_NOT_CONFIGURED`（拒绝游客捕捉）；Cookie 里 UID 缺失/非法/超安全整数 → `BILIBILI_CREDENTIALS_UID_INVALID`（`…:63`）。
- **界面上别误读**：Admin 的 WebSocket 显示「已连接 / 未连接」，**未连接 ≠ 监听已停止**；`onlineMetric` 是房间接口原始指标，**不是已验证的实时在线人数**；`popularity` 是新 socket 会清空的弹幕心跳值，未连接时显示「未获取」（`…:72`）。
- **换号/解绑**：显式退出 Bilibili 在同步到对应云端租户后停止其捕捉，不影响其他租户；**网络不通时不会立即改变云端状态**（`…:97`）。

### 6.5 主播需要知道的运维事实（会改变日常行为 / 需要联系管理员的）

| # | 事实 | 主播该怎么办 | 证据 |
| --- | --- | --- | --- |
| 1 | **服务更新需要维护窗口并重启服务**，重启会断开所有 SSE，客户端随后自动重连 | 尽量避开正在开播时更新；掉线后等客户端自动重连，不用手动重装 | `docs/operations/server-update.md:507`；`docs/operations/request-protection.md:106` |
| 2 | **激活码/登录码/密码重置码都只有管理员能生成，且都以分钟计** | 想加电脑/忘密码，**提前**联系管理员要码；码过期就重新要一张 | `docs/protocol/pairing.md:21-25`；`README.md:130-132` |
| 3 | **完整激活码只在生成时显示一次** | 收到码立刻用；丢了只能让管理员重新生成 | `docs/protocol/pairing.md:22` |
| 4 | **服务器全天监听，但断线期间的弹幕不会补发** | 不要把弹幕姬当录播；重要弹幕需要另外存档 | `docs/protocol/public-overlay-api.md:48-54`；`docs/operations/bilibili-monitoring-and-reconnect.md:131` |
| 5 | **未登录 B 站 / 关闭监听 / 账号被停用 → 服务器停止捕捉** | 长时间不监听就先确认这三项状态 | `docs/operations/bilibili-monitoring-and-reconnect.md:46`、`97` |
| 6 | **备份默认只保留最近 7 个日期目录，且当天重跑会覆盖当天快照** | 需要长期留档必须让管理员另外归档 | `docs/operations/sqlite-backup-and-restore.md:45` |
| 7 | **恢复旧备份会回退数据**（可能「复活」已删除账号，且恢复后需要客户端重建礼物投影） | 发现数据异常先联系管理员，不要自己反复同步 | `docs/operations/sqlite-backup-and-restore.md:115`、`138-140` |
| 8 | **清空礼物账本是不可逆操作**，只有桌面客户端能做，且每分钟最多 5 次 | 点之前想清楚；Super Chat、settings、凭据、歌单不受影响 | `docs/operations/bilibili-monitoring-and-reconnect.md:105-107` |
| 9 | **共享 IP 会共用限流额度**（60 次/分钟的公开歌单额度按 IP，IPv6 按 /56 子网共享） | 学校/公司网络或多人同网时公开歌单可能偶发 429，稍等再刷 | `docs/operations/request-protection.md:46`、`65-67` |
| 10 | **没有「维护模式」页面**，只有重启窗口 | 页面报错时先等几分钟再刷新；持续异常再找管理员 | `src/lib/maintenance.js`（只有 6 小时周期性清理）；**需人工确认**是否有反代维护页 |

---

## 7. 服务器端是否有面向主播的使用文档？

### 结论：**服务器仓库（`D:\Work\lira-server`）中没有任何面向主播的使用文档。**
### 但：**客户端仓库（`D:\Work\Live`）里已经有一份完整的主播使用文档**，而且它**没有覆盖服务器侧的功能**——这是你要写的那份文档的空白区。

#### 7.1 服务器仓库：没有（NO）

| 文档 / 目录 | 自述读者 | 证据 |
| --- | --- | --- |
| `README.md` | **部署者 / 维护者**。DNS、TLS 证书、Nginx、PM2、环境变量密钥、`npm run` 命令、SQLite 表结构 | `README.md:179-332` |
| `AGENTS.md` | **代码贡献者 / AI 代理**。文档治理与分层规则 | `AGENTS.md:1-23` |
| `docs/README.md` | **维护者**。文档索引与权威顺序 | `docs/README.md:3-24` |
| `docs/protocol/README.md` | **协议实现者**。协议版本、canonical 字节串、OpenAPI | `docs/protocol/README.md:10-53` |
| `docs/guides/client-onboarding.md`（**`docs/guides/` 下唯一文件**） | **客户端开发者**。自述：`本文是客户端工程实施入口，不是协议的第二份来源。` | `docs/guides/client-onboarding.md:12` |
| `docs/operations/*.md`（10 个文件） | **运维 / 部署者**。PM2、备份、Nginx、限流、IP 属地维护；front-matter 全部 `owner: project-maintainers` | `docs/operations/deployment-runtime.md:3`；`docs/operations/sqlite-backup-and-restore.md:5` |
| `docs/design/*.md` | **设计者 / 实施者**，且非规范：`均为 non-normative 参考资料，不能替代当前规范` | `docs/design/README.md:3` |
| `docs/superpowers/plans/*.md` | **实施者**，non-normative | `docs/README.md:24`、`59` |
| `docs/history/upgrade-v0.5.md` / `upgrade-v0.6.md` | **管理员 / 升级执行者**；`upgrade-v0.6.md:3-6` 自述「历史版本记录，不是当前操作步骤」 | `README.md:248` |
| `docs/audits/*.md` | **审计读者 / 维护者**，且被明确声明不是当前规范 | `docs/README.md:16`；`AGENTS.md:5` |
| `docs/requirements/*.md` | **规范维护者**；`requirements/` 在维护者确认前保持 `draft` | `docs/README.md:20` |
| `public/` 站内帮助 | **没有帮助页、没有 FAQ**。`public/` 顶层只有 `admin`、`games`、`gifts`、`overlay`、`shared`、`site`、`song`、`streamer`，无 `help`/`faq` 目录 | 目录清单 |

**全仓库关键词检索**（`docs/` 下所有 `.md`，搜 `面向主播|给主播看|主播视角|使用说明|使用手册|新手指引|主播教程|快速开始|常见问题|FAQ`）：**仅 2 处命中，都不是用户文档** —— 都在 `docs/audits/2026-09-14-gift-interaction-research-audit.md:773`、`777`，说的是**开发者 CLI 采样脚本**的「使用说明」，指向 `docs/operations/test1-gift-capture.md`（维护者诊断工具）。

**与代码不符的过时说法**（若照抄会误导主播）：

| 文档位置 | 过时说法 | 代码事实 |
| --- | --- | --- |
| `docs/guides/client-onboarding.md:37-39`（另 `:64`、`:74`） | `已授权设备可以创建短效 pairing code。` | 固定 `403 PAIRING_CODE_ADMIN_ONLY`（`src/routes/device.js:244-247`）；该文件 `last_verified: 2026-08-29`，早于 0.6.2 收紧 |
| `docs/history/upgrade-v0.5.md:27` | `永不过期的新主播开户注册码` | 上限 1440 分钟；旧 unused 码迁移后按创建时间 +1h 过期（`src/db.js:415`、`418`） |
| `docs/history/upgrade-v0.5.md:28` | 示例密码 `123456` | 不符当前密码策略（≥8 位、≥3 类字符） |
| `docs/history/upgrade-v0.6.md:14` | 设备自助发码 | 历史描述，未随 0.6.2 改写（`:3-6` 已声明被取代） |
| `README.md:201` | 离线 IP 快照随 `npm ci` 安装、`npm run ip-location:status/update` 每周检查 ip2region | `package.json` 已无这些脚本；改为在线查询 `https://www.cz88.net`（`docs/operations/deployment-runtime.md:38`） |
| `docs/protocol/management-api.md:784`（**normative**） | `INVALID_OVERLAY_STYLE` 只有 4 个值 | 服务器实际接受 **9 个**（`src/modules/streamer/overlay-settings.js:10-13`） |

#### 7.2 客户端仓库：**有**，而且很完整（这是关键）

`D:\Work\Live\public\pages\admin\toolbox\usage-guide.html`（**1279 行**，标题 `使用文档`）是一份**真正面向主播的中文使用手册**，共 **12 个章节**：

| # | 章节标题 |
| --- | --- |
| 01 | 快速上手 |
| 02 | 账号与设备：先登录 LIRA，再连接直播间 |
| 03 | 更新或重新安装 |
| 04 | 主流程：一次完整的开播操作 |
| 05 | 点歌页详解 |
| 06 | 播放页详解 |
| 07 | 礼物页详解 |
| 08 | 百宝箱详解 |
| 09 | 配置 AI 助手 |
| 10 | 直播姬 / OBS 投屏设置 |
| 11 | 常用设置在哪里 |
| 12 | 常见问题 |

同目录还有 `onboarding.html`（首次引导）与 `usage-guide-search.html`（手册搜索）。

**它已经写对了的部分**（写新文档时不要重复造轮子，直接引用）：
- 首次注册与加设备：`第一次使用，选择「注册新账号」，填写用户名、密码和管理员提供的注册激活码。已有账号，选择「登录已有账号」。如果换了电脑或清除数据后重装，还需要向管理员领取新的短效登录码。`（`:75`；另见 `:105-108`、`:497`、`:916`）
- 一次性规则：`注册激活码和短效登录码都只能成功使用一次，请在管理员告知的有效期内使用。`（`:108`）
- 换机同步清单：`会自动同步：歌库、直播账号登录状态、直播间号、点歌规则和自定义盲盒设置。` / `需要重新设置：音乐平台登录、点歌和播放队列、界面和直播画面样式。本地文件、日历、备忘和待办也分别保存在各台电脑上。` / 警告 `注意：不要直接复制旧电脑的数据文件夹，请在新电脑登录原账号。`（`:498-500`）
- 歌库同步：`登录 LIRA 并联网后，歌库会自动同步到同一账号的其他电脑，不用每次手动上传。`、`最多 5000 首`（`:300`、`:964`）
- OBS 画面分类，且已区分**在线链接**与**本机画面**：`弹幕姬使用在线链接；点歌队列、歌词等本机画面，需要让 LIRA 和直播软件在同一台电脑运行，并保持 LIRA 开启。网页歌单是给观众看歌曲的页面，与这些直播画面分别使用各自的链接。`（`:781`）

#### 7.3 因此：你要写的文档，真正的空白区是「服务器侧」

客户端手册**完全没有提到**下列服务器功能（在这些 1279 行里 grep 全部 0 命中）：
`admin.lirahub.cn/manage`、`主播中心`、网页歌单外观/二维码、**忘记密码 / 重置码 / `password-reset`**、礼物特效档案（`gifts.lirahub.cn`）、小游戏（`games.lirahub.cn`）、公开歌单页的观众交互、OBS 浏览器源地址的**获取位置**（它只说「弹幕姬使用在线链接」，没说去 `/manage?page=overlay` 复制）。

> **建议**：新文档应以「客户端手册没说到的服务器侧功能」为主线，并在开头指向客户端手册，避免两处内容打架。

#### 7.4 服务器仓库里最接近「可给主播看」的替代物（但都不是使用文档）

1. `README.md:64-75`（用户名 / 密码规则）与 `README.md:140-150`（歌单同步、`/manage` 只读、忘记密码走管理员 15 分钟重置码）——内容对主播有用，但写法面向部署者。
2. `public/streamer/manage.html` 的内联提示与空态文字（`:57`、`:83`、`:124`、`:182`、`:225`、`:231`、`:241`、`:244`、`:263`、`:331-333`）——**这是主播在服务器页面上唯一能看到的说明性文字**，但只是控件级 hint。
3. `docs/protocol/error-codes.md:16-133` 的 **User action 列**（如 `:21-23` 429 应对、`:55-57` 联系 Admin、`:91` 需查服务端密钥）——规范文本，写给实现者。
4. `docs/history/release-*.md` 中偶发的用户动作提示（如 `release-2026-09-20-4.md:14`「刷新浏览器源」）。
5. `output/streamer-research-2026-09-17/streamer-center-product-review.md`、`assessment-a.md`、`assessment-b.md`——**主播中心的产品评审**（给 owner 看），不是手册。其中 `assessment-a.md:136` 已记录「帮助与文档 1/4 … 未发现新手安装步骤、可搜索帮助或清楚的求助入口」（**注**：同文件 `:3` 与 `streamer-center-product-review.md:202`、`212` 撤回了新手画像/引导建议，引用该结论前**需人工确认**权重）。`output/` 目录按 `docs/README.md:61` 是验证报告目录，**不是规范来源**。

---

## 附录 A：全部对外 URL 速查（供文档直接引用）

### 公开（无需登录）

```text
https://lirahub.cn/                                   LIRA 官网首页（兼容 https://www.lirahub.cn/）
https://lirahub.cn/gifts                              礼物特效档案（主站兼容入口）
https://gifts.lirahub.cn/                             礼物特效档案（canonical）
https://gifts.lirahub.cn/gifts/<groupId>              单个礼物详情
https://<主播子域名>.lirahub.cn/                       公开歌单（兼容 /song、/song/）
https://<主播子域名>.lirahub.cn/overlay/<16位token>    OBS 弹幕姬画面（token = 只读凭证）
https://games.lirahub.cn/                             小游戏目录
https://fame-road.games.lirahub.cn/                   《成名之路》
https://treasure-house.games.lirahub.cn/              《玲珑宝斋》
https://constellation-echo.games.lirahub.cn/          《星座回响》
https://api.lirahub.cn/                               API 根（返回 JSON）
/health                                               健康探测（任意 Host）
```

### 需要登录

```text
https://admin.lirahub.cn/login                        统一登录（主播 + 管理员同一个入口）
https://admin.lirahub.cn/password-reset               忘记密码（凭一次性重置码，无需登录）
                                                      表单字段：账号 / 重置码 / 新密码 / 确认密码

# —— 管理员控制台 ——
https://admin.lirahub.cn/admin                        概览
https://admin.lirahub.cn/admin/streamers              主播
https://admin.lirahub.cn/admin/streamers/<id>         主播详情（会自动规范化为 .../overview）
https://admin.lirahub.cn/admin/streamers/<id>/<tab>   tab ∈ overview | monitor | gifts | devices | auth
                                                      界面名依次为：概览 / 24h 连接 / 礼物 / 设备 / 授权
https://admin.lirahub.cn/admin/streamers/<id>/gifts?view=analysis   礼物 → 数据分析（默认是 礼物流水）
https://admin.lirahub.cn/admin/activations            激活码
https://admin.lirahub.cn/admin/devices                设备
https://admin.lirahub.cn/admin/audit                  审计日志
# 已退役：/admin/monitor、/admin/gifts → 重定向到 /admin/streamers
# 未知 /admin/xxx → 回落到 概览

# —— 主播中心 ——
https://admin.lirahub.cn/manage                       主播中心（默认 礼物流水）
https://admin.lirahub.cn/manage?page=gift-history     礼物流水
https://admin.lirahub.cn/manage?page=gift-analysis    数据分析
https://admin.lirahub.cn/manage?page=song-page        网页歌单
https://admin.lirahub.cn/manage?page=overlay          直播弹幕姬
# 兼容旧参数：gifts→gift-history、insights→gift-analysis、broadcast|library|appearance→song-page

# —— 管理员只读模式 ——
https://admin.lirahub.cn/manage/streamers/<id>/overview    查看主播数据（只读）
```

### 旧入口（兜底跳转）

```text
https://admin.lirahub.cn/admin/login    302 → /login
https://<主播子域名>.lirahub.cn/manage  清除 Cookie 后 302 → https://admin.lirahub.cn/login
```

---

## 附录 B：本盘点未覆盖 / 需人工确认的事项

1. `docs/superpowers/plans/2026-08-30-unified-management-console-phase-*.md` 各阶段的实际完成度未逐条核对；`2026-08-30-admin-live-authorization-state.md` 与 `2026-08-30-admin-remove-streamer-configuration.md` 的**勾选框全部为空**（是规格而非已验证状态）——**需人工确认**。
2. `public/streamer/gift-workspace.js` 的 `basicAnalysis` 分歧：**管理员看到更多分析块，主播看到更多筛选器**（见 3.4）。代码确定，但产品是否有意如此**无文档记载，需人工确认**。
3. `POST /api/admin/devices/:id/kick-sessions` 已实现且有审计标签 `让设备退出登录`，但**前端没有任何调用方**（`src/routes/admin.js:473-484`；`public/admin/audit-log.js:22`）——有意保留还是遗留，**需人工确认**。
4. 管理员侧歌单 API（`/api/admin/streamers/:id/songs*`）已实现但**无前端调用**；guide `:428` 说要在确认无调用方后废弃——当前处于「API 在、UI 无」状态，**需人工确认**。
5. `public/admin/index.html:96-177` 的「站点目录」**硬编码生产域名**（`lirahub.cn`、`admin.lirahub.cn`、`api.lirahub.cn`、`gifts.lirahub.cn`、`games.lirahub.cn`、`lirahub.dpdns.org`）。纯展示用途，但与仓库「不把部署域名硬编码进业务逻辑」的规则相冲突——**需人工确认**是否可接受。
6. 「中转服务 `lirahub.dpdns.org`（AI API 中转站）」在管理台站点目录中被列出（`public/admin/index.html:169-175`），但**不是 LIRA Server 的功能**，本仓库无对应实现——**需人工确认**它是什么。
7. `docs/operations/ip-location.md` 本次未逐行读；可确认的是它**纯属管理端功能**（读设备 `last_ip`，请求 `https://www.cz88.net/api/cz88/ip/base`，只在 Admin 概览与设备列表展示国/省/市/区/ISP/网络类型，来源标注「纯真官网」），**不进入主播侧界面**——细节**需人工确认**。
8. ⚠️ **`README.md:201` 已过时**：它仍写「离线 IP 快照随 `npm ci` 安装」「`npm run ip-location:status` / `ip-location:update` 每周检查 ip2region」，但 `package.json` 已无这些脚本，`docs/operations/ip-location.md` 与 ADR-0065 已改为在线查询（`docs/operations/deployment-runtime.md:38`）——**需人工确认**是否更新 README。
9. 两个错误码**未收录进规范性文档** `docs/protocol/error-codes.md`：`TOO_MANY_LOGIN_ATTEMPTS`（`src/middleware/console-login-limit.js:8`）与 `TOO_MANY_SONG_PROFILE_REQUESTS`（`src/routes/public.js:49`）——规范缺口，**需人工确认**。
10. 备份 **RPO 无正式定义**；按 `src/lib/backup-runtime.js:6-7`、`43-44`（启动后约 5 分钟首次、之后每 24 小时）推断最坏约 24 小时——**需人工确认**。
11. 生产 Nginx 实际配置是否等同 `nginx/lirahub.cn.conf.example`（SSE 路径限流豁免、1 小时 read timeout）未在运行环境验证——**需人工确认**。
12. 生产 `BILIBILI_RECONNECT_MAX_SECONDS` 是否 ≤60 未验证：`src/config.js:116-119` **只设下限、不强制上限**，文档自认代码无硬上限（`docs/operations/bilibili-monitoring-and-reconnect.md:81`）——**需人工确认**。
13. `docs/design/always-connected-danmaku-and-live-greeting.md` 状态为 `status: proposed`，其「当前实现与差距」段称停播会关 WebSocket——**与当前代码及已接受的 ADR-0060 不一致，该段已过时，不可引用**。
14. 客户端 UI 文案（登录失效/离线提示的具体措辞）属客户端仓库渲染层，本次只核到状态机与常量——**需人工确认**。
15. 客户端与服务器的版本配对（`server-contract.lock.json`）是否为当前部署组合未验证——**需人工确认**。
16. `/password-reset` 的 GET 无 actor guard 且无限流（`docs/protocol/management-api.md:740` 说明是设计如此）——列出仅供参考。
17. `Get-Content` 等 PowerShell 工具会**误读这些 UTF-8 文件的行数**（低估）。本报告引用的行号均来自逐行读取，可复现。
18. **客户端仓库的 `usage-guide.html` 是否随安装包发布、主播能否在界面里打开**，本次只确认了文件存在与内容，未核入口路径（`usage-guide-search.html` 与 `onboarding.html` 的存在暗示有入口）——**需人工确认**。
19. 本盘点以**服务器仓库**为范围；客户端侧功能（点歌队列画面、歌词画面、盲盒盈亏榜、加班机、礼物特效画面、AI 助手等）只在第 7 节作为「已有手册」提及，**未系统盘点**——若新文档要覆盖它们，**需另做客户端盘点**。

---

## 附录 C：给「主播文档」作者的 9 条硬提醒

1. **不要写「盲盒榜」网页，也不要写「名人堂」「抽卡活动」** —— 服务器端不存在。「盲盒盈亏榜」是**客户端本机的 OBS 浏览器源**（`D:\Work\Live\public\pages\admin\toolbox\usage-guide.html:801-806`），不是服务器页面。
2. **所有码都找管理员要** —— 设备端自助发码已停用（`403 PAIRING_CODE_ADMIN_ONLY`）；服务器**没有邮件/短信通道**，管理员必须手工转发 16 位码。包括 `docs/guides/client-onboarding.md:37-39` 在内的多处旧说法都已过时。
3. **先读客户端已有的手册，别重复造轮子**：`D:\Work\Live\public\pages\admin\toolbox\usage-guide.html`（1279 行、12 章）已经覆盖客户端全部功能（注册/登录、歌库同步、点歌/播放/礼物/百宝箱、OBS 投屏、常见问题）。新文档应**以「它没说到的服务器侧功能」为主线**，并在开头指向它，避免两处打架。
4. **服务器侧的真正空白**（客户端手册 0 命中）：`admin.lirahub.cn/manage` 主播中心、网页歌单外观与二维码、**忘记密码 / 重置码 / `password-reset`**、礼物特效档案、小游戏目录、公开歌单页的观众交互、以及**去哪里复制 OBS 浏览器源地址**。
5. **「数据分析」要按主播实际能看到的那一列写** —— 主播有日期筛选和下钻，**没有**收礼频次/构成趋势/礼物贡献排行（那些是管理员侧，见 3.4）。
6. **明确写「歌曲只能在桌面客户端改」** —— 网页歌单是只读的，界面原文就在 `public/streamer/manage.html:124`。
7. **明确写「弹幕不存档、不补发」** —— 这是最容易让主播误解的地方（`docs/protocol/public-overlay-api.md:48-54`）。
8. **明确写「电脑关了服务器照样收礼物、照样自动欢迎/答谢」** —— 这是本产品最大的卖点之一，已被 ADR-0006/0009/0060 确认。
9. **所有服务器界面文案直接抄 `public/streamer/manage.html` 原文** —— 主播看到的字就是那些，不要自己改写成另一套说法。
