# 存储层：数据目录、SQLite 六库与迁移

> 涉及文件：[src/storage/database.js](../../../src/storage/database.js)、[src/storage/database-migrations.js](../../../src/storage/database-migrations.js)、[src/storage/dynamic-lottery-migrations.js](../../../src/storage/dynamic-lottery-migrations.js)、[src/storage/dynamic-lottery-schema.js](../../../src/storage/dynamic-lottery-schema.js)、[src/storage/dynamic-lottery-store.js](../../../src/storage/dynamic-lottery-store.js)、[src/storage/dynamic-lottery-budget-store.js](../../../src/storage/dynamic-lottery-budget-store.js)、[src/storage/database-maintenance.js](../../../src/storage/database-maintenance.js)、[src/storage/schema.js](../../../src/storage/schema.js)、[src/storage/retention.js](../../../src/storage/retention.js)、[src/storage/settings-store.js](../../../src/storage/settings-store.js)、[src/storage/settings-defaults.js](../../../src/storage/settings-defaults.js)、[src/storage/settings-migrations.js](../../../src/storage/settings-migrations.js)、[src/storage/theme-store.js](../../../src/storage/theme-store.js)、[src/storage/playback-store.js](../../../src/storage/playback-store.js)、[src/storage/cooldown-store.js](../../../src/storage/cooldown-store.js)、[src/storage/daily-bot-legacy-reader.js](../../../src/storage/daily-bot-legacy-reader.js)

本文档是数据库与数据目录的**单一事实来源**，集中说明数据目录布局、SQLite 六库表清单、DDL 要点、迁移版本与保留/清理策略；其他文档涉及存储细节时统一链接此处。

**内部模块边界：** `database.js` 负责打开六个数据库、配置 PRAGMA 并向外提供连接句柄；`database-migrations.js` 维护原五库的 schema 与数据迁移顺序，并转发 [legacy-superchat-migration.js](../../../src/storage/legacy-superchat-migration.js) 的历史醒目留言跨库迁移（负责旧表读取、目标库事务、去重及成功后的旧表清理）。`dynamic-lottery-migrations.js` 维护抽奖库独立的迁移版本序列，表结构、业务事务与请求预算分别由 `dynamic-lottery-schema.js`、`dynamic-lottery-store.js`、`dynamic-lottery-budget-store.js` 负责；`database-maintenance.js` 负责清库、优化与关闭等维护操作。设置域由 `settings-store.js` 提供统一读写门面，`settings-defaults.js` 仅声明不可变默认值，`settings-migrations.js` 仅执行设置键迁移。上层不得绕过这些门面直接调用迁移或维护模块。

单个数据库在 PRAGMA 初始化完成前由 `openSqliteDatabase` 管理，失败时关闭尚未登记的句柄并保留原错误。`createDatabases` 失败时清理此前已登记的数据库，全部成功后才把整组句柄交由服务器生命周期管理。抽奖库在原五库完成初始化后单独打开与迁移，失败时关闭新连接并返回 `lotteryDb: null`（由抽奖 runtime 禁用该功能，不影响点歌、礼物和播放启动）。关闭失败沿用 `closeDatabases` 的逐库警告并继续清理，不撤销已提交的初始化或迁移数据。

