# Cloud Daily Bots Implementation Plan

**Goal:** 按设计将签到与抽签执行权移到 Server，提供两端控制和受控一次性接管。

**Architecture:** 复用持续 RoomMonitor、租户 streamer.db、统一 scheduler。SQLite 同事务保存配置 revision、每日结果和接管凭证；Electron main 拥有认证与本机旧数据快照。

**Tech Stack:** 现有 CommonJS / Vanilla ESM / SQLite / Electron；不新增依赖、进程或构建步骤。

## Global constraints

- 用户工作区两端均有其他未提交改动；只增量修改，不提交、不建分支、不部署。
- 保留租户隔离、DeviceBearer、context isolation、原库及所有不相关机器人。
- 开关从关闭开始；接管需要用户明确决定，不读取真实库作自动化测试。
- 设计第 11 节为验收矩阵；真实全天场景没有实际执行就标为未验证。

## Current behavior / ownership

Live domain-services 创建本地 checkin/fortune service，在 DIY 前返回；bilibili-client 发送本地回复。danmaku-tool 必需元素及编辑器相互依赖。
Server monitor 的 activity source 与直播场次独立；scheduler 原有四种 producer；cloud-state 的租户事务负责房间，credential-service 负责凭据事务。
对应契约是 daily-bots.md、Device OpenAPI/fixtures、system-rules/acceptance-criteria/traceability、Live preload 与存储/弹幕架构文档。

## Non-goals / compatibility

不移动点歌、DIY、AI、欢迎或 PK，不建日常词库编辑后台，不自动合并混用旧库，不提供排行榜，不改既有同步 revision 或传输认证。

## Task 1 — Contract, store and takeover

Create Server src/lib/daily-bot-contract.js, daily-bot-defaults.js; src/storage/daily-bot-store.js, daily-bot-import-store.js; docs/protocol/daily-bots.md; ADR-0062。
Modify streamer-storage.js 仅注册幂等迁移。

Interfaces: readDailyBotSettings(db); writeDailyBotSetting(db, kind, {enabled,expectedRevision}); disableDailyBots(db) 可加入调用方事务；recordDailyResult(db, event, isCurrent) 同步事务；createDailyBotImportStore(db) 提供 decide/start/upload/preflight/commit/status/cancel。

- [x] 用临时 SQLite 验证默认关闭/pending、revision 冲突、同日唯一结果和事务回滚。
- [x] 实现累加基数、每日快照、幂等接管及有界暂存；先匹配回执再检查当前状态。
- [x] 验证 128 天且当日已签导入后仍 128、次日 129；缺批、不同摘要、取消/过期/重试以及第二来源拒绝。

```js
assert.equal(recordDailyResult(db, today, () => true).totalDays, 128);
assert.equal(recordDailyResult(db, tomorrow, () => true).totalDays, 129);
```

## Task 2 — Monitor, sender and Device API

Create Server src/modules/danmaku/daily-bot-service.js, daily-bot-settings-service.js and src/routes/device-daily-bots.js。
Modify monitor-manager.js / room-monitor.js, scheduler, cloud-state.js / credential-service.js, app.js。新路由由 app.js 组合，不让路由文件互相加载。

Interfaces: DailyBotService({streamerId,db,getSource,runtime,wallNow,now}).onCommand({uid,username,text}); fixed producer checkin/fortune; all replies bind source/context/config revision。

- [x] 验证关闭前后业务和发送分界、同 UID 跨日/跨租户、失败仍保存结果。
- [x] 添加 monitor activity factory，接收时冻结日期/时间；房间/账号改变事务内关闭，凭据同 UID 刷新保留开关。
- [x] Device 路由只做授权和编排，未知字段/租户选择器拒绝，no-store，OpenAPI 与 fixture 同步。

```js
assert.equal(scheduler.getSnapshot().remainingSegments <= 80, true);
assert.equal(secondTenant.totalDays, 1);
```

## Task 3 — Desktop bridge, legacy snapshot and controls

Create Live daily-bot controller/IPC、专用云端状态/一次性接管模块、固定读取旧库的 store adapter。
Modify main/preload/license remote operations、domain-services/bilibili-client/command-text、danmaku-tool/fixed-replies 与页面。

Interfaces: dailyBots.invoke({action,contextId,payload})，open 返回新的授权上下文；main 验证后只调用固定 API。本地 legacy snapshot 仅在停写和归属确认后生成，来源摘要用于提交前再次校验。

