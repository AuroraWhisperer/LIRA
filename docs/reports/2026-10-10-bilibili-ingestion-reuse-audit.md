# Bilibili 信息获取、事件捕捉与脚本复用审查

日期：2026-10-10。状态：调查与建议，未实施业务改动，不作为已接受规格。

后续：已确认问题的修复与验证见[修复记录](../../specs/plans/archive/2026-10-10-bilibili-ingestion-fixes.md)；候选信息及用途见[精简简报](2026-10-10-bilibili-information-opportunities.md)。下文保留审查时的事实与判断。

基线是两个工作区当时的实际文件：客户端 `D:/Work/Live`（HEAD `eeedb144`），服务器 `D:/Work/lira-server`（HEAD `8995b126`）。两边均有既存未提交修改，结论不是对纯 HEAD 的认证。下文 `C:`、`S:` 分别表示两个仓库根目录，路径后用函数名定位实现。

范围包括 HTTP、直播 WebSocket、Protobuf、用户资料、榜单/粉丝牌/舰队、礼物目录与活动素材、动态/视频抽奖、登录辅助及采样/同步脚本。证据来自代码、相关契约、74 项现有测试、合成数据离线复现及官方开放平台文档。未运行真实账号采样、读取用户凭据/业务数据库或测量生产性能。

## 结论

有明确的复用空间，而且部分重复实现已经发生行为漂移。优先修复采样和解析损失，再收拢纯协议能力、请求协调和诊断机制；增加新事件应排在这些基础工作之后。

最值得先做的工作：

1. 修复客户端全事件采样丢掉 `DANMU_MSG.info`，补容量限制与丢弃原因统计。
2. 共用带字段类型约束的礼物 V2 解码规则。合成昵称 `Hi` 在客户端被误解析，服务器正确。
3. 明确区分 SC 新增与平台下线。目前两端前缀判断会把删除命令送入新增分支；线上命令覆盖仍需样本确认。
4. 服务器一包只解码一次，复用资料/房间快照；客户端 WBI 补齐服务器已有的并发合并与失效刷新。

值得扩展的输入包括关注/分享、点赞、直播状态变化、SC 下线，以及已有包中尚未完整利用的回复对象、房管、荣耀等级和勋章显示字段。“代码没处理”与“已证实线上漏包”应明确区分。

## 1. 当前信息获取与脚本地图

| 采集面 | 已有信息与用途 | 所有者及边界 |
| --- | --- | --- |
| 客户端直播长连 | 弹幕、SC、礼物身份线索，供点歌、AI、游戏等消费 | `C:src/bilibili/danmaku-client.js`、`danmaku/api-client.js`、`danmaku/websocket-connection.js`、`danmaku/message-handlers.js`；网页 Cookie 协议 |
| 服务器直播长连 | 礼物/V2/连击/大航海、SC、进场 V1/V2、进场特效、PK，驱动账本、粉丝事实、欢迎及机器人 | `S:src/modules/bilibili/room-monitor.js`、礼物解析器、`S:src/lib/bilibili-entry.js`、`bilibili-pk.js`；按 streamer 隔离 |
| 房间与账号资料 | 短房号、主播 UID、标题/分区/直播状态、头像/昵称、账号验证及 WBI 材料 | 两端 API、profile provider/cache、room profile；涉及 room_init、getInfoByRoom、Master/info、nav、用户 card |
| 在线榜、粉丝牌、舰队 | 榜内用户、粉丝牌、舰队身份/陪伴资料 | 客户端 online-rank/fans-medal poller、guard-roster；服务器 overlay-viewers、pk-report-snapshot、guard 模块；不是完整在线名单 |
| 礼物目录与在售 | 当前房间在售礼物、全局定义、特效、规则与公开说明 | `C:src/bilibili/gift/sale-catalog.js`、`hybrid-catalog.js`；`S:src/modules/gifts/bilibili-source.js`、`gift-public-metadata.js`；公开目录与私有事件分开 |
| 活动页与参考资料 | WidgetBannerList、活动脚本/页面配置、规则、图片，HalfInit/GetRewardConfigData/GetDocContent 等 | `S:src/modules/gifts/gift-activity-source.js`、`gift-reference-source.js`；远程脚本只作文本解析、不执行 |
| 第三方盲盒参考 | gift.shuvi.moe 的礼物/盲盒映射与素材线索 | 必须保留来源与匹配证据，不能当成 Bilibili 权威上游 |
| 图片与特效 | Bilibili/hdslb 头像、礼物图片、特效、活动素材 | 客户端 remote-gift-image-cache、服务器目录/素材同步；公开资源可共享缓存，不夹带账号会话 |
| 动态/视频抽奖 | 内容详情、点赞/转发观察结果、评论、关注关系检查 | `C:src/bilibili/dynamic-lottery/provider.js`、`provider-parsers.js`、`reaction-parser.js`、`request-scheduler.js`；独立账号 scope、验证及持久请求预算 |
| 登录辅助 | 桌面会话、账号验证、兼容扫码登录 | Electron 登录/抽奖分区；服务器 credential-service、qr-login；不合并凭据库或跨账号验证缓存 |

