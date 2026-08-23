# 你画我猜分类词库与绘图工具 Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current workspace. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把你画我猜扩展为可在 Admin 按分类选题的 900 词游戏，并在固定 `/games` 页面增加直线、矩形、圆形和取色工具，同时缩小桌面端画板占比。

**Architecture:** 新的静态词库由 `src/games/draw-guess-words.js` 单独拥有，游戏引擎只负责按服务端白名单分类筛词；`GET /api/games/draw-guess/categories` 给 Admin 返回分类 ID、名称和词数，开局沿现有 `POST /api/games/session` 传递 `categoryIds`。新图形工具仍把图形转换为既有、受限的折线笔画，因此不新增绘画协议动作，也不改变跨页面同步模型。

**Tech Stack:** Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules、原生 CSS、`node:test`。

## Global Constraints

- 保持 Electron 桌面端为主要 UI 目标，固定 `/games` 地址与现有单游戏会话互斥不变。
- 保持答案和别名只出现在受保护的 `GET /api/games/host-state`，不得进入公开会话、WebSocket、日志或错误文本。
- 不新增数据库、设置键、进程、端口、运行时依赖或前端构建步骤。
- Admin 只提交分类 ID；服务端完成白名单校验与实际筛词，至少一个有效分类才能开局。
- 直线、矩形和圆形必须复用 `append` 笔画的颜色、粗细、坐标与总量限制；取色只允许选择现有服务端白名单颜色。
- 保留画笔、橡皮擦、撤销、清空确认、颜色、粗细及其现有快捷键和同步行为。

---

## Goal

主播展开 Admin 的你画我猜卡片后，能看到每类词数、全选或按需勾选分类并开始游戏；直播画面提供更紧凑的画板和一组图标化绘画工具，另一 `/games` 实例仍能通过既有状态与 WebSocket 恢复完全相同的画面。

## Non-goals

- 不支持主播在线编辑、自定义或上传词条。
- 不增加填充桶、图层、透明度、重做、图片导入或自由颜色选择器。
- 不持久化每次分类选择；刷新 Admin 后回到全选，进行中的会话通过主持状态恢复其分类选择。
- 不改变计分、回合计时、答案匹配、弹幕身份或其它小游戏规则。

## Current Behavior

- `src/games/draw-guess.js` 内联约 50 个词，虽含类别文本，但开局不能筛选。
- `POST /api/games/session` 只接收回合数与时长；Admin 没有词库概览或分类控件。
- `/games` 已有画笔、橡皮擦、六色、四档粗细、撤销和清空确认；所有笔画由服务端校验并广播。
- 桌面画猜布局让 16:9 画板占满主列与大部分可用高度，工具栏只能在画板下方换行。

## Ownership

- 词库内容：新建 `src/games/draw-guess-words.js`。
- 游戏规则与筛选：`src/games/draw-guess.js`；会话传递：`src/games/game-session-service.js`。
- HTTP 路由：`src/server/routes/game-routes.js`，契约文档 `docs/architecture/backend/api.md`。
- Admin 消费者：`public/pages/admin/toolbox/games.html`、`public/js/admin/games.js`、`public/css/admin/other-features/games.css`。
- 直播画板消费者：`public/pages/overlays/games.html`、`public/js/overlays/games.js`、`public/css/overlays/games.css`。
- 回归测试：`test/games.test.js`、`test/game-routes.test.js`、`test/frontend-games.test.js`、`test/games-overlay.test.js`。

## Compatibility Constraints

- `categoryIds` 缺失时等价于全选，保证旧 Admin、旧调用方和测试注入词库继续可用。
- 仅显式提供空数组、未知 ID 或超量分类时拒绝开局；不得静默回退到全词库。
- 分类端点只返回 `{id,label,count}`，不暴露整份题词与别名。
- 公开状态不新增答案相关字段；主持状态可携带本场 `categoryIds` 以便 Admin 刷新后恢复勾选。
- 图形在客户端离散为同一 `strokeId` 的归一化坐标，并按每批最多 32 点提交；服务端现有 500 点/笔、6000 点/局上限继续生效。

## Proposed Changes

- 新建 9 个分类、每类恰好 100 个可画词条的静态词库；保留少量常见异名用于精确答案匹配。
- 引擎导出分类摘要并按 `categoryIds` 过滤词池；会话服务传递选择并公开主持端选择。
- 新增 `GET /api/games/draw-guess/categories`，扩展开局输入归一化以接受有界分类 ID 数组。
- Admin 在回合设置下方增加“本场词库”选择架，显示已选分类数和总词数，提供全选/清空按钮并在开局时提交选择。
- Overlay 工具栏增加直线、矩形、圆形和取色器；形状拖动期间本地预览，抬笔后使用既有 `append` 队列同步。
- Desktop 画猜布局为画板主列设置适度的最大宽度并减少高度预算，把额外空间留给工具栏、积分与弹幕。
- 更新规格、API 与前端 owner 文档，使新契约和现状一致。

## Milestones

### Milestone 1: 分类词库与服务端筛选

