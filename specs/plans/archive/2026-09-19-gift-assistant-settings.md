# 礼物姬功能分区与导出设置迁移

**Status:** Completed — 2026-09-19。

**Goal:** 最近礼物只负责查询、选择、预览和导出记录；百宝箱的礼物姬按礼物边框、滚动礼物、图片导出三个分区管理设置。

**Architecture:** 保留既有页面组合、礼物展示 HTTP 接口和导出任务。礼物姬编辑展示配置，Electron 导出控制器拥有独立的导出默认配置，创建任务时冻结配置。

**Tech Stack:** Electron 43、Node 24、Vanilla ESM、原生 CSS。

## 边界与现状

- 现有礼物姬仅含礼物边框，展示设置在流水抽屉，输出方式/背景/文件夹依赖已创建的导出任务。
- 复用原礼物边框、展示设置字段及颜色、OBS 地址、PNG 排版和任务快照。
- 不修改横幅素材、渲染尺寸、礼物记录、来源隔离、导出安全约束或原有 IPC 方法。
- 保留工作区既有横幅及导出修改；不提交、不创建分支。

## 所有者与契约

- `public/pages/admin/toolbox/gift.html` / `public/js/admin/gift-assistant.js`：三个分区和初始化。
- `public/js/admin/gifts/display-settings.js`：独立展示草稿、保存、恢复和取消。
- `public/js/admin/gifts/export-settings.js`：独立桌面导出默认设置。
- `public/pages/admin/gifts/history.html` / `history-tools.js` / `export-preview.js`：保留记录、预览和执行导出。
- `src/electron/gift-export-controller.js`：默认设置读取、校验、原生目录选择、任务配置冻结。
- `src/electron/preload.js` / `ipc/gift-export-ipc.js`：新增窄接口 `giftExport.settings(options?)`；旧方法保持兼容。
- `src/server/gift-export-runtime.js`：通过既有 settings store 原子保存默认值；复用 `giftExportDirectory`，新增 `giftExportMode` 和 `giftExportBackground`。
- 契约文档：`docs/architecture/desktop/preload.md`、`backend/storage.md`、`frontend/app.md`。

## 接口与兼容

`gift-export:settings` 无参数读取；写入只接受 `mode`（combined/separate）、`background`（transparent/white）、`directoryAction`（choose/default）。返回既有 `{ok, data/error}` 包装，data 为 `{mode, background, directory, custom}`。

目录仅来自原生对话框或系统默认，不接受 renderer 路径。沿用主窗口、主 frame、精确 origin 和页面路径检查。原生对话框取消不修改设置；导航/销毁后的对话框结果不落盘。任务已创建后，默认值修改不影响该任务。

## 实施与验证

- [x] 独立导出设置：扩展控制器/runtime/IPC，测试无礼物也可配置、非法参数与来源拒绝、目录取消、重新创建控制器后恢复及旧任务保持配置。
- [x] 迁移 UI：礼物姬三个分区，展示草稿独立，导出设置自动保存；流水仅保留查看与导出，预览只读显示本次配置和目录。
- [x] 复用现有 UI fixture 测试分区归属、草稿保存/取消、无选中礼物的导出设置及预览操作；检查实际排版。
- [x] 更新导航说明、相关帮助及契约文档，运行聚焦测试、语法/架构/文档检查，审查最终差异。

聚焦命令：

```text
node --experimental-vm-modules --test test/gift-export-controller.test.js test/frontend-gift-display-settings.test.js test/frontend-gift-history.test.js test/frontend-gift-history-recovery.test.js test/gift-frame-admin.test.js test/gift-frame-draft.test.js test/admin-page-composition.test.js test/admin-style-ownership.test.js
npm run verify:quick
git diff --check
git status --short
```

## 回退与完成条件

失败时仅修复或撤回本次差异；不删除用户数据、不覆盖既有修改。旧设置缺失时保持拼图、透明背景和系统目录默认值，无数据库迁移。全部入口与保存行为可用、相关测试和权限检查通过、文档与差异审核完成后，将计划移入 archive。

## 验证结果

- 聚焦命令另含 `test/toolbox-lifecycle.test.js`，50 项测试全部通过。
- `npm run verify:quick` 通过：908 个 JavaScript 文件语法检查、5 项文档检查、22 项架构检查。
- Electron 43 使用独立临时数据、合成礼物、真实 preload 与导出 IPC 完成三个分区的画面检查，修改并保存滚动行数和导出方式/背景/目录后，从流水预览成功导出两张 PNG，预览翻页正常。目录对话框使用测试替身。
- impeccable 检测未报告问题；`git diff --check` 通过；已检查工作区状态并保留原有横幅/导出修改。
- 测试进程与服务已关闭；自动审批策略拒绝临时目录清理，临时材料留在系统临时目录，未进入项目差异。
