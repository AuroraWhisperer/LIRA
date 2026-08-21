# ADR-0010: 为 Bilibili 用户信息引入后端门面

## Status

Accepted

## Context

LIRA 当前在 Bilibili 弹幕、SC、历史消息、在线榜、粉丝牌轮询和游戏头像查询之间重复读取用户信息。`IdentityCache` 既承担字段合并，又承担最近用户和在线快照；部分轮询器和游戏路径直接访问它或 `BilibiliApiClient.fetchUserProfile()`。`BilibiliDanmakuClient` 还把 `onMessage() === true` 当作头像请求触发信号，导致业务返回值隐式决定网络副作用。

现有实现和测试还要求：当前房间身份必须与主播 UID 绑定；未提供字段不能清空缓存；只有已验证的当前房间缺失状态才能清除旧的别家身份；头像只能经可信 Bilibili URL 校验和本地代理返回。一次性重写解析器或缓存会扩大回归面，也不符合 LIRA 的模块化单体和兼容性约束。

## Decision

采用增量式 `UserInfoService` 门面，先作为 Bilibili domain 内的统一入口，再由 runtime 通过窄 facade/port 注入跨域消费者。

- Parser/extractor 只产生 `IdentityHint` 和消息 payload，不访问 cache、网络或业务通知；领域内部可以组合统一的 `BilibiliMessageEvent`，但对外仍由 compatibility adapter 产生现有消息、HTTP、WebSocket 和前端事件形状。poller 可以请求自己负责的 history/online-rank/fans-rank endpoint，但只能通过注入 sink 提交 hint，不访问 cache、不调用 profile provider 或 Avatar Proxy。
- `UserInfoService` 负责 `peek`、`ingestHint`、`ensure`、`listRecent`、`listOnline`、online snapshot 更新、订阅通知和房间作用域生命周期，并公开 `setRoom()`、`beginRoomRun()`、幂等的 `endRoomRun()` 与 `dispose()` 生命周期入口。
- `UserInfoService` 是唯一 merge policy owner；`IdentityCache` 在迁移期只能作为 storage/index compatibility primitive 保存 service 已合并的最终状态。遗留入口可以暂时保留签名，但只能委托 service 或执行 exact projection，不得再次决定字段优先级、freshness、verified absence 或 evidence，也不得被新生产者/消费者绕过 service 访问。
- `name`/`avatarUrl` 作为 UID 全局 profile；guard/fans medal 作为 `{roomId, ownerUid}` 房间身份。generation 和 room runToken 只用于内部 scope、异步写入资格和诊断，不进入 `UserInfoSnapshot`。用户资料不缓存弹幕文字、SC 内容、SC 金额或礼物数量；消息 payload 与统一 user snapshot 分开。
- 对 room identity 使用 unknown/verified absence 三态；非空粉丝牌必须保存并校验 `targetUid`，不能只保存 `roomId`；verified absence 不伪造 `targetUid`。
- `peek`、`listRecent`、`listOnline` 和 `subscribe` 支持 `fields` 投影：`uid` 永远返回，允许请求的字段只有 `name`、`avatarUrl`、`guard` 和 `fansMedal`；未传 fields 的 subscribe 等同于完整四字段投影，uid 不计入 changedFields。非数组、非字符串元素、未知字段，以及 `ensure` 请求 room field 都抛出 `TypeError`，重复字段去重。投影不泄露 `updatedAt`、evidence、source 或生命周期 token。显式 `roomId` 是严格 stale-context guard：非当前 room 时 `peek/ensure` 返回 `null`、`list*` 返回 `[]`、`subscribe` 返回 no-op unsubscribe 且不通知，`ensure` 不发 provider 请求；匹配 room 发起的 `ensure` 还捕获当前 generation，A→B→A 后旧 caller 固定收到 `null`，但 profile 结果仍可合入全局状态。
- merge 规则按字段定义：name 先质量再 freshness，avatar 先合法性再 freshness，source 只作同时间或同质量冲突的 tie-break；room field 的 message authority 为 `danmaku/superchat/gift = 30`，并固定按 verification → 未过期 source authority → freshness 合并，verified absence 使用同一 comparator。`observedAt` 统一表示 service 接受 hint 的时间；History poller 必须串行拉取，同一批稳定排序为 old → new 后再 ingest，不能让旧记录获得更新的 observation time。
- room generation 只在 `{roomId, ownerUid}` 改变时递增。`setRoom()` 清除旧 room identity 后，未绑定特定 roomId 的通用 subscription 立即收到受影响 UID 的新 scope room projection invalidation；显式 room subscription 已先失效且不收事件。`beginRoomRun()` 要求已有 room scope，并在每次调用时失效旧 run、清空 online snapshot、签发新 token；组合根在整个 room runtime 的一次启动或协调重连中只调用一次，History/OnlineRank/FansMedal 等所有 poller 共用其 context。协调重连顺序为 `end(old) → begin() → start all`。单个 poller 重启复用现有 context，不调用 begin/end，并用自己的 local generation/abort 在每次 await 后及 sink 前阻止 stop 后回写。room-scoped `ingestHint()` 和 `replaceOnlineSnapshot()` 必须同时匹配 room pair、generation 和 runToken；失效 context 的混合 hint 连同 name/avatar 整条拒绝，只有 context-free profile source/provider 结果仍只检查 lifecycle token。
- profile 查询按 provider/entity（`profile:${uid}`）做 in-flight 合并；失败采用短期负缓存。
- 第一阶段只在内存中缓存，保持现有 10 分钟 TTL；不新增持久化、HTTP、IPC 或 preload 契约。
- 业务需要头像时显式调用 `ensure()`；迁移完成后移除 `onMessage() === true` 和 `resolveDanmakuAvatar()` 的隐式路径。
- Avatar Proxy 继续独立负责 URL 校验和图片代理，不参与身份合并。

