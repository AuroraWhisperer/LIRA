# 弹幕重连与许可激活并发修复

> 用户已授权并行修改；两个子任务按文件所有权独立实施，由主代理复核合并与文档。遵循根 AGENTS.md 和 PLANS.md，不提交或发布。

**Status:** Completed

## 目标与边界

修复已隔离复现的两个 P3：旧弹幕连接尝试不能干扰替代它的新连接；后台授权检查不能吞掉用户的激活请求。盲盒本机日界符合现有明确契约，不修改。未证实线索、服务端、用户现有音频工作和其他领域均不在范围内。

## 现状与归属

- `src/bilibili/danmaku-client.js` 拥有连接尝试、重试与状态发布；开播监控和自动重连可能在同一 generation 内重叠。已通过真实监控回调加合成 HTTP/socket 复现：新 socket 已鉴权，旧 attempt 的失败仍安排一次重连并关闭新连接。消费者是本地弹幕 runtime；参考归属 `docs/reference/backend/bilibili/danmaku.md`，测试归属 `test/danmaku/danmaku-client.test.js` 与 `danmaku-reconnect-backoff.test.js`。
- `src/electron/license/license-manager.js` 拥有 bootstrap、resume、activate 和生命周期。后台 resume 的 bootstrap 在途时，有效激活经实际 IPC 返回 `{ok:false,state:'checking'}`，请求未发出。页面手动 retry 已有互斥。消费者为 `license-ipc.js` 与 `public/js/license.js`；参考归属 `docs/reference/desktop/main.md`、IPC 返回契约在 `preload.md`；测试复用 `license-manager-harness`、`license-ipc-fixture` 和 `test/license/` 现有套件。

## 约束

保持 HTTP/WS/IPC 形状、状态枚举、持久化格式、鉴权验证、secret 边界与 stop/dispose 行为。不增加依赖、全局锁或通用调度层。保留同类授权操作去重，不允许两个授权操作同时修改会话。验证仅使用合成数据和隔离进程；临时材料放在仓库 `tmp/`，不启动用户应用。

## 并行交付与验收

### A：弹幕连接尝试

- [x] 在现有连接测试中补回归，先观察旧代码失败。
- [x] 让过期 attempt 的异步结果与失败失去操作当前连接和重试状态的资格；保持当前 attempt 的正常失败退避。
- [x] 验证监控和自动重连交错后，新 socket 保持连接、状态不被旧失败改写、无多余重连；保留 stop/restart 取消覆盖。
- [x] 执行 `node --test test/danmaku/danmaku-client.test.js test/danmaku/danmaku-reconnect-backoff.test.js`，必要时仅追加直接相关连接套件。

### B：许可激活

- [x] 用有效入参经实际 IPC 补回归，先观察旧代码丢请求。
- [x] 区分后台 bootstrap 与 activation 的在途归属；激活等待后台检查结束后处理自己的入参，维持对象返回契约与同类去重。
- [x] 覆盖后台检查成功、失败及等待中 dispose；不新建可并发修改会话的独立锁。
- [x] 执行直接相关 `license-manager-identity`、`license-session-boundaries`、`license-ipc`、`license-resume` 测试；涉及维护调度时加入 `license-manager-renewal` 与 `license-manager-revalidation`。

## 集成验证与同步

- [x] 主代理检查两个独立差异及影响范围，复核新增测试不是只断言实现细节。
- [x] 更新两处 owner 技术参考。检查现有用户指南和交互引导；操作入口、步骤、参数未改变时保持原文。
- [x] 复核实际 renderer → IPC → manager 的后台 resume 与激活交错，使用已有合成夹具，不启动 Electron。
- [x] 对改动 JavaScript 执行 `node --check`；运行 `npm run verify:docs` 和 `npm run verify:architecture`。只在失败或新风险需要时扩大验证，不运行全仓功能套件。
- [x] 最后执行 `git diff --check`、检查本任务差异和 `git status --short`，保留原有工作区修改。所有验收通过后记录证据并移至计划归档。

## 失败处理与完成条件

失败时定位到所属子任务，使用聚焦复现修正，不通过放宽断言掩盖错误。需要回退时只反向应用本任务差异，不 reset、checkout 或清理用户文件。两条回归由失败转为通过、相关既有行为保持、技术参考一致且最终差异已复核，才标记完成。未打包、未发布、未使用真实 B 站或授权服务。

## 验证记录（2026-10-21）

- 弹幕新增四项回归：旧 room 请求迟到成功、迟到失败、等待 open 的 socket 被替代，以及新尝试等待 HTTP 时旧 socket 关闭。前三项在修复前全部失败；修复后上述两份套件 **19/19** 通过。
- 许可新增三项回归：resume 成功、resume 失败、等待时 dispose。修复前 **3/3** 失败，修复后通过；成功/失败案例均经实际 IPC，并断言两个等待提交只发一次激活、输入被原样处理。
- `node --test test/license/license-manager-revalidation.test.js test/license/license-manager-identity.test.js test/license/license-manager-renewal.test.js test/license/license-session-boundaries.test.js test/license/license-ipc.test.js test/license/license-resume.test.js test/license/license-retry.test.js test/license/license-activation.test.js`：**101/101** 通过。
- 主代理使用内存夹具执行实际 `license-resume` 事件处理、`public/js/license.js`、许可 IPC 与 manager：后台检查后激活调用一次，verify 两次，返回 `{ok:true,state:'authorized'}`，表单隐藏且密码/激活码清空。此证据不等同于启动 Electron 或请求真实授权服务。
- 改动的四个 JavaScript 文件语法通过；架构 **27/27**、文档 **10/10** 通过。归档导航调整后重跑文档门禁。
- 技术参考同步 `docs/reference/backend/bilibili/danmaku.md` 和 `docs/reference/desktop/main.md`。IPC 返回形状、操作入口、用户步骤与参数未改，`preload.md`、用户指南、交互引导无需修改。
- 产品仅改两处 owner，测试仅扩展两份既有套件；保留原有用户修改，不变更盲盒时区或服务端。未提交、未打包或发布；没有真实外部网络/桌面运行验收。
