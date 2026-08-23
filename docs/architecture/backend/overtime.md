# 加班机:礼物驱动倒计时与结算

> 涉及文件:[src/overtime/index.js](../../../src/overtime/index.js)、[src/overtime/overtime-service.js](../../../src/overtime/overtime-service.js)、[src/overtime/overtime-store.js](../../../src/overtime/overtime-store.js)、[src/overtime/overtime-contract.js](../../../src/overtime/overtime-contract.js)、[src/overtime/overtime-consumer.js](../../../src/overtime/overtime-consumer.js)、[src/bilibili/gift/detection-service.js](../../../src/bilibili/gift/detection-service.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

本文档是加班机领域的 **as-built 事实源**,描述 `src/overtime/` 的实际实现;旧设计规格 `11-overtime-machine-design.md` 中的设计规格类章节(需求条目、画面与 Admin 设计、验收清单)已按实现废弃,不再维护。HTTP 端点见 [api.md](api.md) §11,`overtime:update` 消息与快照字段见 [ws.md](ws.md) §2–§3,三张表 DDL 见 [storage.md](storage.md) §3.3,礼物检测核心见 [bilibili/gift.md](bilibili/gift.md),直播画面与 Admin 界面分别见 [frontend/overlays.md](../frontend/overlays.md) 与 [frontend/app.md](../frontend/app.md)。

## 1. 职责与架构

加班机是一个**单进程内领域模块**,不新增进程、框架或外部服务:礼物统计与加班机是两个并列消费者,共享同一个礼物检测核心(ADR [0006-shared-gift-detection-core](../adr/0006-shared-gift-detection-core.md)),三张表与 `gift_events` 同库(`gift-data.db`)以便结算在单一 SQLite 事务内完成(ADR [0004-reuse-monolith-and-gift-db](../adr/0004-reuse-monolith-and-gift-db.md))。

### 1.1 模块布局

| 文件 | 职责 |
|---|---|
| `overtime-service.js` | 计时状态机(`createOvertimeService`):权威倒计时、状态转移、礼物结算决策、随机抽取、归零/重试定时器、补偿调度 |
| `overtime-store.js` | 三张表的全部 SQL(`createOvertimeStore`):状态读写、规则整表替换、pending/结算事务(`BEGIN IMMEDIATE`)、补偿查询 |
| `overtime-contract.js` | 输入校验与常量(`validateTimeInput/validateAction/validateBackground/validateRules` 及 `MAX_*` 常量,§4–§5) |
| `overtime-consumer.js` | 礼物消费者适配层(`createOvertimeConsumer`):`progress → observeGift`、`final → finalizeGift` |
| `index.js` | 统一导出(contract 透传 + 三个工厂) |

### 1.2 装配与单例

`createDomainServices`([domain-services.js:89-95](../../../src/server/domain-services.js#L89-L95),见 [server-core.md](server-core.md) §5)按序:

1. `overtime = createOvertimeService({ giftDb: db.giftDb, onUpdate: onOvertimeUpdate })` — 只依赖 `gift-data.db` 与 `onUpdate` 回调,不依赖 settings/其他领域。
2. `overtimeConsumer = createOvertimeConsumer({ service: overtime })` — 消费者 `name: 'overtime'`,`isEnabled()` 即 `getCurrentEpoch() > 0`([overtime-consumer.js:8-17](../../../src/overtime/overtime-consumer.js#L8-L17))。
3. `giftService.createGiftService(baseContext, { consumers: [overtimeConsumer], getOvertimeEpoch: overtime.getCurrentEpoch })` — 消费者注册进共享检测核心;`getOvertimeEpoch` 决定检测核心是否因加班机而运行以及事件 epoch 归属。

状态是**单例行** `overtime_machine_state.id = 1`(DDL `CHECK (id = 1)`,[schema.js:315-327](../../../src/storage/schema.js#L315-L327));服务启动时 `getState() || ensureState()` 惰性插入安全默认行(`enabled=0/epoch=0/remaining_ms=0/status='paused'/revision=0`,[overtime-store.js:8-20](../../../src/overtime/overtime-store.js#L8-L20))。迁移版本 giftDb v5 负责为旧库插入该行(见 [storage.md](storage.md) §4)。

### 1.3 服务构造时的恢复顺序

`createOvertimeService` 构造即执行两步恢复([overtime-service.js:27-35](../../../src/overtime/overtime-service.js#L27-L35)):

1. `recoverPersistedClock()` — 若持久状态为 `running`,按墙钟锚点扣减停机期间流逝(§2.3);否则只重建锚点。
2. `recoverSettlements()` — 未启用时直接返回;启用时扫描"final + epoch 匹配 + 缺结算/待重试"的组立即补投(§3.4)。

### 1.4 礼物事件流与消费者隔离

原始 Bilibili 礼物包只进一次 `giftDetection.detect(gift)`([detection-service.js:38-96](../../../src/bilibili/gift/detection-service.js#L38-L96)):归一化 → 平台去重 → 连击合并 → 持久化 `gift_events` 的 `progress` 记录(**首包冻结消费者资格**:`gift_stats_eligible` 与 `overtime_epoch`,后续同组更新不得改变)→ 经消费者注册表分发标准事件。

- 检测核心的运行条件(消费者级联):`coreActive = enableGiftSprint==='true' || overtimeEpoch>0 || 存在 progress 组`;两者都关闭时停止接收新礼物但仍把已持久化的 progress 组排空为 final([detection-service.js:157-168](../../../src/bilibili/gift/detection-service.js#L157-L168)、[129-143](../../../src/bilibili/gift/detection-service.js#L129-L143))。
- 消费者注册表逐个 `try/catch` 分发,单个消费者抛错不影响其他消费者;final 分发有失败名单时按指数退避重发([consumer-registry.js](../../../src/bilibili/gift/consumer-registry.js)、[detection-service.js:188-224](../../../src/bilibili/gift/detection-service.js#L188-L224))。
- **查询只读**:礼物统计/历史查询一律只读 `detection_status='final' AND gift_stats_eligible=1` 的行([query-service.js:25-152](../../../src/bilibili/gift/query-service.js#L25-L152)),不触发任何生命周期变更;progress 与仅供加班机的事件不会出现在礼物统计功能中。
- 服务关闭时 `overtime.dispose()` 取消归零/重试定时器;检测核心 `dispose()` 则 `flushPending({force:true})` 把残留 progress 组全部 final 化(见 [server-core.md](server-core.md) §6.2)。

`OvertimeConsumer.handle` 只区分 `phase`([overtime-consumer.js:12-16](../../../src/overtime/overtime-consumer.js#L12-L16)):

```text
progress → service.observeGift(event)   // 幂等刷新 pending,不改时间
final    → service.finalizeGift(event)  // 立即结算(单一静默窗口,不二次等待)
```

## 2. 状态模型与权威计时

### 2.1 状态字段

内存状态由 `normalizeState` 从 DB 行规整([overtime-service.js:407-420](../../../src/overtime/overtime-service.js#L407-L420)),持久化列见 [storage.md](storage.md) §3.3:

| 字段(内存/列) | 说明 |
|---|---|
| `enabled` / `enable_epoch` | 总开关;每次 `enable()` 递增 epoch(`+1`),未启用时 `getCurrentEpoch()` 对外恒为 0 |
| `initial_seconds` | 重置基准值(0–315,328,464,000,即 9,999 年) |
| `remaining_ms` / `anchor_at_ms` | 锚点时刻的剩余毫秒与锚点墙钟(Unix ms) |
| `status` | 仅 `paused \| running \| finished`;**对外快照**在未启用时派生为 `'disabled'` |
| `background_path` / `background_fit` | 内置背景与适配模式(§5) |
| `revision` | **单调递增**,每次 `commit`/礼物结算/归零恢复时 `+1`,客户端据此丢弃旧增量 |
| `updated_at` | ISO 时间,审计用 |

各字段读写:[normalizeState:407-420](../../../src/overtime/overtime-service.js#L407-L420)、[saveState:22-41](../../../src/overtime/overtime-store.js#L22-L41)、[getSnapshot:37-50](../../../src/overtime/overtime-service.js#L37-L50)。

### 2.2 状态转移(全部先 `materialize()` 物化再写锚点)

| 操作 | 语义 | 出处 |
|---|---|---|
| `enable` | 置 enabled、epoch+1、status=`paused`(**启用后保持暂停,须手动开始**);已启用则 no-op | [overtime-service.js:85-93](../../../src/overtime/overtime-service.js#L85-L93) |
| `disable` | 物化后置 disabled、status=`paused`,`saveStateAndIgnorePending` 把全部 pending 置 `ignored` | [95-102](../../../src/overtime/overtime-service.js#L95-L102)、[overtime-store.js:43-53](../../../src/overtime/overtime-store.js#L43-L53) |
| `start` | 未启用抛错(`overtime must be enabled before start.`);`remainingMs>0` → `running`,否则保持 `finished` | [104-111](../../../src/overtime/overtime-service.js#L104-L111) |
| `pause` | `remainingMs<=0` 时归 `finished`,否则 `paused`(时间冻结) | [113-119](../../../src/overtime/overtime-service.js#L113-L119) |
| `reset` | `remainingMs = initialSeconds*1000`,归零时 `finished` 否则 `paused` | [121-127](../../../src/overtime/overtime-service.js#L121-L127) |
| `setTime` | `remainingSeconds` 写入后强制 `paused`(归零时 `finished`);`initialSeconds` 只改重置基准 | [64-74](../../../src/overtime/overtime-service.js#L64-L74) |
| 礼物结算联动 | `remainingMs` 归零 → `finished`;正向调整且原 `finished` → 自动 `running`(§3.3) | [210-211](../../../src/overtime/overtime-service.js#L210-L211) |

### 2.3 权威倒计时(ADR-0002)

见 [0002-server-authoritative-timing](../adr/0002-server-authoritative-timing.md),实现要点:

- **有效剩余时间**:`effectiveRemainingMs = max(0, remaining_ms - (now_ms - anchor_at_ms))`,仅 `running` 状态按流逝扣减;`paused/finished` 恒返回物化值([getEffectiveRemainingMs:290-294](../../../src/overtime/overtime-service.js#L290-L294))。
- **运行中单调时钟**:进程内流逝用 `performance.now()`(单调,不受 NTP/手工校时影响,见 [server-core.md](server-core.md) 的 Node 运行时假设);每次开始/暂停/调整/结算先 `materialize()` 把时间物化到当前瞬间并重建锚点([materialize:296-302](../../../src/overtime/overtime-service.js#L296-L302))。**墙钟只用于持久化与跨重启恢复**。
- **重启恢复**:启动时若持久状态为 `running`,按墙钟锚点扣减停机流逝 `offlineElapsedMs = max(0, now - anchor_at_ms)`,归零则置 `finished` 并 revision+1,随后重建归零定时器([recoverPersistedClock:268-288](../../../src/overtime/overtime-service.js#L268-L288))。**系统时钟回拨时停机流逝按 0 计,绝不反向增加时间**;大幅前跳按真实墙钟扣减(无法与长时间停机可靠区分)。
- **上限**:`MAX_OVERTIME_MS = 315_328_464_000_000`,`clampMs` 双向钳制([overtime-service.js:14](../../../src/overtime/overtime-service.js#L14)、[516-519](../../../src/overtime/overtime-service.js#L516-L519))。

### 2.4 归零定时器与 revision

- 进入 running 或正向调整后安排**单个**"到零"定时器;剩余超过 24 小时时按 `MAX_TIMER_CHUNK_MS = 24h` 分段重新调度,不每秒写库([overtime-service.js:15](../../../src/overtime/overtime-service.js#L15)、[355-378](../../../src/overtime/overtime-service.js#L355-L378));定时器 `unref()` 不阻止进程退出。
- 触发时:物化归零 → 置 `finished` → `commit('finished')`(revision+1 + 持久化 + 广播)。
- `commit(reason)`([304-313](../../../src/overtime/overtime-service.js#L304-L313))统一收口:revision+1 → `saveState`(或 `saveStateAndIgnorePending`)→ 重建归零定时器 → `onUpdate({reason, state: getSnapshot()})` → [server.js:148-153](../../../src/server.js#L148-L153) 广播 `overtime:update`(见 §6 与 [ws.md](ws.md) §3.2)。

## 3. 礼物结算管线(ADR-0003)

### 3.1 结算键与生命周期

- 一个 `gift_events.id` 就是一次连击最终封账后的礼物组,也是唯一结算键:`overtime_settlements.gift_event_id UNIQUE`([schema.js:344-347](../../../src/storage/schema.js#L344-L347))。`quantityMode='group'` 时整组执行一次规则；`quantityMode='item'` 时按封账数量 `num` 执行对应次数。
- 结算行状态:`pending → applied | ignored`(CHECK 约束);`applied/ignored` 是终态,重复包、迟到包、数量继续增长都不再修改(`isComplete`,[overtime-store.js:335-337](../../../src/overtime/overtime-store.js#L335-L337))。
- **单一静默窗口**:检测核心在平台结束标记(`COMBO_SEND` 或非连击包,[detection-service.js:261-263](../../../src/bilibili/gift/detection-service.js#L261-L263))或 `last_platform_at_ms` 连续 `GIFT_FINALIZE_QUIET_MS = 10s` 未变化时,把事件改为 `final` 并分发一次([detection-service.js:14](../../../src/bilibili/gift/detection-service.js#L14)、[98-127](../../../src/bilibili/gift/detection-service.js#L98-L127));加班机收到 final **立即结算,不再等待第二个 10 秒**。
- **资格冻结**:`gift_events.overtime_epoch` 在组内第一个平台包到达时写入当时的 `enable_epoch`(未启用为 0),后续连击不得改变;加班机只在 `enabled=1 且 overtime_epoch === enable_epoch` 时处理事件(`isEligible`,[overtime-store.js:328-333](../../../src/overtime/overtime-store.js#L328-L333))——关闭期间开始的组即使重新启用后封账也不补投、不回放。

### 3.2 observeGift / settleFinal 返回语义

| 返回 kind | 含义 | 处理 |
|---|---|---|
| `complete` | 该组已有 `applied/ignored` 结算 | no-op(幂等) |
| `missing` | `gift_events` 无该 id | no-op |
| `ineligible` | enabled/epoch 不匹配 | 若已存在 pending 则置 ignored |
| `pending` | 已确保/刷新 pending 行 | progress 阶段到此为止,不改时间 |
| `ignored` | final 但无启用规则 | 占用唯一结算键,不广播 |
| `applied` | 结算完成,携带新状态与 `adjustment` | 更新内存、重建定时器、广播 |

`observeGift`([overtime-store.js:89-103](../../../src/overtime/overtime-store.js#L89-L103))与 `settleFinal`([105-163](../../../src/overtime/overtime-store.js#L105-L163))各自在 `BEGIN IMMEDIATE` 事务内执行([immediate:274-284](../../../src/overtime/overtime-store.js#L274-L284)),全部路径幂等。

### 3.3 结算事务与时间变化

| 阶段 | 行为 | 出处 |
|---|---|---|
| pending 幂等 upsert | `ensurePending`:`INSERT … ON CONFLICT(gift_event_id) DO UPDATE … WHERE status='pending'`,仅刷新快照字段(quantity/total_price/事件时间) | [overtime-store.js:236-263](../../../src/overtime/overtime-store.js#L236-L263) |
| final 结算 | `settleFinal` 同一事务内:复验 enabled/epoch → 幂等确保 pending → 确认 `detection_status='final'` → 查 `enabled=1` 规则(无规则 → ignored)→ `resolve` 计算时间变化 → `saveState` + pending 行置 `applied`(写全量快照字段) | [overtime-store.js:105-163](../../../src/overtime/overtime-store.js#L105-L163) |
| 时间变化 | 按规则的 `quantityMode` 得到执行次数:连击组模式为 1,具体数量模式为 `num`;固定操作顺序重复,随机模式每次独立抽取。最终 `appliedDeltaSeconds = trunc((afterMs-beforeMs)/1000)`,经 `clampMs` **双向钳制**:负数归零、超上限截断 | [overtime-service.js:202-278](../../../src/overtime/overtime-service.js#L202-L278) |
| 状态联动 | `afterMs === 0` → `finished`;`requested>0` 且当前 `finished` → 自动恢复 `running` | [210-211](../../../src/overtime/overtime-service.js#L210-L211) |
| 审计快照 | `rule_snapshot_json`:`{mode, quantityMode, fixedEffect\|null, outcomes[], displayText, ruleUpdatedAt}`;盲盒结果 `outcomes_json` version 1(§4.3);`rule_mode` = `fixed/random/display/ignored` | [215-221](../../../src/overtime/overtime-service.js#L215-L221)、[247-266](../../../src/overtime/overtime-service.js#L247-L266) |
| 广播 | `kind === 'applied'` 才 `onUpdate({reason:'gift', state, adjustment})`;`ignored` 不递增 revision、不广播、不动效 | [overtime-service.js:178-188](../../../src/overtime/overtime-service.js#L178-L188) |

`adjustment` 载荷由 `resolveGiftSettlement` 构造,经 `overtime:update` 的 `adjustment` 字段下发(见 [ws.md](ws.md) §3.2);`quantity` 是封账数量,`applicationCount` 是实际规则执行次数。示例(固定规则 `+300s` 的 `x100` 连击,选择按具体数量):

```json
{
  "giftEventId": 42, "giftId": "35521", "giftName": "心动时刻",
  "quantity": 100, "totalPrice": 10, "imagePath": "/img/bilibili-gifts/.../35521.webp",
  "mode": "fixed", "quantityMode": "item", "applicationCount": 100,
  "requestedDeltaSeconds": 30000,
  "appliedDeltaSeconds": 30000, "resultSeconds": 30000, "result": null
}
```

盲盒模式时 `result` 为持久化的抽取对象(§4.3),画面只播放 `resultSeconds`。settlement 行镜像同一快照:`quantity/total_price/event_created_at/event_updated_at` 均为封账瞬间值([overtime-store.js:133-155](../../../src/overtime/overtime-store.js#L133-L155))。

### 3.4 失败重试与补偿扫描

| 机制 | 行为 | 出处 |
|---|---|---|
| 结算事务失败 | 事务回滚,行保持 pending;`recordFailure` 递增 `retry_count`、写 `settle_after_ms = now + delay`,延迟按指数退避 `min(30, 2^(retryCount-1))` 秒(**1、2、4、8、16、30、30…**);`last_error` 只存单行化错误摘要(≤500 字符) | [overtime-store.js:165-185](../../../src/overtime/overtime-store.js#L165-L185)、[344-346](../../../src/overtime/overtime-store.js#L344-L346) |
| 重试调度 | `scheduleRecovery` 单定时器(可 `unref`)到点执行 `recoverSettlements`;空闲时按 `getNextPendingAt` 取最近到期时间预排,无需礼物活动 | [overtime-service.js:333-353](../../../src/overtime/overtime-service.js#L333-L353)、[overtime-store.js:200-208](../../../src/overtime/overtime-store.js#L200-L208) |
| 补偿扫描 | 服务构造时与每次重试:扫描 `detection_status='final' AND overtime_epoch=当前epoch AND (无 settlement 或 pending 到期)` 的组补投,按 `id ASC`、单批 ≤100 | [overtime-store.js:187-198](../../../src/overtime/overtime-store.js#L187-L198)、[overtime-service.js:315-331](../../../src/overtime/overtime-service.js#L315-L331) |
| 检测核心侧重投 | final 分发失败时核心侧按 `min(30s, 1s·2^attempt)` 退避重发同一 `final` 事件(attempt 上限 5),直到 dispatch 无失败 | [detection-service.js:188-224](../../../src/bilibili/gift/detection-service.js#L188-L224) |

两个补偿器(统计消费者用 `gift_stats_delivered`,加班机用 settlement 行)互不干扰,任何一次投递都幂等;加班机补偿只对 epoch 匹配的组生效,历史事件不会回放(ADR [0006-shared-gift-detection-core](../adr/0006-shared-gift-detection-core.md))。

## 4. 规则与时间盲盒

规则表 `overtime_gift_rules`(`gift_id` PK)由 `POST /api/overtime/rules` **整表原子替换**(`replaceRules` 在单个 `BEGIN IMMEDIATE` 事务内 DELETE + 批量 INSERT,[overtime-store.js:62-87](../../../src/overtime/overtime-store.js#L62-L87));读取按 `sort_order, gift_id` 排序([55-60](../../../src/overtime/overtime-store.js#L55-L60)),快照 `rules` 字段返回**全部**规则(含停用)。

### 4.1 校验常量

| 常量 | 值 | 出处 |
|---|---|---|
| `MAX_OVERTIME_SECONDS` | **315,328,464,000**(9,999 年) | [overtime-contract.js:4](../../../src/overtime/overtime-contract.js#L4) |
| `MAX_EFFECT_FACTOR` | **1,000** | [overtime-contract.js:5](../../../src/overtime/overtime-contract.js#L5) |
| `MAX_RANDOM_WEIGHT` | **100,000** | [overtime-contract.js:6](../../../src/overtime/overtime-contract.js#L6) |
| `MAX_ENABLED_RULES` | **8** | [overtime-contract.js:7](../../../src/overtime/overtime-contract.js#L7) |

### 4.2 规则形态

| 模式 | 字段 | 校验 |
|---|---|---|
| `fixed` | `fixedEffect:{operation, value}`;operation ∈ `add`/`subtract`/`multiply`/`divide`/`clear`;add/subtract 的 value ∈ 0–315,328,464,000;multiply/divide 的 value ∈ 2–1,000 | [overtime-contract.js:119-143](../../../src/overtime/overtime-contract.js#L119-L143) |
| `random`(时间盲盒) | `outcomes[2..10]`,每项 `{operation, value, weight}`;weight ∈ 1–100,000,总权重 ≤ 100,000 | [overtime-contract.js:91-107](../../../src/overtime/overtime-contract.js#L91-L107) |
| `display`(文字展板) | `displayText` 为 1–6 个 Unicode 字符且无控制字符；礼物结算记录保持幂等，但前后剩余时间相同 | [overtime-contract.js:75-86](../../../src/overtime/overtime-contract.js#L75-L86) |
| 公共 | `giftId` 必填 ≤100 字符且数组内唯一;`giftName` ≤100;`imagePath` 必须站内路径(§5);`quantityMode` ∈ `group`/`item`;`enabled` 默认 true;`sortOrder` 整数;启用的规则 ≤ 8 条 | [overtime-contract.js:59-108](../../../src/overtime/overtime-contract.js#L59-L108) |

### 4.3 存储形态与带权抽取

- 规则存储:`mode='fixed'` 时写入 version 2 effect;`random` 写入 version 2 outcomes;`display` 写入 `{ "version": 3, "quantityMode": "group", "displayText": "…" }`([overtime-store.js:78-80](../../../src/overtime/overtime-store.js#L78-L80))。
- 结算行审计:盲盒结果 `outcomes_json` 持久化为 `{ "version": 1, "selectedIndex": 0, "selectedSeconds": 300, "totalWeight": 100 }`,客户端只播放已保存的 `selectedSeconds`,绝不自行随机;固定规则快照 `outcomes: []`、随机规则快照 `fixedSeconds: null`,流水可仅凭快照还原当时配置。
- `selectRuleResult`([overtime-service.js:247-266](../../../src/overtime/overtime-service.js#L247-L266)):`fixed` 直接取 `fixedSeconds`;`random` 按 outcomes 数组顺序累计权重,用 **`node:crypto.randomInt(totalWeight)`** 抽取一次(import 见 [overtime-service.js:3](../../../src/overtime/overtime-service.js#L3);校验已保证权重 ≥1,无结果分支正常不可达)。
- **随机结果按执行次数产生**:`group` 模式抽一次,`item` 模式按最终数量独立抽取;同一结算会保存全部抽中索引。页面刷新、WS 重连和重复礼物包都不能重抽(结算行已 complete)。

## 5. 配置校验

| 输入 | 校验规则 | 出处 |
|---|---|---|
| 背景 `path` | 必须为空字符串,或匹配 `/img/overtime-machine/<name>` 的内置图片路径 | [overtime-contract.js:30-41](../../../src/overtime/overtime-contract.js#L30-L41) |
| 背景 `fit` | `cover`(默认)`\| contain \| fill` | 同上 |
| 路径安全 | `isAllowedImagePath`:拒绝 `..`、反斜杠、协议头(`scheme:`/`//`),且限定于 `public/img/overtime-machine/`(规则图片另允许 `/img/bilibili-gifts/`) | [overtime-contract.js:62-65](../../../src/overtime/overtime-contract.js#L62-L65)、[131-134](../../../src/overtime/overtime-contract.js#L131-L134) |
| 时间输入 | `initialSeconds`/`remainingSeconds` 至少一个,0–315,328,464,000 整数 | [overtime-contract.js:9-22](../../../src/overtime/overtime-contract.js#L9-L22) |
| 动作 | `start \| pause \| reset \| enable \| disable` | [overtime-contract.js:22-28](../../../src/overtime/overtime-contract.js#L22-L28) |

服务端对时间、权重、路径、状态与 JSON 结构做完整校验,不信任 Admin DOM 的 `min/max`。V1 不做任意背景上传,全部内置资源(ADR [0005-built-in-overtime-backgrounds](../adr/0005-built-in-overtime-backgrounds.md));规则与时钟状态同库同域,清库时保留(ADR [0004-reuse-monolith-and-gift-db](../adr/0004-reuse-monolith-and-gift-db.md)、[storage.md](storage.md) §6)。

## 6. 手势操作与发布

### 6.1 操作入口

全部经 `/api/overtime/*` 暴露(端点表见 [api.md](api.md) §11),服务语义:

| 操作 | 语义 | 出处 |
|---|---|---|
| `getOverview()` | 快照 + `pendingCount` + 最近 20 条 `applied/ignored` 结算(limit 钳制 1–100) | [overtime-service.js:56-62](../../../src/overtime/overtime-service.js#L56-L62)、[overtime-store.js:222-230](../../../src/overtime/overtime-store.js#L222-L230) |
| `setTime({initialSeconds?, remainingSeconds?})` | 改重置基准或当前时间;后者强制 `paused` | [overtime-service.js:64-74](../../../src/overtime/overtime-service.js#L64-L74) |
| `act({action})` | start/pause/reset/enable/disable(§2.2) | [76-83](../../../src/overtime/overtime-service.js#L76-L83) |
| `setBackground({path?, fit?})` | 背景配置,`commit('config')` | [129-136](../../../src/overtime/overtime-service.js#L129-L136) |
| `replaceRules({rules})` | 规则整表替换,`commit('rules')` | [138-144](../../../src/overtime/overtime-service.js#L138-L144) |

### 6.2 发布契约

`onUpdate` → [server.js:148-153](../../../src/server.js#L148-L153) 广播 `overtime:update`,`reason` 枚举与 [ws.md](ws.md) §3.2 一致:

| reason | 触发点 |
|---|---|
| `gift` | 礼物结算(携带 `adjustment`,仅 applied) |
| `manual` | 开始/暂停/重置/加减时间/开关 |
| `config` | 背景等配置变更 |
| `rules` | 规则集替换 |
| `finished` | 倒计时自然归零定时器触发 |

快照侧:`state.overtime`(16 字段之一,生产者 `domainServices.overtime.getSnapshot()`,[ws.md](ws.md) §2)与 `state.giftDetection`(`giftDetection.getStatus()`:`coreActive/consumers/pendingCount`,[detection-service.js:157-168](../../../src/bilibili/gift/detection-service.js#L157-L168))在每次连接与业务变更时全量下发。

增量消息形态(逐字契约见 [ws.md](ws.md) §3.2;`state` 含 `effectiveRemainingMs/serverNowMs/status/revision`,配置或规则变化时另带完整 `background/rules`):

```json
{ "type": "overtime:update", "reason": "gift",
  "state": { "effectiveRemainingMs": 9738000, "serverNowMs": 1786264800500,
             "status": "running", "revision": 43 },
  "adjustment": { "giftEventId": 42, "giftId": "35521", "mode": "fixed",
                  "requestedDeltaSeconds": 300, "appliedDeltaSeconds": 300,
                  "resultSeconds": 300 } }
```

计时本身不每秒广播,只在人工操作、礼物结算、配置变化、自然归零与连接建立时同步;客户端以 `serverNowMs` 抵消传输时延后用本地时钟插值,已连接状态下只接受 revision 更新的增量,重连快照无条件接受。

## 7. 故障行为(按实现)

| 故障 | 实际行为 |
|---|---|
| 暂停期间收到礼物 | `materialize()` 冻结当前值,结算只改 `remainingMs`、不改状态;恢复 `start` 后续走(时间不补减、不跳变) |
| 程序重启(运行中) | 按墙钟锚点扣减停机流逝,归零 → `finished`;补偿扫描恢复未完成结算(§3.4) |
| 系统时钟回拨 | 停机流逝按 `max(0, …)` 计 0,不反向加时;运行中走单调时钟不受影响 |
| 长时间倒计时 | 单一定时器按 24h 分段重排(`MAX_TIMER_CHUNK_MS`),不每秒写库;触发后 `commit('finished')` 广播 |
| 结算事务失败 | 事务回滚,行保持 `pending`;`retry_count` 指数退避 1–30s 自动重试;重启后继续 |
| 消费者首次投递失败 | 检测核心侧退避重发 final + 加班机补偿扫描双保险,结果仍恰好一次提交 |
| 关闭/禁用期间 | `disable` 立即把 pending 全置 `ignored`;旧 epoch 组(首包冻结 epoch≠当前)一律 `ineligible`,不补投、不回放 |
| 重复包 / 连击增长 | progress 阶段刷新 pending 数量并重置静默窗口;final 后按规则选择“连击组一次”或“具体数量 N 次”,结算行进入终态后重复包不再修改 |
| 无匹配规则 | final 结算置 `ignored`(占用唯一结算键),不改变时间、不广播 |
| 文字展板规则 | final 结算置 `applied` 并广播 `displayText`,前后剩余时间相同；叠加层只更新结算账本，不播放时间正负闪动 |
| 盲盒抽到 0 / 已归零仍减时 / 已在上限仍加时 | 一律正常写结算与广播 adjustment(实际变化为 0),保证可审计 |
| 清空礼物数据库 | `gift_events` + `overtime_settlements` 同事务清空,**保留** `overtime_machine_state`/`overtime_gift_rules`(见 [storage.md](storage.md) §6) |

## 8. 参考

- 表 DDL 与迁移:[storage.md](storage.md) §3.3、§4(giftDb v5 插入单例行)
- HTTP 端点:[api.md](api.md) §11(校验常量:`MAX_OVERTIME_SECONDS=315,328,464,000`、`MAX_EFFECT_FACTOR=1,000`、`MAX_RANDOM_WEIGHT=100,000`、`MAX_ENABLED_RULES=8`、`MAX_DISPLAY_TEXT_LENGTH=6`)
- WebSocket 契约:[ws.md](ws.md) §2(`overtime`/`giftDetection` 快照字段)、§3.2(`overtime:update` reason 枚举)
- 礼物检测核心与消费注册表:[bilibili/gift.md](bilibili/gift.md)
- ADR:[0002-server-authoritative-timing](../adr/0002-server-authoritative-timing.md)、[0003-settle-once-per-gift-group](../adr/0003-settle-once-per-gift-group.md)、[0004-reuse-monolith-and-gift-db](../adr/0004-reuse-monolith-and-gift-db.md)、[0005-built-in-overtime-backgrounds](../adr/0005-built-in-overtime-backgrounds.md)、[0006-shared-gift-detection-core](../adr/0006-shared-gift-detection-core.md)
