# 礼物服务器投影与醒目留言服务

> 涉及文件：[gift/projection-service.js](../../../../src/bilibili/gift/projection-service.js)、[gift/consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js)、[gift/statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js)、[gift/normalizer.js](../../../../src/bilibili/gift/normalizer.js)、[gift/query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift/blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js)、[gift/blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js)、[gift/index.js](../../../../src/bilibili/gift/index.js)、[superchat-service.js](../../../../src/bilibili/superchat-service.js)、[domain-services.js](../../../../src/server/domain-services.js) 的 gifts/superChats 段

本文档是客户端侧**礼物服务器投影与醒目留言服务**的单一事实来源，说明本地账本、消费者分发、盲盒与冲刺统计、礼物许愿及 SC 状态机。原始 B 站礼物解析与权威检测已迁至 `lira-server`，客户端只接收服务端处理后的 DTO 并投影给本地消费者。本地发送者身份提取见 [protocol.md](protocol.md) §6，`gift_events` / `super_chats` 表结构见 [storage.md](../storage.md) §3.3/§3.2，快照 `gifts` / `giftSprint` / `giftDetection` / `superChats` 字段见 [ws.md](../ws.md) §2，HTTP 接口见 [api.md](../api.md)，服务端协议见 [server-authoritative-gift-detection_design.md](../../../../specs/server-authoritative-gift-detection_design.md)。

**模块边界：** `gift/sale-catalog.js` 负责目录缓存、刷新与对外门面，`gift/sale-catalog-parser.js` 仅做目录响应的纯解析与归一化；`users/user-info-service.js` 负责网络请求、缓存与失败策略，`users/user-info-evidence.js` 仅做用户证据和风险字段归一化。纯解析模块不得维护服务生命周期或重复缓存。

`gift/effect-config.js` 的特效布局与失败 URL 缓存仅保留当前特效目录引用的地址：目录刷新成功时清理旧条目，迟到的旧请求仍返回给原调用方但不回写过期缓存；刷新失败时保留旧目录与缓存，并沿用请求合并和失败重试间隔。