- [x] 在 `test/games.test.js` 增加 9 类、每类 100 词、全局词面唯一和按两类筛选的失败测试。
- [x] 新建 `src/games/draw-guess-words.js`，导出不可变分类定义、扁平默认词库和不含题词的分类摘要函数。
- [x] 修改 `src/games/draw-guess.js`，仅在 `categoryIds` 存在时筛选，保存规范化后的选择并在空词池时报稳定错误。
- [x] 修改 `src/games/game-session-service.js`，传递 `categoryIds` 并提供 `listDrawGuessCategories()`。
- [x] 运行 `node --test test/games.test.js`，预期新增词库、筛选和旧计分/画布测试全部通过。

### Milestone 2: HTTP 与 Admin 分类选择

- [x] 在 `test/game-routes.test.js` 先覆盖分类摘要 GET、`categoryIds` 去重/有界归一化和显式空选择拒绝。
- [x] 修改 `src/server/routes/game-routes.js`，注册分类摘要路由并把规范化选择传给会话服务。
- [x] 在 Admin HTML 增加带状态文本、全选/清空和动态 checkbox 根节点的词库选择架。
- [x] 在 `public/js/admin/games.js` 通过 DOM API 安全渲染分类，客户端阻止空选择，开局提交 ID，并在运行中禁用控件。
- [x] 在 Admin CSS 中使用现有纸张紫/墨色体系做紧凑分类卡，保留可见键盘焦点和 760px 单列退化。
- [x] 运行 `node --test test/game-routes.test.js test/frontend-games.test.js`，预期路由与静态 UI 契约通过。

### Milestone 3: 图形工具与紧凑画板

- [x] 在 `test/games-overlay.test.js` 先断言四个新工具按钮、图形离散函数、白名单取色逻辑和更紧凑桌面 CSS 存在。
- [x] 修改 Overlay HTML，添加直线、矩形、圆形、取色器图标按钮和简短 title/ARIA 文本。
- [x] 修改 Overlay JS，以单一 `drawTool` 管理工具；直线生成 2 点、矩形生成闭合 5 点、圆形生成不超过 49 点；拖动时重绘快照加预览，抬笔后分批进入现有发送队列。
- [x] 取色器从画布采样并选择最近的六个可见白名单色；空白画布不改变颜色。
- [x] 修改 Overlay CSS，给新工具状态和光标提供清晰反馈，并把桌面画板宽度和高度预算各收缩约一成。
- [x] 运行 `node --test test/games-overlay.test.js test/games.test.js` 和 `npm.cmd run check`。

### Milestone 4: 文档、桌面验证与全门禁

- [x] 更新 `specs/danmaku-draw-guess_design.md`、`docs/architecture/backend/api.md`、`docs/architecture/frontend/app.md` 和 `docs/architecture/frontend/pages.md`。
- [x] 在 Electron 优先的正常窗口尺寸检查 Admin 分类选择和 `/games` 工具栏，确认画板更小、控件不溢出、形状可同步。
- [x] 运行 `node --test test/games.test.js test/game-routes.test.js test/frontend-games.test.js test/games-overlay.test.js`。
- [x] 运行 `npm.cmd run check`、`npm.cmd run verify:architecture`、`npm.cmd run verify:quick` 和 `npm.cmd test`。
- [x] 运行 `git diff --check`、`git diff`、`git status --short`，确认所有改动均追溯到本需求且没有生成物或敏感数据。

## Verification

聚焦测试必须证明：默认摘要恰好返回 9 类 × 100 词；`categoryIds: ['animals','food-drink']` 的内部词池只含这两类；显式空数组和未知 ID 不能开局；旧调用不传分类时仍使用全部默认词库。前端检查必须证明分类控件通过 `textContent`/DOM API 构造，新形状最终仍发送 `action:'append'`，圆形点数不会突破单笔上限，取色结果只来自现有六色按钮。

## Verification Results

- 聚焦回归：`node --test test/games.test.js test/game-routes.test.js test/frontend-games.test.js test/games-overlay.test.js`，39/39 通过。
- 项目门禁：`npm.cmd run verify:quick` 通过；`npm.cmd test` 845/845 通过；`git diff --check` 无空白错误。
- 桌面交互：Electron 壳取得主窗口 1280×722 的尺寸证据；因 Electron 43 在 Playwright 下渲染进程提前退出，最终交互在同一套 renderer 资源的隔离 localhost 会话完成。Admin 实际点击验证 9/9 类共 900 词、清空后禁用开局、选择两类后显示 200 词且成功开局并锁定控件。
- 画板交互：1280×722 时画布约 804×452，1024×650 时约 676×380，均无横向溢出；直线、矩形、圆形、取色器、自由笔和橡皮擦均通过真实指针操作，服务端最终接收 5 笔、64 个坐标且未出现同步错误。

## Rollback Or Failure Handling

若分类链路失败，先停在服务端里程碑并用 `apply_patch` 撤回本任务的路由、UI 和词库引用，不碰其它游戏；若图形同步不一致，移除四个新工具按钮及其分支，保留既有自由笔、橡皮擦、撤销与清空。不得使用 broad checkout、`git reset --hard` 或删除用户文件。

## Done When

- Admin 能显示 9 个各 100 词的分类、正确统计选择，并只从主播选择的分类开局。
- 服务端拒绝空/未知分类且不向公开状态泄露答案或完整词库。
- `/games` 的直线、矩形、圆形和取色器可用，既有工具与跨实例同步不回归。
- 桌面画猜画板明显但克制地缩小，工具、积分和弹幕在一个窗口内可读。
- 聚焦测试、语法、架构、quick 和完整测试门禁通过，最终 diff 范围干净。
