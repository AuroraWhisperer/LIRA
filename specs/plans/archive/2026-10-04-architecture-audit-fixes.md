# Architecture Audit Fixes Implementation Plan

Status: Completed

## Goal

修复 2026-10-04 审查确认的三项缺陷：AI 旧会话任务跨房间发送、场景礼物组件缺少真实装配能力、组件保存响应覆盖更新权威配置。恢复审查发现的失效离线回归检查。

## Non-goals

不实施报告中的可选 Provider/旧播放存储重构，不改变公共 HTTP/WS/IPC 契约或持久化格式，不处理暂停的旧计划，不提交或发布，不切换相邻服务器仓库。

## Current Behavior

审查证据在 `tmp/architecture-audit-2026-10-04/report.md`：AI service + sender 的可控 Promise 复现将房间 100 的回复发到 200；真实 createServerRuntime 下 gift-feed/gift-wishes 场景输出 500；组件 receive 新配置后迟到 persist 回包覆盖 saved/draft。offline 基线 3,123 项，3,113 通过、10 失败，失败是 DOM 替身、文本断言及 CSS 规模记录。当前源码包含用户未提交改动；本轮起始内容已保存于 `tmp/architecture-fixes-2026-10-04/baseline-files.json`。

## Ownership

- M1：`src/server/bilibili-runtime.js` / `bilibili-client.js` 持有输入与会话边界，`src/ai/ai-assistant-service.js` 持有生成/交付，`src/bilibili/danmaku/sender-service.js` 持有发送队列/分段。消费者和装配包括 `src/server/ai-runtime.js`；参考 backend Bilibili/AI 文档及 AI/sender/runtime 测试。
- M2：`src/server/api-context.js` 显式转发领域礼物读能力；`scene-extra-display.js` 消费真实 getter，`test/scenes/` 覆盖完整运行时装配。
- M3：`public/js/admin/component-config-controller.js` 持有草稿与保存确认，settings save/sync adapter 和 StateService 提供权威配置；页面继续复用控制器。相关 contract 在 frontend app 参考。
- S1：对应 gift/frontend 测试及 fixture、工程规模登记。仅修复缺失模拟能力/失效断言，不为测试修改产品行为。

## Compatibility Constraints

保留所有既有工作区改动。保持 Electron 授权/secret/session 安全边界、手动即时发送、同房间 AI 限流/重试/分段、组件保存期间本地编辑、reset 失效和正常回声确认。测试隔离数据，不调用外部服务，不运行用户应用。无新依赖、框架或泛化中间层。

## Proposed Changes And Milestones

- [x] M1（独立子代理）：以现有 generation/会话能力绑定 AI 任务，在生成交付、sender 排队等待与分段边界取消失效任务；先加入切房/旧任务回归，验证当前缺陷后最小实现。保持非 AI 发送的现有接口行为。修改范围限 Bilibili/AI owner、必要接线与相关测试，跨到 Electron main 前先与主代理协调。
- [x] M2（独立子代理）：向真实 API context 转发 `gifts.getViewRevision`；用真实 runtime 和合成场景验证两种输出，不只补一个手工 mock。保留投影过滤和 revision 失效语义，暂不扩大成场景端口重构。
- [x] M3（独立子代理）：保存确认考虑期间权威状态变化，保留自己回声及字段 edit revision；顺序无法判定时用既有状态 owner 补读，避免简单丢弃全部 ACK。加入新广播先到、旧广播先到、新本地编辑及 reset 回归，调整必需的 settings adapter 调用方。
- [x] S1（主代理）：补齐 gift 测试 DOM 替身；将三处旧代码文本断言更新到现有 helper 的行为/契约验证；审查 CSS 与登记的差异再对齐记录。运行对应失败文件。
- [x] 整合：主代理按本轮基线审查每项差异，检查行为、遗漏消费者和重复请求/注册；更新必要参考文档及规模登记说明，执行整体验证，归档计划。

## Verification

各子代理先运行自己修改的测试并报告确切命令/结果。最终执行：

1. `node scripts/run-tests.js offline`：多领域及异步边界变化需要完整离线回归，预期全通过。
2. `npm run verify:quick`：文档、JS 语法和模块边界/规模检查，预期通过；不绕过登记或放宽依赖规则。
3. `git diff --check`、`git status --short` 与本轮基线差异审查。原有改动不回滚，不重格式化。

