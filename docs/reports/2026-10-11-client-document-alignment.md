# 客户端实现与文档差异核对

日期：2026-10-11。基线：客户端工作区 `fda0de643a9cf411ec8cebb7c81ed491704480e1` 及任务开始前已有的未提交修改；不把这些已有修改计入本次成果。按当前规格、Accepted ADR、所属参考和调用链核对，已修复两类更新器行为错误，并修正文档中的确定事实错误。初次审查留下的三项规则分歧已获用户后续指示，见[第 7 节](#7-用户后续裁决与实施)。

## 1. 范围与判断依据

核对入口为[事实地图](../reference/README.md)、[领域路由](../architecture/engineering/ai-workflow.md)、[规格索引](../../specs/README.md)和[未结项台账](../../specs/plans/open-items.md)。检查了 HTTP 路由与方法登记、preload 通道、更新器及其消费者、HTTP/WS 和礼物同步边界、存储迁移与默认值、播放保存与恢复、歌词、AI 配额与发送重试、工程命令和相关使用指导。

路由和 IPC 采用登记与实现对照；业务语义按所属模块、直接调用方和相关测试定向核验。本文不是逐行穷尽证明，也不把 Draft、Paused、Deferred 或欠缺实机验收等同于现有实现缺陷。审查过程与约束见[实施记录](../../specs/plans/archive/2026-10-11-client-doc-alignment.md)。

## 2. 已直接修复的代码

### C1. 更新检查或下载的错误分类被二次覆盖

- 原行为：更新器先发出 error 事件、随后 Promise 拒绝时，GitHub 缺少更新包的 404 先映射成 `not-available`，再被 catch 强制改成 `error`。这违反[现有错误映射合同](../reference/desktop/update.md)。
- 修改：[update-manager.js](../../src/electron/update-manager.js) 的 `checkForUpdates`、`downloadUpdate` catch 保留 `friendlyUpdateError` 返回的 status/message，使事件与拒绝路径一致。
- 验证：在既有测试中模拟“先发 error、再拒绝 Promise”的两种操作；修复前失败，修复后通过。

### C2. 失败、重试和安装时遗留旧下载进度

- 原行为：状态以合并方式更新，错误或安装状态可能保留上一轮 80%/100% 进度；重试开始时也可能显示旧进度。合同规定只有 downloading/downloaded 状态持有下载进度。
- 修改：更新状态 owner 在其他状态统一清空 progress，手动下载开始时清空旧进度；[desktop-update-controller.js](../../src/electron/desktop-update-controller.js) 的外层错误投递也清空 progress。保留版本信息及现有下载、安装和安全策略。
- 验证：覆盖失败后清空、重试开始清空、安装时清空但保留目标版本，以及外层控制器失败路径。没有下载或安装真实更新。

回归落在 [update-manager.test.js](../../test/desktop/update-manager.test.js)、[desktop-update-controller.test.js](../../test/desktop/desktop-update-controller.test.js)，同时运行既有前端更新状态测试。修改前新增/扩展断言共出现 5 个预期失败；修改后 16/16 通过。

## 3. 已修正的文档事实

| 所属文档 | 原偏差及修正 | 判断证据 |
| --- | --- | --- |
| [preload](../reference/desktop/preload.md) | 首段漏记 `plannerReminders`；命名空间由 8 个改为 9 个 | preload 实际暴露及本文既有通道表 |
| [存储](../reference/backend/storage.md) | 业务表 44→47，点歌库 20→23；补齐场景、共享尺寸、画布三张表；像素卡带默认画质 `normal`→`high`；旧 onboarding 键改记为兼容记录 | 在隔离临时目录创建空库并执行现有迁移，查询六库表清单；对照默认设置、API 参考和交互式引导 owner。没有改数据库或默认值 |
| [服务器主干](../reference/backend/server-core.md)、[前端通讯](../reference/frontend/comms.md) | 静态页真实 owner 是 `page-assets.js`；`sendJson` 负责序列化，响应信封由 handler 构造 | runtime-transport 调用链、HTTP 工具实现及 API 注册表 |
| [播放](../reference/frontend/playback.md)、[播放使用指南](../../public/pages/admin/toolbox/usage-guide-playback.html) | 更正“不保存播放位置”、保存失败“只丢弃”、卸载/正常关闭通道混写；记录未保存与恢复成功提示。localStorage 现状明确为旧数据恢复/迁移，持续备份策略列 U1 | `createStatePersistence`、快照构造/恢复、控制器实际调用及保存顺序回归 |
| [播放](../reference/frontend/playback.md)、[参考索引](../reference/README.md) | 本地媒体允许清单名改为 `local-media-access.json`；去除已过时的独立歌词 Electron 窗口描述，指向 `/lyrics` 浏览器源 | 本地媒体访问 owner、现行页面/窗口入口 |
| [前端通讯](../reference/frontend/comms.md) | renderer 的授权身份投影可能包含 UID；连续且合格的 SSE final 可原子提交游标，不能再称仅 HTTP pull 可推进；歌词页 bootstrap 会补入本机 WS 的 lyrics 凭据 | 远端礼物 owner、[ADR-0021](../architecture/adr/0021-atomic-live-gift-progress.md)、[overlay-bootstrap.js](../../src/server/overlay-bootstrap.js) |
| [叠加层](../reference/frontend/overlays.md) | 歌词源与管理页共用 `lyrics/desktop-lyric-renderer.js`，不是直接依赖 admin 预览模块 | 两个消费者的 import；未改渲染效果 |
| [AI](../reference/backend/ai.md) | 初次审查时工具经 `withApiQuota` 预扣、成功提交、抛错退回，后续已按第 7 节改为发起请求即计数；最多发送 3 次是“首次 + 2 次重试”，不是重试 3 次；发送直接抛错不走未确认送达重试 | 配额 owner、天气/地图调用方、`deliverReply` 及既有测试；配额规则见第 7 节 |
| [构建](../reference/engineering/build.md)、[测试](../reference/engineering/test.md)、[D2 台账](../../specs/plans/open-items.md#d2-文件职责与长函数的后续复审) | js-yaml override 更新为 `^4.3.2`，去掉无当前审计依据的“0 高危”断言；更新状态图归还 owner；说明 Playwright 开发依赖；不再沿用旧文件规模额度/到期登记政策 | package.json/lock、[ADR-0023](../architecture/adr/0023-purpose-aware-file-size-review.md) 与当前检查器。未变更依赖，也未声称运行了安全审计 |

测试只扩展更新器的具体缺口；其他文档事实使用既有覆盖和源码证据。用户指导仅补充与保存失败有关的操作说明，其他纠错不改变用户入口、步骤或界面，因此未重写其他指南、引导配置或截图。

## 4. 初次审查留下的规则分歧

### U1. 播放状态是否需要持续本地备份

原参考宣称 `playbackState:v2` 是 1500ms 防抖更新的本地镜像，但 [controller.js](../../public/js/playback/controller.js) 只调用 `StorageManager.restoreState()`，没有调用 `saveState()`。日常保存由 [state-persistence.js](../../public/js/playback/operations/state-persistence.js) 经 HTTP/IPC 写入 SQLite；[storage.js](../../public/js/playback/state/storage.js) 读取旧 v2、迁移 v1 时才写 v2。

已修正参考中的现状描述。后续用户确认测试阶段先保留现有备份与恢复兼容，本轮不改持久化行为；持续镜像接入暂缓，见 [B10](../../specs/plans/open-items.md#b10-播放状态的本地备份策略)。

### U2. 微唱歌词偏移范围采用 1.5 秒还是 3 秒

[已登记 Implemented 的规格](../../specs/wesing-lyric-sync-controls_design.md)在初次审查时的需求、UI 和安全校验中都写 ±1500ms；实际 [wesing-cache.js](../../src/music/wesing-cache.js)、[前端输入校验](../../public/js/playback/services/wesing-service.js)、[技术参考](../reference/backend/music/wesing.md)、使用指南和既有测试均为 ±3000ms，测试明确接受 3000、拒绝 3001。

后续用户明确采用 ±3 秒，已将规格中的三处范围同步到当前实现，B11 关闭。此项与独立歌词组件的 ±5000ms 偏移及微唱的 1500ms 暂停检测窗口是不同设置。

### U3. AI 第三方配额按尝试、接受还是成功计数

参考将其称为防账单失控的“安全用量上限”，但初次审查时 [withApiQuota](../../src/ai/api-quota-store.js) 对所有抛错操作退回预扣，包括超时或传输结果不确定的请求。源码不能证明这些请求是否被供应商计费，也不能据此推断已经超支。

后续用户授权参考常见实践决定并实施，现已采用发起请求计数，具体依据和行为见第 7 节。[旧暂停计划](../../specs/plans/2026-09-17-audit-remediation.md)的 R4-AI-QUOTA-REFUND 单项关闭，其他暂停范围不变。

## 5. 没有作为本次代码缺陷处理的事项

- 动态抽奖规格顶部有更新后的简化范围，旧 M2–M4 多奖项、领奖、导出、公示页不是当前已接受的补做任务；真实上游完整性及受控账号验收仍缺证据，见[现行计划](../../specs/plans/2026-09-14-bilibili-dynamic-lottery.md)。
- 日志诊断后续阶段、Windows 签名接入及正式签名安装验收有明确延期或前置条件；已有脚本不等于正式产物已完成签名。保留[原台账](../../specs/plans/open-items.md)和[签名计划](../../specs/plans/windows-code-signing.md)的状态。
- 本地与远端弹幕样式枚举是不同合同，不能仅因数量不同而合并；旧审计中已被新 ADR/实现覆盖的歌词依赖问题也未重复列为缺陷。

## 6. 验证结果与限制

环境为 Windows / Node.js v24.21.0。临时数据、任务前文件快照和日志均在仓库 `tmp/client-doc-audit-2026-10-11/`，没有使用真实用户数据库或账号。

| 检查 | 结果 |
| --- | --- |
| `node --experimental-vm-modules --test test/desktop/update-manager.test.js test/desktop/desktop-update-controller.test.js test/desktop/frontend-desktop-update.test.js` | 16/16，通过；修复前 5 个预期失败有独立日志 |
| 下列 8 个既有测试文件，以 `node --experimental-vm-modules --test` 运行 | 88/88，通过 |
| 两个变更实现文件及两个更新器测试文件的 `node --check` | 全部通过 |
| 空库迁移后的 sqlite_master 查询 | 六库业务表数分别 23/1/8/5/1/9，合计 47，不含 schema_version 与 SQLite 内部表 |
| `npm run verify:contracts` 默认服务器检出 | 版本不匹配：要求 `01fb2b47d5e081f5dd559933991ade4819eb3428`，相邻服务器工作区为 `6c288bac7de67f2fb09941db25b72275c194d9fb` |
| 隔离检出已有锁定提交后运行 `node scripts/verify-server-contract.js <临时检出目录>` | 10 个夹具 SHA-256 全部通过；临时检出已确认干净并移除，没有调整锁、切换用户服务器分支或下载依赖 |
| `npm run verify:docs` | 10/10，通过 |
| 增量 diff、`git diff --check` 与 `git status --short` | 检查通过；任务前快照用于区分并保留用户已有改动，无本次生成物或运行数据进入变更 |

88 项相关回归的文件为：

- `test/admin/frontend-usage-guide.test.js`
- `test/admin/admin-page-composition.test.js`
- `test/playback/playback-persistence.test.js`
- `test/playback/playback-snapshot-ordering.test.js`
- `test/overlays/opening-independent-settings.test.js`
- `test/gifts/remote-gift-controller-commit.test.js`
- `test/ai/ai-assistant-delivery.test.js`
- `test/ai/ai-api-quota-store.test.js`

契约夹具通过只证明客户端锁定输入一致，不证明相邻服务器当前分支或线上部署兼容。本次未运行全量套件、实际 Electron UI、正式安装/更新包、真实平台与生产环境验收；更新器行为由隔离替身和消费者测试验证。没有提交、发布或部署。

## 7. 用户后续裁决与实施

2026-10-11 用户要求测试阶段先保留备份、歌词偏移采用 3 秒，并授权参考常见实践确定配额策略。播放保留当前保存和旧副本恢复路径；微唱只同步规格，已有范围和保存值无需迁移。

配额采用请求次数预算：[express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration#skipfailedrequests) 默认不排除失败请求。供应商账单的规则可能不同，例如[和风天气 FAQ](https://dev.qweather.com/help/)明确非 2xx 不统计请求；因此不将本机安全计数冒充真实账单，也不推断失败请求一定收费。

- 在 `withApiQuota` 中先消费并提交一次额度，再执行已有请求操作；失败不再退回。网络失败、超时、业务拒绝、发起后取消、解析失败或无可用结果都计入，连接测试和每个上游子请求也计入。
- 天气与地图工具在进入配额操作前复用 `throwIfAborted`；发送前已经取消的任务不消费、不调用 fetch。缺配置和额度耗尽同样不发请求。
- 月度上限、北京时间切月、表结构和已有计数保留；过去已退回的失败无法可靠恢复，不补记。未新增依赖或修改公共接口。
- 技术参考、AI 使用指南和旧台账已同步；新回归先得到 8 个预期失败，修改后配额/工具测试 18/18、AI 调用方与微唱测试 45/45、指南测试 26/26 通过，合计 89 项。文档门禁 10/10、五个变更 JS 文件语法检查、增量 diff 与 `git diff --check` 均通过；已核对工作区状态并保留前轮及用户原有改动。

后续实施过程见[裁决记录](../../specs/plans/archive/2026-10-11-client-doc-decisions.md)，本轮日志和修改前快照在 `tmp/client-doc-followup-2026-10-11/`；天气/地图上游请求均用替身验证，未使用真实平台账号或用户数据库，未运行全量套件或真实桌面验收。
