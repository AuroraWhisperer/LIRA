---
status: informative
review_date: 2026-09-21
scope: LIRA desktop and LIRA Server current working trees
review_status: complete
---

# 客户端与服务器代码复用、模块边界三轮审查

本报告记录当前代码事实和维护性建议，不新增需求，不替代协议或 Accepted ADR。此次审查只新增报告，不修改运行代码、测试、契约或数据库。

**结论：确实存在代码复用和模块边界问题，但不是整个项目缺少模块化。** 三轮后主清单收敛为 14 组：1 组在隔离输入下复现的订阅生命周期缺陷，13 组重复维护或边界问题。其中房间资料缓存还确认了重复请求；其余条目没有据此证明当前业务错误。另列 6 项较低收益的复用机会，并明确排除容易误判的情况。

## 1. 基线与判定方法

| 对象 | 工作区 | HEAD |
| --- | --- | --- |
| LIRA 客户端 | `D:/Work/Live` | `bb3881bb61bf66fcc5a56cdccb22aa17a756830a` |
| LIRA Server | `D:/Work/lira-server` | `80f0271fd457fca7616ec5508df58a9f37cabdfa` |

两个仓库均有用户未提交改动。结论以读取时的工作区内容为准，HEAD 不足以复现这些改动；本报告不代表线上部署或已发布客户端。开始审查时对客户端 1,200 个、服务器 617 个源码、页面、脚本和测试文件建立 SHA-256 摘要，结束时复核变化。并行改动及其影响见第 6 节。

正文链接指向仓库文件，标签中的行号是审查时的位置。服务器链接以两个仓库同级放置为前提。

审查分三轮：

1. 复核前次列出的七项问题和样式配置副本，核对规范、生产调用方与已有保护，收窄或撤回过度推断。
2. 扩展检查两仓库的公共规则、领域服务、存储、前端、桌面适配、生命周期与工程门禁，形成新的候选项。
3. 对候选项检查反例、合理差异、历史兼容和现有测试；按根因合并，区分已确认维护性问题、已复现故障与未证实疑点。

“相同文本”“大文件”“较多依赖”“存在多个数据库调用”都只用于定位，不单独构成问题。认定问题须说明生产消费者、重复的同一职责或泄漏的内部结构，以及具体维护影响。跨信任边界的双侧校验、不可变历史资源和独立生命周期不强行合并。

## 2. 第一轮：前次结论复核

| 前次条目 | 本轮裁决 | 依据与修正 |
| --- | --- | --- |
| 两端弹幕 feed / renderer 重复 | 重复事实成立；收窄建议 | renderer 大部分相同；feed 已有不同的动画、过期、条数裁剪和 API。ADR-0049 要求服务器独立部署并保留旧本地契约。先识别稳定的共同部分，不能直接以任一 feed 覆盖另一端，也不能把差异本身当成 bug。 |
| 礼物感谢服务访问分组内部状态 | 确认维护性问题 | `gift-interaction-service.js` 读取 `groups.groups` 并调用 `_remove(group)`；后者持有计时器、局部和全局预算的清理不变量。尚无运行故障证据。 |
| Admin 全局耦合 | 确认已登记技术债 | 兼容桥之外，21 个 Admin JS 文件含 237 处 `window.AdminApp` 原始文本引用；数量包含注册、读写和检查，不能理解为 237 条独立依赖。生产歌曲与礼物入口确实读取其他模块的全局能力。 |
| 云设置业务与存储混合 | 确认 SQL 边界待收敛；收窄职责判断 | `cloud-state.js` 直接读写 SQL。事务/revision、异步授权复核、监控更新和提交后发布由同一服务协调是合理职责；应提取 SQL/存储映射，不能机械拆散整个事务流程。 |
| 悬浮层主题与工具重复 | 确认维护性问题 | blindbox、queue-theme 重复通用主题赋值；blindbox、queue-utils、overlay-utils 重复颜色转换、字体回退及低功耗判定。 |
| 音乐与 B 站登录重复 | 确认两个纯 Cookie 转换函数重复；收窄提取范围 | Cookie 映射完全相同；完整登录/快照流程含平台分区、B 站旧导出兼容等差异，不能直接合并平台策略。 |
| 服务器歌曲 DTO 映射重复 | 低优先级复用机会 | Admin 返回 canonical 字段，Device 还返回旧别名，公开页面是有界投影。可共享基础字段映射；不能直接替换为同一个完整 DTO，也不构成当前字段错误。 |
| 弹幕样式规则维护四份 | 确认受保护的重复 | 两端 Node 副本一致，浏览器副本一致；每个仓库都有 Node/browser 行为与函数一致性测试。已有保护应保留；跨仓库同步和单一来源仍可改善。 |