详细数据模型、merge comparator、迁移阶段和验收条件见 [Bilibili 用户信息模块化设计](../../../specs/bilibili-user-info-service_design.md)。本 ADR 与规格均已接受，但不授权改变其中明确保持兼容的 HTTP、WebSocket、IPC、数据库、preload 或前端事件契约。

## Consequences

### Positive

- 用户信息合并规则集中，完整昵称、当前房间粉丝牌和头像来源可以用字段级测试锁定。
- Poller、游戏和 renderer 不再知道 `IdentityCache` 或 Bilibili profile API 的内部实现。
- profile 请求去重、room generation 屏障和 room runtime 级共享 runToken 降低网络重复、旧房间串写、同房重连旧请求回写和多 poller 互相失效的风险。
- 现有 HTTP、WebSocket、IPC、数据库和头像代理契约可以继续兼容。

### Negative

- 迁移期会存在 service、旧 cache API 和兼容适配器并存的阶段。
- 迁移期必须阻止旧 `IdentityCache` 再执行字段合并；适配层需要明确区分“已合并状态写入”和遗留 merge API。
- 组合根需要显式注入 user-info facade 和 poller sink，装配参数会略有增加。
- `UserInfoSnapshot` 的 known/verified 语义、字段投影和订阅 `changedFields` 需要新增 focused tests，不能只依赖旧字段断言。

### Neutral

- 不新增进程、端口、数据库、第三方依赖或 Electron 权限。
- 历史身份和持久化 avatar 不在本 ADR 范围内，未来需要单独决策。

## Alternatives Considered

### 直接重写 `IdentityCache` 和所有 parser

拒绝。会同时改变协议解析、缓存合并、轮询生命周期和事件契约，回归面过大；门面可以先保护边界，再逐步移动实现。

### 让每个消费者直接调用 `BilibiliApiClient`

拒绝。会重复请求、泄漏认证/供应商细节，并违反跨 domain 使用显式 facade/port 的模块化规则。

### 把用户资料持久化到 SQLite

拒绝。当前需求是统一读取和短期复用，不需要 schema、迁移、头像陈旧清理或隐私保留策略。

### 为 renderer 新增 UserInfoService IPC

拒绝。现有 HTTP/WS 事件已能承载兼容数据，新增 preload 面积没有当前阶段的边界收益。

### 为每个 poller 分配独立 runToken

