# 配套样式客户端设置 Implementation Plan

**Status:** Completed

**Archived:** 2026-10-08。功能及相应回归完成；当前合同由 `docs/reference/backend/{api,storage}.md` 和 `docs/reference/frontend/{app,overlays}.md` 维护。

**Goal:** LIRA 资源型配套样式导入后，在对应功能页使用原生参数控件保存默认设置及预览，画布继续支持独立调整。

**Architecture:** 复用组件预览工厂和配置控制器；样式库 owner 原子保存经过场景合同验证的参数补丁，资源身份和文件保持不变。航海旗帜的本地触发开关由礼物设置 owner 持有，外观由组件配置持有。

**Tech Stack:** Electron、原生 ESM/CSS、Node.js、现有 node:test/Playwright fixtures。

## Constraints and non-goals

- 不提交、不发布；保留当前礼物许愿、测试脚本等未提交修改。
- 不运行包内代码，不扩大第三方网页/媒体权限，不修改服务器身份与存储边界。
- 保存样式默认值只影响后续添加；场景的独立配置快照保留，已使用组件在画布调整。
- 不改变 ZIP schema、资源 URL、既有场景和内置感谢设置语义。

## Current behavior and ownership

- `component-style-client.js` 的资源卡片直接添加画布；功能页无默认参数编辑入口。
- `component-preview-definitions.js` 及各原生 preview/parameter-view 已拥有参数控件。
- `component-style-library.js` / `component-style-store.js` 拥有素材验证、索引与原子写入；新增受管理身份/现有画布能力保护的参数保存操作。
- `guard-thanks-config.js` 拥有本地上舰事件投影；`gift-effects-component.js` 与 `guard-nautical-player.js` 消费事件和外观。
- 契约 owner：`docs/reference/backend/{api,storage}.md`、`docs/reference/frontend/{app,overlays}.md`。

## Milestones

- [x] 样式库参数保存：`POST .../styles/config` 接收 `{id,patch}`；只允许既有已安装 resourceStyle 的外观参数，禁止替换资源/样式身份；`normalizeSceneConfig` 验证后原子保存。测试重启读取、坏参数、权限、删除后保存、资源不变。
- [x] 功能页设置：`component-resource-settings-panel.js` 复用配置控制器和原生参数面板，覆盖时钟、弹幕、许愿、大航海、点歌板、歌词。时钟、弹幕、点歌板按选择切换参数；许愿复用已有预览和使用入口。开播页由同工作区的开播任务拥有，与本任务共用 `resource-style-settings.js` 和参数保存接口；保留其实现。第三方沿用既有流程。
- [x] 航海旗帜：新增本地独立启用键；旧未设置值兼容原启用状态；专属事件仅进入配套组件，内置/第三方不误播。增加头像、昵称、昵称字号设置，隐藏固定素材不支持的语言和月数选项。
- [x] 文档与验证：更新操作说明和合同；运行直接相关存储/事件/渲染测试与隔离 Electron 页面测试，完成语法、架构与文档门禁。

## Verification

- `node --experimental-vm-modules --test test/scenes/component-styles.test.js test/gifts/guard-thanks.test.js test/gifts/guard-nautical-player.test.js test/gifts/gift-guard-thanks-admin.test.js`
- 新增资源设置测试覆盖对应功能页、保存重开、画布配置与第三方兼容；使用 `test/fixtures/danmaku-canvas-editor.cjs` 的隔离 Electron 会话，所有数据放 `tmp/`。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs`；最终 touched diff、`git diff --check`、`git status --short`。

## Failure handling and done when

写入失败保留草稿，已保存配置和资源不变。只回退本任务补丁，禁止重置工作区。功能页可以读、改、保存并重新打开配套样式参数；画布复制保存后的默认值并独立调整；旧航海场景可用、独立开关不会连带播放内置动画；比例适当的检查通过后归档。

## Results

- `resource-style-settings`、`scene-gift-events`、`guard-thanks`、`gift-guard-thanks-admin`、`guard-nautical-player` 五个聚焦文件：24 项通过。包含默认值重读、非法补丁、管理身份、Origin/画布授权撤销、独立启用、三档素材、真实事件字段、去重及清理。
- `component-styles.test.js`：19 项通过；客户端套装列表刷新及连续添加的两个定向用例通过。
- 隔离 Electron：`resource-style-settings-electron.test.js` 和既有 `gift-wishes-electron.test.js` 通过。覆盖参数保存、失败保留草稿与重试、页面重载、原生/导入选择切换、头像/字号实际渲染、许愿单一预览入口和唯一 DOM ID。
- 语法检查 1,336 个 JS 文件通过；架构检查 23 项通过；文档检查 10 项通过。Impeccable 对所改参数界面和 CSS 的检测无发现。
- 桌面确认检查了时钟、航海旗帜和许愿的设置及预览，未发现横向溢出或重复预览入口；截图保存在忽略的 `tmp/`。所有自建 Electron 进程和隔离运行数据已清理。
- 未运行全库测试、打包、提交或发布；保留工作区中开播与许愿等其他任务的修改。
