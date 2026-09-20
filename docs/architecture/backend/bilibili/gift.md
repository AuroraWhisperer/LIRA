# 礼物服务器投影与醒目留言服务

2026-09-13：main process 在远程 pull/history/SSE 协商 `X-Lira-Gift-Identity: 1`，验证成对可空 `giftVariantId`、`blindBoxVariantId`；旧 DTO 规范化为 null。首次导入写入事件身份列，后续不能把非空身份改成另一身份。旧历史只核对既有展示投影后幂等跳过，不补填身份或重放消费者。加班消费者仅匹配规则的完整身份；目录刷新不修改已结算记录。详见[礼物身份规格](../../../../specs/gift-identity-overtime.md)。

> 涉及文件:[gift/projection-service.js](../../../../src/bilibili/gift/projection-service.js)、[gift/consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js)、[gift/statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js)、[gift/normalizer.js](../../../../src/bilibili/gift/normalizer.js)、[gift/query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift/blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js)、[gift/blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js)、[gift/index.js](../../../../src/bilibili/gift/index.js)、[superchat-service.js](../../../../src/bilibili/superchat-service.js)、[domain-services.js](../../../../src/server/domain-services.js) 的 gifts/superChats 段

本文档是 **礼物服务器投影与醒目留言服务** 的客户端事实源:本地账本、消费者扇出、盲盒与冲刺统计、SC 状态机只在此成表。原始 B 站礼物解析与权威检测已迁移到 `D:/Work/lira-server`;本地只接收经服务器处理的 DTO 并投影到现有消费者。本地发送者身份读取见 [protocol.md](protocol.md) §6;`gift_events`/`super_chats` 表结构见 [storage.md](../storage.md) §3.3/§3.2;快照 `gifts/giftSprint/giftDetection/superChats` 字段见 [ws.md](../ws.md) §2;礼物与 SC 的 `/api/*` 端点清单见 [api.md](../api.md)。客户端投影与服务器协议详见 [server-authoritative-gift-detection_design.md](../../../../specs/server-authoritative-gift-detection_design.md)。

**目录内模块边界:** `gift/sale-catalog.js` 拥有缓存、刷新与服务门面，`gift/sale-catalog-parser.js` 只做目录响应的纯解析/归一化；`users/user-info-service.js` 拥有网络、缓存与失败策略，`users/user-info-evidence.js` 只做用户证据和风险字段归一化。解析模块不得持有服务生命周期或重复缓存。

远端目录的 `remote-catalog-cache.js` 独占刷新合并、ETag、停止代次及持久化后发布；`remote-catalog-contract.js` 校验响应封装、v2 礼物/盲盒关系并复用 v3 variant 契约；`remote-catalog-image-policy.js` 校验 B 站原图与配置服务器同源的不可变图片地址。缓存入口保留原具名导出以兼容既有消费者。

Schema 3 按服务器协议接收完整历史活动目录，不额外设置 10,000 条活动身份的拒绝门槛；仍逐项核对字段、身份摘要、总数、业务版本和奖池引用，合法全包才持久化后发布。超过该数量的合法目录须完整刷新、重启可读；非法大目录保留旧快照，不能截断活动或删除未被当前奖池引用的历史身份。验证：`test/gift-identity-catalog.test.js`。

## 1. 架构总览

```
Electron remote gift controller (服务器 SSE / cursor / history)
  │ importProcessedEvent / importProcessedHistoryRecord
  ▼
createGiftService (gift/index.js)                    ← domainServices.gifts
  ├─ GiftProjectionService     仅投影服务器 progress/final
  │    ├─ gift_events 共享账本 (storage.md §3.3)
  │    └─ ConsumerRegistry.dispatch(toStandardEvent) 扇出标准事件
  │         ├─ giftStatistics (statistics-consumer.js)  礼物冲刺统计
  │         └─ overtime     (overtime-consumer, 见 overtime.md)
  └─ query-service: getSnapshot/getHistory/getSprintSnapshot/盲盒统计
```

礼物边框事件由 `src/bilibili/gift/frame-config.js` 作为 final 行之后的具名 Frame Adapter 负责：
`giftFrameEnabled` 为 `true` 时才读取 final 行权威 `total_price`，按人民币元转换为整数分并与
`giftFrameThresholdRmb` 比较，合格事件使用稳定的 `gift-frame:<giftEventId>` ID 广播为
`gift:frame`。Adapter 不使用 `unit_price * num` 重算，也不读取官方媒体映射；关闭开关、非 final、
零金额或低于阈值的行不广播。管理页预览通过 `/api/gifts/frame/preview` 使用独立的预览 ID，
不污染实时去重集合。

