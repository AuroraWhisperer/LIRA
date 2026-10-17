# Bilibili 自动连接超时修复

**Status:** Complete

**Goal:** 自动连接长期未建立时能退出当前尝试并继续重连，避免顶部长期变黄后只能手动刷新。

## Evidence and ownership

- 用户反馈顶部黄色状态有时需要手动刷新。当前安装版收到弹幕及心跳，未复现当时的网络故障，不能认定所有黄色状态都来自同一原因。
- `src/bilibili/danmaku-client.js` 的手动 `restart` 传入 `waitForOpen: true`；启动和自动重试传空选项，因此未启用 `WebSocketConnection.waitForSocketOpen` 已有的 8 秒超时。未触发 open/error/close 的连接可一直挂起。
- owner：`BilibiliDanmakuClient.connect`；复用 `src/bilibili/danmaku/websocket-connection.js` 的超时和现有指数退避，不新增计时器或重试层。
- 相关消费者：`src/server/bilibili-runtime.js`、顶部直播状态。契约：`docs/reference/backend/bilibili/danmaku.md`；操作说明：`public/pages/admin/toolbox/usage-guide-getting-started.html`。

## Constraints and non-goals

- 不改认证协议、账号有效期、存储、HTTP/IPC 合同或 WebSocketConnection 的默认调用语义。
- `start()` 仍不等待连接；启动与重试内部的 Promise 才等待 open。停止、换代及重试去重沿用现有 owner。
- 不强制重启正在运行的用户客户端，不修改安装包，不把源码修复说成已在旧安装版生效。
- 此前登录后刷新匿名连接的修复继续保留；真正登录失效仍需账号重新认证。

## Implementation and verification

- [x] 在现有 `test/danmaku/danmaku-client.test.js` 的 FakeWebSocket 增加可暂停 open 的测试控制；使用真实 WebSocketConnection 和模拟时间复现初次自动连接及下一次重试均无 open/error/close。
- [x] 先运行新增用例，确认旧代码超过 8 秒仍未关闭连接或安排重试。
- [x] 在 connect owner 调用 `wsConnection.connect(wsUrl, authPayload, { ...options, waitForOpen: true })`，统一启用既有超时。
- [x] 用例验证 8 秒退出挂起连接、按已有 1/2 秒退避重试、随后正常 open 并停止历史回退。已有用例检查停止后不复活、旧回调隔离、心跳恢复和重试去重。
- [x] 更新事实源与指南，检查导览文案是否仍准确；保持“刷新直播”作为手动恢复入口。
- [x] 执行 `node --test test/danmaku/danmaku-client.test.js test/bilibili/bilibili-websocket-connection.test.js test/bilibili/bilibili-live-status-monitor.test.js test/bilibili/bilibili-runtime.test.js`。
- [x] 执行 `node --experimental-vm-modules --test test/settings/settings-auth-profile.test.js test/admin/frontend-usage-guide.test.js`、`npm run verify:docs`、`node --check src/bilibili/danmaku-client.js`。
- [x] 检查任务 diff、`git diff --check` 和 `git status --short`；确认无运行数据或密钥进入修改。

## Failure handling and done conditions

若聚焦测试暴露更广的生命周期问题，先定位 owner，不新增第二套重连器。回退仅手工撤回本任务 hunks，保留用户其他修改。完成条件是复现由失败变为通过、相关恢复和停止测试通过、文档同步、差异完成检查。安装版更新及间歇性真实网络故障验证不在本轮源码验证内，需明确告知限制。

## Results

实施前已确认当前本机使用登录身份连接且仍在接收数据；黄色状态的历史日志不足以确定用户每次遇到的具体原因。

- 新增回归在修复前因 8 秒后 socket 仍为 CONNECTING 失败，修复后验证连续两次超时与第三次连接成功。
- 连接/运行时/心跳/状态监测 38 项、独立 `node --test test/danmaku/danmaku-reconnect-backoff.test.js` 4 项、登录与指南 20 项通过；文档门禁 10 项及语法检查通过。
- 用户指南补充自动重试、登录切换后刷新连接及真实登录失效需重新扫码。导览已有手动刷新入口仍准确；无 UI 结构变化，不新增截图。
- 源码修改只有 connect owner 的选项补全；运行中的旧安装包未替换，间歇性真实网络故障未在本机重现。不声称覆盖所有黄色状态原因。
