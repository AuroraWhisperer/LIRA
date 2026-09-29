# 客户端文档遗留事项核验

> 历史记录：本文的发现、建议和验证仅对应文内日期/基线，不是当前缺陷或执行清单。现状见 [技术参考](../reference/README.md)，剩余工作见 [计划索引](../../specs/plans/README.md) 与 [未结项台账](../../specs/plans/open-items.md)。原结论和后续执行记录保留，不据此恢复未获批准的提案。


- 核验日期：2026-09-26。对象：`D:/Work/Live` 当前工作区，不是已安装或已发布版本。
- 状态：**两轮核验完成，最终保留 15 个主题。** 前 11 项为实现缺口、待评审/延期事项或复审工作；后 4 项为验收/文档证据缺口。不是 15 个已证实软件缺陷。
- 本文是事实审查，不新增需求、不批准草案、不恢复用户已暂停的任务。仅新增本报告，保留两仓已有修改。

## 1. 范围与判断口径

扫描 **401 份文档源：392 份 Markdown、9 份内置使用指南 HTML，共 62,087 行**。范围包括根目录、架构说明、设计规格、活跃及归档计划、历史报告、接口参考、工具与源码目录中的说明。排除第三方依赖、构建/发布复制品、运行数据、图片，以及本次审查过程中出现的同主题报告，避免报告引用自身成为证据。

先全文提取未勾选项及“待做、未实现、尚未、后续、延期”等表述，再核对所属章节、当前规范、实现拥有者、调用入口、后续完成记录与相关测试。不能只凭一个 `Draft` / `In Progress` 标签或未勾选框判断没有完成。

保留项分为三类：

- **实现/接线缺口**：当前源码能够支持“这部分还没有交付”。
- **草案/明确延期/定期复审**：确实仍未落地，但不等于已获批准、必须立即做的缺陷。
- **验收证据缺口**：只能确认所查仓库记录没有完成证明，不能据此断言实际环境失败、尚未部署或秘密仍然有效。

不访问真实账号、生产数据库或凭据，不运行安装、发布或真实直播互动；不把模拟/隔离测试写成真实直播间或线上验收。

## 2. 保留事项总览

| 编号 | 仍需处理的主题 | 准确状态 |
| --- | --- | --- |
| 01 | 统一日志 A1 之后的轮转、故障上下文、诊断页面和上报 | 已接受分期，后续未完整落地 |
| 02 | AI 请求审计表的保留期清理 | 旧治理计划中的具体缺口仍存在 |
| 03 | 手动检查客户端资源完整性 | Draft，尚未接线 |
| 04 | 动态抽奖多奖项、领奖、导出、公示与完整验收 | 简化流程已实现，后续范围未交付 |
| 05 | 礼物历史恢复的用户确认、暂停/继续及共享预算 | 查询优化已完成，其余仍为提案 |
| 06 | 粉丝档案第三阶段增强能力 | 首发已实现；仅保留明确后续部分 |
| 07 | 两端弹幕共享源码 F07 与 protobuf 读取器 S04 | 用户明确延期，不自动恢复 |
| 08 | J01 客户端接入统一授权 golden vectors | 客户端未接入；服务器已提交，不再是旧阻塞理由 |
| 09 | Windows 强制签名及上传前发布者验签门禁 | 工具已有，强制发布门禁未接通 |
| 10 | 已登记模块化/长函数债务的复审 | 有期限的存量治理，不是重新机械拆文件 |
| 11 | 主窗口 Electron 沙箱兼容性评估 | 主窗口仍保留例外，缺实际兼容验收 |
| 12 | 投票/评分真实直播间 C0 及端到端验收 | 功能已实现，真实环境证据待补 |
| 13 | 云端签到/抽签的真实持续运行验收 | 代码与自动化已有，E 阶段证据待补 |
| 14 | 使用指南的成功状态配图与网页文档发布确认 | 手册正文已有落地，不能再整体列为未做 |
| 15 | 生产认证 SSE 持续交付与完整恢复演练 | 客户端计划提及的跨端运维证据，不是客户端代码缺失 |

## 3. 实现、延期与设计事项

### 01. 统一日志后续阶段

