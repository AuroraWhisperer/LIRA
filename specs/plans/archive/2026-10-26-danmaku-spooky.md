# 幽灵便笺客户端接入

Status: Completed

## Goal

将已确认的 Spooky Notes 原型加入客户端固定弹幕样式，保留鬼魂、骷髅、蝙蝠、双层纸片及 Chat Box，提供四套配色与外框开关。中文消息、真实头像、表情、礼物、上舰和 SC 接入既有消息链路。

## Current behavior and ownership

原型在 `tmp/spooky-notes-bilibili/`，未注册到客户端；长 SC 沿头像右侧排版会裁掉头部。正式渲染扩展点是 `danmaku-message-renderer.js`，公共队列由 `danmaku-feed.js` 维护；固定动效契约见 `docs/reference/frontend/danmaku-motion.md`。注册、配置验证由浏览器和 Node 两份 `danmaku-style-options.js`、`danmaku-layout.js` 及 `component-style-parameters.js` 镜像维护。

## Compatibility and non-goals

- 仅追加 `spooky` 样式、`spookyTheme` 与 `spookyFrame` 选项；旧设置缺少新区块时回填默认布局，不迁移旧数据。
- 复用公共 feed，公共渲染核心及来源哈希保持不变；不复制原型列表控制器。
- 保留所有已有未提交修改，不提交、发布、构建安装包或改写用户运行数据。
- 不修改远程服务器仓库，不重新设计客户端预览工具，也不自动开启进入消息。

## Proposed changes

- 新增专属渲染装饰模块、样式和本地 SVG/字体素材；SC 头部与正文分开，正文通栏。
- 现有客户端样式选择、画布预览和参数区追加入口；装饰性外框位于现有页面模板，隐藏外框时消息空间释放。
- 配色/外框默认值与验证、布局默认区和效果能力使用原有镜像契约。
- 更新对应测试、样式/动效参考及用户参数说明。

## Milestones and verification

1. 注册与配置 → `danmaku-style-options`、`danmaku-layout`、参数与页面测试证明两份契约一致、旧布局兼容。
2. 渲染与动效 → 消息渲染、样式归属和公共动效测试；核对真实头像、表情、当前房间身份、礼物与长 SC。
3. 客户端验证 → 用隔离 Electron 加载客户端页面与真实 overlay 入口，核对选择、配色/外框、保存和重新加载；验证常速、密集、双方向、缩放和减少动态效果。
4. 收尾 → `npm run verify:docs`，相关语法检查，任务基线对照、`git diff --check` 和状态检查。

具体命令、截图和结果随实施记录在本计划或 `tmp/spooky-client-integration/`。

## Rollback

按 `tmp/spooky-client-integration/baseline/` 对照移除本任务新增块与文件，保留用户先前修改；不使用 reset 或整体 checkout。测试实例与临时服务只清理本任务创建的句柄。

## Done when

- 客户端固定样式列表能选择幽灵便笺，预览、画布与组件输出使用同一渲染。
- 四套配色和外框开关可保存、恢复默认及重新加载，旧配置仍有效。
- SC 头部不被长文顶出、表情和头像安全显示，原作美术及分层入场保留。
- 聚焦检查和客户端运行验证完成，文档同步、任务变更范围复核。

## Verification results

- 139 项相关测试通过：样式选项、旧布局回填、消息渲染、样式归属、本地预览、客户端页面、公共动效、外观效果与参数镜像。最终事件字重、SC 末行与贴纸间距补充断言后，该专属浏览器用例再次通过。
- 文档门禁 10 项通过；相关 JS / Node 文件语法检查通过。
- 隔离 Electron 使用实际 admin HTML、preload、请求授权和 IPC，在合成账户中验证样式选择、配色/外框应用、重新加载、恢复默认。实际客户端画布验证两个字段的即时预览、保存及输出同步；无页面异常。
- 正式渲染路径验证四套配色切换保留节点、外框隐藏、165 字 SC 头部完整、每秒约 11 条连续追加 20 条后仅余 4 条且 live 标记归零；正文 transform 为 none，减少动态效果后动画数为 0。备用头像随配色更换背景，真实头像不加滤镜。
- 缩略图从正式渲染器生成。证据在 tmp/spooky-client-integration/，包含 runtime-verification.json、截图及测试日志。
- 生产公共渲染核心未修改，来源哈希保持 edeafac2020a3abb3ac44a18007a31e97e87643682af4ce36b2a8b8dc76dbe5e。
- README 和导览仍使用通用入口，未涉及操作变化；参数指南、客户端内指南及技术参考已同步。
- 未提交、打包、发布或部署远程服务器；未使用真实用户数据或直播间。真实上游、远程版本与 OBS/直播姬实播不在本次客户端接入的验证范围。
