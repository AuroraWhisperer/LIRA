# 存储层:数据目录、SQLite 六库与迁移

## 电音助手本机数据

原生会话将参数原子写入 `<dataDir>/audio-assistant/settings.json`（先写 `.tmp` 再替换），不增加 SQLite 表或服务器设置。缺失/损坏 JSON 使用默认值，读取时归一化数值范围。

| 字段 | 默认 | 范围 / 含义 |
| --- | --- | --- |
| strength | 80 | −100～100，人声端 / 原唱 0 / 伴奏端 |
| semitones | 0 | −12～12 半音 |
| speedPercent | 100 | 50～200；仅本地文件使用，外部采集固定 100 |
| volume | 70 | 0～200 输出音量百分比；100 为单位增益，200 为两倍振幅；输出仍钳位到 −1～1，过度放大会削波失真 |
| outputId | 空串 | 空串在播放器模式跟随处理前输出，本地文件/设备输入用默认设备；旧 Windows 端点 ID 保留为 WASAPI，共享接口也可用 `wasapi:` / `directsound:` / `waveout:` 加端点 ID 或 default；ASIO 为 `asio:` 加 URI 编码驱动名，可带 `\|N` 选择零起始相邻声道对 |
| cableId | 空串 | 独立原声通道；未保存时可识别已有隔离设备 |
| external | true | 上次是否使用外部来源；具体 PID 与本地文件路径不持久化 |
| deviceSource | 空串 | `input` 为录音设备，`loopback` 为播放设备回送；空串按旧 external 恢复 auto/file |
| inputId / loopbackId | 空串 | 分别记忆录音设备、回送播放设备的 Windows 端点 ID；空串使用相应默认设备 |
| inputChannels | auto | 默认取单声道或前两个声道；`mono:N` / `stereo:N` 以零起始索引选择单声道/相邻声道对，N 为 0～127，启动时再校验实际设备声道数 |
| inputMusic | false | 设备输入是否启用音乐声伴处理；关闭时声伴强度有效值为 0，保留已保存的歌曲参数 |

切换来源或设备会重置输入声道为 auto、音乐处理为 false；重载保留已选设备及参数但不自动开始采集。设备缺失保留其 ID，启动失败而不静默使用别的设备。设备来源不保存录音或输入音频。

