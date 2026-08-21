# 你画我猜弹幕身份 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/games` 的你画我猜弹幕流保留并展示昵称、消息正文、大航海等级、当前直播间灯牌和头像。

**Architecture:** Bilibili 消息管线已经产生 `requesterGuardLevel`、`requesterMedalName`、`requesterMedalLevel` 和 `avatarUrl`；本次只在游戏会话边界做有限归一化并把字段加入现有 `game:update` 公开消息项。覆盖层继续使用 DOM `textContent` 和现有头像代理，在昵称行内增加紧凑身份徽标。

**Tech Stack:** Node.js 24+ CommonJS、`node:test`、Vanilla JavaScript、原生 CSS、现有 WebSocket 游戏会话。

## Global Constraints

- 不新增依赖、端点、设置键、页面、数据库、进程或端口。
- 保留现有 `/api/games/session`、`game:update`、答案保密、头像异步补全和其他小游戏行为。
- 只显示 Bilibili 已公开随弹幕提供的身份字段；不得暴露 Cookie、登录凭据或内部 evidence metadata。
- 所有不可信昵称、消息和徽标文字继续通过 `textContent` 渲染；头像继续经 `/api/bilibili/avatar` 代理。
- 保留工作区现有并行修改，不创建 Git commit。

---

## Goal

主播在你画我猜直播画面的每条弹幕中可以同时辨认发言者头像、昵称、消息、当前房间灯牌和大航海身份。

## Non-goals

不改变 Bilibili 协议解析、身份合并优先级、计分规则、头像代理、弹幕持久化或非画猜游戏界面。

## Current Behavior

2026-08-21 使用项目保存的登录会话连接房间 `1695` 实测抓到实时弹幕：昵称和正文稳定可用，灯牌与大航海字段可从消息/在线身份快照解析；部分官方资料接口返回 `http://i*.hdslb.com` 头像，原规范化函数因此丢弃，导致异步补全无法写回。`src/games/game-session-service.js` 的 `normalizeGameDanmaku()` 也只保留 `uid/name/message/avatarUrl/timestamp`，因此大航海和灯牌在进入 `game:update` 前丢失。

## Ownership

- Owner: `src/games/game-session-service.js`、`src/bilibili/parsers/danmaku-parser.js`、`public/js/overlays/games.js`、`public/css/overlays/games.css`。
- Contracts: `specs/danmaku-draw-guess_design.md`、`docs/architecture/backend/ws.md`、`docs/architecture/frontend/pages.md`。
- Producer: `src/server/bilibili-client.js` 已提供 `requesterGuardLevel/requesterMedalName/requesterMedalLevel/avatarUrl`。
- Tests: `test/games.test.js`、`test/games-overlay.test.js`、`test/bilibili-danmaku-parser.test.js`、`test/server-bilibili-client-avatar.test.js`。

## Security Checkpoint

- Auth/Authz: 不新增请求或状态变更，沿用现有 WebSocket 与头像代理 token 管线。
- Input: 游戏边界把大航海限制为 `0|1|2|3`，灯牌名称截断 40 字符，灯牌等级归一化为 `0..999` 整数。
- Output: 仅增加公开直播身份字段，不输出 Cookie、登录 UID evidence 或房间身份内部元数据。
- XSS: 徽标和正文全部使用 `textContent`；不使用 `innerHTML`。
- Rate limit/logging: 不新增外部请求；缺失头像仍复用现有按 UID 合并和负缓存的资料查询。

## Visual Direction

- Subject: 主播在高密度实时弹幕中快速识别观众身份。
- Palette: 沿用夜紫 `#141327`、正文白 `#f8f7ff`、舰长金 `#ffc857`、灯牌紫 `#8074e8`、弱文字 `#a7a4c0`。
- Type: 昵称和正文沿用 Bahnschrift/微软雅黑；身份等级沿用紧凑 Consolas 数字风格。
- Layout: 每条弹幕保持头像 + 正文两列；正文首行改为“昵称 / 大航海徽标 / 灯牌徽标”，第二行保持消息正文。
- Signature: 舰长徽标使用暖金，灯牌使用冷紫，让身份可扫读但不抢画板视觉中心。

## Task 1: 用失败测试固定公开消息身份字段

**Files:**
- Modify: `test/games.test.js`
- Modify: `test/games-overlay.test.js`

**Interfaces:**
- Consumes: Bilibili 入站字段 `requesterGuardLevel`, `requesterMedalName`, `requesterMedalLevel`, `avatarUrl`。
- Produces: 画猜公开弹幕项 `{uid, name, message, avatarUrl, guardLevel, medalName, medalLevel, timestamp}`。

- [x] **Step 1: 扩展游戏会话断言**

在现有画猜会话测试的弹幕输入中加入：

```js
requesterGuardLevel: 3,
requesterMedalName: '凉呆皮',
requesterMedalLevel: 22
```

并断言：

```js
assert.deepEqual({
  guardLevel: service.getSession().danmaku[0].guardLevel,
  medalName: service.getSession().danmaku[0].medalName,
  medalLevel: service.getSession().danmaku[0].medalLevel
}, { guardLevel: 3, medalName: '凉呆皮', medalLevel: 22 });
```

