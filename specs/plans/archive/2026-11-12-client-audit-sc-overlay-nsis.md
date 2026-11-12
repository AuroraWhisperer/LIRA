# 客户端审计：SC、绘画与 NSIS 修复

Status: Completed

## Goal

修复 2026-11-12 全量审计确认的三个问题：安装 include 图宏冲突、旧本地 SC 撤回/晚到消息发布、绘画展示入口遗漏会话/回合约束。按用户“修复一下”的要求直接实施，并保留工作区已有修改。

## Boundaries and current evidence

- 不实施四项可选结构整理，不改云服务器、数据格式、鉴权、样式或用户操作步骤，不提交或发布。
- `build/installer.nsh` 与包含的 `installer-ui.nsh` 同时定义 `customInstallMode`，真实 NSIS `/PPO` 退出 1。
- 实际 server runtime 收到 SC 撤回后记录为 0，但 feed 仍有消息；撤回先到时，晚到原消息也进入 feed。
- 真实 game service 拒绝旧回合 append，但经 overlay HTTP 后返回 200 并写入下一回合。
- 审计结果保留于仓库根 `output/client-full-audit-2026-11-12/`，本次只将其作为修复前证据，不重写历史报告。

## Owners and compatibility

| 范围 | 代码 owner / 消费者 | 契约与回归 |
| --- | --- | --- |
| 安装宏 | `build/installer.nsh`、`build/installer-ui.nsh`；electron-builder include 和 mode page | ADR-0015、`docs/reference/engineering/build.md`；`installer-static.test.js`、`installer-update.test.js`、`installer-directory.test.js` |
| SC | `src/bilibili/superchat-service.js`、`src/server/domain-services.js`、`src/server/bilibili-client.js`、`src/server.js`；现有 transport/feed | `docs/reference/backend/bilibili/danmaku.md`、`ws.md`；`server-smoke.test.js`、`server-bilibili-client-avatar.test.js`、`runtime-event-publication.test.js`、`superchat-store.test.js` |
| 绘画 | `src/server/overlay-http.js`；既有 `game-session-service.draw` | `docs/reference/backend/api.md`；`overlay-http-access.test.js`、`game-routes.test.js`、`games-drawing.test.js` |

保留当前用户/普通权限安装策略、已有更新进度与启动语义、页面钩子和数据保护。旧全用户安装仍由 `customInit` 中的既有权限检查拒绝。保留 SC 记录价格门槛与公开展示的区分；公开发布只在删除收据命中时抑制，不以 `add()` 返回 null 一概过滤。不新增存储表、迁移或第二份撤回缓存。绘画 `sessionId/round` 保持兼容性可选，现有权限与响应不变。

## Milestone 1 — Regression evidence

- [x] 在 `test/server/server-smoke.test.js` 增加真实 runtime 接线回归：合成客户端、临时 SQLite/loopback，验证正常 SC → 撤回 → 晚到重放以及先撤回后原消息；同场景保留低于记录门槛的公开显示。
- [x] 在 `test/overlays/overlay-http-access.test.js` 使用现有 HTTP fixture 与真实 game service，旧回合 append 被拒绝、新回合合法笔画可写入。
- [x] 在 `test/engineering/installer-update.test.js` 用已有 NSIS 工具发现与 scratch helper，预处理真实 include 图；副本仅加 UTF-8 BOM，不运行产品安装器。
- [x] 先运行新增回归并确认对应已审计故障，不修改实现迎合错误预期。

三项新增回归修复前均在已知故障处失败，修复后 3/3 通过。绘画 fixture 的选词须携带当前会话/回合，替换会话须先停止旧游戏；两处测试准备已按真实服务合同纠正，没有为 fixture 改动产品逻辑。

## Milestone 2 — Minimal owner fixes

