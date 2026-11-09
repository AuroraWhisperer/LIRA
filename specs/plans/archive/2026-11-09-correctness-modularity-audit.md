# 正确性与模块边界审计计划

**Status:** Completed

## Goal

按用户要求并行审计 LIRA 当前代码，寻找通过明确 owner、复用现有接口或局部修复能够消除的实际错误。以触发条件、影响和可复现证据决定修改，不以文件行数、外观相似或抽象数量决定拆分。

## Non-goals

不改造模块化单体，不增加框架、运行依赖、服务或通用同步管理器；不恢复历史暂停事项，不操作真实用户数据、账号、部署或运行中的桌面实例，不提交、建分支、打包或发布。范围为本仓库；相邻 Server 仅在现有固定契约校验需要时只读。

## Current Behavior

- 2026-11-09 开始审计时已有大量未提交代码、测试和文档变更。文本基线、原始状态及 staged/unstaged diff 保存在 `tmp/modularity-audit-2026-11-09/`，本任务增量以该基线为准。
- 当前已有分层、事务端口、共享设置契约、请求取消及依赖门禁；先验证现有能力，不能把历史债务列表直接当成当前缺陷。
- 现有 `test/` 按领域与 offline/browser/desktop/installer/contracts 分组。先运行静态边界检查和与实际问题对应的聚焦复现，再按实际修改影响选择回归。

## Ownership 与覆盖矩阵

| 方向 | 主审范围与消费者 | 契约与验证入口 | 状态 |
| --- | --- | --- | --- |
| 持久化与音乐业务 | `src/storage/`、`src/music/`、`src/fans/`、`src/overtime/` | storage、music/services、overtime 参考；storage/songs/music/fan-profiles/overtime 测试 | 已审查事务、投影、缓存、切换和清理；A1、A4 已修复 |
| 桌面与远端连接 | `src/electron/`，IPC、云同步、授权、媒体、更新、资源生命周期 | desktop 参考；desktop/license/cloud-sync/gifts 测试 | 已审查发送方验证、授权代次、下载和关闭；A3 已修复 |
| 前端与共享消费 | `public/js/`，管理页、场景、展示、播放、歌词与共享通信 | frontend 参考；admin/scenes/overlays/playback/lyrics/ui 测试 | 已完成双写入口第二轮审查；A2、A5–A8 已修复 |
| 本地传输与组合 | `src/server.js`、`src/server/`，HTTP/WS、授权、预览和本地素材接口 | server-core/api/ws 参考；server/transport/scenes 测试 | 已审查 scope、Host/Origin、预览撤销、场景发布和素材路径；无确认新增问题 |
| 上游与互动业务 | `src/bilibili/`、`src/ai/`、`src/games/`、其他后端领域 | bilibili/ai 参考及路由表；bilibili/gifts/ai/bots/games 测试 | 已审查轮询、取消、顺序、事务后交付和互动生命周期；无确认新增问题 |
| 工程与原生边界 | `scripts/`、`build/`、`native/`、运行配置和共享纯契约 | build/test、native README；engineering 及原生自检入口 | 已审查打包入口、完整性校验、验证缓存、原生管道和缓冲；无新增拆分需求 |

事实归属和调用关系使用 [AI 路由表](../../../docs/architecture/engineering/ai-workflow.md) 与 [技术参考](../../../docs/reference/README.md) 定位。三个子代理先独立只读审计，主代理核实问题并分配互不重叠的修复文件；文档与集成复审由主代理统一维护。

## Compatibility Constraints

保持 HTTP/WS/IPC、设置键、SQLite 格式和现有页面地址；保持授权、账号隔离、safeStorage、日志脱敏、本地媒体来源检查及发布凭据边界。任务开始前的修改和 staged 内容原样保留。测试使用临时目录、内存库或合成输入。

## Proposed Changes

只接受有具体触发和影响的发现。每项修复先记录 owner、现有接口、复现、最小变更及消费者；若现有模块能够修复，直接修复 owner。新增共享模块必须解决两个以上同契约消费者的真实规则分叉，或封闭已有安全/事务边界。无法确认需求的问题记录证据，不擅自改变产品语义。

## Milestones

