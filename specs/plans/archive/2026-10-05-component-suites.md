# 画布组件套装

Status: Completed

## 目标与边界

添加组件分类栏增加“套装”，展示月渡花汀封面与数量，进入后分别添加开播动画、时钟、弹幕、礼物许愿。复用现有图层与样式添加逻辑，不批量添加或改变全局配置。

## 现状与归属

`admin/component-preview-picker.js` 拥有选择器，`component-preview-definitions.js` 适配各组件样式。时钟、弹幕、许愿已经支持独立样式；开播图层当前保存空配置，`overlays/opening.js` 只消费客户端投影的数据。

套装清单由新的 `admin/component-preview-suites.js` 显式关联组件和样式，不匹配显示名称。共享 `scene-extra-components.js` 声明可选开播样式，既有 `server/scene-extra-config.js` 负责枚举校验；开播 renderer 将独立样式与实时数据组合。

## 兼容性

原开播空配置读取为 `style: original`，继续跟随客户端。指定样式仅覆盖图层外观；文案、媒体、启用开关和断线行为保持原 owner。场景结构版本、HTTP/IPC/WS、权限、数据库结构不变。保留全部先前工作区修改。

## 实施与验收

- [x] 添加清单、复用预览卡片、套装列表及返回操作；四项预览可加载，每次点击只添加一个独立图层。
- [x] 扩展开播样式枚举与 renderer；验证空配置兼容、非法值拒绝、编辑和发布后均保留月渡花汀。
- [x] 使用已有内存场景 fixture 验证切换分类、返回、重新打开及保存；检查套装入口和成员页截图，补真实开播缩略图。
- [x] 同步场景规格、overlay 参考和测试注册；完成变更审阅后归档。

## 验证命令

`node --test test/scenes/scene-extra-components.test.js test/scenes/scene-component-contract.test.js`

`node --test test/admin/canvas-component-suites.test.js test/admin/canvas-opening.test.js test/admin/canvas-text-box-picker.test.js test/admin/canvas-browser-source.test.js`

按实际修改运行 JavaScript 语法、文档和模块边界检查。浏览器测试使用现有隔离 fixture 和内存数据库，不读取用户数据。

## 失败处理与完成条件

基线保存在 `tmp/component-suites-baseline/`，必要时逐段撤回本任务修改，不重置工作区。四项添加和发布、旧开播行为、界面截图、相关检查全部有证据后完成；记录真实限制。

## 完成证据

- 场景参数和组件契约 9 项测试通过；开播 source、设置及动画相关 12 项测试通过。
- 套装、开播、文本框、浏览器源、原组件库 5 项浏览器集成测试通过。原组件库清单补齐工作区已有月渡花汀样式，预览图片计数由 37 更新为 40。
- 前端标识符与模块边界 13 项、文档治理 10 项测试通过；7 个受影响 JavaScript 文件语法通过；UI detector 无发现。
- 使用既有内存 fixture 检查 1440×960 浏览器画布，1040×680 弹窗及四张成员卡片完整可见；截图在 `tmp/component-suites-list.png`、`tmp/component-suites-members.png`。预览封面由同一开播 renderer 截图缩小生成。
- 场景编辑器为既有浏览器页面，本轮未启动用户 Electron 或接入真实直播间；测试上下文和内存 fixture 已关闭。