`requester-target-store.js` 负责随机点歌请求者查询，由 `server/domain-services.js` 注入 `songDb`，查询契约见 [音乐服务 §12](music/services.md#12-请求者定位storagerequester-target-storejs)。

## 1. 技术选型

- **`node:sqlite` 内置模块 `DatabaseSync`**（同步 API），零第三方数据库依赖，要求 Node ≥ 24（见 [engineering/build.md](../engineering/build.md)）。
- 每库统一 PRAGMA（[database.js](../../../src/storage/database.js)）：`journal_mode=WAL`、`synchronous=NORMAL`、`cache_size=-8000`、`temp_store=MEMORY`；`songDb` / `giftDb` / `musicDb` / `lotteryDb` 额外开启 `foreign_keys=ON`。
- **多库拆分**：按领域隔离，避免单库写锁竞争与误清数据，详见 [ADR-0004](../../architecture/adr/0004-reuse-monolith-and-gift-db.md)。

## 2. 数据目录布局

`dataDir` 解析顺序：`runtimeOptions.dataDir` → 环境变量 `SONG_PLUGIN_DATA_DIR` → 仓库根 `data/`（[runtime-config.js](../../../src/server/runtime-config.js)）。Electron 打包版使用 `<安装目录>/data`，首次安装存在 D 盘时默认 `D:\LIRA\data`，否则跟随原默认安装位置；开发版继续使用仓库根 `data/`，升级保留与旧 AppData 兼容读取见 [desktop/main.md](../desktop/main.md) §3。

旧 AppData 目录的首次复制在来源业务根的 Electron 单实例锁内执行，并先确认来源服务已停止；复制成功后原子发布目标，再切换到目标业务根的实例锁。已有目标不覆盖，来源仍在使用或运行标记无效时中止迁移，保留原始数据。

```
data/
├── song-request-data.db       # 点歌库（songs/queue/requests/settings/AI/主题/冷却/粉丝/场景）
├── super-chat-data.db         # 醒目留言库
├── gift-data.db               # 礼物库（gift_events + 保留快照 + 加班机三表）
├── music-data.db              # 播放器库（历史/队列态/收藏/歌单）
├── checkin-data.db            # 签到库（旧库只读兼容）
├── lottery-data.db            # 动态抽奖任务、证据、冻结轮次、结果与请求预算
├── cache/                     # 可重建的业务缓存
│   ├── overtime-gift-catalog-v2.json      # 官方金瓜子礼物与盲盒关系镜像
│   ├── overtime-gift-assets-state-v2.json # 图片扫描完成状态
│   ├── overtime-gift-images/  # 礼物图片与 index.json
│   ├── resources/             # 共享公共资源缓存与 index.json
│   ├── fonts/                 # 旧共享字体只读兼容缓存
│   ├── music-api-cache/       # 音乐 API 响应（TTL 5 分钟）
│   └── music-lyrics-cache/    # 歌词（TTL 30 天）
├── browser/                   # Electron userData/sessionData；包含持久资料
│   ├── Partitions/            # 音乐与 Bilibili 的独立登录分区
│   ├── Network/               # 默认会话 Cookie 等网络状态
│   ├── Local Storage/         # 默认会话的 localStorage
│   ├── Cache/                 # Chromium 自行管理的缓存
│   └── Crashpad/              # 崩溃报告；其余 Chromium 文件也在 browser 下
├── components/audio/          # 音频组件可执行文件（按内容版本隔离）
├── audio-assistant/           # 电音助手参数与路由恢复事务
├── desktop-notifications.json # 本机系统通知偏好
├── .browser-layout-v1.json    # 浏览器目录迁移日志
├── .cache-layout-v1.json      # 缓存目录迁移日志
├── .session-token             # 会话令牌（0600，服务关闭时删除）
├── .server-runtime.json       # 运行时信息 {pid, port, host}
├── music-auth/qq.cookies.enc          # QQ 音乐 Cookie 快照（safeStorage 加密）
├── music-auth/netease.cookies.enc     # 网易云 Cookie 快照
├── bilibili-auth/cookies.enc          # B 站 Cookie 快照
├── doubao-auth/cookies.enc            # 豆包账号 Cookie 快照（safeStorage 加密）
├── license/                   # 设备授权资料与 safeStorage 加密私钥
├── opening-music/             # 用户上传音乐，经典舞台与像素卡带分别保存选择
├── scene-text-images/         # 文本框上传图片，保持原字节与持久保存
├── component-library/         # 本机组件素材、索引与待确认套装
└── local-media-access.json    # 本地媒体文件允许清单
```

认证文件格式与生命周期见 [desktop/auth.md](../desktop/auth.md)；`logs/` 目录（`runtime/`、`errors/` 等）位于 `data/` 目录的**父目录**。豆包账号的加密 Cookie 快照位于 `dataDir/doubao-auth/cookies.enc`（加密不可用时仅用内存会话，不保存快照，详见 [auth.md §17](../desktop/auth.md#17-豆包个人账号)）；ChatGPT 订阅复用 `ai_configuration` 的私有键 `chatgptHostId` 与 `chatgptAccounts`（详见 [ai.md §4.5](ai.md#45-chatgpt-订阅与-kimi-api)）。大播放器外观属于默认会话的 `localStorage` 界面偏好，不写入 SQLite 设置或播放快照，见 [播放器外观](../frontend/playback.md#81-大播放器外观)。

路径由 [data-paths.js](../../../src/shared/data-paths.js) 统一计算。桌面持有原数据根的单实例锁后，[data-directory-migration.js](../../../src/storage/data-directory-migration.js) 在 `ready` 前迁移已知浏览器文件与缓存；独立服务与礼物初始化脚本在使用缓存前执行相同缓存迁移。迁移采用落盘日志与同卷重命名，中断可续作，目标冲突、缺失条目、符号链接及活动服务均阻止迁移，未知文件保留原处。日志原子替换遇到 `EPERM` / `EBUSY` 时，仅对同一临时文件最多重试 4 次（累计等待 ≤ 500 ms），不重放数据移动；持续失败保留原日志并中止启动。`browser/` 包含登录与界面资料，不可当作缓存整目录清理，详见 [ADR-0016](../../architecture/adr/0016-separated-client-data-lifecycles.md)。

### 本机通知偏好

桌面主进程在 `dataDir/desktop-notifications.json` 保存日程与大额礼物通知偏好，不进入 SQLite 或云设置。文件由 [desktop-notifications.js](../../../src/electron/desktop-notifications.js) 原子写入，字段与默认值见 [通知设置 IPC](../desktop/preload.md#25-dailybotsfanprofiles-与-giftexport)，调度与清理见 [本机系统通知](../desktop/main.md#本机系统通知)。工作台日程仍保存在原本机 `localStorage` 键中，不复制到此文件。

### 音频组件文件

可执行组件存于 `<dataDir>/components/audio/<内容版本>/`，与 `audio-assistant/settings.json`、路由恢复记录及播放器输出状态分离。内容版本来自固定文件清单的摘要，不随客户端版本或账号变化；该目录不参与字体/图片缓存清理及业务云同步。程序启动后首次使用前校验文件，开发构建目录或旧版 bundled 目录完整时可直接复用。

6.0.0 升级时安装器在删除旧程序前将 `resources/audio-assistant` 复制到数据备份的 `components/audio/legacy`。主进程完整校验后将其迁入内容版本目录。迁移路径仍被占用时，本次可直接从校验通过的 `legacy` 运行。下载写入独占 `.prepare-*` 目录，逐项校验成功后原子发布。安装维护退出时会检查旧路径与版本目录中的本实例音频进程。

每次启动首次确认当前组件可用后，主进程在后台回收其他 24 位内容版本目录和闲置的 `legacy`。准备失败时保留旧版。Windows 上先以非截断写模式打开旧版 EXE，持有句柄期间清理依赖，最后移除 EXE。正在播放或恢复原声的进程继续使用原目录，占用解除后可在下次启动时清理。当前版本、实际使用的目录和含链接的目录均跳过。

### 电音助手本机数据

原生会话将参数原子写入 `<dataDir>/audio-assistant/settings.json`（先写 `.tmp` 再替换），不新增 SQLite 表或服务器设置；缺失或损坏 JSON 时回退默认值，读取时归一化数值范围：

| 字段 | 默认 | 范围 / 含义 |
| --- | --- | --- |
| `strength` | 80 | −100～100，人声端 / 原唱 0 / 伴奏端 |
| `semitones` | 0 | −12～12 半音 |
| `speedPercent` | 100 | 50～200；仅本地文件使用，外部采集固定 100 |
| `volume` | 70 | 0～200 输出音量百分比；100 为单位增益，200 为两倍振幅；输出仍钳位到 −1～1，过度放大会削波失真 |
| `outputId` | 空串 | 空串在播放器模式跟随处理前输出，本地文件/设备输入用默认设备；旧 Windows 端点 ID 保留为 WASAPI，共享接口也支持 `wasapi:` / `directsound:` / `waveout:` 加端点 ID 或 `default`；ASIO 为 `asio:` 加 URI 编码驱动名，可带 `\|N` 选择零起始相邻声道对 |
| `cableId` | 空串 | 独立原声通道；未保存时可识别已有隔离设备 |
| `external` | `true` | 上次是否使用外部来源；具体 PID 与本地文件路径不持久化 |
| `deviceSource` | 空串 | `input` 为录音设备，`loopback` 为播放设备回送；空串按旧 `external` 恢复 `auto`/`file` |
| `inputId` / `loopbackId` | 空串 | 分别记忆录音设备、回送播放设备的 Windows 端点 ID；空串使用相应默认设备 |
| `inputChannels` | `auto` | 默认取单声道或前两个声道；`mono:N` / `stereo:N` 以零起始索引选择单声道/相邻声道对（N 为 0～127），启动时再校验实际设备声道数 |
| `inputMusic` | `false` | 设备输入是否启用音乐声伴处理；关闭时声伴强度有效值为 0，保留已保存的歌曲参数 |

切换来源或设备会重置输入声道为 `auto`、音乐处理为 `false`；重载保留已选设备与参数但不自动开始采集。设备缺失时保留其 ID，启动失败而不静默切换至其他设备；设备来源不保存录音或输入音频。

运行中的歌曲开关与原声对比不持久化，不会因重启自动开启处理。`audio-assistant/routes/` 保存路由恢复事务：播放器退出且端点静音已归还后仍保留应用输出设置的撤销信息，由守护在其下次自然播放时归还路由。安全延期与恢复异常根据既有记录与守护存活状态判定，不新增持久字段，也不因界面恢复正常而删除未完成事务。该目录与原 `tmp` 样品相互独立；入口 `enabled`/`placement`/`x`/`y`/`dock` 继续存于 [Admin 本机偏好](../frontend/app.md#6-组件与百宝箱)。

### 本地组件样式库

资源型配套样式的共享参数由样式库 `updateConfig` 在单次同步索引事务中修改：服务层合并补丁并经 `normalizeSceneConfig` 校验后原子替换索引，素材身份、路径、包摘要和文件不变，保存失败保留原索引。重启、同版本重新安装与软删除恢复均保留已保存值，新版本采用新包默认值。同 ID 的场景实例读取库中共享参数；软删除后仍可读保留索引的最后保存值但拒绝继续写入，重新导入可恢复。普通媒体/CSS 保留场景快照。

共享外观参数变更不批量重写已有场景，读取时以客户端已保存字段覆盖旧副本，布局保持独立：

- 时钟：`clockStyleOptions`（JSON 字符串，默认 `{}`）按内置时钟样式保存白名单外观字段，首次读取从旧标量设置补齐，旧标量写入只更新当前选中样式。
- 盲盒：`blindboxStyle`（默认 `'classic'`，可选 `'classic'` / `'porcelain'` / `'layers'` / `'prism'` / `'podium'`）、`blindboxOverlayTop`（-1–10，默认 3）、`blindboxWinnersOnly`（默认 `true`，旧 `hideLoss` 保留为兼容别名）、`blindboxHeartBoxOnly`（默认 `false`）、`blindboxOverlayTitle`（默认空串，回退“今日盲盒盈亏”）、`blindboxCompact`（默认 `'false'`，对应画布 `compact`）、`blindboxAutoPages`（默认 `'true'`，对应画布 `noScroll`）。心动盲盒专属参数：`blindboxCastleMultiplier`（默认空串隐藏倍数，非空为 0.01–1000、最多两位小数）、`blindboxCastlesRemaining`（默认 `'0'`，0–99999 整数，手动填写不随出堡扣减）、`blindboxShowCastlesRemaining` 与 `blindboxShowOpenedSinceCastle`（默认 `'false'`）；关闭心动盲盒筛选时隐藏专属展示但保留已保存值。字体、字重、字号比例与配色沿用现有通用主题键（其中 `porcelain` / `layers` / `prism` / `podium` 四款亮色背景适配样式使用内置配色，字体、字重与字号比例仍共享主题设置）。以上均复用现有 `settings` 表，无新表或迁移。

[component-style-store.js](../../../src/storage/component-style-store.js) 负责设备本机 `dataDir/component-library/`（不写云设置或礼物库）。`index.json` 格式为 `{version:1, packages:[]}`，写入同目录随机临时文件后原子重命名替换；媒体保存为 `<包 UUID>/<SHA-256>.<扩展名>`，网页保存为 `<包 UUID>/web/<原相对路径>`。场景独立外观配置持有互斥的 `mediaStyle`、`resourceStyle` 或 `cssStyle` 快照；HTML 导入保存为 `browser` 配置（可选 `category` 记录原分类），浏览器地址沿用加密保存与模板脱敏契约。

索引格式保持 v1。`component-style-index.js` 在主索引提交后同步保存副本 `index.backup.json`（副本失败仅报告恢复能力降级，不回滚主提交；旧库首次读取自动补齐副本）。主索引缺失、损坏或结构无效时从有效副本恢复，损坏原件保留为 `index.damaged-<UUID>.json` 并在 `index.recovery.json` 记录恢复提示；两份均不可用时返回不可用错误而不重建空库；高于支持版本的索引拒绝读取，不用旧副本降级。每包 `package.json` 仅为导入快照，后续参数以索引及恢复副本为准。

**索引缓存与只读快照**：

- 同一素材根目录共享已验证的索引缓存，每次读取核对主索引与副本的文件身份、大小与纳秒修改/状态时间，未变化时跳过磁盘读取与 JSON 解析。
- 全量 `read()` 返回独立副本；内部 `createStyleReader()` 创建时校验一次索引并返回按 `(id, type)` 取独立样式副本的读取函数，单次公共外观请求复用同一 reader 仅复制所选样式；类型与 ID 派生索引及 `listMediaStyleIds(type)` 均随已验证索引更新（含 `removed` 历史），礼物触发无需复制完整样式配置。
- 索引写入立即更新缓存；外部改动或文件缺失在下次读取时自动重新进入校验与恢复流程，副本降级期间持续尝试修复。

上传与 ZIP 检查仅写入 `.pending-<UUID>/`，确认时整目录重命名为最终 UUID 再原子更新索引（索引失败则移回暂存，操作失败或取消则清理暂存）。打开库时回收超过 24 小时且未被当前导入占用的暂存与索引临时文件（同目录每小时至多扫描一次；链接与锁定文件保留，未登记正式 UUID 目录保留供核对）。

相同作者 ID、版本与 ZIP 摘要的重复安装幂等，完整的已安装包直接复用主索引。缺失资源可从同一份 ZIP 补回，恢复包或成员的 `removed` 状态时复用原 UUID；同 ID 同版本不同内容返回冲突。安装标准素材包时在单次索引提交中将同 `packageId` 的其他已安装版本标记为 `removed`（含旧客户端留下的并存版本）。安装时按完整成员和同 `packageId` 的历史识别套装，多类别须来自同一个版本。备份包条目的可选 `isSuite` 保留已确认的套装身份，即使归档只带一个单分类版本，恢复后仍列为套装。

服务层 [component-style-install.js](../../../src/server/component-style-install.js) 统一安装重试：仅待确认目录移至正式目录遇到 `EPERM` / `EBUSY` 时最多重试 4 次（每次重新授权，不重放失败的索引事务或回滚）；存储层在临时索引写好后遇到这两类锁定错误仅同步重试原子重命名（最多 4 次、累计 ≤ 500 ms，避免并发写入插入当前事务，持续失败仍回滚）。清理后的同版本原包恢复与备份批量恢复采用相同重试上限。

已有场景不自动升级；库上限 1000 包。整包删除置包级 `removed`，逐样式删除保留成员级 `removed`，列表过滤这两类标记，均保留索引与媒体文件以确保未打开预设与已发布场景可用。文件与导入限制见 [API 契约](api.md#组件样式库)，样式字段见 [叠加层参考](../frontend/overlays.md#本地媒体样式)。

专用备份由 `component-library-transfer.js` 编排资源 ZIP，`scene-transfer.js` 仅导出当前账号的显示文档并生成新场景凭据，场景批量插入经 `scene-store.js` 的 savepoint 事务提交。归档参数取自最新索引，文件保留相对路径与 SHA-256。导出包含可见样式包，并按保存布局、发布布局和入选包配置中的实际文件地址收集依赖。`styleParameters` 可以保留已换下样式的参数键，这些键不引入素材包。

恢复时按归档摘要与来源 ID（场景另含当前账号 scope 摘要）确定性重映射 ID。文件引用和归档内包、样式对应的参数键使用新 ID，其余历史键、正文和文件名保留原文。重复恢复不覆盖既有副本上的修改，素材包名加「备份」且作者 ID 使用 `backup.` 命名空间。恢复流程先登记隐藏素材、再事务创建未发布场景、最后完成带 `restorePending` 标记的新包登记。中断后可用同一备份续作。用户移除整包时清除此标记，再次恢复可补回布局所需文件并保留移除状态。恢复布局的标题后缀只在最终存储文档（含加密网址）仍满足 256 KiB 上限时追加。恢复副本单独保存，不覆盖原直播绑定、原场景与凭据；外部浏览器源、本地加班机背景路径、未保存草稿与业务数据不导出。

场景副本删除后，为保留固定直播源而留下的 `isPreset=false` 记录不计为已恢复场景。恢复遇到该记录时使用稳定的替代场景 ID，之后重复恢复复用该副本并保留其修改；原输出记录、绑定及凭据不变。确定性 ID 算法由 `scene-transfer.js` 提供，归档映射共用同一算法。

`component-library-maintenance.js` 盘点实际磁盘体积（单次盘点构建已登记目录集合，不跨请求缓存）。手动清理复核全部账号的保存/发布文档、预览配置与待处理编辑命令，保留可见样式依赖；缺失在用资源、索引故障、恢复副本不可写、引用解密失败或目录符号链接均阻止清理。仅整包或全部成员已移除且无引用的目录可回收：先重命名为 `.purged-<UUID>` 再删除，保留索引中的历史身份、参数与分类（重新导入相同 ZIP 可补回原 UUID 文件）。

### 文件回收

[file-retention.js](../../../src/shared/file-retention.js) 仅回收由各模块明确声明归属且命名匹配的普通文件，逐级拒绝符号链接目录，并在删除前再次核对文件身份、大小与修改时间。未知名称、符号链接、受保护文件及锁定文件一律保留，回收失败不阻断正常使用。不对整个 `data/`、`browser/`、数据库、账号凭据或音频路由恢复记录执行容量淘汰。

| 内容 | 触发及保留规则 | 归属模块 |
| --- | --- | --- |
| 文本框上传图片、开播音乐与角色素材 | 上传、清空选择或访问素材管理时检查，每个数据目录每小时至多一次；仅回收命名匹配、超过 30 天且无引用的文件。被引用文件每日至多刷新一次修改时间，`.tmp` 残留保留 24 小时；设置提交失败仅删本次未选中的新上传 | [uploaded-media-retention.js](../../../src/server/uploaded-media-retention.js)、[opening-service.js](../../../src/server/opening-service.js) |
| 礼物图片 | 复用初始化完成后的完整目录检查，每小时至多一次；保护当前目录、历史 last-good 映射、全账号场景/素材配置、未保存预览、在途下载与近期文件。无引用生成文件 30 天后回收；总量超过 512 MiB 时额外淘汰至少 24 小时未用的最旧候选（受保护与近期文件可超预算，不牺牲离线回退）。索引不可读且已有图片时本次进程停止淘汰 | [remote-gift-image-cache.js](../../../src/bilibili/gift/remote-gift-image-cache.js)、[gift-catalog-initializer.js](../../../src/bilibili/gift/gift-catalog-initializer.js) |
| 礼物缓存临时文件 | 缓存实例创建时回收超过 24 小时、符合原子写入命名的临时文件，不清理未知 `.tmp` | 同上 |
| 公共资源下载残留 | 初始化或显式重试时清理超过 24 小时的临时文件与字体下载 ZIP；正式摘要文件、旧版本 URL 与旧字体兼容缓存保留 | [resource-library.js](../../../src/resources/resource-library.js) |
| 音频组件 | 准备时检查 `.prepare-*` 和替换残留，目录及子项均超过 24 小时且无链接时回收。当前组件就绪后按[音频组件文件](#音频组件文件)回收闲置旧版。路由恢复记录独立保存 | [audio-component-files.js](../../../src/electron/audio-component-files.js) |

[local-asset-references.js](../../../src/server/local-asset-references.js) 汇总全账号场景草稿/发布文档、预览配置、在途命令、本机设置与素材库配置的全部引用；任一引用或索引不可读、存在未完整获取的未保存修改、素材导入或备份在途时保守跳过。文本图片备份另对实际图片路径加占用保护至流结束。自动维护不触发任何服务器/CDN 请求，也不改变素材包的显式清理入口。

## 3. 六库 × 表清单

业务表见下表，各库另有一张 `schema_version`。文件常量 `DB_FILE_NAMES`、原五库 DDL 与抽奖库 DDL 分别位于 [database.js](../../../src/storage/database.js)、[schema.js](../../../src/storage/schema.js) 和 [dynamic-lottery-schema.js](../../../src/storage/dynamic-lottery-schema.js)。

### 3.1 `song-request-data.db`（点歌库，27 表）

包含下方 20 张表与下文“粉丝档案”专列的 7 张表（含 v14 名单模板表）。

| 表 | 用途 | 关键列/索引 |
| --- | --- | --- |
| `settings` | 全部设置键值（`key`/`value`/`updated_at`），见 §7 | `key` PK |
| `ai_configuration` | AI 配置、凭据及角色包（与 `settings` 隔离） | `key` PK、`is_secret` 标记；`personaPacks`、`personaId`、`providerPersonaIds`、`systemPrompt` 等，详见 [ai.md](ai.md) §7 |
| `ai_request_logs` | AI 请求审计日志 | `uid`/`user_name`/`category`/`status`/`latency_ms`/`input_tokens`/`output_tokens`/`tool_calls`/`error_code`；`idx created_at` |
| `ai_api_usage` | 第三方 API 月度配额计数 | `PK(category, month_key)`、`request_count`（回收生命周期见 §5） |
| `ai_viewer_context` | 观众短期多轮对话 | `uid` PK 存可信房间/观众/人格作用域摘要；payload v2 含 `sessionId`/`exchanges`/`truncated`，`expires_at` 为到期时间，详见 [ai.md §3.3](ai.md#33-连续互动与空闲清理) |
| `ai_query_cache` | 查询缓存 | `cache_key` PK、`expires_at` |
| `ai_blacklist` | 历史 AI 黑名单，继续供运行时读取 | `uid` PK、`reason` |
| `song_categories` | 曲风 | `name` UNIQUE、`sort_order`、`is_enabled` |
| `songs` | 曲库 | `name`/`name_pinyin`/`name_initial`/`artist`/`category_id`/`tags`/`language`/`source_platform`/`request_price`/`song_clip`/`original_group`；唯一索引 `idx_songs_name_artist(name, artist)`（v3） |
| `queue` | 当前点歌队列（处理、移除或清空时物理删除） | `song_id`(FK)、`requester_*`、`source`、`status`、`is_pinned`/`pinned_at`、`is_live`（默认 0，部分唯一索引限制至多一条 LIVE）；`idx(status, is_pinned, pinned_at, created_at)` |
| `requests` | 活动队列点歌信息（随队列同步删除） | `queue_id`/`song_id`(FK)、`message`、`stable_id`、`owner_scope`、`identity_type`、`fan_recorded`；`idx created_at`、`idx(requester_uid, created_at)`、`idx song_name`、`idx_requests_queue_id` |
| `random_request_history` | 随机点歌最近 10 首避重及最近可识别点歌人（至多 11 行） | `request_id` PK、`song_name`、`requester_uid`/`requester_name`、`source`、`created_at`（与随机入队同事务更新） |
| `import_batches` | 兼容旧库的批量导入摘要 | 不再新增，已有行由保留期维护清空 |
| `theme_presets` | 主题预设（外观键收成一行一套） | `name` UNIQUE、`scope`、`payload`、`is_builtin`；`idx(scope, sort_order, id)` |
| `song_request_daily_counts` | 观众每日成功点歌次数 | `PK(owner_scope, request_day, identity_type, requester_uid)`、`accepted_count`（`request_day` 为北京时间日期）；队列事务内校验递增并清理同账号过去日期；清队列/歌库保留，清全部删除 |
| `song_cooldowns` | 单曲冷却（独立于队列与歌库 ID） | `PK(owner_scope, song_key)`、`accepted_at_ms`；入队同事务写入，清队列/歌库保留，清全部删除；维护仅删严格早于 999 天的记录 |
| `user_cooldowns` | 用户点歌冷却（重启从 DB 恢复，防绕过） | `user_key` PK（v2 键含 `fanScope`、身份类型与稳定 ID）、`last_request_at`、`request_count`；仅恢复最近 24 小时且不晚于当前时间的行 |
| `component_scenes` | 本地场景草稿、发布快照及来源凭据 | `owner_scope` 隔离、乐观 `revision`、加密 `capability`（详见下方“本地场景持久化”） |
| `component_output_sizes` | 按账号保存共享组件默认尺寸 | `PK(owner_scope, component_type)`、`width`/`height`（与发布快照原子提交） |
| `component_canvas` | 固定组合直播源与最近应用的预设 | `owner_scope` PK、`output_scene_id`、可空 `active_scene_id` |
| `danmaku_appearances` | 当前授权账号的本地弹幕完整外观 | `owner_scope` PK、`config_json`（最大 256 KiB，独立于全局 `settings` 与场景草稿） |

#### AI 与加班机存储适配器

- [ai-state-store.js](../../../src/storage/ai-state-store.js) 由 `server/ai-runtime.js` 在 `songDb` 上创建并注入 AI 配置领域，负责配置、请求日志、黑名单、会话与查询缓存的 SQL；配置与平台人格映射同事务写入，提交前交领域校验，异常回滚。自动接话开关 `autoReplyEnabled` 与 `autoReplyMentionEnabled` 复用 `ai_configuration` 普通布尔行（缺省 `false`），行为详见 [ai.md §3.4](ai.md#34-自动接话)。
- [overtime-store.js](../../../src/storage/overtime-store.js) 由 `server/domain-services.js` 在 `giftDb` 上创建并注入加班机服务，负责状态、规则、结算与 `BEGIN IMMEDIATE` 事务；计时器与恢复调度由领域服务管理，详见 [overtime.md](overtime.md)。

#### 歌库显式更新事务

`songStore.applyImportUpdate(buildPlan)` 在单事务内读取完整歌曲与曲风，将稳定行对象交音乐域计划器重新校验预览，再执行计划的 INSERT/UPDATE（整份替换同时 DELETE 未列歌曲）。匹配歌曲保留 ID 与引用，删除歌曲先解除 `queue`/`requests` 的 `song_id` 关联并保留点歌文本；曲风目录、歌曲变更、引用解除与云同步待传快照同事务提交或回滚。`importRows`、`applyImportUpdate` 与 `replaceAll` 在单事务内按曲风名复用曲风行并复用预编译语句，批量入口不逐首回读已插入行。导入计数仅经实时响应返回，不再写入 `import_batches`；预览令牌含完整歌曲/曲风内容、时间戳与导入选项（见 [点歌资料规范](../../../specs/song-request-metadata.md)）。

#### 本地场景持久化

- **弹幕外观（songDb v17）**：`migrateDanmakuAppearance` 新增 `danmaku_appearances(owner_scope, config_json)`；`danmaku-appearance-store.js` 按授权 Server origin + `streamerId` 原子 upsert 单份完整外观 JSON（≤ 256 KiB）。首次成功读取迁入旧远端配置，失败不写默认值，已有本地行不再接受远端覆盖；重启与切号读取各自配置，退号不删记录。
- **文本框图片**：由 [scene-text-images.js](../../../src/server/scene-text-images.js) 存于 `dataDir/scene-text-images/`（UUID v4 文件名，限 `png`/`jpg`/`gif`/`webp`，单文件 ≤ 5 MiB，原字节保留动画，临时文件原子重命名）。文本框的结构化图片节点（token）仅保存本地图片路径，不保存原始磁盘路径或二进制内容；删除节点或放弃草稿时不立即删除素材，避免破坏已发布场景引用，无引用旧文件遵循 [文件回收](#文件回收)，接口见 [HTTP API](api.md#本地场景)。
- **场景与输出表（songDb v8–v11）**：
  - v8（`scene-migration.js`）新增 `component_scenes`（`id`、`owner_scope`、`draft_json`、`revision`、`published_json`、`published_version`、`capability_version`、`capability_hash`、`capability_encrypted`，草稿与发布 JSON 各 ≤ 256 KiB）；`scene-store.js` 以带归属与期望版本条件的 `UPDATE … RETURNING` 原子提交。展示查询每次读取 `published_version`、`capability_hash` 和正文标识 `body_token`。每个 store 按账号与场景最多缓存 32 份深冻结发布文档，首次读取或标识变化时才从 SQLite 取出 `published_json`；每次请求与 SSE 心跳均重新核验归属、凭据、版本与投影令牌，异步展示数据准备完成后再单独查询一次当前 `capability_hash` 复核，不缓存认证结果，对外返回独立副本。
  - v9 新增 `component_output_sizes(owner_scope, component_type, width, height)`（32–7680 px，限 `clock`/`queue`/`overtime`/`danmaku`），`scene-store.publish` 用 savepoint 事务与发布快照原子提交，删图层不删默认尺寸。
  - v10 新增 `component_canvas(owner_scope, output_scene_id, active_scene_id)` 固定组合直播源并记录最近应用预设；画布发布在单 savepoint 中校验预设修订号与输出发布版本，提交发布快照、活动预设与共享尺寸，不覆盖原草稿，跨预设浏览器 URL 按固定输出场景 ID 重新加密绑定。
  - v11 为 `component_scenes` 追加 `is_preset`（0/1，默认 1）并令 `component_canvas.active_scene_id` 可空；删除固定输出预设时将其标为 0 并清空草稿图层（仅保留固定来源与发布职责），`scene-store.delete` 在 savepoint 中切向替代预设或发布透明空文档并将 `active_scene_id` 置空。
- **凭据与浏览器 URL 加密**：`capability_hash` 为随机 256 位令牌的 SHA-256，`capability_encrypted` 经 `safeStorage` 加密绑定 schema、归属、场景 ID、凭据版本与令牌包，**不支持明文降级**，解密后复核全部绑定与摘要。独立 `browser` 场景项的第三方 URL 写入前同样经 secret codec 加密为 `{ schemaVersion: 1, encrypted }`（绑定归属、场景 ID 与 item ID），模板与编辑恢复副本不保留 URL。边界见 [ADR-0022](../../architecture/adr/0022-local-component-scenes.md) 与 [组件场景规格](../../../specs/component-scenes.md)。

<a id="粉丝档案songdb-v6-新增六表"></a>

#### 粉丝档案（songDb v6 新增六表 + v14 模板表）

`fan-profile-migration.js` 在 `songDb` 迁移事务内建立粉丝档案表组；`fan-profile-store.js` / `fan-record-store.js` 负责 SQL，`src/fans/` 负责领域规则：

| 表 | 职责与约束 |
| --- | --- |
| `fan_profiles` | UUID 主键；scope 为规范 Server origin + 已认证 `streamerId`；`scope + typed identity` 唯一；JSON 与乐观 `revision` |
| `fan_records` | 档案外键级联；UUID、`scope + source_key` 唯一；歌曲仅保存汇总，其余类型保存原始事实、当前数据与修订。只改会员依据说明时保留原采用决定。合并草稿时，与目标已采用依据冲突的移入记录标记为 `pending`，保留双方原始依据 |
| `fan_roster_templates` | v14 新增；按 scope 隔离，未编辑的自动名单观察共享相同 `data`/`original`；时间与来源键仍逐条存于 `fan_records`，末引用移除后回收模板 |
| `fan_reminder_states` | `scope + profile + item_key` 唯一；保存已处理、忽略、稍后与事项来源 |
| `fan_scopes` | 自动设置、epoch/cursor（事实与游标同事务提交）；可选 `autoSyncGuardRoster`（默认 `false`）、`lastGuardRosterAutoUpdate` 与成功的自动名单导入同事务保存。`date` 为北京时间日期，`roomId` 为正式房号。配置短号与正式号不同时另存已核对的 `configuredRoomId`。同归属当天匹配其中任一房号即跳过自动同步，旧标记按正式房号匹配；可选 `accompanyMilestones` 与 `showAccompanyInCalendar` |
| `fan_suppressions` | 当前 scope 黑名单的最小 typed identity 标记；屏蔽档案展示与写入 |
| `fan_restore_snapshots` | scope 内恢复/合并前的完整快照，仅保留最新两份；操作校验归属与完整格式，创建、裁剪与恢复/合并同事务 |

- **档案 JSON 扩展字段（无 SQL schema 变更）**：复用 `nameHistory` 并支持可选 `lastEntry: {name, observedAt}`、`preferredFormerName`、`excludedFormerNames`（最近进房名、默认展示与人工移除名单）；可选 `guardAccompany: {days, roomId, observedAt, source}` 平台陪伴观察（预计日历事项仅作内存投影，处理状态存 `fan_reminder_states`）；可选 `guardRoster: {roomId, ownerUid, observedAt, level}` 最近完整名单身份（`level` 为 1/2/3 或明确缺席时的 `null`，未知/跨房/迟到快照不覆盖较新已知身份）。均兼容 v1/v2 备份，详见 [粉丝档案规格](../../../specs/fan-profiles.md)。
- **索引与投影查询**：songDb v15 新增 `idx_fan_records_profile_id` 与 `idx_fan_reminder_states_profile_id` 支撑外键级联删除。`fan-profile-store.list(scope)` 默认排除黑名单（完整备份显式传 `{includeSuppressed: true}`）。列表、提醒与日历经 `records.listProjectionInputs` 分批读取所需最小字段，在“提醒所需最早日期与有效名单快照时间”较早边界之前，同一档案与自动名单模板仅取最近一次标准 UTC 观测；详情、修改、合并与备份读取完整历史。非歌曲记录保存先核乐观 `revision`，无实质变更时不追加空修订或展开模板。
- **点歌汇总与自动清理（songDb v13 / v14）**：`requests` 保存 `stable_id`、`owner_scope`、`identity_type` 与 `fan_recorded`，普通点歌入队、更新档案歌曲汇总与标记已归档同事务提交（切号后延迟请求置空 `owner_scope` 并跳过归档、每日次数与冷却；队列终态删除不扣减已归档次数）。v13（[fan-song-migration.js](../../../src/storage/fan-song-migration.js)）将同档案规范化歌名/歌手的 `song` 合并为单条汇总（含 `count`、最近 3 个上海日期 `recentDates`、`dailyCounts` 与合并手记，规则见 [song-summary.js](../../../src/fans/song-summary.js)）；读写、导出与保留维护自动清理早于上海近 30 天的 `dailyCounts`。v14（[fan-roster-observation-migration.js](../../../src/storage/fan-roster-observation-migration.js)）通过可空 `roster_template_id` 对未修订自动名单观察做无损去重，编辑时在事务内展开。档案表不参与 `clearAllData`；自动恢复点每 scope 保留两份（[fan-snapshot-retention.js](../../../src/storage/fan-snapshot-retention.js)）。
- **完整备份与替换**：
  - 导出 `lira-fan-profiles` v2 前先核对 [恢复容量与数量预算](../desktop/preload.md#5-粉丝档案-action-与-dto)（超限不生成文件，内部自动恢复点不受外部预算限制），导入兼容 v1 并转换逐次歌曲为汇总。
  - 歌曲 `data.mergedRecordIds?: string[]` 保留被吸收汇总的稳定 ID。压缩 v1 逐次记录时，每组以现有记录 ID 为代表，另存归属范围、原档案与规范化歌名/歌手的组标记，以及与代表不同的最早记录 ID。还有其他记录时加存排序后 ID 集合的摘要。常规点歌只更新汇总。`merges[].songsTracked: true` 表示合并时保留了汇总身份，后续合并继承双方历史。旧合并的 `sourceId` / `mergedAt` 仍用于兼容判断。上述凭据均复用现有 JSON。整组覆盖、部分重叠及旧资料的恢复规则见[粉丝档案持久化契约](../../../specs/fan-profiles.md#持久化契约)。
  - `keep` 按记录 ID、稳定来源键及歌曲合并身份保留本机内容与归属；备份中的屏蔽标记不改变现存本机档案的可见性，新导入档案仍接受其备份标记。`replace` 按备份恢复冲突档案及其记录归属，可新增屏蔽，但两种方式均不解除当前黑名单。预览字段见 [preload.md §5](../desktop/preload.md#5-粉丝档案-action-与-dto)。
  - 恢复前校验数据与预览摘要并保存恢复点；完整替换在单事务内先验导入集合与保留档案的身份唯一性，再经 `removeMany(scope, ids)` 分批删除批准替换的档案，仅清理一次无引用名单模板后写入新数据（支持档案间 UID 互换），失败连同恢复点创建与裁剪整体回滚；其他账号不受影响。

### 3.2 `super-chat-data.db`（醒目留言库，2 表）

| 表 | 用途 | 关键列/索引 |
| --- | --- | --- |
| `super_chats` | 仍在显示的 SC | `platform_id`、`price` REAL、`status`(`active`/`assisted`)；`idx(status, created_at)`、`idx created_at` |
| `super_chat_receipts` | 已移除 SC 的最小防重标识 | 仅 `platform_id` 主键，无正文、昵称、金额、用户资料或时间 |

v2 的 [superchat-receipt-migration.js](../../../src/storage/superchat-receipt-migration.js) 将旧 `deleted` 行转为防重 ID 并清除正文，保留 `active`/`assisted` 项。删除触发器在同事务写入防重 ID（覆盖手动删除、平台撤回、清空与按天清理，无平台 ID 不留记录）；平台撤回早于原消息到达时同样记录防重 ID 以防迟到包重新入库。防重 ID 不按天清理，清库操作亦保留。

**SC 10 秒可撤销删除**：手动删除立即删除数据库行并写入防重 ID；`superchat-undo.js` 仅在内存中保存当前 10 秒批次的原记录。`superchat-store.restoreDeleted()` 在单事务内恢复原 ID、正文、处理状态与时间，同时移除该批次的防重 ID（任意一行失败整批回滚）。仅接受服务端捕获且未过期的批次，平台撤回与整库清空不可通过此路径恢复，无新增表或持久化格式。

历史数据由 `migrateLegacySuperChatsToDedicatedDatabase` 从 `songDb` 旧表迁入后删源表（[legacy-superchat-migration.js](../../../src/storage/legacy-superchat-migration.js)）：有平台 ID 按平台 ID 与撤回凭证去重，无平台 ID 按 UID、正文、创建时间与规范化金额去重；目标事务失败时保留源表。

### 3.3 `gift-data.db`（礼物库，17 表，含 §9 礼物保留表）

| 表 | 用途 | 关键列/索引 |
| --- | --- | --- |
| `gift_sources` | 远端主播来源字典 | `source_key` 唯一；渲染进程不接收或选择内部 `id` |
| `gift_events` | 礼物事件 + **共享检测账本**（见 [bilibili/gift.md](bilibili/gift.md)） | 业务列 + `source_id` + 检测列；可空 `blind_box_id`、`gift_variant_id`、`blind_box_variant_id`；legacy 索引 `(platform_id, uid)`，远端幂等索引 `(source_id, platform_id, cmd)`，来源/时间复合索引 |
| `gift_sync_state` | 每个来源的投影恢复状态 | `source_id` PK、epoch/final cursor、bootstrap token/锚点、`projection_generation`、最后验证时间 |
| `overtime_machine_state` | 加班机单例状态 | **id=1 CHECK 单行**；`enabled`/`enable_epoch`/`initial_seconds`/`remaining_ms`/`anchor_at_ms`/`status`(`paused\|running\|finished`)/`background_path`/`background_fit`/`revision`，见 [overtime.md](overtime.md) |
| `overtime_gift_rules` | 加班机礼物规则 | `(gift_id, gift_identity_key)` 复合主键、`gift_identity_json`、`mode`(`fixed\|random\|display`)、`fixed_seconds`、`outcomes_json`、`enabled`、`sort_order` |
| `overtime_settlements` | 结算流水（幂等） | `gift_event_id` **UNIQUE**、`status`(`pending\|applied\|ignored`)、`rule_snapshot_json`、`requested`/`applied_delta_seconds`、`settle_after_ms`、`retry_count`；`idx(status, settle_after_ms)`、`idx(status, id DESC)`。giftDb v27 以 `settled_order` 记录实际完成顺序，终态行按 `(settled_order DESC,id DESC)` 读取。升级时按 `updated_at,id` 回填旧终态行，待结算行为 0 |
| `gift_wishes` | 礼物许愿定义 | `id` PK、`source_id` FK、`period`(`long`/`day`/`session`)、礼物/variant 身份、类别、展示图片、整数 `target`、说明与创建时间、`display_style`（默认 `card`）、`text_template`、`text_image_position`、`text_image_format`、`text_pending_color`/`text_received_color`、`text_runs`（默认 `[]`）；来源/创建时间索引 |
| `gift_wish_sessions` | 最近确认的直播窗口 | `source_id` PK/FK、`room_id`、`started_at`、可空 `ended_at`、`checked_at`（`ended_at` 记下播前最后确认在线时间，不代表实际下播时间） |
| `heart_box_collection_adjustments` | 心动盲盒本期校准 | `source_id` PK/FK（删除来源级联）、`starts_at`（北京时间周六 ISO 起点）、`adjustment`（整数差额）；每来源仅留最近一次校准，不改写礼物事件（`heart-box-collection-store.js`，giftDb v23） |
| `gift_wish_contributions` | 许愿非整日精确贡献（v22 重置后不再写入） | `wish_id` FK（删除级联）、`source_id` FK、`sync_epoch`、`platform_id`、`created_at`、`num`；主键 `(wish_id, sync_epoch, platform_id)` |

**礼物存储适配器边界**：礼物投影的数据库读写由 `gift-projection-store.js` 负责，复用调用方已开启的历史/游标事务；统计投递由 `gift-statistics-store.js` 负责，通过独立的 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 事务原子检查并标记已投递。两个适配器不向领域层暴露数据库句柄或 statement，领域校验与扇出见 [bilibili/gift.md §3](bilibili/gift.md#3-历史导入与存储边界)。许愿状态存储由 `gift-wish-store.js` 负责（giftDb v13–v16、v19 幂等建表与加列），进度与今日数量实时从账本计算，不持久化今日收礼状态或首帧 PNG。

### 3.4 `music-data.db`（播放器库，5 表）

`play_queue_state.payload` 保存客户端提交的快照 JSON；曲目试听元数据、播放位置和旧快照恢复兼容由[播放状态持久化](../frontend/playback.md#6-状态持久化play_queue_state)维护，不增加数据库列或迁移。

`play_queue_state.payload` 的 `snapshotVersion` 保存最后接受的 `writerId`/`generation`/`senderGeneration`/`sequence` 及已分配页面代次的高水位，无 SQL schema 变更。领取代次与保存校验均在 `BEGIN IMMEDIATE` 事务内执行：领取不推进已接受版本，仅新页面实际保存才推进门槛；单独清除队列保留排序元数据（仅元数据时读取返回空），防止旧版本重放复活队列；接受版本化快照后禁止无版本降级（接口契约见 [api.md](api.md) §5）。

全清空与兼容 `clearPlaybackData` 均经 `clearAllQueueStatesInTransaction` 在调用方持有的 `musicDb` 事务内移除各 client 业务快照，保留已发放代次高水位并以 `max(高水位, 已接受代次, 1)` 及新 `writerId` 写入仅元数据的撤销记录，拒绝清空前已保存及已领取未使用的旧 writer（回滚则恢复原快照与写入资格）。

| 表 | 用途 | 关键列/索引 |
| --- | --- | --- |
| `play_history` | 播放历史 | `client_id`/`track_key`/`source`/`track_id`/`play_count`/`played_at`；唯一 `idx(client_id, track_key)` |
| `play_queue_state` | 播放队列快照（按 client 存 payload JSON） | `client_id` PK |
| `favorites` | 收藏 | `track_key` UNIQUE、`sort_order` |
| `playlists` | 歌单 | `name` UNIQUE、`sort_order` |
| `playlist_tracks` | 歌单曲目 | `FK playlist_id ON DELETE CASCADE`；唯一 `idx(playlist_id, track_key)` |

### 3.5 `checkin-data.db`（签到库，1 表）

| 表 | 用途 | 关键列/索引 |
| --- | --- | --- |
| `checkin_users` | 旧签到用户（只读兼容） | `uid` PK、`total_days`、`first`/`last_checkin_at`、`last_checkin_date`；`idx last_checkin_date` |

### 3.6 `lottery-data.db`（动态抽奖库，9 表）

三个抽奖 store 经 `dynamic-lottery-transaction.js` 复用同步事务包装：BEGIN 失败直接抛出，操作或 COMMIT 失败尝试一次 ROLLBACK 并重抛原错误（ROLLBACK 也失败时附加 `rollbackError` 不覆盖原 cause）。候选资格与人数统计通过 `getEvidence(scanId, {includeContent: false})` 仅读最小字段并按 `total_changes()` / `PRAGMA data_version` 缓存一份当前候选人数；结果查询仅在 `paused` 状态查找最后暂停事件。

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `lottery_tasks` | 活动身份、动态目标、规则和状态 | `task ID` PK；创建 `requestId` 在 streamer 范围唯一；UID/动态 ID 均为 TEXT |
| `lottery_scans` | 截止后正式采集批次与来源检查点 | `task` FK；页游标、覆盖状态与读取数保存在同一 source state |
| `lottery_evidence` | 最小互动证据及评论展示信息 | `PK(scan, source, recordId)`；可空 `display_name`（≤256 字符）存采集时昵称，与下一游标同事务提交 |
| `lottery_rounds` | 冻结规则、名单摘要、算法版本与结果版本 | `task`/`scan` FK；`revision` 单调递增 |
| `lottery_round_members` | 每轮冻结 UID 与基础资格 | `PK(round, uid)`；不承载唯一领奖状态 |
| `lottery_orders` | 初抽/补抽的不可变候选顺序与推进位置 | `UNIQUE(round, scope, generation)`；顺序先落盘再核验 |
| `lottery_awards` | 独立授奖、领奖与替补关联 | 同奖项 UID 唯一；每个有效名额至多一条 active 记录 |
| `lottery_events` | 当前活动事件及已清理活动的创建回执 | streamer 范围 `requestId` 唯一；`create-retired` 仅留请求 ID/摘要，不关联旧任务或轮次 |
| `lottery_request_budget` | 本机/账号滚动请求预算与冷却 | `scope` PK；活动删除不重置 |

抽奖库仅存最小业务证据，不存 Cookie、认证头或完整上游响应。`dynamic-lottery-store.js` 管理分页证据与游标的 `BEGIN IMMEDIATE` 事务；`dynamic-lottery-budget-store.js` 复用三条预编译语句，在请求出站前同事务预留本机与账号预算。`dynamic-lottery-draw-store.js` 读取完整冻结顺序时，按当前 order ID 与 `order_json` 原文复用解析结果。逐候选的 `recordCheck({includeOrder: false})` 在同一事务中从 SQLite 取游标处的 UID 和名单长度，核对后原子推进授奖与游标。读取进度和结果时，整份顺序留在 SQLite 内。

抽奖私有 `streamer_id`、创建回执与账号预算 scope 使用主进程派生的服务器 origin + 账号编号 namespace（算法见 [auth.md §14](../desktop/auth.md#14-动态抽奖专用账号)），本机预算仍按整台安装共享；旧无 origin 数据保留，不自动映射。

- **历史清理**：创建新活动时在同事务调用 [dynamic-lottery-retention.js](../../../src/storage/dynamic-lottery-retention.js) 清理同 namespace 已完成或候选耗尽的旧活动及其级联数据（创建失败回滚）；runtime 首次取得或切换可信 scope 时按登记顺序（SQLite rowid）保留最新活动结果并清理其他已结束活动（暂停活动保留）。旧创建请求保留 `create-retired` 回执（同参数重试返回 `LOTTERY_TASK_CLEARED`，不同参数报冲突）。原五库清理入口不覆盖抽奖库，抽奖历史由活动生命周期维护，请求预算独立保留。
- **结果展示（v2）**：抽奖库 v2 追加可空 `lottery_evidence.display_name TEXT`（≤256 字符，旧行保持 `NULL`，不回源补查）；中奖结果通过 round 的 scan 与 member 的 `source`/`recordId`/`uid` 精准读取对应昵称与评论（前端缺失昵称时回退 UID）。
- **客户端交集与开奖事务**：`commitPages` 同事务提交点赞/转发共用页并用已见游标防分页循环（评论按事件时间截止，reaction 保持 `occurred_at_ms = NULL`）；冻结规则与全量随机顺序同事务落盘，资格确认、授奖与 `next_index` 同事务推进。`rules` JSON `version: 2` 固定单一中奖人数与三条件，旧版本活动不套用新流程续抽。

## 4. Schema 迁移系统

`runMigrations(db, key, steps)`（[schema.js](../../../src/storage/schema.js)）以 `steps` 数组下标 `+1` 为版本号，**仅允许末尾追加**，每步独立事务（失败回滚并抛错）。版本只升不降，库版本高于当前代码时抛 `DATABASE_SCHEMA_TOO_NEW` 拒绝降级启动；无版本表的旧库视为 v0，读取失败不当作空库升级。

原五库迁移由 [database-migrations.js](../../../src/storage/database-migrations.js) 注册执行，抽奖库由 [dynamic-lottery-migrations.js](../../../src/storage/dynamic-lottery-migrations.js) 独立注册执行：

| 库 | key | 版本 | 步骤内容 |
| --- | --- | --- | --- |
| `songDb` | `song_db` | v1–v23 | v1 列补全（`tags`/`language`/`source_platform`/`original_group`、`pinned_at`、`requester_*`）；v2 `seedThemePresets`；v3 清理重复 `(name, artist)` 后建唯一索引；v4 补 `songs.request_price`；v5 补 `songs.song_clip`；v6 建六张粉丝档案表及 `requests` 稳定标识/归属列；v7 建 `idx_requests_queue_id`；v8 建 `component_scenes`；v9 建 `component_output_sizes`；v10 建 `component_canvas`；v11 加 `is_preset` 且 `active_scene_id` 可空；v12 建账号隔离 `song_cooldowns`；v13 汇总粉丝歌曲与恢复点、加 `requests.fan_recorded` 与 `random_request_history` 并清旧终态队列/流水；v14 建 `fan_roster_templates` 无损去重自动名单；v15 建粉丝记录/提醒 `profile_id` 索引；v16 加 `queue.is_live` 及单 LIVE 部分唯一索引；v17 建 `danmaku_appearances`；v18 修正 F–L 拼音界标重算 `name_pinyin`/`name_initial`（不触发云同步）；v19 建 `song_request_daily_counts`。v20 为点歌汇总和两张 AI 过期表添加清理索引。v21 为 `component_scenes.published_json` 和 `danmaku_appearances.config_json` 增加行级 `body_token`。SQLite 触发器在插入、重插和正文改写时更新标识，迁移给已有行补齐标识。v22 校正旧 H 拼音界标下被分入 G 的歌曲，保留业务字段与修改时间。v23 为 `component_scenes` 增加 `published_shared_ids`，与发布快照在同一事务写入。旧记录初值为 `[]`，下次发布时记录共享图层 ID |
| `superChatDb` | `super_chat_db` | v1–v3 | v1 基线；v2 建最小防重 ID 表 `super_chat_receipts`，转换旧 `deleted` 行并覆盖后续删除路径。v3 给有效记录的 `platform_id` 添加查重索引 |
| `giftDb` | `gift_db` | v1–v26 | v1 `ensureGiftColumns`；v2 `platform_id` 索引；v3 `collapseDuplicateGiftIdentities` + 唯一索引 `(platform_id, uid)`；v4 **检测账本升级**（`ensureGiftDetectionColumns`）；v5 插加班机单例行（`id=1`）；v6 扩加班机时长上限；v7 放开 `display` 规则模式；v8 增来源分区、同步状态与远程约束索引；v9 补可空 `gift_events.blind_box_id`；v10 **礼物身份升级**（[ADR-0014](../../architecture/adr/0014-gift-identity-bound-overtime.md)：`gift_events` 增可空 `gift_variant_id`/`blind_box_variant_id`，`overtime_gift_rules` 增 `gift_identity_key`/`gift_identity_json` 并将主键升级为 `(gift_id, gift_identity_key)`，旧无身份规则保留等待重选，`settlements` 不迁移不回放，图片索引升级 schema 2 按 `variantId` 回退）；v11 补可空 `avatar_url`/`guard_level`（0–3）；v12 建 `source_recent` 与 `source_time_asc` 索引；v13 建 `gift_wishes`/`gift_wish_sessions`；v14–v16 补许愿样式、文字模板、图片位置/格式与颜色；v17 建礼物保留快照/日汇总/去重键/本机归档/冲刺结转（见 §9）；v18 建保留快照双状态时间索引；v19 补许愿 `text_runs`；v20 建 `gift_wish_contributions`；v21 补本机盲盒归档可空 `occurred_at` 及索引；v22 建立一年礼物保留分层并执行一次性旧投影重置（见 §9）；v23 建 `heart_box_collection_adjustments`；v24 建远端最近记录 `idx_gift_events_remote_recent` 表达式部分索引（仅加索引，不改写数据）。v25 为当前轮次的终态加班礼物及仍含原始 JSON 的记录添加部分索引。v26 在迁移事务中重建 `idx_gift_events_source_recent` 和 `idx_gift_events_remote_recent`，按 UTC 毫秒排序 |
| `musicDb` | `music_db` | v1 | 基线 |
| `checkinDb` | `checkin_db` | v1 | 基线 |
| `lotteryDb` | `lottery_db` | v1–v2 | v1 建九张抽奖业务表与唯一/查询索引；v2 为 `lottery_evidence` 增可空 `display_name TEXT`（独立失败边界，不加入原五库事务） |

初始化固定按序执行：五库只读版本准入 → 打开可写连接设 PRAGMA → 基础表 DDL → 不可变迁移 → 依赖迁移列的索引 DDL → 历史 SC 搬迁（任一步失败关闭全部已开句柄）；抽奖库在自身可选边界内执行同样只读准入。版本通过管理接口 `GET /api/database/stats` 或已授权 `GET /api/health` 的 `schemaVersions` 查看，不进入 `/api/state` 或 WS 业务快照。

## 5. 数据保留策略（Retention）

[src/storage/retention.js](../../../src/storage/retention.js) 默认策略 `DEFAULT_POLICY`：礼物原始报文 30 天清文本（保留解析结果），旧通用礼物事件按天清理默认禁用（`giftEventRetentionDays=0`），点歌流水按天清理默认禁用，冷却记录保留 1 天。注意：关闭旧通用清理不等于禁止所有礼物回收——服务器投影明细由 §9 专用保留路径在汇总覆盖且本地消费者终态后回收。SC 按天策略默认 `0` 仅表示仍在显示的 `active`/`assisted` 项不自动过期，删除或撤回立即清正文仅留防重 ID；点歌终态流水随队列立即删除，活动队列始终保留。

- **AI 审计与配额**：`aiRequestLogRetentionDays`（默认 30 天，`0` 禁用）按 `ai_request_logs.created_at` 毫秒时间戳删除过期审计，不影响配置、黑名单、配额、缓存与上下文。`ai_api_usage` 由 [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js) 管理，AI 配额域在初始化及跨月访问时回收上上月及更早计数，保留当月、上月及未来月份（独立于审计开关）。
- **执行入口 `applyRetentionPolicies(databases, {policy, dryRun})`**（`dryRun` 仅统计不删除）：`gift_events` 清 `raw_json` 用 UPDATE 保留行；其余按 `created_at < 阈值` 删除（点歌流水排除关联活动队列行）；非 `dryRun` 同时精简粉丝歌曲过期日计数、清空旧 `import_batches`、删除超过 999 天的 `song_cooldowns`。
- **定时维护 `startRetentionMaintenance()`**：启动后与运行期每小时检查一次，每次重读 `autoRetentionOnStartup === 'true'` 与现行策略；失败仅记警告，timer 调用 `unref()` 并在停机或启动失败时撤销（见 [server-core.md](server-core.md) §5–§6）。`getRetentionStats(databases)` 返回各表行数、时间范围与 `raw_json` 字节数。
- **旧本地礼物分批保留清理**：
  - `gift-maintenance-store.deleteGiftsWithSettlements` 按每批 1000 参数在单个 `BEGIN IMMEDIATE` 事务内删除礼物并将关联 `pending` 结算置 `ignored`（任一批失败整体回滚）。
  - 旧本地礼物保留清理经 `deleteExpiredLocalBatch` 仅按 `idx_gift_events_created_at` 顺序扫描 `source_id IS NULL` 的过期行（每批 ≤ 1000），单批同事务删除并置 `pending` 结算失效；首批完成全表维护后，续批经 `giftEventsOnly: true` 仅继续删除礼物，不重复跑报文检查、粉丝日计数精简或 SC 撤销清理。
  - 自动维护积压时每 25 ms 续批并重读开关/策略（停止时撤销）；手动 HTTP 在批次间让出事件循环、固定策略与开始时间，累计完成后响应，停机时由正常 HTTP drain 等待完成。

## 6. 清库操作

[database.js](../../../src/storage/database.js) 的清空函数（经 `/api/database/*` 暴露，见 [api.md](api.md) §12）：

| 函数 | 范围 | 保留 |
| --- | --- | --- |
| `clearSongLibraryData` | `songs`、`song_categories`、`import_batches` | `settings`、`theme_presets`、`queue`/`requests`（仅解除 `song_id` 外键） |
| `clearSuperChatData` | `super_chats` | `super_chat_receipts`（防旧消息重现） |
| `clearPlaybackData` | `play_history`、`play_queue_state` | `favorites`、`playlists` |
| `clearGiftData` | 当前 source 的 `gift_events`、关联 settlement 与同步状态同事务重置（`BEGIN IMMEDIATE`） | 其他/legacy source、来源字典、`overtime_machine_state`/`overtime_gift_rules` |
| `clearAllData` | 五库业务数据；礼物库仅重置当前 source（见下文矩阵） | 配置类表及其他/legacy 礼物 source |

### 6.1 Clear-All Matrix（清空全部矩阵）

`database-maintenance.js` 保留 `clearAllData` 的位置参数兼容入口，内部转发给 `database-clear-coordinator.js` 的 `coordinateClearAll`（接收具名参数对象）。协调器负责各库 BEGIN、逐库 COMMIT、失败中断与剩余 ROLLBACK；`database-clear-operations.js` 仅在已有事务内执行清理与默认行重建；`database-clear-result.js` 构造成功、预提交失败与部分提交结果（仅预提交全部回滚成功才抛可恢复错误）。矩阵常量 `CLEAR_ALL_MATRIX`（[database-clear-operations.js](../../../src/storage/database-clear-operations.js)）：

**保留（Preserve）**（配置类表，清空后应用仍可用）：

- `settings`、`ai_configuration`、`theme_presets`
- `overtime_machine_state`（重置为 `id=1` 禁用行，保留已有 `enable_epoch` 并在同事务递增已有 `revision`；仅单例缺失时从 `epoch=0`/`revision=0` 新建）
- `overtime_gift_rules`、`favorites`、`playlists` + `playlist_tracks`、`super_chat_receipts`
- 非当前 source 与 `source_id IS NULL` 的 legacy 礼物行，以及 `gift_sources` 字典

清空全部会结束当前加班机轮次：在同一 `giftDb` 事务内将保留来源的 `pending` 结算置为 `ignored`（已 `applied`/`ignored` 终态不变），无 active source 时同样执行状态重置与 `pending` 失效；单独 `clearGiftData` 不重置加班机轮次。

**删除（Delete）**（全部业务数据）：

- 点歌业务：`songs`、`song_categories`（清空后重建默认曲风）、`queue`、`requests`、`random_request_history`、`import_batches`、`user_cooldowns`、`song_cooldowns`、`song_request_daily_counts`
- AI 运行时：`ai_request_logs`、`ai_api_usage`、`ai_viewer_context`、`ai_query_cache`、`ai_blacklist`
- 直播数据：`super_chats`、当前 source 的 `gift_events` 与关联 `overtime_settlements`、`checkin_users`
- 播放器数据：`play_history`、`play_queue_state` 业务快照（后者保留并推进 writer 撤销元数据以阻止旧页迟到写回）

**重建（Recreate）**：

- `song_categories`：插入默认行（`name='默认', sort_order=0, is_enabled=1`）
- `overtime_machine_state`：确保 `id=1` 禁用行存在（`enabled=0, status='paused'`）

### 6.2 两阶段提交流程

**Phase 1（预提交验证）**：

1. 对 5 个数据库依次 `BEGIN` + `DELETE` + 统计行数并重建必需默认行，**暂不提交**。
2. 任一步失败时回滚已开启事务；全部回滚成功则抛聚合错误（`error.details` 含库名与 `delete`/`recreate` 阶段）。
3. 若回滚失败，返回 `partial: true`、`phase: 'pre-commit'`、`committed: []` 与 `rolledBack`/`rollbackFailed`，保持写入器暂停。

**Phase 2（提交）**：

1. 依次对各库执行 `COMMIT`。
2. 全部成功返回 `{ cleared: true, committed, preserved, deletedCounts, recreated }`。
3. 任一 COMMIT 失败立即停止并回滚失败库及尚未提交库，返回 `{ ok: false, partial: true, committed, failed, rolledBack, rollbackFailed, deletedCounts }`。

部分失败时数据库可能处于**不一致状态**，路由返回 HTTP 500 + `partial: true`，前端强制刷新并提示检查。若 `giftDb` 已提交当前投影重置，`runClearAll` 仍立即触发礼物 controller 重建，避免将旧投影继续视作实时同步。

### 6.3 并发写入静默（Quiesce）

[data-maintenance-runtime.js](../../../src/server/data-maintenance-runtime.js) 的 `createDataMaintenanceRuntime` 提供 `domainServices.data`，负责活动礼物来源选择、SC 撤销状态清理、清库后的倒计时/冷却/队列恢复、保留策略与 schema 版本缓存（单独清空歌库时在删除歌曲同一事务内重建默认曲风与待传快照；跨库提交、回滚与 SQL 仍归存储层）。

清空全部流程由同文件的同步 `runClearAll` 协调：路由从 [API 上下文](../../../src/server/api-context.js) 传入最小必要操作端口，运行时依次执行“暂停写入 → 清库 → 恢复写入”，全程不插入 `await`：

- `context.gifts.pauseDetection()`：暂停本地检测、finalize 与消费重试，取消计时器且不强制 flush（暂停期间销毁也不 flush）；远端实时/历史导入抛 `GIFT_DETECTION_PAUSED` 使礼物与同步游标事务一同回滚，避免丢事件。
- `context.overtime.pauseRecovery()`：暂停礼物结算、后台补偿与倒计时归零写入，取消零点与重试定时器。
- `runClearAll` 同时尽力清理音乐 API 与歌词文件缓存（失败不替换数据库结果），并尽力触发投影重建（不等待）。Electron 桌面端在成功响应后清理 QQ 音乐、网易云音乐会话缓存（不删登录 Cookie）。

完全成功并重载已提交的默认状态后，先恢复加班机再恢复礼物检测：

- `context.overtime.resumeRecovery()`
- `context.gifts.resumeDetection()`：从持久化 `pending`/`final` 行重建工作，保留未完成的非统计消费者重试。

Phase 1 失败且全部事务回滚成功时，仅解除本次请求取得的暂停（不解除此前部分失败遗留的暂停）；部分提交、回滚失败、领域状态重载失败（`phase: 'runtime-reset'`）或恢复写入失败（`phase: 'resume'`）时**保持两个写入器暂停**，返回 HTTP 500 与 `partial: true`，不发成功广播或云同步请求。

## 7. 设置存储（`settings-store`）

服务启动直接调用存储门面 `bootstrapSettingsStore(db)`：在同一 `BEGIN IMMEDIATE` 事务内读取旧版本、补齐默认值、执行设置迁移并写版本检查点，全部成功才提交，任何异常回滚整次初始化。

批量写接口 `setSettings(values)` 由存储层管理 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，返回实际变更的键（本地无变化不写库，云快照即使值相同仍原子确认归属账号）；仅提交成功后清除内存缓存，失败保留库与缓存旧值。`setSetting(key, value)` 保留单键兼容；HTTP 输入校验归属 [api.md §2](api.md#2-设置域settings)。

`createSettingsStore(db)`（[settings-store.js](../../../src/storage/settings-store.js)）为缺失键补默认值；`getSettings()` 合并默认值与数据库并缓存，支持 `getSettings(keys)` 按需复制子集（不暴露内部缓存对象）。代表键按分组如下（完整默认键以 [settings-defaults.js](../../../src/storage/settings-defaults.js) 为准，非显然约束与同步归属见 §7.1）：

| 分组 | 代表键 |
| --- | --- |
| 直播间 | `roomId`、`danmakuMonitoringEnabled`、`giftMonitoringEnabled`、`enableBilibili`、`paused`、`queueLimit`、`userCooldownSeconds` |
| 旧引导兼容 | `onboardingVersion`、`onboardingCompletedAt`、`onboardingSkippedOptional`（仅保留历史记录，当前引导见 [交互式引导](../frontend/interactive-tour.md)） |
| 点歌规则与限制 | `onlyFromLibrary`、`allowDuplicate`、`allowCompactRequest`（历史默认键）、`guardPriorityEnabled`（默认 `false`，按账号同步）、`scSongRequestEnabled`（默认 `true`，按账号同步）、`songRequestCancelEnabled`（默认 `true`，按账号同步）、`songRequestMatchMode`（`unique`/`prefix`，按账号同步）、`songRequestRequireSpace`（控制点歌指令是否必须带空格，默认 `false`，按账号同步）、`songCooldownMode`/`songCooldownValue`（按账号同步，入队时间仅存本机）、`userQueueLimit`、`userCooldown*`、`userDaily*`、`songRequestMinMedalLevel`、`songRequestGuardLevel`、`songRequestGuardMedalBypass`、`songRequestUserBlacklist`（JSON 文本，按账号同步）、`songRequestBlacklist`（本机）、`queueRequestRequesterColor`/`queueRequestSongColor`（本机） |
| 弹幕机器人 | `enableRandomTagReply`、`enableCheckinBot`、`enableFortuneBot`、`enableCustomReplyBot`、`checkinBlessings`、`fortunePool`、`customReplyRules` |
| 礼物与特效 | `enableGiftSprint`、`giftSprintTargetRmb`、legacy `giftBlindBoxConfig`、云端私有 `giftBlindBoxCustomConfigV2`、`enableGiftNotification`、`giftEffectDanmakuEnabled`、`giftFrameEnabled`、`giftFrameThresholdRmb`、`giftFrameStyleTriggers`、`giftDrop*`、`giftSwing*`、`guardThanksAurora*`、`guardThanksClassic*`、`guardThanksNauticalEnabled`（旧 `guardThanksEnabled`/`TextMode`/`Style` 兼容保留；已撤销的 `giftFrameRibbon*` 与 `giftFrameTheme`/`MotionMode` 历史行原样保留但不参与运行） |
| 滚动、字号与主题 | `scrollSeconds`、各队列风格独立的 `*QueueScrollMode`/`*Speed`/`*FontSize`/`*FontFamily`/`*FontWeight`/`*UseCustomTextColor`/`*TextColor`、`songBoard*`（歌单板用 `songBoardFontSize` 计算字号倍率，主题预设及其 v2 建库迁移仍收录旧键 `songBoardThemeFontScale`）、`themePrimary`/`Accent`/`Text`/`Background`/`Opacity`/`Radius`/`FontScale` 及迁移版本键 `*RangeVersion`/`queueStyleSettingsVersion` |
| 叠加层与组件 | `danmakuOverlayStyle`、`danmakuFullscreenDurationSeconds`、`overlayQueueStyle`（遗留 `festival` 按 `identity` 处理）、`overlayLowPowerMode`、`backdropBlur`、`glowIntensity`、`overlayPin1-3`、`overlayRule1-6`、`heartBoxCollectionShowRewards`/`BackgroundStyle`、`liveRankingsRange`、`nowPlayingAppearance` |
| 歌词与 WeSing | `desktopLyric*`、`advancedLyric*`、`weSingCachePath`、`weSingLyricOffsetMs` |
| 开播动画 | `openingEnabled`、`openingTitle`/`Subtitle`/`Name`/`Footer`、`openingQuality`、`openingTrackMotion`、`openingShowNotes`/`Eq`、`openingAudio*`、`openingCharacter*`、`openingPixel*`（上传素材位于 `opening-music/`、`opening-character/`） |
| 时钟 | `clockStyleOptions`、`clockStyleParameters`、`clockStyle`、`clockShowDate`/`Seconds`、`clockHourFormat`、`clockLabel`、`clockFlip*`、`clockMoonMode`/`IntervalSeconds`（供固定 `/clock` 浏览器源首帧读取） |
| 投票与评分外观 | `interactionOverlayTitle`/`Hint`、`interactionRatingRules`、`interactionTextColor`/`BarColor`/`TrackColor`、`interactionOverallOpacity`、`interactionFontSize`、`interactionCornerRadius`、`interactionShowStatus`/`Participants`（旧 `interactionBackgroundColor`/`Opacity` 仅保留兼容；本机保存不同步，输入范围见 [api.md §2](api.md#2-设置域settings)） |
| 保留期与更新 | `giftRawJsonRetentionDays`(30)、`giftEventRetentionDays`(0)、`requestRetentionDays`(0)、`superChatRetentionDays`(0)、`autoRetentionOnStartup`、`enableAutoUpdate` |

公开设置经 WS 快照 `settings` 字段投影下发（过滤约束见 [ws.md](ws.md)）；账号归属与待传的私有持久键单列于 §8，不进入公开快照。

### 7.1 关键设置的归属与约束

- **心动收集与榜单**：`heartBoxCollectionShowRewards='true'`、`heartBoxCollectionBackgroundStyle='white'` 与 `liveRankingsRange='all'`（`all` 完整榜手动滚动 / `nearby` 附近名次，旧 `nearby/pageSize/pageSeconds` 兼容保留）均为本机显示设置，不同步云端，由 [scene-shared-appearance.js](../../../public/js/shared/scene-shared-appearance.js) 映射并复用场景校验（详见 [心动盲盒收集组件](../frontend/overlays.md#心动盲盒收集组件)）。
- **歌曲信息外观**：`nowPlayingAppearance`（默认 `'{}'`，不同步云端）为本机外观 JSON，定义见 [now-playing-appearance.js](../../../public/js/shared/now-playing-appearance.js)，缺失或非法值回退默认黑胶横排；画布共享外观写回同一配置，保存逻辑见 [now-playing-settings.js](../../../src/server/now-playing-settings.js)。
- **开播样式**：经典舞台沿用原键，像素卡带使用独立 `openingPixel*` 键（`openingPixelQuality='high'`、`openingPixelShowNotes='true'`、`openingPixelShowEq='true'`、`openingPixelAudioVolume='0.35'` 等），不覆盖经典配置；导入资源样式的公共参数由组件样式库维护。

#### 歌词视觉设置

基础歌词与高级歌词的所有视觉设置均为本机外观字符串，同步到同样式画布与歌词输出，不加入云设置同步（旧库仅补齐缺失键默认值，无 schema 迁移）：

- 基础歌词的「逐字跳动」使用布尔字符串 `desktopLyricWordBounceEnabled`，默认 `'true'`。切换逐字高亮方式会保留这个选择。
- **基础歌词颜色与显隐**：已唱颜色 `desktopLyricSungColor`（默认 `''` 跟随高亮色，支持十六进制及 Alpha），未唱颜色复用 `desktopLyricTextColor`（默认 `#000000`），整体不透明度复用 `desktopLyricOpacity`；`desktopLyricShowTranslation` 与 `desktopLyricShowRoma` 默认 `'true'`。
- **基础排版**：`desktopLyricLineHeight` 默认 `'1.4'`（1–2），`desktopLyricLineGap` 默认 `'24'`（0–120 整数像素），翻译/罗马音缩放 `desktopLyricTranslationScale` 默认 `'0.65'`（0.4–1）；管理页预览宽高另存 `localStorage`（见 [歌词输出与预览](../frontend/overlays.md#6-直播歌词页lyrics)）。
- **高级歌词开关与编排**：`desktopLyricEnabled='true'`、`advancedLyricEnabled='false'` 为独立开关；高级输出仅显示当前句，`advancedLyricHideUnsung='true'`、`advancedLyricWordProgress='false'` 随命名搭配保存（旧 `advancedLyricShowNextLine` 保留布尔兼容，默认 `'false'`，渲染不使用）；`advancedLyricLayout` 默认 `'phrase-flow'`（目录见 [advanced-lyric-catalog.js](../../../public/js/shared/advanced-lyric-catalog.js)），完整编排复用 `advancedLyricMotionDuration`/`Amount`。视觉类型与校验统一定义于 [advanced-lyric-appearance.js](../../../public/js/shared/advanced-lyric-appearance.js)，排版/入场轮换序列至多 12 项逗号去重，非法值整批拒绝。
- **高级字体与字效细调（均以 `advancedLyric` 为前缀）**：

| 字段后缀 | 默认值 | 范围与语义 |
| --- | --- | --- |
| `FontStyle` | `normal` | `normal` / `italic` |
| `LetterSpacing` | `0` | −0.05–0.6em，步长 0.01 |
| `LineHeight` | `1.2` | 0.9–1.8，步长 0.05；词组换行行距倍数，参与适配测量 |
| `HighlightOpacity` | `1` | 0–1，步长 0.05；演唱填色浓度，0 仍保留逐字动作与时间 |
| `ShadowColor` | `#00000085` | 投影颜色及 Alpha（6/8 位十六进制） |
| `ShadowDistance` | `1` | 0–8，步长 0.25；原投影距离倍数 |
| `ShadowAngle` | `90` | −180–180°，步长 5；0° 向右、90° 向下 |
| `ShadowBlur` | `1` | 0–4，步长 0.1；原模糊半径倍数，0 为硬边 |
| `GlowRadius` | `1` | 0.25–3，步长 0.25；原发光范围倍数 |
| `GlowOpacity` | `1` | 0–1，步长 0.05；沿用强调色发光浓度 |
| `GradientAngle` | `160` | 0–360°，步长 5；160 保留原方向，其余按差值旋转 |
| `TextureScale` | `1` | 0.5–3，步长 0.1；条纹、圆点及粉笔颗粒大小倍数 |

- **命名搭配库**：`advancedLyricSavedPresets='[]'` 保存 JSON 数组 `{id, name, settings}`（至多 20 份、序列化 ≤ 65536 个 UTF-16 代码单元；ID 1–64 位字母/数字/下划线/连字符，名称 1–64 字符，`settings` 仅含高级外观字段）。预设库仅供本机编辑，不投影至歌词浏览器源；实际外观与显示开关投影至 `lyrics` scope（场景实例 `lyricLayer` 不存 `settings`）。

`settings` 表统一以字符串存储（布尔为 `'true'/'false'`，数值为十进制文本，结构化数据为 JSON）。下表聚焦同步归属、路径与非显然持久化约束（HTTP 输入范围集中于 [api.md §2](api.md#2-设置域settings)）：

| 键与默认值 | 权威 / 同步范围 | 修改入口与归属说明 |
| --- | --- | --- |
| `songRequestBlacklist=''`、`queueRequestRequesterColor='#1d4f91'`、`queueRequestSongColor='#743b8e'` | 本机保存，不同步 | 设置 HTTP；黑名单匹配见 [bilibili/danmaku.md](bilibili/danmaku.md) §5.3 |
| `roomId`、`danmakuMonitoringEnabled`、`giftMonitoringEnabled`、`enableBilibili`、`paused`、`queueLimit`、`userCooldownSeconds`、`onlyFromLibrary`、`allowDuplicate` | 云端与本地双向同步；`roomId` 另受账号归属事务保护 | 设置 HTTP → 本地 Bilibili/点歌/队列；白名单见 [settings-contract.js](../../../src/server/settings-contract.js) |
| `enableBilibili` 兼容规则 | 两分项缺失时继承旧总开关，总开关维护为两分项逻辑或 | `settings-store.js` 原子保存：显式分项优先，旧请求不含分项时仅在总开关变更时同步改两项；云端响应缺少分项字段时兼容旧总开关读取，任一分项变化均触发 settings 同步 |
| `giftEffectDanmakuEnabled='false'` | 随云 settings 同步，云端缺省按 `false` | 设置 HTTP → 弹幕指令特效（不控制全屏感谢或流水），详见 [弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md) |
| `giftBlindBoxConfig` / `giftBlindBoxCustomConfigV2='null'` | legacy 兼容 + 云端私有自定义层（官方目录只读） | [blind-box-config.js](../../../src/bilibili/gift/blind-box-config.js)；V2 `null` 不覆盖、`[]` 明确清空私有层 |
| `enableCheckinBot`、`enableFortuneBot`、`checkinBlessings`、`fortunePool` | 本地旧数据兼容，**不代表云端启用值**，不同步 | 当前由 `dailyBots` IPC 直接操作云端，旧词库仅作显式接管只读源 |
| `danmakuOverlayStyle='signal'`、`danmakuFullscreenDurationSeconds='6'` | 本机展示设置，非服务器配置副本 | 本地 HTTP 校验与展示投影；服务器样式经 `liraLicense` IPC 管理，差异见 [preload.md](../desktop/preload.md) |
| `weSingCachePath`、`weSingLyricOffsetMs='0'` | 本机路径/偏移，不同步 | HTTP 保存前先 prepare；[wesing-cache.js](../../../src/music/wesing-cache.js) 校验绝对目录与偏移 |
| `giftFrameEnabled='false'`、`giftFrameThresholdRmb='20'`、`giftFrameStyleTriggers=''` | 本机保存，不同步 | [frame-config.js](../../../src/bilibili/gift/frame-config.js)、[gift-frame-style-triggers.js](../../../src/server/gift-frame-style-triggers.js)；`giftFrameStyleTriggers` 为 `''` 且样式库可读时启动迁移一次（写入当时林间花信开关与金额），已迁移后缺项视为关闭/20 元（最多 1000 条） |
| `giftDrop*` / `giftSwing*` | 本机礼物掉落/摇摇乐，不同步 | [motion-config.js](../../../src/bilibili/gift/motion-config.js)；动效参数保存与读取均按上下限钳制（详见 [api.md §2](api.md#2-设置域settings)），掉落整批按结算时刻统一计时到期丢弃 |
| `guardThanksAurora*`、`guardThanksClassic*`（默认 `''`）、`guardThanksNauticalEnabled`（默认 `''`） | 本机大航海感谢，不同步 | [guard-thanks-config.js](../../../src/bilibili/gift/guard-thanks-config.js)；空值兼容继承旧键，独立保存后脱离旧键；`nautical` 仅投影场景不发旧特效页 |
| `openingEnabled='false'`、`openingAudio*`、`openingCharacter*`、`openingPixelCharacter*` | 本机上传素材，每次 bootstrap 强制关闭 `openingEnabled` | 由专属上传/删除路由保存素材路径，不通过普通设置接口写入任意路径；目录布局见本文件 §2 |
| `enableAutoUpdate='false'` | 本机偏好，不同步 | 管理设置 HTTP 持久化，详见 [update.md](../desktop/update.md) |
| `interaction*`、`clock*` | 本机展示，不同步 | 各自 HTTP 校验器与展示投影 |

### 7.2 defaults 外的领域设置与公开投影

- `giftDisplayConfig` 由 [display-settings.js](../../../src/bilibili/gift/display-settings.js) 管理（JSON 文本，经专属礼物展示接口读写，不同步云端，旧 `intervalSeconds`/`paused`/`lowPower` 兼容为 `scrollSpeed=1`，完整字段见 [api.md §10](api.md#10-礼物域gifts)）。
- `giftExportStyle` 是本机礼物图片导出偏好。一个 JSON 值保存 `{source,customStyle}`，`source` 为 `follow` 或 `custom`。`customStyle` 保存外形、纹理和三个金额分界。缺少或无法识别该键时使用滚动礼物样式。切回跟随会保留上次的自定义值。字段与单位见[礼物导出接口](../desktop/preload.md#6-礼物导出任务与取消)。
- 礼物图片导出的本地设置由 Electron 控制器经 `giftExport` IPC 写入，控制器提供缺省值。`giftExportMode` 默认 `combined`，另可 `separate`。`giftExportBackground` 默认 `transparent`，另可 `white`。`giftExportSortBy` 默认 `time`，另可 `amount`。`giftExportRowGap` 以整数像素字符串存储长图中相邻卡片的间距，范围 `'0'` 至 `'32'`，默认 `'16'`。`giftExportMergeAcrossDates` 默认 `'false'`。`giftExportDirectory` 只接受原生对话框或系统默认目录，空串使用系统图片目录下 `LIRA/礼物导出`。见[礼物导出接口](../desktop/preload.md#6-礼物导出任务与取消)。
- 以上领域键仍由 `getSettings()` 返回并可进入管理 HTTP/WS；overlay 设置由 [overlay-projection.js](../../../src/server/overlay-projection.js) 按 scope 白名单筛选。真正隐藏的私有键（`cloudRoomAccountKey`、`cloudSongSyncPending` 等）见 §8。

### 7.3 启动迁移、清理与导入导出

旧身份规则默认文案清理由 `identityRuleDefaultsVersion=1` 标记一次性完成（已有 `queueStyleSettingsVersion=1` 的已迁移库仅补标记不删当前文案）。[settings-migrations.js](../../../src/storage/settings-migrations.js) 在插入默认值**之前**读取旧版本检查点（非 `schema_version`）：

| 检查点 / 条件 | 转换与兼容 |
| --- | --- |
| `queueScrollSpeedRangeVersion != '3'` | 旧队列速率归一到 1–100，完成写 `3` |
| `songScrollSpeedRangeVersion != '2'` | 旧 `scrollSeconds`（20–200）映射 1–100；新库无旧值直接写 `2` 保留默认 20 |
| `queueFontSizeRangeVersion != '2'` | 补默认前将已保存旧范围 `queueSongFontSize`/`queueTitleFontSize` 翻倍，完成写 `2` |
| `queueStyleSettingsVersion != '1'` | 旧共享字号/字体/颜色/滚动值复制至 `identity` 及各插画风格独立键，完成写 `1` |
| `identityQueueFontFamily` 缺失 | 补默认前复制已保存 `overlayFontFamily`（无旧值默认 `Microsoft YaHei`） |
| `desktopLyricKaraokeMode` 缺失 | 旧 `desktopLyricKaraokeEnabled='false'` 初始化为 `off`，否则默认模式 |
| 旧 `overlayRule3` / `4` 原文 | 仅匹配旧默认文案时迁移，保留用户内容 |
| `songBoardFontSize` 缺失 | 补当前默认 28，保留所有已保存字号（含 16） |
| `giftBlindBoxConfig` 旧字符串输出 | 按已知旧价格表转对象，空串改 `[]`，显式 `[]` 不补默认 |

普通歌库 CSV/XLSX 导入导出仅含歌曲；主题预设仅提取 [theme-store.js](../../../src/storage/theme-store.js) 的外观白名单。清库矩阵保留 `settings` 与 `theme_presets`；直接复制 SQLite 文件会包含私有行与本机路径，不等同于公开设置导出。

其他 store 模块：`theme-store`、`playback-store`、`cooldown-store`（重启恢复排除未来时间，`prune` 删除过期或未来行）、`daily-bot-legacy-reader`、`gift-query-store`。关闭时统一执行 `optimizeDatabases`（`PRAGMA optimize`）→ `closeDatabases`（见 [server-core.md](server-core.md) §6.2）。

## 8. 云端 scope 的本地落盘

- **Bilibili 退出意图**：由 [cloud-bilibili-sync-store.js](../../../src/storage/cloud-bilibili-sync-store.js) 存于 `settings` 表私有键 `cloudBilibiliLogoutPending:<accountKey SHA-256>`（仅含 `mutationId`，无 Cookie/凭据）。退出前先落盘，恢复后按账号与 `mutationId` 确认删除（流程见 [auth.md §13](../desktop/auth.md#13-云端-bilibili-凭据同步边界)）。
- **SongStore 缓存与简繁函数**：使用连接级 TEMP 触发器维护缓存变更令牌，外部连接提交以 `data_version` 兜底，事务内读取不复用缓存（详见 [音乐服务](music/services.md)）。`SongStore` 与 `QueueStore` 注册确定性函数 `lira_simplified_text` 用于搜索、歌名匹配、队列去重及歌曲冷却简繁等价比较（原始文字保留）。
- **歌库 5000 首上限**：`SongStore` 写入前校验最终完整歌库 ≤ 5000 首（含停用歌曲，合并按 `(name, artist)` 去重），超限不改表并由调用方返回 `SONG_IMPORT_LIMIT_EXCEEDED`；历史超限库仍可编辑、删除或显式替换为上限内完整快照，云端上传前独立校验（超限返回 `TOO_MANY_SONGS`，不截断上传）。
- **房间归属与修订**：`settings-store.prepareCloudRoomAccount(accountKey)` 维护 `settings` 私有键 `cloudRoomAccountKey`（`JSON.stringify([origin, accountName, streamerId])`）；首次缺失或身份变更时在单个 `BEGIN IMMEDIATE` 事务内同时清空 `roomId` 并写入新标记（失败回滚，同账号重复调用不写库）。`settings-store.getRoomRevision()` 在当前进程内记录已提交的 `roomId` 变化，供在途随机点歌复核。
- **云同步控制器与歌库替换**：云端修订号存于远端 LIRA Server，本地不复制；[cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js) 在进程内维护 `settings`/`songs`/`bilibili` 已应用修订号、dirty 标志与本地变更代次。`song-service.replaceCloudSongs` 规范化并去重后调用 [song-store.js](../../../src/storage/song-store.js) 的 `replaceAll` 单事务替换（先置空 `queue`/`requests` 的 `song_id` 保留点歌文本，再删旧歌与曲风、重建默认曲风并插入新歌，同时更新私有 `cloudSongAccountKey`）。
- **歌曲待上传快照（`cloudSongSyncPending:<accountKey SHA-256>`）**：
  - 由 [cloud-song-sync-store.js](../../../src/storage/cloud-song-sync-store.js) 存于 `settings` 表，含唯一 `mutationId` 与完整歌曲快照（空数组表示明确清空）。
  - 捕获前核对磁盘 `cloudSongAccountKey` 与当前 `cloudRoomAccountKey`：不一致抛 `CLOUD_SONGS_NOT_READY` 并回滚原歌曲修改与待传写入；一致时允许离线编辑，尚无归属时沿用初次播种规则。
  - 保存、删除、启停、导入与清空均在歌曲事务提交前捕获待传快照（写入失败整体回滚），不删除其他账号的待传项；`hasPendingCloudSongs` 以 `SELECT 1` 快速判存，恢复与上传经 `readPending` 读取最新快照。
- **设置待上传快照与基线门禁**：[cloud-settings-sync-store.js](../../../src/storage/cloud-settings-sync-store.js) 维护私有键 `cloudSettingsSyncPending:<accountKey SHA-256>`（同步白名单由 [cloud-settings.js](../../../src/shared/cloud-settings.js) 定义，不含 Cookie、设备凭据或礼物互动意图），`setSettings` 同事务写入；云端应用与待传恢复传 `{ syncPending: false, accountKey }` 防上传回声。私有键 `cloudSettingsAccountKey` 标记同步设置基线归属，切换账号清空房间时同事务置空该标记；未就绪时修改同步字段抛 `CLOUD_SETTINGS_NOT_READY` 回滚整批修改（本机设置仍可修改），待云端/待传快照原子提交后解除门禁。菜单通知在未就绪时被门禁拒绝会清除临时 dirty，待基线恢复后按菜单签名补传。跨账号接纳旧监控快照时，缺失的 `danmakuMonitoringEnabled`/`giftMonitoringEnabled` 从传入 `enableBilibili` 补齐（显式通道优先）。
- **确认与引用保留**：所有上述私有键均不进入 `getSettings()`、defaults、HTTP/WS 或 Device 快照。设置与歌曲上传确认仅删除同账号且同 `mutationId` 的待传记录；重启或切回账号优先恢复并上传该账号待传快照。同账号且内容相同时保留队列/历史歌曲引用，跨账号应用时即便内容相同亦解除旧引用。

## 9. 礼物账本完整投影

`gift-projection-reset.js` 集中维护同步元数据重置字段，在调用方已有事务内清空 epoch/cursor/bootstrap/验证时间并递增代次（generation）；手动清理清除当前来源全部事件，重建仅清除 `cmd = 'LIRA_SERVER_GIFT'`。

按 [ADR-0011](../../architecture/adr/0011-source-partitioned-gift-ledger-projection.md)，在现有 `gift-data.db` 中新增 `gift_sources`、可空的 `gift_events.source_id` 与 `gift_sync_state`。迁移前行保持 `source_id = NULL`，新 `LIRA_SERVER_GIFT` 行由触发器确保引用有效来源；v9 追加可空 `gift_events.blind_box_id`；远程幂等唯一键为 `(source_id, platform_id, cmd)`。

`gift-sync-store.js` 将历史页与 page token、增量页与 cursor、最终历史页与 epoch/recovery cursor，以及清库重建的 generation/state reset 分别置于单个 `BEGIN IMMEDIATE` 事务中。旧 `remote-gift-cursor.json` 不再作为状态源；通用保留策略不删除非空 `source_id` 的服务器投影，数据库级清空礼物同事务递增 `projection_generation` 并重置同步状态后显式重建。完整 DDL 与不变量见 [礼物投影规格](../../../specs/gift-ledger-projection-sync_design.md)。

### 礼物保留存储

- **表结构与分层基线**：[gift-retention-migration.js](../../../src/storage/gift-retention-migration.js)（giftDb v17）幂等新增 `remote_final_cursor` 以及 `gift_retention_snapshots` / `state` / `members`（来源隔离活动/暂存快照）、`gift_retention_pending_finals`（已收 `progress` 收尾资料）、`gift_retention_days`（公开日汇总版本）、`gift_retention_receipts`（精确去重键）、`gift_local_archives` 与 `gift_sprint_carry`。giftDb v22（[gift-retention-tiers-migration.js](../../../src/storage/gift-retention-tiers-migration.js)）建立一年保留基线，首次升级一次性原子清除已识别 source 的旧服务器礼物副本、关联结算与保留派生状态并递增代次后重新 bootstrap（保留来源不明记录、许愿配置、规则、其他域与导出文件）；v21 `occurred_at` 保留为空，新 `gift_local_archives` 按冻结 `archive_timezone`、民用日期 `day_start` 与业务维度保存一年外日合计。
- **许愿边界结转与查询**：giftDb v20（[gift-wish-migration.js](../../../src/storage/gift-wish-migration.js)）建 `gift_wish_contributions`（v22 重置后不再写入）；[gift-wish-retention.js](../../../src/storage/gift-wish-retention.js) 在删除事务内将长期许愿创建日与已确定本场起始日的部分窗口合并至 `gift_wish_boundary_totals`（本场可变尾日保留原行，完整自然日走服务器汇总不重复相加；同 epoch 重建保留结转，换 epoch/清来源重置，删许愿级联清除）。`gift-wish-store.countMany` 一次读取活动 retention 快照并在同来源内分别单次查询聚合明细、完整日与非整日贡献（各条件保留自身精确起止时间与礼物身份）。
- **原子切换与分批回收**：[gift-retention-store.js](../../../src/storage/gift-retention-store.js) 同事务提交页与检查点，校验固定 epoch、revision、coverage、令牌与 `projection_generation`，下载完成后原子切换活动快照（实时行自动入活动成员，历史暂存行取得同 source/epoch 已发布成员证明后可见；`gift_local_detail_coverage` 存已验证明细区间）。[gift-local-retention.js](../../../src/storage/gift-local-retention.js) 以已激活 `summarized_before` 减 365 天为截止点（默认每批 25 条、硬上限 500 条），先结转后删除，保护 `pending` 加班与未完成统计消费；[gift-retention-cleanup.js](../../../src/storage/gift-retention-cleanup.js) 每批扫 ≤ 100 条清理废弃快照与日版本。检查点与删除同事务提交，SQLite 复用空闲页不在线 VACUUM；远程礼物仅由此专用路径回收，详见 [礼物保留规格](../../../specs/gift-retention.md)。

## 查询优化：song v7 / gift v12、v18、v24、v26

- **时间与最近记录索引**：
  - giftDb v12 建立本地最近记录索引 `idx_gift_events_source_recent`，覆盖 `active`、付费、`final` 且统计合格记录（供本地最近列表）；`idx_gift_events_source_time_asc` 补齐升序。时间游标先取同时间较小 ID 再取严格早/晚记录，共用短读事务。
  - giftDb v24 建立远端最近记录索引 `idx_gift_events_remote_recent`，覆盖 `source_id IS NOT NULL`、`total_price > 0`、`final` 的远端记录（不限 `status` 且不要求统计合格），使普通 `active` 与已发布快照 `active`/`retention-staged` 读取沿同一时间序取数而无需临时排序（仅加索引，不改写数据）。
  - giftDb v26 在同一迁移事务中重建上述两个最近记录索引，排序键均为 `(source_id, datetime(created_at, 'subsec') DESC, id DESC)`。本地索引沿用 `status='active'`、`total_price>0`、`detection_status='final'` 和 `gift_stats_eligible=1`。远端索引沿用 `source_id IS NOT NULL`、`total_price>0` 和 `detection_status='final'`。同一来源按 UTC 毫秒从新到旧，同一毫秒再按本机行 ID 倒序。旧账本、保留成员与游标按原值保存。
  - giftDb v18：`idx_gift_events_retained_time` / `idx_gift_events_retained_time_asc` 索引 `final`、`status IN ('active','retention-staged')`、`total_price > 0`、`num >= 1` 的记录，结合成员证明与 365 天边界实现连续时间序扫描。
- **分页计数与统计预汇总**：`gift-query-store.js` 的 `readHistoryPage` 同事务读取总数与分页并按连接缓存最多 64 个筛选计数（以 `total_changes()`、`data_version`、`schema_version` 失效）。`readStatistics` 同读事务按原始礼物 ID、名称、北京时间桶与盲盒成本状态预汇总明细，并与活动 retention 日汇总合并供总计、身份排行与时间序列复用，不新增持久表或跨请求缓存。
- **冲刺与盲盒连接级聚合追踪（`gift-aggregate-changes.js`）**：
  - 按数据库连接建立 TEMP 单行计数与触发器，分别跟踪冲刺与盲盒的实际输入变化（无关的同步校验时间、投递标记或普通礼物写入不触发失效）。
  - 盲盒追踪覆盖有来源的历史 `final` 与 `retention-staged` 行（不依赖实时消费者资格），并在 `gift_retention_state.active_snapshot_id` 切换时失效；冲刺结转与本机盲盒归档各自推进所属计数。
  - 计数随事务回滚，事务内读取不安装追踪或复用缓存；令牌含连接实例身份并以 `data_version` 对外部连接提交保守失效，连接关闭即销毁 TEMP 状态，不改持久 schema。
- **条件式历史扫描与增量拉取（`gift-history-changes.js`）**：同一读事务内核对 `contentRevision`（命中时跳过总数与明细扫描）；连接内 TEMP 修订与有界行 ID 日志（最近 1000 次变更，每 store 保留最多 64 个成功版本）追踪 `gift_events` 与保留快照成员写入，支持 `delta=1` 时间升序按主键精准补读，遇日志缺口、候选超页、物理删除或版本变化自动回退完整分页（详见 [礼物查询](bilibili/gift.md#5-礼物冲刺与查询)）。
- **粉丝列表分批加载**：当前 scope 事务内先按筛选条件查档案，再每批 ≤ 500 ID 调用 `records.listProjectionInputs` 与 `statesForProfiles`；完整备份 `exportScope` 调用 `records.listForProfiles`（含被屏蔽档案）。

## 签到云端数据与旧库兼容

签到累计、每日记录与抽签结果存于云端租户 `streamer.db`，客户端直接控制开关并按需编辑服务器正式词库（已确认词库仅缓存在 Electron 主进程当前授权上下文，编辑草稿仅留页面，不新增本地持久词库）。`checkin-data.db` 原位保留，`daily-bot-legacy-reader` 仅作旧 API/IPC 一次性只读兼容适配器。本地签到写入存储与签到/抽签执行服务均已移除，生产 `domain-services` 仍保留对应命令入口，命中时直接返回 `cloud-owned`。

## 公共资源缓存

[src/resources/resource-library.js](../../../src/resources/resource-library.js) 负责 `data/cache/resources/`，在现有设备 data 根下保存可重建的共享字体与大图（与账号资料、导入套装与安装文件分离）。对象文件名为 `<SHA-256>.<原扩展名>`，`index.json` 为 `{version:1, files:{<public相对路径>:{sha256, size, previous?}}}`，换版时 `previous` 记录上一可用版本的摘要和大小，无绝对路径、CDN 凭据或账号信息。

`resource-packages.js` 声明当前共享图片与旧客户端兼容图片，启动下载、更新比较与缺失统计仅针对共享资源；航海旗帜三张兼容图片继续校验并提供已有缓存，不因缺失或 CDN 版本变化发起下载（当前旗帜样式完整读取导入 ZIP 的 `component-media`）。准入与防回归见 [CDN 分发指南](../../guides/cdn-resources.md#资源准入与防回归)。

启动先校验当前缓存大小与摘要再检查远程清单。字体 ZIP 与图片下载至同目录独占 `.tmp` 并流式校验；ZIP 校验全部条目后仅解出所需文件并校验，重复、加密或意外条目使整包失败并丢弃临时文件。验证通过的字节先暂存为 `<摘要>.<扩展名>.pending`，原子替换 v1 索引后再改名为公开对象名；改名中断时下次启动按索引离线补完，超 24 小时未引用 `.pending` 按临时文件回收。已发布对象按摘要保留供旧版本 URL 读取，索引损坏可从可信清单与本地完整文件重建。

扫描期间 `.pending` 发布失败时，即使重开也会校验上版对象或随包资源，继续通过默认路径提供可读版本。没有可用旧版本时，该逻辑路径的不带版本读取立即结束，不等待远程清单；重试初始化会清除本轮失败记录。按摘要读取仍保留等待其他资源发布同一对象的能力。

清单 v2 为 `{version:2, files:[{path, size, sha256, label}], packages:[{id, size, sha256, files:[path]}]}`（原文件与下载包各最多 512 项、单项 ≤ 128 MiB、声明总量 ≤ 512 MiB，清单 ≤ 1 MiB）；CDN 根 origin 来自可信启动配置，兼容 v1 清单 `resources/objects/<SHA-256>.<扩展名>`，本地索引保持 v1。上传步骤见 [CDN 分发指南](../../guides/cdn-resources.md)。

## 共享字体缓存

[src/fonts/font-library.js](../../../src/fonts/font-library.js) 保留旧 `data/cache/fonts/` 的只读兼容（路径由 `resolveDataPaths().fontsDir` 计算，文件名 `<SHA-256>.ttf`/`.woff2`，旧 `index.json` 格式 `{version:1, fonts:{<id>:{sha256, format}}}`）。已缓存字体在新版公共资源下载期间仍可经旧字体 ID 路由使用；正常桌面启动由上述公共资源模块统一同步，不再写第二份字体缓存。

旧独立字体适配器保留供开发与兼容调用，缓存或索引替换遇 `EPERM` / `EBUSY` 时仅对同一临时文件最多重试 4 次（累计 ≤ 500 ms，不重新下载）。字体来源、体积与首次联网要求见 [字体说明](../../../public/fonts/README.md)。