第一轮相关规范：客户端 `docs/architecture/engineering/modularity-standard.md`、`legacy-boundaries.md`；服务器 `docs/README.md`、`docs/architecture/overview.md`、ADR-0049、ADR-0010/0012。不可变游戏历史版本不计入待消除的重复。

## 3. 第二轮：扩展扫描与候选项

静态扫描覆盖两仓库 `src/`、`public/` 下的 824 个 JavaScript 文件：客户端 529 个、服务器 295 个。服务器其中 25 个属于已发布游戏版本目录，保留在文件清单中，但排除出待消除的重复候选。

扫描以连续 8 条归一化有效代码行为定位线索，产生 74 个文件对候选，包含同文件内部重复；又检查了 437 个重复函数名和 1,588 条可静态识别的本地依赖边。**这些是筛选线索，不是 74 个问题，也不是重复率。** 重叠窗口不能累加成重复行数，函数同名也不代表职责相同。

| 检查范围 | 人工复核重点 | 结果 |
| --- | --- | --- |
| 跨仓库规则与展示 | 弹幕 renderer/feed、样式配置、礼物协议解码、歌曲 DTO | 共同规则有多个维护源；同时存在独立部署和兼容差异。 |
| 服务器实时与 B 站 | 三种事件 broker、礼物分组、房间资料缓存、监控配置读取 | 新增订阅器缺陷与重复请求证据；确认分组封装和存储规则泄漏。 |
| 客户端存储与同步 | 礼物查询/清理/重建、动态抽奖事务、来源 scope | 发现 SQL 语义仍从领域层传入 store，事务包装与投影重置规则重复。 |
| 客户端桌面与音乐 | Cookie 映射、登录状态投影、QQ 请求、敏感字段规则、播放状态操作 | 确认纯映射和请求收尾重复；撤回没有生产调用路径的退出登录故障疑点。 |
| 前端 | Admin 全局引用、悬浮层主题/工具、加班倒计时、游戏入口 manifest | 确认多个维护源；版本化游戏资源和页面专有规则保留。 |
| AI、加班、互动、歌词及组合入口 | 存储角色、依赖方向、共享纯规则、生命周期协调 | 不因目录名、文件大小或构造参数多而追加问题；互动规则和礼物卡模型已有跨运行时复用。 |
| 工程门禁 | 边界测试、历史债务额度、契约 fixture 锁定、依赖图 | 已有有效保护，但 SQL 字符串穿透、内部集合访问和跨仓库 UI 同步并非都在门禁覆盖内。 |

扫描识别出的依赖图中未发现循环分量，也未识别出 `src/storage`、`src/lib`、`src/shared` 向组合入口等上层目录的静态反向依赖。该结果不覆盖计算式导入、全局变量、运行时回调和所有语义依赖，不能据此宣布整个架构无环或边界完整。

第二轮使用真实工厂配合合成数据复现了两类情况：两种 broker 的过期取消句柄会影响新订阅；两套房间资料服务会各自请求相同房间。第三轮增加对照输入、其他租户订阅及调用方核对，确认影响边界。

## 4. 第三轮：复核裁决与最终问题清单

以下优先级用于安排维护工作：**P2 表示值得排期处理，P3 表示适合随相关需求处理；不是生产事故等级。** 未发现可以据此认定为 P0/P1 的问题。F01 是模块 API 级缺陷；F02–F14 是已确认的维护性问题或重复成本，不等同于 13 个功能 bug。

| 编号 | 范围 | 最终问题 | 优先级 | 证据强度 |
| --- | --- | --- | --- | --- |
| F01 | 服务器 | 两种 broker 复制了有缺陷的取消逻辑 | P2 | 已复现；当前 SSE 调用方有保护 |
| F02 | 客户端 | 礼物领域仍知道数据库和 SQL scope | P2 | 生产路径及存储接口确认 |
| F03 | 服务器 | 云设置 SQL、键名和 revision 存储规则分散 | P2 | 多个读写方确认 |
| F04 | 服务器 | 礼物交互服务访问分组内部集合和删除方法 | P2 | 直接调用确认 |
| F05 | 客户端 | Admin 通过全局对象耦合模块 | P2 | 生产引用及已登记债务确认 |
| F06 | 服务器 | 房间资料有两套缓存和请求合并逻辑 | P2 | 合成调用确认冷读请求两次 |
| F07 | 两端 | 弹幕共同展示逻辑和样式规则多处维护 | P2 | 副本及差异确认；部分有一致性测试 |
| F08 | 客户端 | 悬浮层公共主题、工具和倒计时格式重复 | P3 | 相同职责及调用方确认 |
| F09 | 客户端 | 两套登录模块重复 Cookie 纯转换 | P3 | 两个转换函数相同 |
| F10 | 客户端 | 动态抽奖事务包装重复且回滚错误处理不同 | P3 | 三个同领域 store 确认 |
| F11 | 客户端 | 礼物投影重置字段清单维护两份 | P3 | 两条有效存储路径确认 |
| F12 | 客户端 | QQ 客户端多种请求重复响应解析 | P3 | 四个有效请求入口确认 |
| F13 | 客户端 | 敏感字段名称策略维护两份 | P3 | 名称列表相同，处理动作有意不同 |
| F14 | 服务器前端 | 当前游戏目录与详情入口重复 manifest 解析 | P3 | 两个非版本化 loader 确认 |

