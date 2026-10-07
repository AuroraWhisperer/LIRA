# 星语固定弹幕实施计划

状态：Completed（2026-10-07）

## 目标与边界

按用户提供的 BV1sBjvzwEsb 与截图新增 `starlight`（星语）固定弹幕。普通消息居中显示昵称、细横线与正文；礼物与 SC 使用左文右金额和四角星，透明白色主题，平滑纵向进入。保留真实昵称、表情、礼物数量/结算金额与 SC 完整原文。背景场景、直播人物、时钟不在本次范围。

## 现状与所有权

桌面 `public/js/overlays/danmaku-message-renderer.js` 与独立 SC renderer 负责 DOM，`danmaku-feed.js` 已拥有固定区域滚动。服务端 `public/overlay/` 为实际直播输出，具有相应 renderer/feed。样式表、画布默认值在各仓浏览器/Node 端分别维护；服务端 overlay-settings 与三份 OpenAPI 校验可选样式。

## 兼容性

仅扩展样式枚举与可选的默认画布区域，旧布局补齐新区域但不移动既有区域。沿用消息事件、认证、存储键、浏览器源地址与参数保存路径。无依赖、部署、提交或真实用户数据变更。两仓均有大量已有工作，以任务前文件快照区分并保留。

## 实施与验证

- [x] 新增所属主题 CSS，复用现有 DOM；仅为 SC 补左右分栏、两位小数，礼物补参考文案。复用 feed 滚动，星光只在装饰层做透明度/缩放；减少动态效果时停用。
- [x] 注册客户端选项、缩略图、画布与服务端枚举/契约；旧布局回归、纯文本/实际金额测试覆盖新样式。
- [x] 用独立合成输入检查三类消息、表情、长昵称/长 SC、两个滚动方向与减少动态效果；相关 Node 与浏览器测试通过；维护样式规范。

命令：桌面 `node --experimental-vm-modules --test test/danmaku/danmaku-starlight.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-style-ownership.test.js test/danmaku/danmaku-superchat-renderer.test.js test/danmaku/frontend-admin-danmaku.test.js test/danmaku/danmaku-local-preview.test.js`；服务端 `node --require ./test/support/test-mode.cjs --test test/overlay-starlight.test.js test/overlay-protocol-contract.test.js test/overlay-layout.test.js test/overlay-settings-service.test.js` 和受影响 overlay 浏览器文件。

## 完成条件与失败处理

两端样式可选、普通/礼物/SC 均可渲染，旧设置兼容且相关检查通过；检查任务差异、两仓 `git diff --check` 与状态。临时检查产物位于各仓 `tmp/`。失败只回退任务新增内容，不整体还原已有修改；未验证的发布与真实直播不宣称完成。

## 完成证据与限制

上述桌面七文件的 38 项与服务端四文件的 16 项检查均在聚焦运行/修正后复跑中通过。服务端 `npm run docs:check` 的 47 项通过。隔离端口 3291 运行 `npx playwright test e2e/overlay-starlight.spec.js e2e/overlay-superchat.spec.js --workers=1`，修正合成开播确认消息的测试计数后两文件均通过；未改动原有六款 SC 行为。未部署服务端、未运行真实直播或重启用户应用。

桌面独立浏览器实例直接加载现有 feed/CSS，核对三类消息、原图表情与字体/字号参数，未发生页面错误。结果为 `tmp/starlight/starlight-preview.png`，缩略图由该渲染生成；服务端长 SC 截图在 `tmp/browser-tests/starlight-20261007/artifacts/`。机械设计检查返回空问题列表。两端主题 CSS 相同，旧布局只补新区域。检查期间其他工作新增 `whiteframe`/`starveil`，已保留其源码并合并共同名单，未接管其实现。
