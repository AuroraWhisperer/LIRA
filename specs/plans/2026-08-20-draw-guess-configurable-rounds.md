# 你画我猜可配置回合 Implementation Plan

**Goal:** 让主播在开始“你画我猜”前选择回合数和每局时长，并由服务端在安全范围内执行配置。

**Architecture:** 管理页在现有画猜卡片中收集两个整数参数，沿既有 `POST /api/games/session` 启动请求传递；路由和游戏会话服务把参数交给 `draw-guess` 引擎，由引擎统一归一化为回合数 1–12、单局 15–300 秒。公开状态继续携带实际配置，计时器仍由服务端负责。

**Tech Stack:** Node.js CommonJS、Vanilla JavaScript ES modules、原生 CSS、`node:test`。

## 约束

- 默认保持当前行为：5 局、每局 90 秒。
- 参数必须是整数；超出范围或非法值回退到默认值。
- 不改变答案匹配、计分、画布限制、单会话互斥或 `/games` 地址。
- 不修改用户现有工作区改动，不创建提交。

## 任务

### 任务 1：服务端参数契约

**文件：** `src/games/draw-guess.js`、`src/games/game-session-service.js`、`src/server/routes/game-routes.js`、`test/games.test.js`、`test/game-routes.test.js`

- 增加默认/最小/最大时长常量和 `normalizeRoundDuration`，使 `createDrawGuessState({ totalRounds, roundDurationSeconds })` 生成对应毫秒值。
- 保持无参数调用的 5 局/90 秒结果；非法值回退默认值；公开状态和下一回合沿用状态中的时长。
- `normalizeSessionInput` 在 `draw-guess` 下保留 `totalRounds` 与 `roundDurationSeconds`，服务层把它传给引擎。
- 增加边界、非法回退、启动透传和服务端计时延迟测试。

### 任务 2：管理页配置控件

**文件：** `public/pages/admin/toolbox/games.html`、`public/css/admin/other-features/games.css`、`public/js/admin/games.js`、`test/frontend-games.test.js`

- 在展开的画猜主持区加入“回合数”和“每局时长”数字输入，使用 `min/max/step` 显示 1–12 局、15–300 秒范围，并标注范围。
- 开始画猜时读取两个控件并传给现有启动 API；启动后禁用控件，结束后恢复。
- 卡片摘要和主持状态显示实际配置，不再写死 5 局/90 秒；保留题词、倒计时和下一题操作。
- 更新前端回归断言，覆盖控件范围、请求字段和无旧流程文案回归。

### 任务 3：契约文档与门禁

**文件：** `specs/danmaku-draw-guess_design.md`、`docs/architecture/backend/api.md`、`docs/architecture/frontend/app.md`

- 将“固定五局、每局 90 秒”改为默认值与允许范围，并记录启动请求字段。
- 运行聚焦测试、语法检查、架构/文档快速门禁，检查限定 diff 和工作区状态。

## 验证

1. `node --test test/games.test.js test/game-routes.test.js test/frontend-games.test.js`
2. `npm run check`
3. `npm run verify:quick`
4. `git diff --check` 与限定文件 `git diff`，确认无用户现有文件被改写。

## Done When

- 主播可在界面选择合法范围内的回合数和单局秒数，启动后服务端使用实际配置。
- 非法或缺失参数安全回退为 5 局/90 秒。
- 公开游戏画面、主持区倒计时和回合结束逻辑与配置一致。
- 聚焦测试和快速门禁通过，文档与运行时契约一致。