动态抽奖的点赞/转发是“观察到参与”的证据，`occurredAtMs` 可为 `null`，不能据此补出可靠历史发生时间。部分 provider 能力仍标为 `UNTESTED_ADAPTER`，`C:specs/plans/2026-09-14-bilibili-dynamic-lottery.md` 仍保留真实账号验收事项。

| 脚本 | 实际职责 | 复用判断 |
| --- | --- | --- |
| `C:scripts/capture-bilibili-events.js` | 复用客户端 API/WS/解包器，默认 300 秒 NDJSON 采样，可只采礼物 | 连接关闭即结束，是有限诊断工具；全事件结构存在 F1 缺口 |
| `C:scripts/bilibili-capture-electron/index.js` | 在正常桌面授权上下文中调用同一个 main 后退出 | 已共享主逻辑，无需另造抓包器 |
| `S:scripts/capture-test1-gifts.cjs`、`scripts/lib/test1-gift-capture.js` | 指定 test1 上下文、检查凭据代次、独立 WS；不启动业务机器人、不写账本 | 复用有界写入/匿名化；保留账号限制，不直接泛化为任意租户入口 |
| `S:scripts/lib/gift-capture-sample.js` | 保留字段路径/类型及公开礼物金额等，敏感值用进程随机 HMAC 匿名映射 | 是通用诊断的基础，目前仅针对礼物，不能代替全协议回放样本 |
| `C:scripts/refresh-bilibili-gift-sale.js` | 调用现有在售服务 | 已共享业务实现 |
| `C:scripts/initialize-gift-catalog.js` | 从 LIRA Server 取目录并预热图片 | 不是另一套直接抓 B 站的全局爬虫 |
| `S:scripts/sync-gift-catalog.js`、`sync-gift-assets.js` | 调用同一礼物目录 runtime | 已共享；重点是源数据质量与请求预算 |
| `S:scripts/build-blind-box-game.cjs` | 根据审阅过的导出下载素材、生成小游戏 fixture | 开发素材构建，不是直播采集。客户端 verify-gift-* 等合成 QA 也应与生产捕捉区分 |

## 2. 已确认的问题与兼容风险

### F1：全事件采样丢掉普通弹幕正文与身份

`C:scripts/capture-bilibili-events.js` 的 `shouldCaptureMessage` 在全事件模式接受 DANMU_MSG，但 `buildCaptureRecord` 仅保留 cmd、data、接收时间。普通弹幕核心字段位于顶层 info，其他顶层协议字段也无法保留。

离线输入 `{cmd:'DANMU_MSG', info:[..., 'synthetic message', [42,'Hi']]}` 被接受，输出却为 `infoRetained=false`。“抓到了命令”并不等于留下可重放、可研究的内容。

建议在采样 owner 保留事件结构后按路径脱敏，补格式版本、命令、连接代次和解码结果。默认限制时长、事件数、总字节、排队字节，达到限制明确停止或计数。客户端现有 Promise 链会等待 stream drain，但没有全局排队字节上限，慢盘仍可积压对象；服务器已有总量 16 MiB、排队 1 MiB 等限制可借用。