装配点：`domainServices` 创建 `createGiftService`，注入 final 回调、加班消费者及 `getOvertimeEpoch`；`index.js` 注册礼物统计消费者并创建 `createGiftProjectionService`。原始检测、金额换算、连击定时器、盲盒匹配及旧记录修复实现已删除，没有本地检测模式或回退入口。本地 B 站连接通过独立的 `extractBilibiliGiftIdentity` 读取姓名、头像及舰队身份，不生成礼物记账事件。服务器事件经 `importProcessedGiftEvent` 进入投影器（见 §6.1）。

## 2. 服务器结果投影（GiftProjectionService）

### 2.1 实时事件导入

`importProcessedEvent` 验证服务器 DTO 与本地授权 source，以 `source_id + lira-server:<eventId>` 查找已有投影。首次接收时冻结统计资格与加班 epoch；后续 `progress` 更新直接使用服务器字段，`final` 只完成一次落库和消费者分发。最终记录重复导入时校验内容一致，不重复触发统计、加班或边框。金额、数量、盲盒成本和盈亏均直接来自服务器，不进行本地推算。

服务器事件在消费者关闭时仍会落库，使远端 cursor 能继续推进。UID 与原始包不会进入这条导入路径。实现见 [projection-service.js](../../../../src/bilibili/gift/projection-service.js)，传输与事务协议见 §6.1。

### 2.2 progress → final 与本地生命周期

客户端只在收到服务器 `final` 时收尾，没有静默窗口、主动 flush 或 raw detect 入口。创建、恢复、暂停、恢复写入和销毁都不会把已有 `progress` 自行改为 `final`。暂停/销毁取消的定时器仅用于消费者失败重试；暂停代次同时阻止旧事务的延迟回调在清库之后继续投递。

`recover()` 仅重投服务器来源的已确认 final 中尚未完成统计交付的行。`getStatus()` 保留现有快照字段，pendingCount 只统计服务器 progress。既有数据库列名和历史数据保留；旧本地原始礼物不再解析、合并、修复或消费。

### 2.3 消费者扇出与补偿重投

[consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js) 逐一分发冻结的 `{phase, giftEventId, gift, eligibility}`，单个消费者失败不阻断其他消费者。

| 消费者         | 行为                                                                                             | 出处                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| giftStatistics | final 且有统计资格时，在事务内更新 counted_in_sprint 和 gift_stats_delivered，重复消费不重复计入 | [statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js) |
| overtime       | 按冻结的 overtime_epoch 与完整礼物身份结算秒数                                                   | [overtime.md](../overtime.md)                                                  |

final 分发失败后按 `min(30s, 1000 * 2^attempt)` 退避重投；指数上限为 5，重试次数不限制为 5 次，成功或事件不再存在时停止。消费者各自保证业务结果幂等。需要与远端 cursor 原子提交时，final 分发注册为提交后回调，回滚不触发消费者。

## 3. 历史导入与存储边界

`projection-service.js` 接收窄 `store`，保留输入校验、progress/final 决策和重试生命周期。SQL 与表字段操作归 `storage/gift-projection-store.js`；`statistics-consumer.js` 委托 `storage/gift-statistics-store.js:deliverOnce` 在单个 `BEGIN IMMEDIATE` 事务内检查 final/资格/投递标记并更新统计标记。组合入口注入两个 store，原 gift 门面为旧 context 调用者提供适配。投影调用仍可加入 gift-sync-store 的现有事务，消费者仍只在提交后扇出，不新增 schema 或改变 cursor 原子性。

`importProcessedHistoryRecord` 独立导入服务器历史 final，校验 source 和重复记录一致性，并把历史行标为不参与统计/加班。历史导入不派发消费者或边框事件。`normalizeGiftRow` 仅整理数据库输出类型；原始礼物输入归一化、近期命令查重、连击合并及 `repairGiftV2Events` 均已删除。数据库 schema 和已有历史记录不因删除代码而被清空。

## 4. 盲盒：服务器结果与客户端展示