- [x] `superchat-service.js` 增加领域查询 `isSuperChatDeleted(context, platformId)`，清洗 ID 后使用既有 `findByPlatformId(...).status === 'deleted'`；`domain-services.js` 暴露 `superChats.isDeleted`。入口在 `publishDanmaku` 前调用，仍独立执行既有记录筛选。

```js
if (domainServices.superChats.isDeleted(superChat.id)) return;
publishDanmaku?.(superChat);
```

- [x] `server.js` 从 transport 取得并注入已有 `publishSuperChatDelete`；同步现有 client 测试夹具接口。
- [x] `overlay-http.js` 在现有显式对象里补两个字段，不整体透传未知主持动作：

```js
sessionId: body.sessionId,
round: body.round,
```

- [x] 删除 `installer.nsh` 的重复宏，保留 `installer-ui.nsh` 为唯一 owner；原更新分支及页面钩子不变，普通安装的 Else 分支设置 `StrCpy $isForceCurrentInstall "1"`。删除绑定旧宏位置的断言，改由真实 include 图与更新 fixture 验证普通安装也跳过范围选择，同时保持进度/完成页/启动行为。
- [x] 更新弹幕发布说明与安装宏 owner 说明，游戏 API 明确展示入口同样执行已有回合约束。检查相关指南/引导，操作步骤未变则不改。

## Milestone 3 — Verification and closeout

- [x] 定向运行 `node --experimental-vm-modules --test --test-concurrency=2 test/server/server-smoke.test.js test/bilibili/server-bilibili-client-avatar.test.js test/server/runtime-event-publication.test.js test/gifts/superchat-store.test.js test/danmaku/danmaku-feed-buffer.test.js test/overlays/overlay-http-access.test.js test/games/game-routes.test.js test/games/games-drawing.test.js`，无失败/取消/跳过。
- [x] 运行 `node --test --test-concurrency=1 test/engineering/installer-static.test.js test/engineering/installer-update.test.js test/engineering/installer-directory.test.js`，记录工具缺失的 skip；只使用隔离 fixture。
- [x] `npm run verify:architecture`、`npm run verify:docs` 与受影响 JS 语法检查；没有修改构建资源/打包筛选，不做正式打包或真实安装。
- [x] 对照本任务开始时的文件副本审查修复差异，执行 `git diff --check` 与 `git status --short`，保留原有暂存及并行修改。

## Rollback and done when

失败时先检查定向日志和本任务差异，只撤销本任务拥有的代码块；不覆盖整个文件、不 reset、不删除用户数据。基线及日志放在 `tmp/client-audit-sc-overlay-nsis-2026-11-12/`。

三个故障的回归通过、相关兼容测试通过、技术参考同步、用户指南无需调整的原因明确、差异审阅完成后结案并归档。实际直播、完整升级/卸载与用户环境验收不作为本轮源码修复已完成的证据。

## Acceptance record

- 三项入口回归先确认失败，再全部通过；完整相关运行测试 8 文件 / 72 项通过，安装器 3 文件 / 15 项通过，均无失败、取消或跳过。
- NSIS include 图预处理、更新进度/完成页/启动意图、目录选择、普通权限及写入权限夹具通过；产品完整安装包未生成或执行，未控制用户客户端。
- 架构 29/29、首次文档 10/10、10 个受影响 JS 文件语法检查及差异检查通过。归档后文档复查为 9/10，唯一失败为并行新增 `specs/plans/2026-11-12-time-welcome.md` 缺少有效状态，不属于本次修改；本次文档链接/路由检查仍通过。日志、修复前副本与本任务差异在仓库 `tmp/client-audit-sc-overlay-nsis-2026-11-12/`。
- 技术参考同步了 SC 删除收据判定、绘画入口会话/回合透传和 NSIS 宏唯一 owner；入门安装说明、小游戏说明、SC 下线说明及交互式引导已核对，用户操作和设置不变，因此未改用户指南。
- 保留原有及并行工作；未提交、暂存、打包或发布。四项 P3 结构建议未纳入本次缺陷修复。
