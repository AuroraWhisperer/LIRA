# 弹幕参数统一复用实施计划

Status: Completed

## Goal

常用与高级参数集中管理定义和控件，每款独立保留参数值；新样式声明能力、默认值和专属参数即可复用。评估手账风与花与信笺的最少专属项，本轮先完成公共体系。

## Current Behavior And Ownership

原桌面与画布共用绑定，独立预览另有一套控件；随机停留时间为全局值。现由 `public/js/shared/danmaku-style-options.js` 定义字段与能力，`danmaku-parameter-controls.js` 构造公共控件，`danmaku-appearance-draft.js` 更新当前样式。高级效果复用 `component-style-parameters.js` 与 `component-style-parameter-view.js`，不合并不同职责的数据结构。`component-parameter-fields.js` 负责编辑状态与订阅释放，admin 原入口重导出以兼容其他组件。

桌面/画布的 `admin/danmaku-parameter-view.js` 和独立预览的 `overlays/danmaku-preview-appearance.js` 只适配入口差异；本地 `overlays/danmaku.js` 消费参数。本仓 Node 合同通过 `scripts/sync-danmaku-style-options.cjs` 从浏览器定义生成。

文档 owner 为 `docs/reference/frontend/overlays.md`、`docs/guides/component-style-parameters.md`、应用内弹幕指南。

## Compatibility And Non-goals

保留 `styleOptions[style]` / `styleParameters[style]`。同款多个内置组件共享外观，位置与尺寸独立；不同款参数独立。`durationSeconds` 为 2–30 秒整数、默认 6，缺失时回退旧顶层值，恢复仅当前款回到 6。保留默认视觉、身份配色、字体换算、保存时机与编辑中防回填。

2026-10-28 用户本轮明确确认“以本机外观为准”，保存与正式输出遵循[本地外观边界](../../../docs/architecture/adr/0022-local-component-scenes.md)。原强制 Server 同步步骤取消；已逐项撤回本任务新增的 Server 参数、协议和测试，服务器已有独立改动保留。本机生成脚本不访问 Server、不参与运行时或构建。不改鉴权、不增加依赖、不提交或部署，保留工作区并行改动。

## Milestones

- [x] 统一字段定义、能力校验和默认值，生成本机 Node 镜像。
- [x] 三个入口复用控件、编辑/恢复逻辑，原有专属参数及外观效果保持可用。
- [x] 停留时间按样式保存，兼容旧值；本机保存、画布发布及独立预览验证。
- [x] 同步接入规范与使用指引，收敛专属参数建议，完成最终检查与归档。

## Verification

聚焦 `danmaku-style-options`、`danmaku-local-preview`、`server-danmaku-settings`（已接本机）、`admin-danmaku-markup`、`danmaku-panel-edit-state`、`component-style-parameters`；隔离桌面使用 `test/desktop/danmaku-canvas-electron.test.js`。运行本机合同 `--check`、相关语法检查、`npm run verify:architecture`、`npm run verify:docs`，最终 diff/check/status。失败先定位原因，相关实现未改变时复用通过结果。

## Failure Handling And Done When

只反向修改本任务的行，不覆盖并行改动。完成条件：定义与 UI 不按入口重复维护；所有用户可调值按样式保存并正确恢复；旧数据兼容；现有专属参数可用；聚焦与桌面验证充分；文档和最终差异一致。审批拒绝的临时清理如实记录，不绕过。

## Evidence

- 聚焦六文件 85 项：69 项参数/草稿/合同检查通过，完整浏览器交互文件 16/16 通过。中途本机 API 迁移改变响应读取与重读夹具，按新接口更新夹具后通过。
- 隔离 Electron 5/5 通过：桌面保存/重开，画布调整时长/恢复/发布，以及效果参数独立保存。使用合成数据与临时目录，不操作日常应用实例。
- 手动 Electron：outline=3、cream=9；切回 outline 保持 3，恢复为 6 后 cream 保持 9；投影参数按 outline 保存。独立预览发现的勾选框与标题适配已在所属 CSS/公共视图修复。
- 75 个原有默认/字号/颜色解析样本与改造前一致；本机合同生成检查通过。已撤回方向的 Server 检查不作为当前交付证据。
- 架构检查 28/28、文档检查 10/10 通过；更新接入规范、参数使用指南及应用内说明。最终审阅仅涉及本任务的参数定义、公共控件、适配入口、兼容与相关验证，保留并行迁移和其他改动。
- 专属项建议只保留两个候选：手账风的装饰动态（原版/轻柔/静止）；花与信笺普通弹幕右下角短句（最多 6 个汉字或 12 个 ASCII 字符，混排按汉字占 2 单位、总计不超过 12，单行且不接受表情、换行或位置/字号改动）。胶带开关、任意称呼和时间开关不建议增加。本轮未实现这些候选项。
- 手动 QA 的 REPL 超时丢失句柄；结束和清理该实例的命令被自动审批以 blocked by policy 拒绝，未绕过。保留 `tmp/danmaku-parameter-qa-r0NFru`、`tmp/danmaku-parameter-qa-zNitTt`，后者 Electron PID 36032 在拒绝前仍运行。自动化测试夹具自行正常清理。未提交、打包或部署。