### F01：过期取消句柄能删除后来建立的订阅

位置：[overlay-events.js:17](../../../lira-server/src/modules/danmaku/overlay-events.js)、[cloud-state-events.js:17](../../../lira-server/src/modules/streamer/cloud-state-events.js)。两个闭包都保存旧 `Set`，在旧集合为空时无条件按 streamer key 删除 Map 条目。

触发顺序是：最后一个旧订阅取消 → 同一 streamer 建立新订阅 → 再次调用旧取消函数。最后一步删除的是 Map 当前的新集合；随后发布返回 0，新监听者收不到事件。两种 broker 都复现。对照组不执行第二次旧取消时，发布和接收均为 1；其他 streamer 始终正常。

实际影响必须收窄：[公开 SSE cleanup:100](../../../lira-server/src/routes/public.js) 和 [device-sse cleanup:21](../../../lira-server/src/lib/device-sse.js) 都先检查 `closed`，当前这些生产路径避免了重复清理。**本次未证明正常 SSE 断线/重连已经丢事件。** 这是可重现的公共模块 API 边界缺陷；[既有 overlay 测试:68](../../../lira-server/test/overlay-event-broker.test.js) 虽连续调用两次 unsubscribe，却没有在两次之间插入新订阅。

建议先让取消句柄具备独立的失效状态，并在删除 Map 条目前核对集合身份；补上述交错顺序回归。之后才评估提取小型内部订阅管理工具，保留各 broker 的消息投影策略。[gift-event-broker.js:27](../../../lira-server/src/modules/bilibili/gift-event-broker.js) 已有 `subscription.active` 防重复取消，可作为附近先例。

### F02：礼物查询已有 store，但领域接口仍穿透存储细节

位置：[query-service.js:49、200](../../src/bilibili/gift/query-service.js)、[source-scope.js:3](../../src/bilibili/gift/source-scope.js)、[blind-box-analysis.js:177](../../src/bilibili/gift/blind-box-analysis.js)、[gift-query-store.js:338](../../src/storage/gift-query-store.js)。

`query-service` 多次从完整 `context.db.giftDb` 构造 store；来源判定返回 `source_id = ?` 等 SQL；`clearRecentGifts` 在领域层构造 where 条件；盲盒分析仍直接执行 SQL。这样改表结构、来源表示或查询策略仍会牵动领域代码，测试也必须知道底层数据库形状。仅把 `.prepare()` 搬到另一个文件，边界尚未完成。

建议由组合入口注入查询/维护能力，以结构化来源对象表达“本地、指定来源、切换中不可见”，由 store 翻译为 SQL。保留现有来源隔离与失败关闭语义。store 已对白名单 scope 校验，**不是 SQL 注入结论**；store 工厂还有共享 WeakMap/WeakSet 缓存，**没有证明反复构造造成性能问题**。盲盒 SQL 与旧 gift facade 已在 [legacy-boundaries.md](../architecture/engineering/legacy-boundaries.md) 登记，应按现有迁移路径收敛。

### F03：云设置存储规则没有集中到一个所有者

位置：[cloud-state.js:69、94、245](../../../lira-server/src/modules/streamer/cloud-state.js)、[gift-interaction-settings.js:8](../../../lira-server/src/lib/gift-interaction-settings.js)、[monitor-manager.js:79](../../../lira-server/src/modules/bilibili/monitor-manager.js)。

云状态服务直接处理 SQL、`cloud.setting.*`、`cloud.sync.settings` 和 JSON/revision；礼物互动设置重置也独立解析、递增和写回同一 metadata；监控器又知道原始设置的键名与值表示。一个持久化约定变化，需要同步审查多个层级，`src/lib/` 中的重置函数也实际承担了租户存储职责。

建议提取窄的设置 store/reader，集中 SQL、键名和持久化映射，继续由服务协调单次事务、revision、授权快照复核及提交后的监控/事件通知。重置必须继续参与凭据所在的事务；`writeRelatedSettings` 回调也不能拆成独立提交。**事务和提交后工作由一个服务编排本身是合理的。** 可参考已分离的 [song-library-sync.js](../../../lira-server/src/modules/streamer/song-library-sync.js) 与 [song-library-store.js](../../../lira-server/src/storage/song-library-store.js)，不能照搬客户端的事务归属规则。