目录使用唯一 `giftCategory` 区分 `directGift`（直送礼物）、`blindBox`（盲盒）和 `blindBoxOutput`（盲盒产物），替换原目录 `isBlindBox`；奖池关系按完整活动身份关联。服务器按 REQ-GIFT-006 校验有效关系/活动身份后，可为上游漏标的产物补全事件 `isBlindBox`、来源 `blindBoxId`、名称、成本和盈亏。客户端导入这些权威字段，不根据目录自行改变账本。`public/js/admin/gifts/recent.js` 根据事件标记与冻结来源身份取对应盲盒图片；无身份的旧记录仅允许 ID、名称唯一匹配，资料不足或歧义时用占位图，特殊配色还须名称匹配；有限数字盈亏直接显示符号和盈利/亏损颜色，不依赖可空盒名，未知值显示“盈亏待确认”。心动盲盒单盒 15 元、棉花糖 9 元对应 -6 元，爱心抱枕 16 元对应 +1 元。共享奖品来源仍有歧义时成本/盈亏保留未知，旧记录不自动重算。当前远端流程见 §9。

目录显示与收礼判定分开：`public/js/shared/gift-catalog-roles.js` 直接将已校验的 `giftCategory` 显示为“直送礼物 / 盲盒 / 盲盒产物”，奖池关系只提供来源名称。main 校验三值枚举及关系一致性，并通过原有 API/WS 和原子缓存传递；类别参与目录业务摘要，不新增网络请求或数据库列。官方盲盒筛选使用 `giftCategory=blindBox` 且必须有核验奖池。生产两端同步升级、客户端重新安装，不增加旧类别回退。共享产物列出全部奖池；身份不符时不显示推测标签，旧请求不得恢复更新后已移除的奖池关系。

客户端直接保存服务器的盲盒 ID、名称、成本和盈亏，不按礼物名匹配盒子或重新计算价值。[blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js) 仅验证待同步的盲盒设置格式，实际收礼判定由服务器处理。

