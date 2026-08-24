# 萌时钟固定网址实施计划

状态：完成（2026-08-24）

## Goal

把萌时钟从“配置编码进 URL”改为“固定 URL + 服务端持久化配置”，同时兼容旧参数地址。

## Non-goals

- 不改时钟视觉和计时逻辑。
- 不实现 Browser Source 的实时配置推送。

## Current Behavior

实施前 `clock-card.js` 生成并展示带参数地址；`clock.js` 只读取 URL 参数，配置不持久化。
现有 `test/clock-overlay.test.js` 覆盖页面资产、参数和管理卡片结构。

## Ownership

- 设置持久化：`src/storage/settings-store.js`，契约 `docs/architecture/backend/storage.md`。
- HTTP：`src/server/api-routes.js`、`src/server/routes/`，契约 `docs/architecture/backend/api.md`。
- Admin：`public/js/admin/clock-card.js` 与对应 fragment。
- Overlay：`public/js/overlays/clock.js`，契约 `docs/architecture/frontend/overlays.md`。

## Compatibility Constraints

- 保留 `/clock` 和既有查询参数语义。
- 写接口保持 token 保护；只读公开接口不得泄露其他 settings。
- 不覆盖工作树中的无关用户改动。

## Proposed Changes

- 增加时钟设置默认键、服务端校验合约和公开只读配置路由。
- Admin 自动读取/保存设置，只展示并复制固定地址。
- Overlay 合并保存配置与显式 URL 参数。
- 更新时钟测试和架构事实文档。

## Milestones

1. 服务端配置合约与路由；验证路由规范化和设置拒绝非法输入。已完成。
2. Admin 与 Overlay 数据流；验证固定地址和旧参数兼容。已完成。
3. 文档及最终检查；运行聚焦测试、`git diff --check`、`git status --short`。已完成。

## Verification

- `node --experimental-vm-modules --test test/clock-overlay.test.js test/danmaku-overlay-settings.test.js test/opening-overlay.test.js test/server-modules.test.js test/governance-docs.test.js`：19 项通过。
- `npm run verify:architecture`：9 项通过。
- `npm run check`：441 个 JavaScript 文件语法检查通过。
- `git diff --check`：通过。

## Rollback Or Failure Handling

只反向修改本计划列出的任务文件；不使用 reset、checkout 或删除无关改动。

## Done When

固定地址、持久化、读取、旧参数兼容和服务端校验均由聚焦测试证明，文档与实现一致。已达成。