- **原文**：[日志设计](../../specs/client-server-logging-design.md)第 1 段和第 8 节；[ADR-0018](../architecture/adr/0018-unified-logging-and-diagnostics.md)；[专项报告](2026-09-14-log-volume-and-signal-report.md)开头补记。
- **已经有**：源头降噪、AI 成功汇总、脱敏、单条/队列/单文件容量保护，不能写成“没有日志治理”。
- **剩余范围**：统一分流及日期/容量轮转与保留；跨重启日预算；有限故障上下文及采集健康；客户端查看/安全导出；服务器问题聚合与状态处理；用户允许后的 Device 问题摘要上报、去重和离线重试。跨端部署需要另行验证。
- **实现依据**：[desktop-logger.js](../../src/electron/desktop-logger.js)、[terminal-log.js](../../src/electron/terminal-log.js)、[request-logger.js](../../src/ai/request-logger.js)、[log-size-limit.js](../../src/shared/log-size-limit.js)仍以容量准入/停止追加为主；[支持页面](../../public/pages/admin/toolbox/desktop-update.html)提供打开数据/日志目录，不是完整诊断中心。
- **边界**：已有 AI runtime/errors 分流不等于统一轮转已完成；原生 dump、外部日志平台只是条件性远期建议，不列为当前承诺。

### 02. AI 请求审计表保留期

- **原文**：[旧代码治理计划](../../specs/plans/archive/2026-08-17-existing-code-governance-remediation.md)Deliverable 4.3，尤其 `aiRequestLogRetentionDays`、30 天建议和 dry-run/实删计数。
- **剩余范围**：`ai_request_logs` 的按时间清理及结果统计没有进入当前保留期策略；需在实施前明确是否仍采用旧计划建议的默认天数。
- **实现依据**：[retention.js](../../src/storage/retention.js)的 `DEFAULT_POLICY` 和 `applyRetentionPolicies` 处理礼物、点歌、醒目留言及 cooldown，没有 AI 请求审计表；[config-store.js](../../src/ai/config-store.js)仍写该表；[database-clear-operations.js](../../src/storage/database-clear-operations.js)只有显式全量清理路径。
- **第二轮复现**：Node 原生 SQLite `:memory:` 中放入一条 2000-01-01 的合成审计记录；经真实 `readRetentionPolicy`、dry-run 和实际 `applyRetentionPolicies` 后仍为 1 条，策略不读取 `aiRequestLogRetentionDays`，结果也没有 AI 审计计数。探针结束关闭内存库，未访问任何业务库。
- **剔除同组误报**：AI shutdown 的 AbortController、上下文/缓存 TTL 惰性与按写入清理已有实现，不把 Deliverable 4.3 整组写成未做。AI JSONL 文件轮转是 01，数据库审计表保留期是本项。

### 03. 手动客户端资源完整性检查

- **原文**：[资源完整性设计](../../specs/client-resource-integrity-design.md)，状态 Draft；[规格索引](../../specs/README.md)。
- **剩余范围**：构建清单、最终安装产物核验、主进程受限检查任务、进度/取消/结果 IPC，以及“百宝箱 → 版本更新 → 本地数据与支持”的操作入口。
- **实现依据**：[after-pack.js](../../scripts/after-pack.js)只移除 `default_app.asar`；[支持页面](../../public/pages/admin/toolbox/desktop-update.html)没有检查资源入口；[build-integrity.js](../../src/electron/license/build-integrity.js)计算构建摘要，但没有按随包清单逐项对照的用户操作。
- **边界**：不能把现有 `integrityStatus: verified` 或更新包哈希校验等同于该设计已完成；也不把离线一致性检查写成恶意篡改防护。

### 04. 动态抽奖后续能力和完整验收