盲盒统计/分析查询只读「final + `gift_stats_eligible` + `is_blind_box=1` + `blind_profit` 非空」的**当日**行(北京时间零点切分,[blind-box-analysis.js:148-172](../../../../src/bilibili/gift/blind-box-analysis.js#L148-L172)),视图 `users/boxes/records` 与排序/分页定义见 [blind-box-analysis.js:10-15](../../../../src/bilibili/gift/blind-box-analysis.js#L10-L15)。

## 5. 礼物冲刺与查询

### 流水筛选、选择快照与展示资料（2026-09-18）

`history-filters.js` 拥有北京时间日期边界、独立用户/礼物名称过滤与来源版本。`getGiftHistory` 在完整有效流水上先筛选再分页，支持 today 和起止日期；游标绑定筛选、排序、asOf 与 viewRevision。viewRevision 包含 source、持久化 projection generation 及进程内来源切换代次。排序保留勾选，筛选、清库/重建、换来源使选择失效。

`getGiftSelection` 用同一存储读事务冻结最多 10000 条当前来源记录，不合并同用户同礼物；显式 eventIds 必须全部仍在当前筛选中。一次请求可选择全部筛选结果，partial 仍明确标示仅已同步记录。导出 runtime 冻结选择、展示设置和本地素材目录，后续新礼物不进入已有任务。

`X-Lira-Gift-Display: 1` 与活动身份协商独立，用于远端 history/pull/SSE 的可选 `gift.display` 版本 1。严格 DTO 校验只接受 HTTPS hdslb 头像及 0–3/null 等级，旧服务器缺字段继续兼容。v11 迁移添加可空 avatar_url/guard_level；未知旧数据不按昵称补齐，不改变原金额与统计。历史重放不调用业务消费者。横幅按单价整数分乘数量分色，设置持久化为本地 `giftDisplayConfig`，不进入云端 scope。

2026-09-20 头像恢复：`server/gift-card-runtime.js` 每次读取今日卡片资料时，先复用同一来源、同一日、同 UID 的已知头像；仍缺失的头像经注入的 `bilibiliRuntime.getUserAvatar` 调用 `UserInfoService.ensure` 向 B 站补查。最多四个并发查询，卡片读取最多等四秒；慢请求在用户资料缓存中完成，后续刷新复用结果。失败与空资料遵循用户服务的 30 秒负缓存，空记录不清除已知头像；迟到结果不能跨日期、来源或 runtime reset 发布。补查只生成展示投影，不改礼物账本、冻结事件、金额、等级或历史 DTO；未知 UID 和跨日历史不按昵称推测。滚动区每次刷新重试已失败的头像图片，已成功图片保持复用；PNG 图片准备为头像等待九秒，覆盖现有头像代理的八秒超时。

| 事实       | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 出处                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 开关/目标  | `enableGiftSprint`(默认 `'true'`)、`giftSprintTargetRmb`(默认 `'0'`,见 [storage.md](../storage.md) §7)                                                                                                                                                                                                                                                                                                                                                            | [settings-store.js:19-21](../../../../src/storage/settings-store.js#L19-L21)                                                     |
| 礼物边框   | `giftFrameEnabled`(默认 `'false'`)、`giftFrameThresholdRmb`(默认 `'20'`)、`giftFrameTheme='woodland-bloom'`、`giftFrameMotionMode='auto'`                                                                                                                                                                                                                                                                                                                         | [frame-config.js](../../../../src/bilibili/gift/frame-config.js)、[settings-store.js](../../../../src/storage/settings-store.js) |
| 水晶球价值 | `CRYSTAL_BALL_VALUE_RMB = 100`(RMB)                                                                                                                                                                                                                                                                                                                                                                                                                               | [query-service.js:6](../../../../src/bilibili/gift/query-service.js#L6)                                                          |
| 冲刺快照   | `receivedRmb = SUM(total_price)`(final + 资格 + `counted_in_sprint=1`);`remainingRmb = max(0, target - received)`;**`remainingCrystalBalls = ceil(remaining / 100)`**                                                                                                                                                                                                                                                                                             | [query-service.js:99-122](../../../../src/bilibili/gift/query-service.js#L99-L122)                                               |
| 列表快照   | `getGiftSnapshot` 最近 **30** 条(final + 资格 + 付费,[query-service.js](../../../../src/bilibili/gift/query-service.js));`getGiftHistory` 解析当前授权 source，分页 limit ≤ **100**，以 allowlist `sortField: created_at/gift_name/price/remarks` + `sortDirection: asc/desc` 做复合 keyset 排序并返回 `total/totalPages`([query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift-query-store.js](../../../../src/storage/gift-query-store.js)) | —                                                                                                                                |
| 重置       | `resetSprintProgress` 全表 `counted_in_sprint=0`                                                                                                                                                                                                                                                                                                                                                                                                                  | [query-service.js:8-19](../../../../src/bilibili/gift/query-service.js#L8-L19)                                                   |

`counted_in_sprint` 由 `giftStatistics` 消费者在 **final** 时落定(§2.3),因此冲刺统计天然只含已收尾事件。

## 6. 快照与端点

- WS 快照 `gifts`(礼物事件列表)/ `giftSprint`(冲刺状态,含 `crystalBallValueRmb`)/ `giftDetection`(`getStatus()` 的 `coreActive/pendingCount` 等)由本服务产出(见 [ws.md](../ws.md) §2);`superChats` 见 §7。
- 礼物/SC 的 `/api/*` 端点组(`gifts`、`superChat` 两组 context,见 [server.js:312-325](../../../../src/server.js#L312-L325))完整清单见 [api.md](../api.md),此处不复表。

## 6.1 服务器权威礼物与客户端投影

原始 B 站包的解析、平台身份去重、连击累计、盲盒价值覆盖和 10 秒静默收尾由 `D:/Work/lira-server` 的每主播 `RoomMonitor`/`gift-detector` 独占。该服务器把 final 行与 delivery cursor 在同一个 SQLite 事务中提交,再通过按 `streamerId` 分桶的内存 broker 加速在线设备投递;旧历史行保留但不会生成新的 delivery cursor。

Electron 只在 main process 使用授权 DeviceBearer 调用 `GET /api/device/gift-events` 和 `GET /api/device/gift-events/stream`。传输 DTO 仅允许 `eventId/cursor/phase/gift` 及礼物展示字段(`giftId/giftName/userName/num/unitPrice/totalPrice/coinType/isBlindBox/blindBoxId/blindBoxName/blindBoxPrice/blindProfit/createdAt`),不含 UID、roomId、streamerId、cmd、平台/连击 ID、raw JSON、Cookie、CSRF 或 token。`blindBoxId` 是规范化的正十进制字符串或 null，旧/未知来源保持 null。金额规范化为两位小数，要求为正的 `totalPrice` 在规范化后仍必须大于 0；`0.001` 不得作为 `0` 进入本地账本。每组最多一条 `progress` 和一条 `final`;progress 的 cursor 为 null,补拉只返回 final 且单页最多 200 条。

具备历史能力的服务按 §9 执行 bootstrap 与来源分区恢复；无历史能力的旧服务只保存 baseline 并显式处于 `LEGACY_PARTIAL`。历史页及 final cursor 和本地礼物投影在同一事务提交。SSE 断线、进程崩溃或漏包后以 final cursor pull 恢复，progress 不补拉；当前幂等身份包含 source 与远端事件身份，重复 final 不重复统计、加班结算或 `gift:frame`。

本地 B 站连接仍负责弹幕、点歌、SC、用户信息和小游戏；礼物只保留身份提示解析，记账回调已移除。B 站上游 WebSocket/REST 断线发生在服务器收到事件之前时没有历史重放或零丢失保证。单进程 broker 不承诺多实例 fan-out,多实例部署需另行设计。

## 7. 醒目留言服务(superchat-service)

| 事实     | 值                                                                                            | 出处                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 置顶阈值 | `SUPER_CHAT_PIN_THRESHOLD = 2` RMB(协议层 `isPinned`,见 [protocol.md](protocol.md) §6.2)      | [superchat-service.js:14](../../../../src/bilibili/superchat-service.js#L14)                                                                                      |
| 入库阈值 | `SUPER_CHAT_DISPLAY_THRESHOLD = 2` RMB,`price < 2` 直接拒绝                                   | [superchat-service.js:15](../../../../src/bilibili/superchat-service.js#L15)、[superchat-service.js:18-21](../../../../src/bilibili/superchat-service.js#L18-L21) |
| 去重     | `platform_id` 已存在:返回既有行;既有行 `status='deleted'` 则返回 null(不入账)                 | [superchat-service.js:24-32](../../../../src/bilibili/superchat-service.js#L24-L32)                                                                               |
| 状态机   | `active`(插入默认)→ `assist`→`assisted`;`unassist`→`active`;`delete`→`deleted`                | [superchat-service.js:57-77](../../../../src/bilibili/superchat-service.js#L57-L77)                                                                               |
| 快照     | `WHERE status IN ('active','assisted') ORDER BY price DESC, datetime(created_at) ASC, id ASC` | [superchat-service.js:79-85](../../../../src/bilibili/superchat-service.js#L79-L85)                                                                               |

表结构与列见 [storage.md](../storage.md) §3.2(`super-chat-data.db`);快照 `superChats` 字段见 [ws.md](../ws.md) §2;入账触发 `bilibili:superchat` 广播(见 [danmaku.md](danmaku.md) §1)。

## 8. 关键常数速查

| 参数                  | 值                                 | 出处                                                                                                                                                 |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消费者重试退避        | 1s×2^attempt，上限 30s，成功后停止 | [projection-service.js](../../../../src/bilibili/gift/projection-service.js)                                                                         |
| 水晶球价值            | 100 RMB                            | [query-service.js:6](../../../../src/bilibili/gift/query-service.js#L6)                                                                              |
| 剩余水晶球            | ceil                               | [query-service.js:119](../../../../src/bilibili/gift/query-service.js#L119)                                                                          |
| 列表快照 / 历史 limit | 30 / ≤100                          | [query-service.js:27](../../../../src/bilibili/gift/query-service.js#L27)、[query-service.js:34](../../../../src/bilibili/gift/query-service.js#L34) |
| SC 置顶/入库阈值      | 2 RMB                              | [superchat-service.js:14-15](../../../../src/bilibili/superchat-service.js#L14-L15)                                                                  |

## 9. 完整礼物投影过渡（Accepted，实施中）

现有 §6.1 的 fresh-client latest baseline 仍是旧服务器兼容语义。ADR [0011](../../adr/0011-source-partitioned-gift-ledger-projection.md) 和 [完整投影规格](../../../specs/gift-ledger-projection-sync_design.md) 接受的新能力模式会按认证账号解析本地 source，先通过独立 history-only importer 构建服务器 `final + active + paid` 历史，再从 snapshot recovery cursor 增量补齐。历史行明确不进入 detector/consumer，不触发冲刺、加班、快照或 `gift:frame`。

capability 缺失时继续接收兼容 live final，但状态固定为 `LEGACY_PARTIAL`。capability 存在时，控制器处于干净 `LIVE`、bootstrap 已完成、SSE epoch 已验证且 cursor 连续时，`final` 事件会先通过幂等 live importer 即时投影；控制器仍标记 dirty 并执行 epoch-aware cursor pull，后者是恢复与连续性真相源。初始化、已有恢复、乱序、断线或 epoch 未验证时只走 pull/rebuild；所有远程任务使用 source/auth/controller/projection 四字段 fence。礼物明细、搜索和统计只读 Electron main 选定的 active source，renderer 不能提交 `sourceId`。
