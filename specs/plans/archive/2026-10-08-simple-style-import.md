# 简化添加样式

Status: Completed

## Goal

面向没有计算机知识的用户，把画布和组件页的添加样式统一为选择文件、粘贴内容；程序识别格式，默认使用文件名称和组件尺寸，必要时展开可选设置。

## Boundaries and ownership

- `component-source-import.js` 管理输入、可选设置及分流；`component-style-library.js` 继续拥有媒体编辑和 ZIP 确认。
- `component-web-picker.js` 的原生选择器扩展 `auto` 类型；原有 html/css 调用和目录安全规则保持。HTML/CSS 仍自动复制配套资源。
- `component-style-routes.js` 的 pick-web 在 auto 选择媒体/ZIP 时返回受授权的文件流；客户端 API 转为 File，交给已有编辑/检查流程。不向 renderer 暴露磁盘路径，不增加任意路径读取。
- 保留鉴权、取消、库持久化格式和套装分类。普通第三方 ZIP 的自动解压不在本次范围，继续明确提示先解压。
- 当前已有五类本地按钮、三个输入模式和默认展开的尺寸；已有 `component-source-import`、`component-web-picker`、`component-web-import` 测试覆盖导入和资源隔离。

## Milestones

- [x] 统一原生/浏览器文件入口：自动分流 HTML/CSS、ZIP、媒体；保留配套资源、原有调用及安全校验。
- [x] 简化窗口：文件/粘贴两种方式、自动识别网址或 CSS、名称和尺寸默认折叠；文件夹入口自动选择首页，仅歧义时需要选择。
- [x] 更新相应测试、frontend/overlays 与 backend/api 参考、组件/背景指南和应用内教程。
- [x] 完成定向测试、隔离 Electron 界面检查、架构门禁、UI 检测与最终 diff/status 检查；文档门禁的工作区外部失败记录如下。

## Verification

- `node --test test/desktop/component-web-picker.test.js test/scenes/component-web-import.test.js`
- `node --test test/admin/component-source-import.test.js`（现有浏览器集成检查）
- 隔离 Electron fixture 检查统一入口、取消后保留窗口、HTML/CSS 配套资源、媒体/ZIP 分流，以及默认折叠设置。
- `npm run verify:docs`、相关 JavaScript 语法检查、`git diff --check`。

## Failure handling and done when

保留工作区原有修改；仅回退本次具体 diff，不做 reset/checkout。错误保持窗口可操作，取消不触发导入。默认界面无需用户选择技术格式，定向验证通过且说明同步后完成并归档。

## Evidence and limits

- 原生选择器、网页库/路由共 35 项通过，包含文件流、授权撤销、不暴露路径、目录隔离及旧 html/css 调用。
- 导入窗口 5 项通过（分次定向运行）：CSS/HTML 导入、发布重载、网址隔离、取消/无效粘贴/默认值，以及多样式目录的显式选择。
- 样式库 6 项行为通过。另 1 项既有断言要求 gift-frame 保留内置样式，但本任务开始前工作区 `scene-extra-components.js` 已将其 `variants` 改为空；该断言与本次入口改动无关，未修改。
- `woodland-style-import-electron.test.js` 通过真实 Electron 请求链与 ZIP 安装确认；原生系统对话框用 fixture 文件选择结果代替人工点击。
- playwright-interactive 隔离 Electron 检查默认窗口、取消后保留窗口、自动 CSS 导入、图片预览尺寸、网址识别。测试数据已清理，截图保留在仓库 tmp。
- `npm run verify:architecture` 26 项通过，相关源文件语法通过，Impeccable detector 无发现。交互式教程未描述旧按钮，无需改动。
- `npm run verify:docs` 9/10 通过；剩余失败来自同时存在的 `2026-10-08-woodland-style-package.md` 活动计划状态，不在本次修改范围。新增计划已按规范归档，相关 API 路由、文档链接检查通过。`git diff --check` 通过；本次没有生成文件或用户数据进入改动。
- 普通第三方 ZIP 仍需先解压；HTML/CSS 使用组件默认尺寸，未推测任意网页的作者设计尺寸。
