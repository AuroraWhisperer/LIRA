# 你画我猜覆盖层修复计划

**Status:** Complete (2026-08-20)

## Goal

让 `/games` 桌面覆盖层在单屏内完整呈现画板、工具、说明/时间和弹幕，并稳定显示真实 B 站头像；修复无关 WebSocket 快照导致的误显示“等待开局”。

## Non-goals

不改变游戏会话 HTTP/WebSocket 公共信封、计分规则、画笔同步协议或新增外部服务。

## Current Behavior

覆盖层把缺少 `games` 字段的全局快照当作空会话；工具栏只有文字橡皮擦；弹幕标题和数量仍显示；头像仅解析单一 DANMU_MSG 位置，历史弹幕没有传递头像。

## Ownership

- 覆盖层：`public/pages/overlays/games.html`、`public/css/overlays/games.css`、`public/js/overlays/games.js`
- B 站弹幕身份：`src/bilibili/parsers/`、`src/bilibili/danmaku/`
- 游戏会话消费：`src/games/game-session-service.js`
- focused tests：`test/games-overlay.test.js`、`test/bilibili-danmaku-parser.test.js`、`test/games.test.js`

## Compatibility Constraints

保留 Electron/OBS `/games` 地址、既有绘画操作和弹幕消息字段；头像只接受 HTTPS 的 `*.hdslb.com` 地址；不提交运行时输出或用户数据。

## Proposed Changes

1. 对全局快照仅在明确包含 `games` 字段时渲染会话。
2. 用图标按钮区分画笔和橡皮擦，沿用粗细按钮调整橡皮擦大小，并隐藏弹幕标题/数量。
3. 扩展 B 站头像解析和历史消息传递，补齐头像 CSS 与相关回退测试。

## Milestones

1. 覆盖层状态保护：先用 `test/games-overlay.test.js` 固化“缺少 `games` 字段的快照不清空当前会话”，再修正 `public/js/overlays/games.js`。
2. 工具栏与消息流：用覆盖层结构测试约束独立画笔/橡皮擦图标、共享粗细选择及无标题/数量消息栏，再修改 HTML、CSS 和交互状态。
3. 真实头像链路：用解析器与游戏服务测试覆盖当前 DANMU_MSG 身份字段和历史消息头像传递，再对解析/缓存边界做最小修复。
4. 集成验证：运行 focused tests、语法与 quick gates，并在桌面目标尺寸检查页面不会溢出。

## Verification

运行 focused node:test、`npm.cmd run check`、`npm.cmd run verify:quick`、`git diff --check`，并检查最终 diff/status。

完成结果：focused tests 32/32 通过；`npm.cmd run check` 通过 401 个 JavaScript 文件；`npm.cmd run verify:quick` 通过；完整 `npm.cmd test` 为 746 通过、1 跳过；1366×768 桌面目标尺寸的本地页面实测无溢出，画笔/橡皮擦双态可辨识。

## Rollback Or Failure Handling

若任一里程碑无法通过 focused test，停止扩展修改并检查该里程碑涉及的 scoped diff；仅用 `apply_patch` 反向撤销本任务新增行，不覆盖工作区中已有改动，也不使用 destructive reset 或 blanket checkout。

## Done When

覆盖层不因无关快照退回等待状态；四部分内容可在目标桌面窗口内看到；工具模式和橡皮擦大小可辨识；弹幕仅保留滚动内容；弹幕行优先显示发送者真实头像；focused 与 quick gates 全部通过。