### F04：礼物交互服务绕过分组公开接口

位置：[gift-interaction-service.js:47、79、85、97](../../../lira-server/src/modules/danmaku/gift-interaction-service.js)、[gift-thanks-groups.js:29](../../../lira-server/src/modules/danmaku/gift-thanks-groups.js)。

消费者直接使用 `groups.groups.has/get` 和 `_remove(group)`。分组对象同时拥有定时器、成员/字节计数、全局预算及移除回调，当前调用把这些内部数据结构的形状变成了隐式契约。换一种分组表示或取消机制时需要同步修改调用方。

建议只暴露按 key 查询存活/取消分组的窄方法，让计时器和预算始终由分组所有者维护。现有礼物交互与分组测试通过，本次没有发现预算泄漏或业务结果错误；`runtime.scheduler` 是显式导出的能力，不属于这一问题。

### F05：Admin 的模块协作仍依赖全局对象和导入顺序

位置：[songs.js:63](../../public/js/admin/songs.js)、[gifts/index.js:7](../../public/js/admin/gifts/index.js)、[admin/index.js](../../public/js/admin/index.js)、[legacy-admin-bridge.js](../../public/js/admin/legacy-admin-bridge.js)。

桥接文件之外，21 个 Admin JS 文件有 237 处 `window.AdminApp` 原始文本引用，含注册、检查、读写，不能当作 237 条独立依赖。例如歌曲流程读取全局状态，礼物入口检查并调用其他全局子模块，入口通过副作用导入保证注册顺序。这使消费者需要知道全局对象结构，单独装配与测试较难。

已有 [冻结门禁:203](../../test/module-boundaries.test.js) 和债务登记，因此不是新发现的架构失控。建议随功能改动逐个迁到显式 import/factory 参数，继续以 bridge 兼容旧调用；不要为了本次审查一次性重写 Admin。

### F06：房间资料缓存和请求合并各做了一套

位置：[admin/bilibili-profile.js:7](../../../lira-server/src/modules/admin/bilibili-profile.js)、[bilibili/room-profile.js:8](../../../lira-server/src/modules/bilibili/room-profile.js)、[api.js:176](../../../lira-server/src/modules/bilibili/api.js)。

两服务都使用按 streamer 分组的 Map、`roomId + credentialKey` 上下文、5 分钟正常 TTL、30 秒失败 TTL、100 个租户上限、进行中 Promise 合并和上下文失效检查。Admin 服务额外查登录账号资料，公共/主播流程只要房间资料；两者的房间请求却没有共享底层缓存。

生产消费者分别是 [Admin 资料路由:149](../../../lira-server/src/routes/admin.js)、[公共歌曲页:200](../../../lira-server/src/routes/public.js)、[主播资料路由:153](../../../lira-server/src/routes/streamer.js) 等。隔离调用两个真实工厂，传入相同房间和凭据上下文：首次并发读取调用 `getRoomInfo` **2 次**，重复读取仍累计 2 次，说明各自缓存有效、彼此没有请求合并。这是条件性重复请求，不代表每次访问都重复，也不证明目前达到上游限流。

建议共享底层房间读取/cache，保留以 streamer、凭据和房间区分的上下文及失效检查；上层继续提供各自的 Admin/公开投影，避免让公共页面触发账号资料查询。不是租户信息泄漏结论。

### F07：两仓库弹幕展示缺少稳定共同部分的单一维护来源

位置：[客户端 renderer:43](../../public/js/overlays/danmaku-message-renderer.js)、[服务器 renderer:43](../../../lira-server/public/overlay/danmaku-message-renderer.js)、[客户端 feed:25](../../public/js/overlays/danmaku-feed.js)、[服务器 feed:27](../../../lira-server/public/overlay/danmaku-feed.js)。样式规则另有 [客户端 Node](../../src/shared/danmaku-style-options.js)、[客户端浏览器](../../public/js/shared/danmaku-style-options.js)、[服务器 Node](../../../lira-server/src/lib/overlay-style-options.js)、[服务器浏览器](../../../lira-server/public/overlay/style-options.js) 四份。

renderer 大部分一致，服务器多了系统消息类名及不同的入场延时。feed 已经有 reduced-motion、过期时点、移除回调、运行时调整寿命和裁剪策略差异。样式 Node 副本跨仓库完全相同，浏览器副本跨仓库完全相同；每仓库都有 Node/browser 常量及函数一致性测试。这证明存在共同部分，但也证明不能直接合并完整 feed 或把两端差异称为 bug。

