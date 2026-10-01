# 性能页显示器信息

**Status:** Complete

2026-10-01：显示配置读取、横向布局和定向验收完成。归档记录仅覆盖本次功能；下述全库架构检查的无关问题不属于本次修复范围。

## Goal

在性能页「本机硬件」的 CPU / GPU / 内存三列下方增加横向显示器列表，显示当前像素分辨率、主屏、系统缩放与刷新率。打开性能页和开始检测时读取当前显示设置。

## Boundaries and current behavior

- 现有 `system-metrics.js` 缓存 CPU / GPU / 内存静态信息，温度按请求读取；显示设置需要重新读取，不能沿用静态缓存。
- 复用受保护的 `GET /api/system/hardware`，只增加 `displays` 与 `displayMessage` 字段；不新增 IPC、权限、依赖、持久化或后台轮询。
- Windows 原生 `EnumDisplaySettingsW` 读取当前模式，避免用网页 CSS 宽高乘设备缩放导致舍入错误。显示器名称使用 Windows 设备名称，不读取序列号。
- 不修改其余性能卡片或用户已有改动，不自动提交、重启或控制用户应用。

## Ownership and contract

- Owner：`src/server/system-metrics.js`，Windows 显示配置读取与字段归一化。
- Contract：`docs/reference/backend/api.md` 的硬件查询条目。
- Consumer：`public/js/admin/metrics.js`、`public/pages/admin/toolbox/performance.html`、`public/css/admin/toolbox/performance.css`。
- Tests：`test/server/system-metrics.test.js`，新增针对显示器渲染/刷新行为的 `test/admin/performance-displays.test.js`。

## Milestones and verification

1. 扩展硬件查询：保留静态缓存，每次请求读取显示设置，读取失败只影响显示器区域。测试缩放像素值、多屏、不可用数据、重复查询刷新。
2. 添加横向信息行：分辨率为主值，主屏标识和辅助参数降级展示；复用现有开始检测按钮。测试重复渲染不追加重复项与切回页面重读。
3. 隔离 Electron 验收：使用仓库已有 HTTP/桌面授权组件、真实硬件查询与现有 preload；所有临时数据在 `tmp/`，无用户数据库、账号或固定端口。核对真实分辨率、检测按钮、两屏模拟布局和不可用状态。

命令：

```text
node --experimental-vm-modules --test test/server/system-metrics.test.js test/admin/performance-displays.test.js test/admin/frontend-admin-toolbox.test.js test/admin/frontend-admin-shell.test.js test/admin/admin-style-ownership.test.js
npm run check
npm run verify:architecture
npm run verify:docs
git diff --check
git status --short
```

## Failure handling and done when

显示器读取失败返回空列表和明确说明，CPU/GPU/内存仍可返回。仅撤回本任务精确 diff，不使用 blanket checkout/reset。完成要求：定向检查通过，真实 Windows 与隔离 Electron 证据足够，契约同步，最终 diff 不包含临时数据或无关变更。

## Evidence

- 30 项定向测试通过：硬件服务缓存/显示配置刷新、150% 缩放像素值、多屏/主屏、未知参数、重复渲染、并发加载去重、既有页面结构与 CSS 归属。
- `npm run check` 通过，检查 1141 个 JavaScript 文件。
- 隔离 Electron 使用真实 `/admin?desktop=1`、既有 preload 和请求授权；匿名路由先确认返回 401。真实设备读取为 2560 × 1440、150%、240 Hz；第一次进入仅一次硬件请求，开始检测只增加一次，页面无运行错误。
- 同一隔离窗口使用测试响应检查双屏（含竖屏）排版，以及读取失败清空旧值、随后真实读取恢复。双屏是模拟数据，不宣称实机接入两块显示器。截图存于仓库 `tmp/performance-displays.png`；测试进程和独立 userData 已清理。
- Impeccable 检测仅发现既有指标进度条的 `transition: width`，本次新增区域没有检测项。
- `npm run verify:architecture` 21/22 通过。剩余为本次未修改的 `fan-profiles.css`、`fans/index.js`、`src/electron/main.js`、`frontend-gift-wishes.test.js` 超出既有行数上限；不修改其他并行工作的代码或放宽上限。
- 文档门禁首次发现本计划状态格式不符合约定，已修正。归档后复验 8/9 通过，剩余为另一个并行任务的 `2026-10-01-planner-reminders.md` 状态格式，本次不改其计划。`git diff --check` 通过，已审阅任务 diff 和工作区状态；未暂存/提交，也无运行数据进入本次 diff。
