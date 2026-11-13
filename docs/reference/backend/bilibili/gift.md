# 礼物服务器投影与醒目留言服务

SC 行内删除提供 10 秒批次撤销：`superchat-undo.js` 保留服务端捕获的原记录，连续删除
合并并重置期限，恢复保留原 ID、顺序和“已处理”状态。平台撤回涉及批次时、清空、
身份/房间变化、保留清理或停机均使批次失效。批量清空仍须确认且不能撤销。
接口详见 [API 醒目留言域](../api.md#9-醒目留言域superchats)。

## 明细保留与历史汇总

服务器约 90 天、本机已接收明细约 365 天及长期统计由 [保留期规格](../../../../specs/gift-retention.md) 约束。
服务器原 B 站读取、识别、连击及估值不变；客户端保留原消费者和统计口径。
[gift-retention-queries.js](../../../../src/storage/gift-retention-queries.js) 将已结束日汇总与
未覆盖明细组成互斥集合，先合并完整分组再排名，不用汇总行数代替笔数。
历史接口只返回实际可用明细，并附本地期限、服务器恢复下界和覆盖证明；同 epoch
重建保留已有 91–365 天明细，跳过未收到的游标会撤销旧完整性证明。新设备或离线过久
不伪造一年明细；过期日期仍可查询金额、笔数及盲盒汇总。

本机冲刺和盲盒旧日归档只结转原有实时统计资格：回收前保存冲刺金额和按日、用户、盒型
归档，重置冲刺同时清结转；未完成加班结算或统计消费保留原行。历史导入不创建
实时副作用；离线前已接收的 progress 由既有 final 导入路径收尾，保持原资格。
盲盒逐笔列表不把汇总伪装成一条开盒记录。存储表和事务见 [storage.md](../storage.md)。

2026-09-13：main process 在远程 pull/history/SSE 协商 `X-Lira-Gift-Identity: 1`，验证成对可空 `giftVariantId`、`blindBoxVariantId`；旧 DTO 规范化为 null。首次导入写入事件身份列，后续不能把非空身份改成另一身份。旧历史只核对既有展示投影后幂等跳过，不补填身份或重放消费者。加班消费者仅匹配规则的完整身份；目录刷新不修改已结算记录。详见[礼物身份规格](../../../../specs/gift-identity-overtime.md)。

> 涉及文件:[gift/projection-service.js](../../../../src/bilibili/gift/projection-service.js)、[gift/consumer-registry.js](../../../../src/bilibili/gift/consumer-registry.js)、[gift/statistics-consumer.js](../../../../src/bilibili/gift/statistics-consumer.js)、[gift/normalizer.js](../../../../src/bilibili/gift/normalizer.js)、[gift/query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift/blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js)、[gift/blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js)、[gift/index.js](../../../../src/bilibili/gift/index.js)、[superchat-service.js](../../../../src/bilibili/superchat-service.js)、[domain-services.js](../../../../src/server/domain-services.js) 的 gifts/superChats 段

本文档是 **礼物服务器投影与醒目留言服务** 的客户端事实源:本地账本、消费者扇出、盲盒与冲刺统计、SC 状态机只在此成表。原始 B 站礼物解析与权威检测已迁移到 `D:/Work/lira-server`;本地只接收经服务器处理的 DTO 并投影到现有消费者。本地发送者身份读取见 [protocol.md](protocol.md) §6;`gift_events`/`super_chats` 表结构见 [storage.md](../storage.md) §3.3/§3.2;快照 `gifts/giftSprint/giftDetection/superChats` 字段见 [ws.md](../ws.md) §2;礼物与 SC 的 `/api/*` 端点清单见 [api.md](../api.md)。客户端投影与服务器协议详见 [server-authoritative-gift-detection_design.md](../../../../specs/server-authoritative-gift-detection_design.md)。

**目录内模块边界:** `gift/sale-catalog.js` 拥有缓存、刷新与服务门面，`gift/sale-catalog-parser.js` 只做目录响应的纯解析/归一化；`users/user-info-service.js` 拥有网络、缓存与失败策略，`users/user-info-evidence.js` 只做用户证据和风险字段归一化。解析模块不得持有服务生命周期或重复缓存。

`gift/effect-config.js` 的特效布局与失败 URL 缓存仅保留当前特效目录引用的地址。目录成功刷新时清理旧地址；旧请求晚到仍向原调用者返回结果，但不重新写入过期缓存。目录刷新失败时保留旧目录及其缓存，并沿用单飞与失败重试间隔。

远端目录的 `remote-catalog-cache.js` 独占刷新合并、ETag、停止代次及持久化后发布；`remote-catalog-contract.js` 校验响应封装、v2 礼物/盲盒关系并复用 v3 variant 契约；`remote-catalog-image-policy.js` 校验 B 站原图与配置服务器同源的不可变图片地址。缓存入口保留原具名导出以兼容既有消费者。

Schema 3 按服务器协议接收完整历史活动目录，不额外设置 10,000 条活动身份的拒绝门槛；仍逐项核对字段、身份摘要、总数、业务版本和奖池引用，合法全包才持久化后发布。超过该数量的合法目录须完整刷新、重启可读；非法大目录保留旧快照，不能截断活动或删除未被当前奖池引用的历史身份。验证：`test/gifts/gift-identity-catalog.test.js`。

`variant-room-catalog.js` 在一次合并中建立自定义盒子及产物的精确身份索引，复用 ID、名称与标价的匹配结果，避免每个产物分别扫描全目录。同一身份证据对应多个候选时仍不选择；房间顺序、已选 variant 去重和目录覆写规则保持原样。

## 1. 架构总览

### 礼物许愿

同一轮快照按时间窗批量读取 count/todayCount，复用 retention 快照；
`hybrid-catalog.getArtworkResolver` 按房间、全局目录修订及自定义盲盒配置内容复用礼物身份索引，
仅对本轮实际消费的礼物读取本地图片。图片 revision 只使已解析路径失效，不再重建整份目录；
下载完成立即更新，外部删除或损坏仍在一秒复查窗口后重新检查。房间同 key 条目保持优先，
完整目录 getter 仍返回副本并保留原有图片完整性检查。

`wish-service.js` 拥有三周期许愿；`wish-session.js` 按需读取 B 站 `room_init.live_time` / `live_status`，30 秒缓存并合并请求。直播间来自组合根的当前账号房间 getter。`gift-wish-store.js` 保存来源隔离的定义与最近直播窗口，按当前授权来源组合活动快照的最终流水、完整日汇总和非整日精确贡献。历史导入在快照激活后参与计数，不依赖实时通知资格；未激活下载不可见，互斥的统计集合避免重复累计。创建日及本场起止不以整日总量近似，正常明细回收不使已保留的进度倒退；存储与历史数据限制见[礼物保留存储](../storage.md#礼物保留存储)。

- 长效从每条许愿的服务端创建时间开始。本日从北京时间当天 00:00 起算，包含本日创建前流水。本场从确认的开播时间起算，重新连接和软件重启不会重置；下一场开始自动切换窗口。确认离线时本场归零并等待开播，不把再次打开页面的时间当成下播时间；上游不可用时暂停本场计数，冻结到最后确认仍在直播的时间，恢复后重新按窗口统计。直播状态最多延迟一个 30 秒缓存周期。
- 目标必须是正整数，实际数量只累计正整数 `num`，可以超过目标；进度条封顶 100%。修改目标/文案不重置创建时间，删除只删除许愿定义。计数反映当前账本，用户主动清除流水也会影响许愿。
- `todayCount` 按北京时间当日 00:00 至快照时间的同来源、同身份最终 active 流水统计，包含创建许愿前的当日礼物，与长效/本场目标进度独立；本日条目直接复用 count。文字版在 todayCount 大于零时切换为已收颜色，次日根据新日窗口恢复未收颜色，未达目标也会变色；两色可按每条许愿自定义，默认与预览规则见 [前端页面](../../frontend/pages.md)；卡片与徽章仍沿用目标完成状态。
- 目录复用加班机当前房间和全库缓存。新建普通礼物或盲盒许愿必须有已同步的 variant 身份；房间中尚未匹配身份的候选显示待同步且不可选，服务端也拒绝保存。完整 variant 身份精确匹配，未知历史身份不猜测；既有无 variant 的许愿仍按 ID 兼容。盲盒本体匹配 `blind_box_variant_id` / `blind_box_id`，产出匹配 `gift_variant_id` / `gift_id` 且要求 `is_blind_box=1`，一份产出事件可分别推动盒子与产出两条独立目标。
- 普通礼物使用已校验的 B 站原图本地缓存（包含 WebP 和部分 PNG），舰长/提督/总督使用内置 WebP。文字版在 `{图片}` 所在位置显示原图或由共享 renderer 取默认帧/首帧生成的静态 PNG；旧位置配置兼容规则见 [前端页面](../../frontend/pages.md)。转换只在页面内存缓存，不请求另一份远程素材，失败沿用占位图。overlay 只读投影不含内部来源或送礼人信息。验证见 `test/gifts/gift-wishes.test.js`、`test/gifts/gift-wish-routes.test.js` 与 `test/gifts/frontend-gift-wishes.test.js`。
- 静态 PNG 转换以 anonymous CORS 加载公开素材。`/overtime-gift-images/` 的合法图片 GET/HEAD 响应与 public 静态资源一样提供 `Access-Control-Allow-Origin: *`，不允许跨域凭据；overlay 保持 opaque-origin 沙盒，API 仍按原 scope 验权。

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
  ├─ query-service: getSnapshot/getHistory/getStatistics
  ├─ sprint-service: getSprintSnapshot/resetSprint（含聚合缓存）
  └─ blind-box-analysis: 盲盒统计与分析
```

全屏礼物感谢事件由 `src/bilibili/gift/frame-config.js` 作为 final 行之后的具名 Frame Adapter 负责：
林间花信由 `giftFrameEnabled` / `giftFrameThresholdRmb` 控制。Adapter 只读取 final 行权威 `total_price`，
按人民币元转换为整数分比较门槛，合格事件以稳定的 `gift-frame:<giftEventId>` ID 广播为 `gift:frame`，
`themeId` 为 `woodland-bloom`。Adapter 不使用 `unit_price * num` 重算，也不读取官方媒体映射；
开关关闭、非 final、零金额或不达阈值的行不广播。已撤销的缎带设置不参与触发。
导入样式触发在同一笔礼物内只解析一次 `giftFrameStyleTriggers`，各样式继续独立判断原有开关和金额门槛。候选读取使用样式库的媒体样式 ID 索引，不复制整份素材配置；文件变化与备份恢复检查仍由 [存储索引](../storage.md) 执行。
导入的全屏礼物感谢图片/视频样式各自判断：`buildGiftFrameStyleEvent` 按 `giftFrameStyleTriggers` 中每个样式 ID 的开关和含等号门槛筛选，同一笔礼物只生成一条 `gift-frame:<giftEventId>:imported`（`themeId: imported`，`styleIds` 列出达标样式），没有达标样式时不生成。候选样式 ID 由组合根从本机样式库读取（含已从可选库移除但场景可能仍引用的样式）；读取失败时不生成该事件，不影响林间花信和掉落/摇摇乐。该事件只发布到场景窗口，不广播到旧 `/gift-effects` WS 页面。
管理页预览通过 `/api/gifts/frame/preview` 使用独立的预览 ID，不污染实时去重集合。
事件的 `avatarUrl` 读取 final 行已知头像，复用 `gift/avatar-url.js` 的 HTTPS B 站 CDN 校验；
缺失或不合法时为空字符串，不额外查询观众。展示端通过既有头像代理加载并在黄色铭牌上方显示。

原生掉落与摇摇乐由 `gift/motion-config.js` 在同一 final 入口分别匹配 `giftDropEnabled/ThresholdRmb` 与 `giftSwingEnabled/ThresholdRmb`，使用权威 `total_price` 转整数分，包含门槛值；0 只放行正金额礼物，progress 与历史重放不触发。两款可同时生成，不参与林间花信的主题选择或队列。事件 ID 为 `gift-motion:<gift-drop|gift-swing>:<final行ID>`，复用原 `gift:frame` 本地 WS/场景交付与来源隔离；只增加展示字段 `startedAt/artworkPath/motion`。

`runtime-transport.publishGiftFlushed` 在入口先捕获同一个本机时刻，后续图片准备不移动该时刻。图片按 `gift_variant_id` 优先、否则稳定礼物 ID，复用 `hybrid-catalog.getArtworkResolver()` 的精确活动身份索引和本地图片完整性缓存；不按名字猜图，不整库枚举、不重新请求远程图片。无可用原图时沿用已有礼物/舰队占位。每款参数随事件冻结，后续改设置不改变已显示实例的截止时间。具体播放和容量见[礼物展示页](../../frontend/overlays.md#14-礼物四方边框gift-effects)。

大航海感谢由 `src/bilibili/gift/guard-thanks-config.js` 在同一 final 回调中生成：辉光和经典分别读取 `guardThanksAuroraEnabled/TextMode`、`guardThanksClassicEnabled/TextMode`；新键为空时按旧 `guardThanksEnabled/TextMode/Style` 兼容解析，仅旧选中的风格继承开关。先用 `guard-gift-aliases.js` 规范化礼物 ID（`guard-3/2/1` 及其别名）识别舰长/提督/总督，ID 无法识别时只接受完全等于「舰长」「提督」「总督」的礼物名。合格行为每个启用风格分别以稳定 ID `guard-thanks:<giftEventId>:<aurora|classic>` 广播 `gift:guard-thanks`，携带等级、昵称、月数（礼物 `num`）、通过 HTTPS hdslb 白名单的头像、该风格的 `style/textMode`，同时启用时按辉光、经典顺序入队，分别去重；不读取金额阈值，也不改变记账、统计或边框。管理页预览经 `/api/gifts/guard-thanks/preview` 使用独立预览 ID。资源型航海旗帜由同模块的 `buildNauticalGuardThanksEvent` 生成 `style=nautical`、ID 后缀 `:nautical` 的独立事件；启用与兼容读取见[设置存储契约](../storage.md)，消费范围见[资源型样式](../../frontend/overlays.md#资源型样式)。

装配点：`domainServices` 创建 `createGiftService`，注入 final 回调、加班消费者及 `getOvertimeEpoch`；`index.js` 注册礼物统计消费者并创建 `createGiftProjectionService`。原始检测、金额换算、连击定时器、盲盒匹配及旧记录修复实现已删除，没有本地检测模式或回退入口。本地 B 站连接通过独立的 `extractBilibiliGiftIdentity` 读取姓名、头像及舰队身份，不生成礼物记账事件。服务器事件经 `importProcessedGiftEvent` 进入投影器（见 §6.1）。

查询装配由 `domainServices` 一次性创建并注入 `queryStore`、`maintenanceStore`。
同一装配点创建 `projectionStore`、`statisticsStore`；`gift/index.js` 只组合领域服务与活动来源状态，不再接收数据库句柄或提供隐式存储构造。`createGiftProjectionService` 使用 `{ store, settings }`，`createGiftStatisticsConsumer` 使用 `{ store }`，查询函数直接消费查询端口。
`query-service.js`、`sprint-service.js` 与 `blind-box-analysis.js` 不访问数据库；来源仅表达
`{kind: 'local'}`、`{kind: 'source', sourceId}`、`{kind: 'unavailable'}`，由
`gift-query-store.js` 翻译成 SQL。切换中或无效来源继续返回空查询且不重置冲刺。
盲盒行筛选和排序由 query store 执行，领域层保留日期边界、聚合及展示投影。
`gift-maintenance-store.js` 的 `clearRecent({updatedAt})` 保留最近 3000 条本地
合格记录及 pending settlement 协调语义；不删除远端来源记录。
`gift/index.js` 保留领域函数导出，调用方须显式传入对应存储端口；数据库组装只存在于应用组合根。

## 2. 服务器结果投影（GiftProjectionService）

### 2.1 实时事件导入

`importProcessedEvent` 验证服务器 DTO 与本地授权 source，以 `source_id + lira-server:<eventId>` 查找已有投影。首次接收时冻结统计资格与加班 epoch；后续 `progress` 更新直接使用服务器字段，`final` 只完成一次落库和消费者分发。最终记录重复导入时校验内容一致，不重复触发统计、加班或边框。金额、数量、盲盒成本和盈亏均直接来自服务器，不进行本地推算。

同次导入的业务字段只保存一次：首次 final 复用插入值，已有 progress 收到 final 时只更新一次字段；定稿后统一读取最终行，不再读取未被消费的中间行。最终状态写入及提交后消费者分发仍由原有路径负责。

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

`projection-service.js` 接收窄 `store`，保留输入校验、progress/final 决策和重试生命周期。SQL 与表字段操作归 `storage/gift-projection-store.js`；`statistics-consumer.js` 委托 `storage/gift-statistics-store.js:deliverOnce` 在单个 `BEGIN IMMEDIATE` 事务内检查 final/资格/投递标记并更新统计标记。组合入口注入两个 store，gift 门面不再将旧数据库 context 隐式转换为存储适配器。投影调用仍可加入 gift-sync-store 的现有事务，消费者仍只在提交后扇出，不新增 schema 或改变 cursor 原子性。

[gift-sync-runtime.js](../../../../src/server/gift-sync-runtime.js) 以礼物数据库、历史导入和实时导入回调创建同步/保留存储，并拥有两者的应用生命周期。它保持历史、catch-up、旧协议提交与投影重建的现有端口；本地保留清理先裁剪明细，仅当本批没有删除明细时才清理旧快照，事务与投影 fence 仍归对应 storage 实现。

`importProcessedHistoryRecord` 独立导入服务器历史 final，校验 source 和重复记录一致性，并把历史行标为不参与本机冲刺累计/加班结算。历史导入不派发消费者或边框事件；可见历史明细仍参与盲盒汇总、排行与分析。`normalizeGiftRow` 仅整理数据库输出类型；原始礼物输入归一化、近期命令查重、连击合并及 `repairGiftV2Events` 均已删除。数据库 schema 和已有历史记录不因删除代码而被清空。

## 4. 盲盒：服务器结果与客户端展示

目录使用唯一 `giftCategory` 区分 `directGift`（直送礼物）、`blindBox`（盲盒）和 `blindBoxOutput`（盲盒产物），替换原目录 `isBlindBox`；奖池关系按完整活动身份关联。服务器按 REQ-GIFT-006 校验有效关系/活动身份后，可为上游漏标的产物补全事件 `isBlindBox`、来源 `blindBoxId`、名称、成本和盈亏。客户端导入这些权威字段，不根据目录自行改变账本。`public/js/admin/gifts/recent.js` 根据事件标记与冻结来源身份取对应盲盒图片；无身份的旧记录仅允许 ID、名称唯一匹配，资料不足或歧义时用占位图，特殊配色还须名称匹配；有限数字盈亏直接显示符号和盈利/亏损颜色，不依赖可空盒名，未知值显示“盈亏待确认”。心动盲盒单盒 15 元、棉花糖 9 元对应 -6 元，爱心抱枕 16 元对应 +1 元。共享奖品来源仍有歧义时成本/盈亏保留未知，旧记录不自动重算。当前远端流程见 §9。

目录显示与收礼判定分开：`public/js/shared/gift-catalog-roles.js` 直接将已校验的 `giftCategory` 显示为“直送礼物 / 盲盒 / 盲盒产物”，奖池关系只提供来源名称。main 校验三值枚举及关系一致性，并通过原有 API/WS 和原子缓存传递；类别参与目录业务摘要，不新增网络请求或数据库列。官方盲盒筛选使用 `giftCategory=blindBox` 且必须有核验奖池。生产两端同步升级、客户端重新安装，不增加旧类别回退。共享产物列出全部奖池；身份不符时不显示推测标签，旧请求不得恢复更新后已移除的奖池关系。

客户端直接保存服务器的盲盒 ID、名称、成本和盈亏，不按礼物名匹配盒子或重新计算价值。[blind-box-config.js](../../../../src/bilibili/gift/blind-box-config.js) 仅验证待同步的盲盒设置格式，实际收礼判定由服务器处理。

盲盒盈亏汇总、排行与分析读取 `final + is_blind_box=1 + blind_profit 非空` 的当前来源有效记录，包含客户端离线或安装前由服务器记录、随后同步的历史明细，不受本机实时消费者的 `gift_stats_eligible` 限制。有保留快照时沿用活动快照成员筛选，分批下载的历史在快照激活后才参与；无来源的旧本地记录仍要求原统计资格。统计按送礼时间归入本机当天，不按同步时间归日；分析支持显式日期范围，由 [blind-box-analysis.js](../../../../src/bilibili/gift/blind-box-analysis.js) 的 `prepareBlindBoxQuery` 校验日期并计算本机日期边界。日期默认值、范围校验、分页与返回字段统一见 [HTTP 契约](../api.md#10-礼物域gifts)。

当天统计在查询 owner 内按来源、本机当日始末时间戳及盲盒输入变更标记缓存，保留最多两个最近使用的盒名结果，使管理页全部盲盒与心动盲盒展示交替读取时互不驱逐。同连接的普通礼物、同步校验时间和投递标记不触发盲盒重算；本地旧来源、空结果仍可复用。盲盒历史导入、活动快照切换、查询输入修订、归档变化、清理、其他数据库连接提交、来源或连接替换、跨日及运行中切换时区导致日界变化时，旧结果失效；首次读取或已淘汰的盒名重新计算。事务内读取不进入缓存，避免回滚后的临时值泄漏。返回独立结果，展示消费者不会改写缓存。存储变更追踪见[查询优化](../storage.md#查询优化song-v7--gift-v12)。

分析入口另保留每个查询 context 最近一份分页响应，不保留完整历史行；缓存键包含上述盲盒变更标记、实际查询日期始末时间戳及规范化筛选、视图、排序和分页参数。查询未变的连续刷新复用结果，切换历史日期对应的时区边界时重新计算；无稳定标记时直接读取且不缓存。返回副本，调用方修改不会污染后续结果。

同一统计 owner 的内部 `getBlindBoxChangeToken` 复用上述来源、账本和日界标记，由礼物服务门面绑定来源切换代次，再供场景适配器核验投影缓存。没有稳定标记（如事务内或来源切换中）时返回 `null`，场景沿用完整读取；已确认的未变榜单可直接省略，条件响应见 [HTTP 契约](../api.md)。

`boxName=心动盲盒` 的统计另返回 `heartBoxProgress.openedSinceCastle`：按 `created_at`（含毫秒）及行 ID 顺序，累计今天最近一次开出浪漫城堡之后的心动盲盒数量，出堡行将计数归零，今天未出堡则为今日累计。仅接受心动盲盒 ID `32251`（旧行缺 ID 时沿用精确盒名），浪漫城堡按产物 ID `32132` 识别；直送礼物、其他盒型/日期/来源不参与。进度包含盈亏未知但已确认的有效开盒记录，盈亏汇总仍排除这些行。计算从账本恢复，不依赖展示端累加；其他 `boxName` 查询的 `heartBoxProgress` 为 `null`。

### 心动盲盒每周收集

`gift/heart-box-collection.js` 拥有固定每周任务：按北京时间每周六 00:00（含）至周五 00:00（不含）累计，周五继续返回刚结束一期的结果，下一周六切换新一期。查询当前授权来源的已定稿、有效、正整数数量的心动盲盒，包含开启功能之前本期已有的流水及开出城堡的盒子，出堡不重置。盒 ID `32251` 跨活动身份累计；旧行仅缺盒 ID 时回退精确盒名「心动盲盒」，其他 ID 即使同名也不参与。复用 `gift-wish-store.js` 的窗口聚合与保留汇总。

管理端可校准本期总数。`heart-box-collection-store.js` 保存「校准总数 − 保存时原始聚合」的差额，实际展示为 `max(0, 本期原始聚合 + 本期差额)`，后续定稿礼物继续累加，流水修正也参与重新聚合。每个来源只保存最近一次校准的周期与差额；重启后仍生效，周五继续保留，下一周六不再使用旧差额。校准不改写礼物流水、盈亏或其他统计。保存前同步校验编辑时来源 revision、周期起点及累计数量，防止新礼物、其他校准、来源切换或跨周被旧输入覆盖。持久化结构见[存储](../storage.md)，管理写入和只读权限见[礼物 API](../api.md#10-礼物域gifts)。

图片继续由目录 owner 的 `getArtworkResolver` 按需检查；活动身份 key 优先，稳定礼物 ID 仅在索引中唯一时可作别名，歧义不猜图，不在每次任务刷新时扫描或检查全库图片。缓存未就绪时任务仍可显示，组件以礼物盒 / 城堡线条图标承接缺图，不反复请求同一个失败地址。

固定解锁为 20 个 → 4 倍限开 1 个、40 个 → 4 倍限开 2 个、80 个 → 5 倍限开 1 个、120 个 → 5 倍限开 2 个。服务返回下一未解锁档的目标及差额，全部解锁后目标保持 120、差额 0，真实数量继续保留。倍率是任务奖励展示，不计算或写入 B 站概率，也不自动扣减已开城堡。来源不可用时返回 `GIFT_SOURCE_UNAVAILABLE`，同步未完成时标 `partial:true`。独立只读接口见 [礼物 API](../api.md#10-礼物域gifts)，展示与操作见 [心动收集组件](../../frontend/overlays.md#心动盲盒收集组件)。

## 5. 礼物冲刺与查询

礼物冲刺快照、重置和聚合缓存由 `sprint-service.js` 拥有，按来源和冲刺输入变更标记复用；队列等无关快照通知及空同步仅更新校验时间时不会重复求和。目标值与开关仍每次读取，计入冲刺的礼物金额、资格或来源改变，以及结转、重置、外部连接提交或来源切换使聚合失效；事务内读取不复用或发布缓存，避免回滚的临时结果进入后续快照。

最近礼物从当前来源的已发布明细读取，包括云端恢复的历史记录；沿用明细成员证明和本机保留期限，不以 `gift_stats_eligible` 作为展示条件。暂存历史在原子激活前不可见。恢复从 `BOOTSTRAPPING` 进入 `CATCHING_UP` 时，现有 `gift:source` 快照刷新首页，无需等待新礼物；前端通知跳过 `gift_stats_eligible=0` 的记录，历史资格仍不触发冲刺或加班消费者。旧本地来源继续保留原统计资格筛选。

### 流水筛选、选择快照与展示资料（2026-09-18）

`history-filters.js` 拥有北京时间日期边界、独立用户/礼物名称过滤与来源版本。`getGiftHistory` 在完整有效流水上先筛选再分页，支持 today 和起止日期；游标绑定筛选、排序、asOf 与 viewRevision。viewRevision 包含 source、持久化 projection generation 及进程内来源切换代次。排序保留勾选，筛选、清库/重建、换来源使选择失效。

礼物滚动的 `/api/gifts/history` 读取可选 `conditional=1`，响应增加 `contentRevision`；完成全部分页且每页版本一致后，下次首请求携带该值。未变化时返回 `unchanged:true`、空 `items`、空 `nextCursor` 与当前同步状态，复用上次完整记录；旧请求继续完整分页。版本覆盖真实礼物写入、外部数据库提交、来源/连接、筛选和可见时间边界，不能用只表示来源世代的 `viewRevision` 替代。跨页变更不确认版本，下一轮完整重读。

本机滚动源与场景读取还可在 `conditional=1`、`created_at asc` 下选择 `delta=1`。首次仍读全量，各行额外含 `sortTime/sortId`，保持数据库原始时间文本升序、同时间 ID 降序；之后只在有完整且一致的基础版本时请求增量。有效增量返回 `delta:true/items/removedEventIds/contentRevision`、空 `nextCursor` 和当前同步状态，不提供全量 `total/totalPages`；先移除变动身份，再按原顺序合入当前仍可见的记录，因此更正、迟到 final 和成员移除不会漏掉。只使用连接内最近 1000 次变更、最多 64 个已读版本，候选超过本次页大小、基础版本丢失、物理删除、身份变化、外部提交或保留快照切换时回到普通完整分页。普通历史表格和旧调用无需选择该扩展。

`gift-card-runtime.js` 对支持可选 `revision` 的远端 `gift-card-profiles` 做同样的完整分页确认；旧服务没有版本时继续全量读取。远端版本按租户、北京时间日、syncEpoch、账本变更及失效依据生成，与同一服务端连接的普通弹幕/进场写入无关；外部连接提交保守失效。资料未变时复用 UID/头像准备结果，只重试仍缺失的 UID；头像修复后本地 `contentRevision` 变化。本地 `/api/gifts/card-profiles` 可携带 `contentRevision`，未变时返回空 `items` 和 `unchanged:true`；同来源同日的失败回退仍标 `partial:true`。两份完整输入未变时滚动源与画布复用卡片分组，独立变化的送礼人资料仍触发更新。

远端报告 `incremental:true` 后，该 runtime 可携带已完整接受的 `afterRevision` 读取新增资料；`append:true` 才合入旧缓存，没有 append 则按完整页替换。追加分页始终使用同一基础版本，全部页的版本、日期、epoch 和模式一致后才提交；重复 eventId、版本/模式混页或分页失败保留已接受缓存并标 partial，不发布半轮结果，也不改写已返回的数组。日期、来源、reset 或 epoch 变化仍走失效隔离。服务端更正/删除旧记录、乱序终结或无法证明基线时回退全量；旧服务器不收到未协商参数，已协商服务器降级拒绝 afterRevision 时最多重试一次完整读取。完整 wire 契约由 lira-server 的 `docs/protocol/client-server-api.md` 和 Device OpenAPI 维护。

`getGiftSelection` 用同一存储读事务冻结最多 10000 条当前来源记录，不合并同用户同礼物；显式 eventIds 必须全部仍在当前筛选中。一次请求可选择全部筛选结果，partial 仍明确标示仅已同步记录。导出 runtime 冻结选择、展示设置和本地素材目录，后续新礼物不进入已有任务。

`X-Lira-Gift-Display: 1` 与活动身份协商独立，用于远端 history/pull/SSE 的可选 `gift.display` 版本 1。严格 DTO 校验只接受 HTTPS hdslb 头像及 0–3/null 等级，旧服务器缺字段继续兼容。v11 迁移添加可空 avatar_url/guard_level；未知旧数据不按昵称补齐，不改变原金额与统计。历史重放不调用业务消费者。横幅按单价整数分乘数量分色，设置持久化为本地 `giftDisplayConfig`，不进入云端 scope。

2026-09-20 头像恢复：`server/gift-card-runtime.js` 每次读取今日卡片资料时，先复用同一来源、同一日、同 UID 的已知头像；仍缺失的头像经注入的 `bilibiliRuntime.getUserAvatar` 调用 `UserInfoService.ensure` 向 B 站补查。最多四个并发查询，卡片读取最多等四秒；慢请求在用户资料缓存中完成，后续刷新复用结果。失败与空资料遵循用户服务的 30 秒负缓存，空记录不清除已知头像；迟到结果不能跨日期、来源或 runtime reset 发布。补查只生成展示投影，不改礼物账本、冻结事件、金额、等级或历史 DTO；未知 UID 和跨日历史不按昵称推测。滚动区每次刷新重试已失败的头像图片，已成功图片保持复用；PNG 图片准备为头像等待九秒，覆盖现有头像代理的八秒超时。

| 事实       | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 出处                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 开关/目标  | `enableGiftSprint`(默认 `'true'`)、`giftSprintTargetRmb`(默认 `'0'`,见 [storage.md](../storage.md) §7)                                                                                                                                                                                                                                                                                                                                                            | [settings-store.js:19-21](../../../../src/storage/settings-store.js#L19-L21)                                                     |
| 全屏礼物感谢   | `giftFrameEnabled`(默认 `'false'`)、`giftFrameThresholdRmb`(默认 `'20'`)；这两个键专属特效 1 · 林间花信，固定 8 秒，不再配置主题/动效。导入的图片/视频样式使用 `giftFrameStyleTriggers`(默认 `''`)，按样式 ID 各自保存开关与金额                                                                                                                                                                                                                                                                                                                         | [frame-config.js](../../../../src/bilibili/gift/frame-config.js)、[settings-store.js](../../../../src/storage/settings-store.js) |
| 大航海感谢 | `guardThanksAuroraEnabled/TextMode`、`guardThanksClassicEnabled/TextMode` 分别控制两套动画（默认空值继承旧配置，见 [存储契约](../storage.md)） | [guard-thanks-config.js](../../../../src/bilibili/gift/guard-thanks-config.js) |
| 水晶球价值 | `CRYSTAL_BALL_VALUE_RMB = 100`(RMB)                                                                                                                                                                                                                                                                                                                                                                                                                               | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js)                                                          |
| 冲刺快照   | `receivedRmb = SUM(total_price)`(final + 资格 + `counted_in_sprint=1`);`remainingRmb = max(0, target - received)`;**`remainingCrystalBalls = ceil(remaining / 100)`**                                                                                                                                                                                                                                                                                             | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js)                                               |
| 列表快照   | `getGiftSnapshot` 最近 **30** 条(final + 资格 + 付费,[query-service.js](../../../../src/bilibili/gift/query-service.js));`getGiftHistory` 解析当前授权 source，分页 limit ≤ **100**，以 allowlist `sortField: created_at/gift_name/price/remarks` + `sortDirection: asc/desc` 做复合 keyset 排序并返回 `total/totalPages`([query-service.js](../../../../src/bilibili/gift/query-service.js)、[gift-query-store.js](../../../../src/storage/gift-query-store.js)) | —                                                                                                                                |
| 重置       | `resetGiftSprintProgress` 按当前来源清零 `counted_in_sprint` 并清除对应冲刺结转；事务由 `gift-query-store.js` 持有                                                                                                                                                                                                                                                                                                                                                                                                                  | [sprint-service.js](../../../../src/bilibili/gift/sprint-service.js)                                                   |

`counted_in_sprint` 由 `giftStatistics` 消费者在 **final** 时落定(§2.3),因此冲刺统计天然只含已收尾事件。

## 6. 快照与端点

- WS 快照 `gifts`(礼物事件列表)/ `giftSprint`(冲刺状态,含 `crystalBallValueRmb`)/ `giftDetection`(`getStatus()` 的 `coreActive/pendingCount` 等)由本服务产出(见 [ws.md](../ws.md) §2);`superChats` 见 §7。
- 礼物/SC 的 `/api/*` 端点组(`gifts`、`superChat` 两组 context,见 [server.js:312-325](../../../../src/server.js#L312-L325))完整清单见 [api.md](../api.md),此处不复表。

## 6.1 服务器权威礼物与客户端投影

原始 B 站包的解析、平台身份去重、连击累计、盲盒价值覆盖和 6 秒静默收尾由 `D:/Work/lira-server` 的每主播 `RoomMonitor`/`gift-detector` 独占。该服务器把 final 行与 delivery cursor 在同一个 SQLite 事务中提交,再通过按 `streamerId` 分桶的内存 broker 加速在线设备投递;旧历史行保留但不会生成新的 delivery cursor。

Electron 只在 main process 使用授权 DeviceBearer 请求远端礼物接口。wire 校验和内部 canonical 对象由 [processed-gift-contract.js](../../../../src/shared/processed-gift-contract.js) 分层维护：`validateGiftDisplayWire` 先拒绝未知/缺失字段，再由 `canonicalizeGiftDisplay` 处理文本、时间、金额和内部派生值。

| 版本 / 协商 | gift 的严格字段集合 | 消费规则 |
| --- | --- | --- |
| 基础（无扩展） | `giftId,giftName,userName,num,unitPrice,totalPrice,coinType,isBlindBox,blindBoxId,blindBoxName,blindBoxPrice,blindProfit,createdAt` | 旧服务仍可接收；缺失身份 canonical 为 null，缺失 display 不猜测 |
| `X-Lira-Gift-Identity: 1` | 基础 + **同时出现** `giftVariantId,blindBoxVariantId` | 每项为 null 或 `gv_` 加64位小写十六进制；非盲盒的 blindBoxVariantId 必须 null |
| `X-Lira-Gift-Display: 1` | 基础 + `display` | display 必须完整对象，不能为 null；定义如下 |
| 两项独立能力同时协商 | 基础 + 两个身份字段 + display | 仍是封闭集合，不接受其他扩展字段 |

pull/history 与 SSE 的请求头统一由 [gift-protocol.js](../../../../src/electron/license/gift-protocol.js) 设置；SSE 另带 `X-Lira-Gift-Effects: 1`，仅协商特效事件，不扩大记账 DTO。活动身份的目录对应关系见本文开头；展示能力不依赖活动身份能力。

`display={version:1,avatarUrl,guardLevel}`：avatarUrl 为 null 或长度≤2048的 HTTPS hdslb.com/其子域 URL，无用户名、密码、非默认端口、query、fragment；guardLevel 为 null 或0/1/2/3。null 表示未知，0 表示已知无大航海等级。不能按昵称补齐身份；头像补查只更新展示投影（§5）。wire 不含 UID、roomId、streamerId、cmd、平台/连击 ID、raw JSON、Cookie、CSRF 或 token。

live 事件严格为 `{eventId,cursor,phase,gift}`；eventId 为1–64字符，首位字母/数字，后续仅字母/数字/点/下划线/冒号/连字符。progress.cursor 必须 null，final.cursor 为正安全整数；history record 严格为 `{eventId,gift}`，不伪造 live cursor。gift 的 num 为正安全整数，价格为数值（可空字段仅 blindBoxPrice/blindProfit），blindBoxId 为1–20位非零开头十进制字符串或 null。canonical 要求金额可表示为安全整数分（浮点容差1e-7），拒绝超过两位小数的有效精度，派生 `unitPriceCents,totalPriceCents,blindBoxPriceCents,blindProfitCents` 并规范时间；totalPrice 对应整数分必须大于0，0.001直接校验失败，不能舍入后入库。这些 Cents 字段仅供内部计算，不能再塞回 wire 白名单。

网络入口 `normalizeProcessedGiftHistoryPage` 严格校验 wire 后生成内部金额分字段；保留存储使用 `canonicalizeProcessedGiftHistoryPage` 校验该内部页的分页、游标及金额，再核对快照 fence 并事务写入。内部页不重复经过 wire 字段白名单；网络响应仍不能携带内部金额分字段。

客户端接收预算：pull/history 每个响应≤512 KiB，每页 events≤200；history page token≤4096字符，syncEpoch≤128字符。历史页还要求 historyBootstrapVersion=1、非负安全整数 recoveryCursor；hasMore=true 时必须有 nextPageToken，结束时必须 null。增量页只允许 final，cursor 严格递增，末条等于 nextCursor；版本页附 historyBootstrapVersion/syncEpoch/earliestCursor/latestCursor。以上是客户端验证条件，不外推服务器吞吐承诺；完整页字段集合见同一 contract 的 HISTORY_PAGE_KEYS/EVENT_PAGE_KEYS，异常整页拒绝。

具备历史能力的服务按 §9 执行 bootstrap 与来源分区恢复；无历史能力的旧服务仅在没有持久游标时建立 baseline，已有游标时保留并增量补齐离线 final，仍显式处于 `LEGACY_PARTIAL`。历史页及 final cursor 和本地礼物投影在同一事务提交。SSE 断线、进程崩溃或漏包后以 final cursor pull 恢复，progress 不补拉；当前幂等身份包含 source 与远端事件身份，重复 final 不重复统计、加班结算或 `gift:frame`。

本地 B 站连接仍负责弹幕、点歌、SC、用户信息和小游戏；礼物只保留身份提示解析，记账回调已移除。B 站上游 WebSocket/REST 断线发生在服务器收到事件之前时没有历史重放或零丢失保证。单进程 broker 不承诺多实例 fan-out,多实例部署需另行设计。

## 7. 醒目留言服务(superchat-service)

| 事实     | 值                                                                                            | 出处                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 置顶阈值 | `SUPER_CHAT_PIN_THRESHOLD = 2` RMB(协议层 `isPinned`,见 [protocol.md](protocol.md) §6.2)      | [superchat-service.js](../../../../src/bilibili/superchat-service.js)                                                                                      |
| 入库阈值 | `SUPER_CHAT_DISPLAY_THRESHOLD = 2` RMB,`price < 2` 直接拒绝                                   | [superchat-service.js](../../../../src/bilibili/superchat-service.js) 的 `addSuperChatItem` |
| 去重     | `platform_id` 属于当前显示项时返回既有行；已在 `super_chat_receipts` 时返回 null，不恢复内容 | [superchat-service.js](../../../../src/bilibili/superchat-service.js) |
| 状态机   | `active`(插入默认)→ `assist`→`assisted`;`unassist`→`active`;`delete` 物理删除内容，仅保留平台 ID | [superchat-service.js](../../../../src/bilibili/superchat-service.js) |
| 平台下线 | `retractSuperChatItems` 按 `platform_id` 批量删除内容并保留最小 ID；尚未收到原消息的撤回 ID 也防止迟到包入库 | [superchat-service.js](../../../../src/bilibili/superchat-service.js)、[superchat-store.js](../../../../src/storage/superchat-store.js) |
| 快照     | `WHERE status IN ('active','assisted') ORDER BY price DESC, datetime(created_at) ASC, id ASC` | [superchat-store.js](../../../../src/storage/superchat-store.js) 的 `listActive`                                                                               |

表结构与列见 [storage.md](../storage.md) §3.2(`super-chat-data.db`);快照 `superChats` 字段见 [ws.md](../ws.md) §2;入账触发 `bilibili:superchat` 广播(见 [danmaku.md](danmaku.md) §1)。

手动删除、平台下线和清空均不保留金额、正文、昵称或用户资料；只留下平台消息 ID 用于防重。没有平台 ID 的已删留言不留记录。`active/assisted` 仍可正常显示和标记处理；移除后的同平台 ID 新增消息及迟到的 assist/unassist 均不会复活留言。平台下线回调仅在实际删除显示项时发布快照；消息识别与 ID 优先级归 [protocol.md](protocol.md) §6.2。

SC 桥接入口对已有删除/撤回 receipt 的平台 ID 明确返回 `false`；[message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js) 收到该拒绝后停止后续命令分发，也不占用命令去重键。因此撤回先到的迟到原包不能再发起点歌或获得置顶。普通重复显示项仍交给既有命令去重规则处理，平台撤回不撤销此前已经接纳的歌曲。

## 8. 参数归属

消费者重试由 §2 的投影服务持有；冲刺计算见 §5，SC 阈值见 §7。查询参数默认值及上限统一见 [HTTP 礼物契约](../api.md#10-礼物域gifts)。

## 9. 完整礼物投影与恢复（当前实现）

现有 §6.1 的 fresh-client latest baseline 仍是旧服务器兼容语义。ADR [0011](../../../architecture/adr/0011-source-partitioned-gift-ledger-projection.md) 和 [完整投影规格](../../../../specs/gift-ledger-projection-sync_design.md) 所定义的现有能力模式按认证账号解析本地 source，先通过独立 history-only importer 构建服务器 `final + active + paid` 历史，再从 snapshot recovery cursor 增量补齐。历史行明确不进入 detector/consumer，不触发冲刺、加班、快照或 `gift:frame`。

capability 缺失时继续接收兼容 live final，但状态固定为 `LEGACY_PARTIAL`。capability 存在时，控制器处于干净 `LIVE`、bootstrap 已完成、SSE epoch 已验证且 cursor 连续时，`final` 事件通过既有 `gift-sync-store.commitCatchUpPage` 将礼物和 cursor 一起提交，提交后才分发消费者，不再逐条触发 GET；当前有效连接的已提交 cursor 直接忽略。写入失败不推进游标并转入补拉。启动、重连、缺口与每 10 秒的兜底核对继续使用 epoch-aware cursor pull；实时提交不推迟兜底期限，也不刷新 HTTP 验证时间。初始化、已有恢复、乱序、断线或 epoch 未验证时只走 pull/rebuild；所有远程任务使用 source/auth/controller/projection 四字段 fence。礼物明细、搜索和统计只读 Electron main 选定的 active source，renderer 不能提交 `sourceId`。


§9 记录现有的 bootstrap、事务恢复、连续 cursor 与四字段 fence，不代表所有历史下载增强均已完成。决策状态保持 Accepted，交付状态由[规格索引](../../../../specs/README.md)维护，当前为 Implemented。首次历史下载确认、进度/暂停/继续、实时与可选历史分离，以及服务器共享并发/字节预算见[未结项台账](../../../../specs/plans/open-items.md) B2/B3；最大租户脱敏数据集性能证据见[投影同步计划](../../../../specs/plans/2026-09-01-gift-ledger-projection-sync.md)。当前缺投影会按既有协议 bootstrap，不能承诺“未经确认绝不下载历史”或“暂停历史仍可独立实时收礼”。
