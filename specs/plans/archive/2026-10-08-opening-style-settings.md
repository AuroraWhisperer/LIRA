# 开播样式独立设置 Implementation Plan

**Status:** Completed（2026-10-08；本任务检查通过，工作区文档门禁的无关失败见下）

**Goal:** 经典舞台、像素卡带与导入开播样式共用选择入口，各自显示、保存和播放自己的参数。

**Architecture:** 保留经典舞台现有设置键；像素卡带新增对应质量、装饰和音乐键。开播配置返回清洗后的内置样式配置。资源包使用已有 config、样式库 config 写入与原生参数面板，画布快照独立消费参数。

**Tech Stack:** Electron、原生 ESM/CSS、Node.js、node:test、现有隔离 Electron fixture。

## Current behavior / ownership

`start-animation.js` 共用全局设置；`component-style-client.js` 在下拉框下追加导入卡片并直接打开画布；`opening.js` 将所有样式映射到同一份文案。样式包 owner 已支持 config 导入及保存，复用而不新增包内代码执行。字段合同归 `scene-extra-components.js`，服务端归 `opening-routes.js`、settings defaults/contract，媒体归 http-utils。

## Compatibility / non-goals

- 保留旧经典舞台设置、总开关、页面 URL、资源身份与场景快照；新字段向后兼容，未配置的像素设置使用自己的默认值。
- 不变更 ZIP 格式、不执行包内原生界面脚本、不改变 Electron 权限或部署；不提交。
- 工作区已有资源设置与礼物相关修改属于用户，保留并复用已有接口。本次聚焦开播样式，不重做其他功能页。

## Milestones / verification

- [x] 独立配置与播放：增加像素设置及音乐选择，媒体服务仅提供两款当前选中的文件；配置读写和固定样式画布回归测试。
- [x] 包参数：开播外观新增可选文案、质量和装饰参数；旧场景不强制写默认值；月渡花汀资源默认文案随包导入；实际渲染优先独立外观。
- [x] 界面：统一选择区与当前样式标题；经典舞台和卡带各自控件；导入包使用专属字段与保存/画布操作，无关的经典设置隐藏；切换保留草稿。
- [x] 验证已执行并记录：聚焦测试、Electron、语法、架构、布局扫描及 diff 检查通过；仓库文档检查有下述无关失败。

## Verification evidence

- `node --experimental-vm-modules --test test/overlays/opening-independent-settings.test.js test/overlays/frontend-opening-runtime.test.js test/overlays/opening-style.test.js test/overlays/opening-overlay.test.js test/overlays/opening-upload-api.test.js test/scenes/component-styles.test.js test/scenes/resource-style-settings.test.js`：53/53。随后补充媒体白名单用例，independent-settings 4/4。
- `node --experimental-vm-modules --test test/admin/canvas-opening.test.js`：1/1。
- `node --experimental-vm-modules --test --test-name-pattern='moonlit suite adds|canvas suite imports' test/admin/canvas-component-suites.test.js`：2/2。旧测试通过全局标题改变月渡花汀的预期已改为独立标题；开播库按新页面 owner 初始化。
- `node --test test/desktop/opening-styles-electron.test.js`：1/1；真实 preload/认证的隔离 Electron fixture，验证快速切换、各自控件、包内初值、失败保存重试、重开与画布携带参数；加载真实 select 增强器。截图位于根 tmp，测试目录与进程自行清理。
- `npm run check`、`npm run verify:architecture`（23/23）通过；Impeccable detect 返回 `[]`。
- `npm run verify:docs`：9/10；仅工作区另一份 `2026-10-08-resource-style-settings.md` 未声明状态，不修改他人正在进行的计划。最初宽一些的 scene-extra-components 检查还看到既有航海感谢字段断言与工作区未提交实现不一致；本任务不修复它。
- 未启动用户实例、修改真实数据、提交或发布；不声称覆盖真实直播软件实播。

## Failure handling / done when

保存失败保留草稿并提示重试；选择变化不得将旧样式草稿写给新样式。只修改本任务行，不使用破坏性回滚。上述三个样式配置不互相覆盖，导入默认值与画布实播一致，新增样式可进入相同入口，测试通过并记录限制后归档。