拒绝作为第一阶段方案。当前需要隔离的是整个 room runtime 协调重连前后的旧写入；独立 token 会增加 context、装配和组合判断。单个 poller 重启复用共享 room runToken，并继续使用 poller 自己的 generation/abort 状态阻止 stop 后回写；若未来出现必须让单个 poller 跨重启保留并发请求的实际需求，再另立决策扩展为 poller-specific token。

## Security and Failure Boundaries

- 资料请求沿用 Bilibili API client 的认证边界；快照和事件不包含 Cookie、Token 或完整上游响应。
- 头像只保存归一化后的可信 HTTPS URL，图片仍由 `/api/bilibili/avatar` 代理。
- provider 失败使用短期负缓存；订阅者异常不得阻止其他订阅者和缓存合并。
- 房间切换由 service 自有 generation 控制，所有 poller context 还必须携带同一次 `beginRoomRun()` 签发的共享 runToken；room-scoped 写入必须同时匹配 room pair、generation 和 runToken，因此 A→B→A 以及同房协调重连的旧结果都会被拒绝。profile 全局结果只检查 service lifecycle token，room identity 结果必须丢弃旧代写入；`endRoomRun()` 只在整组 producer 停止/协调重连时原子地失效旧 runToken 并清空 online snapshot，同房重连仍保留 TTL 内 room/recent 状态，直到新 poll 成功。整个 room runtime 停止时由组合根清理 poller timer、poller-local sink 和 room writes；service subscription 不因 end 自动销毁，显式 room subscription 已在 generation 切换时失效，通用 profile subscription 继续有效，直到 unsubscribe 或 dispose，后者才统一失效 service subscription 和全部异步写入资格。

## Rollback

实现阶段若 focused tests 或公共契约回归失败，保留旧 `IdentityCache` 和旧消息字段，通过关闭 service adapter 回退到现有路径；不得使用 broad reset 或删除共享数据。只有在所有直接消费者迁移并有测试证明后，才删除旧头像触发器和兼容入口。

## Acceptance Additions

- DANMU_MSG 与 SC 事件的内部 `user` 结构相同，消息文字、金额和礼物字段只在各自 payload 中出现；现有对外事件形状由 compatibility adapter 保持。
- 字段投影不会泄露 `updatedAt`、evidence、source 或生命周期 token；参数先校验再执行 stale guard，非法 field 输入或 `ensure` 请求 room field 抛出 `TypeError`，重复 field 去重。显式请求非当前 room 时，`peek/ensure → null`、`list* → []`、`subscribe → no-op/no event`，且不会触发 profile 请求；匹配 room 发起的 `ensure` 在 A→B→A 后向旧 caller 返回 `null`。显式 room 订阅在切房时先失效且不接收终止/清空事件，未传 roomId 的通用订阅在 `setRoom()` 后立即接收受影响 UID 的新 scope room projection invalidation；`changedFields` 只包含投影内字段。
- `UserInfoService` 是唯一 merge policy owner；room field 按 verification → 未过期 authority → freshness 的固定 comparator 合并，`gift` message authority 为 30，verified fans-medal absence 不要求虚构 `targetUid`。History poll 不重入、同一批按 old → new 排序，并在 ingest 前通过现有 deduplicator 拒绝跨批重复记录。未知 hint 属性被忽略，未知 source 记录诊断后抛出 `TypeError`。
- A→B→A 的旧 generation 结果以及同房协调重连的旧 runToken 结果都不会写入当前房间；失效 context 的混合 hint 整条拒绝。`beginRoomRun()` 无 scope 时失败且每次成功调用先清 online。所有 poller 共用一次 begin 的 token，单个 poller 重启不会使其他 poller 失效，并以本地 generation/abort 丢弃 stop 后结果。provider 失败的 30 秒负缓存会抑制重复请求，过期后允许重试。

## References

- [Bilibili 用户信息模块化设计](../../../specs/bilibili-user-info-service_design.md)
- [模块化与低耦合工程标准](../engineering/modularity-standard.md)
- [Bilibili 弹幕监听管线](../backend/bilibili/danmaku.md)
- [Bilibili 直播协议](../backend/bilibili/protocol.md)
