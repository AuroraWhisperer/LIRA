# 歌词已唱与未唱配色实施计划

**Status:** Completed

## 目标与边界

在直播歌词「显示策略」中集中调整已唱、未唱颜色，同步预览、直播输出和画布。依照用户补充要求，原基础文字颜色移为未唱颜色，不重复提供第三个颜色控件。整句文字、翻译与罗马音沿用此颜色；不改变时间轴、动效或播放器来源。

## 当前行为与所有权

`public/css/lyrics/desktop-lyric.css` 的已唱色固定为 `#ffcf4a`，未唱跟随文字颜色；`moonlit.css` 的已唱色为 `#93682f`。设置由 `src/storage/settings-defaults.js` 和 `public/js/lyrics/desktop-lyric-defaults.js` 提供，`desktop-lyric-settings.js` 归一化、`desktop-lyric-styles.js` 应用。管理表单及 `scene-extra-components.js` 是编辑入口，`src/server/overlay-projection.js` 是直播设置投影边界。

## 兼容与实现

仅新增 `desktopLyricSungColor`，默认空字符串表示继承，显式值沿用现有十六进制颜色（含透明度）约定。未唱复用 `desktopLyricTextColor` 及其保存值；移除基础样式的重复入口。颜色 Alpha 各自独立，不再由颜色按钮修改统一 `desktopLyricOpacity`，该控件仍在可见性与同步中。沿用 settings 缺失键初始化，无数据库结构或数据迁移。已唱 CSS 变量仅在显式配色时覆盖；旧配置、月渡花汀保持原配色。管理页以两个颜色控件及已唱继承复选框替换静态图例。画布复用现有 allowEmpty 控件，支持已唱继承提示/颜色回退。保留工作区此前改动，不提交或操作真实数据。

## 实施与验证

- [x] 设置、渲染、编辑入口和文档已完成，保留原文字颜色与统一不透明度。
- [x] `node --experimental-vm-modules --test test/lyrics/desktop-lyric-settings.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/lyrics/desktop-lyric-surface.test.js test/scenes/scene-extra-components.test.js test/overlays/overlay-projection.test.js`：44 项通过。
- [x] `node --test test/lyrics/desktop-lyric-layout-browser.test.js test/admin/canvas-component-library.test.js`：5 项通过，覆盖两种高亮模式、关闭、月渡花汀、画布控件及共享保存。
- [x] 隔离 Electron 检查：原颜色 `#48657a` 保留、入口无重复、已唱 `#ec4899` 与未唱 `#38bdf880` 独立呈现/保存，整体不透明度仍为 `0.95`，关闭逐字保留普通文字；无页面错误。证据在 `tmp/lyric-color-qa/`；测试实例及服务器已关闭。
- [x] UI 检测无发现，JavaScript 语法检查通过；文档校验首次 9/10 通过，另一个并行计划 `2026-10-15-rendering-performance.md` 状态格式导致活动计划门禁失败，未改写该任务内容。

## 完成条件与回退

两个颜色独立保存并呈现，继承及重置恢复旧样式，文档与测试同步；无关工作区门禁失败单列如上。失败时仅撤销本计划所列任务改动，保留先前未提交内容；不使用重置或广泛回滚。
