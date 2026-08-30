# 礼物检测管道与醒目留言服务

> 涉及文件:[gift/detection-service.js](../../../../src/bilibili/gift/detection-service.js)、[gift/event-service.js](../../../../src/bilibili/gift/event-service.js)、[gift/consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js)、[gift/statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js)、[gift/normalizer.js](../../../../src/bilibili/gift/normalizer.js)、[gift/query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift/blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js)、[gift/blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js)、[gift/index.js](../../../../src/bilibili/gift/index.js)、[gift-event-store.js](../../../../src/storage/gift-event-store.js)、[superchat-service.js](../../../../src/bilibili/superchat-service.js)、[domain-services.js](../../../../src/server/domain-services.js) 的 gifts/superChats 段

本文档是 **礼物检测管道与醒目留言服务**的唯一事实源:检测生命周期、消费者扇出、盲盒与冲刺统计、SC 状态机只在此成表。协议层解析(5 条礼物路径)见 [protocol.md](protocol.md) §6;`gift_events`/`super_chats` 表结构见 [storage.md](../storage.md) §3.3/§3.2;快照 `gifts/giftSprint/giftDetection/superChats` 字段见 [ws.md](../ws.md) §2;礼物与 SC 的 `/api/*` 端点清单见 [api.md](../api.md)。架构决策见 ADR [0006-shared-gift-detection-core](../../adr/0006-shared-gift-detection-core.md)。

**目录内模块边界:** `gift/sale-catalog.js` 拥有缓存、刷新与服务门面，`gift/sale-catalog-parser.js` 只做目录响应的纯解析/归一化；`users/user-info-service.js` 拥有网络、缓存与失败策略，`users/user-info-evidence.js` 只做用户证据和风险字段归一化。解析模块不得持有服务生命周期或重复缓存。

## 1. 架构总览

```
MessageHandlers.handleGift (协议解析, 见 protocol.md §6.4-6.7)
  │ onGift (server.js)
  ▼
createGiftService (gift/index.js)                    ← domainServices.gifts
  ├─ GiftDetectionService (detection-service.js)     检测核心: progress→final 生命周期
  │    ├─ gift_events 共享账本 (storage.md §3.3)
  │    └─ ConsumerRegistry.dispatch(toStandardEvent) 扇出标准事件
  │         ├─ giftStatistics (statistics-consumer.js)  礼物冲刺统计
  │         └─ overtime     (overtime-consumer, 见 overtime.md)
  ├─ query-service: getSnapshot/getHistory/getSprintSnapshot/盲盒统计
  └─ event-service: repairGiftV2Events / 盲盒元数据 / 平台身份去重
```

礼物边框事件由 `src/bilibili/gift/frame-config.js` 作为 final 行之后的具名 Frame Adapter 负责：
`giftFrameEnabled` 为 `true` 时才读取 final 行权威 `total_price`，按人民币元转换为整数分并与
`giftFrameThresholdRmb` 比较，合格事件使用稳定的 `gift-frame:<giftEventId>` ID 广播为
`gift:frame`。Adapter 不使用 `unit_price * num` 重算，也不读取官方媒体映射；关闭开关、非 final、
零金额或低于阈值的行不广播。管理页预览通过 `/api/gifts/frame/preview` 使用独立的预览 ID，
不污染实时去重集合。