维护影响是共同 DOM/规则的修复需要跨仓库传播，现有 [contract lock](../../server-contract.lock.json) 跟踪的是协议 fixtures，没有覆盖这些展示源码。建议先指定共同规则的权威来源并补跨仓库同步检查，随后按稳定接口提取纯规则/renderer 共同部分。保留各自生命周期策略和 [ADR-0049](../../../lira-server/docs/architecture/decisions/0049-desktop-overlay-drafts.md) 要求的独立部署、旧客户端契约；采用源码分发或同步机制需单独接受设计，不应让运行时依赖另一个仓库目录。

### F08：公共悬浮层工具与同一倒计时显示规则重复

位置：[blindbox.js:288、394](../../public/js/overlays/blindbox.js)、[queue-theme.js:16](../../public/js/overlays/queue-theme.js)、[queue-utils.js:7、45、79](../../public/js/overlays/queue-utils.js)、[overlay-utils.js:7、24、60](../../public/js/overlays/overlay-utils.js)。另见 [Admin 加班时间:138、155](../../public/js/admin/overtime-time-view.js) 与 [加班悬浮层:306、317](../../public/js/overlays/overtime.js)。

相同的通用主题赋值、颜色转换、字体回退、低功耗判定分布在多个文件；`OverlayUtils` 还保留 classic-script 全局形式。加班两端又重复“结束显示文字”和年/天/时分秒格式化规则。调整共同显示规则需要找到所有副本，容易出现页面间差异。

建议只集中同主题的纯工具和共同 token 应用，页面专有样式/动画继续留在页面内。加班时间格式放在加班专用展示 helper；不把所有 UI 逻辑堆进通用 utils。当前没有确认颜色转换或倒计时输出错误。

### F09：Cookie 序列化与 Electron 还原转换重复

位置：[auth-manager.js:115、127](../../src/electron/auth-manager.js)、[bilibili-auth.js:83、95](../../src/electron/bilibili-auth.js)。两份 `toSerializableCookie`、`toElectronCookieDetails` 完全相同，域名、路径、sameSite、过期等映射应共同维护。

建议首先提取这两个纯转换函数，并用同一组 Cookie 样本验证。音乐平台与 B 站的 partition、保存/恢复策略、登录窗口和 B 站旧明文导出兼容有差异；不据此合并整个 auth manager，也没有由重复代码证明新的凭据漏洞。

### F10：动态抽奖事务包装有重复和诊断策略分叉

位置：[dynamic-lottery-store.js:47、56](../../src/storage/dynamic-lottery-store.js)、[dynamic-lottery-budget-store.js:44、53](../../src/storage/dynamic-lottery-budget-store.js)、[dynamic-lottery-draw-store.js:11](../../src/storage/dynamic-lottery-draw-store.js)。

前两份 `tryRollback` 和 `BEGIN IMMEDIATE` 包装一致；第三份类似，但回滚失败时把错误放入 `error.cause`，前两份抛弃回滚错误。这里是同一抽奖存储领域的事务原语多处维护，故障诊断策略已经分叉，尚未证明数据提交/回滚结果错误。

建议先确定该领域的异常保留规则，再复用小型同步事务 helper，事务仍由各 store 所有。不同文本验证器的长度上限、跨库清理事务及提交后副作用并不相同，不应一并纳入。

### F11：礼物投影重置的存储字段清单有两个维护点

位置：[database-clear-operations.js:149](../../src/storage/database-clear-operations.js)、[gift-sync-store.js:250](../../src/storage/gift-sync-store.js)。两处都重置 epoch/cursor/bootstrap 字段、递增 `projection_generation`、清空验证时间。

未来增加同步状态字段时，漏改任一路径可能使清理和重建产生不同初始状态。当前字段清单一致，没有复现此类错误。可提取“在已有事务内重置同步 metadata”的窄存储操作，保留外层事务和 generation fence。

两条路径的删除范围不同：手动清理和重建时的 `cmd = 'LIRA_SERVER_GIFT'` 条件不能合并为同一删除行为。也不建议借此重写整个清库协调器。

### F12：QQ 请求构造已经分离，但共同响应处理仍复制四次

位置：[qq-provider-client.js:141、161、217、284](../../src/music/providers/qq-provider-client.js)。`requestMusicuPost`、`requestMusicsClient`、`requestQQEncryptedVkey`、`requestJson` 都执行读取文本、HTTP 状态检查、JSONP 剥离、JSON 解析与相同错误包装；调用方覆盖推荐/歌单、歌词与可播放地址等有效流程。

建议优先提取共同响应读取/解析函数，必要时再收敛相同的 fetch 参数。`comm`、uin/authst、签名、Content-Type 和加密 vkey 协议保持各自构造。这是既有 focused client 内部的进一步复用机会，并不意味着需要增加新的网络抽象层。

### F13：日志与远端响应维护相同的敏感字段名称集合

