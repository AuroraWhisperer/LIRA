# Feature: 点歌板分风格设置隔离

## Goal

点歌板风格 1–6 各自保存当前界面提供的字号、字体、字重、文字颜色、纵向滚动模式与滚动速度；在一个风格中修改这些设置，不改变其他风格再次选中时的值或 OBS 渲染结果。

## Context

风格 1 已使用 `queueSongFontSize`、`queueScrollMode` 和 `queueScrollSpeed` 等专属设置。风格 2–6 目前共同读取 `identityQueueFontSize`、`identityQueueScrollSpeed` 与 `queueScrollMode`，风格 3–6 还共同读取四个 `illustratedQueue*` 文字设置，因此在风格 4 调整字号会同时改变风格 2、3、5、6。

## Constraints

- 保持现有 `/api/settings` 方法、路径、响应形状、鉴权和 WebSocket 快照格式。
- 不新增数据库表或列；继续使用 `settings` 键值表和字符串值。
- 风格 1 的配色、标题、序号与外观设置保持原键和原行为。
- 风格 2 的置顶公告与规则设置继续只属于风格 2。
- 风格 3–6 的素材、布局、横向文字滚动和画框比例不变。
- 不删除旧共享键；旧快照与旧主题预设仍可通过兼容回退读取。

## Non-goals

- 不为插画风格新增配色、标题、序号或低功耗控件。
- 不改变歌单板、歌词、弹幕或其他悬浮层设置。
- 不重构通用设置 API 或主题预设存储结构。

## Architecture

### Frontend

- `public/js/shared/queue-style-settings.js` 拥有六种风格到持久化键的唯一映射，并把当前风格的键投影到渲染器现有的通用字段。
- 管理页继续复用一组风格 2–6 控件，但填充和收集时只读写当前风格的键；共享区域增加纵向滚动模式控件。
- OBS 队列在计算渲染指纹、应用主题和布局滚动前解析当前风格设置，现有渲染函数不直接感知新增键。

### Backend

- `DEFAULT_SETTINGS` 增加风格 2 的独立滚动模式，以及风格 3–6 各自的字号、字体、字重、自定义颜色开关、颜色、滚动模式和滚动速度键。
- 一次性迁移把升级前的共享值复制到对应风格键，保证升级后的初始画面与升级前一致。
- 主题预设把新增键作为现有 overlay scope 的一部分保存和恢复。

### Security

- 写入继续经过现有 `/api/settings` 鉴权和 `DEFAULT_SETTINGS` 白名单，不接受未声明键。
- 设置值仍以字符串持久化；数值在管理页和渲染器已有范围归一化逻辑中限制，字体通过 `style.setProperty` 使用，用户文本继续由既有转义/DOM API 输出。
- 不新增秘密、外部请求、HTML 插值或 SQL 字符串拼接；迁移使用参数化语句。

## Compatibility

- 首次升级把 `identityQueueFontSize`、`identityQueueScrollSpeed`、`queueScrollMode` 与四个 `illustratedQueue*` 值复制到新键。
- `identityQueueFontSize` 和 `identityQueueScrollSpeed` 继续作为风格 2 的设置；旧 `illustratedQueue*` 键保留为旧快照/预设的回退来源。
- 旧 `festival` 样式值仍按 `identity` 处理。

## Acceptance Criteria

1. 在风格 4 修改字号并保存后，风格 2、3、5、6 的字号保持各自此前值；重新加载管理页和 OBS 后仍成立。
2. 风格 3–6 的字体、字重、自定义文字颜色开关和颜色互不串值。
3. 风格 1–6 的纵向滚动模式和滚动速度互不串值。
4. 风格切换只持久化 `overlayQueueStyle`；编辑表单只提交当前风格拥有的设置键，不覆盖隐藏风格。
5. 已有用户升级后，六种风格首次显示与升级前共享配置一致。
6. 主题预设能够保存和恢复全部新增分风格设置。
7. 原有画框、词条、置顶公告、规则和公开设置 API 保持兼容。

## Done When

- 聚焦设置迁移、管理页收集/填充、OBS 解析和风格隔离测试通过。
- `npm run verify:quick` 与适用完整测试通过，或任何无关失败都有明确证据。
- 设置、Admin 与 OBS owner 文档和规格索引更新，最终 diff 仅包含本任务文件和此前用户改动。

## Runtime Evidence

- 2026-08-23：浏览器端到端验证确认风格 4 与风格 5 分别保存 `neonVinylQueue*` 和 `cherryRibbonQueue*` 键，OBS 分别渲染 41px 与 22px；快速切换及重新加载后值仍隔离。
- 2026-08-23：聚焦回归 50/50、Admin shell 40/40、完整测试 844/844 通过；`npm run verify:quick` 在最终文档归档后复验。
