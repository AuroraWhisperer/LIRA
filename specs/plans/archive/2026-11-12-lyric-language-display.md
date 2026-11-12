# 直播歌词译文与罗马音显示

Status: Completed

## 目标与范围

基础直播歌词可独立选择译文、罗马音的显示，保存后同步至客户端预览、独立浏览器源和画布。截图中的拉丁字母副行为罗马音；本次不做语言识别、不拆分原歌词文本，也不改高级歌词与大播放器的现有控制。

## 当前行为与归属

`desktop-lyric-renderer.js` 已分别创建 translation 与 roma 节点。`desktopLyricShowTranslation` 只隐藏译文，罗马音始终可见。新增独立开关即可复用现有渲染及设置链。

- 设置 owner：`public/js/lyrics/desktop-lyric-{defaults,settings,styles}.js`、`src/storage/settings-defaults.js`。
- 客户端/画布：`public/js/admin/desktop-lyric.js`、`desktop-lyric-parameter-layout.js`、`public/js/shared/scene-extra-components.js`、`public/pages/admin/song/desktop-lyric-behavior.html`。
- 输出：`public/css/lyrics/desktop-lyric.css`、`src/server/overlay-projection.js`；所有基础歌词入口复用现有 renderer。
- 契约：`docs/reference/backend/storage.md`、`docs/reference/frontend/overlays.md`；用户帮助：`public/pages/admin/toolbox/usage-guide-configuration.html`。

## 兼容与决策

新增布尔字符串键 `desktopLyricShowRoma`，默认 `'true'`，缺失时保持原先的罗马音显示。保留 `desktopLyricShowTranslation` 的值和语义。沿既有 settings 默认补齐，无表结构迁移；本机外观设置不新增云端写入。字号比例原本同时影响两种副行，仅显示罗马音时继续开放该控件；译文不透明度仍只依赖译文开关。

工作树已有大量修改，任务前副本存于 `tmp/lyric-display-20261112/baseline/`；只改本任务涉及的行，不提交、不打包、不操作用户运行中的客户端。

## 实施与验证

- [x] 在既有浏览器歌词用例补充译文/罗马音四种组合及旧配置兼容；修改前关闭罗马音失败，修改后通过。
- [x] 新键接入默认值、规范化、CSS 显示、客户端控件、共享画布字段和输出白名单；同步文档。
- [x] 扩展既有设置持久化/表单自动保存及画布测试，确认关闭后恢复和独立设置。
- [x] 定向测试：`node --experimental-vm-modules --test test/lyrics/desktop-lyric-settings-runtime.test.js test/settings/settings-contract.test.js test/overlays/overlay-projection.test.js test/lyrics/desktop-lyric-layout-browser.test.js test/admin/canvas-editing.test.js`。58 项中 57 项通过；唯一失败是未改动的画布拖拽用例在页面卸载后读取响应体，报 `Network.getResponseBody`，与歌词设置无关。画布歌词保存用例再次单独运行通过；未修改该拖拽测试。
- [x] 复用隔离 Electron 夹具验证译文保留、关闭罗马音、仅罗马音时字号可调、都关闭时正文保留、重新打开恢复选择、无副行歌词无多余内容；最终无页面错误。证据在 `tmp/lyric-display-20261112/`，测试进程和独立用户数据已清理。
- [x] 执行 `npm run verify:docs`；首次 9/10，通过后续归档复验为 10/10。首次失败来自已有 AI 人设计划状态标签，该计划由其他工作更新，本任务未修改。
- [x] 12 个涉及 JS 文件语法检查、`git diff --check` 与任务前副本对照审阅通过；改动仅覆盖显示选择、接线、回归和相应文档。

## 回退与完成条件

如验证失败，在任务前副本与当前文件之间逐段核对并仅撤回本次改动；不做整文件回滚。完成条件为四种显示组合正确、旧设置行为保持、选择能保存恢复、画布与输出接线通过、文档与帮助一致。没有上游副行时不生成替代内容。