位置：[license-response-utils.js:37](../../src/electron/license/license-response-utils.js)、[log-redaction.js:76](../../src/shared/log-redaction.js)。两处重复 password、activationCode、token/secret/signature 后缀、privateKey 等名称判定。

建议按需要共享基础字段分类规则，以同一组样本覆盖两个消费者；保留日志的遮盖与远端响应的字段剔除策略。日志额外做 URI 解码，响应 URL 分支的 URLSearchParams 本身也会解码键名，**不能把这处差异直接当作编码绕过漏洞**。已有日志/协议测试通过，本次未证明实际敏感信息泄漏。

### F14：当前游戏入口的 manifest 解析维护两份

位置：[games/catalog.js:17、38](../../../lira-server/public/games/catalog.js)、[games/game.js:46、67](../../../lira-server/public/games/game.js)。两个当前 loader 重复 `isNonEmptyString`、`isValidGame`、`parseManifest`，读取同一个游戏目录 manifest。未来新增必填字段或状态时可能只更新一个入口。

建议在这两个浏览器入口之间共享小型 parser，并保留后台 catalog 的校验职责。若新增静态文件，要遵循现有资源发布 allowlist。这里只针对非版本化入口，不包括要求保持不可变的 `vN` 游戏快照。现有页面测试及 catalog 测试通过，未发现当前两个入口解析结果不一致。

### 较低收益的复用机会：不与主清单混算

| 条目 | 证据 | 处置建议 |
| --- | --- | --- |
| 音乐登录状态 DTO 三份 | [provider-registry.js:129](../../src/music/provider-registry.js)、[netease-mappers.js:112](../../src/music/providers/netease-mappers.js)、[qq-provider-utils.js:475](../../src/music/providers/qq-provider-utils.js) 的 `sanitizeAuthState` 相同，均有生产调用。 | 若增加认证状态字段再集中纯投影；现有字段没有不一致证据。 |
| 服务器歌曲基础字段映射 | [streamer-read-model.js:28](../../../lira-server/src/modules/admin/streamer-read-model.js)、[song-library.js:130、154](../../../lira-server/src/lib/song-library.js)。 | 可复用 canonical 基础映射；保留 Device 旧别名和公开页面的字段限制。 |
| B 站错误码提示与格式 | [wbi-signer.js:16、32](../../src/bilibili/wbi-signer.js)、[danmaku/api-client.js:344、355](../../src/bilibili/danmaku/api-client.js)。 | 可集中同一上游错误提示。客户端本地弹幕入口当前停用，应按实际调用价值排序。 |
| 跨仓库 protobuf 基础解码 | [客户端 decoder:15](../../src/bilibili/protocols/protobuf-decoder.js)、[服务器 utils:192](../../../lira-server/src/modules/bilibili/gift-parser-utils.js)。 | 只有通用字节读取部分相近；外层礼物标准化不同。当前不值得仅为减少副本增加跨仓库运行依赖。 |
| 歌词纯清洗与数值截断 | [lyric-state.js:54、61](../../src/music/lyric-state.js)、[lyric-timeline.js:59、66](../../src/music/lyric-timeline.js)。 | 少量共同逻辑，可在修改歌词契约时收敛；保留逐字文本和整行文本的空白处理差异。 |
| 礼物查询 HTTP 错误映射 | [admin.js:62](../../../lira-server/src/routes/admin.js)、[streamer.js:98](../../../lira-server/src/routes/streamer.js) 复制同组查询错误状态码。 | 可共享该领域的错误映射；Admin/Streamer 特有鉴权错误和路由职责保持独立。 |

### 排除或收窄的疑点