远端全局目录的缓存（刷新合并、ETag、停止代次与落盘后发布）、Schema 3 完整历史活动目录校验（不设 10,000 条活动身份硬上限，全包校验通过后才持久化发布，非法大目录保留旧快照且不截断历史身份）及图片校验策略归 `remote-catalog-cache.js` / `remote-catalog-contract.js` / `remote-catalog-image-policy.js` 维护，详见 [overtime.md §1.5](../overtime.md#15-服务器全局礼物目录联动)。`variant-room-catalog.js` 在单次合并中建立自定义盒子及产物的精确身份索引，复用 ID、名称与标价的匹配结果，避免逐个产物扫描全目录；同一身份证据对应多个候选时仍不猜测，房间顺序、已选 variant 去重和目录覆写规则保持不变。

## 1. 架构总览

```
Electron remote gift controller (服务器 SSE / cursor / history)
  │ importProcessedEvent / importProcessedHistoryRecord
  ▼
createGiftService (gift/index.js)                    ← domainServices.gifts
  ├─ GiftProjectionService     仅投影服务器 progress/final
  │    ├─ gift_events 共享账本 (storage.md §3.3)
  │    └─ ConsumerRegistry.dispatch(toStandardEvent) 分发标准事件
  │         ├─ giftStatistics (statistics-consumer.js)  礼物冲刺统计
  │         └─ overtime     (overtime-consumer, 见 overtime.md)
  ├─ query-service: getSnapshot/getHistory/getStatistics
  ├─ sprint-service: getSprintSnapshot/resetSprint（含聚合缓存）
  └─ blind-box-analysis: 盲盒统计与分析
```

**装配与存储隔离：** `domainServices` 一次性创建 `projectionStore`、`statisticsStore`、`queryStore` 与 `maintenanceStore`，并装配 `createGiftService`（注入 `final` 回调、加班消费者及 `getOvertimeEpoch`）。`gift/index.js` 只组合领域服务与活动来源状态，不直接接收数据库句柄或隐式构造存储；`query-service.js`、`sprint-service.js` 与 `blind-box-analysis.js` 不访问数据库，来源仅以 `{kind: 'local'}`、`{kind: 'source', sourceId}` 或 `{kind: 'unavailable'}` 交由 `gift-query-store.js` 翻译成 SQL（切换中或无效来源返回空查询且不重置冲刺）。盲盒行筛选与排序由 query store 执行，领域层保留日期边界、聚合与展示投影；`gift-maintenance-store.js` 的 `clearRecent({updatedAt})` 保留最近 3000 条本地合格记录及待结算协调状态，不删除远端来源记录。服务器事件经 `importProcessedGiftEvent` 进入投影器（见 §6.1）。

**礼物感谢与大航海动效（`final` 回调）：**

- **全屏礼物感谢（`src/bilibili/gift/frame-config.js`）**：内置主题「林间花信」（`themeId: 'woodland-bloom'`）由 `giftFrameEnabled` / `giftFrameThresholdRmb` 控制。金额直接读取 `final` 记录的权威 `total_price` 换算为整数分后比较门槛，不按 `unit_price * num` 重算，也不读取官方媒体映射；达标时以稳定 ID `gift-frame:<giftEventId>` 广播 `gift:frame`（开关关闭、非 `final`、金额为 0 或未达门槛时不广播）。导入的图片/视频样式在同一笔礼物内只解析一次 `giftFrameStyleTriggers`，经 `buildGiftFrameStyleEvent` 按各样式开关与含等号门槛筛选（候选 ID 来自本机样式库索引，含已从可选库移除但场景可能仍引用的样式），有达标样式时只生成一条 `gift-frame:<giftEventId>:imported`（`themeId: 'imported'`，附 `styleIds`，仅发布到场景窗口、不广播到旧 `/gift-effects` WS 页面；样式库读取失败时跳过且不影响林间花信及掉落/摇摇乐）。管理页预览通过 `/api/gifts/frame/preview` 使用独立预览 ID，不污染实时去重集合。事件 `avatarUrl` 取自 `final` 行已知头像并经 B 站头像白名单校验（见 [protocol.md](protocol.md) §2.3），缺失或不合法时置空，不额外补查。
- **原生掉落与摇摇乐（`gift/motion-config.js`）**：在同一 `final` 入口分别按 `giftDropEnabled` / `giftDropThresholdRmb` 和 `giftSwingEnabled` / `giftSwingThresholdRmb` 匹配，同样以权威 `total_price` 转整数分比较（含等于门槛；门槛为 0 时仅放行金额大于 0 的礼物），`progress` 与历史重放不触发。两者可同时触发，独立于林间花信主题队列；事件 ID 为 `gift-motion:<gift-drop|gift-swing>:<final行ID>`，沿用 `gift:frame` 通道与来源隔离，新增 `startedAt` / `artworkPath` / `motion` 展示字段。`runtime-transport.publishGiftFlushed` 在入口固定本次本机时间戳，不受后续图片准备耗时影响；图片优先按 `gift_variant_id`、其次按稳定礼物 ID 复用 `hybrid-catalog.getArtworkResolver()` 索引与本地完整性缓存（不按名称猜测、不扫全库、不发远程下载，缺图回退礼物/舰队占位图）。单次事件参数随事件冻结，后续改配置不影响已展示动效的截止时间（播放与容量规则见 [礼物展示页](../../frontend/overlays.md#14-礼物四方边框gift-effects)）。
- **大航海感谢（`src/bilibili/gift/guard-thanks-config.js`）**：在同一 `final` 回调中生成，辉光与经典分别读取 `guardThanksAuroraEnabled/TextMode`、`guardThanksClassicEnabled/TextMode`（新键为空时按旧 `guardThanksEnabled/TextMode/Style` 兼容解析，仅旧选中风格继承开关）。先由 `guard-gift-aliases.js` 规范化礼物 ID（`guard-3/2/1` 及别名）识别舰长/提督/总督，ID 无法识别时仅接受完全等于「舰长」「提督」「总督」的礼物名。合格记录按启用的风格分别以稳定 ID `guard-thanks:<giftEventId>:<aurora|classic>` 广播 `gift:guard-thanks`（携带等级、昵称、月数即礼物 `num`、经白名单校验的头像及该风格 `style/textMode`；同时启用时按辉光、经典顺序入队并分别去重，不读金额阈值，不影响记账/统计/边框）。管理页预览经 `/api/gifts/guard-thanks/preview` 使用独立预览 ID。资源型航海旗帜由同模块 `buildNauticalGuardThanksEvent` 生成 `style=nautical`、ID 后缀 `:nautical` 的独立事件（配置与兼容规则见 [storage.md](../storage.md)，展示范围见 [资源型样式](../../frontend/overlays.md#资源型样式)）。

### 礼物许愿

同一轮快照按时间窗批量读取 `count` / `todayCount` 并复用 retention 快照；`hybrid-catalog.getArtworkResolver` 按房间、全局目录修订号及自定义盲盒配置复用礼物身份索引，仅对本轮实际使用的礼物检查本地图片。图片修订号变化只使已解析路径失效，不重建整份目录；下载完成后立即更新，外部删除或损坏在 1 秒复查窗口后重新检查。房间同 key 条目优先，完整目录 getter 返回副本并保留图片完整性检查。

显式读取完整目录时，房间快照、全库快照与按礼物查图共用同一图片修订号下的文件结果。图片缓存未提供修订号时，每次快照查图都重新校验候选文件，外部补图、损坏或删除在下次读取可见。仅当解析出的图片路径变化时才替换对应目录行。全库条件响应也复用内容未变的摘要。

`wish-service.js` 负责长效、本日、本场三类许愿；`wish-session.js` 按需拉取 B 站 `room_init.live_time` / `live_status`（30 秒缓存并合并并发请求），直播间号取自组合根注入的当前账号配置。`gift-wish-store.js` 按来源隔离保存许愿定义和最近直播窗口，并按当前授权来源合并活动快照内的最终流水、完整日汇总与非整日边界统计。历史导入数据在快照激活后计入进度（不受实时通知资格限制），未激活的暂存数据不可见，互斥统计集合避免重复累计。创建日与本场起止窗口按精确时间统计，不用整日总量近似；正常明细回收不会导致已有进度回退（存储细则见 [礼物保留存储](../storage.md#礼物保留存储)）。

管理页本场页签和独立源的本场预览始终读取直播窗口，空列表也能显示开播状态。管理页的长效、本日页签、场景输出、画布预览、独立浏览器源及其他周期预览按卡片需要取数。当前授权来源只要有一条本场心愿，所有这些视图仍使用真实窗口和历史流水。其他情况下，纯卡片请求跳过房间查询，返回 `session: null`。

换房期间只允许当前房间的有效请求写入该来源的最近窗口和内存缓存。晚返回的旧请求提示刷新。当前房间随后查不到直播状态时，沿用它上次确认的起止和检查时间统计本场数量。

- **统计周期**：长效自服务端创建时间起算；本日自北京时间当日 00:00 起算（含当日创建前流水）；本场自确认的开播时间起算，重连与重启不重置，下一场开始自动切换窗口。确认离线时本场归零并等待开播，不把重新打开页面的时刻当作下播时间；上游不可用时暂停本场计数并冻结至最后确认开播时刻，恢复后按窗口重算（直播状态最多延迟 1 个 30 秒缓存周期）。
- **目标与计数**：目标须为正整数，实际数量只累计正整数 `num`（可超过目标，进度条封顶 100%）。修改目标或文案不重置创建时间，删除只删许愿定义；计数反映当前账本，用户主动清空流水会同步影响进度。
- **今日已收（`todayCount`）**：按北京时间当日 00:00 至快照时刻的同来源、同身份最终 `active` 流水统计（含创建前当日礼物，独立于长效/本场目标进度；本日条目直接复用 `count`）。文字版在 `todayCount > 0` 时切换为已收颜色，次日按新日窗口恢复未收颜色（未达目标也会变色）；两色支持逐条自定义（默认与预览规则见 [前端页面](../../frontend/pages.md)）；卡片与徽章沿用目标完成状态。
- **目录与匹配**：复用加班机当前房间与全库缓存。新建普通礼物或盲盒许愿必须具备已同步的 variant 身份，房间中尚未匹配身份的候选标为待同步且不可选，服务端亦拒绝保存。完整 variant 身份精确匹配，未知历史身份不猜测；既有无 variant 的许愿按 ID 兼容。盲盒本体匹配 `blind_box_variant_id` / `blind_box_id`，产出匹配 `gift_variant_id` / `gift_id` 且要求 `is_blind_box=1`，单笔产出可同时推进盒子与产出两条独立目标。
- **图片与跨域隔离**：普通礼物使用已校验的 B 站原图本地缓存（含 WebP 与部分 PNG），舰长/提督/总督使用内置 WebP。文字版在 `{图片}` 位置显示原图或由共享渲染模块取默认帧/首帧生成的静态 PNG（仅页面内存缓存，失败回退占位图；旧位置配置兼容见 [前端页面](../../frontend/pages.md)）。静态 PNG 转换以 anonymous CORS 加载公开素材；`/overtime-gift-images/` 的合法图片 GET/HEAD 响应提供 `Access-Control-Allow-Origin: *`（不允许跨域凭据），叠加层保持不透明源（`opaque origin`）沙盒，只读投影不含内部来源或送礼人信息。

## 2. 服务器结果投影（GiftProjectionService）

### 2.1 实时事件导入

`importProcessedEvent` 验证服务器 DTO 与本地授权 `source`，以 `source_id + lira-server:<eventId>` 查找已有投影。首次接收时冻结统计资格与加班纪元（`overtime_epoch`）；后续 `progress` 更新直接使用服务器字段，`final` 只完成一次落库和消费者分发。最终记录重复导入时校验内容一致，不重复触发统计、加班或边框。金额、数量、盲盒成本和盈亏均直接来自服务器，不做本地推算。

同次导入的业务字段只保存一次：首次 `final` 复用插入值，已有 `progress` 收到 `final` 时只更新一次字段；定稿后统一读取最终行，不再读取未被使用的中间行。服务器事件在消费者关闭时仍会落库，以确保远端游标持续推进；UID 与原始包不进入该导入路径。实现见 [projection-service.js](../../../../src/bilibili/gift/projection-service.js)，传输与事务协议见 §6.1。

### 2.2 progress → final 与本地生命周期

客户端只在收到服务器 `final` 时收尾，没有静默窗口或主动 flush 入口；创建、恢复、暂停、恢复写入和销毁都不会把已有 `progress` 自行改为 `final`。暂停/销毁取消的定时器仅用于消费者失败重试；暂停代次同时阻止旧事务的延迟回调在清库之后继续投递。

`recover()` 仅重投服务器来源的已确认 `final` 中尚未完成统计投递的行。`getStatus()` 保留既有快照字段，`pendingCount` 只统计服务器 `progress`；既有数据库列名与历史数据继续保留。

### 2.3 消费者分发与补偿重投

[consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js) 逐一分发冻结的 `{phase, giftEventId, gift, eligibility}`，单个消费者失败不阻断其他消费者：

| 消费者 | 行为 | 出处 |
| --- | --- | --- |
| `giftStatistics` | `final` 且具备统计资格时，在事务内更新 `counted_in_sprint` 和 `gift_stats_delivered`，重复投递不重复计入 | [statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js) |
| `overtime` | 按冻结的 `overtime_epoch` 与完整礼物身份结算秒数 | [overtime.md](../overtime.md) |

`final` 分发失败后按 `min(30s, 1000 * 2^attempt)` 退避重投（指数上限为 5，总重试次数不封顶，成功或事件不再存在时停止），各消费者自行保证业务幂等。需要与远端游标原子提交时，`final` 分发注册为事务提交后回调，回滚不触发消费者。

## 3. 历史导入与存储边界

`projection-service.js` 接收专用存储端口，保留输入校验、`progress` / `final` 决策和重试生命周期；SQL 与表字段操作归 `storage/gift-projection-store.js`。`statistics-consumer.js` 委托 `storage/gift-statistics-store.js:deliverOnce` 在单个 `BEGIN IMMEDIATE` 事务内检查 `final` / 资格 / 投递标记并更新统计标记。投影调用可加入 `gift-sync-store` 的现有事务，消费者仅在提交后分发（见 §2.3）。

[gift-sync-runtime.js](../../../../src/server/gift-sync-runtime.js) 负责同步与保留存储的装配和应用生命周期，维持历史导入、增量追平、旧协议提交与投影重建端口；本地保留清理先裁剪明细，仅当本批未删除明细时才清理旧快照，事务与投影防护校验（fence）由对应 storage 模块负责。

`importProcessedHistoryRecord` 独立导入服务器历史 `final`，校验 `source` 和重复记录一致性，并将历史行标为不参与本机冲刺累计或加班结算（不触发消费者或特效边框）；可见历史明细仍参与盲盒汇总、排行与分析。`normalizeGiftRow` 仅整理数据库输出类型，表结构与已有历史数据维持不变。

### 明细保留与历史汇总

服务端约 90 天、本机已接收明细约 365 天及长期统计受 [保留期规格](../../../../specs/gift-retention.md) 约束。[gift-retention-queries.js](../../../../src/storage/gift-retention-queries.js) 将已结束日汇总与未覆盖明细组成互斥集合，先合并完整分组再排名，不用汇总行数代替笔数。历史接口只返回实际可用明细，并附本地保留期限、服务器恢复下界与覆盖证明；过期日期仍可查询金额、笔数及盲盒汇总。

明细回收前，只为原本具备实时统计资格的记录结转冲刺金额及按日/用户/盒型的盲盒归档；重置冲刺时同步清空结转，尚未完成加班结算或统计投递的原记录暂不回收。历史导入不触发任何实时副作用，离线前已收到的 `progress` 仍走既有 `final` 导入路径收尾并保留原资格；盲盒逐笔列表只展示真实明细，不用汇总数据替代单笔开盒记录。存储表、同纪元重建与回收事务见 [礼物保留存储](../storage.md#礼物保留存储)。

## 4. 盲盒：服务器结果与客户端展示

礼物目录以 `giftCategory` 区分 `directGift`（直送礼物）、`blindBox`（盲盒）与 `blindBoxOutput`（盲盒产物），奖池关系按完整活动身份绑定。服务端核验奖池与活动身份后，会为上游漏标的盲盒产物补全 `isBlindBox`、`blindBoxId`、盒名、成本和盈亏；客户端直接导入这些权威字段，不按本地目录反推或改写账本（[blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js) 仅校验待同步的盲盒配置格式）。共享产物无法唯一确定来源盲盒时，成本与盈亏保持未知；历史旧记录不自动重算。

展示侧按以下规则使用目录与账本数据：`public/js/shared/gift-catalog-roles.js` 将已校验的 `giftCategory` 展示为「直送礼物 / 盲盒 / 盲盒产物」，官方盲盒筛选要求 `giftCategory=blindBox` 且具备已核验奖池；共享产物展示全部关联奖池，身份不符时不猜测标签，迟到的旧请求不得恢复已移除的奖池关系。`public/js/admin/gifts/recent.js` 按事件标记与冻结的来源身份匹配盲盒图片（无身份旧记录仅在 ID/名称唯一匹配时取图，特殊配色还须名称匹配，否则用占位图）；盈亏为有效数字时直接按正负着色，未知值显示「盈亏待确认」。

盲盒盈亏汇总、排行与分析读取 `final + is_blind_box=1 + blind_profit 非空` 的当前来源有效记录，包含离线或安装前由服务器记录、随后同步的历史明细，不受本机实时消费者的 `gift_stats_eligible` 限制。存在保留快照时沿用活动快照成员筛选，分批下载的历史在快照激活后才参与；无来源的旧本地记录仍要求原统计资格。统计按送礼时间归入本机当日，分析支持显式日期范围，由 [blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js) 的 `prepareBlindBoxQuery` 校验日期并计算本机日界（HTTP 参数与返回字段见 [api.md §10](../api.md#10-礼物域gifts)）。

礼物首页展开「今日盲盒盈亏」时按本机午夜刷新，使用 `top=10&includeRecords=0` 读取汇总和观众前十名。查询服务在复制响应前省去 `records`，共用同一份当日统计缓存。管理接口省略 `includeRecords` 或传 `1` 时仍可取得最多 500 条逐笔明细。

设备授权中断会清除只读盲盒映射摘要。同账号恢复后，云同步可用同一设置版本重新发布已确认的摘要。旧版本、待上传的本地编辑及账号切换沿用各自的同步校验。[云设置同步控制器](../../../../src/electron/cloud-settings-sync-controller.js)

当天统计在查询服务内按来源、本机当日始末时间戳及盲盒输入变更标记缓存，最多保留 2 个最近使用的盒名结果（使管理页全部盲盒与心动盲盒交替读取时互不驱逐）。同连接的普通礼物、同步校验时间和投递标记不触发重算；盲盒历史导入、活动快照切换、查询输入修订、归档变化、清理、其他连接提交、来源或连接替换、跨日或时区变化均使缓存失效；事务内读取不入缓存，对外返回独立结果。分析入口另为每个查询上下文缓存最近一份分页响应（不缓存完整历史行），返回副本。内部 `getBlindBoxChangeToken` 复用上述来源、账本和日界标记并由门面绑定来源切换代次，供场景适配器做条件投影校验（事务内或来源切换中返回 `null` 回退完整读取）。底层数据库变更追踪见 [查询优化](../storage.md#查询优化song-v7--gift-v12)。

`boxName=心动盲盒` 的统计另返回 `heartBoxProgress.openedSinceCastle`：按 `created_at`（含毫秒）及行 ID 顺序，累计今天最近一次开出浪漫城堡之后的心动盲盒数量（出堡行归零，当日未出堡则为今日累计）。仅接受心动盲盒 ID `32251`（旧行缺 ID 时回退精确盒名），浪漫城堡按产物 ID `32132` 识别；直送礼物及其他盒型/日期/来源不参与。进度包含盈亏未知但已确认的有效开盒记录（盈亏汇总仍排除这些行），直接从账本恢复；其他 `boxName` 查询返回 `null`。

### 心动盲盒每周收集

`gift/heart-box-collection.js` 负责固定每周任务：按北京时间每周六 00:00（含）至周五 00:00（不含）累计，周五继续返回刚结束一期的结果，下一周六切换新一期。查询当前授权来源的已定稿、有效、正整数数量的心动盲盒（含开启功能前本期已有流水及开出城堡的盒子，出堡不重置）。盒 ID `32251` 跨活动身份累计，旧行仅缺盒 ID 时回退精确盒名「心动盲盒」（其他 ID 即使同名也不参与），复用 `gift-wish-store.js` 的窗口聚合与保留汇总。

管理端可校准本期总数。`heart-box-collection-store.js` 保存「校准总数 − 保存时原始聚合」的差额，实际展示为 `max(0, 本期原始聚合 + 本期差额)`，后续定稿礼物继续累加，流水修正亦参与重算。每个来源只保存最近一次校准的周期与差额，重启与周五继续有效，下一周六自动作废；校准不改写礼物流水、盈亏或其他统计。保存前同步校验编辑时的来源修订号、周期起点及累计数量，防止被新礼物、其他校准、来源切换或跨周覆盖（持久化见 [storage.md](../storage.md)，接口见 [api.md §10](../api.md#10-礼物域gifts)）。

图片由目录服务的 `getArtworkResolver` 按需检查：活动身份 key 优先，稳定礼物 ID 仅在索引唯一时作别名，歧义不猜图，不在每次刷新时全库扫描。缓存未就绪时组件以礼物盒 / 城堡线条图标承接缺图，不反复请求同一失败地址。

固定解锁档位为：20 个 → 4 倍限开 1 个、40 个 → 4 倍限开 2 个、80 个 → 5 倍限开 1 个、120 个 → 5 倍限开 2 个。服务返回下一未解锁档的目标及差额，全部解锁后目标保持 120、差额为 0，真实数量继续保留；倍率仅作任务奖励展示，不参与概率计算也不扣减已开城堡。来源不可用时返回 `GIFT_SOURCE_UNAVAILABLE`，同步未完成时标 `partial:true`（接口见 [api.md §10](../api.md#10-礼物域gifts)，展示与交互见 [心动收集组件](../../frontend/overlays.md#心动盲盒收集组件)）。

## 5. 礼物冲刺与查询

礼物冲刺快照、重置与聚合缓存由 `sprint-service.js` 负责，按来源和冲刺输入变更标记复用缓存；队列等无关快照通知或空同步仅更新校验时间时不重复求和。目标值与开关每次实时读取；计入冲刺的礼物金额、资格、来源变化，以及结转、重置、外部连接提交或来源切换均使聚合失效；事务内读取不复用或写入缓存。

最近礼物从当前来源的已发布明细读取（含云端恢复的历史记录），沿用明细成员证明与本机保留期限，不以 `gift_stats_eligible` 作为展示条件；暂存历史在原子激活前不可见。恢复从 `BOOTSTRAPPING` 进入 `CATCHING_UP` 时，由现有 `gift:source` 快照刷新首页；前端通知跳过 `gift_stats_eligible=0` 的记录，历史资格不触发冲刺或加班消费者。旧本地来源保留原统计资格筛选。

首页按礼物发生时刻倒序取前 30 条。本地与远端来源的时间先统一到 UTC 毫秒，相同时刻按本机行 ID 倒序。服务器留存分页允许较晚发生的礼物先传到桌面，恢复后沿用上述排序。

### 流水筛选、选择快照与展示资料

`history-filters.js` 负责北京时间日期边界、独立用户/礼物名称过滤与来源版本。`getGiftHistory` 在完整有效流水上先筛选再分页，支持 `today` 和起止日期；游标绑定筛选、排序、`asOf` 与 `viewRevision`（包含 `source`、持久化投影代次及进程内来源切换代次）。排序保留勾选，筛选、清库/重建或切换来源使选择失效。

礼物滚动的 `/api/gifts/history` 支持条件读取（`conditional=1`）与有序增量（`delta=1`，配合 `created_at asc`）：响应携带覆盖真实写入、外部提交、来源/连接、筛选与时间边界的 `contentRevision`（不同于仅表示来源代次的 `viewRevision`）。完整读取且跨页版本一致后，后续请求可命中 `unchanged:true` 或获取含 `items` / `removedEventIds` 的增量变更；发生跨页变动、基础版本丢失、物理删除、身份变化、外部提交或快照切换时自动回退全量分页（HTTP 参数与返回字段见 [api.md §10](../api.md#10-礼物域gifts)，变更追踪上限见 [storage.md](../storage.md#查询优化song-v7--gift-v12)）。

`gift-card-runtime.js` 对支持 `revision` 的远端 `gift-card-profiles` 执行同样的完整分页确认（旧服务无版本时全量读取）。远端版本按租户、北京时间日、`syncEpoch` 与账本变更生成，与普通弹幕/进场写入无关；资料未变时复用 UID/头像准备结果并仅重试仍缺失的 UID，头像补全后本地 `contentRevision` 随之更新。当服务端声明 `incremental:true` 时，客户端携带已完整接收的 `afterRevision` 拉取增量资料（带 `append:true` 时合入旧缓存，否则整批替换）：同次增量翻页固定基于同一基线版本，全部页的版本、日期、`syncEpoch` 与模式一致才提交；若出现重复 `eventId`、分页版本/模式混杂或请求失败，则保留旧缓存并标 `partial`，不发布不完整结果，也不原地修改已对外返回的数组。日期、来源、reset 或 `syncEpoch` 变化均触发缓存失效；服务端更正/删除历史、乱序终结或无法确认基线时自动回退全量，已协商服务端若拒收 `afterRevision` 最多回退重试一次全量读取（完整线路协议见 `lira-server` 的 `docs/protocol/client-server-api.md` 与 Device OpenAPI）。

读取今日卡片资料时，`gift-card-runtime.js` 先复用同来源、同日、同 UID 的已知头像；仍缺失的头像经 `bilibiliRuntime.getUserAvatar` 调用 `UserInfoService.ensure` 向 B 站补查（最多 4 路并发、单次卡片读取最多等待 4 秒；未及时返回的慢请求在后台写入资料缓存供后续刷新复用）。失败与空结果遵循用户服务的 30 秒负缓存且不清除已知头像，迟到结果不得跨日、跨来源或跨 reset 发布。补查仅生成展示投影，不修改礼物账本、冻结事件、金额、等级或历史 DTO；未知 UID 和跨日历史不按昵称猜测。滚动区每次刷新重试已失败的头像并复用成功头像；PNG 导出阶段等待头像最多 9 秒（覆盖头像代理的 8 秒超时）。

`getGiftSelection` 在同一读事务内冻结最多 10000 条当前来源记录，不合并同用户同礼物；显式传入的 `eventIds` 必须全部仍在当前筛选内。导出运行时冻结选择、展示设置与本地素材目录，后续新礼物不进入已有任务。

导出预览先校验选项，待合并方式确定后按最终选中的冻结快照生成文件清单。导出快照优先使用账本已有的头像及今日卡片资料。`gift-export-runtime.js` 仅对仍缺头像的已选公开事件 ID 批量调用 Device `POST /api/device/gift-card-avatars`（每批最多 200 条，总时限 4 秒）。服务器按租户依次使用原记录头像、同 UID 同北京时间日的已知头像和按 UID 向 B 站查询的当前公开头像；桌面端校验返回 ID 和头像 URL，确认来源版本及北京时间日期后将地址用于本次预览和 PNG，无法确认身份或取到头像时使用默认头像。

导出开关 `mergeAcrossDates`（合并同种礼物）默认关闭。关闭时每笔所选结算记录独立成卡，包括北京时间今天的记录，保留事件 ID 和原数量。开启时先用打开预览时已确认的今日送礼人资料合并同款，再为剩余礼物 ID 与名称相同的候选向 Device `POST /api/device/gift-card-groups` 一次提交代表事件 ID。服务端按同租户账本中的可靠 UID 和礼物身份返回选内分组。每组保留按时间倒序的首笔位置。合并卡片用 `settledTotalCents` 累加各笔 `gift.totalPrice` 的整数分金额，供导出按金额排序，`cardTotalCents` 继续用于横幅分色。服务端缺少明细、身份或暂时离线时保留已有证据支持的结果并提示。

礼物横幅按单价整数分乘数量分色，配置持久化为本地 `giftDisplayConfig`，不进入云端同步作用域（远端展示字段协商见 §6.1）。

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 开关/目标 | `enableGiftSprint`（默认 `'true'`）、`giftSprintTargetRmb`（默认 `'0'`，见 [storage.md](../storage.md) §7） | [settings-store.js:19-21](../../../../src/storage/settings-store.js#L19-L21) |
| 全屏礼物感谢 | `giftFrameEnabled`（默认 `'false'`）、`giftFrameThresholdRmb`（默认 `'20'`，林间花信固定 8 秒）；导入样式使用 `giftFrameStyleTriggers`（默认 `''`），行为见 §1 | [frame-config.js](../../../../src/bilibili/gift/frame-config.js)、[settings-store.js](../../../../src/storage/settings-store.js) |
| 大航海感谢 | `guardThanksAuroraEnabled/TextMode`、`guardThanksClassicEnabled/TextMode`（默认空值继承旧配置，行为见 §1） | [guard-thanks-config.js](../../../../src/bilibili/gift/guard-thanks-config.js) |
| 水晶球价值 | `CRYSTAL_BALL_VALUE_RMB = 100`（RMB） | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js) |
| 冲刺快照 | `receivedRmb = SUM(total_price)`（`final` + 资格 + `counted_in_sprint=1`）；`remainingRmb = max(0, target - received)`；**`remainingCrystalBalls = ceil(remaining / 100)`** | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js) |
| 列表快照 | `getGiftSnapshot` 取当前来源最近 **30** 条可见的 `final` 付费明细，旧本地来源另要求统计资格。`getGiftHistory` 解析当前授权 `source`，分页 limit ≤ **100**，按白名单字段复合 keyset 排序并返回 `total/totalPages` | [query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift-query-store.js](../../../../src/storage/gift-query-store.js) |
| 重置 | `resetGiftSprintProgress` 按当前来源清零 `counted_in_sprint` 并清除对应冲刺结转；事务由 `gift-query-store.js` 负责 | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js) |

`counted_in_sprint` 由 `giftStatistics` 消费者在 **final** 时落定（§2.3），因此冲刺统计天然只含已收尾事件。

## 6. 快照与端点

- `giftSourceEpoch` 是礼物服务在进程内随机生成的展示来源代次。展示页只拿到这个 UUID，实际来源键留在本机服务内。同源留存历史激活或同一授权账号清库重建时沿用原值，展示来源改变时生成新值。
- WS 快照 `gifts`（礼物事件列表）/ `giftSprint`（冲刺状态，含 `crystalBallValueRmb`）/ `giftDetection`（`getStatus()` 的 `coreActive/pendingCount` 等）由本服务产出（见 [ws.md](../ws.md) §2）；`superChats` 见 §7。
- 礼物/SC 的 `/api/*` 端点组（`gifts`、`superChat` 两组 context，见 [server.js:312-325](../../../../src/server.js#L312-L325)）完整清单见 [api.md](../api.md)。

## 6.1 服务器权威礼物与客户端投影

原始 B 站包的解析、平台身份去重、连击累计、盲盒价值覆盖和 6 秒静默收尾由 `lira-server` 的每主播 `RoomMonitor` / `gift-detector` 独占。服务端将 `final` 行与 delivery cursor 在同一 SQLite 事务中提交，再通过按 `streamerId` 分桶的内存 broker 加速在线设备投递；旧历史行保留但不生成新的 delivery cursor。

Electron 仅在主进程使用授权 DeviceBearer 请求远端礼物接口。传输载荷校验与内部规范对象转换由 [processed-gift-contract.js](../../../../src/shared/processed-gift-contract.js) 分层维护：`validateGiftDisplayWire` 先拒绝未知或缺失字段，再由 `canonicalizeGiftDisplay` 处理文本、时间、金额和内部派生值。

| 版本 / 协商 | `gift` 严格字段集合 | 处理规则 |
| --- | --- | --- |
| 基础（无扩展） | `giftId,giftName,userName,num,unitPrice,totalPrice,coinType,isBlindBox,blindBoxId,blindBoxName,blindBoxPrice,blindProfit,createdAt` | 旧服务仍可接收；缺失身份规范化为 `null`，缺失 `display` 不猜测 |
| `X-Lira-Gift-Identity: 1` | 基础 + **同时出现** `giftVariantId,blindBoxVariantId` | 每项为 `null` 或 `gv_` 加 64 位小写十六进制；非盲盒的 `blindBoxVariantId` 必须为 `null`。首次导入写入事件身份列，后续不可将非空身份改写为另一身份；旧历史仅核对展示投影后幂等跳过，加班消费者按完整身份匹配，目录刷新不改已结算记录（详见 [礼物身份规格](../../../../specs/gift-identity-overtime.md)） |
| `X-Lira-Gift-Display: 1` | 基础 + `display` | `display` 必须为完整对象、不可为 `null`；v11 迁移添加可空 `avatar_url`/`guard_level`，旧数据不按昵称补齐且不改金额统计 |
| 两项独立能力同时协商 | 基础 + 两个身份字段 + `display` | 仍为封闭字段集合，拒绝其他扩展字段 |

pull/history 与 SSE 的请求头统一由 [gift-protocol.js](../../../../src/electron/license/gift-protocol.js) 设置；SSE 另带 `X-Lira-Gift-Effects: 1`，仅协商特效事件，不扩大记账 DTO。展示能力不依赖活动身份能力。

`display = {version: 1, avatarUrl, guardLevel}`：`avatarUrl` 为 `null` 或长度 ≤ 2048 且通过 B 站 `*.hdslb.com` HTTPS 白名单的地址（无用户名、密码、非默认端口、query 或 fragment，见 [protocol.md](protocol.md) §2.3）；`guardLevel` 为 `null` 或 `0/1/2/3`（`null` 表示未知，`0` 表示已知无大航海等级）。传输载荷不含 UID、`roomId`、`streamerId`、`cmd`、平台/连击 ID、raw JSON、Cookie、CSRF 或 token。

实时事件严格为 `{eventId,cursor,phase,gift}`：`eventId` 为 1–64 字符，首位字母/数字，后续仅允许字母/数字/点/下划线/冒号/连字符；`progress.cursor` 必须为 `null`，`final.cursor` 为正安全整数。历史记录严格为 `{eventId,gift}`，不伪造实时游标。`gift.num` 为正安全整数，价格为数值（仅 `blindBoxPrice` / `blindProfit` 可空），`blindBoxId` 为 1–20 位非零开头十进制字符串或 `null`。规范化阶段要求金额可表示为安全整数分（浮点容差 `1e-7`），拒绝超过两位小数的有效精度，派生 `unitPriceCents` / `totalPriceCents` / `blindBoxPriceCents` / `blindProfitCents` 并规范时间；`totalPrice` 对应整数分必须大于 0（`0.001` 直接校验失败，不舍入入库）。这些 `*Cents` 字段仅供内部计算，不得回传或加入协议字段白名单。

网络入口 `normalizeProcessedGiftHistoryPage` 严格校验传输载荷后生成内部金额分字段；保留存储使用 `canonicalizeProcessedGiftHistoryPage` 校验内部页的分页、游标及金额，再核对快照防护校验（fence）并事务写入。内部页不重复经过载荷白名单，网络响应亦不得携带内部金额分字段。

客户端接收限制：pull/history 单次响应 ≤ 512 KiB、每页 `events` ≤ 200；history page token ≤ 4096 字符，`syncEpoch` ≤ 128 字符。历史页还要求 `historyBootstrapVersion=1`、非负安全整数 `recoveryCursor`，`hasMore=true` 时必须提供 `nextPageToken`、结束时必须为 `null`。增量页只允许 `final`，`cursor` 严格递增且末条等于 `nextCursor`；版本页附 `historyBootstrapVersion` / `syncEpoch` / `earliestCursor` / `latestCursor`。完整页字段集合见 `HISTORY_PAGE_KEYS` / `EVENT_PAGE_KEYS`，任一异常均整页拒绝。

具备历史同步能力的服务按 §9 执行初始化与来源分区恢复；无历史能力的旧服务仅在无持久游标时建立基线，已有游标时增量补齐离线 `final` 并显式标为 `LEGACY_PARTIAL`。SSE 断线、进程崩溃或漏包后通过 `final` 游标拉取恢复（`progress` 不补拉）；幂等身份包含 `source` 与远端事件 ID，重复 `final` 不重复触发统计、加班或 `gift:frame`。

本地 B 站连接仅提取发送者身份提示（见 [protocol.md](protocol.md) §6.4）。若 B 站上游断线发生在服务器收到事件之前，无法提供历史重放；当前单进程内存 broker 仅支持单实例部署，多实例扩展需另行设计。

## 7. 醒目留言服务(superchat-service)

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 置顶阈值 | `SUPER_CHAT_PIN_THRESHOLD = 2` RMB（协议层 `isPinned`，见 [protocol.md](protocol.md) §6.2） | [superchat-service.js](../../../../src/bilibili/superchat-service.js) |
| 入库阈值 | `SUPER_CHAT_DISPLAY_THRESHOLD = 2` RMB，`price < 2` 直接拒绝 | [superchat-service.js](../../../../src/bilibili/superchat-service.js) 的 `addSuperChatItem` |
| 入库去重 | `platform_id` 属于当前显示项时返回既有行。已在 `super_chat_receipts` 时返回 `null`。旧版本机弹幕源的公开消息另按房间内的平台 ID 去重 | [superchat-service.js](../../../../src/bilibili/superchat-service.js)、[实时弹幕流](danmaku.md#41-实时弹幕流) |
| 状态机 | `active`（插入默认）→ `assist` → `assisted`；`unassist` → `active`；`delete` 物理删除内容，仅保留平台 ID | [superchat-service.js](../../../../src/bilibili/superchat-service.js) |
| 平台下线 | `retractSuperChatItems` 按 `platform_id` 批量删除内容并保留最小 ID；尚未收到原消息的撤回 ID 也阻止迟到包入库 | [superchat-service.js](../../../../src/bilibili/superchat-service.js)、[superchat-store.js](../../../../src/storage/superchat-store.js) |
| 快照 | `WHERE status IN ('active','assisted') ORDER BY price DESC, datetime(created_at) ASC, id ASC` | [superchat-store.js](../../../../src/storage/superchat-store.js) 的 `listActive` |

表结构见 [storage.md](../storage.md) §3.2（`super-chat-data.db`），快照 `superChats` 字段见 [ws.md](../ws.md) §2，入账触发 `bilibili:superchat` 广播（见 [danmaku.md](danmaku.md) §1）。

补充约束：无平台 ID 的已删留言不留防重记录；已移除的同平台 ID 新增消息及迟到的 `assist` / `unassist` 均不会复活留言；平台下线回调仅在实际删除显示项时广播快照（消息识别与 ID 优先级见 [protocol.md](protocol.md) §6.2）。

SC 桥接入口对已有删除/撤回 receipt 的平台 ID 返回 `false`；[message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js) 收到该拒绝后停止后续命令分发且不占用命令去重键，避免撤回先到的迟到原包触发点歌或置顶。普通重复显示项仍按既有命令去重处理，平台撤回不撤销此前已接纳的点歌。

**行内删除 10 秒批次撤销（`superchat-undo.js`）：** 服务端捕获被删原记录，连续行内删除自动合并并重置 10 秒有效期，恢复时保留原 ID、顺序与「已处理」状态。平台撤回涉及当前批次、执行清空、身份/房间切换、保留清理或停机均使批次失效；批量清空仍需确认且不可撤销（接口与错误码见 [api.md §9](../api.md#9-醒目留言域superchats)）。

## 8. 参数归属

消费者重试见 §2，冲刺与列表上限见 §5，SC 阈值见 §7；HTTP 查询参数默认值与上限统一见 [api.md §10](../api.md#10-礼物域gifts)。

## 9. 完整礼物投影与恢复

完整投影按当前认证账号解析本地 `source`，先通过独立历史导入器拉取 `final + active + paid` 历史，再从快照恢复游标增量追平；历史导入不触发实时消费者或动效。服务端不支持历史同步能力时，客户端仍可接收实时 `final`，但状态固定为 `LEGACY_PARTIAL`。

服务端具备完整能力时：当控制器处于 `LIVE`、初始化已完成、SSE 纪元（epoch）已验证且游标连续，收到的 `final` 事件直接通过 `gift-sync-store.commitCatchUpPage` 与游标同事务提交，提交后再分发消费者（已提交的重复游标直接忽略，写入失败则不推进游标并转入补拉）。启动、重连、游标缺口及每 10 秒兜底巡检仍走 HTTP 游标拉取，实时提交不推迟巡检周期也不刷新 HTTP 验证时间。所有远程同步任务均受 `source / auth / controller / projection` 四字段防护校验（fence）保护；本地明细、搜索与统计只读取主进程选定的活动来源，渲染进程不得传入 `sourceId`。完整架构决策与规划见 [ADR-0011](../../../architecture/adr/0011-source-partitioned-gift-ledger-projection.md)、[ADR-0021](../../../architecture/adr/0021-atomic-live-gift-progress.md) 与 [完整投影规格](../../../../specs/gift-ledger-projection-sync_design.md)，后续增强项见 [未结项台账](../../../../specs/plans/open-items.md) B2/B3。