- **原文**：[动态抽奖规格](../../specs/bilibili-dynamic-lottery_design.md)开头及第 16 节；[实施计划](../../specs/plans/2026-09-14-bilibili-dynamic-lottery.md)当前状态/M2–M4。
- **已经有**：独立登录、活动创建、评论及点赞/转发条件、按需关注核验、开奖与递补、任务暂停/继续、历史结果。已有定向测试，不能沿用“抽奖完全没做/完全没测试”。
- **剩余范围**：多奖项编排、领奖/过期/补抽业务闭环、正式名单/公示图导出、独立公示网页，以及计划明确要求的受控真实账号来源验证和完整恢复矩阵。
- **实现依据**：[routes](../../src/server/routes/dynamic-lottery-routes.js)只注册 state、tasks、tasks/action；[service](../../src/bilibili/dynamic-lottery/service.js)、[rules](../../src/bilibili/dynamic-lottery/rules.js)、[页面](../../public/pages/admin/toolbox/dynamic-lottery.html)及[交互](../../public/js/admin/dynamic-lottery-workflow.js)仍围绕单一 `winnerCount` 与 pause/resume/draw。
- **边界**：来源可用性不能由模拟 provider 测试确认；任意 AND/OR、粉丝牌等额外资格属于待评审扩展，不自动批准。

### 05. 礼物历史恢复控制与预算

- **原文**：[查询与历史同步方案](2026-09-19-database-query-and-history-sync-plan.md)开头、第五至八节及第九节。
- **剩余范围**：首次历史下载确认、进度/暂停/继续、将实时增量与可选历史恢复分开，以及服务器统一的历史下载并发/字节预算；相关服务器查询设计须分别评审。
- **实现依据**：[remote-gift-controller.js](../../src/electron/remote-gift-controller.js)的 `bootstrapHistory` 仍自动分页恢复，再进入同步流程；当前管理页/IPC 没有该方案的用户控制入口。
- **边界**：现有自动 bootstrap、断线恢复、cursor 幂等与已完成的查询优化均保留；本项不等于“同步坏了”。100 KB/s 等方案值不是已生效的生产限制，也不覆盖所有其他下载。

### 06. 粉丝档案第三阶段

- **原文**：[规格](../../specs/fan-profiles.md)开头明确第三阶段不在首发范围；[调研设计](2026-09-18-fan-profile-research-and-design.md)第 11.4、13 节。
- **剩余范围**：外部 CSV/其他工具档案导入及字段/冲突映射、完整农历自动换算规则、工作台日历联动；每项仍需独立需求和验收。
- **实现依据**：[profile-transfer.js](../../src/fans/profile-transfer.js)支持 LIRA 备份恢复、恢复点、本机旧点歌导入和列表导出，不是通用外部表格导入；[生日表单](../../public/js/admin/fans/forms.js)与[提醒 owner](../../src/fans/reminders.js)已支持农历资料和手工“今年提醒日期”，不能称为完全不支持农历；[工作台](../../public/js/admin/streamer-planner.js)与[日历视图](../../public/js/admin/streamer-planner-view.js)没有消费粉丝提醒。
- **边界**：自动建档、会员事实、点歌归档、档案恢复等首发能力不列为待做；跨电脑同步、舰礼履约是按需求再考虑的方向，不宣称已经立项。

### 07. F07 / S04 共享源码分发

- **原文**：[ADR-0020](../architecture/adr/0020-shared-danmaku-source.md)仍为 proposed，Acceptance 明确 2026-09-21 用户延期；[复用/模块化实施计划](../../specs/plans/2026-09-21-client-server-reuse-modularity.md)F07、S04 及最终记录。
- **剩余范围**：弹幕纯样式/渲染共同源码的唯一维护源、受控快照分发与哈希检查；S04 的 protobuf 字节读取公共接口依赖同一分发决策。
- **实现依据**：提案中的两仓 `scripts/sync-danmaku-source.cjs` 均不存在；消费者仍在各自仓库维护。
- **边界**：保留现有两端行为差异，不把所有相似代码强行合并；必须待用户恢复并接受方案后实施。

### 08. J01 客户端 golden vectors 接入

- **原文**：[测试维护计划](../../specs/plans/archive/2026-09-21-test-suite-maintenance.md)J01；[审计报告](2026-09-21-test-suite-maintenance-audit.md)第 5、10 节。
- **剩余范围**：客户端把授权 canonical 手写 golden 常量迁移为受锁定版本及哈希保护的统一 fixture 消费，继续各测独立实现。
- **实现依据**：[license-protocol.test.js](../../test/license/license-protocol.test.js)仍维护 `ACTIVATION_GOLDEN` / `AUTH_GOLDEN`；[lock](../../server-contract.lock.json)未登记 `docs/protocol/fixtures/device-auth-v2-vectors.json`。
- **纠正旧阻塞理由**：服务器该文件已有实际提交 `6b2bd4d3ce38f9f7dfb68e0e4a6e4657ef9455fa`（2026-09-21）。所以只保留“客户端尚未采纳”，剔除“仍须等待服务器创建提交”。更新锁仍须审核实际固定提交，不能直接改为任意 HEAD。