| 疑点 | 复核裁决 |
| --- | --- |
| 文件很大、工厂依赖很多、组合根负责多种启动/关闭动作 | 不能单凭尺寸或依赖数量认定职责混乱；状态所有者统一管理生命周期有价值。 |
| `src` 引用 `public/js/shared` 就是反向依赖 | 互动规则、外观值标准化及礼物卡模型是无初始化 DOM 副作用的可共享模块，已有 Node 消费和测试；应看纯度与角色，不按路径机械定罪。storage 的禁止依赖规则仍需遵守。 |
| 云设置协调授权、事务、revision、通知，必须全部拆开 | 不成立。拆散会损伤原子性和复核顺序；保留服务协调，仅收敛存储表示。 |
| 相同函数名的金额、正整数、时间戳校验都应统一 | 不成立。入口容错、取整、safe integer、默认时间等语义有差异；先逐字段核对契约。 |
| 客户端和服务器都验证设置/过滤词，是无效重复 | 不成立。客户端体验校验与服务器信任边界校验都需要；trim/dedup 等规范化可有不同职责。 |
| 桌面歌词/互动外观 defaults 多份就是未保护问题 | 有现成一致性测试：[歌词设置:229](../../test/desktop-lyric-settings.test.js)、[互动外观:10](../../test/interaction-appearance.test.js)。可改进来源管理，当前不升级为故障。 |
| 历史游戏 `vN` 副本和 schema/migration DDL 都应去重 | 不成立。前者有一年 immutable 契约；后者服务不同数据库升级阶段。不能修改历史资源来追求文本一致。 |
| `ProviderManager.clearPlatformData` 导致当前退出登录索引错误 | 全局搜索只找到方法定义；当前 [provider-operations.js:263](../../public/js/playback/operations/provider-operations.js) 使用 `stateActions.forgetProviderStreams`。未证明生产触发，不列为现存退出登录 bug。该类的旧 `normalizeOnlineTrack` 也没有当前生产调用。 |
| `HomeService._applyBackgroundUpdate` 或 `runtime.scheduler` 是内部越权 | 前者明确作为 ContentLoader 回调，且自行检查过期 generation；后者是显式公开能力。下划线或属性访问本身不足为证。 |
| 轮询器的 start/stop、图片 URL 校验或通用四五行 guard 相似就应抽象 | 相似事实不等于划算的统一职责。轮询时序/恢复不同，图片缓存还需扩展名等额外限制；本次不为少量重复引入通用框架。 |

## 5. 验证、覆盖与限制

### 实际执行的检查

| 阶段 | 检查 | 结果 |
| --- | --- | --- |
| 首次审查 | 客户端 `npm run verify:architecture` | 22/22 通过 |
| 首次审查 | 服务器 architecture-governance + overlay-style-options | 14/14 通过 |
| 第三轮 | 客户端以下 11 个定向测试文件 | 68/68 通过，0 跳过 |
| 第三轮 | 服务器以下 11 个定向测试文件 | 89/89 通过，0 跳过 |
| 第二、三轮 | 合成输入的 broker 取消/替换订阅探针 | 两种 broker 同样复现，正常对照和其他租户正常 |
| 第二、三轮 | 合成输入的两个房间资料工厂调用计数 | 首次两次上游调用；再次读取仍累计两次 |

客户端定向命令，在 `D:/Work/Live` 运行：

```powershell
node --experimental-vm-modules --test test/auth-manager.test.js test/bilibili-auth-profile.test.js test/dynamic-lottery-store.test.js test/qq-provider.test.js test/gift-query-service.test.js test/gift-sync-store.test.js test/log-redaction.test.js test/license-protocol.test.js test/danmaku-style-options.test.js test/interaction-appearance.test.js test/overtime-overlay.test.js
```

服务器定向命令，在 `D:/Work/lira-server` 运行：

```powershell
node --require ./test/support/test-mode.cjs --test test/overlay-event-broker.test.js test/cloud-state-events.test.js test/admin-bilibili-profile.test.js test/streamer-room-avatar.test.js test/cloud-state-atomicity.test.js test/cloud-state-read-reuse.test.js test/gift-interaction-settings.test.js test/gift-thanks-groups.test.js test/gift-interaction.test.js test/public-games-page.test.js test/game-catalog.test.js
```

测试使用既有内存/临时数据库与 mock，没有使用真实用户数据库，也没有启动/重启用户的 Electron 应用。没有新增生产测试文件。68 与 89 是 Node test reporter 的测试计数，服务器包含嵌套用例；不是检查过的文件数。

### F01 的最小复现

在服务器仓库用 Node 执行以下代码，无数据库和网络依赖：

```js
const { createOverlayEventBroker } = require('./src/modules/danmaku/overlay-events');
const { createCloudStateEventBroker } = require('./src/modules/streamer/cloud-state-events');

for (const [name, create, event] of [
  ['overlay', createOverlayEventBroker, { type: 'danmaku' }],
  ['cloud', createCloudStateEventBroker, { settings: 1 }],
]) {
  for (const staleCleanup of [false, true]) {
    const broker = create();
    const old = broker.subscribe(1, () => {});
    old();
    let delivered = 0;
    let otherTenant = 0;
    const current = broker.subscribe(1, () => delivered++);
    const other = broker.subscribe(2, () => otherTenant++);
    if (staleCleanup) old();
    const published = broker.publish(1, event);
    broker.publish(2, event);
    console.log({ name, staleCleanup, published, delivered, otherTenant });
    current();
    other();
  }
}
```

当前两种 broker 均输出：`staleCleanup=false` 时 `published=1, delivered=1`；`true` 时两个值都为 0；`otherTenant` 始终为 1。期望过期句柄不影响新订阅。

### F06 的最小复现

同样在服务器仓库执行，无真实凭据和外部请求：

