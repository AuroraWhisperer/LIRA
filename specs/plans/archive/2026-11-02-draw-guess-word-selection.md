# 你画我猜主播选词实施计划

**Status:** Completed

**Goal:** 主播点击开始或下一题后，在客户端现有主题的弹窗中浏览本场分类内的全部可用题词，选定后开始本局计时；游戏网页在此期间显示「主播正在挑选」。

**Architecture:** 保持现有游戏领域、会话服务、管理端私有状态与公开投影的职责。新增 `choosing` 阶段及主持选词操作；题词列表仅由现有管理接口返回。

**Tech Stack:** CommonJS 游戏后端、原生 ESM 管理端和叠加层、CSS 主题变量、Electron。

## 边界与当前行为

- 当前固定题库为 9 类共 900 词；首次开局及下一题由领域层随机抽词并立即启动倒计时。
- 保留分类筛选、轮数/时长、计分、公布答案、单会话互斥及画布同步。不增加自定义题库或修改持久化格式。
- 保留已有用户修改，不提交、不创建分支、不修改桌面认证或展示页能力。
- 延续题池未耗尽前不重复出题；耗尽后允许再次选择。选词期间不计时、不接受绘画或计分，弹幕仍按现有方式展示。

## Ownership

- `src/games/draw-guess.js`：筛选后题池、选词验证、阶段与公开/主持 DTO。
- `src/games/game-session-service.js`：主持操作、会话/回合匹配、计时与广播。
- `public/js/admin/games.js`：游戏入口、私有状态读取；新增 `games-word-picker.js` 只拥有选词弹窗交互。
- `public/pages/admin/toolbox/games.html` / `public/css/admin/toolbox/games-draw.css`：现有卡片及复用客户端主题的原生 dialog。
- `public/js/overlays/games.js` / `public/pages/overlays/games.html`：等待展示与画板阶段。
- 契约：`docs/reference/backend/api.md`；前端归属：`docs/reference/frontend/app.md` / `overlays.md`。
- 需求：`specs/danmaku-draw-guess_design.md`；操作说明：应用内小游戏指南。现有交互引导若未描述选词步骤则保持。
- 测试：现有 `test/games/` 游戏、传输、绘画、主持与叠加层套件；复用已有 Electron/UI 夹具验证弹窗。

## Milestones

- [x] 领域与会话：`createDrawGuessState` / `startNextRound` 进入 `choosing`，主持 DTO 提供 `choices:[{word,categoryId,category}]`；`choose-word` 携带 `word,sessionId,round`，校验后进入 `drawing` 并开始计时。验证选词前无计时/计分/绘画，越界或迟到操作拒绝，公开字段无词表。
- [x] 客户端与网页：开局及下一题自动弹窗；分组展示全部可用词，支持搜索与明确确认；关闭后可继续挑选。网页等待提示随选定消失。实际 Electron 的选词、确认、下一题、重开页面及失败恢复通过。
- [x] 同步与收尾：更新契约、规格和操作指南；直接相关测试通过，复核 diff 与用户修改边界。

## Verification

- `node --experimental-vm-modules --test test/games/games.test.js test/games/game-routes.test.js test/games/game-transport.test.js test/games/games-drawing.test.js test/games/game-streamer-role.test.js test/games/games-load.test.js test/games/frontend-games.test.js test/games/games-overlay.test.js`：游戏与受影响消费者通过。
- 新增弹窗集成覆盖复用 `test/helpers/ui-edit-state-fixture.js`，检查本场词、确认提交与失败后保留选择。
- 隔离 Electron：只使用 `tmp/` 下的临时数据及拥有的实例；按已有夹具验证数据路径和授权，打开前检查精确路由状态。
- `npm run verify:docs`、`npm run check`、`npm run verify:architecture`；公共阶段及权限投影由本地 overlay HTTP/WS 契约套件验证，不涉及远程服务器契约锁。
- 最终 `git diff --check`、任务 diff 及 `git status --short`。

## Rollback / Failure Handling

只按本任务 diff 撤回相关行和新增文件，保留用户既有内容。请求失败保留选词等待状态并显示可重试错误；停止会话、切局或过期响应不能恢复旧词表或开局。测试实例只关闭自己创建的进程。

## Done When

所有本场可用词可在客户端浏览；主播确认前网页显示等待且倒计时未启动；确认后题词、画板和计时一致；下一题重复此流程；无私有词表泄漏。相关测试、实际 Electron 检查、文档与最终 diff 审核完成，记录未覆盖范围。

## Evidence

- 2026-11-02：游戏、前端弹窗、公开投影和 HTTP/WS 权限共 119 项聚焦测试通过；新用例先证明旧实现不进入选词阶段。原公开投影集成夹具随后显式选词，保留其绘画、撤销、答案隐藏/揭晓断言。
- `npm run verify:docs` 10 项、`npm run verify:architecture` 28 项通过；`npm run check` 验证 1,679 个 JavaScript 文件通过（缓存复用未变文件）。
- 隔离 Electron 使用真实管理页、preload、桌面请求授权、领域服务与 WebSocket：匿名 `/admin` 返回 401，`/games` 返回 200；userData/sessionData 均在本任务 `tmp/` 内。
- 实测全选 900 词 / 9 组、单选动物分类 100 词、空分类禁止开局；选词前题词为空且网页等待，确认后显示 30 秒完整计时与可用画笔，并完成作画、结束、揭晓和下一题。
- 下一题 899 词，前题不重复；客户端刷新恢复局次/词表。模拟 503 时弹窗内显示错误并保留选择，重试后成功开局。
- 最终弹窗为 760 × 720，复用 `--surface`（当前主题 `#fffcf7`）、16px 主题圆角、`--shadow-dialog` 及已有按钮；截图留在 `tmp/draw-guess-word-selection-qa/`。
- 测试期间管理页组合缓存需重启自有实例才能接入新增 HTML；合成授权到期由原夹具续期。已关闭全部自建 Electron/浏览器并移除临时数据，仅保留 QA 证据。
- API、前端 owner、需求规格和应用内操作指引同步。交互式引导只介绍百宝箱入口，未描述开局步骤；既有指南图仍说明分类设置和主持区，未替换。未进行真实 B 站直播或直播软件实播，未提交、打包或发布。
