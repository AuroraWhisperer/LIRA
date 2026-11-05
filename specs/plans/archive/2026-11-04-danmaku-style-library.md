# 弹幕最近使用与样式库

Status: Completed

## 目标与边界

主页面用一行最多四款的最近使用取代全部样式铺陈，提供全部样式弹窗。
弹窗使用现有 30px 高分段控件，按显示方式、持续装饰动效、节日元素和视觉风格取交集。
仅调整浏览、选择和本机 UI 历史；不改变各款参数草稿、恢复默认、保存/应用、画布或渲染契约。

## 当前行为与归属

- `public/pages/admin/live-components/danmaku.html` 是内置卡片来源，画布按 `data-danmaku-style` 读取。
- `danmaku-overlay-settings.js` 使用既有配置 controller；`danmaku-parameter-view.js` 管理各款独立草稿。
- 新 `danmaku-style-library.js` 只管理弹窗、筛选、快捷行；静态标签由 `danmaku-style-catalog.js` 提供。
- 历史使用 localStorage `lira.danmaku-recent-styles.v1.<encoded authorized account UI identity>`，值为最多四个去重样式 ID；没有参数或凭据，不是授权证据。存储不可用不影响选择或保存。
- 仅同 generation 的成功保存结束后记录 `saved.style`，浏览、预览、失败及过期响应不记；账号切换重新读取自己的历史。

## 实施与验证

- [x] 将现有卡片移入弹窗，快捷副本使用独立属性并调用原卡片动作，保留导入入口及画布消费者。
- [x] 接入组合筛选、空结果、清除筛选、最近使用和关闭回到参数区。
- [x] 延用参数及保存测试，覆盖筛选交集、历史保存时机和账号隔离。
- [x] 使用现成隔离 Electron fixture 检查紧凑控件、主界面单行、筛选及保存；截图保存到 tmp。
- [x] 同步 frontend pages/overlays/app 参考、受影响操作指引和截图；交互导览通用入口不变。

聚焦命令：

```text
node --experimental-vm-modules --test test/danmaku/server-danmaku-settings.test.js test/danmaku/danmaku-panel-edit-state.test.js test/admin/component-config-controller.test.js test/admin/canvas-component-library.test.js
npm run verify:docs
git diff --check
```

桌面 QA 使用 `test/fixtures/danmaku-canvas-editor.cjs` 与 tmp 隔离数据，不操作用户正在运行的应用。核对当前卡片、组合筛选、无结果恢复、选用不自动保存、逐款参数保留、成功记录及失败不记录。

## 兼容、回退与完成条件

所有外观配置、API/IPC、样式 ID 和用户现有工作树改动保持。源卡片只保留一份。
基线副本在 `tmp/danmaku-taxonomy/before/`，仅撤销本任务差异，不做整文件或仓库回退。
完成条件为上述聚焦检查、桌面截图、文档同步和最终任务差异检查通过。

## 验证结果

- 参数/面板 25 项、配置 controller/画布库 25 项、导入弹幕 1 项通过；新增历史回归保留各款参数，覆盖失败、保存中换款、账号切换与重载。
- 两个旧浏览器用例把动态模块加载与大量 DOM 初始化放在同一 CDP evaluate 时出现 Promise 回收；拆为两个 evaluate 后原断言全部通过。新测试 fixture 补齐真实响应使用的 text 方法。
- 隔离 Electron 真实保存、失败不记历史、重载恢复、26 款原卡片唯一、交集筛选/空态恢复、方向键与 Escape、导入入口通过，无 pageerror。分段选项 CSS 高 30px，窗口缩放后的实际约 29.4px。
- 说明截图已替换；源码与截图均为当前工作树，未构建安装包或重启用户应用。既有侧栏选中竖条的设计检测提示不属于本任务，保留其设计。
- 用户复核后去掉弹窗内重复标题；关闭按钮使用 30px 方形、1px 外边框和轻微内阴影，桌面实测居中且关闭正常，说明截图已同步。
- 文档门禁最终 9/10：本任务链接与文档检查通过，剩余失败为并行工作中的 `2026-11-04-queue-request-notice.md` 活动计划状态标记，本任务未修改该计划。`git diff --check` 通过。