- [x] **Step 2: 固定安全归一化与页面渲染钩子**

新增会话断言，非法 `requesterGuardLevel: 9` 归零、过长灯牌截断到 40 字符、负灯牌等级归零；覆盖层静态测试要求出现 `draw-danmaku-identity`、`draw-danmaku-guard`、`draw-danmaku-medal`、`guardLabel`，并继续拒绝 `innerHTML`。

- [x] **Step 3: 运行测试并确认先失败**

Run: `node --test test/games.test.js test/games-overlay.test.js`

Expected: 新增字段/渲染钩子断言失败，既有测试保持通过。

## Task 2: 保留身份字段并渲染紧凑徽标

**Files:**
- Modify: `src/games/game-session-service.js`
- Modify: `src/bilibili/parsers/danmaku-parser.js`
- Modify: `public/js/overlays/games.js`
- Modify: `public/css/overlays/games.css`
- Test: `test/bilibili-danmaku-parser.test.js`

**Interfaces:**
- Consumes: Task 1 固定的入站字段和公开消息形状。
- Produces: `game:update.session.danmaku[]` 的附加 `guardLevel/medalName/medalLevel` 字段，以及安全 DOM 徽标。

- [x] **Step 1: 在游戏边界归一化字段**

`normalizeGameDanmaku()` 增加：

```js
const requestedGuardLevel = Number(danmaku.requesterGuardLevel);
const guardLevel = [1, 2, 3].includes(requestedGuardLevel) ? requestedGuardLevel : 0;
const requestedMedalLevel = Math.trunc(Number(danmaku.requesterMedalLevel));
const medalLevel = Number.isFinite(requestedMedalLevel)
  ? Math.max(0, Math.min(999, requestedMedalLevel))
  : 0;
```

返回项加入 `guardLevel`、截断为 40 字符的 `medalName` 和 `medalLevel`。

- [x] **Step 2: 用 DOM API 生成身份行**

`renderDrawDanmaku()` 为每条消息创建 `.draw-danmaku-identity`，先放昵称，再按非零字段追加徽标。`guardLabel(3/2/1)` 分别返回 `舰长/提督/总督`；灯牌文案为 `${medalName} ${medalLevel}`。所有字符串只赋给 `textContent`。

- [x] **Step 3: 加入画猜专属徽标样式**

身份行允许单行截断；昵称保持可读，舰长用暖金描边与深金底，灯牌用紫色描边与深紫底。徽标高度不超过现有 28px 头像，避免降低单屏消息密度。

- [x] **Step 4: 运行聚焦测试直到通过**

Run: `node --test test/games.test.js test/games-overlay.test.js`

Expected: 全部通过。

## Task 3: 更新公共契约并完成验证

**Files:**
- Modify: `specs/danmaku-draw-guess_design.md`
- Modify: `docs/architecture/backend/ws.md`
- Modify: `docs/architecture/frontend/pages.md`
- Modify: `specs/plans/2026-08-21-draw-guess-danmaku-identity.md`

**Interfaces:**
- Documents: `game:update.session.danmaku[]` 附加身份字段及覆盖层显示行为。

- [x] **Step 1: 更新规格和 owner 文档**

验收标准增加：每条画猜弹幕保留头像、昵称、正文、`guardLevel` 和当前房间 `medalName/medalLevel`；缺失身份显示为空且不伪造。WebSocket 文档明确弹幕项字段；页面文档注明身份徽标与头像补全。

- [x] **Step 2: 运行分层验证**

Run:

```text
node --test test/games.test.js test/games-overlay.test.js
npm.cmd run verify:docs
npm.cmd run check
npm.cmd run verify:quick
```

Expected: 全部退出码 0。

- 结果：聚焦测试 28/28 通过；`verify:docs` 5/5 通过；`check` 通过（411 个 JavaScript 文件）；`verify:architecture` 9/9 通过；`verify:quick` 通过；完整 `npm test` 785 个测试中 784 通过、1 个跳过、0 个失败。

- [x] **Step 3: 最终审查**

运行 `git diff --check`、任务文件 scoped diff、`git status --short`；删除实时抓取临时脚本，确认没有 Cookie、日志、数据库或运行时文件进入 diff。

- 结果：`git diff --check` 无错误；实时验证脚本已删除；工作区中未发现本任务产生的临时抓包文件、Cookie、日志、数据库或运行时输出。

## Rollback Or Failure Handling

若新增字段或 UI 验证失败，只用定向补丁撤销本计划列出的任务行；不使用 reset、blanket checkout 或删除用户已有修改。公开字段是加法兼容，回滚无需迁移数据。

## Done When

真实弹幕的昵称、正文、大航海、当前房间灯牌和头像能从 Bilibili 入口进入画猜公开会话并安全显示；无身份或头像暂缺时有稳定回退；聚焦测试、文档、语法和 quick gates 通过；本任务的 scoped diff 不含临时抓包或敏感运行时文件，并保留工作区原有并行修改。