`parseErrorCount` 只统计抛出异常；解包器对部分非法长度/超限返回空结果，不能用“零错误”证明采集无损。应区分无业务事件、未知命令、解码失败、超限丢弃、写入丢弃。

### F2：客户端礼物 V2 Protobuf 解码已落后于服务器

`C:src/bilibili/protocols/protobuf-decoder.js` 的 `decodeBilibiliProtoFields` 将长度限定字段先猜为嵌套消息；`users/gift-identity-hints.js` 再从 root field 2 读昵称。服务器 `S:src/modules/bilibili/gift-parser-utils.js` 已用 `GIFT_V2_STRING_FIELDS` 明确哪些字段是字符串。

合法合成字节 `08 2a 12 02 48 69` 表示 UID 42、昵称 Hi。Hi 的字节碰巧也能解析成嵌套 varint：客户端得到空昵称，身份投影降为“观众”；服务器正确得到 Hi。这证明了解码差异，未统计线上受影响人数。

建议共用底层解码/类型规则及同一组合成或脱敏 fixture，客户端仅投影身份。服务器 `gift-v2-parser.js` 已读 field 3 头像，本地 V2 身份却固定 `avatarUrl:''`，也可复用。保留服务器礼物结算权威，不把金额、盲盒估值与账本逻辑复制回客户端。

### F3：SC 平台下线缺少独立分支

`C:src/bilibili/danmaku/message-handlers.js` 与 `S:src/modules/bilibili/room-monitor.js` 均用 `startsWith('SUPER_CHAT_MESSAGE')` 进入新增处理。合成 `SUPER_CHAT_MESSAGE_DELETE`、`data:{ids:[123]}` 确实触发客户端新增 callback，结果为空 ID、空正文、0 元。

客户端 `superchat-service.js` 的金额阈值会挡住这个空记录，不能声称必然产生空 SC；真正缺口是没有使原 SC 下线。服务器 `S:src/modules/history/event-store.js` 的 `recordSuperChat` 没有下线分支和同样的金额阈值，存在插入空事件的风险，本轮未写库验证。

建议明确新增/下线命令及已知后缀，按平台 ID 更新显示状态。内容下线不等于退款，不能删财务历史。官方开放平台用 LIVE_OPEN_PLATFORM_SUPER_CHAT_DEL/message_ids，网页协议须单独适配。本轮没有证明当前网页长连实际下发过上述删除样本。

### F4：客户端 WBI 缺少并发合并与失效重签

`C:src/bilibili/wbi-signer.js` 有 10 分钟成功缓存，没有在途 Promise。mock 网络后并发调用两次 `getBilibiliWbiMixinKey`，产生两次 nav 请求。`danmaku/api-client.js` 也没有服务器数值 -352 后刷新重签的策略。

`S:src/modules/bilibili/api.js` 的 `getWbiKey`、`requestWbiJson` 已有公开签名材料的并发合并、缓存、一次失效重试，以及避免旧失败使新缓存失效的处理。可以复用机制和纯算法；账号 Cookie、抽奖验证缓存及其 scope/epoch 继续独立。本轮只证明请求冗余，未测连接成功率或延迟提升。

### F5：尚未接通的官方开放平台适配器存在盲盒误判

`S:src/modules/bilibili/gift-parser.js` 的 `extractBilibiliOpenLiveGiftMessage` 对 blind_gift 或 combo_gift 整体做 Boolean 转换。合成 `blind_gift:{status:false}` 仍得到 `isBlindBox:true`，连击也不应自动等于盲盒。

这是未来启用该适配器前应修的问题。当前主要是网页 Cookie 长连，未发现完整的官方应用启动等生命周期；不能描述为当前普通网页礼物普遍结算错误。正式接入时还需区分数字 UID 与 open_id 命名空间，不能将 open_id 塞入只接受数字 UID 的资料服务。

## 3. 最适合复用的模块边界

