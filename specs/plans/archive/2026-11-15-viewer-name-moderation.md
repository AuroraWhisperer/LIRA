# Viewer name moderation implementation plan

**Status:** Complete (source implementation and isolated verification)

**Goal:** 主播可编辑默认昵称黑名单；观众的「叫我」指令成功或失败都有对应弹幕确认。

**Architecture:** 沿用 Server 的 ViewerNameService、租户 streamer_settings 与统一发送器。桌面沿用现有 Device 接口和受限 IPC，只维护当前编辑草稿。

**Tech Stack:** Node.js、SQLite、Electron、原生 ESM/HTML。

## Boundaries and current behavior

- 当前只确认有效昵称和超长昵称；空名、格式错误、关闭状态静默，数据库失败只抛错。
- 新设置 `danmaku.viewerNameBlockedWords` 缺省使用内置常见辱骂、色情、赌博诈骗、违法暴力词；保存值（含空数组）优先，不修改已有昵称。
- 比较使用简繁等价、NFKC、大小写折叠，忽略空白、标点、符号及不可见格式字符；不改写显示的原昵称。普通子串匹配，最多 200 条，每条最多 40 UTF-16 单元。
- Settings PUT 接受非空 `{enabled?, blockedWords?}`，缺省字段不覆盖；原客户端的 enabled-only 写入继续有效。旧服务器缺少 blockedWords 时，新桌面禁用黑名单编辑并提示更新。
- 同样拦截管理端新昵称。失败不回显被拒内容、不覆盖旧昵称；禁用状态回复未开启，写入失败回复保存失败后保留原错误上报。过长的合法 emoji 确认采用不回显昵称的短文案。
- 保留统一发送器的去重、队列上限、限流和来源/凭据校验；不承诺平台实际接收，不引入持久重放。修改词库取消未发改名确认。
- 不自动部署、提交、改用户数据、清理旧昵称或改欢迎/感谢快照。

## Ownership and milestones

- [x] Server：`src/lib/viewer-name-command.js` / `viewer-name-management.js` / 新 `viewer-name-blocklist.js` 拥有校验和默认词；`src/storage/viewer-names.js` 拥有设置持久化；`src/modules/danmaku/viewer-name-service.js` 拥有拦截与确认。扩展 `test/viewer-names.test.js` 与 `test/viewer-name-management-http.test.js`，验证默认拦截、词库删除/清空/重开/租户隔离、失败保留旧名、发送安全与 patch 原子性。
- [x] Desktop：`src/shared/viewer-names-contract.js` 投影新字段，`public/js/admin/danmaku-viewer-names.js` 和对应 HTML 增加可编辑多行词库及显式保存；复用现有样式。扩展 IPC 与既有 Electron 昵称流程，验证保存/失败草稿/账号切换/旧服务器能力。
- [x] 同步 Server viewer-welcome 协议、Device OpenAPI、REQ-BILI-013 / AC-BILI-012、错误码和存储归属摘要；同步 Live preload/pages 参考、昵称说明与应用内使用指南。架构所有权不变，无需新 ADR。交互式引导及独立 guides 未描述此词库，不需修改。

## Verification

1. Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/viewer-names.test.js test/viewer-name-management-http.test.js test/fixed-reply.test.js`，期望相关行为通过；`npm run docs:check`。
2. Live：`node --test test/bots/viewer-names-ipc.test.js`；`node --test --test-name-pattern="nickname management" test/desktop/fixed-reply-editor-electron.test.js`（现有隔离 Electron/真实 preload，匿名 admin 仍 401）；`npm run verify:docs`。
3. 两仓 touched diff、`git diff --check`、`git status --short`；保留所有任务前改动，无真实数据/生成物进入 diff。

## Failure handling and done when

逐文件回退本任务改动，不 reset/checkout 其他工作。保存失败保留桌面草稿和原词库；旧客户端不能清空新字段。上述行为、文档及定向验证完成即可交付源码；部署和真实 B 站发送验收单独报告。

## Results

- Server：昵称/Device/固定回复 60 项通过；最终增加事务失败回滚场景后，受影响的昵称/Device 32 项再次通过。文档与架构契约门禁 60 项通过。
- Live：IPC 3 项、既有隔离 Electron 昵称管理流程 1 项、编辑器高度/分页流程 1 项通过。保留真实 preload、来源校验及匿名 admin 401，未使用真实账号或运行数据。
- Live 文档门禁首轮因本计划缺少规范状态行而失败，补齐状态后 10 项全部通过。归档后再次运行导航门禁。
- 保留旧 enabled-only 写入的错误码；新的词库错误单独返回。格式与长度规则有界，写入失败保持原开关及词库。
- 未提交、打包、部署或向真实直播间发送弹幕；最终平台接收仍受统一发送器和 B 站限制。