- [x] 建立静态边界基线，完成各方向入口、依赖和失败路径审查；记录排除项。
- [x] 确认问题并完成最小修复；每项保留聚焦失败与通过证据，更新拥有者文档。
- [x] 第二轮审计相邻调用方及未覆盖领域，确认没有重复请求、监听、保存或渲染。
- [x] 在代码稳定后运行与变更范围匹配的集成门禁，审查任务增量及最终状态，归档结果。

## Verification

- 初始边界：`npm run verify:architecture`，结合代码判断语义边界，不把通过等同于无缺陷。
- 每项缺陷：先用 `node --experimental-vm-modules --test <拥有者测试>` 复现，再用相同入口验证修复；必要时包含直接消费者。
- 最终共享代码和跨领域修复：`npm run check`、`npm run test:offline`；offline 已包含 `verify:architecture` 的三个架构测试文件，不重复运行同一门禁。是否需要浏览器/桌面/原生检查由实际修改确定。全组运行期间所有代理停止编辑。
- 文档更新：`npm run verify:docs`；检查使用指南及交互引导是否因行为变更而需要同步。
- 最终检查：与任务初始文本基线比较，`git diff --check`、`git status --short`；完整保留原有 staging。

## Rollback Or Failure Handling

发现失败先保存失败证据并聚焦诊断；不通过放宽断言、重复碰运气或扩大重构处理失败。必要时仅逆向本任务补丁，对照基线和当前文件人工保留其他改动，不进行 reset、整文件 checkout 或广泛删除。若工作区出现并行变化，先重新核对受影响文件。

## Done When

六个方向都有主要入口、边界及错误路径审计记录；所有确认且属于本任务的问题完成最小修复与相应验证；反向复审未发现新增问题；技术文档和使用指导的影响已处理；最终增量已复核。报告准确区分代码审计、自动化验证与未执行的真实账号、硬件、生产和安装验收，不承诺不存在任何未知缺陷。

## Findings 与执行记录

### A1：存储初始化依赖前端场景 schema

`src/storage/settings-defaults.js` 为两个已有持久化默认值导入 `public/js/shared/scene-shared-appearance.js`，继而加载多类展示配置，违背 storage 的依赖方向并扩大数据库初始化的失败范围。初始架构检查在 storage 边界断言失败。已将两个标量留在存储默认值 owner，移除该导入，不新增跨环境模块。本审计不决定默认值；并行的客户端与画布参数补齐任务随后将 `liveRankingsRange` 从 `nearby` 校准为 `all` 并同步契约，本任务已核对并保留其改动；`heartBoxCollectionShowRewards` 仍为 `'true'`。

验证：settings-contract 与 shared-appearance 合计 35/35；storage 边界聚焦 1/1；文件 diff 检查通过。第一次聚焦命令漏掉 VM 参数，属于命令准备错误，正确命令重跑通过。测试和技术契约已有覆盖；使用步骤未变。

### A2：礼物动效卡片的迟到保存回包覆盖新状态

已用实际前端模块和合成 DOM/网络复现：卡片提交 speed=120，随后画布写入 160 并广播，旧 POST 返回后卡片重新显示 120 且标记已保存。`gift-motion-settings.js` 直接将 submitted 合入本地状态，绕开已有 `createComponentConfigController` 和 `saveComponentSettings` / `confirmComponentSettings`。修复由卡片接入现有 owner，保留手动保存与期间的新编辑，不新增通用框架。对应聚焦回归由该前端 owner 承接。

已完成该接线修复；新回归在旧实现得到 `120 !== 160`，修后通过，同时验证未提交字段不会被覆盖、保存期间的新输入继续保持待保存。controller/save 相关 26 项和启动 6 项通过，源/测试语法与增量 diff 检查通过。第二轮继续检查有画布写入的其他设置卡片。

### A3：原生播放队列满时丢弃停止命令

`src/electron/playback-output.js` 的普通队列上限检查发生在 stop 使流失效之前。慢设备枚举期间反复刷新可占满四个请求，此时暂停、seek、导航或 renderer 崩溃的 stop 返回拥堵且不发送给工作程序，旧流仍有效。使用假工作程序复现，未操作真实设备。修复仍由播放输出 owner 持有队列，为 stop 保留有界、可合并的机会并立即使旧流失效；用既有 `playback-output.test.js` 覆盖满队列和后续打开的顺序，不造通用队列组件。

