# 星幕浮语随机弹幕实施计划

状态：Completed（2026-10-07）。两仓代码完成，未提交、未部署。

## 目标与边界

根据用户截图新增 `starveil`（星幕浮语）：外置居中昵称、深色半透明胶囊、细描边与同色文字柔光。每条消息从六组柔和配色中稳定随机取色，不按身份分色。沿用流光气泡的随机布局、防重叠、停留时间、表情与画布参数。背景烟花、人物及站台不属于弹幕组件；不提交或部署。

## 当前行为与所有权

`danmaku-feed.js` 已拥有随机布局和生命周期，`danmaku-message-renderer.js` 拥有安全内容渲染。新增配色只在渲染器的 starveil 分支赋予标记，造型由独立 CSS 拥有。Live 的 shared/danmaku-style-options、danmaku-layout 与 lira-server 的对应 browser/Node 契约同步；服务器 overlay-settings 和 app 需要接受新值。服务端 feed 与客户端存在不同职责，不整文件覆盖。两个仓库均存在其他任务的未提交变更，使用 tmp 内的任务前快照区分。

## 兼容约束

保留旧样式、身份语义、消息数据、SC 过滤和安全图片规则。旧布局缺少 starveil 时补齐当前画布区域，未知样式继续拒绝。复用原有设置键、认证与租户边界。OpenAPI 增量接受新值和区域，不提升协议版本、不修改数据库结构。

## 实施步骤

- [x] 展示契约、旧布局补齐及服务端设置/协议接受 starveil；验证参数校验和保存回读。
- [x] 添加六色胶囊 CSS、稳定配色标记、客户端样式入口与真实渲染缩略图；验证昵称位置、配色多样性、文字与表情完整性。
- [x] 浏览器验证正式消息路径、随机停留/切换、长内容和礼物；执行直接相关测试并更新契约说明。

## 验证

Live：`node --experimental-vm-modules --test test/danmaku/danmaku-starveil.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/frontend-admin-danmaku.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-overlay-fullscreen.test.js`。

Server：`node --require ./test/support/test-mode.cjs --test test/overlay-starveil.test.js test/overlay-protocol-contract.test.js test/overlay-layout.test.js test/overlay-settings-service.test.js`；`npx playwright test e2e/overlay-starveil.spec.js e2e/overlay-glow.spec.js --workers=2`。新样式以截图实检，本地预览和服务端共用 CSS；隔离桌面检查使用现有 fixture。

## 失败处理与完成条件

出现失败时定位本次引入问题，保留其他任务改动；只撤销本任务的局部修改，禁止整文件回退。视觉符合参考、两端配置与渲染一致、直接测试通过、规范与缩略图就绪，检查两仓任务 diff、`git diff --check` 和 `git status --short` 后完成。

## 完成证据

- 上述 Live 七个测试文件共 38 项通过。共享旧布局补齐、样式契约、预览、随机布局及入口均覆盖。
- Server 上述四个文件另加 `test/overlay-style-options.test.js`，共 24 项通过；包括新样式保存回读、同租户单次发布、非法参数原子拒绝和新增协议 fixture。
- `overlay-glow.spec.js` 两项通过；`overlay-starveil.spec.js` 两项通过。首次新增透明度断言误将透明黑与零 alpha 原色混为一谈，修正断言后通过；长文本圆角改为随字号固定，避免多行胶囊变成椭圆，再运行完整 starveil 文件，两项通过。
- 使用现有隔离 Electron fixture + 真实 preload/IPC 打开画布，选择 starveil，保存中心倾向 12、透明度 75，仅产生一次设置写入；重开仍保留，默认字体选择器显示宋体。
- 实际 `/danmaku?preview=1&style=starveil` 返回 200 且渲染新样式；六色缩略图使用真实 renderer 生成。截图视觉检查与 Impeccable 检测通过（空报告），相关 JavaScript 语法检查通过。
- 并行任务更改过样式数量断言；其更新后相关文件通过，本任务保留 whiteframe/starlight 的同时改动。两仓差异与状态检查未发现本任务生成数据或秘密进入源码；临时日志、截图、快照均在 tmp，测试进程关闭，隔离运行数据已清理。
- 无生产部署或真实 B 站直播验收；视频链接无法读取，视觉依据为用户截图。
