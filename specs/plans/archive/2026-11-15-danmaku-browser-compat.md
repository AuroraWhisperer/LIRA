# 弹幕旧内核兼容与圣诞背景参数

Status: Completed

## 目标与边界

修复用户截图中圣诞绮笺底板、描金边框消失，以及星尘 2.0 星形装饰变白块的问题。圣诞增加「正常卡片／仅文字与挂饰」参数，默认正常卡片。核查其他内置弹幕的同类兼容差异并报告；本次不扩展为全部样式重做，不提交、打包、发布或修改用户数据。

## 现状与证据

同一合成消息与配置在 Chromium 106.0.5249.0 和 151.0.7922.34 对照：圣诞的 `color-mix()` 令旧内核背景变成 `none`、边框 stroke 变成 `none`，此时背景 opacity 仍为 1；星尘的无前缀 `mask` 在旧内核没有形成遮罩，三颗星显示为矩形。万圣节已有专门混色回退。检查记录、浏览器与截图位于 `tmp/danmaku-chrome-compat-2026-11-15/`，不读取正式账号。

## 归属与兼容约束

- 样式 owner：`public/css/overlays/danmaku/christmas.css`、`stardust.css`；圣诞颜色计算放在现有 `public/js/overlays/danmaku-christmas.js`。
- 参数 owner：`public/js/shared/danmaku-style-options.js`，运行 `scripts/sync-danmaku-style-options.cjs --write` 生成本地 Node 镜像。控件、校验、草稿和本机保存沿用现有通路；不增加服务器样式合同。
- 公共颜色计算复用万圣节现有预乘 alpha 混色算法，移到现有 `public/js/shared/color-value.js`，万圣节行为保持一致。
- 参数应用：`public/js/overlays/danmaku-style-application.js`；两种圣诞模式保持尺寸、文字、装饰与消息布局相同，仅隐藏底板、底纹和描金外框。
- 技术说明 owner：`docs/reference/frontend/overlays.md`；操作说明：`docs/guides/component-style-parameters.md`、`public/pages/admin/toolbox/usage-guide-toolbox-danmaku-gifts.html`。既有入口和交互导览不变。
- 保留已有用户改动，不改变 HTTP/WS/IPC、数据库结构、外观所有权与资源交付；旧配置缺少新字段时采用正常卡片。

## 实施与验证

- [x] 圣诞改用兼容的 RGB/RGBA 混色结果，恢复聊天、礼物、大航海、SC 底板；星尘补 `-webkit-mask`。同一旧内核故障消失，自定义半透明配色与背景透明度仍生效。
- [x] 添加 `christmasBackground` 参数，取值 `card` / `transparent`，默认 `card`；复用共享字段控件与保存。参数测试覆盖保存、恢复与旧配置默认值，Node 镜像检查通过。
- [x] 隔离 Electron 核对客户端选择、保存、重新打开与画布回存；Chromium 106 实际本机场景来源成功切换两种模式，并显示聊天、礼物、大航海与 SC。星尘星形恢复。47 款筛查中 24 款有绘制属性差异，另取八款确认可见缺失，记录在临时检查报告；不扩大为全部样式均已修复。
- [x] 同步技术与使用说明，完成定向 Node 测试和变更 JS 语法检查；文档门禁与最终差异检查见下方验证记录。

定向测试：`node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-appearance.test.js`。装饰遮罩通过实际新旧浏览器查看，不新增静态 CSS 清单或截图快照断言。

## 失败处理与完成条件

只回退本任务负责的具体差异；不 reset、覆盖其他改动或操作用户运行中的客户端。源码修复、参数保存与输出验证、文档同步和差异复核完成后结束。真实直播姬版本未知，使用旧 Chromium 复现作为兼容证据，不宣称在用户的直播姬上实机验收。

## 验证记录

74 项定向 Node 检查全部通过，Node 参数镜像及四个改动 JS 模块语法通过。自定义 `#12345680`、背景不透明度 35% 的新旧内核渐变计算结果一致，正文 opacity 保持 1；背景不透明度 0 仍保留边框，透明款则显式隐藏底板与外框。场景来源最终保留一条系统确认与四条合成事件，无重复条目。万圣节原有混色回退在旧内核的自定义色与 35% 不透明度下仍正常。

文档门禁首轮仅因本计划的状态标签格式失败，改用标准 `Status:` 并按完成状态归档。测试浏览器、Electron 和 HTTP 服务已关闭。截图、47 款原始计算样式及八款视觉对照保留在 `tmp/danmaku-chrome-compat-2026-11-15/`；真实账号、直播软件及安装包均未操作。保留其他工作中的非正文文字参数、礼物与点歌等改动。

归档后文档门禁为 9/10，唯一失败来自另一个正在修改的 `2026-11-15-danmaku-text-controls.md` 状态标签；本任务的链接、导航与参考检查通过，不修改该独立任务的计划。最终 Node 镜像、七个相关 JS 的语法与 `git diff --check` 通过，已检查工作区状态；运行时数据和检查图片均在 `tmp/`，未进入源码差异。