- [x] 本地精确命令只返回 command 占用标记，移除生产路径业务实例和发送分支。
- [x] 两个开关独立云端模块，不依赖 canSend 或词库 DOM；失败/冲突/账号切换不显示假成功。
- [x] 接管仅显示于 pending/importing；支持确认无旧数据、明确重新开始、核对本机旧数据/一次性修正/导入进度继续与取消。
- [x] 用合成数据验证 main 白名单、来源变化冲突、响应脱敏、迟到回包、旧服务器和关闭失败。

## Verification

- Server: `node --require ./test/support/test-mode.cjs --test test/daily-bot-*.test.js`；相关 monitor、scheduler、cloud-state、credential 与协议测试；最后 `npm test`。
- Live: `node --experimental-vm-modules --test test/daily-bot-*.test.js`；直接相关 domain/IPC/frontend；最后 `npm run verify:quick` 与 `npm test`。
- 两仓库 `git diff --check`、任务 diff 审阅、`git status --short`；既有失败单独说明。

## Failure handling

只回退本任务具体改动。默认 pending/off；取消仅清当前暂存，业务结果不回滚。开发切换失败先关闭云端；不恢复本地机器人、不复制或删除原库。

## Done when

实现及自动化通过、规范一致、diff 已检查。真实停旧端/实际导入/服务器部署/断桌面及跨日在线验收单独列出证据或未执行，不将模拟测试称为全天实测。

## Progress

- 2026-09-18：已检查两仓库 owner、规范与未提交改动。采用文档默认方案；移除编辑器时也需修改 fixed-replies 的列表分页依赖，防止空 DOM 中断。
- 2026-09-18：A–D 的代码与自动化已落地。251 条记录分两批，重启后继续上传；人为中断提交验证整批回滚；提交响应丢失后沿用原编号重试。数据、回执与接管状态保持一致。
- 界面自动化覆盖确认后读快照、一次性普通表单修正、预检失败后取消再导入、开关保持关闭、断网未知状态与重连刷新。没有在真实 Electron 账号或直播间执行在线切换。
- 模块边界复核：src/server.js 只增加一个只读 legacy reader 访问口，允许上限 798→799；删除不再超限的 danmaku.html 基线。通用浏览器 fixture 提为惰性工厂，功能用例归 daily-bot-frontend.test.js，不靠放宽测试文件上限容纳新功能。

## Verification results / rollout boundary

- Server：`node --require ./test/support/test-mode.cjs --test --test-concurrency=4`：1644/1644 通过，包含完整文档、协议、架构及业务回归。此前默认并发全套曾出现一次 PK HTTP 子进程退出，单独重跑及此次完整重跑均通过。
- Live：daily-bot controller/frontend 与 ui-edit-state 定向测试 36/36 通过；`npm run verify:quick` 文档、语法与架构全部通过。全套 2428 项：2423 通过、4 跳过、1 项 Windows 原生进程查询五秒超时（ETIMEDOUT）；`test/local-instance-windows.test.js` 随后单独重跑 2/2 通过，未修改其超时或断言。全套结果保留这次瞬时失败，不记作全绿。
- 客户端旧契约继续使用锁定的服务端版本，未改锁：现有干净检出 `D:\Work\lira-server-release-4.2.3`，commit `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`。新 daily-bots 另有两端一致 fixture 和实际 HTTP 验证。
- 最后针对文档索引、弹幕页面与欢迎模块重跑 23/23 通过；既有锁定契约的 5 个 fixture 校验通过。两端变更保持未提交，任务新增文件不包含真实数据或凭据。
- 未提交、未部署、未对真实旧库执行导入，也未替用户选择接管或开启开关。E 阶段真实关桌面、未开播、凭据异常、服务器重启及跨北京时间零点验收仍待实际环境执行；自动化不能替代这部分证据。

## Development incident

生成协议文档时误加载了会初始化 adminDb 的服务器路由模块；该命令只设 NODE_ENV=test，未激活临时目录隔离，触发本机已有 `D:\Work\lira-server\admin\admin.db` 的既有初始化流程（文件更新时间 2026-09-18 17:52）。已向用户说明；没有执行 daily bot 旧库导入或开启机器人，也没有调用租户 daily bot 迁移。由于既有初始化含 schema/元数据处理，不能保证这个开发库未发生变化。未擅自回滚或删除原库。后续自动化均显式激活临时环境；文档处理不再 require 带数据库副作用的路由模块。