装配点:`domainServices` 创建 `createGiftService(baseContext, {onGiftFlushed, consumers:[overtimeConsumer], getOvertimeEpoch})`([domain-services.js:89-95](../../../../src/server/domain-services.js#L89-L95));`index.js` 把 `createGiftStatisticsConsumer` 与注入的加班机消费者一起注册([index.js:29-53](../../../../src/bilibili/gift/index.js#L29-L53))。原始礼物**只从 `onGift` 一处进入**,即 `detectionService.detect`(暴露为 `gifts.add`,[index.js:43](../../../../src/bilibili/gift/index.js#L43))。

## 2. 检测核心(GiftDetectionService)

### 2.1 detect 主流程

`detect(input)`([detection-service.js:38-96](../../../../src/bilibili/gift/detection-service.js#L38-L96)):

1. **消费者启用门控**:`giftStatisticsEligible = enableGiftSprint === 'true'` 且 `overtimeEpoch = getOvertimeEpoch()`;两者都无效时记录 `all-consumers-disabled` 直接忽略([detection-service.js:41-46](../../../../src/bilibili/gift/detection-service.js#L41-L46))。
2. `normalizeGiftInput` 归一化(见 [normalizer.js:35-68](../../../../src/bilibili/gift/normalizer.js#L35-L68));无 `giftName/giftId` → `invalid-gift` 忽略;`totalPrice <= 0`(免费礼物)→ `non-positive-price` 忽略([detection-service.js:49-57](../../../../src/bilibili/gift/detection-service.js#L49-L57))。
3. **连击归并**:`comboKey = extractComboRootKey(comboId || platformId)` 命中时以 comboKey 替换 `platformId`;`applyComboTotals` 取 `num/comboNum` 与 `totalPrice/comboTotalPrice` 的较大值并重算 `unitPrice`([detection-service.js:59-61](../../../../src/bilibili/gift/detection-service.js#L59-L61)、[detection-service.js:255-259](../../../../src/bilibili/gift/detection-service.js#L255-L259))。盲盒元数据覆盖见 §4。
4. **去重**:按 `(platform_id, uid)`(或 uid 缺失时 `(platform_id, user_name)`)[findGiftByPlatformIdentity](../../../../src/bilibili/gift/event-service.js#L151-L164);未命中再查 `findRecentGiftCommandDuplicate`:先把 SEND_GIFT/BLIND_GIFT 与 COMBO_SEND 跨命令在 **±5s** 内同 uid/gift/num/价格的消息视为同组;若消息没有显式 combo/batch 标识,再通过存储端口 [gift-event-store.js](../../../../src/storage/gift-event-store.js) 按相同窗口合并同 CMD、同 uid/gift/num/价格但不同平台消息 ID 的通知。后一分支恢复旧版检测语义,可能把同一用户 5 秒内真实连续发送的两笔完全相同礼物合并。`status='deleted'` 忽略、`detection_status='final'` 幂等返回([detection-service.js](../../../../src/bilibili/gift/detection-service.js))。
5. **进展合并**:已存在行走 `updateGiftEventIfProgressed`(Math.max 归并 num/total_price,`updateSprint:false` 不触碰 counted_in_sprint,[event-service.js:104-141](../../../../src/bilibili/gift/event-service.js#L104-L141)),并刷新 `last_platform_at_ms`([detection-service.js:72-80](../../../../src/bilibili/gift/detection-service.js#L72-L80));新事件 `insertProgressGift` 以 `detection_status='progress'` 落库,冻结 `first_detected_at_ms`、`gift_stats_eligible` 与 `overtime_epoch`([detection-service.js:230-253](../../../../src/bilibili/gift/detection-service.js#L230-L253))。
6. **收尾**:先 `dispatch(row,'progress')`;`isPlatformFinal`(`COMBO_SEND` 命令或非 combo-key → 立即)走 `finalizeDetected`,否则 `scheduleFinalization`([detection-service.js:90-95](../../../../src/bilibili/gift/detection-service.js#L90-L95)、[detection-service.js:261-263](../../../../src/bilibili/gift/detection-service.js#L261-L263))。

### 2.2 progress → final 生命周期

| 事实         | 值                                                                                                                                                                                                            | 出处                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静默收尾窗口 | `GIFT_FINALIZE_QUIET_MS = 10s`(自 `last_platform_at_ms` 起算,定时器 `unref`)                                                                                                                                  | [detection-service.js:14](../../../../src/bilibili/gift/detection-service.js#L14)、[detection-service.js:116-127](../../../../src/bilibili/gift/detection-service.js#L116-L127) |
| 收尾         | `UPDATE … SET detection_status='final', finalized_at_ms=?`(仅限 `progress` 行)→ `dispatch('final')` + `onGiftFinalized`(即 server 的 `onGiftFlushed`,触发 `bilibili:gift` 快照广播,见 [ws.md](../ws.md) §3.1) | [detection-service.js:98-114](../../../../src/bilibili/gift/detection-service.js#L98-L114)                                                                                      |
| 兜底 flush   | `flushPending({force})` 强制收尾全部 `progress` 行(dispose 时 `force:true`)                                                                                                                                   | [detection-service.js:129-143](../../../../src/bilibili/gift/detection-service.js#L129-L143)                                                                                    |
| 启动恢复     | `recover()` = flush 待决 + 重放「final 且 `gift_stats_eligible=1` 且 `gift_stats_delivered=0`」事件给消费者                                                                                                   | [detection-service.js:145-155](../../../../src/bilibili/gift/detection-service.js#L145-L155)                                                                                    |
| 状态快照     | `getStatus()` → `{coreActive, consumers:{giftStatistics, overtime}, pendingCount}`;**`coreActive = giftStatistics \|\| overtime \|\| pendingCount > 0`**                                                      | [detection-service.js:157-168](../../../../src/bilibili/gift/detection-service.js#L157-L168)                                                                                    |

检测列(`detection_status/first_detected_at_ms/last_platform_at_ms/finalized_at_ms/gift_stats_eligible/gift_stats_delivered/overtime_epoch`)由 giftDb 迁移 v4 升级(见 [storage.md](../storage.md) §4),消费语义见 ADR 0006:资格在**首个平台包**冻结,事件只从 `finalizeDetected()` 单一出口收尾。

### 2.3 消费者扇出与补偿重投

`consumerRegistry.dispatch(event)` 遍历消费者逐一 `handle`,失败进 `failed` 列表且**不阻断其他消费者**([consumer-registry.js:11-23](../../../../src/bilibili/gift/consumer-registry.js#L11-L23));标准事件 `toStandardEvent` 冻结为 `{phase, giftEventId, gift, eligibility}`([detection-service.js:265-276](../../../../src/bilibili/gift/detection-service.js#L265-L276))。

| 消费者   | name             | 行为                                                                                                                                 | 出处                                                                                       |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 礼物统计 | `giftStatistics` | 仅 `final` 且 `giftStatistics` 资格;`BEGIN IMMEDIATE` 内写 `counted_in_sprint = total_price>0?1:0` 与 `gift_stats_delivered=1`(幂等) | [statistics-consumer.js:8-36](../../../../src/bilibili/gift/statistics-consumer.js#L8-L36) |
| 加班机   | `overtime`       | 按 `overtime_epoch` 结算秒数,见 [overtime.md](../overtime.md)                                                                        | [overtime-consumer.js:9-12](../../../../src/overtime/overtime-consumer.js#L9-L12)          |

**补偿重投**(final 事件首投失败时):指数退避 `delay = min(30s, 1000 * 2^attempt)`,最多 5 次尝试([detection-service.js:15](../../../../src/bilibili/gift/detection-service.js#L15)、[detection-service.js:201-217](../../../../src/bilibili/gift/detection-service.js#L201-L217));重试前校验行仍为 `final` 且未投递;`recover()` 覆盖进程重启后的补投。这是 **at-least-once 投递 + 幂等业务结果**(ADR 0006 §决策)。

## 3. event-service:持久化与修复

- `repairGiftV2Events(context)`([event-service.js:39-102](../../../../src/bilibili/gift/event-service.js#L39-L102)):启动修复链的一环(见 [server-core.md](../server-core.md) §5)。扫描 `status='active'`、`cmd LIKE 'SEND_GIFT_V2%'`、`raw_json != ''` 且价格为零、平台身份为空或仍是旧版非 combo/batch 身份的历史行(**LIMIT 200**),从 `raw_json` 重新解析并先应用累计 combo 数量/金额;若与现存平台身份重复则合并并删行,否则更新规范化字段([event-service.js:45-104](../../../../src/bilibili/gift/event-service.js#L45-L104),事务包住)。
- `extractComboRootKey(platformId)`([event-service.js:16-21](../../../../src/bilibili/gift/event-service.js#L16-L21)):platformId 含 `combo`/`batch`(小写)即返回原值作为连击根 key(不再剥离尾部时间戳 —— 连击聚合已改为 §2.1 的 progress 合并 + 10s 静默收尾,旧文档的 `giftComboPending` 10s TTL 内存缓冲已移除)。
- 平台身份、跨命令与无 combo/batch 标识的同命令近期查重见 §2.1。

## 4. 盲盒:协议标记 → 配置重命名 → 价值覆盖

协议层只做**标记**(见 [protocol.md](protocol.md) §6.5);进入检测管道后 `applyBlindBoxMetadata(context, gift)`([event-service.js:23-37](../../../../src/bilibili/gift/event-service.js#L23-L37)):

1. `matchBlindBox(context, blindBoxName) || matchBlindBox(context, giftName)`([blind-box-config.js:47-51](../../../../src/bilibili/gift/blind-box-config.js#L47-L51)):配置 `giftBlindBoxConfig` 形如 `[{name, price, outputs:[{name, price} 或 "字符串" ]}]`,outputs 按礼物名建 Map `{blindBoxName, boxPrice, giftPrice}`;按 `settings` 原始串缓存于 `state.blindBoxCache`([blind-box-config.js:5-45](../../../../src/bilibili/gift/blind-box-config.js#L5-L45))。
2. 命中后:标记 `isBlindBox`、重命名为配置盒名;`blindBoxPrice` 为空则补 `boxPrice * num`;`giftPrice > 0` 时用 `giftPrice * num` 覆盖 `totalPrice`;**`blindProfit = totalPrice - blindBoxPrice`**([event-service.js:24-36](../../../../src/bilibili/gift/event-service.js#L24-L36))。

盲盒统计/分析查询只读「final + `gift_stats_eligible` + `is_blind_box=1` + `blind_profit` 非空」的**当日**行(北京时间零点切分,[blind-box-analysis.js:148-172](../../../../src/bilibili/gift/blind-box-analysis.js#L148-L172)),视图 `users/boxes/records` 与排序/分页定义见 [blind-box-analysis.js:10-15](../../../../src/bilibili/gift/blind-box-analysis.js#L10-L15)。

## 5. 礼物冲刺与查询

| 事实       | 值                                                                                                                                                                                                                                                                                                             | 出处                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 开关/目标  | `enableGiftSprint`(默认 `'true'`)、`giftSprintTargetRmb`(默认 `'0'`,见 [storage.md](../storage.md) §7)                                                                                                                                                                                                         | [settings-store.js:19-21](../../../../src/storage/settings-store.js#L19-L21)                                                     |
| 礼物边框   | `giftFrameEnabled`(默认 `'false'`)、`giftFrameThresholdRmb`(默认 `'20'`)、`giftFrameTheme='woodland-bloom'`、`giftFrameMotionMode='auto'`                                                                                                                                                                      | [frame-config.js](../../../../src/bilibili/gift/frame-config.js)、[settings-store.js](../../../../src/storage/settings-store.js) |
| 水晶球价值 | `CRYSTAL_BALL_VALUE_RMB = 100`(RMB)                                                                                                                                                                                                                                                                            | [query-service.js:6](../../../../src/bilibili/gift/query-service.js#L6)                                                          |
| 冲刺快照   | `receivedRmb = SUM(total_price)`(final + 资格 + `counted_in_sprint=1`);`remainingRmb = max(0, target - received)`;**`remainingCrystalBalls = ceil(remaining / 100)`**                                                                                                                                          | [query-service.js:99-122](../../../../src/bilibili/gift/query-service.js#L99-L122)                                               |
| 列表快照   | `getGiftSnapshot` 最近 **30** 条(final + 资格 + 付费,[query-service.js:21-30](../../../../src/bilibili/gift/query-service.js#L21-L30));`getGiftHistory` 分页 limit ≤ **100**(`sortField: gift_name/price/remarks/created_at`,[query-service.js:32-97](../../../../src/bilibili/gift/query-service.js#L32-L97)) | —                                                                                                                                |
| 重置       | `resetSprintProgress` 全表 `counted_in_sprint=0`                                                                                                                                                                                                                                                               | [query-service.js:8-19](../../../../src/bilibili/gift/query-service.js#L8-L19)                                                   |

`counted_in_sprint` 由 `giftStatistics` 消费者在 **final** 时落定(§2.3),因此冲刺统计天然只含已收尾事件。

## 6. 快照与端点

- WS 快照 `gifts`(礼物事件列表)/ `giftSprint`(冲刺状态,含 `crystalBallValueRmb`)/ `giftDetection`(`getStatus()` 的 `coreActive/pendingCount` 等)由本服务产出(见 [ws.md](../ws.md) §2);`superChats` 见 §7。
- 礼物/SC 的 `/api/*` 端点组(`gifts`、`superChat` 两组 context,见 [server.js:312-325](../../../../src/server.js#L312-L325))完整清单见 [api.md](../api.md),此处不复表。

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

| 参数                    | 值                              | 出处                                                                                                                                                                            |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静默收尾窗口            | 10s                             | [detection-service.js:14](../../../../src/bilibili/gift/detection-service.js#L14)                                                                                               |
| 消费者重试退避          | 1s×2^attempt,上限 30s,最多 5 次 | [detection-service.js:15](../../../../src/bilibili/gift/detection-service.js#L15)、[detection-service.js:204-205](../../../../src/bilibili/gift/detection-service.js#L204-L205) |
| 近期命令查重窗口        | ±5s                             | [event-service.js:192-193](../../../../src/bilibili/gift/event-service.js#L192-L193)                                                                                            |
| repairGiftV2Events 上限 | 200 行/次                       | [event-service.js:50](../../../../src/bilibili/gift/event-service.js#L50)                                                                                                       |
| 水晶球价值              | 100 RMB                         | [query-service.js:6](../../../../src/bilibili/gift/query-service.js#L6)                                                                                                         |
| 剩余水晶球              | ceil                            | [query-service.js:119](../../../../src/bilibili/gift/query-service.js#L119)                                                                                                     |
| 列表快照 / 历史 limit   | 30 / ≤100                       | [query-service.js:27](../../../../src/bilibili/gift/query-service.js#L27)、[query-service.js:34](../../../../src/bilibili/gift/query-service.js#L34)                            |
| SC 置顶/入库阈值        | 2 RMB                           | [superchat-service.js:14-15](../../../../src/bilibili/superchat-service.js#L14-L15)                                                                                             |
