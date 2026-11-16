# 点歌结果提示宽度与文字配色

Status: Completed

用户确认只开放点歌人、歌名两种颜色。

## 目标与边界

短提示随内容收紧，消除歌名和结果之间的大片空白；长内容仍完整滚动、结果可见。
在「点歌规则」增加两项自动保存的文字颜色。背景、结果颜色、提示时序和队列规则不变。
不增加依赖、远端字段、订阅或数据库表，不操作用户运行中的客户端和数据。

## 现状与归属

- `public/css/overlays/base/foundation-and-classic.css` 的左右 inset 与 flex 填满面板，造成短提示空白。
- `public/js/admin/settings-form.js` 拥有规则自动保存；`state-renderer.js` 已按设置键填充、保留脏字段。
- `src/storage/settings-defaults.js` 通过既有 INSERT OR IGNORE 补齐默认值；`src/server/settings-contract.js` 校验更新。
- `src/server/overlay-projection.js` 拥有队列展示白名单，`scene-shared-appearance.js` 提供场景共享外观。
- `public/js/overlays/queue-theme.js` 应用颜色，`queue.js` 负责快照变更判定。
- 技术契约：`docs/reference/backend/{api,storage}.md`、`docs/reference/frontend/{app,overlays}.md`。
- 用户说明：`public/pages/admin/toolbox/usage-guide-song.html`；交互式引导无相关步骤。

## 实施与验证

1. 增加本地设置 `queueRequestRequesterColor`、`queueRequestSongColor`，沿用原深蓝和深紫；仅接受六位十六进制颜色。验证保存、重新创建 store 后恢复、非法整批拒绝、不启动云同步。
2. 规则页复用颜色控件（不透明颜色）与自动保存；队列投影、渲染变更判定和场景资源风格接入。复用现有表单、投影与队列测试，补最小颜色接线覆盖。
3. 用 CSS 内容宽度加面板宽度上限收紧提示，沿用现有滚动逻辑。隔离 Electron 检查两个取色器、保存和刷新；检查短成功提示与长失败提示（含窄宽度）。临时文件和截图只在 `tmp/`。

直接检查：

```text
node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/queue-request-notice.test.js test/songs/queue-overlay-esm.test.js test/songs/frontend-queue.test.js test/overlays/overlay-projection.test.js
npm run verify:docs
npm run verify:architecture
git diff --check
git status --short
```

新增设置与展示白名单需要架构门禁；不改变服务端规则契约，不运行全量业务测试。
核对用户文档和相关说明后，检查最终 diff 不含临时数据、截图或秘密。

## 兼容与回退

旧库缺键沿用默认值补齐，不覆盖已保存颜色；旧快照由 CSS 默认色兜底。
仅在现有 settings 与队列白名单加入这两个非敏感字段，不扩大权限或改变认证。
失败时停止交付，依据本任务 diff 逐项撤回自己的改动，保留其他用户变更。

## 完成条件与证据

两种文字颜色自动保存并在点歌板生效，短提示收紧且长内容完整可读；定向检查通过，文档同步，最终 diff 已审阅。
- 相关 Node 测试 67 项通过（首轮 51 项，补充场景/投影 29 项，其中 13 项为复核）；架构门禁 30 项通过。
- 隔离 Electron 复用 `danmaku-canvas-editor.cjs` 的真实 preload、授权窗口、HTTP 设置路由，加载真实规则表单与自动保存。两个取色器分别保存，仅产生两次设置请求；刷新和正式 `fillSettings` 回填保留选择。SQLite 重新创建 store 的恢复由设置契约测试验证。
- 实际队列 iframe 中短提示约 183px，面板约 411px；自定义颜色计算结果与保存值一致。长失败正文 634px 在 332px 正文窗内滚动，结果可见；240px 窄来源中提示约 223px，仍完整保留失败结果。
- 资源风格共享外观测试确认采用规则页当前颜色，并拒绝资源库覆盖全局提示配色。底色、状态色、通知时序未改。
- 检测器的三项建议均位于既有未修改规则；不扩展本任务。技术参考和应用内使用说明已同步；交互式引导未描述这两项控件，无需修改；既有规则截图只说明 SC 和间隔设置，仍准确。
- 文档门禁首次因本计划状态与说明写在同一行未被解析而失败；完成记录改为独立状态行并移入归档后复核。最终差异检查不包含临时文件或用户数据；同工作区其他礼物功能改动保留。
- 测试进程与隔离用户目录已清理；未提交、打包、发布或替换用户运行中的应用。
