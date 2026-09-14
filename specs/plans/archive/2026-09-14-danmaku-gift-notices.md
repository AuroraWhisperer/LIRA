# Danmaku Gift Notices Implementation Plan

**Goal:** 六套现有弹幕姬各有符合原风格的 SVG 礼物提示，默认预览可见，正式礼物结算后使用同一渲染。

**Architecture:** 在现有礼物 final 回调中向弹幕缓冲区投影公开礼物字段，继续通过 `danmaku:message` 和 `danmakuFeed` 分发。共用 DOM renderer，六套 CSS 各自拥有视觉和独立 SVG。

**Tech Stack:** CommonJS Node 后端、原生 ESM/DOM、CSS、SVG；无新依赖。

**Status:** Complete — 2026-09-14。

## Current Behavior And Ownership

- `src/server/runtime-transport.js` 的 `publishGiftFlushed` 在 final 后触发；礼物投影层已保证每组只从 progress 转 final 一次。
- `src/bilibili/danmaku/feed-buffer.js` 投影公开消息并保留最近 50 条。
- `public/js/overlays/danmaku-message-renderer.js` 被弹幕姬和游戏共用；当前只渲染聊天。
- `public/js/overlays/danmaku.js` 拥有六套样式与默认预览。
- 视觉所有权为 `public/css/overlays/danmaku/{base,signal,bubble,minimal,ranked,transparent,outline}.css`，资源置于 `public/img/overlays/danmaku-gifts/`。
- 契约归属 `docs/architecture/frontend/overlays.md` 与 `docs/architecture/backend/ws.md`。

## Compatibility Constraints And Non-goals

不改礼物结算、金额、过滤规则、存储、身份权限、OBS URL、WebSocket 主题或游戏消息源。不改普通聊天字段与视觉；旧消费者仍可使用礼物的纯文本 `message`。保留已有安装器及文档工作。

新增字段仅在礼物消息出现：`kind: 'gift'`、`giftName`、`giftCount`；所有文字经 DOM `textContent` 渲染。输入来自已结算礼物行，不传播原始行、凭据或内部账本数据。

## Milestones

- [x] 六套 SVG 与礼物 DOM/CSS：保留昵称、礼物名、数量，预览末尾补一条确定性礼物样本；浏览器检查各套原生布局。
- [x] 公开流投影：`pushGift(row)` 只接收 final 行，映射 `user_name/gift_name/num`，保留统一编号和上限；`publishGiftFlushed` 发布到现有弹幕主题。测试公开字段、无效数量、去重边界和快照恢复。
- [x] 定向测试、契约说明、diff 审查：完成后移动到 archive。

## Verification

`node --experimental-vm-modules --test test/danmaku-feed-buffer.test.js test/danmaku-overlay-renderer.test.js test/danmaku-overlay.test.js test/danmaku-overlay-fullscreen.test.js test/danmaku-style-ownership.test.js test/runtime-event-publication.test.js test/websocket-transport.test.js`

按新增公开流契约运行 `npm run verify:quick`。浏览器检查六套默认礼物可见、独立 SVG 完整加载、长名称和大数量能排版、普通消息保持原样；全屏礼物遵循现有布局与到期机制。使用模拟数据，不写真实用户数据。

最终运行 `git diff --check`、审查 touched diff 与 `git status --short`。

## Rollback Or Failure Handling

按本任务的文件 diff 单独撤回，删除仅本任务新增且已核对的资源，不使用 reset、checkout 或批量删除。

## Done When

六套实际渲染与默认预览均可见独立礼物设计；公开流测试及相关检查通过；文档准确，最终 diff 无运行数据或无关修改。

## Results

- 43 项定向测试通过，包含上列 27 项和 `test/processed-gift-import.test.js`、`test/gift-effect-danmaku.test.js` 的 16 项；覆盖 final 单次交付及历史导入不产生实时副作用。
- `npm run verify:quick` 通过：737 个 JS 文件语法检查、5 项文档检查与 22 项架构检查。
- 六套在 624×640 预览内均显示五条完整样本；预览的 minimal 间距收至 14px，ranked 表情缩至 3em，首条文案缩短。实时布局不受这些预览调整影响。
- 模拟 WebSocket 验证六套快照与重复增量事件只显示一条礼物；outline 按 2 秒测试配置到期移除。六套长昵称、长礼物名与 999999 数量均无横向溢出。
- 独立视觉审查提出的预览剔除问题已修复并确认 ship；文档核对确认局部扩展保持既有视觉系统，无需新增 DESIGN.md。检测器仅命中既有信号带边框。
- 本机 3000 端口运行页面与工作区存在版本差异；浏览器验证从工作区读取静态文件并使用模拟事件。截图保存在工作区外的 Codex 可视化目录。
