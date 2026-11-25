# 加班机：礼物驱动倒计时与结算

> 涉及文件：[src/overtime/index.js](../../../src/overtime/index.js)、[src/overtime/overtime-service.js](../../../src/overtime/overtime-service.js)、[src/overtime/overtime-effects.js](../../../src/overtime/overtime-effects.js)、[src/storage/overtime-store.js](../../../src/storage/overtime-store.js)、[src/overtime/overtime-contract.js](../../../src/overtime/overtime-contract.js)、[src/overtime/overtime-consumer.js](../../../src/overtime/overtime-consumer.js)、[src/bilibili/gift/projection-service.js](../../../src/bilibili/gift/projection-service.js)、[src/bilibili/gift/remote-catalog-cache.js](../../../src/bilibili/gift/remote-catalog-cache.js)、[src/bilibili/gift/hybrid-catalog.js](../../../src/bilibili/gift/hybrid-catalog.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

本文档是加班机领域的**现行实现事实源**，描述 `src/overtime/` 与 `src/storage/overtime-store.js` 的实际实现（旧设计文档 `11-overtime-machine-design.md` 中的设计与验收章节已废弃，不再维护）。HTTP 端点见 [api.md](api.md) §11，`overtime:update` 消息与快照字段见 [ws.md](ws.md) §2–§3，三张表 DDL 见 [storage.md](storage.md) §3.3，礼物投影服务见 [bilibili/gift.md](bilibili/gift.md)，叠加层与管理端界面分别见 [frontend/overlays.md](../frontend/overlays.md) 与 [frontend/app.md](../frontend/app.md)。

## 1. 职责与架构

**礼物身份绑定**（详见 [完整规格](../../../specs/gift-identity-overtime.md) 与 [ADR-0014](../../architecture/adr/0014-gift-identity-bound-overtime.md)）：目录按完整 `variantId` 区分同平台 ID 下不同名称或标价的礼物变体；规则可保存 `giftIdentity`（含 `variantId`、`priceRaw`、`coinType`、`bagGift`），以 `(gift_id, gift_identity_key)` 为唯一键。快照中的 `bindingStatus` 为 `bound` 或 `needs-selection`：后者保留原规则配置并等待重新选择，在此之前不触发加班；重新选择仅更新礼物资料，保留生效方式、时间、随机设置、数量模式与排序。

结算时匹配同一真实礼物 ID 冻结的 `gift_variant_id`，未知或其他身份均不匹配。规则快照冻结 `giftIdentity`，已有的 `applied` / `ignored` 记录及历史同步不重新结算。服务端设备接口的三种交付请求会主动协商身份字段，旧版 DTO 仍可按身份未知读取；大航海别名兼容不变。

加班机是一个**单进程内领域模块**，不新增进程、框架或外部服务：礼物统计与加班机作为两个并列消费者，共享同一个礼物投影服务（[ADR-0006](../../architecture/adr/0006-shared-gift-detection-core.md)）；三张表与 `gift_events` 同库（`gift-data.db`），使结算能在单一 SQLite 事务内完成（[ADR-0004](../../architecture/adr/0004-reuse-monolith-and-gift-db.md)）。

### 1.1 模块布局

| 文件 | 职责 |
| --- | --- |
| `overtime-service.js` | 计时状态机（`createOvertimeService`）：权威倒计时、状态转移、持久化调用、定时器与补偿调度 |
| [overtime-settlement.js](../../../src/overtime/overtime-settlement.js) | 完整礼物结算算法：数量限制、规则抽取、规则快照和调整结果；显式接收当前状态、时间与随机源 |
| `overtime-effects.js` | 时长边界、固定/重复 effect 运算与随机结果汇总；无数据库、定时器或广播副作用 |
| `storage/overtime-store.js` | 三张表的全部 SQL（`createOvertimeStore`）：状态读写、规则整表替换、pending/结算事务（`BEGIN IMMEDIATE`）、补偿查询 |
| `overtime-contract.js` | 输入校验与常量（`validateTimeInput` / `validateAction` / `validateBackground` / `validateRules` 及 `MAX_*` 常量，见 §4–§5） |
| `overtime-consumer.js` | 礼物消费者适配层（`createOvertimeConsumer`）：`progress → observeGift`、`final → finalizeGift` |
| `remote-catalog-cache.js` | Electron 主进程注入的服务器全局礼物目录缓存：持久化规范化快照、ETag 条件刷新、请求合并与低频轮询；网络失败不覆盖已有快照 |
| `remote-gift-image-cache.js` | 服务器图片缓存：限定配置服务器 origin 与固定路径、限制下载大小与时限、校验位图格式并原子写入运行时 data 目录 |
| `hybrid-catalog.js` | 目录门面：主读取与刷新固定使用 Bilibili 当前房间目录；服务器快照按完整礼物身份补图并支持按名称或 ID 搜索 |
| `index.js` | 领域导出（contract 透传 + service / consumer 两个工厂） |

### 1.2 装配与单例

`createDomainServices`（[domain-services.js](../../../src/server/domain-services.js)，见 [server-core.md](server-core.md) §5）按序装配：

1. `overtime = createOvertimeService({ store: createOvertimeStore(db.giftDb), onUpdate: onOvertimeUpdate })` — 组合根从存储层创建适配器并显式注入；领域服务只依赖 `store` 接口，不接触数据库句柄，也不自行构造适配器。底层仍复用 `gift-data.db`，事务边界由 `overtime-store.js` 管理。
2. `overtimeConsumer = createOvertimeConsumer({ service: overtime })` — 消费者 `name: 'overtime'`，`isEnabled()` 即 `getCurrentEpoch() > 0`（[overtime-consumer.js:8-17](../../../src/overtime/overtime-consumer.js#L8-L17)）。
3. `giftService.createGiftService({ queryStore, maintenanceStore, projectionStore, statisticsStore, settings }, { consumers: [overtimeConsumer], getOvertimeEpoch: overtime.getCurrentEpoch })` — 消费者注册进服务器结果投影器；四个存储适配器均由组合根创建，`getOvertimeEpoch` 决定首次收到事件时冻结的加班纪元（epoch）。

结算算法在 `store.settleFinal` 的事务回调中执行。折算当前剩余时间时同步采样单调时钟，事务提交成功后以这次采样作为新内存状态的时间锚点，运行中的倒计时会继续扣减事务耗时。归零计时、失败记账及恢复调度仍由服务负责。算法模块不读取 service 的可变状态，也不提前在事务外抽取随机结果。

状态为**单例行** `overtime_machine_state.id = 1`（DDL `CHECK (id = 1)`，[schema.js:315-327](../../../src/storage/schema.js#L315-L327)）；服务启动时经 `getState() || ensureState()` 惰性插入安全默认行（`enabled=0/epoch=0/remaining_ms=0/status='paused'/revision=0`，[overtime-store.js](../../../src/storage/overtime-store.js)）。迁移版本 `giftDb` v5 负责为旧库插入该行（见 [storage.md](storage.md) §4）。

### 1.3 服务构造时的恢复顺序

`createOvertimeService` 构造时即执行两步恢复（[overtime-service.js:27-35](../../../src/overtime/overtime-service.js#L27-L35)）：

1. `recoverPersistedClock()` — 若持久状态为 `running`，按墙钟锚点扣减停机期间流逝（§2.3）；否则只重建锚点。
2. `recoverSettlements()` — 未启用时直接返回；启用时扫描“final + epoch 匹配 + 缺结算/待重试”的组立即补投（§3.4）。

### 1.4 礼物事件流与消费者隔离

客户端通过 `importProcessedEvent` 接收服务器确认的 `progress` / `final` 事件，直接保存服务器返回的礼物数量、金额与盲盒结果。首次收到事件时冻结消费者资格 `gift_stats_eligible` 与 `overtime_epoch`，后续同一事件更新不再改变资格；原始 Bilibili 礼物解析、去重和连击收尾均由服务器完成（详见 [bilibili/gift.md](bilibili/gift.md) §2 与 [projection-service.js](../../../src/bilibili/gift/projection-service.js)）。

- 服务器事件始终落库；礼物统计和加班消费者关闭时也不丢弃事件。客户端不通过定时器将 `progress` 改为 `final`，仅处理服务器确认的最终结果。
- 消费者注册表逐个 `try/catch` 分发，单个消费者抛错不影响其他消费者；`final` 分发存在失败项时按指数退避重发（[consumer-registry.js](../../../src/bilibili/gift/consumer-registry.js)、[projection-service.js](../../../src/bilibili/gift/projection-service.js)）。
- **查询只读**：当前账本的历史与总计按 active source 读取 `final`、`active` 且身份、数量、金额和时间有效的付费礼物，不按 `gift_stats_eligible` 过滤（关闭统计期间的礼物仍出现在历史账本中）；近期展示与盲盒统计继续要求 `gift_stats_eligible = 1`。所有查询均不改变生命周期，`progress` 不进入最终账本。查询由 [gift-query-store.js](../../../src/storage/gift-query-store.js) 负责，完整契约见 [礼物投影规格](../../../specs/gift-ledger-projection-sync_design.md)。
- 服务关闭时 `overtime.dispose()` 取消归零与重试定时器；礼物投影器 `dispose()` 取消消费者重试，不写入或收尾 `progress`（见 [storage.md](storage.md#63-并发写入静默quiesce)）。

`OvertimeConsumer.handle` 仅区分 `phase`（[overtime-consumer.js:12-16](../../../src/overtime/overtime-consumer.js#L12-L16)）：

```text
progress → service.observeGift(event)   // 幂等刷新 pending，不改时间
final    → service.finalizeGift(event)  // 收到服务器 final 后立即结算
```

### 1.5 服务器全局礼物目录联动

规则图片解析使用目录门面的 `resolveGiftImagePath(giftId, imagePath, rule)` 点查询。远程缓存维护随完整目录替换的 ID 索引，`getGift(id, variantId)` 返回单条副本；仅有 ID 且存在多候选时返回 `null`。解析单条规则只检查该礼物的本地图片，不拉取全局或房间完整快照去逐项验图。目录更新会立即替换索引，图片缓存仍自行负责当前图片与最近成功图片的选择；快照查询不修改持久化规则或历史结算。

房间与全局快照按本地/远程目录修订号（revision）、自定义盲盒配置和图片修订号缓存合并及素材校验结果，对外读取始终返回隔离副本。目录刷新、下载完成及最近可用图片变更会立即使缓存失效；外部文件被删除或损坏时至多 1 秒后重新校验，不依赖不可靠的文件监听。未提供修订号能力的注入式目录沿用实时读取。远程快照仅执行一次深拷贝，避免重复拷贝礼物数组与关系。

礼物图片缺失或加载失败时，选择器、规则编辑、加班机叠加层、最近收礼和盲盒映射统一通过 `public/js/shared/gift-image-fallback.js` 显示内置 `/img/gift-placeholder.png`。旧规则中的 SVG 占位地址仅在显示时替换，不修改规则身份或缓存元数据。重复更新图片仍保留错误回退；默认占位图本身加载失败时停止重试并保留礼物名称。

目录选择器与礼物事件管线相互分离。主目录始终来自当前配置直播间的礼物面板、`giftConfig` 和已配置的在售盲盒展开，不读取个人账号背包。Electron 主进程以已配置的 `LIRA_LICENSE_API_BASE` 作为唯一服务器入口，通过公开接口 `GET /api/public/gifts/catalog?schemaVersion=3` 拉取全局身份档案；完整校验原包后向选择器提供金瓜子礼物，供主目录按完整身份补图及弹窗“搜索全部礼物”使用，不会增删或替换房间成员，也不会按名称合并同名不同 ID。服务地址仅接受使用域名（DNS 主机名）的 HTTPS 根 origin，拒绝 HTTP、`localhost` 和 IP 地址。设备令牌仅用于授权校验，不随公共目录请求发送，也不暴露给渲染进程。

`remote-catalog-cache.js` 在本地 `data/cache/overtime-gift-catalog-v2.json` 保存 ETag、同步版本、更新时间、schema 3 原始身份包及兼容的规范化付费礼物数组。首次授权成功后，`gift-catalog-initializer.js` 保持登录页可见，扫描完整目录并从已校验的 Bilibili `sourceUrl` 下载图片；只有缺少可用源地址的条目才回退下载服务器 `/gift-media/images/<basename>`，B 站下载失败不会自动转为服务器批量下载。文件按完整礼物身份、源 URL 与已校验服务器图片 URL 的哈希分离，`data/cache/overtime-gift-images/index.json`（schemaVersion 2，`images` 为 `variantId` 到安全文件名的映射）原子保存最近成功图片，换图失败继续保留旧图。完成状态写入 `data/cache/overtime-gift-assets-state-v2.json`。目录不可用且无旧快照时提供重试；单图失败不永久阻塞。已有完成状态时，每次授权启动直接进入管理端，并以 `If-None-Match` 检查一次；持续运行期间每 12 小时再检查一次，关闭时清理定时器；收到 304 也会检查并补齐本地缺图。管理端仅接收本地 `/overtime-gift-images/<basename>`，支持离线复用。

本机场景图片由 [gift-image-resources.js](../../../src/bilibili/gift/gift-image-resources.js) 统一接入同一个目录缓存实例。目录门面的 `imageResources.resolveSource(source)` 按精确 B 站 URL 查询目录索引并复用既有图片文件名；目录尚未包含的合法来源使用 `source-<sha256>.<扩展名>`，无需改动礼物身份或云端事件字段。来源索引仅随目录修订号重建；映射本身不触发下载，最多登记 512 个最近使用的资源。`ensureImage(localPath)` 只准备已登记资源，并与目录初始化共用 `remote-gift-image-cache.js` 的同文件请求合并、最多 4 路并发、15 秒超时、5 MiB 上限、来源与内容校验及禁止重定向规则。重复失败冷却 30 秒，后续实际使用时再重试，不做额外轮询。现有有效文件可跨场景及重启离线复用；URL 更新会分离为新文件，来源仅匹配单个 variant 时更新失败可回退该 variant 的最近成功图片；多个 variant 共用同一来源时仅复用精确来源文件，不猜测旧图归属。HTTP 接口不接受任意 URL 代取，详见 [共享礼物图片](api.md#共享礼物图片)。原目录初始化与定时更新策略保持不变，不为每条弹幕刷新目录。

目录返回 304 时沿用内容修订号。同 ETag 的正常后续校验只原子替换 `overtime-gift-catalog-v2.json.check.json`，保存本次 `checkedAt` 和主文件的本地代次。重启时，只有代次相符且处于主文件检查时间与当前时间之间的记录才能延长节流。时间文件丢失、损坏或恢复了另一份目录时，以主文件为准。旧目录的首次校验、ETag 变化及校验时钟回退会原子提交完整目录和新代次。

图片初始化在同一个并发上限内检查文件和下载图片。命中时读取文件类型、大小和最多 12 字节的格式签名。后台扫描仅补缺图，完成统计复用这一轮的校验结果，展示用的上次成功图片不计入本次修复数。

图片及 `index.json` 写入遇到 `EPERM` / `EBUSY` 时，仅重试已完成临时文件的原子重命名（最多 4 次，异步依次等待 50/100/150/200 ms 以让出事件循环）；调用方等待保存完成，不重复下载或删除目标文件。索引提交串行执行，等待期间产生的新修订号会在返回前补写。持续锁定或其他错误保持原失败语义，保留旧文件并清理自有临时文件；图片修复成功后才递增缓存修订号。运行时关闭时，目录门面释放资源登记并取消自有图片缓存任务；借入的缓存仍由其原归属模块释放。

schema 3 的 `metadata` 及其 `countMap` 条目允许服务器追加说明字段；必需字段与已知字段照常严格校验，附加字段仅保留在原始磁盘缓存并参与业务摘要，不进入渲染进程快照、图片下载或记账。顶层结构、礼物身份、价格、媒体源、特效和盲盒关系保持严格校验。目录校验失败时保留上一份有效目录；重启后会重新检查，但不会自行修复协议不兼容。

本地目录相关 HTTP 端点契约见 [api.md §11](api.md#11-加班机域overtime)，房间主目录读写不依赖远程目录配置；所有本地搜索均纯本地匹配名称或 ID，不读取 Markdown、静态图库或在查询时联网。目录变化或缺图修复后，客户端完成图片扫描再通过本地 `/ws` 广播 `gift-catalog:update`（携带本地图片路径及 `assetsUpdatedAt`）；管理端按完整身份更新图片，不以全局目录替换房间主目录。后续实际下载由既有 IPC 进度驱动单条提示（展示开始、进度、完成或部分失败，无下载时不提示）。目录更新不覆盖盲盒映射 `giftBlindBoxConfig`、计时规则或历史账本。ICP 备案后的公网页面继续使用 LIRA Server 原有分组 API 与 `/gifts` 路由，不依赖本地目录服务。

## 2. 状态模型与权威计时

### 2.1 状态字段

内存状态由 `normalizeState` 从数据库行规整（[overtime-service.js:407-420](../../../src/overtime/overtime-service.js#L407-L420)），持久化列见 [storage.md](storage.md) §3.3：

| 字段（内存/列） | 说明 |
| --- | --- |
| `enabled` / `enable_epoch` | 总开关；每次 `enable()` 递增纪元（`+1`），未启用时 `getCurrentEpoch()` 对外恒为 0 |
| `initial_seconds` | 重置基准值（0–`MAX_OVERTIME_SECONDS`，见 §4.1） |
| `remaining_ms` / `anchor_at_ms` | 锚点时刻的剩余毫秒与锚点墙钟（Unix ms） |
| `status` | 仅 `paused \| running \| finished`；**对外快照**在未启用时派生为 `'disabled'` |
| `background_path` / `background_fit` | 内置背景与适配模式（§5） |
| `revision` | **单调递增修订号**，每次 `commit` / 礼物结算 / 归零恢复时 `+1`，客户端据此丢弃旧增量 |
| `updated_at` | ISO 时间，用于审计 |

各字段读写见 [normalizeState:407-420](../../../src/overtime/overtime-service.js#L407-L420)、[saveState](../../../src/storage/overtime-store.js)、[getSnapshot:37-50](../../../src/overtime/overtime-service.js#L37-L50)。

### 2.2 状态转移（先经 `materialize()` 折算剩余时间再写锚点）

手动状态与背景变更先在候选副本上折算当前剩余时间、修改字段并递增 `revision`；只有 `saveState` 落库成功后，才替换内存中的活跃状态与单调时钟锚点，再重排归零定时器并广播更新。禁用操作须等待 `saveStateAndIgnorePending` 的状态与 `pending` 事务整体提交后才生效。保存失败时继续抛错，保留上次已提交状态及原有归零/重试定时器，运行中的倒计时照常流逝，同一手动操作可重新提交；保存成功后的通知异常不回滚已提交状态。

| 操作 | 语义 | 出处 |
| --- | --- | --- |
| `enable` | 置 `enabled`、`epoch+1`、`status='paused'`（**启用后保持暂停，须手动开始**）；已启用则 no-op | [overtime-service.js:85-93](../../../src/overtime/overtime-service.js#L85-L93) |
| `disable` | 折算剩余时间后置 `disabled`、`status='paused'`，`saveStateAndIgnorePending` 将全部 `pending` 置为 `ignored` | [95-102](../../../src/overtime/overtime-service.js#L95-L102)、[overtime-store.js](../../../src/storage/overtime-store.js) |
| `start` | 未启用抛错（`overtime must be enabled before start.`）；`remainingMs > 0` → `running`，否则保持 `finished` | [104-111](../../../src/overtime/overtime-service.js#L104-L111) |
| `pause` | `remainingMs <= 0` 时归 `finished`，否则 `paused`（时间冻结） | [113-119](../../../src/overtime/overtime-service.js#L113-L119) |
| `reset` | `remainingMs = initialSeconds * 1000`，归零时 `finished`，否则 `paused` | [121-127](../../../src/overtime/overtime-service.js#L121-L127) |
| `setTime` | 写入 `remainingSeconds` 后强制 `paused`（归零时 `finished`）；`initialSeconds` 仅改重置基准 | [64-74](../../../src/overtime/overtime-service.js#L64-L74) |
| 礼物结算联动 | `remainingMs` 归零 → `finished`；剩余时间实际增加且原为 `finished` → 自动恢复 `running`（§3.3） | [overtime-settlement.js](../../../src/overtime/overtime-settlement.js) |

**清空全部后的状态重载**：运行期执行“清空全部数据”成功后，`domain-services.data.clearAll()` 调用内部 `overtime.reloadState()` 重新读取已提交状态，并同步单调时钟锚点、归零与补偿定时器，防止后续暂停或礼物操作写回清空前的时间（存储失败或部分提交失败时不执行重载）。禁用默认行随 `giftDb` 事务提交，保留已有 `enable_epoch` 供下次启用递增；同一事务将保留来源的 `pending` 置为 `ignored`，保留其礼物历史与 `applied` / `ignored` 终态，防止清空前的 `final` 进入新一轮。已有单例的 `revision` 在同一事务内递增而不归零，确保现有浏览器源连接能正常接受清空后的快照及后续更新，同时继续拒绝清空前迟到的 HTTP 响应；仅当单例行缺失时才从 `epoch=0`、`revision=0` 新建。清库期间的静默与部分失败策略见 [storage.md §6.3](storage.md#63-并发写入静默quiesce)；该操作不新增 HTTP/IPC 接口。

### 2.3 权威倒计时（ADR-0002）

见 [ADR-0002](../../architecture/adr/0002-server-authoritative-timing.md)，实现要点：

- **有效剩余时间**：`effectiveRemainingMs = max(0, remaining_ms - (now_ms - anchor_at_ms))`，仅 `running` 状态按流逝扣减；`paused` / `finished` 恒返回折算后的静态值（[getEffectiveRemainingMs:290-294](../../../src/overtime/overtime-service.js#L290-L294)）。
- **运行中单调时钟**：进程内流逝使用 `performance.now()`（单调递增，不受 NTP 或手工校时影响，见 [server-core.md](server-core.md) 的 Node 运行时假设）；每次开始、暂停、调整或结算先经 `materialize()` 折算剩余时间到候选状态，持久化成功后再更新活跃状态与单调锚点。**墙钟仅用于持久化与跨重启恢复**。
- **重启恢复**：正常退出时，运行中的计时器把单调时钟算出的剩余时间与退出时的墙钟锚点一起保存。启动时若持久状态为 `running`，从最近锚点扣减停机流逝 `offlineElapsedMs = max(0, now - anchor_at_ms)`，归零则置 `finished` 并 `revision+1`，随后重建归零定时器（[recoverPersistedClock](../../../src/overtime/overtime-service.js#L268-L288)）。系统时钟回拨时停机流逝按 0 计。大幅前跳按墙钟扣减。
- **上限**：`MAX_OVERTIME_MS` 由 `MAX_OVERTIME_SECONDS`（§4.1）换算；[overtime-effects.js](../../../src/overtime/overtime-effects.js) 的 `clampMs` 负责双向钳制。

### 2.4 归零定时器与 revision

- 进入 `running` 或正向调整后安排**单个**归零定时器；剩余超过 24 小时时按 `MAX_TIMER_CHUNK_MS = 24h` 分段重排，不每秒写库（[overtime-service.js:15](../../../src/overtime/overtime-service.js#L15)、[355-378](../../../src/overtime/overtime-service.js#L355-L378)）；定时器调用 `unref()` 不阻止进程退出。
- 触发时：折算归零 → 置 `finished` → `commit('finished')`（`revision+1` + 持久化 + 广播）。
- `commit(reason)`（[304-313](../../../src/overtime/overtime-service.js#L304-L313)）统一收口：`revision+1` → `saveState`（或 `saveStateAndIgnorePending`）→ 重建归零定时器 → `onUpdate({reason, state: getSnapshot()})` → [server.js:148-153](../../../src/server.js#L148-L153) 广播 `overtime:update`（见 §6 与 [ws.md](ws.md) §3.2）。

## 3. 礼物结算管线（ADR-0003）

### 3.1 结算键与生命周期

- 一个 `gift_events.id` 对应一条服务器礼物事件（同一上游连击可产生迟到补差分段），也是唯一结算键：`overtime_settlements.gift_event_id UNIQUE`（[schema.js:344-347](../../../src/storage/schema.js#L344-L347)）。`quantityMode='group'` 时该事件执行一次规则；`quantityMode='item'` 时按该事件封账数量 `num` 执行对应次数。
- 结算行状态：`pending → applied | ignored`（CHECK 约束）；`applied` / `ignored` 为终态，同一事件的重复包或迟到包不再修改已有结算（`isComplete`，[overtime-store.js](../../../src/storage/overtime-store.js)）；新的补差事件使用独立结算键。
- **服务器收尾**：带连击标识的礼物在服务器侧等待 6 秒静默收尾，无连击标识的礼物立即封账（详见 [bilibili/gift.md](bilibili/gift.md) §2 及 [LIRA Server ADR-0107](https://github.com/AuroraWhisperer/LIRA-server/blob/d125d93c52190d377973dfaecfae8388b6c17b92/docs/architecture/decisions/0107-six-second-gift-combo-continuations.md)）。客户端收到服务器 `final` 后由加班机立即结算，不再叠加第二道静默窗口。
- **资格冻结**：`gift_events.overtime_epoch` 在该服务器事件首次导入本地（`progress` 或 `final`）时写入当时的 `enable_epoch`（未启用为 0），后续同事件不再更改；新的补差事件独立冻结资格（[projection-service.js](../../../src/bilibili/gift/projection-service.js)）。加班机仅在 `enabled=1 且 overtime_epoch === enable_epoch` 时处理事件（`isEligible`，[overtime-store.js](../../../src/storage/overtime-store.js)）——关闭期间首次导入的事件，即使重新启用后才封账也不补投、不回放。

同一启用轮次内，已收到但尚未结算的礼物继续保留资格；切换账号、直播间或 active source 不会自动结束本轮，也不取消旧来源的待结算工作。收到 `final` 或补偿恢复后，符合本轮资格的礼物仍结算到本地同一个计时器。`disable` 或“清空全部数据”会结束本轮并忽略保留的 `pending`；再次 `enable` 递增纪元，旧轮礼物不再补算。普通启停不清零已累计时间，恢复初始时间仍由独立的 `reset` 完成；清空全部则恢复禁用且剩余时间为零的状态。该约定仅针对本轮已接收礼物，不改变历史同步的消费者资格或终态幂等规则。

### 3.2 observeGift / settleFinal 返回语义

| 返回 kind | 含义 | 处理 |
| --- | --- | --- |
| `complete` | 该组已有 `applied` / `ignored` 结算 | no-op（幂等） |
| `missing` | `gift_events` 无该 id | no-op |
| `ineligible` | `enabled` / `epoch` 不匹配 | 若已存在 `pending` 则置为 `ignored` |
| `pending` | 已确保/刷新 `pending` 行 | `progress` 阶段到此为止，不改时间 |
| `ignored` | `final` 但无启用规则 | 占用唯一结算键，不广播 |
| `applied` | 结算完成，携带新状态与 `adjustment` | 更新内存、重建定时器、广播 |

关闭状态下服务直接跳过礼物。启用时，progress 用 `observeGift` 登记待结算行，final 用 `settleFinal` 在同一次 `BEGIN IMMEDIATE` 中补齐待结算行并作幂等结算。首次结算回滚后再建立重试记录，恢复流程也能按轮次追赶尚无记录的终态礼物。[overtime-store.js](../../../src/storage/overtime-store.js)

### 3.3 结算事务与时间变化

| 阶段 | 行为 | 出处 |
| --- | --- | --- |
| pending 幂等 upsert | `ensurePending`：`INSERT … ON CONFLICT(gift_event_id) DO UPDATE … WHERE status='pending'`，仅刷新快照字段（`quantity` / `total_price` / 事件时间） | [overtime-store.js](../../../src/storage/overtime-store.js) |
| final 结算 | `settleFinal` 同一事务内：复验 `enabled` / `epoch` → 幂等确保 `pending` → 确认 `detection_status='final'` → 查 `enabled=1` 规则（无规则 → `ignored`）→ `resolve` 计算时间变化 → `saveState` + `pending` 行置 `applied`（写全量快照字段） | [overtime-store.js](../../../src/storage/overtime-store.js) |
| 时间变化 | 按规则的 `quantityMode` 计算执行次数：连击组模式为 1，具体数量模式为 `num`；固定操作顺序重复，随机模式每次独立抽取。剩余毫秒经 `clampMs` **双向钳制**（负数归零、超上限截断）；实际变化 `appliedDeltaSeconds = trunc((afterMs - beforeMs) / 1000)` 可为负数 | [overtime-settlement.js](../../../src/overtime/overtime-settlement.js)、[overtime-effects.js](../../../src/overtime/overtime-effects.js) |
| 状态联动 | `afterMs === 0` → `finished`；`afterMs > beforeMs` 且当前 `finished` → 自动恢复 `running` | [overtime-settlement.js](../../../src/overtime/overtime-settlement.js) |
| 审计快照 | `rule_snapshot_json`：`{version:2, giftIdentity, mode, quantityMode, fixedEffect\|null, outcomes[], ruleUpdatedAt}`，display 模式另含 `displayText`；盲盒结果 `outcomes_json` 单次为 version 2、多次为 version 3（§4.3）；`rule_mode` = `fixed/random/display/ignored` | [overtime-settlement.js](../../../src/overtime/overtime-settlement.js) |
| 广播 | 仅 `kind === 'applied'` 调用 `onUpdate({reason:'gift', state, adjustment})`；`ignored` 不递增 revision、不广播、不播动效 | [overtime-service.js:178-188](../../../src/overtime/overtime-service.js#L178-L188) |

`adjustment` 载荷由 `resolveGiftSettlement` 构造，经 `overtime:update` 的 `adjustment` 字段下发（见 [ws.md](ws.md) §3.2）；`quantity` 为封账数量，`applicationCount` 为实际规则执行次数。示例（固定规则 `+300s` 的 `x100` 连击，按具体数量模式）：

```json
{
  "giftEventId": 42,
  "giftId": "35521",
  "giftName": "心动时刻",
  "quantity": 100,
  "totalPrice": 10,
  "imagePath": "/overtime-gift-images/35521.webp",
  "mode": "fixed",
  "quantityMode": "item",
  "applicationCount": 100,
  "requestedDeltaSeconds": 30000,
  "appliedDeltaSeconds": 30000,
  "resultSeconds": 30000,
  "result": null
}
```

盲盒模式时 `result` 为持久化的抽取对象（§4.3），叠加层仅播放 `resultSeconds`。settlement 行镜像同一快照：`quantity`、`total_price`、`event_created_at`、`event_updated_at` 均为封账瞬间值（[overtime-store.js](../../../src/storage/overtime-store.js)）。

### 3.4 失败重试与补偿扫描

| 机制 | 行为 | 出处 |
| --- | --- | --- |
| 结算事务失败 | 事务回滚，行保持 `pending`；`recordFailure` 递增 `retry_count`、写 `settle_after_ms = now + delay`，延迟按指数退避 `min(30, 2^(retryCount-1))` 秒（**1、2、4、8、16、30、30…**）；`last_error` 仅存单行错误摘要（≤500 字符） | [overtime-store.js](../../../src/storage/overtime-store.js) |
| 重试调度 | `scheduleRecovery` 使用单一定时器（可 `unref`）到点执行 `recoverSettlements`，保留较早的已排任务；空闲时按 `getNextPendingAt` 仅从 `final` 礼物的 `pending` 结算取最近到期时间。检查点或失败退避无法持久化时终止当前续扫并等候 1 秒，即使 `pending` 已记录到期也不提前触发；正常新礼物结算不受阻。未封账的 `progress` 不参与重试调度 | [overtime-service.js](../../../src/overtime/overtime-service.js)、[overtime-store.js](../../../src/storage/overtime-store.js) |
| 补偿扫描 | 服务构造时与每次重试：扫描 `detection_status='final' AND overtime_epoch=当前epoch AND (无 settlement 或 pending 到期)` 的组补投，按主键 `id ASC`、单批 ≤100。连续成功的满批按上一批末尾 ID 立即续扫；不足一批或结算失败时结束本轮，保留失败退避并从头核对遗漏 `final` 与到期 `pending`。暂停恢复、重新载入状态或停用时清除本轮游标 | [overtime-store.js](../../../src/storage/overtime-store.js)、[overtime-service.js](../../../src/overtime/overtime-service.js) |
| 投影消费者重投 | `final` 分发失败时由投影服务按指数退避重发（详见 [bilibili/gift.md](bilibili/gift.md) §2），直至无失败项 | [projection-service.js](../../../src/bilibili/gift/projection-service.js) |

两个补偿器（统计消费者用 `gift_stats_delivered`，加班机用 settlement 行）互不干扰，任意投递均幂等；加班机补偿仅对纪元匹配的组生效，不回放历史事件（[ADR-0006](../../architecture/adr/0006-shared-gift-detection-core.md)）。

## 4. 规则与时间盲盒

规则表 `overtime_gift_rules`（主键为 `(gift_id, gift_identity_key)`，并保存对应身份 JSON）由 `POST /api/overtime/rules` **整表原子替换**；`replaceRulesAndState` 在单个 `BEGIN IMMEDIATE` 事务内执行 DELETE、批量 INSERT 并保存递增后的机器 `revision`。全部提交后才切换内存状态并通知订阅方，失败时保留旧规则、`revision` 及通知状态。读取按 `sort_order, gift_id` 排序（[overtime-store.js](../../../src/storage/overtime-store.js)），快照 `rules` 字段返回**全部**规则（含停用）。

### 4.1 校验常量

| 常量 | 值 | 出处 |
| --- | --- | --- |
| `MAX_OVERTIME_SECONDS` | **315,328,464,000**（9,999 年） | [overtime-contract.js:4](../../../src/overtime/overtime-contract.js#L4) |
| `MAX_EFFECT_FACTOR` | **1,000** | [overtime-contract.js:5](../../../src/overtime/overtime-contract.js#L5) |
| `MAX_RANDOM_WEIGHT` | **100,000** | [overtime-contract.js:6](../../../src/overtime/overtime-contract.js#L6) |
| `MAX_ENABLED_RULES` | **8** | [overtime-contract.js:7](../../../src/overtime/overtime-contract.js#L7) |

### 4.2 规则形态

| 模式 | 字段 | 校验 |
| --- | --- | --- |
| `fixed` | `fixedEffect: {operation, value}`；`operation` ∈ `add` / `subtract` / `multiply` / `divide` / `clear`；`add` / `subtract` 的 `value` ∈ 0–`MAX_OVERTIME_SECONDS`；`multiply` / `divide` 的 `value` ∈ 2–`MAX_EFFECT_FACTOR` | [overtime-contract.js:119-143](../../../src/overtime/overtime-contract.js#L119-L143) |
| `random`（时间盲盒） | `outcomes[2..10]`，每项 `{operation, value, weight}`；`weight` ∈ 1–`MAX_RANDOM_WEIGHT`，总权重 ≤ `MAX_RANDOM_WEIGHT` | [overtime-contract.js:91-107](../../../src/overtime/overtime-contract.js#L91-L107) |
| `display`（文字展板） | `displayText` 为 1–6 个 Unicode 字符（`MAX_DISPLAY_TEXT_LENGTH=6`）且无控制字符；结算记录保持幂等，前后剩余时间不变 | [overtime-contract.js:75-86](../../../src/overtime/overtime-contract.js#L75-L86) |
| 公共 | `giftId` 必填（≤100 字符），与 `giftIdentity.variantId` 组合唯一；`giftName` ≤100；`imagePath` 默认须为站内路径（§5），桌面远程目录允许组合根配置 origin 下的 `/gift-media/images/<basename>` URL；`quantityMode` ∈ `group` / `item`；`enabled` 默认 `true`；`sortOrder` 为整数；启用规则数 ≤ `MAX_ENABLED_RULES` | [overtime-contract.js:59-108](../../../src/overtime/overtime-contract.js#L59-L108) |

### 4.3 存储形态与带权抽取

- 规则存储：`mode='fixed'` 写入 version 2 effect；`random` 写入 version 2 outcomes；`display` 写入 `{ "version": 3, "quantityMode": "group", "displayText": "…" }`（[overtime-store.js](../../../src/storage/overtime-store.js)）。
- 结算行审计：单次随机结果保存 `{version:2, selectedIndex, selectedEffect:{operation, value}, totalWeight}`；多次执行保存 `{version:3, quantity, selectedIndexes, totalWeight}`，结合结算行的规则快照还原各项效果。客户端仅展示持久化结果，不自行重抽。
- `resolveGiftSettlement` 位于 [overtime-settlement.js](../../../src/overtime/overtime-settlement.js)：`fixed` 使用 `fixedEffect`，`random` 由内部 `selectRuleResult` 按权重抽取，随机源由 service 注入（生产默认 `node:crypto.randomInt`）；多次结果由 [overtime-effects.js](../../../src/overtime/overtime-effects.js) 的 `summarizeRandomOutcomes` 汇总。
- **随机结果按执行次数产生**：`group` 模式抽一次，`item` 模式按最终数量独立抽取；同一结算保存全部抽中索引。页面刷新、WS 重连和重复礼物包均不能重抽（结算行已 `complete`）。
- 每次随机结算只计算一次总权重；运行时保留首个完整结果以兼容单件 v2 格式，多件直接累积全部索引生成 v3 格式，不为每件重复构造完整结果对象。自动抽取次数受 `limits.maxRandomApplications` 约束，具体范围与超限 `pending` 规则见 [数量规格](../../../specs/overtime-rule-quantity-mode_design.md)。超限时暂不执行抽取、不提交倒计时也不写部分索引；完整付费礼物保留并沿用现有退避恢复。`getOverview()` 附带 `quantityLimitedCount`；失败记录写入后，通过 `overtime:update`（`reason: 'quantity-limit'`）广播待结算计数（不发送成功 `adjustment`，不递增 `revision`），界面在待结算数量旁实时提示，且该计数只统计仍处于 `pending` 的超限记录。

## 5. 配置校验

| 输入 | 校验规则 | 出处 |
| --- | --- | --- |
| 背景 `path` | 空字符串，或匹配 `/img/overtime-machine/<name>` 的内置图片路径 | [overtime-contract.js:30-41](../../../src/overtime/overtime-contract.js#L30-L41) |
| 背景 `fit` | `cover`（默认）`\| contain \| fill` | 同上 |
| 路径安全 | `isAllowedImagePath`：本地路径拒绝 `..`、反斜杠和协议头且限定于内置目录；新服务器目录规则仅保存 `/overtime-gift-images/<basename>`，并兼容组合根允许 origin 下既有 `/gift-media/images/<basename>` 绝对 URL；旧 `/img/bilibili-gifts/...` 仅在迁移时按完整礼物身份替换；均拒绝凭据、查询参数、hash 和第三方源 | [overtime-contract.js](../../../src/overtime/overtime-contract.js) |
| 时间输入 | `initialSeconds` / `remainingSeconds` 至少一项，取值 0–`MAX_OVERTIME_SECONDS` 整数 | [overtime-contract.js:9-22](../../../src/overtime/overtime-contract.js#L9-L22) |
| 动作 | `start \| pause \| reset \| enable \| disable` | [overtime-contract.js:22-28](../../../src/overtime/overtime-contract.js#L22-L28) |

服务端对时间、权重、路径、状态与 JSON 结构执行完整校验，不信任管理端 DOM 的 `min`/`max`。V1 不支持任意背景上传，仅使用内置资源（[ADR-0005](../../architecture/adr/0005-built-in-overtime-backgrounds.md)）；规则与时钟状态同库同域，清库时保留（[ADR-0004](../../architecture/adr/0004-reuse-monolith-and-gift-db.md)、[storage.md](storage.md) §6）。

## 6. 手动操作与发布

### 6.1 操作入口

全部经 `/api/overtime/*` 暴露（端点表见 [api.md](api.md) §11），服务语义：

| 操作 | 语义 | 出处 |
| --- | --- | --- |
| `getOverview()` | 快照 + `pendingCount` + 最近 20 条 `applied` / `ignored` 结算（`limit` 钳制 1–100） | [overtime-service.js:56-62](../../../src/overtime/overtime-service.js#L56-L62)、[overtime-store.js](../../../src/storage/overtime-store.js) |
| `setTime({initialSeconds?, remainingSeconds?})` | 改重置基准或当前时间；后者强制 `paused` | [overtime-service.js:64-74](../../../src/overtime/overtime-service.js#L64-L74) |
| `act({action})` | `start` / `pause` / `reset` / `enable` / `disable`（§2.2） | [76-83](../../../src/overtime/overtime-service.js#L76-L83) |
| `setBackground({path?, fit?})` | 背景配置，`commit('config')` | [129-136](../../../src/overtime/overtime-service.js#L129-L136) |
| `replaceRules({rules})` | 规则整表替换，`commit('rules')` | [138-144](../../../src/overtime/overtime-service.js#L138-L144) |

### 6.2 发布契约

状态变更经 `onUpdate`（[server.js:148-153](../../../src/server.js#L148-L153)）广播 `overtime:update`，`reason` 枚举（`gift` / `manual` / `config` / `rules` / `finished` / `quantity-limit`）完整定义见 [ws.md §3.2](ws.md#32-overtimeupdate-的-reason-枚举)。

快照侧：`state.overtime`（生产者 `domainServices.overtime.getSnapshot()`，见 [ws.md](ws.md) §2）与 `state.giftDetection`（`gifts.getStatus()`：`coreActive` / `consumers` / `pendingCount`，[projection-service.js](../../../src/bilibili/gift/projection-service.js)）在每次连接与业务变更时全量下发。

增量消息形态（`state` 含 `effectiveRemainingMs` / `serverNowMs` / `status` / `revision`，配置或规则变化时另带完整 `background` / `rules`）：

```json
{
  "type": "overtime:update",
  "reason": "gift",
  "state": {
    "effectiveRemainingMs": 9738000,
    "serverNowMs": 1786264800500,
    "status": "running",
    "revision": 43
  },
  "adjustment": {
    "giftEventId": 42,
    "giftId": "35521",
    "mode": "fixed",
    "requestedDeltaSeconds": 300,
    "appliedDeltaSeconds": 300,
    "resultSeconds": 300
  }
}
```

计时本身不每秒广播，仅在人工操作、礼物结算、配置变化、自然归零与连接建立时同步；客户端以 `serverNowMs` 抵消传输时延后用本地时钟插值，已连接状态下仅接受 `revision` 递增的增量，重连快照无条件接受。

本机场景输出在同一次响应内复用加班机快照，同时投影倒计时数据与公共背景外观，避免外观读取再次获取规则。下一次响应重新读取快照，`serverNowMs` 和剩余时间继续更新；用于复用的内部读取上下文不进入响应。

## 7. 故障行为速查（按实现）

| 故障场景 | 实际行为 | 详述 |
| --- | --- | --- |
| 暂停期间收到礼物 | `materialize()` 冻结当前值；结算后仍大于零保持 `paused`，归零置 `finished` | §2.2、§3.3 |
| 程序重启（运行中） | 按墙钟锚点扣减停机流逝，归零置 `finished`；补偿扫描恢复未完成结算 | §2.3、§3.4 |
| 系统时钟回拨 | 停机流逝按 `max(0, …)` 计 0，不反向加时；运行期走单调时钟不受影响 | §2.3 |
| 长时间倒计时 | 单一定时器按 24 小时分段重排，不每秒写库；归零触发 `commit('finished')` | §2.4 |
| 结算事务失败 | 事务回滚，行保持 `pending`；按 1–30s 指数退避自动重试，重启后继续 | §3.4 |
| 消费者首次投递失败 | 投影服务退避重发 `final` + 加班机补偿扫描双保险，仍恰好提交一次 | §3.4 |
| 关闭/禁用期间 | `disable` 将 `pending` 全置 `ignored`；旧纪元组一律 `ineligible`，不补投不回放 | §2.2、§3.1 |
| 重复包 / 连击增长 | `progress` 刷新 `pending` 数量；`final` 进入终态后重复包不再修改 | §3.1、§3.3 |
| 无匹配规则 | `final` 结算置 `ignored`（占用唯一结算键），不改时间、不广播 | §3.2、§3.3 |
| 文字展板规则 | `final` 结算置 `applied` 并广播 `displayText`，前后剩余时间不变；叠加层仅更新结算账本，不播放加减时闪动 | §4.2 |
| 盲盒抽到 0 / 已归零仍减时 / 已达上限仍加时 | 正常写结算并广播 `adjustment`（实际变化为 0），保证可审计 | §3.3 |
| 清空礼物数据库 | `gift_events` 与 `overtime_settlements` 同事务清空，**保留** `overtime_machine_state` 与 `overtime_gift_rules` | [storage.md](storage.md) §6 |

## 8. 参考

- 表 DDL 与迁移：[storage.md](storage.md) §3.3、§4（`giftDb` v5 插入单例行）
- HTTP 端点：[api.md](api.md) §11（校验常量见 §4.1）
- WebSocket 契约：[ws.md](ws.md) §2（`overtime` / `giftDetection` 快照字段）、§3.2（`overtime:update` reason 枚举）
- 礼物投影服务与消费注册表：[bilibili/gift.md](bilibili/gift.md)
- ADR：[0002-server-authoritative-timing](../../architecture/adr/0002-server-authoritative-timing.md)、[0003-settle-once-per-gift-group](../../architecture/adr/0003-settle-once-per-gift-group.md)、[0004-reuse-monolith-and-gift-db](../../architecture/adr/0004-reuse-monolith-and-gift-db.md)、[0005-built-in-overtime-backgrounds](../../architecture/adr/0005-built-in-overtime-backgrounds.md)、[0006-shared-gift-detection-core](../../architecture/adr/0006-shared-gift-detection-core.md)
