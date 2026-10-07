# 时钟与弹幕按样式调参 Implementation Plan

Status: Complete

完成时间：2026-10-07。实现与任务相关验收已完成；没有提交或部署。当前用户说明与参数表见 [外观效果指南](../../../docs/guides/component-style-parameters.md)。下述无关工作区检查失败保留为交付限制。

## Goal

为时钟、固定弹幕、区域随机弹幕、飘窗弹幕提供按具体样式适配的效果参数；每个独立组件记忆各样式设置，客户端预览、独立来源、场景输出和服务器弹幕一致。支持导入 CSS 的已知结构以及 HTML 的整体效果。接入独立于自动欢迎发送的进房消息显示。

## Current Behavior / Ownership

- 时钟的 9 个预设由 `public/js/overlays/clock.js`、`public/css/overlays/clock/` 拥有；设置由 `clock-settings.js`、`src/server/clock-contract.js` 和 settings-store 保存。
- 16 个弹幕预设由 `danmaku-style-options.js`、`danmaku-message-renderer.js`、feed/floating 和各样式 CSS 拥有。已有参数按 styleOptions 保存；新增效果不能重复叠加样式已有光影。
- 场景配置由 `src/server/scene-components.js` 归一化，预览客户端和 scene renderer 分别拥有内部组件与隔离网页。完整 HTML 不提供语义化内部访问。
- 服务端 `D:/Work/lira-server/src/modules/streamer/overlay-settings.js` 保存弹幕设置；room-monitor 解析进房，当前仅用于 welcome-service；公开和设备展示事件需同步新增显示事件。
- 两个工作区有大量先存改动；不提交、发布、清理或覆盖这些改动。

## Design / Compatibility

- 新增可选 `styleParameters` 对象，按内置样式名或导入资源 ID 保存。旧配置缺失时不改变现有效果；每组缺失表示沿用原样式。调整组显式启用后允许强度为 0，以关闭原有效果。
- 共享纯参数合同定义数值范围、默认编辑值和能力描述；每款样式声明文字/面板/整体目标。四分类仅决定运动、消息相关选项，不代替具体样式适配。
- 文字、底板、整体各有明确目标；保留头像、装饰、SC 和原动画。旋转与倾斜与移动/翻页分开组合，预览和输出一致。
- 整体颜色通过 SVG 颜色矩阵与通道映射实现白平衡和色阶；Bloom 与边缘外发光有不同算法。保持透明度。关闭/恢复不残留滤镜、节点、observer。
- HTML 和未知网页只提供原生 CSS 整体外投影、外发光、矩形边框和变换；Chromium 实测不支持通过父节点 SVG 引用滤镜给隔离网页调色，隐藏白平衡、Bloom、色阶及内部文字/阴影控件。已识别 CSS 结构可提供文字与卡片效果。保留 sandbox、安全来源和资源装载边界。
- 进房事件只携带公开展示字段，绑定已认证租户和当前直播场次，不持久化/重放，不发送 B 站消息。每款弹幕可独立隐藏，默认隐藏，避免旧画面变化。
- 不新增依赖、框架、进程或数据库表；沿用既有 JSON 设置和场景保存通道。

## Milestones

- [x] 1. 参数合同、逐样式能力表及保存：新增共享模块；接入时钟/弹幕/浏览器配置、服务端设置及必要文档 schema；测试非法数值、旧配置、切换记忆、独立实例和镜像一致性。
- [x] 2. 渲染：实现文字/底板光影、轮廓、白平衡、色阶、Bloom、旋转/倾斜；逐款适配，复用原渲染器；测试默认不变、更新/恢复、动态消息、动画和裁切。
- [x] 3. 设置面板：复用既有参数控件，按能力显示基础/高级组；支持当前样式恢复，导入 CSS/HTML 区分能力；Electron 验证实时预览、保存、切换和重开。
- [x] 4. 进房事件：服务器生产与公开/设备投影、本地与远端消费、预览样例及按样式开关；测试租户/场次/去重和欢迎发送独立。
- [x] 5. 完整验收：相关浏览器/Electron、合同、架构检查；更新用户指南和实现合同；审阅任务增量及两个工作区 diff/status，完成后归档计划。