| 能力 | 现有依据 | 最小复用方式与收益 |
| --- | --- | --- |
| 礼物 V2、弹幕身份等纯解析 | F2；服务器 lib/bilibili-danmaku.js 的身份字段更完整 | 共用字段规则、纯函数、fixture，各业务独立投影；减少修复只落一端与已收数据浪费 |
| 舰队列表与陪伴 | 客户端 src/shared/bilibili-guard-roster.js、bilibili-guard-accompany.js 与服务器 src/lib 同名文件字节相同 | 明确单一源、版本/哈希同步；不必先建独立 npm 包 |
| WBI 算法与 key 协调 | F4，服务器已有刷新策略 | 共用纯签名规则，运行时持有缓存/在途请求；减少重复 nav 与失败处理差异 |
| HTTP 小原语 | 客户端 shared/response-body 已限体积；服务器 api.js 有超时/signal，requestJson 直接 response.json | 共用超时、体积、释放 body、错误分类；保留公开/账号/素材的策略差异 |
| 帧解码和命令分类 | 两端 packet decoder/codec 各有协议及边界处理 | 先共享合同样本与语义，再收拢兼容实现；不可为统一而降低限制 |
| 采样、覆盖统计、回放 | 客户端能采全命令，服务器有匿名化/有界写入 | 共用格式、脱敏、容量预算与解码结果；授权留在入口，样本可供两端对照 |
| 房间快照及请求合并 | monitor 已持有 roomInfo；room-profile、观众榜、PK 查询仍可能重复 room_init/getRoomInfo | 按房间、凭据代次、来源和所需新鲜度复用，减少同时重复取资料；不能让 PK 对手复用本房数据 |

`C:scripts/sync-danmaku-source.cjs` 和 `src/shared/danmaku-source-manifest.json` 已有服务器源码受控同步先例，可逐项沿用并增加行为样本门禁。现有 verify-server-contract 校验服务器合同 fixture，并不等于这些纯模块自动同步。

不合并不同责任：Electron 授权与服务器凭据存储、本地消费与服务器账本、抽奖持久预算与实时请求、账号资料与当前房间身份、Bilibili 来源与第三方参考。弹幕发送属于外部写操作，不能套用读取接口的自动重试。

## 4. 重复计算与轮询效率

服务器 `room-monitor.js` 有三个“一包解码一次”的具体机会：

- fanFacts.recordPacket 经 `fan-fact-parser.js` 解析 INTERACT_WORD_V2，后续进场分支又调用 parseBilibiliEntry。
- extractBilibiliGiftMessages 已解码礼物 V2，giftInteraction.begin 经 `gift-notification-evidence.js` 再解同一个 pb。
- 多礼物输出时，包级大航海身份/荣耀等级提取仍放在逐礼物循环里。

可在包入口保留一次不可变解码结果，供粉丝事实、结算、欢迎分别投影，保持错误隔离/顺序，不引入新进程、worker 或通用事件框架。

还有可避免的 rawJson：V2 parser 已做到每原包只序列化一次，多输出共用，现有测试锁定此行为；但正式路径 `gift-detector-input.js` 丢弃该字段，`storage/gift-detection-store.js` 的 raw_json 写空串。可保持 parser 兼容契约，让正式运行路径按需生成诊断原包。不能说现有礼物账本已存完整包、可直接回放。上述开销确实存在，收益尚无 CPU/内存实测数字。

| 机制 | 当前频率/边界 | 建议 |
| --- | --- | --- |
| 客户端 history-poller | 默认 2.5 秒；停播、掉线或 alwaysHistory 时启用，直播且长连健康时停 | 启用时理论 24 请求/分钟，只补命令，不补全部弹幕或礼物；按需求/健康状况调度，保留补偿职责 |
| online-rank-poller | 约每 60 秒，最多 3 页、50 人/页 | 最多 150 个榜内用户，复用同轮结果，不当全量在线名单 |
| fans-medal-poller | 约每 5 分钟一轮，30 人/页，分批请求，已有失败退避 | 若 3,000 人且每 5 分钟完整扫一次，理论 100 页/轮、1,200 请求/小时；实际受耗时/退避影响。优先共享结果、标记新鲜度、按需求扫描 |
| 客户端 live-status-monitor | 未开播时约每 10 分钟检查 | 不是全天高频 loop；若加状态事件，可触发一次 REST 确认并保留兜底 |
| 服务器房间采样 | 默认约 60 秒、配置最小 30 秒，保存 online/live status 等 | 保留已接受的可靠性机制；验证 LIVE/PREPARING 后用于加速，不取消持续监听 |
| 服务器礼物目录 | 已有刷新并发合并、固定时段调度、失败保留旧快照 | 无需再建常驻爬虫，复用缓存与手动同步入口 |