### 09. Windows 强制签名与上传前验签

- **原文**：[签名文档](../reference/engineering/code-signing.md)当前状态及第五节；[旧治理计划](../../specs/plans/archive/2026-08-17-existing-code-governance-remediation.md)Deliverable 5.1。
- **剩余范围**：明确并落实项目强制签名策略，以及在任何上传之前拒绝无效、无签名或发布者不匹配的产物。
- **实现依据**：[sign-windows.js](../../scripts/sign-windows.js)和[verify-windows-release.js](../../scripts/verify-windows-release.js)已经存在；[package.json](../../package.json)未接入相应签名钩子/发布者配置，[publish-release.js](../../scripts/publish-release.js)仍调用 builder 的发布流程，没有串入该验签脚本。
- **边界**：现有 SHA/远端资产一致性核验不是发布者认证；builder 可能从外部环境取得签名配置，因此本报告不声称所有现有安装包都未签名，也不推断用户是否已有证书。能确认缺少的是仓库入口的强制/上传前验签门禁，本次不执行签名或发布。

### 10. 已登记模块化与长函数债务

- **原文**：[modularity-debt.md](../architecture/engineering/modularity-debt.md)及其[当前基线](../architecture/engineering/modularity-baseline.json)。
- **剩余范围**：对仍登记的 review/legacy/exception 和函数跨度按 owner 复审，按独立职责收敛，不按历史文件数量机械拆分。
- **期限**：一般登记为 2026-12-13 前或实质修改时复核；粉丝档案新增函数债务为 2026-12-18 前或扩展相关能力时复核。两日期在本次核验时均未到期。
- **当前门禁结果**：本次 `verify:modularity` 发现 3 个现有改动文件进入 601–800 行但尚缺逐文件 review：`public/css/admin/toolbox/fan-profiles.css` 616 行、`public/js/admin/fans/index.js` 646 行、`test/frontend-fan-profiles.test.js` 670 行。应由相应改动完成边界复审/登记或职责收敛，不应直接提高上限。本次没有修改这些文件。
- **边界**：门禁通过说明符合当前登记，不证明所有函数债务消失；旧报告中的 B/C/D 批次、旧行数和旧超限总数不能继续列为未实施任务。

### 11. 主窗口沙箱兼容评估