已完成：普通队列最多 4 个，stop 使总待处理最多 5 个；同代次 stop 合并，open 后的 stop 不与前代次合并。回归先失败后通过，相关播放／助手／IPC／关闭 42 项通过；测试断言精简后播放／关闭 34 项通过。桌面方向前期另有 14 文件 121 项聚焦通过。数字存在重叠，不累计为独立用例总数。

### A4：音乐推荐磁盘缓存跨账号复用

`src/music/lyrics-service.js` 的 personalized 缓存键仅包含平台、动作与分页参数；QQ provider 会使用当前账号请求推荐。切账号后前端缓存虽已清空，后端五分钟缓存仍返回前账号内容。合成账号 A→B 复现仅调用 provider 一次且 B 得到 A 的推荐。修复在音乐 owner 隔离授权作用域，保留同账号暖缓存与原 TTL；不将 Cookie 明文写入缓存，不把进程内 revision 当作可跨重启的身份。验证包含切换、同账号复用和请求期间切换。

已完成：复用 Provider 的 `getSafeCookieHeader()` 与现有 hash key，写入前再次读取凭证，变化时跳过缓存。现有 playback-home-lifecycle 扩展两条业务回归，连同 netease-provider、lyrics 共 54 项通过。另一代理只读复核文件名、payload、旧缓存隔离、退出登录与重建行为，无新增问题；未增加 registry API 或上游请求。

### A5：滚动礼物保存期间丢弃设置推送

`public/js/admin/gifts/display-settings.js` 保存期间忽略广播，迟到 POST 后直接回填旧值。已有真实浏览器场景扩展为提交 scrollSpeed=50、画布更新为合法值 40、旧回执返回 50；修复前失败，修复后保留 40。复用既有配置控制器及原 GET/POST owner，保留金额换算、手动保存和取消。该套 5 项通过；与互动外观最终合跑 10 项通过。

### A6：大航海感谢文字模式旧回执回退

`public/js/admin/gift-guard-thanks.js` 的辉光／经典卡片保存 en 后，画布 TextMode 更新为 bilingual，迟到回执仍将显示回退为 en 并清除 dirty。两风格各自接入现有控制器与 settings 保存／确认接口，保留旧字段 fallback 和每风格完整两字段提交，独立航海旗帜开关不改。扩展原有场景后 4 项通过，包含既有浏览器预览用例。

### A7：歌词自动保存与通用回填争用表单

实际 `desktop-lyric.js` 模块复现字号提交 68、画布更新 70、迟到回执又显示 68。改用既有控制器与 settings 适配器，仍以已显示表单确定修改字段；保留 500ms 防抖、change 立即保存、串行后续写入、基础／高级重置边界及独立音乐来源。现有场景覆盖后续输入、未编辑字段和迟到回执，相关歌词／控制器／确认 37 项通过。

集成复查还确认 `state.applySnapshot` 先派发 settings 事件，再通用 `fillForm`，会将失焦歌词草稿 64 改回服务端 56。仅在 `forms.js` 已有独立表单排除列表加入歌词表单，避免第二个回填 owner；现有运行时测试先失败后通过，与 state-renderer、歌词场景合跑 7 项通过。未新增共享同步算法。

独立复审发现初版接线在每次按键后回填数字框，真实 range/number 绑定会将未输完的字号 `6` 立即改为下限 `24`。在原场景接入真实 `FormsService.bindRangePair` 复现失败后，局部跳过本地 edit 通知的回填，保留输入文本及原布局更新；确认与广播仍沿用 owner。最终歌词、表单、状态渲染、配置控制器及确认适配器 7 文件 41 项通过。

### A8：互动外观迟到回执误报已应用

`public/js/admin/interaction-appearance.js` 手动应用字号 24 后，画布保存 18，旧回执仍显示 24 并标记已应用。现有场景扩展后先失败，再将该入口接入既有控制器与 settings 保存／确认修复；保留原手动应用与禁用字段行为。原测试文件的既有未提交改动保留，5 项通过，最终与礼物流合跑 10 项通过。

### 已完成的边界检查与排除项