服务器 `profile-cache.js` 已按 streamer/room/credentialKey 合并请求，有成功 5 分钟、失败 30 秒缓存与容量上限。客户端 `users/user-info-service.js` 已有 UID 在途合并、成功/失败缓存、房间代次、资料证据合并。应延伸这些 owner，避免第三套观众缓存。

## 5. 值得补充的信息与用途

“未使用”指已检视分发/投影没有处理或保留，不等于当前上游保证推送。网页协议候选命令需要先做有限样本验证。

| 信息 | 当前缺口/已有基础 | 可用场景与限制 |
| --- | --- | --- |
| 关注、分享 | 服务器 lib/bilibili-entry.js 仅 msg_type=1 作为进场，其他类型不进入现有粉丝事实，测试明确覆盖此边界 | 新关注欢迎、分享互动、趋势；属于新增能力。一次关注不能证明永久关注，不能替代抽奖关系查验 |
| 点赞 | 两端主分发无 LIKE_INFO_* | 点赞目标、氛围效果、分钟聚合；先确认网页样本。官方 LIKE 开播才触发，按单用户 2 秒聚合，不等于逐点击推送 |
| 开播/停播、标题/分区 | 主要依赖 REST，缺 LIVE/PREPARING、ROOM_CHANGE 等候选分支 | 更快划分场次/刷新组件；事件触发 REST 核对，保留兜底 |
| SC 下线、展示期限 | F3；已有 SC 颜色/头像显示 | 及时下线卡片，展示期限更新；网页与官方命令分别适配，不等于退款 |
| 回复对象、房管、荣耀等级、完整勋章 | 服务器 lib/bilibili-danmaku.js 已有部分提取，本地资料字段更窄，medal 主要留名称/等级/目标 UID | 回复提示、身份样式、勋章颜色/点亮；优先复用包内字段，不增加逐用户 HTTP，注意勋章归属与当前房间身份 |
| 观看、粉丝变化指标 | 已有 room.online/心跳 popularity，无 WATCHED_CHANGE、ROOM_REAL_TIME_MESSAGE_UPDATE 等候选处理 | 场次趋势、转化分析；保留来源与语义，不把人气、看过、贡献榜人数统称实时在线 |
| PK 比分与结局 | 当前已取阶段、ID、对手，已有相遇记录 | 比分组件、胜负回顾；扩展现有 parser，不能说完全未采 PK，完整率待验证 |
| 平台警告/切断等状态 | 无 WARNING/CUT_OFF 等候选独立分支 | 异常解释与提醒；确认会话可见性，不凭命令名推断处罚原因 |
| 未知命令、丢弃原因、断线窗口 | 本地已有命令计数/最近记录，服务端缺完整对应覆盖统计 | 应优先补的诊断数据；计数、首末时间、字段路径变化、有界样本即可，无需默认永久存全部正文 |

不承诺完整观众名单、精确停留时长、完整退出事件或断线期间全部礼物。官方进场存在动态限流，也没有可靠完整离场清单的保证，不能据此计算全量在线/离开时间。客户端 SSE/cursor 能追赶服务器已提交的最终事件，补不了服务器从未收到的上游包；心跳在线也不能证明礼物无漏。