运行中的歌曲开关与原声对比不持久化，不会因重启自动开启处理。`audio-assistant/routes/` 保存既有恢复事务；播放器退出且端点静音已归还后仍保留应用输出设置的撤销信息，由守护在其下次自然播放时归还路由。安全延期与恢复异常的区分来自既有记录和守护存活状态，不新增持久字段，也不因界面恢复正常而删除未完成事务。该目录与原 `tmp` 样品相互独立，不搬移或覆盖样品设置与恢复记录。入口 enabled / placement / x / y / dock 继续使用既有 [Admin 本机偏好](../frontend/app.md#6-组件与百宝箱)。

SC 的可撤销删除仍立即删除数据库行并留下防重 ID；`superchat-undo.js` 仅在内存保存
当前 10 秒批次的原记录。`superchat-store.restoreDeleted()` 以单事务恢复原 ID、内容、
处理状态和时间，同时移除该批次的防重 ID。任意一行失败整批回滚。此路径仅接受
服务端捕获且仍有效的批次；平台撤回和整库清空不能用它恢复。没有新增表或持久化格式。

## 礼物保留存储

[gift-retention-migration.js](../../../src/storage/gift-retention-migration.js) 是 gift_db v17：
幂等增加 remote_final_cursor；gift_retention_snapshots/state/members 保存来源隔离的
活动/暂存快照，gift_retention_pending_finals 暂存已接收 progress 的收尾资料，
gift_retention_days 保存完整公开日分组的版本，gift_retention_receipts 保存准确去重键，
gift_local_archives 与 gift_sprint_carry 保留本机已取得资格的统计。

gift_db v20 由 [gift-wish-migration.js](../../../src/storage/gift-wish-migration.js) 幂等创建
`gift_wish_contributions`。它按许愿、source、epoch 和事件身份保存非整日窗口所需的
时间与数量；[gift-wish-retention.js](../../../src/storage/gift-wish-retention.js) 在快照替换或
明细回收的同一事务中保存这些贡献，不重放实时消费者。计数排除仍有活动明细或已由完整日
汇总覆盖的贡献；同 epoch 重建保留，换 epoch、清空来源或删除许愿时清除对应贡献。
日汇总不能还原升级前已物理删除的非整日明细，迁移不推测其数量。

`gift-wish-store.countMany` 按相同起止时间分组，一次读取当前 retention 活动快照，
每组分别聚合明细、完整日和按 wish_id 分组的非整日贡献；单项 count 复用该入口。
长效条目的创建时间不同时仍保留独立窗口，不用统一日期替代精确起点。

[gift-retention-store.js](../../../src/storage/gift-retention-store.js) 将页和检查点同事务提交，
校验固定 epoch、revision、coverage、令牌及 projection generation；下载完成后原子
切换活动快照。限流、断网和重启继续旧检查点，失败时原活动视图保持可用。
真实实时行自动加入活动成员；历史暂存行只有被活动快照选中后才对查询可见。

[gift-local-retention.js](../../../src/storage/gift-local-retention.js) 仅按服务器已发布边界，
在汇总覆盖且本地消费者已终态后每批最多回收 500 行；先结转再删除，pending 加班
和未完成统计消费不回收。[gift-retention-cleanup.js](../../../src/storage/gift-retention-cleanup.js)
分批清理废弃快照和日版本，在下载中保留暂存状态。显式清空由既有来源事务连同
这些派生表清除。SQLite 空闲页复用，不在线 VACUUM。常规全局保留任务继续排除
远程礼物行；远程礼物只能由上述专用路径回收。细则见 [规格](../../../specs/gift-retention.md)。

> 涉及文件:[src/storage/database.js](../../../src/storage/database.js)、[src/storage/database-migrations.js](../../../src/storage/database-migrations.js)、[src/storage/dynamic-lottery-migrations.js](../../../src/storage/dynamic-lottery-migrations.js)、[src/storage/dynamic-lottery-schema.js](../../../src/storage/dynamic-lottery-schema.js)、[src/storage/dynamic-lottery-store.js](../../../src/storage/dynamic-lottery-store.js)、[src/storage/dynamic-lottery-budget-store.js](../../../src/storage/dynamic-lottery-budget-store.js)、[src/storage/database-maintenance.js](../../../src/storage/database-maintenance.js)、[src/storage/schema.js](../../../src/storage/schema.js)、[src/storage/retention.js](../../../src/storage/retention.js)、[src/storage/settings-store.js](../../../src/storage/settings-store.js)、[src/storage/settings-defaults.js](../../../src/storage/settings-defaults.js)、[src/storage/settings-migrations.js](../../../src/storage/settings-migrations.js)、[src/storage/theme-store.js](../../../src/storage/theme-store.js)、[src/storage/playback-store.js](../../../src/storage/playback-store.js)、[src/storage/cooldown-store.js](../../../src/storage/cooldown-store.js)、[src/storage/daily-bot-legacy-reader.js](../../../src/storage/daily-bot-legacy-reader.js)

本文档是数据库与数据目录的**唯一事实源**:数据库文件名、表清单、DDL 要点、迁移版本、保留策略只在此成表。其他文档一律链接此处。

**内部模块边界:** `database.js` 只负责六库打开、PRAGMA 装配与对外数据库句柄；`database-migrations.js` 保持原五库 schema/data migration 执行顺序，并转发 [legacy-superchat-migration.js](../../../src/storage/legacy-superchat-migration.js) 的历史醒目留言跨库迁移入口；该模块持有旧表读取、目标库事务、去重和成功后的旧表清理。`dynamic-lottery-migrations.js` 持有抽奖库的独立命名域；动态抽奖 DDL、业务事务和请求预算分别由 `dynamic-lottery-schema.js`、`dynamic-lottery-store.js`、`dynamic-lottery-budget-store.js` 拥有；`database-maintenance.js` 拥有清理、优化与关闭等维护操作。设置域由 `settings-store.js` 提供 CRUD 门面，`settings-defaults.js` 只声明不可变默认值，`settings-migrations.js` 只执行设置键迁移。上层不得直接调用迁移或维护模块来绕过这些门面。

单个数据库在 PRAGMA 初始化完成前由 `openSqliteDatabase` 持有；失败时关闭尚未登记的句柄并保留原错误。`createDatabases` 继续清理此前已登记的数据库，成功返回后才把整组句柄交给服务器生命周期。抽奖库在原五库完成初始化后单独打开及迁移；其失败会关闭新连接并返回 `lotteryDb: null`，由抽奖 runtime 禁用本功能，不改变点歌、礼物和播放的既有启动语义。关闭失败沿用 `closeDatabases` 的逐库警告并继续清理；这不撤销已经提交的初始化或迁移数据。

`requester-target-store.js` 持有随机点歌请求者查询，由 `server/domain-services.js` 注入 `songDb`。查询和返回结构沿用既有合同，见 [音乐服务 §12](music/services.md#12-请求者定位storagerequester-target-storejs)；本次归位不改变表、排序或迁移版本。

### AI 与加班机存储适配器

[ai-state-store.js](../../../src/storage/ai-state-store.js) 由 `server/ai-runtime.js` 在 `songDb` 上创建，注入 AI 配置领域。它持有配置、请求日志、黑名单、会话和查询缓存的 SQL；配置及 provider 人格映射在同一事务内写入，提交前将候选行交给领域校验，异常回滚。密钥加解密、有效 origin 检查、公开脱敏、TTL 和哈希键规则仍由 `ai/config-store.js` 拥有，领域缓存仅在提交成功后更新。细节见 [AI 参考](ai.md)。

[overtime-store.js](../../../src/storage/overtime-store.js) 由 `server/domain-services.js` 在 `giftDb` 上创建，注入加班机服务；它保留状态、规则、结算和 `BEGIN IMMEDIATE` 事务，计时器与恢复调度仍由领域服务持有。领域 `overtime/index.js` 只导出合同、service 和 consumer。两项归位不改变数据库文件、schema、设置键或持久化格式。细节见 [加班机参考](overtime.md)。

### 歌库显式更新事务

`songStore.applyImportUpdate(buildPlan)` 在单个事务中读取完整歌曲及分类，将稳定行对象传给音乐域计划器重新校验预览，然后执行该计划的 INSERT/UPDATE，整份替换计划还会 DELETE 未列出的歌曲。匹配歌曲保留 id 和引用；删除歌曲先解除 queue/requests 的 song_id 关联，保留点歌记录文本。保留独立分类目录；插入新分类、歌曲增删改、引用变更及云同步 pending 快照一起提交或回滚。事务内不发生网络调用，成功后的同步由路由触发。

`importRows`、`applyImportUpdate` 与 `replaceAll` 在各自事务内按分类名复用分类行；新分类只解析一次，映射不跨事务保存，失败回滚后下一批重新读取。歌曲 INSERT 与导入 UPDATE 复用连接上的预编译语句。批量入口不逐首读回已插入的歌曲，单首保存仍读取并返回完整行；不改变每首歌曲的写入、导入计数或同步 pending 的提交规则。

导入数量只通过实时响应返回，包括新增、未改变、更新、新分类及替换时的删除数量；不再写入没有历史读取用途的 `import_batches`。旧表保留兼容，已有批次由保留期维护清空，不影响歌曲或当次导入结果。预览 token 含全部歌曲与分类内容、时间戳和导入选项（包括 replaceAll），不依赖内存全局租户状态。要求见 [点歌资料规范](../../../specs/song-request-metadata.md)。

### 本地场景持久化

文本框的用户上传图片由 [scene-text-images.js](../../../src/server/scene-text-images.js) 保存在 `dataDir/scene-text-images/`，属于持久素材，不进入可清理的礼物图片缓存。文件名由服务生成 UUID v4，扩展名仅 png/jpg/gif/webp；单文件上限 5 MiB，原字节保留动画，以同目录独占临时文件写入后重命名，失败清理临时文件。场景结构化 token 仅保存本地图片路径，不保存原始文件路径或二进制；删除 token 或放弃草稿不自动删除素材，防止破坏已发布场景的引用。当前没有自动清理策略；上传/读取权限见 [HTTP API](api.md#本地场景)。

songDb 的 v8 迁移通过 `scene-migration.js` 新增 `component_scenes`，不改写旧表。列为 `id`、`owner_scope`、`draft_json`、`revision`、`published_json`、`published_version`、`capability_version`、`capability_hash`、`capability_encrypted`；按 owner_scope 建索引。草稿与发布 JSON 均限制为 256KiB。`scene-store.js` 用单条带归属和期望版本条件的 UPDATE/RETURNING 原子提交；失败不改变旧行。

展示读口仅查询当前行的 `published_json`、`published_version` 和 `capability_hash`，不读取草稿与加密来源包。每个 store 最多保留 32 份按账号与场景区分的深冻结发布文档，只有实际 JSON 原文相同才复用解析与组件类型索引；外部写入、回滚恢复原文、删除均由下一次数据库读取识别。每次请求和 SSE 心跳仍重新核验 owner、token、版本及投影回执；异步展示完成后另行窄读当前 capability hash，认证结果不缓存。返回给展示调用方的公开文档是独立副本，不可污染内部缓存。

v9 追加 `component_output_sizes`：主键 `(owner_scope, component_type)`，列 `width/height`
为 32–7680 的像素尺寸；类型限 clock、queue、overtime、danmaku。旧数据库从空尺寸表升级，
不修改已有文档或业务配置。`scene-store.publish` 用保存点事务提交场景发布版和其中共享
组件的默认输出尺寸，任一写入失败整体回滚。独立实例尺寸仍只保存在场景文档中。
删除场景中的共享图层不会删除已保存的默认尺寸；记录随本地库保留，读取受当前账号限制。

v10 追加 `component_canvas`：`owner_scope` 为主键，`output_scene_id` 固定组合直播源，
`active_scene_id` 记录最近应用的预设，后两列引用已有场景。迁移按旧列表的 ID 排序选首个
场景作为初始绑定，保留所有草稿、发布快照和来源凭据；新账号首次打开画布时绑定。
新建预设不会改变绑定。画布发布在同一保存点中检查预设修订号与输出发布版本，提交固定
来源的发布快照、活动预设及共享尺寸；两个场景的草稿都不被覆盖。跨预设浏览器 URL
按固定输出场景 ID 重新加密绑定，任何失败整体回滚。选择中的预设和未保存草稿属于编辑会话。

v11 为 `component_scenes` 追加 `is_preset`（0/1，默认 1），将 `component_canvas.active_scene_id` 改为可空。
旧文档、发布快照、绑定和凭据保持不变，迁移可重复执行。删除固定输出的预设时将其标为 0 并清空草稿图层；
该行只保留固定来源与发布职责，不再列入预设、允许编辑或占用草稿素材引用。备份仍包含其发布快照。
`scene-store.delete` 用保存点检查 owner、预设 revision、当前绑定及输出版本；删除当前输出时同时核对替代预设 revision，
提交替代已保存布局、活动 ID 和共享尺寸，无剩余预设则发布透明空文档并将活动 ID 置空。任一失败整体回滚。
普通预设行实际删除，其他场景草稿、来源凭据和素材文件不变。保留的固定绑定也用于区分首次使用和主动删空。

capability_hash 为随机 256 位 token 的 SHA-256，capability_encrypted 保存 safeStorage 加密的 schema、归属、scene ID、凭据版本和 token 包。无明文回退；解密后复核全部绑定与摘要。历史、选择、实时事件与业务状态不入场景表；场景随本地数据库保留，没有自动删除策略。接口见 [HTTP API](api.md#本地场景)，边界见 [ADR-0022](../../architecture/adr/0022-local-component-scenes.md)。

独立 `browser` 场景项的第三方 URL 在写入 `draft_json` 或 `published_json` 前，由场景 owner 使用同一 secret codec 加密为 `{ schemaVersion: 1, encrypted }`；密文包绑定 owner scope、scene ID 和 item ID。授权读取时校验绑定并恢复 URL，模板及持久化编辑恢复副本不保留 URL。既有场景 JSON 不变，不新增表或迁移；加密后的完整 JSON 仍受 256 KiB 上限约束。显示视口与图层尺寸的合同见 [组件场景规格](../../../specs/component-scenes.md)。

## 本地组件样式库

资源型配套样式的共享参数由样式库 `updateConfig` 在单次同步索引事务中修改：服务层合并补丁并经 `normalizeSceneConfig` 校验后原子替换索引。素材身份、路径、包摘要和文件保持不变；保存失败不改变原索引。重启、同版本重新安装和软删除恢复保留已保存值，新版本使用新包默认值。同 ID 的场景实例读取库中共享参数；软删除后仍读取保留索引的最后保存值，但拒绝继续写入，重新导入可恢复。普通媒体/CSS 保留场景快照。

2026-10-08 的共享参数变更不批量重写已有场景。读取时以客户端已保存字段覆盖旧副本，布局保持独立。新增 `clockStyleOptions`（JSON 字符串，默认 `{}`）按受支持的内置时钟样式保存白名单外观字段；首次读取从原客户端标量设置补齐，旧标量写入只更新选中样式。新增 `blindboxOverlayTop`（-1–10，默认 3）、`blindboxWinnersOnly`（默认 true）、`blindboxHeartBoxOnly`（默认 false）和 `blindboxOverlayTitle`（默认空字符串，页面回退“今日盲盒盈亏”），使新复制的盲盒地址跟随保存设置。均使用现有 settings 存储，无新表或 schema 迁移。

心动盲盒的展示参数同样由客户端与画布共享：`blindboxCastleMultiplier` 默认空字符串（隐藏倍数），非空为 0.01–1000、最多两位小数；`blindboxCastlesRemaining` 默认 `'0'`，范围为 0–99999 整数，由用户手动填写，不随出堡扣减。`blindboxShowCastlesRemaining` 与 `blindboxShowOpenedSinceCastle` 默认 `'false'`，分别控制剩余堡数及自动开盒进度；开关接受布尔值或布尔字符串，保存为字符串。关闭心动盲盒筛选时隐藏专属展示，但保留这些已保存值。

盲盒紧凑布局 `blindboxCompact` 默认 `'false'`，自动翻页 `blindboxAutoPages` 默认 `'true'`，使用相同布尔归一化规则，分别映射画布的 `compact` / `noScroll`。画布只显示一个「仅显示盈利」开关；旧 `hideLoss` 字段保留为 `blindboxWinnersOnly` 的兼容别名。字体、字重、字号比例及背景/文字/主色/强调色继续使用现有通用主题键，不增加另一份主题配置。

[component-style-store.js](../../../src/storage/component-style-store.js) 拥有设备本机 `dataDir/component-library/`，不写云设置或礼物数据库。`index.json` 为 `{version:1,packages:[]}`，写入同目录随机临时文件后 rename 替换；媒体保存为 `<包 UUID>/<SHA-256>.<扩展名>`，网页保存为 `<包 UUID>/web/<原相对路径>`。场景的独立外观配置持有互斥的 `mediaStyle`、`resourceStyle` 或 `cssStyle` 快照，新增可选字段不改变旧场景格式。HTML 导入保存为 browser 配置，库中可选 `category` 记录原组件分类；浏览器地址仍走既有加密保存与模板脱敏合同。

索引合同仍为 v1，无需迁移。`component-style-index.js` 在主索引提交后保存同内容的 `index.backup.json`；副本失败只报告恢复能力降级，不回滚已提交的安装。旧库首次读取会补齐副本。主索引缺失、损坏或结构无效时，从有效副本恢复；损坏原件保留为 `index.damaged-<UUID>.json`，`index.recovery.json` 记录恢复提示。两份均不可用时返回 503，不重建空库；高于当前支持版本的索引拒绝读取，不用旧副本降级。每包 `package.json` 是导入快照，后续参数以索引及其恢复副本为准。

同一素材根目录共享已验证的索引缓存。每次读取检查主索引与副本的文件身份、大小和纳秒修改/状态时间；未变化时返回独立副本，不再重复读取及解析 JSON。索引写入立即更新缓存，外部改动或文件缺失重新进入上述校验与恢复流程；副本降级期间继续尝试修复。

上传及 ZIP 检查只写 `.pending-<UUID>/`；确认时将整个目录 rename 为最终 UUID，再原子更新索引；索引失败则移回暂存。操作失败或显式取消清理本次暂存。打开库时回收超过 24 小时、且未被本进程导入占用的暂存和索引临时文件；同一目录每小时至多扫描一次，避免场景持续读取触发重复遍历。链接或被锁定文件保留。未登记的正式 UUID 目录保留供核对，不自动删除。

相同作者 ID、版本、ZIP 摘要重复安装幂等，并能恢复该包或成员的 `removed` 状态，复用原安装 UUID 和资源；同 ID 同版本不同内容返回冲突，作者需提高版本。所有标准素材包（含单组件多变体包）安装时在一次索引提交中将同 packageId 的其他已安装版本设为 `removed`，包括旧客户端留下的并存版本。套装分类由未过滤的完整成员及同 packageId 历史记录推导，不新增持久化字段，旧成员被移除或新版减少组件类型都不会改变既有套装身份。

服务层的 [component-style-install.js](../../../src/server/component-style-install.js) 统一素材、网页样式和套装的安装重试：仅新包待确认目录移到正式目录时的 `EPERM` / `EBUSY` 最多重试四次，每次重新授权；不重放失败的索引事务或回滚。存储层写好临时索引后，遇到这两类锁定错误只重试该临时文件到 `index.json` 的原子重命名，最多四次、累计等待 500 ms；等待保持同步以免其他写入插入当前事务，持续失败仍回滚。清理后的同版本原包恢复与备份批量恢复，目录移动和回滚也使用相同上限的同步重试，保留原身份及参数。磁盘格式不变。

已有场景不自动升级。库最多登记 1000 包。整包删除设置包级 `removed`，逐样式删除保留既有成员级 `removed` 合同，列表同时过滤这两类标记。两种删除均保留索引和媒体文件，保证未打开的预设和已发布场景仍能使用，不立即释放磁盘空间。目录随应用数据备份和迁移，不随 EXE 更新覆盖；不支持只复制场景到其他电脑而不带素材目录。

文件与导入限制见 [API 合同](api.md#组件样式库)，样式字段见 [overlay 合同](../frontend/overlays.md#本地媒体样式)。

专用备份由 `component-library-transfer.js` 编排资源 ZIP，`scene-transfer.js` 只导出当前账号的显示文档并负责新的场景凭据，场景批量插入由 `scene-store.js` 的 savepoint 事务提交。不改变任何表或索引版本。归档参数来自最新索引，文件保留原相对路径并记录 SHA-256；恢复重映射包、样式、文本框图片及场景身份。恢复副本 ID 由归档摘要、来源 ID（场景另含当前账号的 scope 摘要）确定，重复恢复不会覆盖既有副本上的修改。素材包名加「备份」，作者 ID 使用 `backup.` 命名空间，避免与原安装包或当前参数冲突；版本号保持不变。先登记隐藏素材，再事务创建未发布场景，最后恢复库可见性；失败可用同一备份安全续作，隐藏无引用资源可清理。原直播绑定、原场景和凭据均不覆盖。外部浏览器源、电脑本地加班机背景路径、未保存草稿及业务数据不导出；导入的本地 HTML/CSS 及其配套资源随包迁移。

`component-library-maintenance.js` 盘点实际磁盘体积。手动清理重新检查所有账号的保存/发布文档（经场景 owner 解密）、预览中保存/未保存配置及待处理编辑命令，并保留可见样式的依赖。缺失正在使用的资源、索引故障、恢复副本不可写、引用解密失败或目录链接都会阻止清理。仅整包已移除或全部成员已移除且无引用的目录可回收；先 rename 为 `.purged-<UUID>` 再删除，失败可再次检查，异常残留沿用 24 小时回收规则。保留索引中的历史身份、参数和分类，重新导入完全相同的 ZIP 可补回原 UUID 的文件。

## 1. 技术选型

礼物投影读写由 `gift-projection-store.js` 拥有，参与调用者已有的历史/游标事务；统计投递由 `gift-statistics-store.js` 拥有独立的 `BEGIN IMMEDIATE` / COMMIT / ROLLBACK，原子检查并标记已投递。两个适配器保持既有表结构与同步调用，不把数据库句柄或 statement 暴露给领域实现。领域校验、终态决策和提交后扇出见 [gift.md](bilibili/gift.md#3-历史导入与存储边界)。

- **`node:sqlite` 内置模块 `DatabaseSync`**(同步 API),零第三方数据库依赖;要求 Node ≥ 24(见 [engineering/build.md](../engineering/build.md))。
- 每库统一 PRAGMA([database.js](../../../src/storage/database.js)):`journal_mode=WAL`、`synchronous=NORMAL`、`cache_size=-8000`、`temp_store=MEMORY`;`songDb`/`giftDb`/`musicDb`/`lotteryDb` 额外 `foreign_keys=ON`。
- **多库拆分**:按域隔离,避免单库写锁竞争与误清数据,详见 ADR [0004-reuse-monolith-and-gift-db](../../architecture/adr/0004-reuse-monolith-and-gift-db.md)。

## 2. 数据目录布局(唯一成表处)

豆包账号的加密 Cookie 快照新增于业务 `dataDir/doubao-auth/cookies.enc`；Chromium 分区仍位于独立 userData。加密不可用时仅用内存会话，不保存快照。格式与清理边界见 [桌面认证](../desktop/auth.md#16-豆包个人账号)。`ai_configuration` 的私有 `doubaoPreviousKeyOrigin` 配置行供豆包与 ChatGPT 订阅共用，用于恢复 API 供应商时检查原密钥 origin，详见 [AI 订阅与账号路由](ai.md#45-chatgpt-订阅与-kimi-api)。

ChatGPT 订阅复用 `ai_configuration`，不新增文件或 schema：`chatgptHostId` 是稳定本机标识，`chatgptAccounts` 为加密账号记录（`is_secret=1`），均由 AI 会话模块内部读写，不经公开配置接口。系统加密不可用时拒绝登录，无明文回退；退出删除当前账号令牌，保留注册映射。具体凭据与生命周期契约归 [AI 域](ai.md#45-chatgpt-订阅与-kimi-api) 所有。

`dataDir` 解析顺序:`runtimeOptions.dataDir` → 环境变量 `SONG_PLUGIN_DATA_DIR` → 仓库根 `data/`([runtime-config.js](../../../src/server/runtime-config.js));Electron 打包版使用 `<安装目录>/data`，首次安装有 D 盘时默认 `D:\LIRA\data`，无 D 盘时跟随原默认安装位置；开发版继续使用仓库根 `data/`，升级保留与旧 AppData 兼容读取见 [desktop/main.md](../desktop/main.md) §3。

旧 AppData 目录的首次复制在来源业务根的 Electron 单实例锁内执行，并先确认来源服务已停止；复制成功后原子发布目标，再切换到目标业务根的实例锁。已有目标不覆盖，来源仍在使用或运行标记无效时中止迁移，原始数据保留。

```
data/
├── song-request-data.db       # 点歌库(songs/queue/requests/settings/AI/主题/冷却)
├── super-chat-data.db         # 醒目留言库
├── gift-data.db               # 礼物库(gift_events + 加班机三表)
├── music-data.db              # 播放器库(历史/队列态/收藏/歌单)
├── checkin-data.db            # 签到库
├── lottery-data.db            # 动态抽奖任务、证据、冻结轮次、结果与请求预算
├── cache/                    # 可重建的业务缓存
│   ├── overtime-gift-catalog-v2.json      # 官方 gold 礼物与盲盒关系镜像
│   ├── overtime-gift-assets-state-v2.json # 图片扫描完成状态
│   ├── overtime-gift-images/ # 礼物图片与 index.json
│   ├── fonts/                # 共享字体与 index.json，可重建且升级保留
│   ├── music-api-cache/      # 音乐 API 响应(TTL 5 分钟)
│   └── music-lyrics-cache/   # 歌词(TTL 30 天)
├── browser/                  # Electron userData/sessionData；包含持久资料
│   ├── Partitions/           # 音乐与 Bilibili 的独立登录分区
│   ├── Network/              # 默认会话 Cookie 等网络状态
│   ├── Local Storage/        # 默认会话的 localStorage
│   ├── Cache/                # Chromium 自行管理的缓存
│   └── Crashpad/             # 崩溃报告；其余 Chromium 文件也在 browser 下
├── .browser-layout-v1.json    # 浏览器目录迁移日志
├── .cache-layout-v1.json      # 缓存目录迁移日志
├── .session-token             # 会话令牌(0600,服务关闭时删除)
├── .server-runtime.json       # 运行时信息 {pid, port, host}
├── music-auth/qq.cookies.enc          # QQ 音乐 Cookie 快照(safeStorage 加密)
├── music-auth/netease.cookies.enc     # 网易云 Cookie 快照
├── bilibili-auth/cookies.enc          # B站 Cookie 快照
├── license/                   # 设备授权资料与 safeStorage 加密私钥
├── opening-music/             # 用户上传音乐，经典舞台与像素卡带分别保存选择
├── scene-text-images/         # 文本框上传图片，保持原字节与持久保存
├── component-library/        # 本机组件素材、索引与待确认套装
└── local-media-access.json      # 本地媒体文件允许清单
```

认证文件格式与生命周期见 [desktop/auth.md](../desktop/auth.md);`logs/` 目录(ai.log / terminal.log / desktop.log)位于 data 目录的**父目录**。

大播放器外观属于默认会话的 localStorage 界面偏好，不写入 SQLite 设置或播放快照；键、字段和恢复行为见[播放器外观](../frontend/playback.md#81-大播放器外观)。

路径由 [data-paths.js](../../../src/shared/data-paths.js) 统一计算；`dataDir` 与数据库/授权/上传路径未改变。桌面持有原数据根的单实例锁后，[data-directory-migration.js](../../../src/storage/data-directory-migration.js) 在 ready 前迁移已知浏览器文件与缓存。独立服务及礼物初始化脚本在使用缓存前执行相同缓存迁移。迁移采用落盘日志与同卷重命名，中断可续作，目标冲突、缺失条目、符号链接及活动服务阻止迁移；未知文件保留原处。日志原子替换遇到 `EPERM` / `EBUSY` 时，仅对同一准备文件最多重试四次，累计等待最多 500ms，不重放数据移动；持续失败保留原日志并中止启动。`browser` 包含登录和界面资料，不能整目录当缓存清理。具体取舍见 [ADR-0016](../../architecture/adr/0016-separated-client-data-lifecycles.md)。

## 3. 六库 × 表清单(唯一成表处)

### 粉丝档案（songDb v6 新增六表）

2026-10-09：档案 JSON 增加可选 `guardAccompany: {days,roomId,observedAt,source}` 平台观察，scope JSON 增加 `accompanyMilestones` 和 `showAccompanyInCalendar`。复用现有事务/乐观 revision，旧数据无须 schema 迁移；新观察、重复会员事实补全及游标原子提交。完整备份保留并校验这些字段，兼容 v1 导入；预计日历事项只作内存投影，处理状态继续存入 `fan_reminder_states`。规则和默认值由 [粉丝档案规格](../../../specs/fan-profiles.md#平台陪伴天数与日历纪念日2026-10-09) 维护。

`fan-profile-migration.js` 在现有 songDb 的迁移事务内新增以下六表；`fan-profile-store.js` / `fan-record-store.js` 持有 SQL，`src/fans/` 持有领域规则。

| 表 | 责任与约束 |
| --- | --- |
| `fan_profiles` | UUID 主键；scope 是 canonical Server origin + authenticated streamerId；scope + typed identity 唯一；JSON 与乐观 revision |
| `fan_records` | 档案外键级联；UUID、scope + source_key 唯一；歌曲只保存汇总，其他类型分别保存原始事实、当前数据与修订 |
| `fan_roster_templates` | v14 新增；按 scope 隔离，未编辑的自动名单观察共享相同 data/original；时间与来源键仍逐条保存在 fan_records，最后一个引用移除后回收模板 |
| `fan_reminder_states` | scope + profile + item_key 唯一；已处理、忽略、稍后与事项来源 |
| `fan_scopes` | 自动设置、epoch/cursor；事实与游标同事务提交；可选 `autoSyncGuardRoster` 默认 false，`lastGuardRosterAutoUpdate: {date, roomId}` 与自动名单导入同事务保存，按归属/房间/北京时间日期去重 |
| `fan_suppressions` | 当前 scope 黑名单的最小 typed identity 标记；屏蔽档案展示和写入，旧删除排除标记兼容 |
| `fan_restore_snapshots` | scope 内恢复/合并之前的完整快照，只保留最新两份；恢复点操作校验归属 |

songDb v15 为 `fan_records` 和 `fan_reminder_states` 分别增加 `idx_fan_records_profile_id`、`idx_fan_reminder_states_profile_id`，均以 `profile_id` 为索引键。父档案删除的外键级联由这些索引定位子行，不依赖 ANALYZE 后的 skip-scan；原有 scope 查询索引、外键和事务保持不变。

`fan-profile-store.list(scope)` 默认排除黑名单，不额外读取每份档案的抑制状态；完整备份与恢复点替换显式传入 `{includeSuppressed:true}`。`get` / `byIdentity` 供内部身份匹配及备份使用，应用服务对详情、手动写入与自动写入执行黑名单规则。完整备份保留黑名单及被屏蔽的原资料，恢复时合并当前黑名单，仅 `unsuppress` 明确解除；黑名单不新增 schema。

`requests` 保存 `stable_id`（唯一 UUID）、`owner_scope`、`identity_type` 和 v13 新增的 `fan_recorded`。普通点歌入队、更新档案歌曲汇总与标记已归档在同一事务提交；仍在队列中的请求通过稳定标识和标记避免重复计数。旧流水不猜归属，也不补记以前遗漏的档案记录。`done`、`deleted`、`skipped` 及清空队列会物理删除对应的 `queue` / `requests` 行，已计入档案的次数不扣除；`done` 只表示队列已处理。

songDb v13 由 [fan-song-migration.js](../../../src/storage/fan-song-migration.js) 将每份档案中规范化歌名与歌手相同的 `song` 合为一条：`data` 保存 `songName`、`artist`、累计 `count`、最新三个不同上海日期 `recentDates`、按日期/分类计数的 `dailyCounts` 和合并的手写 `note`，`original` 为 `{}`、`revisions` 为 `[]`。不保留逐次原始记录或歌曲修订；其他记录类型保持原始依据与修订。旧 `excluded` 和随机点歌不贡献汇总；旧 `excludeFromStats` 仅排除近 30 天计数，仍贡献累计次数和最近日期。汇总和校验规则由 [song-summary.js](../../../src/fans/song-summary.js) 持有。

`fan-record-store` 在写入、档案读取、完整备份导出及启动/每小时 retention 时清理早于上海当天及前 29 天的 `dailyCounts`，保留累计次数和最近三个日期；时钟回退产生的未来日期桶暂存，但不计入当前展示。档案表不参与 clear-all。自动恢复点按 `created_at DESC, rowid DESC` 每个 scope 保留两份，由 [fan-snapshot-retention.js](../../../src/storage/fan-snapshot-retention.js) 清理。新快照插入、旧快照清理及恢复/合并处于同一事务，失败时原档案和恢复点均回滚。

完整备份 `lira-fan-profiles` 导出 v2，接受 v1 并将逐次歌曲转换为汇总；其他类型的原始依据、修订、提醒和抑制保持不变。恢复前校验数据与预览摘要并保存恢复点。v13 同事务转换并精简既有恢复点，也建立 [queue-history-store.js](../../../src/storage/queue-history-store.js) 的有限随机点歌缓存后删除旧终态队列与流水；不从这些旧流水补记档案。具体用户行为见 [粉丝档案规格](../../../specs/fan-profiles.md#点歌汇总展示2026-10-12)。

songDb v14 由 [fan-roster-observation-migration.js](../../../src/storage/fan-roster-observation-migration.js) 为 `fan_records` 增加可空的 `roster_template_id` 外键。只压缩从未修订、仍被采用且未排除的纯自动名单观察，将除 `observedAt` 外的重复 JSON 保存一次；读取按记录时间完整还原，ID、sourceKey、历史判断和备份格式不变。编辑时在事务中展开原始依据并解除引用；删除、恢复与合并后回收无引用模板。人工记录、手动同步和真实购买事实不参与压缩。每个真实观察日期仍有一条小记录，因此这是无损去重，不是历史数量上限。

非歌曲记录保存仍先校验乐观 revision；最终数据与日期都未变化时返回原记录，不追加空修订或展开模板。真实修改继续保留完整 before/after 和原始依据，既有修订不因本轮维护而删除。

档案 JSON 可选 `guardRoster: { roomId, ownerUid, observedAt, level }` 保存最近完整名单确认的身份，`level` 为 1/2/3 或明确缺席时的 null。导入与原始观察在同一事务提交，缺席不删除记录或修改有效期；未知身份、跨房间缺席和迟到快照不能清除较新的已知身份。旧档案无需 schema 迁移，缺字段时从原有名单观察兼容读取；完整备份保留并验证该可选字段。

业务表见下表，各库另有一张 `schema_version`。文件常量 `DB_FILE_NAMES`、五个既有库的 DDL 与抽奖库 DDL 分别位于 [database.js](../../../src/storage/database.js)、[schema.js](../../../src/storage/schema.js) 和 [dynamic-lottery-schema.js](../../../src/storage/dynamic-lottery-schema.js)。

### 3.1 song-request-data.db(点歌库,26 表)

其中七张粉丝档案相关表（含 v14 名单模板）见本节前的专表；其余表如下。

| 表                  | 用途                                                         | 关键列/索引                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`          | 全部设置键值(key/value/updated_at),见 §7                     | key PK                                                                                                                                                                                                                                                                |
| `ai_configuration` | AI 配置、凭据及角色包（与 settings 隔离） | key PK、`is_secret` 标记；`personaPacks` 为既有 value 列中的 JSON 数组，`personaId` 为当前角色，`providerPersonaIds` 为服务端维护的各平台人格选择 JSON 对象，`systemPrompt` 保留自定义草稿；格式见 [ai.md](ai.md) §7.3 |
| `ai_request_logs`   | AI 请求审计日志                                              | uid/user_name/category/status/latency_ms/input_tokens/output_tokens/tool_calls/error_code;idx created_at                                                                                                                                                              |
| `ai_api_usage`      | 月度配额计数                                                 | PK(category, month_key)、request_count；配额 store 初始化和跨月访问时保留北京当月、上月及未来月份，回收更早月份 |
| `ai_viewer_context` | 观众短期多轮对话 | uid PK 保存可信房间/观众/人格作用域摘要；payload v2 含 sessionId、exchanges、truncated，兼容旧一问一答结构；expires_at 为到期时间。历史预算、按送达续期与周期清理由 [AI 契约](ai.md#33-连续互动与空闲清理) 定义；旧键不猜测房间迁移 |
| `ai_query_cache`    | 查询缓存                                                     | cache_key PK、expires_at                                                                                                                                                                                                                                              |
| `ai_blacklist`      | AI 黑名单                                                    | uid PK、reason                                                                                                                                                                                                                                                        |
| `song_categories`   | 歌曲分类                                                     | name UNIQUE、sort_order、is_enabled                                                                                                                                                                                                                                   |
| `songs`             | 曲库                                                         | name/name_pinyin/name_initial/artist/category_id/tags/language/source_platform/request_price/song_clip/original_group;`request_price` 保存自由文本点歌价格说明，`song_clip` 保存自由文本歌切链接或说明；唯一索引 `idx_songs_name_artist(name, artist)` 由迁移 v3 创建 |
| `queue`             | 当前点歌队列；处理、移除或清空时物理删除                      | song_id(FK)、requester_* 元数据、source(admin/danmaku/…)、status、is_pinned/pinned_at、is_live（默认 0，部分唯一索引限制最多一条 LIVE）;idx(status, is_pinned, pinned_at, created_at)                                                                                                                                   |
| `requests`          | 活动队列的点歌信息，与队列同时删除                           | queue_id/song_id(FK)、message、stable_id、owner_scope、identity_type、fan_recorded;idx created_at、idx(requester_uid, created_at)、idx song_name                                                                                                                                                                           |
| `random_request_history` | 随机点歌最近 10 首避重及最近可识别点歌人，最多 11 行 | request_id PK、song_name、requester_uid/requester_name、source、created_at；与随机入队同事务更新 |
| `import_batches`    | 兼容旧库的批量导入摘要                                       | 不再新增，已有行由保留期维护清空；导入结果仍正常返回 |
| `theme_presets`     | 主题预设(外观键收成一行一套)                                 | name UNIQUE、scope、payload、is_builtin;idx(scope, sort_order, id)                                                                                                                                                                                                    |
| `song_cooldowns` | 单首歌曲冷却，独立于队列与歌库 ID | `(owner_scope, song_key)` 复合主键、`accepted_at_ms`；与入队同事务写入，清空队列和歌库保留，清空全部数据删除；维护只删除严格早于最长支持期限 999 天的记录，保留边界和未来时间 |
| `user_cooldowns`    | 用户点歌冷却(**重启后从 DB 恢复**,防绕过)                    | user_key PK（v2 键含可信 fanScope、身份类型和稳定 ID）、last_request_at、request_count；旧无 scope 键不由消息处理器消费；恢复只接受最近 24 小时且不晚于当前时间的行，未来行在读取/清理时丢弃                                                                                                                                                                                                                           |
| `component_scenes` | 本地场景草稿、发布快照及来源凭据 | owner_scope 隔离、乐观 revision、加密 capability；完整列及删除语义见[本地场景持久化](#本地场景持久化) |
| `component_output_sizes` | 按账号保存共享组件默认尺寸 | PK(owner_scope, component_type)、width/height；与发布快照原子提交 |
| `component_canvas` | 固定组合直播源与最近应用的预设 | owner_scope PK、output_scene_id、可空 active_scene_id；沿用场景外键 |

### 3.2 super-chat-data.db(醒目留言库,2 表)

| 表            | 用途    | 关键列/索引                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `super_chats` | 仍在显示的 SC | platform_id、price REAL、status(active/assisted);idx(status, created_at)、idx created_at |
| `super_chat_receipts` | 已移除 SC 的最小防重标识 | 仅 platform_id 主键，无正文、昵称、金额、用户资料或时间 |

v2 的 [superchat-receipt-migration.js](../../../src/storage/superchat-receipt-migration.js) 将旧 `deleted` 行转为防重 ID 并删除内容，活动与已处理的显示项保留。删除触发器在同一事务写入 ID，覆盖手动删除、平台撤回、清空和显式配置的按天清理；没有平台 ID 的已删留言不留记录。平台撤回先于原消息时也保存 ID，迟到包不会重新入库。防重 ID 不按天删除，清空使用记录也保留。

历史数据由 `migrateLegacySuperChatsToDedicatedDatabase` 从 songDb 旧表迁移后删表([legacy-superchat-migration.js](../../../src/storage/legacy-superchat-migration.js))。旧表的 `deleted` 行同样只转移 ID，已存在防重 ID 的消息不会因迁移重试恢复内容。

### 3.3 gift-data.db(礼物库,16 表，含上文礼物保留表)

| 表                       | 用途                                                                 | 关键列/索引                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gift_sources`           | 远端主播来源字典                                                   | `source_key` 唯一；renderer 不接收或选择内部 `id`                                                                                                                                                                                  |
| `gift_events`            | 礼物事件 + **共享检测账本**(见 [bilibili/gift.md](bilibili/gift.md)) | 业务列 + `source_id` + 检测列；可空 `blind_box_id` 保存服务端确认的盒子礼物 ID，旧/未知来源保持 `NULL`；legacy 身份索引 `(platform_id, uid)`，远端幂等索引 `(source_id, platform_id, cmd)`，来源/时间复合索引 |
| `gift_sync_state`        | 每个来源的投影恢复状态                                             | `source_id` PK、epoch/final cursor、bootstrap token/锚点、`projection_generation`、最后验证时间                                                                                                                                     |
| `overtime_machine_state` | 加班机单例状态                                                       | **id=1 CHECK 单行**;enabled/enable_epoch/initial_seconds/remaining_ms/anchor_at_ms/status(paused\|running\|finished)/background_path/background_fit(cover\|contain\|fill)/revision,见 [overtime.md](overtime.md)                    |
| `overtime_gift_rules`    | 加班机礼物规则                                                       | gift_id PK、mode(fixed\|random\|display)、fixed_seconds、outcomes_json、enabled、sort_order；display 文字与数量模式存于 outcomes_json                                                                                               |
| `overtime_settlements`   | 结算流水(幂等)                                                       | gift_event_id **UNIQUE**、status(pending\|applied\|ignored)、rule_snapshot_json、requested/applied_delta_seconds、settle_after_ms、retry_count;idx(status, settle_after_ms)、idx(status, id DESC)                                   |
| `gift_wishes` | 礼物许愿定义 | id PK、source_id FK、period(long/day/session)、礼物/variant 身份、类别、展示图片、整数 target、说明与创建时间、display_style（默认 card）、text_template（默认空）、text_image_position（默认 none）、text_image_format（默认 animated）、text_pending_color / text_received_color（默认空字符串，使用共享文字渲染器默认色）、text_runs（JSON 数组文本，默认 `[]`，保存与模板一致的分段格式）；来源/创建时间索引 |
| `gift_wish_sessions` | 最近确认的直播窗口 | source_id PK/FK、room_id、started_at、可空 ended_at、checked_at；按房间和当前来源读取；ended_at 记录下播前最后确认仍在直播的时间以关闭旧窗口，不代表实际下播时间 |
| `gift_wish_contributions` | 许愿非整日精确贡献 | wish_id FK（删除级联）、source_id FK、sync_epoch、platform_id、created_at、num；主键 `(wish_id,sync_epoch,platform_id)` |

v13 由 `gift-wish-migration.js` 幂等建表，v14 追加每条许愿的展示样式和文字模板，v15 幂等追加文字版图片位置和格式，v16 幂等追加两种文字颜色配置；旧许愿保留样式、文案和创建时间，文字版图片默认隐藏，颜色为空时使用渲染器默认值。原事件不变；许愿进度和今日数量实时从账本计算，不持久化今日收礼状态或首帧 PNG，删除礼物流水会影响统计。状态存储由 `gift-wish-store.js` 拥有。

### 3.4 music-data.db(播放器库,5 表)

`play_queue_state.payload` 的 `snapshotVersion` 保存最后接受的 writerId/generation/senderGeneration/sequence，另保存已分配页面代次的高水位，无 SQL schema 变更。领取代次与保存检查均在 `BEGIN IMMEDIATE` 事务中完成；领取不改变已接受版本，只有新页面实际保存才推进门槛，避免未执行的 HTML 请求使活动播放器停止保存。重建 store/重启进程不会遗失已分配和已接受的顺序。单独清除队列保留排序元数据，只有元数据时读取仍返回空，避免已接受旧版本重放复活队列。尚未接受版本化快照前保留无版本写入兼容；接受后禁止无版本降级。请求和返回合同见 [api.md](api.md) §5。

| 表                 | 用途                                    | 关键列/索引                                                                             |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `play_history`     | 播放历史                                | client_id/track_key/source/track_id/play_count/played_at;唯一 idx(client_id, track_key) |
| `play_queue_state` | 播放队列快照(按 client 存 payload JSON) | client_id PK                                                                            |
| `favorites`        | 收藏                                    | track_key UNIQUE、sort_order                                                            |
| `playlists`        | 歌单                                    | name UNIQUE、sort_order                                                                 |
| `playlist_tracks`  | 歌单曲目                                | FK playlist_id ON DELETE CASCADE;唯一 idx(playlist_id, track_key)                       |

### 3.5 checkin-data.db(签到库,1 表)

| 表              | 用途     | 关键列/索引                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| `checkin_users` | 签到用户 | uid PK、total_days、first/last_checkin_at、last_checkin_date;idx last_checkin_date |

### 3.6 lottery-data.db(动态抽奖库,9 表)

三个抽奖 store 通过 `dynamic-lottery-transaction.js` 复用同步事务包装，各自仍拥有连接和事务范围。BEGIN 失败直接抛出；操作或 COMMIT 失败尝试一次 ROLLBACK，并重新抛出原错误对象，保留原 code/cause。ROLLBACK 也失败时附加 `rollbackError`，不覆盖原 cause；不添加异步事务、自动重试或跨库事务。


| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `lottery_tasks` | 活动身份、动态目标、规则和状态 | task ID PK；创建 requestId 在 streamer 范围唯一；UID/动态 ID 均为 TEXT |
| `lottery_scans` | 截止后正式采集批次与来源检查点 | task FK；页游标、覆盖状态和读取数保存在同一 source state |
| `lottery_evidence` | 最小互动证据及评论展示信息 | PK(scan, source, recordId)；可空 display_name 保存采集时昵称；与下一游标由 store 同事务提交 |
| `lottery_rounds` | 冻结规则、名单摘要、算法版本与结果版本 | task/scan FK；revision 单调递增 |
| `lottery_round_members` | 每轮冻结 UID 与基础资格 | PK(round, uid)；不承载唯一一份领奖状态 |
| `lottery_orders` | 初抽/补抽的不可变候选顺序和推进位置 | UNIQUE(round, scope, generation)；顺序先落盘再核验 |
| `lottery_awards` | 独立授奖、领奖和替补关联 | 同奖项 UID 唯一；每个有效名额至多一条 active 记录 |
| `lottery_events` | 当前活动事件及已清理活动的创建请求回执 | streamer 范围 requestId 唯一；`create-retired` 仅保留请求 ID/摘要，不关联旧任务或轮次 |
| `lottery_request_budget` | 本机/账号滚动请求预算和冷却 | scope PK；活动删除不重置 |

抽奖库仅保存最小业务证据，不保存 Cookie、认证头或完整上游响应。`dynamic-lottery-store.js` 持有分页证据与游标的 `BEGIN IMMEDIATE` 事务；`dynamic-lottery-budget-store.js` 在请求出站前同时预留本机和账号预算。

2026-10-12 历史清理：成功创建新活动时，任务 store 在同一事务中调用 [dynamic-lottery-retention.js](../../../src/storage/dynamic-lottery-retention.js)，删除该 streamer 已完成或候选耗尽的旧活动及其采集、证据、轮次、名单、顺序、中奖与事件数据；创建失败回滚清理。启动按与活动列表一致的 `created_at_ms DESC, id DESC` 顺序，仅保留每个 streamer 当前最新活动的结果，清理其他已结束活动；暂停等仍可继续的活动保留。旧创建请求仅留下 `create-retired` 回执，同参数重试返回 `LOTTERY_TASK_CLEARED`，不同参数返回冲突，避免重放请求重新开奖。回执仍随活动数量增长，但不保留历史正文或名单。

2026-09-16 结果展示：抽奖库 v2 追加迁移 `lottery_evidence.display_name TEXT`，旧行保留且昵称为 NULL，重复启动不重跑迁移。昵称最多保存 256 字符，不影响资格或顺序；中奖结果通过 round 的 scan 与 member 的 source/recordId/uid 读取对应昵称和完整评论，避免同 UID 的其他评论或其他批次串入。缺少旧元数据时保持 NULL，不回源补查。

2026-09-14 客户端交集流程：`dynamic-lottery-store.js` 的 `commitPages` 同事务提交点赞/转发共用页，source state 增加已见游标以拒绝分页循环；评论按事件时间截止，reaction 保留 `occurred_at_ms = NULL`。新 [dynamic-lottery-draw-store.js](../../../src/storage/dynamic-lottery-draw-store.js) 使用现有 v1 的 rounds/members/orders/awards/events 表，不修改已发布 DDL。冻结规则与全量随机顺序同事务保存；资格确认、授奖和 next_index 同事务推进，未知结果不推进。rules JSON `version:2` 固定单一中奖人数与三个条件，旧版本活动不能套用新流程续抽。启动将 collecting/drawing 恢复为暂停，不自动发请求；保留活动最近 50 条按可信 streamerId 查询。原数据清理端口仍仅覆盖原五库；抽奖历史由上述活动生命周期清理，请求预算独立保留。

## 4. Schema 迁移系统

`runMigrations(db, key, steps)`([schema.js:12-47](../../../src/storage/schema.js#L12-L47)):steps 数组下标+1 即版本号,**只允许末尾追加**;每步一个事务(BEGIN/COMMIT,失败 ROLLBACK 并抛错);版本只升不降(检测到库版本高于代码版本时跳过,防止用户降级损坏数据)。

基础五库的迁移由 [database-migrations.js](../../../src/storage/database-migrations.js) 的 `runAllMigrations` 注册；抽奖库由 [dynamic-lottery-migrations.js](../../../src/storage/dynamic-lottery-migrations.js) 的 `runDynamicLotteryMigrations` 独立注册：

| 库          | key             | 版本  | 步骤内容                                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| songDb      | `song_db`       | v1-v16 | v1 列补全(tags/language/source_platform/original_group、pinned_at、requester_* 元数据);v2 `seedThemePresets`;v3 清理重复 (name, artist) 后建唯一索引;v4 幂等补充 `songs.request_price`;v5 幂等补充 `songs.song_clip`，旧歌曲的新字段均默认空字符串；v6 新增六张私密粉丝档案表及 requests 的稳定标识、归属和身份类型，旧流水归属保持空值；v7 新增 idx_requests_queue_id(queue_id)，用于队列关联查询；v8 新增 component_scenes 本地场景草稿、发布快照与加密来源；v9 新增 component_output_sizes 按账号保存默认组件输出宽高；v10 新增 component_canvas 固定直播源及最近应用预设；v11 区分预设与保留输出行，活动预设可空；v12 新增账号隔离的 song_cooldowns 最近入队时间，不回填旧流水；v13 将档案歌曲和保留的两份恢复点转换为汇总，新增 requests.fan_recorded 与 random_request_history，保留随机功能需要的最近记录后清理旧终态队列和流水；v14 新增 fan_roster_templates 与记录引用，无损去重自动名单的重复依据；v15 新增粉丝记录及提醒的 profile_id 外键索引；v16 无损追加 queue.is_live 和 idx_queue_single_live 部分唯一索引 |
| superChatDb | `super_chat_db` | v1-v2 | v1 基线；v2 新增最小防重 ID，删除旧 deleted 内容并覆盖后续删除路径 |
| giftDb      | `gift_db`       | v1-v20 | v1 `ensureGiftColumns`(cmd/blind_box/raw_json 等);v2 platform_id 索引;v3 `collapseDuplicateGiftIdentities` + 唯一索引 (platform_id, uid);v4 **检测账本升级**(`ensureGiftDetectionColumns`,历史记录标记 final 且仅归属礼物统计);v5 插入加班机单例行(id=1);v6 扩展加班机倒计时安全上限;v7 放开加班机 `display` 文字展板规则模式;v8 增加来源分区、同步状态、远程来源约束与索引；v9 幂等增加可空 `gift_events.blind_box_id`，旧行保持 `NULL`；v10 增加冻结事件身份列并将规则主键升级为 ID + 身份，旧规则设置原样保留；v11 幂等增加可空 avatar_url/guard_level，旧记录保持 NULL，等级约束为 0–3；v12 新增 source_recent 表达式部分索引及 source_time_asc 索引；v13 新增来源隔离的 gift_wishes / gift_wish_sessions；v14 增加许愿展示样式和文字模板；v15 增加文字版图片位置与格式；v16 增加文字版未收/已收颜色，旧行为空，保留所有定义与进度；v17 增加礼物保留快照、日汇总、准确去重键、本机归档及冲刺结转（见上文）；v18 新增保留快照双状态的时间升序/降序部分索引；v19 幂等增加许愿 `text_runs`，旧模板、图片位置、身份与进度保持不变；v20 增加许愿非整日精确贡献（见上文） |
| musicDb     | `music_db`      | v1    | 基线                                                                                                                                                                                                                                                                                                                          |
| checkinDb   | `checkin_db`    | v1    | 基线                                                                                                                                                                                                                                                                                                                          |
| lotteryDb   | `lottery_db`    | v1–v2 | v1 新建九张抽奖业务表、身份/幂等/顺序唯一约束及查询索引；v2 为 `lottery_evidence` 增加可空 `display_name TEXT`，无默认值，历史行保持 `NULL`，不新增索引；独立失败边界，不加入原五库迁移事务                                                                                                                                                                                                                                      |

抽奖昵称由 [dynamic-lottery-store.js](../../../src/storage/dynamic-lottery-store.js) 保存并作为证据 DTO 的 `displayName` 读取，[dynamic-lottery-draw-store.js](../../../src/storage/dynamic-lottery-draw-store.js) 将其投影到中奖结果；前端 [dynamic-lottery-workflow.js](../../../public/js/admin/dynamic-lottery-workflow.js) 对缺失昵称回退 UID。v2 不回填旧证据、不改变 v1 的身份或开奖顺序约束。

初始化顺序固定为基础表 DDL → 不可变迁移 → 依赖迁移列的索引 DDL → legacy Super Chat 搬迁。song/gift 的组合 schema 导出仅用于兼容；`createDatabases()` 使用拆分后的 table/index schema，避免真正的 pre-v1 库在 `pinned_at` 或 `counted_in_sprint` 补列前创建相关索引。任何初始化步骤失败时，本次已打开的全部数据库句柄都会关闭。版本通过管理身份的 `GET /api/database/stats` 查看，或读取管理凭据授权的 `GET /api/health` 详情中的 `schemaVersions`（[data-routes.js](../../../src/server/routes/data-routes.js)、[api-context.js](../../../src/server/api-context.js)）。匿名 health 仅提供 serviceId/phase（有效实例挑战可另带 instanceProof）；`/api/state` 与全局/展示 WS 快照不包含 schemaVersions，不能将诊断信息加入业务快照以适配旧描述。

## 5. 数据保留策略(Retention)

[src/storage/retention.js](../../../src/storage/retention.js):默认策略 `DEFAULT_POLICY` = 礼物原始报文 30 天清文本(保留解析结果)、礼物事件永久保留、点歌流水按天清理默认禁用、冷却记录 1 天。SC 按天策略默认 `0` 仅表示仍在显示的 `active/assisted` 项不自动过期；删除或撤回后立即删除内容，只留防重 ID。点歌终态流水仍随队列立即删除，不受按天策略控制；活动队列始终保留。settings 键 → policy 翻译见 `readRetentionPolicy`(giftRawJsonRetentionDays 等,§7)。

- AI 请求审计通过 `aiRequestLogRetentionDays` 配置（默认 `30` 天，`0` 禁用），由 `readRetentionPolicy` 转为 `aiRequestLogDays`。`ai_request_logs.created_at` 为毫秒时间戳，严格早于期限才删除；配置、黑名单、API 配额、缓存和上下文不参与此项清理。
- API 配额 SQL 由 [ai-api-usage-store.js](../../../src/storage/ai-api-usage-store.js) 拥有；AI 配额域在初始化和跨月访问时传入上月边界，回收更早计数，保留当月预算及未来月份。该生命周期不依赖审计保留开关。
- `applyRetentionPolicies(databases, {policy, dryRun})`:dryRun 只统计不删除;gift_events 清 raw_json 用 UPDATE(保留行),其余按 `created_at < 阈值` 删行，点歌流水额外排除仍有关联活动队列的记录。非 dry-run 同时精简档案歌曲的过期日计数，不改变累计次数和最近日期。`aiRequestLogsDeleted` 在 dry-run 返回候选数量，实际执行返回删除数量；启动摘要同时记录该计数。
- 非 dry-run 维护同时清空无人消费的旧 `import_batches`，删除超过最长支持冷却期限 999 天的 `song_cooldowns`；不按用户当前较短的冷却值提前删除。`importBatchesDeleted`、`songCooldownsDeleted` 在 dry-run 和实际执行中返回候选/删除数量。
- `startRetentionMaintenance()`:启动后检查一次、运行期间每小时检查一次；每次重新读取 `autoRetentionOnStartup==='true'` 及现行保留策略，关闭开关或设置某项为 `0` 的行为不变。失败只记录警告，后续维护继续；timer 不保持进程存活，在停机开始及启动失败时撤销(见 [server-core.md](server-core.md) §5–§6)。
- `getRetentionStats(databases)`:各表行数/最早最晚时间/raw_json 字节数,供管理页展示。

`gift-maintenance-store.deleteGiftsWithSettlements` 将待删除 ID 按每批 1000 个参数执行，所有批次仍在同一个 `BEGIN IMMEDIATE` 事务内。删除前将关联 pending 结算置为 ignored，任一批失败则整体回滚；dry-run 只统计候选行，不改礼物或结算状态。

旧本地礼物的自动/手动保留期清理改走 `deleteExpiredLocalBatch`，仅选择 `source_id IS NULL`、早于期限的最多 1000 行；利用已有 `idx_gift_events_created_at` 顺序读，避免每批按 source 索引全量排序。批大小沿用上述参数预算，每一批礼物删除与 pending 结算失效在同一事务提交，批内失败全部回滚，之前已完成的批次保留。`applyRetentionPolicies` 仍同步返回当批计数及 `hasMoreGiftEvents`；自动维护有积压时每隔 25ms 续批并重读开关/策略，停止时撤销续批。手动 HTTP 在批次间让出事件循环，固定策略与开始时间，累计完成后响应；其在途请求由正常 shutdown drain 等待完成，不会在数据库关闭后继续。远程投影的清理路径、dry-run 全量统计和显式全量清空的原子性不变。

## 6. 清库操作

[database.js](../../../src/storage/database.js) 的清空函数(经 `/api/database/*` 暴露,见 [api.md](api.md)):

| 函数                   | 范围                                                             | 保留                                                                             |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `clearSongLibraryData` | songs/song_categories/import_batches                             | settings、theme_presets、queue/requests(仅解除 song_id 外键)                     |
| `clearSuperChatData`   | super_chats                                                      | super_chat_receipts（防止旧消息重新出现） |
| `clearPlaybackData`    | play_history/play_queue_state                                    | favorites/playlists                                                              |
| `clearGiftData`        | 当前 source 的 `gift_events`、关联 settlement 和同步状态同事务重置(`BEGIN IMMEDIATE`) | 其他/legacy source、来源字典、overtime_machine_state/overtime_gift_rules          |
| `clearAllData`         | 五库业务数据；礼物库只重置当前 source(见下文矩阵)                | 配置类表及其他/legacy 礼物 source                                                  |

### 6.1 Clear-All Matrix(清空全部矩阵)

`database-maintenance.js` 保留 `clearAllData` 位置参数门面，内部调用 `database-clear-coordinator.js:coordinateClearAll` 的具名输入。协调器独占 BEGIN、逐库 COMMIT、失败中断和剩余 ROLLBACK；`database-clear-operations.js` 只在既有事务内清理及恢复默认行，计数累加器保留 SQL 失败前的统计，不持有事务状态。`database-clear-result.js` 构造成功、预提交失败和部分提交结果；只有预提交阶段全部回滚成功才抛出可安全恢复的错误。

`clearAllData()` 使用跨五库的两阶段协调；SQLite 无法为多个文件提供单一原子 commit，因此提交阶段仍可能返回明确的部分失败。矩阵常量 `CLEAR_ALL_MATRIX`([database-clear-operations.js](../../../src/storage/database-clear-operations.js)):

**保留(Preserve)**:配置类表,清空后应用仍可用

- `settings`:直播间号、主题颜色、所有功能开关
- `ai_configuration`:AI 提供商配置与凭证
- `theme_presets`:主题预设(内置 + 用户自建)
- `overtime_machine_state`:加班机状态(清空后重置为 id=1 禁用行；同一事务内递增已有 revision，单例缺失时才从 0 创建)
- `overtime_gift_rules`:加班机礼物规则
- `favorites`:播放器收藏
- `playlists` + `playlist_tracks`:播放器歌单
- `super_chat_receipts`:仅已移除 SC 的平台 ID，防止重复消息重新出现
- 非当前 source 与 `source_id IS NULL` 的 legacy 礼物行，以及 `gift_sources` 字典

**删除(Delete)**:全部业务数据

- 点歌业务:`songs`、`song_categories`(清空后重建默认分类)、`queue`、`requests`、`random_request_history`、`import_batches`、`user_cooldowns`、`song_cooldowns`
- AI 运行时:`ai_request_logs`、`ai_api_usage`、`ai_viewer_context`、`ai_query_cache`、`ai_blacklist`
- 直播数据:`super_chats`、当前 source 的 `gift_events` 与关联 `overtime_settlements`、`checkin_users`
- 播放器数据:`play_history`、`play_queue_state`

**重建(Recreate)**:业务必需的默认行

- `song_categories`:插入与启动链一致的"默认"行(name='默认', sort_order=0, is_enabled=1)
- `overtime_machine_state`:确保 id=1 行存在且为禁用状态(enabled=0, status='paused')

### 6.2 两阶段提交流程

**Phase 1**(预提交验证):

1. 对所有 5 个数据库依次执行 `BEGIN` + `DELETE` + 统计行数,但**不提交**；在各自事务内重建默认分类与禁用的加班机状态行
2. 若任一 BEGIN/DELETE/默认行重建失败，只回滚本次已经开启的事务；全部回滚成功后抛出聚合错误(`error.details` 包含库名与 `delete`/`recreate` 阶段)，不报告清空成功
3. 若回滚失败，返回 `partial: true`、`phase: 'pre-commit'`、`committed: []` 与 `rolledBack`/`rollbackFailed`，保持写入器暂停

**Phase 2**(提交):

1. 依次对所有数据库执行 `COMMIT`
2. 若全部成功:删除与必需默认行均已提交，返回 `{ cleared: true, committed: [...], preserved: [...], deletedCounts: {...}, recreated: [...] }`
3. 若任一 COMMIT 失败:立即停止,回滚失败库及所有尚未提交的库,返回 `{ ok: false, partial: true, committed: [...], failed: [...], rolledBack: [...], rollbackFailed: [...], deletedCounts: {...} }`

部分失败时数据库可能处于**不一致状态**(部分库已清空、部分未清空),路由返回 HTTP 500 + `partial: true`,前端强制刷新页面并提示用户手动检查。若 `giftDb` 已提交当前投影重置，`runClearAll` 仍立即触发礼物 controller 重建，使本地礼物状态保持 partial，而不会继续宣称旧投影为 LIVE。

### 6.3 并发写入静默(Quiesce)

清空全部的应用流程由 [data-maintenance-runtime.js](../../../src/server/data-maintenance-runtime.js) 的同步 `runClearAll` 拥有。[路由](../../../src/server/routes/data-routes.js)从 [API 上下文](../../../src/server/api-context.js)传入窄能力，运行时依次暂停写入、清库并恢复，全程不插入 `await`:

- `context.gifts.pauseDetection()`:暂停本地检测、finalize 与消费重试，取消计时器且不强制 flush；暂停期间销毁也不 flush。远端实时/历史导入抛出 `GIFT_DETECTION_PAUSED`，使礼物与同步游标所属事务一起回滚，避免丢事件
- `context.overtime.pauseRecovery()`:暂停礼物结算、后台补偿与倒计时归零写入，取消零点/重试计时器
- `runClearAll` 同时尽力清理音乐 API 与歌词文件缓存，失败不替换数据库结果；投影重建也尽力触发且不等待。Electron 桌面端在成功响应后还会清理 QQ 音乐、网易云音乐会话缓存（不删除登录 Cookie）。

完全成功并重载已提交的默认状态后，先恢复加班机消费者，再恢复礼物检测器:

- `context.overtime.resumeRecovery()`
- `context.gifts.resumeDetection()`：从仍持久化的 pending/final 行重建工作，保留未完成的非统计消费者重试

Phase 1 失败且全部事务已回滚时，只解除本次请求取得的暂停，然后由服务器返回稳定错误。此前部分失败留下的暂停不会被另一次失败请求解除；再次完整清空成功后才能恢复。

部分提交、回滚失败、提交后的领域状态重载失败或写入恢复失败时**保持两个写入器暂停**，返回 HTTP 500 与 `partial: true`，不发成功快照/云同步请求。后两种失败分别标记 `phase: 'runtime-reset'`/`'resume'`、`cleared: false`，并保留实际已提交的库与已重建的默认行信息；跨库提交仍不具备崩溃原子性。

## 7. 设置存储(settings-store)

礼物图片导出默认值由 Electron 控制器经 `gift-export-runtime.js` 调用既有 `setSettings`
原子写入本地设置：`giftExportMode`（缺省 `combined`，另可 `separate`）、
`giftExportBackground`（缺省 `transparent`，另可 `white`）、`giftExportDirectory`
（沿用原键，空值使用系统图片目录下的 `LIRA/礼物导出`）。不新增表或迁移，
目录只允许由原生对话框或系统默认取得，不同步为云端配置。旧版已记住的文件夹继续生效。

`giftEffectDanmakuEnabled` 是默认 `'false'` 的字符串布尔设置，经现有设置同步映射为
云端可选布尔值。它只控制弹幕指令特效，不控制全屏礼物感谢或收礼流水；不增加数据库表或
迁移。云端旧快照缺少该字段时本地按关闭应用。见 [弹幕礼物特效规格](../../../specs/gift-effect-danmaku.md)。

启动入口 `prepareSettingsBootstrap` 委托存储门面 `bootstrapSettingsStore(db)`：在同一 `BEGIN IMMEDIATE` 事务内读取旧版本、补齐默认值、转换设置并写入版本检查点；全部成功才提交，任何异常回滚整次初始化。新库的默认滚动速度同步保存当前版本，重启不会按旧范围再次转换。故障回归使用独立临时 SQLite 库与版本写入触发器，不读取用户数据。

批量写能力 `setSettings(values)` 由存储层持有 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，返回实际变化的键；没有变化时不写入。只有提交成功才清除内存缓存，失败同时保留数据库旧值与缓存旧值。`setSetting(key, value)` 继续供既有单键调用者使用。HTTP 设置 patch 与云端设置快照都走批量能力，字段校验归属 [API 设置契约](api.md#2-设置域settings)，不由存储层重复定义。

`createSettingsStore(db)`（[settings-store.js](../../../src/storage/settings-store.js)）为缺失键插入默认值；`getSettings()` 合并默认值与数据库并缓存，写入使缓存失效。生产启动使用 `bootstrapSettingsStore` 将默认值、兼容迁移与检查点放在同一事务。默认键按组：

| 分组         | 键(代表)                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 直播间       | `roomId`、`danmakuMonitoringEnabled`、`giftMonitoringEnabled`、`enableBilibili`、`paused`、`queueLimit`、`userCooldownSeconds`                                                                                                                                                                                                                                                                                                                                            |
| 旧引导兼容 | `onboardingVersion`、`onboardingCompletedAt`、`onboardingSkippedOptional`；保留旧完成记录，不参与现行引导的首次展示判断，当前流程见[交互式引导](../frontend/interactive-tour.md)                                                                                                                                                                                                                                                                                            |
| 身份优先 | `guardPriorityEnabled=false`，按账号同步；LIVE 标记仅存在本机 queue.is_live，重启保留，具体排序见 [音乐服务](music/services.md) |
| SC 点歌 | `scSongRequestEnabled=true`，沿用 settings 文本存储和账号同步；旧快照省略保留已存值。关闭只停止 SC 点歌指令，留言显示与已有队列保留 |
| 观众点歌限制 | `userQueueLimit=0`、`userCooldownCaptainSeconds/userCooldownAdmiralSeconds/userCooldownGovernorSeconds` 为空串、`songRequestMinMedalLevel=0`、`songRequestGuardLevel=0`、`songRequestGuardMedalBypass=false`、`songRequestUserBlacklist=[]`；均按账号同步，默认不附加限制。名单用 JSON 文本存于 settings，不增加表；字段范围见 [设置 API](api.md)，准入与事务计数见 [音乐服务](music/services.md) |
| 单曲冷却 | `songCooldownMode=off`（`off/hours/days`）、`songCooldownValue=1`（1–999），同步到云端账号设置；入队时间仅存本机，按账号 scope 隔离；语义见 [音乐服务](music/services.md) |
| 点歌行为     | `onlyFromLibrary`、`allowDuplicate`、`allowCompactRequest`                                                                                                                                                                                                                                                                                                                                                           |
| 弹幕机器人   | `enableRandomTagReply`、`enableCheckinBot`、`enableFortuneBot`、`enableCustomReplyBot`、`checkinBlessings`、`fortunePool`、`customReplyRules`                                                                                                                                                                                                                                                                        |
| 礼物         | `enableGiftSprint`、`giftSprintTargetRmb`、legacy `giftBlindBoxConfig`、云端私有 `giftBlindBoxCustomConfigV2`、`enableGiftNotification`、`giftFrameEnabled`、`giftFrameThresholdRmb`、`guardThanksAuroraEnabled`、`guardThanksAuroraTextMode`、`guardThanksClassicEnabled`、`guardThanksClassicTextMode`（旧 `guardThanksEnabled`、`guardThanksTextMode`、`guardThanksStyle` 保留兼容）；特效 1 · 林间花信默认关闭、阈值为 20 元。已撤销的 `giftFrameRibbonEnabled` / `giftFrameRibbonThresholdRmb` 及旧 `giftFrameTheme` / `giftFrameMotionMode` 历史行原样保留但不参与运行，已从默认值/HTTP 可写键/overlay 投影移除；大航海感谢默认关闭、文字为 `bilingual`。官方映射来自只读 v2 目录缓存，不写回设置；缺少 v2 私有字段表示不覆盖，合法 `[]` 只清空自定义层。非空 legacy 配置保持迁移待确认，不按名称猜 ID |
| 滚动/字号    | `scrollSeconds`、风格 1 的 `queueScrollMode`/`queueScrollSpeed`/`queueSongFontSize`、风格 2 的 `identityQueueScrollMode`/`identityQueueScrollSpeed`/`identityQueueFontSize`、风格 3–6 各自的 `storybook*`/`neonVinyl*`/`cherryRibbon*`/`goldenLily*` 字号与滚动键、`songBoardFontSize` 及各 `*RangeVersion`/`queueStyleSettingsVersion` 迁移版本键；`queueStyleSettingsVersion=1` 首次升级时把旧共享值复制到各风格键 |
| 主题         | `themePrimary/themeAccent/themeText/themeBackground/themeOpacity/themeRadius/themeFontScale` 等 + `songBoard*` 独立一套                                                                                                                                                                                                                                                                                              |
| 悬浮层       | `danmakuOverlayStyle`(`bubble`/`signal`/`minimal`/`ranked`/`transparent`/`identity`/`outline`，默认 `signal`)、`danmakuFullscreenDurationSeconds`(默认 `6`，服务端限制 2–30 的安全整数)、`overlayQueueStyle`(`classic`/`identity`/`storybook`/`neon-vinyl`/`cherry-ribbon`/`golden-lily`,遗留 `festival` 按 identity 使用)、插画风格各自的 `*QueueFontFamily`/`*QueueFontWeight`/`*QueueUseCustomTextColor`/`*QueueTextColor`、`overlayLowPowerMode`、`backdropBlur`、`glowIntensity`、`overlayPin1-3`、`overlayRule1-6` 及颜色/字号       |
| 桌面歌词     | `desktopLyric*` 全套(字体/描边/大小/透明度/缩放/逐字高亮方式)                                                                                                                                                                                                                                                                                                                                                        |
| WeSing       | `weSingCachePath`、`weSingLyricOffsetMs`                                                                                                                                                                                                                                                                                                                                                                             |
| 开播动画     | `openingEnabled`、`openingTitle`、`openingSubtitle`、`openingName`、`openingFooter`、`openingQuality`、`openingTrackMotion`(`heart`/`barber`/`progress`，默认 `heart`)、`openingShowNotes`、`openingShowEq`、`openingAudioFile`、`openingAudioName`、`openingAudioVolume`、`openingCharacterFile`、`openingCharacterName`、`openingPixelCharacterFile`、`openingPixelCharacterName`（动画 2 独立头像，默认空）；上传音频与人物图分别位于 data 目录 `opening-music/`、`opening-character/`                 |
| 萌时钟       | `clockStyleOptions`（逐样式公共外观 JSON，默认字符串 `{}`，读取时兼容原标量）、`clockStyleParameters`（逐样式效果 JSON，默认字符串 `{}`）、`clockStyle`(`peach`/`starlight`/`soda`/`timeline-horizontal`/`timeline-vertical`/`digital`/`orbit`/`flip`/`moonlit-fan`)、`clockShowDate`、`clockShowSeconds`、`clockHourFormat`(`12`/`24`)、`clockLabel`、`clockFlipFrameColor`（默认 #e4e4e4）、`clockFlipFaceColor`（默认 #ffffff）、`clockFlipTextColor`（默认 #303030）、`clockMoonMode`（light/dark/auto，默认 light）、`clockMoonIntervalSeconds`（1–86400 整数秒，默认字符串 '30'）；旧库补足默认值，无 schema 迁移；供固定 `/clock` Browser Source 首帧读取 |
| 投票与评分外观 | `interactionOverlayTitle`/`interactionOverlayHint`（默认空、留空隐藏，分别最多 60/80 字素）；`interactionRatingRules`（多行纯文本，默认“发弹幕评分：1–10 分”“只发整数，不带其他内容”“多次评分，以最后一次为准”三行，可为空）；`interactionTextColor`(`#172b3a`)、`interactionBackgroundColor`(`#ffffff`)、`interactionBarColor`(`#bee9e2`)、`interactionTrackColor`(`#f0f3f6`)；`interactionBackgroundOpacity`/`interactionOverallOpacity`（默认 `100`，0–100 整数，分别影响底色/整个卡片）；`interactionFontSize`（默认 `20`，16–24px）、`interactionCornerRadius`（默认 `20`，0–32px）；`interactionShowStatus`/`interactionShowParticipants`（默认 `true`）。本地 settings 现有表保存，旧库按缺失键插入默认值，不覆盖已存值，不参与云端设置同步。 |
| 保留期       | `giftRawJsonRetentionDays`(30)、`giftEventRetentionDays`(0)、`requestRetentionDays`(0)、`superChatRetentionDays`(0)、`autoRetentionOnStartup`                                                                                                                                                                                                                                                                        |
| 更新         | `enableAutoUpdate`                                                                                                                                                                                                                                                                                                                                                                                                   |

本节是设置分组与代表项，不是逐键字典。完整默认键、类型与默认值以 [settings-defaults.js](../../../src/storage/settings-defaults.js) 的 `DEFAULT_SETTINGS` 为准，输入约束以 [settings-contract.js](../../../src/server/settings-contract.js) 和领域 normalizer 为准。公开设置经 WS 快照 `settings` 字段投影下发，过滤约束见 [ws.md](ws.md)；账号归属与歌曲待传的私有持久键单列于 §8，不属于可编辑设置或公开快照；未进入 defaults 的领域设置不一定私有，见下文。

### 7.1 关键设置的归属与约束

直播歌词已唱颜色由本地 settings 的 `desktopLyricSungColor` 保存，默认 `''` 表示跟随样式高亮色；显式值使用十六进制颜色，支持透明度，渲染器对无效值回退继承。未唱颜色复用原 `desktopLyricTextColor`（默认 `#000000`），普通整句、翻译和关闭逐字时同样使用它，不新增另一套未唱设置。原 `desktopLyricOpacity` 保持统一文字不透明度，颜色按钮各自的 Alpha 不改写该值。旧库沿用缺失键默认补齐，无 schema 迁移，不覆盖已存颜色。两项颜色只投影至歌词 scope；与现有歌词外观一样同步到同样式画布组件，独立资源样式保留自己的外观。

开播样式保持独立：经典舞台沿用原键；像素卡带新增 `openingPixelQuality='high'`、`openingPixelShowNotes='true'`、`openingPixelShowEq='true'`、`openingPixelAudioVolume='0.35'`、`openingPixelAudioFile=''`、`openingPixelAudioName=''`。既有 settings 默认值补齐负责旧库升级，不覆盖经典配置，无 schema 迁移。导入资源样式的公共参数由组件库 config 拥有，覆盖已有场景中的旧副本；不写内置样式设置。

settings 表通常存字符串：boolean 使用 `'true'/'false'`，数字使用十进制文本，结构数据使用 JSON 文本。defaults 是默认键清单，不是所有运行期持久键的完整清单。下表聚焦同步、路径和非显然语义；HTTP 输入范围集中于 [api.md](api.md) 的 settings 契约，不另维护第二份校验算法。

| 键与默认值 | 权威 / 同步范围 | 修改入口、消费与约束 owner |
| --- | --- | --- |
| `songRequestBlacklist=''` | 本机点歌词汇黑名单，不加入云端同步 | 点歌板设置 → settings HTTP；格式见 [api.md](api.md) §2，完整匹配与处理顺序见 [bilibili/danmaku.md](bilibili/danmaku.md) §5.3；沿用默认值补齐，重复初始化不覆盖保存内容 |
| `roomId=''`、`danmakuMonitoringEnabled='true'`、`giftMonitoringEnabled='true'`、`enableBilibili='true'`、`paused='false'`、`queueLimit='50'`、`userCooldownSeconds='0'`、`onlyFromLibrary='false'`、`allowDuplicate='true'` | 云 settings 确认状态与本地编辑同步；roomId 另受账号归属事务保护 | 管理设置 → settings HTTP → 本地 Bilibili/点歌/队列；[settings-contract.js](../../../src/server/settings-contract.js) 的 CLOUD_SETTING_KEYS/serializeCloudSettings |
| `enableBilibili` 兼容规则 | 新的两项缺失时继承旧总开关；重复初始化不覆盖保存值；总开关为两项逻辑或 | `settings-store.js` 原子保存。显式分项优先；旧请求不含分项时，总开关改变才同时更新两项，否则保留分项。云端缺少分项响应可兼容读取，两项变化均触发 settings 同步 |
| `giftEffectDanmakuEnabled='false'` | 同一 settings scope，云端缺省 false | 设置 HTTP，云端 SSE 特效及本地展示消费；严格 boolean 归一化 |
| `giftBlindBoxConfig=JSON.stringify(DEFAULT_BLIND_BOX_CONFIG)`、`giftBlindBoxCustomConfigV2='null'` | legacy 兼容与云端私有自定义层；官方目录只读 | [blind-box-config.js](../../../src/bilibili/gift/blind-box-config.js) 校验；V2 null 表示不覆盖，[] 明确清空私有层；不把名称当冻结活动身份 |
| `enableCheckinBot='true'`、`enableFortuneBot='true'`、`checkinBlessings`/`fortunePool` 为内置词库 JSON | 本地旧数据兼容，**不代表云端实际启用值**，不在 CLOUD_SYNC_KEYS | 当前界面经 dailyBots IPC 读取/修改服务器状态；旧词库仅由显式接管 action 读取，不能恢复本地执行 |
| `danmakuOverlayStyle='signal'`、`danmakuFullscreenDurationSeconds='6'` | 本地展示设置；不是服务器 overlay 配置的权威副本 | 本地 HTTP 校验与展示 scope 消费；服务器样式独立经 liraLicense IPC，允许值差异见 [preload.md](../desktop/preload.md) |
| `weSingCachePath` 为 Windows APPDATA 下 Tencent/WeSing/WeSingCache（否则空）、`weSingLyricOffsetMs='0'` | 本机路径/时钟，不同步 | 目录选择 IPC 只返回路径，HTTP 保存先 prepare 再写库；[wesing-cache.js](../../../src/music/wesing-cache.js) 校验绝对目录与偏移 |
| `giftFrameEnabled='false'`、`giftFrameThresholdRmb='20'` | 林间花信的专属开关/金额，不加入云设置范围；缎带旧设置保留历史行但不再读取或写入 | 设置 HTTP → gift frame/overlay；[frame-config.js](../../../src/bilibili/gift/frame-config.js) |
| `guardThanksAuroraEnabled/TextMode`、`guardThanksClassicEnabled/TextMode`（四键默认 `''`） | 两套本地开关与文字独立保存，不加入云设置范围。空值继承旧配置：仅 `guardThanksStyle` 指定的风格继承旧开关，两者继承旧文字；独立保存后该风格不再受旧键影响。旧默认仍为 `false/bilingual/aurora`，新安装两套均关闭。无数据库结构迁移 | 设置 HTTP → 每个启用风格的 `gift:guard-thanks`/overlay；[guard-thanks-config.js](../../../src/bilibili/gift/guard-thanks-config.js)、[共用兼容解析](../../../public/js/shared/guard-thanks-settings.js) |
| `guardThanksNauticalEnabled`（默认 `''`） | 航海旗帜本地开关，`true/false` 独立生效；空值兼容任一内置感谢已启用的旧行为。新安装保持关闭，不加入云设置范围 | 同一 final 上舰行投影为专属 `style:nautical` 场景事件，不广播给旧独立礼物特效页，不触发其他样式 |
| `openingEnabled='false'`、openingAudioFile/Name、openingCharacterFile/Name、openingPixelCharacterFile/Name | 本机上传素材与开播展示；每次 bootstrap 强制关闭 openingEnabled | 专属上传/删除路由保存素材路径，普通设置不是任意路径导入；目录见本文件 §1 |
| `enableAutoUpdate='false'` | 本机偏好，不同步 | 管理设置 HTTP；desktop:set-auto-update 仅记日志；[update.md](../desktop/update.md) |
| `interaction*`、`clock*` | 本机展示，不同步 | 各自 HTTP normalizer/展示 projection，默认值见代表项及 defaults |

### 7.2 defaults 外的领域设置与公开投影

`giftDisplayConfig` 是 [display-settings.js](../../../src/bilibili/gift/display-settings.js) 拥有的 JSON 文本，经专属礼物展示 GET/POST 修改，不经普通 settings 默认键白名单。缺失/无效时默认 `{palette:'bilibili-four',thresholds:[3000,10000,100000],visibleRows:3,scrollSpeed:12,minGiftAmountCents:0}`：金额为整数分；三阈值须正安全整数且递增，visibleRows=1–10、scrollSpeed=1–50整数，最小金额为非负安全整数且是10的倍数。旧 intervalSeconds/paused/lowPower 形状兼容为 scrollSpeed=1，不同步到云端。

`giftExportMode`、`giftExportBackground`、`giftExportDirectory` 同样不在 DEFAULT_SETTINGS：缺失时 controller 分别使用 combined、transparent、系统图片目录下 LIRA/礼物导出；空目录字符串代表使用系统默认。仅 giftExport IPC 写入（参数/任务规则见 [preload.md](../desktop/preload.md)），保存绝对自定义路径时含本机信息。这些领域键仍由 getSettings 返回，可进入管理 HTTP/WS；不能把“未在 defaults”误当作私有过滤。overlay settings 由 [overlay-projection.js](../../../src/server/overlay-projection.js) 按 scope 白名单选字段，不下发整个管理 settings。真正过滤的 cloudRoomAccountKey/cloudSongSyncPending 规则见 §8。

### 7.3 启动迁移、清理与导入导出

[settings-migrations.js](../../../src/storage/settings-migrations.js) 是转换 owner；bootstrap 在插入默认值**之前**读取旧版本，以免默认检查点掩盖待迁移数据。以下检查点不是 schema_version：

| 检查点 / 条件 | 转换与兼容 |
| --- | --- |
| queueScrollSpeedRangeVersion != '3' | 旧队列速率归一到1–100，完成写3 |
| songScrollSpeedRangeVersion != '2' | 旧 scrollSeconds 范围20–200映射1–100；新库无旧值时直接写2，保留当前默认20；已有当前范围的设置保持原值 |
| queueFontSizeRangeVersion != '2' | 在补默认值之前，仅将已保存的旧范围 queueSongFontSize/queueTitleFontSize 翻倍，完成写2；缺失项使用当前默认值，避免把新库默认字号再次放大 |
| queueStyleSettingsVersion != '1' | 旧共享字号/字体/颜色/滚动值复制至 identity 与各插画风格独立键，完成写1 |
| identityQueueFontFamily 缺失 | 默认插入前，在 bootstrap 事务内复制已保存的 overlayFontFamily；无旧值时默认为 Microsoft YaHei。仅补缺，之后两种风格独立保存；预设与展示投影均保留新键 |
| desktopLyricKaraokeMode 缺失 | legacy desktopLyricKaraokeEnabled='false' 时初始化 off，否则默认模式 |
| 旧 overlayRule3、4 原文 | 仅匹配旧默认文案时迁移，保留用户内容 |
| songBoardFontSize 缺失 | 补当前默认28；所有已保存字号（包括16）保留，不以与历史默认相等为由覆盖用户设置 |
| giftBlindBoxConfig 旧字符串输出 | 用已知旧价格表转成对象；未知仍保留；空字符串改[]，明确[]不重新补默认。此兼容迁移不等于 V2 身份映射确认 |

普通歌库 CSV/XLSX 导入导出只处理歌曲，不携带设置、路径或账号私有键；主题预设只提取 [theme-store.js](../../../src/storage/theme-store.js) 的 scope 外观白名单，不是全 settings 备份。数据库清空矩阵显式保留 settings/theme_presets（包括路径与内部账号状态），不会恢复出厂设置；歌曲清空同时记录空待传快照，但保留其他账号的待传项。直接复制 SQLite 数据库会包含内部行和本机路径，不能等同于公开设置导出。

其他 store 模块:`theme-store`(presets 增删改查/应用/内置播种)、`playback-store`(saveQueueState/loadQueueState/播放历史/收藏/歌单)、`cooldown-store`(`loadInto` 重启恢复 + `COOLDOWN_RETENTION_MS`；恢复排除未来时间，`prune` 删除过期或未来行，内存读取遇到时钟回拨产生的未来值时丢弃该键)、`daily-bot-legacy-reader`(旧签到库及词库的只读兼容适配)、`gift-query-store`(当前 source 的历史、统计与 legacy 页面查询)。关闭时统一 `optimizeDatabases`(PRAGMA optimize)→ `closeDatabases`(见 [server-core.md](server-core.md) §6.2)。

## 8. 云端 scope 的本地落盘

SongStore 的缓存变更令牌使用连接级 TEMP 触发器观测歌曲/分类表，外部连接提交以 `data_version` 兜底；不会给持久数据库新增表或触发器。清空、替换均沿用表内写操作，照常推进令牌；连接关闭时 TEMP 状态销毁，重开后重新建立。事务内读取不复用缓存，详见 [音乐服务](music/services.md)。

SongStore 在事务写入前校验最终完整歌库最多 5000 首：手动新建与合并导入计入已有停用歌曲，并对新行按 `(name,artist)` 去重；替换检查替换后的数量。超限不改歌曲、分类、历史引用或导入批次；已有超限库仍可读取、编辑、删除，但不能继续新增，不会自动删歌。失败由调用方返回 `SONG_IMPORT_LIMIT_EXCEEDED`，成功路径沿用原有广播和同步。显式替换为上限内的完整快照仍可用于整理历史超量库。云端上传前对完整数组独立校验，历史超量返回 `TOO_MANY_SONGS`，不会截断上传；非数组仍为 `SONG_LIST_INVALID`。

房间归属由 `settings-store.prepareCloudRoomAccount(accountKey)` 保存于现有 `settings` 表的内部 `cloudRoomAccountKey`，值为 `JSON.stringify([origin, accountName, streamerId])`，来自 main process 的设备身份。首次缺失或身份不同（含同名重建的新 streamerId）时，以一个 `BEGIN IMMEDIATE` 事务同时清空 `roomId` 并保存新标记；失败整体回滚，同一 owner 重复调用不写库。标记不进入 `getSettings()`、可编辑 defaults、WS/HTTP settings 或 Device 快照，也不作为服务端授权依据。它不是云端 revision，不新增表或更改 schema 版本。其他设置和歌库的初次播种规则不变；已有云端房间可在随后同步时恢复。

`settings-store.getRoomRevision()` 仅在当前进程内记录已成功提交的 `roomId` 变化（含归属切换清空房间），供在途随机点歌复核；同值写入、其他设置及回滚不推进，不新增持久字段或公开快照字段。由提交 owner 记录可覆盖其他设置消费者仍在异步应用时切换房间再切回的情况。

云端 revision 保存在独立 lira-server，本地 SQLite 不复制 revision；[cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js) 在当前授权进程内维护 `settings`、`songs`、`bilibili` 三个已应用 revision、dirty 标志和本地 mutation 代次。上传完成时只有未出现更新代次才清除 dirty；远端 songs/Bilibili 内容返回后会在本地写入前重新检查 dirty。应用云端 settings 时，`applyCloudSettingsSnapshot` 写入同步白名单（包括验证后的 legacy `giftBlindBoxConfig` 与 `giftBlindBoxCustomConfigV2`），并把只读 `blindBoxMapping` 状态单独放入运行时快照；设置页只上传私有 v2 数组，dirty JSON 在刷新或失败时保留。随后重新配置本地 Bilibili runtime 并广播 `cloud:settings` 快照。

应用云端歌库时，`song-service.replaceCloudSongs` 先完成规范化、校验和最后一项获胜的身份去重，再调用 [song-store.js](../../../src/storage/song-store.js) 的 `replaceAll`。Store 拥有一个 `BEGIN` / `COMMIT` 事务：先把 `queue.song_id` 与 `requests.song_id` 全部置空，保留 `song_name`、artist、requester、message 等文字历史；再删除旧歌曲和分类、重建默认分类并插入新快照。任何一步失败都会 `ROLLBACK`，不会暴露半替换歌库。单曲保存/删除与批量导入的事务同样归 SongStore，领域层不再接收 SQLite 句柄。

歌曲待上传状态由 [cloud-song-sync-store.js](../../../src/storage/cloud-song-sync-store.js) 持久化在现有 `settings` 表的私有 `cloudSongSyncPending:<accountKey SHA-256>` 行；值包含唯一 `mutationId` 与完整歌曲快照。归属沿用已保存的 `cloudRoomAccountKey`，尚无 owner 时保留原初次播种规则。保存、删除、启停、两类导入和两类清空路径在歌曲事务提交前捕获快照，写入失败整体回滚；空数组表示明确清空。其他账号的待上传快照不随当前歌库替换或清空而删除。这些行不进入普通设置、可编辑 defaults、HTTP/WS 或 Device 设置快照，不新增表或 schema 版本。

设置待上传状态由 [cloud-settings-sync-store.js](../../../src/storage/cloud-settings-sync-store.js) 保存于私有 `cloudSettingsSyncPending:<accountKey SHA-256>` 行，包含唯一 `mutationId` 与同步白名单的完整本地 `values`。`settings-store.setSettings` 在同一事务内保存设置及待传记录；单键同步设置也走此事务，尚无账号 owner 或仅修改本机设置时不捕获。白名单由 [cloud-settings.js](../../../src/shared/cloud-settings.js) 拥有，记录不包含 Cookie、设备凭据或服务器专属礼物互动意图，也不进入普通设置、defaults 和公开快照。云端应用显式使用 `{ syncPending: false }`，不产生上传回声；不新增表或 schema 版本。

本地 settings、歌曲保存/删除/启停/导入和清空歌库成功后才请求对应 scope 上传。设置与歌曲上传确认只删除同账号、同 `mutationId` 的记录；上传期间的新修改、过期生命周期的响应和网络失败均保留待上传内容。重启或切回账号时优先恢复并上传该账号的待传快照，当前歌库内容一致时不重复替换，以保留队列和历史的歌曲引用。每轮同步及拉取落盘前也检查持久记录，保护通知遗漏的提交。设置上传的规范化返回值也须确认没有较新的待传记录后才能应用。云端应用和待传恢复路径均不捕获新待传记录或发 dirty 通知；Bilibili 凭据仍使用原进程内 dirty 重试机制。

## 9. 礼物账本完整投影（Implemented）

`gift-projection-reset.js` 集中维护同步元数据重置字段，在调用方已有事务内清空 epoch/cursor/bootstrap/验证时间并递增 generation。手动清理与重建复用该操作，但前者仍清除当前来源全部事件，后者仍只清除 `cmd = 'LIRA_SERVER_GIFT'`；删除范围、事务次序和过期 generation 拒绝策略由原 store 保持。


ADR [0011-source-partitioned-gift-ledger-projection](../../architecture/adr/0011-source-partitioned-gift-ledger-projection.md) 接受在现有 `gift-data.db` 内增加 `gift_sources`、nullable `gift_events.source_id` 与 `gift_sync_state`。迁移前的行保留 `source_id=NULL`；新 `LIRA_SERVER_GIFT` 行必须由触发器保证引用有效 source。v9 追加可空 `gift_events.blind_box_id`，已有行不重判并保持 `NULL`；新远端投影保存服务器 DTO 中已验证的盒子 ID。source/time 索引服务完整历史查询，远程幂等唯一键改为 `(source_id, platform_id, cmd)`。

`gift-sync-store.js` 将历史页和 page token、增量页和 cursor、最终历史页和 epoch/recovery cursor，以及清库重建的 generation/state reset 分别放在单个 `BEGIN IMMEDIATE` transaction 中。旧 `remote-gift-cursor.json` 不再作为当前状态源。可配置 retention 不删除非空 `source_id` 的服务器投影；数据库级清空礼物会在同一事务递增 projection generation 并重置同步状态，然后显式重建。完整 DDL、不变量和验收条件见 [gift-ledger-projection-sync_design.md](../../../specs/gift-ledger-projection-sync_design.md)。

## 查询优化：song v7 / gift v12

gift v12 的 `idx_gift_events_source_recent` 按 `(source_id, datetime(created_at) DESC, id DESC)` 索引 active、付费、final 且统计合格的记录，保留旧时间解释。`idx_gift_events_source_time_asc` 按 `(source_id, detection_status, status, created_at ASC, id DESC)` 补齐升序；降序继续使用 v8 索引。时间游标先取同时间较小 ID，再取严格早于/晚于游标的剩余记录，两段共用短读事务；同方向的日期边界合并为最严格值，避免 SQLite 从较宽的 asOf 开始扫描。

gift v18 的 `idx_gift_events_retained_time` / `idx_gift_events_retained_time_asc` 分别按 `(source_id, created_at DESC, id DESC)` / `(source_id, created_at ASC, id DESC)` 索引 final、`status IN ('active','retention-staged')`、`total_price > 0`、`num >= 1` 的记录。活动保留快照的两个状态共用连续时间顺序，无须先扫描两段状态再整段排序，也不依赖 ANALYZE；查询仍检查活动快照成员与 detail_start，同时间仍按 ID 降序。

`gift-query-store.js` 的 `readHistoryPage` 在同一事务内读取总数和页面，按连接保留最多 64 个筛选计数。缓存包含来源、全部筛选/时间参数，并以 `total_changes()`、`data_version`、`schema_version` 失效；任何同连接写入或外部提交均需重新计数，只在成功提交后发布缓存。`asOf` 不承诺排除回填，跨页版本改变时返回当前读快照的新总数。缓存随数据库连接释放，不跨连接复用。

条件式历史扫描在同一读事务内核对 `contentRevision`，命中时不读总数或行。连接内临时表及触发器只追踪 `gift_events` 写入，普通同步状态更新不使记录版本失效；外部提交、schema 变化及可见时间上界对应的最后记录时间同时参与版本。每个 store 有独立实例标识，读取沿用独立读事务，调用时已有事务会拒绝；回滚和重开连接不会确认未提交内容。临时追踪不改变持久 schema 或迁移版本。

粉丝列表在已有 scope 事务内先筛选档案文本、归档、收藏与资料缺失，再通过 `records.listForProfiles` / `statesForProfiles` 每批最多 500 个 ID 读取候选明细。返回按 profileId 分组的 Map，记录仍按 occurred_at DESC、id 排序；单次列表固定当前时间，会员过滤与灯牌全局排序在计算后执行。

## 礼物身份迁移 v10

`gift_events` 增加可空 `gift_variant_id`、`blind_box_variant_id`。旧行保持 NULL，新记录随原导入事务写入冻结身份。`overtime_gift_rules` 新增 `gift_identity_key TEXT NOT NULL DEFAULT ''` 和 `gift_identity_json TEXT`，主键改为 `(gift_id, gift_identity_key)`；原九列内容完整复制。迁移可重复检查，不推断旧名称对应的标价。数字平台 ID 的无身份规则保留并等待重新选择；settlements 内容不迁移、不回放。运行时图片 index schema 2 以 variantId 保存最近成功文件，旧 numeric ID 索引不参与回退。详见 [ADR-0014](../../architecture/adr/0014-gift-identity-bound-overtime.md)。

## 签到云端数据与旧库兼容

签到累计、每日记录和抽签结果保存在云端租户 `streamer.db`，随整库备份恢复后继续使用。客户端直接控制开关，并按需编辑服务器正式词库；已确认词库仅缓存于 Electron main 当前授权 context，编辑草稿仅保留于页面，不新增本地持久词库。不显示旧数据处理流程，也不自动读取或上传本机旧库；关闭或重启不清空云端历史。`checkin-data.db` 原位保留，daily-bot-legacy-reader 仅作为旧 API/IPC 的一次性只读兼容适配器，显式调用仍要求停写及归属确认。本地签到写入 store 与签到/抽签执行服务已删除，生产 domain-services 继续占用精确命令并返回 cloud-owned。普通旧库维护接口语义保持原状。

## 共享字体缓存

[src/fonts/font-library.js](../../../src/fonts/font-library.js) 拥有 `data/cache/fonts/`，路径由 `resolveDataPaths().fontsDir` 计算。它属于设备级可重建公共资源，与登录资料、用户上传素材和可执行安装文件分开；安装目录迁移沿用整个 data 根规则，升级不会重复下载。文件名为 `<SHA-256>.ttf` 或 `.woff2`；`index.json` 为 `{version:1,fonts:{<id>:{sha256,format}}}`，只保存已校验资源，无绝对路径或账号凭据。

下载与索引均通过同目录独占临时文件写入后 rename。每个字体成功即保存，失败保留旧索引与旧文件；成功替换且索引写入后回收无人引用的旧文件，文件繁忙时保留待手工清理。启动按清单校验缓存，索引中断可从哈希文件恢复；取消下载不发布不完整字体。九款完整字体同时随安装包内置于 `resources/app.asar/public/fonts/`，正常首次离线无需创建缓存；删除旧字体缓存后可直接使用内置字库，不触发下载。只有相应内置资源和有效缓存均不可用时才尝试网络修复。来源、体积与安装资源位置见[字体说明](../../../public/fonts/README.md)。
