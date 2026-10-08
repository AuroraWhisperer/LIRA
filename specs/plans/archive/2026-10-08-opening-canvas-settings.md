# 开播动画画布参数实施计划

Status: Completed

## Goal

画布内置开播样式可编辑与客户端相同的效果、文案、人物/头像、音乐和音量。用户已确认同一样式共用设置，所有像素卡带同步；导入样式维持各组件自己的外观。

## Current Behavior And Ownership

`scene-extra-preview.js` 隐藏内置外观字段；`start-animation.js` 拥有客户端表单，`opening-routes.js` 拥有媒体读取/上传，设置由既有 settings store 持有。画布只有短期 capability，不能调用管理设置接口。现有 `authorizeCanvasMedia` 已保护画布素材接口，沿用其账号、attachment、撤销检查。

合同：`docs/reference/backend/api.md` 开播域；`docs/reference/frontend/overlays.md` 开播组件。消费者是客户端开播表单、画布 iframe 与正式开播输出。

## Boundaries And Compatibility

- 不改变数据库、设置键、场景持久化格式、已有开播 URL、总开关或各层位置尺寸。
- 不把 admin token 提供给画布。新增受限画布开播接口，只允许经典舞台/像素卡带的既有字段和媒体操作，拒绝通用设置与样式总开关写入。
- 上传复用既有格式、容量、存储及播放代码，在异步读取完成后再次验证画布连接。
- 保留工作区其他修改，不提交、不发布；临时数据与截图放 `tmp/`。

## Milestones

- [x] 受限开播接口和前端请求适配：配置按样式白名单转换为既有 settings patch；媒体复用现有 handler。合法请求、错误字段/样式、错误 capability/Origin、撤销中的上传测试通过。
- [x] 画布显示当前内置样式适用字段、图片上传/清除、音乐上传/清除与音量；保存即时同步。客户端重新获得焦点时读取外部更新，保留未完成编辑。像素头像出现和移动、经典/像素隔离、上传失败后继续编辑验证通过。
- [x] 隔离 Electron 验证与合同更新，检查最终 diff，归档计划。

## Verification

运行开播接口新测试与 `test/overlays/opening-independent-settings.test.js`、`test/admin/canvas-opening.test.js`、`test/desktop/opening-styles-electron.test.js`；扩展现有隔离 Electron fixture 验证真正画布上传。权限变化另跑预览会话和 API 权限相关测试、`npm run verify:architecture`、`npm run verify:docs`、`npm run check`。不涉及远端服务合同，不跑无关全套。

## Failure Handling And Done When

读取失败禁用编辑并可重试；操作失败显示原因且不假报成功。完成需要对应参数可见、同步到同一样式的预览和客户端、权限回归通过、合同一致、diff/status 已检查。回退只能移除本任务差异，不覆盖原有工作区内容。

## Verification Results

- `node --test test/overlays/opening-canvas-settings.test.js test/overlays/opening-independent-settings.test.js`：7 项通过。
- 开播 renderer/editor 与样式回归 18 项通过；新增 focus 同步竞态测试单独通过，覆盖读取期间输入保留与再次保存旧客户端值。
- 预览会话、续期、文本媒体、远端 controller、开播权限/上传回归：44 项通过。
- 既有画布开播预览/正式输出测试通过；开播样式隔离 Electron 原用例通过，新用例在修正测试启动等待后通过。新用例使用真正桌面会话打开外部画布，覆盖两份卡带同步、头像实际 drawImage 与位移、媒体上传清除、音量、失败恢复和客户端焦点同步。截图：`tmp/opening-canvas-avatar.png`。
- `test/desktop/danmaku-canvas-electron.test.js`：2 项通过，确认共用 fixture 及画布受限会话仍可正常保存、发布。
- `npm run check`、`npm run verify:architecture`、`npm run verify:docs` 通过。初轮架构检查的新增空 catch 和计划缺 Status 已修复；未运行无关全套或远端合同检查。
- UI detector 未报告问题；测试进程及隔离数据已由 fixture 清理，用户运行中的应用和数据未修改。