依据：[Bilibili 直播开放平台长连消息文档](https://open-live.bilibili.com/document/f9ce25be-312e-1f4a-85fd-fef21f1637f8)，2026-10-10 通过浏览器读取。官方还规定普通 uid 已废弃固定为 0，应使用 open_id，union_id 需另行申请。这些规则属于官方开放平台，不能直接替换网页 Cookie 协议。完整接入还涉及应用配置与权限，参见[官方接入说明](https://open-live.bilibili.com/document/849b924b-b421-8586-3e5e-765a72ec3840)。

## 6. 已具备的能力与应保留边界

- **礼物服务器权威。** 客户端原始礼物主要补身份，再消费服务器最终事件；gift/projection-service、consumer-registry 已有投影/消费边界，不应重新建独立本地账本。
- **统一观众资料入口。** UserInfoService 已处理来源/新鲜度和 profile/房间身份边界，见 [ADR 0010](../architecture/adr/0010-bilibili-user-info-facade.md)。
- **公开礼物资料已很丰富。** gift-public-metadata 已投影描述、权益、规则、数量映射、类型/特效、停留时间、发送限制、活动来源，不是只采名字和价格。
- **原始数据留存各有职责。** SC 有原包 JSON，公开目录留上游元数据；礼物事件正式落库 raw 为空，普通弹幕只在内存也是既有要求。诊断采样不应悄悄变成永久聊天库。
- **账号/租户隔离。** streamer scope、凭据代次、抽奖独立分区和请求预算继续保留；共享实现机制，不共享不同主体的授权结果。

## 7. 建议顺序与验收证据

以下仅为审查建议，未创建活动实施计划，也未将候选功能改为接受需求。

| 顺序 | 范围 | 验收证据 |
| --- | --- | --- |
| 1：修复信息损失 | F1 采样字段/容量、F2 字符串/身份头像、SC 命令分类 | 弹幕样本保留正文/身份；Hi 等字符串两端一致；慢写入不无限积压；新增/下线不误路由 |
| 2：共用纯能力 | 舰队/陪伴模块、V2 规则、WBI 与共同 fixture | 单一来源和同步校验；两端输出一致；并发只取一次 key，失效只重试一次且不跨凭据 |
| 3：减少重复工作 | 一包一次解码、按需 raw 序列化、房间请求合并 | 输出顺序/去重/账本结果不变；调用计数证明重复减少；账号切换正确失效 |
| 4：按需加信息 | 未知命令统计，然后关注/点赞/状态/回复等 | 有当前协议样本、字段语义、覆盖限制和真实消费者，避免只存不用 |
| 独立后续方向 | 官方开放平台完整 adapter | 应用会话/权限、身份 namespace、盲盒 status 与连击、SC_DEL 合同验收后再接生产 |

## 8. 验证与同步结果

本轮仅添加报告、导航和仓库 tmp 中的离线探针，未改业务代码、持久格式、凭据、采集范围或运行中的应用。

Node.js v24.21.0 下，9 个现有测试文件共 74 项通过：

```text
# 客户端：36 项
node --test --test-reporter=dot test/bilibili/capture-bilibili-events.test.js test/bilibili/bilibili-gift-identity-hints.test.js test/bilibili/bilibili-wbi-signer.test.js test/bilibili/packet-decoder.test.js test/bilibili/bilibili-user-info-pollers.test.js

# 服务器：38 项
node --require ./test/support/test-mode.cjs --test --test-reporter=dot test/packet-codec.test.js test/bilibili-gift-parser.test.js test/bilibili-entry.test.js test/gift-capture-sample.test.js

# 合成输入、mock fetch，无直播或数据库访问
node tmp/bilibili-audit-2026-10-10/audit-probes.cjs
```

探针核对 F1、F2、F3 的客户端路由、F4、F5 和两份舰队/陪伴模块字节一致。现有测试通过不否定这些发现，这些边界正是当前覆盖不足处；纯审查未将探针加入正式测试套件。

执行 `npm run verify:docs`：10 项中 9 项通过，当前及历史文档链接检查通过；唯一失败为并行工作新增的 `specs/plans/2026-10-10-communication-remediation.md` 状态格式不符合活动计划门禁（该文件使用“状态：In Progress”，测试要求可识别的 Status 标记）。未修改该无关计划。另检查本次报告内容、导航差异与最终工作区状态。

技术契约、现有测试预期与用户指南无需改写，因为产品行为没有变化；实施建议时应与对应 owner 文档/测试同步。

限制：未做生产负载、真实账号完整性或网页新事件覆盖率实测；本地 Node 版本也不构成服务器声明的部署引擎范围验收。请求量是代码频率推算，性能收益不是实测百分比。
