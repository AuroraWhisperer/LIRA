# Neon Glass 横向弹幕与公共侧倾

状态：Completed。

## 目标与依据

将用户选中的 [Neon Glass 原作者演示](https://www.etsy.com/listing/1576998013/animated-neon-glass-chat-widget)作为第四类「横向滚动」第二款内置样式。保留原作的通透胶囊、银紫高光、彩色昵称、白色提醒图标和轻柔分层入场；按用户指定改为横向消息流。聊天、表情、礼物、大航海、SC 与公共侧倾在本机预览、保存和场景中一致。

## 当前实现与归属

- `shared/danmaku-style-options.js` 拥有样式目录、参数范围，脚本生成 `src/shared/` 的 Node 镜像。
- `shared/danmaku-layout.js` 拥有缺失区域默认值；已有横向 feed、画布缩放与预览入口直接复用。
- `overlays/danmaku-message-renderer.js` 组合安全内容；新适配器只拥有 Neon Glass 构图，无私有队列或订阅。
- `component-style-parameters.js`、`component-style-parameter-view.js` 和 `component-effect-filters.js` 已有公共旋转；当前工作树另有公共侧倾预设及 400–4000px 透视距离改动，复用并验证，不重复实现。
- 并发任务正在增加 Astral、Horizontal Charm 等样式。保留其改动；Neon Glass 在第四类排序第二，其他新款顺延。

## 兼容与范围

仅扩展客户端内置样式及可选显示参数，旧布局补缺、不移动已有区域。默认正面，不改变其他款默认外观。保留认证、IPC、事件订阅和本地账号存储边界；不改远程服务器实现、安装器，不提交或发布。参考视频只用于观察，不打包作者背景、人物或代码。

## 实施与验证

- [x] 注册 `neon-glass`、默认底部横条、客户端及预览卡片。旧布局缺少本款时补默认，目录第二位置由实际 Electron 样式库核对。
- [x] 新增独立 CSS 与构图适配器。复用安全文字／表情渲染，保留当前房间身份、已结算金额、开通／续费及完整 SC；不加载不显示的头像／礼物图片。
- [x] 接入已有公共侧倾。全样式效果检查覆盖变换／恢复，隔离客户端核对侧倾预设与透视距离保存，入场和公共 feed 移动均保留变换。
- [x] 聚焦检查：`node --test test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-appearance.test.js test/scenes/component-style-parameters.test.js`；浏览器检查新款真实文字／表情／事件、长文、减少动态效果、连续到达与撤回，已有 effects/typography 用例自动纳入本款，排版合跑限制及本款独立测量见下。
- [x] 使用 `test/fixtures/danmaku-canvas-editor.cjs` 的隔离目录验证选择、保存、重开和本机场景输出；合成事件不接触真实用户数据。截图、视频与日志均在 `tmp/neon-glass-20261108/`。
- [x] 同步 owning reference、外观指南、受影响的内置指南；执行 `npm run verify:docs`、一次 UI detector、最后 diff／`git diff --check`／status。文档门禁的其他任务限制见验证记录；新增缩略图由实际客户端绘制结果生成。

## QA 清单

1. 原片对照：胶囊轮廓、方向性高光、白字与昵称色；横向排列为用户明确要求的适配。
2. 新消息分层出现，已显示消息调整外观不重播；减少动态效果直接显示完整文字。
3. 长昵称／40 字长句／连续表情不丢内容，连续消息的视觉边界不重叠。
4. 礼物零金额与未知金额区分；SC 原文与金额完整、撤回只删除目标条。
5. 公共透视在本款及已有固定／随机／飘窗／横向样式生效；恢复后无残留。
6. 桌面保存、重开和实际本机场景显示同一参数；无重复请求、计时器或监听。

## 失败处理与完成条件

对照 `tmp/neon-glass-20261108/before/` 和当前 diff，仅反向处理本任务拥有的变更，保留并发内容；失败先用聚焦用例诊断，不反复运行全套。只有全部明确需求有源码、测试和实际输出证据，文档一致且清理自己的运行资源后，才归档并标记完成。

## 验证记录（2026-11-08）

- 五份直接相关 Node 套件 84/84 通过。最初并行目录的缺失预期已由对应工作补齐，最终日志为 `contracts-tests-final.log`；本款新增安全内容／已结算事件与本机保存重开覆盖。
- `danmaku-neon-glass-browser.test.js` 通过，覆盖公共透视贯穿分层入场、修改外观复用原消息、完整长 SC、撤回、减少动态效果。全样式效果套件通过；合跑 12 项中 11 项通过，唯一失败在并行 Astral 字号断言（`rendering-tests-final.log`），未为此更改其他款。
- 本款独立测得正文 16／40px、Georgia、1／0.75 画布缩放下聊天／礼物／SC 共 12 组实际 1em 宽度全部符合设置，见 `typography.json`。行内及大表情均本机解码、完整留在卡片内，见 `emotes.json`。24 条、间隔 45ms 追加，13 次运动中采样无重叠、无额外文字缩放；最终五条保留且入场标记清理，见 `dense-playback.json`。
- 实际 Electron 最后重载确认顺序为天穹横栏、Neon Glass、Charm；保存／重载后 Neon 与左侧倾 Y −18°、Z 2°、透视 1600px 保留。画布五项专属控件切换生效并恢复默认；保存并应用发布真实本机场景 1920×1080、底部图层 1920×144。合成聊天、普通礼物、续费舰长及 SC 均显示实际文案／金额和相同侧倾，SC 撤回只移除目标，其他四条保留。
- `flat.png` 为本款实际绘制；`scene-output.png`／`scene-strip.png` 为已发布场景完整截图／底部裁图，均仅在验证时加上背景便于看透明材质。运行组件保持透明。正式 `neon-glass.png` 缩略图也来自本款绘制，无作者图片。
- 语法及生成镜像校验通过；一次 detector 返回 `[]`。独立视觉复核 `ship`，无需要修正的实质问题。技术参考、动效职责、外观指南与内置指南已同步，交互导览入口不变。文档门禁首次 9/10，唯一失败来自其他进行中 Glowy 计划状态，未改动其计划；收尾重跑最终 10/10 通过，见 `docs-tests-final.log`。
- 独立文档复核发现共享贴底分支缺少 Neon、Charm 指南仍称第二项，均已修正。前端／Node 新建区域及 Electron 重载后新导入模块得到 `{x:0,y:936,width:1920,height:144}`，布局套件最后 7/7（含两端镜像）通过；文档复核最终为 synchronized。发布场景原本就是该尺寸及位置，截图构图未变。
- 已结合开始前快照复核本任务差异，`git diff --check` 通过。自有 Chromium、Electron 与预览 HTTP 服务均已关闭，隔离合成账号目录在校验路径后清理，研究与 QA 证据保留于 `tmp/`。
- 未进行真实 B 站实播或 OBS／哔哩哔哩直播姬端到端实播，不声明原字体或逐像素一致；未提交、打包或发布。保留合成证据及并行工作。
