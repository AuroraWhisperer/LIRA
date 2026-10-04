# 客户端配色边界收敛

**Status:** Completed

## Goal

移除业务样式对具体客户端主题 ID 的依赖，并让主进程校验、设置页选项和前端选择共用现有主题 owner 的名单。保留六套配色当前效果。

## Current Behavior / Ownership

- `src/shared/client-theme.js` 拥有合法 ID、默认值和原生窗口底色，但前端与 HTML 重复枚举 ID。
- `src/server/admin-page.js` 组合设置页；`public/js/admin/client-appearance.js` 拥有候选/提交状态。
- `public/css/desktop/palettes.css` 拥有主题颜色；礼物、盲盒、粉丝名、全屏背景四处业务 CSS 仍匹配主题 ID。
- 契约入口为 `docs/reference/frontend/app.md`、`docs/reference/desktop/preload.md`；现有四个主题测试文件共 17 项通过。

## Compatibility / Non-goals

保留主题 ID、名称、顺序、暖陶默认值、本机保存格式、IPC 参数/返回值/鉴权、页面 URL、显式应用与失败保持行为。保持业务专属颜色、全屏背景选择、预览和直播输出边界。不增加依赖、构建步骤、主题导入或云同步；保留工作区其他改动，不提交。

## Changes / Milestones

1. 扩展现有共享 owner 为主题目录，由页面组合层生成设置选项；前端从选项读取 ID 和默认项。验证目录与选项一一对应、候选/保存/失败/重启行为。
2. 色板提供组件适配变量；组件在自己的作用域组合业务色和适配变量。可选变量用 `initial` 重置，让普通主题使用组件原有值，避免预览继承其他主题的覆盖。验证四处业务 CSS 无主题 ID 分支、色板变量完整、对比度与旧版计算样式一致。
3. 补回归检查及当前契约说明，完成差异检查和隔离 Electron 样式验证。

## Verification

- `node --experimental-vm-modules --test --test-reporter=spec test/admin/client-theme-palettes.test.js test/admin/client-appearance.test.js test/admin/admin-page-composition.test.js test/desktop/client-appearance.test.js test/transport/client-theme-html.test.js test/gifts/frontend-blindbox-themes.test.js test/gifts/frontend-recent-gifts.test.js`
- `npm run verify:quick`：共享目录/页面组合边界、语法、文档门禁。
- 隔离 Electron 渲染 fixture：六种根主题、所有相关业务色变体、全屏渐变；将当前与修改前计算样式比较。检查深色切回浅色、深色父级内的浅色预览及新增目录项同步。
- `git diff --check`、任务差异及 `git status --short`。

## Rollback / Done When

修改前内容保存在仓库 `tmp/` 内，仅用于对照当前任务差异。失败时只修复或撤回本任务引入的修改，不覆盖其他未提交内容。名单单一归属、业务 CSS 无具体主题判断、相关行为与样式验证通过、契约与结果记录一致后完成。

## Results

- 统一目录、服务端选项模板、前端候选/默认项读取以及四处组件变量适配均已完成；公开 IPC 与持久化格式未变。
- 上述 7 个聚焦测试文件共 40 项通过。补充目录/HTML 一一对应、前端接受新增目录选项、CSS 与原生底色一致、可选变量重置、业务 CSS 不引用主题 ID 的回归约束；色板测试按选择器发现预设，不再依赖声明块序号。
- Electron 43.2.0 隔离 fixture：每主题 112 个采样点，六套主题共 672 个样式采样全部一致；六组修改前后截图逐字节相同。覆盖三种大航海、九种盲盒的卡片/映射、粉丝等级色、31 个全屏背景。
- 六套主题逐一选择并应用、保存失败保留当前主题和候选、深色切回浅色均通过；36 种父级/预览主题组合隔离通过。设置页交互使用实际控制器和合成桌面桥；真实保存/IPC 来源通过现有聚焦测试验证，未操作用户实例。
- `npm run verify:quick`：文档 10 项与 1209 个 JS 文件语法检查通过；架构 21/22 通过，唯一失败来自本任务未修改文件的大小限制：`src/electron/cloud-sync-controller.js` 626 行未登记、`src/electron/main.js` 771 > 766、`src/server.js` 760 > 753。保留其他任务的在途改动，不调整基线掩盖该失败。
- 任务差异已对照修改前快照审查，`git diff --check` 通过。Electron 验证实例已关闭，专用 profile/session 已清理；基线、计算样式报告与截图保留在被忽略的 `tmp/client-theme-modularity-H9NPv6/`。
- 删除同目录下 `NVIDIA Corporation` 验证缓存的 PowerShell 操作被自动审批审核拒绝，仅返回 `blocked by policy`。未改用其他工具绕过，缓存保留在被忽略的 tmp 中。