- **原文**：[两端架构审计](2026-09-16-client-server-architecture-audit.md)A3、7.6 和后续实施补记，要求用真实 Electron 证据处理沙箱例外。
- **实现依据**：[main.js](../../src/electron/main.js)主窗口仍是 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`；[音乐登录窗口](../../src/electron/music-login-window.js)、[B 站登录窗口](../../src/electron/bilibili-login-window.js)和[礼物导出窗口](../../src/electron/gift-export-controller.js)已经是 `sandbox: true`。
- **剩余范围**：仅对主窗口 preload/IPC 的沙箱兼容性做隔离真实环境核验，再决定取消或重新论证例外。
- **边界**：不称为已证实可利用漏洞，不建议直接把 false 改为 true；不把已启用沙箱的其他窗口重复列入。

## 4. 仍缺仓库验收记录的事项

以下不是“功能未实现”或“线上失败”的结论。保留的是文档明确要求且所查记录仍未闭环的证据工作；实际完成证明出现后即可关闭。

### 12. 投票 / 评分 C0

- **原文**：[规格](../../specs/games-poll-rating_design.md)状态；[计划](../../specs/plans/games-poll-rating.md)M0/C0、M3。
- **剩余证据**：受控真实房间的归属/实时链路；同一观众 UID 稳定、不同观众可区分、主播被排除；平台事件 ID/时间字段实际语义；真实计数、冻结及结算结果。
- **边界**：功能与隔离测试已存在，不以收到首条弹幕或合成输入冒充 C0。

### 13. 云端签到 / 抽签 E 阶段

- **原文**：[实施计划](../../specs/plans/2026-09-18-cloud-daily-bots.md)最终 rollout boundary。
- **剩余证据**：关闭桌面、未开播、凭据异常、服务器重启以及跨北京时间零点的真实运行验收。
- **边界**：不保留旧的首次接管表单工作；它已被[直接启用方案](../../specs/plans/archive/2026-09-18-daily-bots-direct-start.md)取代。旧计划的“当时未部署”不是 2026-09-26 的部署结论。

### 14. 使用指南成功状态与发布确认

- **原文**：[补充方案](../../specs/plans/2026-09-22-usage-guide-supplement.md)第十章、附录 D.2；[复核报告](2026-09-22-usage-guide-review.md)。
- **剩余证据**：与真实操作一致的登录/连接、实际歌词、抽奖结果、AI 成功反馈、真实同步及更新成功状态、OBS 添加来源；隔离档案的提醒/恢复与游戏/结算配图按 D.2 补齐。独立网页文档的发布位置及正式链接仍需确认。
- **已剔除范围**：不能把正式手册 HTML、粉丝档案章节、动态抽奖说明等整体写成没落地；[toolbox](../../public/pages/admin/toolbox/usage-guide-toolbox.html)、[FAQ](../../public/pages/admin/toolbox/usage-guide-faq.html)等已经存在实际内容。
- **边界**：旧配图说明中的 `getGlobalSnapshot` 报错不直接作为当前产品 bug；这里要求的是成功流程证据，而非未经复现地安排修复。演示截图可作操作说明，但不能替代实测。

### 15. 跨端生产验收

- **原文**：[2026-09-25 后续审计计划](../../specs/plans/2026-09-25-audit-followup.md)Completion evidence；第二轮追踪到重整后的[最终审计汇总](../../../lira-audit/05-第五次两端三轮审计-2026-09-25/final-audit-summary.md)，仍将认证 SSE 持续交付和完整恢复保留为证据缺口。旧计划中的个别过程报告路径已经移走，不以失效路径充当证据。
- **剩余证据**：认证后的生产 SSE 持续交付；完整生产恢复演练和独立保管的恢复密钥证明。
- **边界**：匿名拒绝、Nginx/Host 检查、备份 SQLite 完整性/FK 检查已做，不能重复列为未完成；只读校验不等于完整恢复。该项由客户端文档引出，责任属于跨端运维，本次不连接生产。

## 5. 从待办清单中剔除的常见误报

此节仅解释筛选结果，不是另一个待办列表。

- 开播动画的设置持久化、角色上传和礼物边框：旧 Draft/未勾选项被当前实现与测试反证，剔除。
- 2026-09-17 的 15 项旧“明确修复候选”：有[后续修复记录](../../specs/plans/archive/2026-09-18-current-review-remediation.md)，不能整表复制；礼物数量上限、IPC/登录时序和 Admin Host 等还有 2026-09-25 后续处理。未取得真实业务证据的旧条件风险不列为已证实缺陷。
- 首次引导、云端同步、歌词调度、公共目录/盲盒映射、查询优化、手册 HTML 等：以当前 owner/消费者为准，不凭归档遗漏或未勾选状态重复排期。
- 历史“全套门禁失败/缺索引”：不等于当前失败，已被后续完整验证或当前索引覆盖；不沿用旧测试计数。
- GitHub Check 工作流托管启用：现行[构建文档](../reference/engineering/build.md)明确已经移除该工作流，改为 Windows/Node 24 本地发布前验证，不恢复旧的启用任务。
- 历史会话撤销确认：初稿曾按 2026-09-25 计划保留；第二轮发现重整后的[最终审计汇总](../../../lira-audit/05-第五次两端三轮审计-2026-09-25/final-audit-summary.md)第 3.3 节已按用户决定关闭该待办，因此从最终清单删除，不恢复用户已经取消的事项。该决定不等于证明历史会话有效或无效。
- J01 的“服务器还没提交”、农历“完全不支持”、所有 Electron 窗口“未沙箱化”：均收窄为第 08、06、11 项的真实剩余范围。
- `pending` 运行状态、引导“下一步”、错误提示“未完成”、正常重连重试、可选非目标，以及为将来假设条件准备的建议：不自动成为开发待办。

## 6. 两轮核验记录

### 第一轮：正向核对

- 在候选初稿写入后，检查文档上下文、实现入口和后续计划，合并重复主题；明确了 J01 已有服务器提交、当前农历仅缺自动规则、签名脚本已有但未接入等边界。
- 17 个相关测试文件共 **113 项通过，0 失败、0 跳过**：日志/脱敏与构建摘要、授权 canonical、签名/发布、抽奖采集/结果/事务、粉丝档案/传输、小游戏、礼物边框和开场上传/设置。
- 测试采用既有内存/临时数据夹具，没有替用户登录、连接生产或启动发布。

### 第二轮：反向核对

在第一轮收敛文档写入后，再从当前实现与后续记录反查：

| 事项 | 第二轮检查与处理结果 |
| --- | --- |
| 01–03 | 再查日志容量 helper、支持页及现有构建摘要；排除“已有目录按钮/摘要等于新诊断能力”的误判。用纯内存数据库复现 02，不把上下文 TTL 或全量清库当作审计保留期。 |
| 04–06 | 核对抽奖实际 action 白名单、自动 bootstrap 在 SSE 前的调用顺序、传输服务 action 分派、农历手动提醒分支和工作台消费者；保留缺少的具体范围，剔除已实现首发。 |
| 07–09 | 再查两仓脚本、真实服务器 commit、客户端 fixture lock/消费方式以及 publisher 验证脚本的调用方；确认延期与未接线，剔除旧的 J01 等待提交理由，并避免断言所有安装包都未签名。 |
| 10–11 | 运行当前模块化门禁，逐个比对主窗口/登录窗口/导出窗口沙箱设置；记录真实的规模登记失败，只保留主窗口例外评估。 |
| 12–14 | 检查投票/评分实际会话与路由、daily-bots 后续直接启用方案、现有使用手册和配图；自动化通过不冒充真实房间、跨日或实际成功状态验收。 |
| 15 与剔除项 | 追踪已重新归档的最终审计汇总。生产 SSE/恢复缺证据仍保留；历史个人会话确认已经被用户关闭，删除。 |

- 第二轮 12 个直接相关测试文件共 **113 项通过，0 失败、0 跳过**，覆盖互动会话/路由/前端、daily-bots、粉丝音乐与前端、礼物同步/对账、AI 缓存保留、Windows 验签和实际使用指南。两轮合计 **226 项通过**。
- 使用文档初始扫描的 SHA-256 与收尾时源文档逐一比对，没有发现源文档内容变化；`docs/` / `specs/` 没有被 Git 忽略而遗漏的文本说明。
- 本地链接、编号、差异空白与最终范围另行检查；没有把待验证预期冒充通过结果。

### 检查命令与限制

第一轮：

```powershell
node --test --test-concurrency=4 test/desktop-logger.test.js test/terminal-log.test.js test/ai-request-logger.test.js test/license-protocol.test.js test/sign-windows.test.js test/publish-release.test.js test/build-integrity.test.js test/dynamic-lottery-results.test.js test/dynamic-lottery-collection.test.js test/dynamic-lottery-transaction.test.js test/fan-profiles-transfer.test.js test/fan-profiles-domain.test.js test/games.test.js test/gift-frame-config.test.js test/gift-frame-draft.test.js test/opening-overlay.test.js test/opening-upload-api.test.js
```

第二轮：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/interactions.test.js test/interaction-routes.test.js test/frontend-interactions.test.js test/daily-bot-controller.test.js test/daily-bot-frontend.test.js test/fan-profiles-music.test.js test/frontend-fan-profiles.test.js test/remote-gift-controller.test.js test/remote-gift-controller-reconciliation.test.js test/ai-cache-retention.test.js test/verify-windows-release.test.js test/frontend-usage-guide.test.js
npm run verify:docs
npm run verify:modularity
git diff --check
```

**不能称为全库门禁全绿：** `verify:docs` 为 4/5 通过，失败在原有改动的 `specs/README.md:13`，新增资源检查条目的 Runtime Evidence 单元格不符合 `GOV-SPEC-004` 的路径格式；`verify:modularity` 扫描 1,294 个文件，存在第 10 项列出的 3 个缺 review 文件。本次未修改这些文件，也不为审查文档顺手修改并行功能。没有运行全库测试、安装器或生产验收。