- HTTP/WS scope、Host、许可和本地健康边界：现有 55 项测试通过；场景输出在异步后复核账号代次和来源凭据，SSE 与预览 relay 各自负责撤销、容量和清理，未发现需要另一层共享管理器的证据。
- 礼物 projection/consumer 的事务后交付与重试由现有 owner 持有；不能将同步事务消费者改为泛化异步总线。Bilibili 各 poller 的分页、频率和身份来源不同，保留各自状态所有者。
- AI 生成、按观众串行与顺序交付、取消后状态检查已分层；一个预先取消 verifier 调用的候选在真实调用方的同步取消检查下不可达，不据此添加修复或测试。
- 资源与字体下载已有完整性、流大小、取消和重定向边界；两者清单与交付语义不同，不仅因存在类似读取循环而合并。
- WeSing prepare/apply 已有同步校验、配置替换、发现代次和刷新取消；无需新增配置队列。歌曲队列事务、粉丝投影和加班结算保留现有 owner。
- 前端共享写入口中，歌单／点歌板／时钟／歌曲信息／弹幕／资源样式已有 controller/read/confirm；加班有 revision/generation；心动收集／排行已有共享保存 owner；开播动画保存后重新读取。盲盒面板不以回执覆盖 UI；林间花信／航海旗帜开关未确认同类双写路径，均不因形式相似改造。
- 场景 projection 512 字符限制已按当前 22 类型计算，receipt 为 427 字符且读取接受，没有扩大上限的需求。AI 候选的取消时序不可由现有调用者触发；不同 Bilibili poller、Electron 同步栅栏和音频协议职责不同，不合并。
- 工程侧审查安装入口、资源清单、发布完整性和验证缓存；原生侧审查 Program 管道、输入／输出、缓冲及释放／路由恢复。未修改发布基础设施，未运行发布、真实账号或用户设备操作。

### 同步与最终验证

技术事实更新到 frontend/app、desktop/main 和 backend/music/services；存储边界原文已经正确，无需重复契约。测试优先扩展现有业务场景，只有礼物动效卡片缺少覆盖时新增单场景集成文件。已核对 README、相关 guides、内置 usage-guide 与导览；入口、操作步骤、字段和用户限额未变，用户指南保持现状。

`npm run check` 已通过 1,807 个 JS 文件（执行 1 个、复用 1,806 个有效语法证明）。首次 `test:offline` 为 4,701/4,702，通过所有业务与架构用例，唯一失败是并行礼物增量计划使用 `状态：` 而非门禁支持的 `Status:`。仅规范该状态标签，保持其 In Progress 内容和任务不变，随后 `verify:docs` 10/10 通过。

第一次全组运行期间，另一任务更新了播放器 HTML 和其文档、完成了闲置文件计划归档；前后快照记录了这些变化。因此未将该运行作为固定版本的最终通过证据。所有已知失败处理完并经聚焦检查、独立复审后，在当前代码重新运行离线全组。

最终 `npm run test:offline` **4,702/4,702 通过，0 失败、0 跳过**，包含架构与文档门禁；约 60 秒，报告 `tmp/test-results/run-eiAEBU/results.json`，日志 `tmp/modularity-audit-2026-11-09/offline-stable.log`。运行前后核对 2,854 个文本源码、测试、配置与文档：业务源码／测试／配置未变，只有另一任务的礼物增量计划及两个索引完成归档；最终归档后 `verify:docs` **10/10 通过**。最后语法门禁通过 1,807 文件（执行 6 个、复用 1,801 个有效证明）。

已复核本任务相对初始文本基线的增量，`git diff --check` 通过，原 staging 保持空且未提交。所有临时基线、日志和合成复现留在 repository-root `tmp/`；用户 `output/` 未操作。技术参考已同步，使用步骤未改变。独立复审覆盖礼物动效、音乐缓存及歌词接线；歌词输入回归已修正并再次复审通过。

覆盖的是六个领域的主要入口、拥有者、跨模块边界及失败路径，不宣称逐行穷举或不存在未知缺陷。验证包含 Node/VM/SQLite/本地 HTTP、相关既有浏览器场景与合成原生 worker；未操作真实账号、实际声卡、用户 Electron 实例、生产部署或安装升级。本轮未新增运行模块、框架、依赖或服务，未提交、建分支、打包或发布。