```js
const { createBilibiliProfileService } = require('./src/modules/admin/bilibili-profile');
const { createRoomProfileService } = require('./src/modules/bilibili/room-profile');

(async () => {
  let calls = 0;
  const options = {
    now: () => 1000,
    getContext: () => ({ roomId: '123', credentialKey: 'fixture' }),
    getAccountProfile: async () => null,
    getRoomInfo: async () => {
      calls++;
      return {
        room_info: { room_id: 123, uid: 456 },
        anchor_info: { base_info: { uname: 'fixture', face: '' } },
      };
    },
  };
  const admin = createBilibiliProfileService(options);
  const room = createRoomProfileService(options);
  await Promise.all([admin.getBilibiliProfile(1), room.getRoomProfile(1)]);
  const coldCalls = calls;
  await Promise.all([admin.getBilibiliProfile(1), room.getRoomProfile(1)]);
  console.log({ coldCalls, afterCachedReads: calls });
})().catch((error) => { console.error(error); process.exitCode = 1; });
```

当前结果为 `{ coldCalls: 2, afterCachedReads: 2 }`。如果共享底层房间读取，同一上下文的并发冷读应能合并为 1 次；共享是否值得实施仍需按实际调用频率决定。

### 检查能力的边界

- 既有测试通过说明受测行为仍成立，不证明所有边界清晰，也不会自动覆盖 F01 的新交错顺序。
- 这是源码、契约、调用方、局部逻辑和既有测试审查，没有做生产流量分析、全量 Electron/OBS 交互验证或数据库故障演练。
- 静态依赖与重复扫描使用轻量词法/文本规则，不是完整 AST 或运行时跟踪；未发现不等于不存在。
- 文件清单覆盖全部目标 JavaScript，人工深读集中于候选项和相关所有者/消费者，没有声称逐行证明全部 824 个文件。
- 没有运行完整仓库测试集。本次只写报告，定向验证已足以支持这些结论；后续若修改事务、授权、生命周期或跨仓库分发，需要按修改风险补相应门禁。

## 6. 工作区完整性与并行改动

本任务唯一仓库写入是本报告；没有提交、切分支、修改运行代码或修复测试。服务器的 617 个基线文件摘要与 HEAD 保持一致。客户端复核时有 12 个基线文件发生并行变化：

```text
src/bilibili/gift/display-settings.js
src/server/overlay-projection.js
public/css/admin/gift-display.css
public/js/admin/gifts/display-settings.js
public/js/overlays/gift-feed.js
public/js/shared/gift-banner.js
public/pages/admin/toolbox/gift.html
test/frontend-gift-display-settings.test.js
test/frontend-gift-feed.test.js
test/gift-banner-feed.test.js
test/gift-routes.test.js
test/overlay-http-access.test.js
```

Git 状态还显示相关 API/overlay 文档和礼物展示计划发生变化。本任务未写入上述文件，全部保留。F01–F14 的问题位置文件未因这些并行改动变化；Admin 统计复核仍为 21 文件、237 处引用。客户端 HEAD 未变。静态扫描数字描述扫描时的工作区，不能把本次测试结果外推为对所有并行修改的验收。

交付检查：73 个文件链接均存在，所引行号均在文件范围内，14 个主条目编号完整；报告中的两段复现代码执行结果与正文一致。两仓库 `git diff --check` 通过，`git status --short` 已核对；报告新文件也单独检查了 diff 和空白。报告未加入运行数据或敏感材料。

本次临时扫描与测试日志保留在 `C:/Users/Tom/AppData/Local/Temp/lira-reuse-audit-Oyw8GU`。清理该目录的操作被自动审批策略拒绝，工具只返回 `blocked by policy`；本任务没有绕过该拒绝，也没有继续删除。

## 7. 建议处理顺序

1. **先处理有明确错误触发条件的 F01。** 独立小改动补取消句柄保护和交错顺序回归；保留当前 SSE 生命周期。此项不用等待大的模块重构。
2. **随后收敛高价值边界：F02、F03、F04。** 每次以一个消费者或一个存储操作为范围；用现有来源隔离、云设置原子性、分组预算测试保护。先明确所有者，再移动代码。
3. **在相关功能迭代中处理 F05、F06、F07。** Admin 逐项减少全局依赖；资料服务共享底层请求；弹幕先确定共同规则来源及同步约束。跨仓库分发应有独立设计，维持独立部署。
4. **F08–F14 及附表机会随改动顺手收敛。** 优先能消除多处规则更新、且无需改变对外契约的纯函数/存储操作；已有一致性测试的副本低于真实故障优先级。

复核后不建议以“所有相似代码必须共享”为目标。更可验证的目标是：同一业务规则有明确所有者，消费者不依赖其内部结构；合理的环境差异有明确接口，必要副本有同步保护。