不将上述证据视为真实 Electron/上游端到端验证。邻仓 HEAD 不匹配 server-contract.lock 的已知限制保持记录；本次未改跨仓协议，不以改锁规避门禁。

## Rollback Or Failure Handling

每个缺陷独立变更和验证。失败时查看任务开始的逐文件快照，仅调整本次新增逻辑；禁止 reset、blanket checkout 或覆盖用户改动。异步任务失效时停止后续发送，不把取消记为成功交付。保留测试日志与明确未验证事项。

## Done When

三项缺陷有回归保护且通过，相关基线失败恢复；模块职责和外部契约不变；实际命令与结果、局限写入本计划；最终任务差异和工作区状态审查完成；计划与索引按仓库流程归档。

## Implementation Findings

- M1 使用现有账号操作 generation，而非另造认证状态。房间/provider/代次在准入时同步捕获，当前 UID 由 provider 读取；读取仅对准入后的 AI 任务执行，失败转为取消断言，避免清空等待任务留下拒绝 Promise。新 UID 首条任务不读旧 authCache。已发出的网络请求无法撤回；取消保护后续分段、重试和成功上下文写入。
- M2 补齐实际 getter 后暴露同链路第二处问题：缓存读取起点在原 catch 外。只对明确的 GIFT_SOURCE_UNAVAILABLE/GIFT_VIEW_STALE 返回空组件数据，其他错误继续抛出；真实 runtime 覆盖 source switching 和恢复。
- M3 使用既有 StateService 确认 HTTP/WS 顺序不明的保存，不在无争用或自身回声情况下新增读取；被其他配置取代时返回失败，阻止批量发布误报成功。保留保存期间新字段编辑与 reset 失效。
- 消费者复核发现加班机将旧 HTTP ACK 经 onSavedState 提升为权威 receive；按既有 revision 拒绝旧状态，背景一致的计时更新不阻止保存。StateService 已接受的 connect 快照允许实际降代，降代前的保存 ACK 不得回填，草稿保留。
- S1 修复 DOM 替身和三处过时源码文本断言；CSS 原有变更复审后将 fan-profiles 登记 647→648。main 的 772→774 仅为内部 getter 接线，登记具体职责和验证证据，没有放宽模块依赖规则。
- 首轮整体验证发现两处本轮引起的测试不匹配：实际错误文案替代笼统提示后更新行为断言并保留草稿检查；将 confirm 内部绑定改名 confirmSaved，保持原生 confirm 禁用检查和外部 option 不变。

## Verification Results

定向测试已通过：AI/sender/runtime/auth/lifecycle 121 项，真实场景装配 23 项，组件控制器及主要消费者 99 项，加班机重连补验 45 项，S1 原失败文件 31 项，最终反馈/命名修正相关 43 项。各组有重叠，不合并计数。

额外运行既有隔离运行时验证：`node --experimental-vm-modules --test --test-concurrency=1 test/admin/song-board-settings.test.js test/admin/component-preview-drafts-browser.test.js` 8/8；`node --test test/desktop/desktop-auth-race-electron.test.js` 1/1。浏览器检查验证 DOM/草稿行为，Electron 检查使用隔离 userData/sessionData/data 和合成登录窗口，未启动或重启用户应用。

未覆盖真实模型/Bilibili 发送、OBS/直播姬实播、安装升级以及完整跨仓 roundtrip。相邻 lira-server HEAD 与锁定版本不一致，契约专项在版本门禁处停止；未修改 lock 或相邻仓库。AI 测试早期夹具曾意外请求两次合成 room100 的只读 room_init，后已补 mock 与 fetch 禁用断言；未发送弹幕或使用真实凭据。

最终 `node scripts/run-tests.js offline`：3,168/3,168 通过，0 失败/跳过/取消。`npm run verify:quick`：文档 10/10、1,223 个 JavaScript 文件语法检查、架构 22/22 通过。其后仅改了 confirm 内部变量名和反馈测试断言，相关 43 项与最终 offline 已通过；归档时补跑文档门禁及这两个文件的语法检查。`git diff --check` 通过，并按本轮 1,562 文件快照核对任务差异、最终状态及新增文件；未引入运行数据或凭据，原有改动保留。日志与任务专属 patch 保存于 `tmp/architecture-fixes-2026-10-04/`。
