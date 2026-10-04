# 开播动画画布接入

**Status:** Completed

## 目标与边界

把开播动画内嵌预览移入现有场景画布，支持首次添加、再次选中、缩放、保存及组合输出。配置、媒体上传和总开关仍归开播设置页；不新增设置键、路由、权限或存储结构，不改变独立 `/opening` 地址。

## 当前实现与所有权

`start-animation.js` 管理自动保存及内嵌 iframe。场景组件声明归 `scene-extra-components.js`，画布控制器和既有 component-preview 消息负责配置及显示数据。正式数据归 `scene-extra-display.js`，复用 opening 路由的配置读取和公开投影。动画仍由 `overlays/opening.js` 渲染。

## 实施与验证

- [x] 添加 opening 场景组件；空外观配置表示跟随开播配置，画布只保存位置和尺寸。复用现有组件通信，组件模式不独立请求 API，断开或销毁时停止媒体。
- [x] 原预览改为画布按钮；画布从客户端读取最新开播配置，保留加载失败禁止编辑及串行自动保存。
- [x] 更新相关运行时测试，并用现有隔离画布 fixture 验证入口、显示、配置变化、再次打开、保存和正式输出；补齐组件选择器缩略图及说明。
- [x] 运行开播、场景、预览相关测试及受影响边界检查；检查增量 diff、空白及状态。保留所有既有工作区改动。

## 风险与回退

新增类型沿用场景 schema；旧客户端不认识该类型，不能将包含它的场景交给旧版本编辑。设置仍仅由原 owner 保存；预览不复制媒体文件或管理凭据。回退只撤销本次增量，保留用户其他修改。

## 完成条件

隔离测试证明动画跟随配置、总开关和媒体，并能作为场景图层发布；相关检查通过或如实记录限制。

## 验证结果

2026-10-04：`canvas-opening`、`canvas-gift-components`、`frontend-opening-runtime`、`opening-overlay`、`opening-style`、`scene-extra-components`、`scene-runtime`、`component-preview` 通过。模块边界、ESM 边界、模块大小、文档治理与测试分组检查通过。设计检测结果为空。

现有隔离 HTTP/SQLite/Chromium fixture 验证真实画布通信与组合输出，并检查子 frame 没有 API 请求或管理 token；VM 用例保护父窗口校验、媒体更新、断线暂停及销毁。已查看画布与动画截图。未启动用户 Electron、OBS 或直播姬，未进行真实音频设备试听。