## Verification

- `node --test test/scenes/component-style-parameters.test.js`：参数边界与隔离。
- 直接受影响的 clock、danmaku、scene/component-preview Node 测试，以及服务器 overlay-settings、room-monitor-overlay、overlay-public-sse、设备投影测试。
- 复用现有 Playwright/Electron fixtures，所有临时数据放入各仓库 `tmp/`，不操作运行中的用户程序。验证代表性结构并覆盖所有预设的效果目标存在性；旋转/倾斜/色阶/Bloom 需真实 Chromium 渲染证据。
- 两仓库相关文档/协议检查、Live `verify:architecture` / `verify:modularity`，新增 wire contract 的 schema 测试。锁定服务器历史契约检查与当前开发协议分别报告，不修改锁文件伪造版本证据。
- 两仓库 `git diff --check` 与 `git status --short`；仅审阅本任务增量，排除临时和敏感数据。

## Done When / Failure Handling

全部五项完成且验证支持：每款显示正确参数、单实例/单样式独立保存、导入兼容边界明确、旧外观默认不变、预览输出一致、进房开关真实有效。不能用合同测试代替 UI/效果验证。失败时保留计划与工作，按任务增量修复；不进行整文件还原、reset 或清理已有改动。

## Progress

- 2026-10-07：逐款结构复核完成，用户授权依次实施。开始参数合同和保存链路。


## 完成证据与限制

- 合同、持久化、逐款渲染、独立设置面板、进房生产/消费以及两端协议已完成。未配置组保持原样；单款恢复不影响其他款式。内置与已识别 CSS 可用高级调色，HTML 使用上述已实测子集。
- Live 参数/存储/预览 relay 合同 6/6；本地预览补齐真实 window 语义后以 `--experimental-vm-modules` 运行 10/10。参数四份镜像的数据定义已比对一致。
- Live Chromium 效果测试 4/4：9 款时钟、16 款弹幕的适用目标、动画组合和恢复；沙箱内部白平衡/色阶/Bloom 的像素变化与透明区域；HTML 外投影/边框/变换；BLC/blivechat 初始及动态消息。隔离 Electron 保存、发布到合成场景、重开、切换独立记忆与单款恢复 1/1。
- 手动检查效果面板及高级调色，验证越界数字、倒置色阶提示和纯文字能力隐藏；截图在 `tmp/style-parameters/effects-panel.jpg` 和 `effects-advanced.jpg`。已关闭任务创建的浏览器、Electron 和临时服务器；没有控制用户运行的实例。
- Server 相关协议/持久化/进房/直播边界测试初轮 39/39；合并档案上限修复后持久化复验 1/1；页面逻辑/静态资源 18/18；公开页面完整浏览器文件 `e2e/overlay-preview.spec.js` 13/13；文档和协议检查 47/47。后续增加当前样式进房开关回归后，页面逻辑复验 16/16。
- Live 初轮关联测试 108/120：其中 10 项为命令缺少 VM flag，已按上文修复 fixture 后复验通过；另 2 项当时缺月渡花汀字体。素材随后由其他工作补齐，套装复验目前 10/11，剩余为字号默认值 30 与测试预期 22 的现有差异，本任务不修改套装默认值。
- 现有预览传输 A03 测试构造的 32 份完整字体配置为 360902 字节，超过既有 262144 字节安全上限；不含任何 styleParameters，15 款时也超限（340774）。该测试在 relay 之前的场景归一化失败，本任务不扩大安全上限。
- Live JS 静态检查通过（1333 文件）；modularity 仅 6 项已有文件尺寸提示。架构检查 18/19，失败为无关 `gift-wishes-canvas-data.js` 的空 catch；文档检查归档后复验仍为 9/10，失败为无关 woodland 计划状态。没有为本任务改写这些工作。
- 最终核对两个仓库任务增量、`git diff --check` 和状态；临时证据均在根目录 tmp，保留所有原有/并行改动。服务端源码已同步，但真实服务端尚未部署；未进行 OBS / 哔哩哔哩直播姬实际推流验收。
