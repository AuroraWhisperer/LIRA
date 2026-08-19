# 独立转盘小游戏 Implementation Plan

**Goal:** 在“小游戏”管理面板提供可编辑内容与份数的转盘，并以不受数字炸弹、五子棋单会话互斥影响的独立 `/wheel` 浏览器源展示抽取动画和最终高亮结果。

**Non-goals:** 不改变数字炸弹、五子棋的规则或 `/games` 固定浏览器源；不新增数据库、设置键、运行时依赖、弹幕抽取或多人会话。

**Current Behavior:** `src/games/game-session-service.js` 只维护一个 `number-bomb` 或 `gomoku` 会话，并拒绝第二次 `start()`；`/games` 仅按该会话渲染。`test/game-routes.test.js` 已保护这一互斥契约，不能通过扩展该 service 破坏它。

**Ownership:** `src/games/` 持有抽取与轮盘状态；`src/server/routes/game-routes.js` 注册受 token 保护的请求；`public/js/admin/games.js` 渲染主播控制；`public/pages/overlays/` 与 `public/js/overlays/` 渲染可嵌入的 OBS 页面。契约文档为 `docs/architecture/backend/api.md`、`docs/architecture/backend/ws.md`、`docs/architecture/frontend/pages.md`。

**Compatibility Constraints:** 保持 Node.js 24+、CommonJS 后端、无构建 Vanilla JS 和既有 token/Origin 校验。转盘项文字以 `textContent` 渲染；服务端验证内容与权重；`/games`、`game:update`、两款旧游戏互斥规则保持原状。`/wheel` 作为可嵌入 overlay，不设置管理员页面的 frame protection headers。

## Proposed Changes

### Milestone 1: 服务端独立状态与 API

Files:
- Create: `src/games/wheel-session-service.js`
- Modify: `src/server/routes/game-routes.js`
- Modify: `src/server/api-context.js`
- Modify: `src/server.js`
- Test: `test/wheel-game.test.js`
- Test: `test/game-routes.test.js`

- [x] 写入失败测试：空内容、重复或非正整数份数被拒绝；份数在服务端累计并按权重确定候选；连续抽取不需要停止现有小游戏。
- [x] 实现 `createWheelSessionService({ broadcast, random })`，公开 `getState()`、`configure(entries)`、`spin()`；将项限制为 2–12 条、每条文字 1–40 字符、权重 1–100、总份数不超过 300。
- [x] 为 `GET /api/wheel`、`POST /api/wheel/config`、`POST /api/wheel/spin` 注册 JSON 信封路由，并通过 `createApiContext()` 注入独立 service。
- [x] 在服务启动时构造 wheel service，与 `gameSessionService` 同级接入 WebSocket hub；配置或抽取广播 `{type:'wheel:update', state}`。
- [x] 运行 `node --test test/wheel-game.test.js test/game-routes.test.js`，预期通过且原有“第二个游戏返回 409”测试保持通过。

### Milestone 2: 主播配置面板

Files:
- Modify: `public/pages/admin/toolbox/games.html`
- Modify: `public/js/admin/games.js`
- Modify: `public/css/admin/other-features/games.css`

- [x] 在既有小游戏目录加入转盘卡片：内容和“份数”输入行、添加/删除行、总份数、保存配置、开始转动，以及复制/打开 `/wheel` 的单独地址。
- [x] 使用 DOM 创建行和 `textContent` 写入服务端返回的数据；客户端仅做即时表单提示，保存时仍交给 API 的权威验证。
- [x] `POST /api/wheel/spin` 成功后显示已发起抽取；不读取、设置或禁用 `gamesStopBtn` 和旧游戏开始按钮，从而保持两套状态互不互斥。
- [x] 在桌面尺寸优先保证编辑列、总份数和操作按钮的可读性；转盘卡片默认与其他卡片同层级展示，点击摘要区向下展开详情。

### Milestone 3: 单独透明转盘浏览器源

Files:
- Create: `public/pages/overlays/wheel.html`
- Create: `public/js/overlays/wheel.js`
- Create: `public/css/overlays/wheel.css`
- Modify: `src/server/http-utils.js`
- Test: `test/wheel-overlay.test.js`
- Test: `test/admin-page-composition.test.js`

- [x] 将 `/wheel` 映射为新 overlay，并加入可嵌入白名单；保留圆形转盘外的 body/页面透明。
- [x] 使用 SVG path 按累计份数画每一个有不同颜色的扇形；文字通过 SVG text node 设置，绝不拼接 HTML。
- [x] 初始请求 `GET /api/wheel`，并消费 `wheel:update`。收到新的 `spin` 后，依据服务端开始时间补偿旋转进度，转动至少三圈，结束时选中扇形保持亮色、其它扇形变暗。
- [x] 支持 `prefers-reduced-motion`：直接过渡到选中状态，而不会一直旋转。
- [x] 运行 `node --test test/wheel-overlay.test.js test/admin-page-composition.test.js`，预期验证 `/wheel` 映射、透明背景、DOM 安全渲染和动画钩子。

### Milestone 4: 契约与回归验证

Files:
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/architecture/backend/ws.md`
- Modify: `docs/architecture/frontend/pages.md`
- Modify: `specs/plans/2026-08-19-wheel-game.md`

- [x] 登记 `/wheel` 入口、三个 wheel API 和 `wheel:update` 信封；明确它独立于 `/api/games/session` 的互斥规则。
- [x] 记录所有完成的验证结果和任何范围偏差。
- [x] 依次运行 `node --test test/wheel-game.test.js test/game-routes.test.js test/wheel-overlay.test.js`、`npm run check`、`npm run verify:quick`、`npm test`、`git diff --check` 与 `git status --short`。

## Rollback Or Failure Handling

配置只在内存中，停止服务即可清除。若需要撤回，仅反向应用本任务的已确认文件差异；不使用 `git reset --hard`、`git checkout --` 或广泛删除。旧 `gameSessionService` 与 `/games` 保持不改动的互斥行为。

## Done When

主播可为 2–12 个转盘项分别设置文字和正整数份数，页面显示总份数；抽取严格按服务端权重选择；`/wheel` 透明背景上渲染多色圆盘、播放同步旋转并只突出最终选中项；它能与一个旧小游戏同时存在；所有聚焦测试、快速验证和完整测试通过，契约文档与最终差异一致。
