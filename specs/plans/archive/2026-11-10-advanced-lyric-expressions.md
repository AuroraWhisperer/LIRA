# 高级歌词编排与自然变化实施计划

Status: Completed

> Lifecycle: Archived after scoped implementation and verification on 2026-11-10. This record preserves design and acceptance evidence; current behavior is owned by the frontend overlay reference.

## Goal

在现有高级歌词基础上增加六种可辨识、适合透明直播叠加的完整编排，以及根据当前歌词自然变化的“随句编排”；保持中文可读性、真实词时序、当前句输出和既有设置保存流程。

## Current Behavior

现有五种完整编排主要负责词组位置、尺度和接力，其余选项为自由构图。所有歌词使用同一播放时钟，布局由 `advanced-lyric-layouts.js` 负责，暂停、跳转与轨道释放由 `advanced-lyric-motion.js` 负责。编辑器静态卡片与真实音乐大预览共用目录。

## Ownership And Compatibility

- 编排：`public/js/lyrics/advanced-lyric-choreography.js`、`advanced-lyric-layouts.js`。
- 句子特征和确定性选型：新增 `public/js/lyrics/advanced-lyric-variation.js`，消费现有 text units，不引入独立时钟或音频分析。
- 字面表现：新增 `public/js/lyrics/advanced-lyric-treatments.js`，通过 renderer 的现有 motion owner 注册有限轨道；样式在 `public/css/lyrics/advanced-lyric.css`。
- 编辑入口：共享 catalog、既有 `advanced-lyric-editor.js` 与其 CSS；桌面及画布编辑器共用。
- 契约与说明：`docs/reference/frontend/overlays.md`、`docs/guides/component-sources.md`、受影响的配置指南。
- 保留全部既有布局、手动轮换、设置字段与存储格式、当前句限制、暂停/seek/reduced-motion、真实音乐源预览及用户的未提交修改。不添加依赖、服务、下载或提交。
- 不扩展观众弹幕、不制作 MV 编辑器、不恢复示例试播、不改变服务器或 Electron 权限边界。

## Motion Design

六种风格分别为纸片展开、轮廓成字、残影收束、字块接力、弧光流转、星屑聚字。主体以清晰的正文落稳为焦点；交接留足阅读时间。重复歌词由正文与曲名的稳定种子保持身份，速度与时长调整动作幅度，快句/长句收敛；减弱动态时保留文字和填色。残影/星屑有明确节点上限，无持续粒子循环，隐藏未唱内容时装饰也在同一显隐层内。

## Milestones

- [x] 六种空间构图及其字面动效接入同一渲染器；`adaptive` 解析为实际完整编排。
- [x] 新编排、搭配和可区分的缩略图接入原编辑器与保存路径。
- [x] 聚焦行为检查：重复歌词稳定、长快句收敛、未唱字及装饰隐藏、尾音保留、暂停/跳转/隐藏恢复、轨道清理。
- [x] 在隔离浏览器播放实际 renderer，批量检查六类风格及长快句；用既有隔离 Electron fixture 检查编辑保存与画布输出。
- [x] 更新技术及用户说明，完成文档门禁和最终差异审查。

## Verification

```powershell
node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/advanced-lyric-browser.test.js
node --experimental-vm-modules --test --test-name-pattern="motion, advanced lyrics" test/desktop/shared-canvas-appearance-electron.test.js
npm run verify:docs
git diff --check
git status --short
```

变更脚本执行 `node --check`；不因 UI 扩展运行全仓业务测试。浏览器实播记录存入根目录 `tmp/`，不使用真实用户数据。实际 OBS/直播姬设备负载不由 Chromium 检查替代。

## Rollback Or Failure Handling

按本任务拥有的文件和局部差异逐项修复；不重置工作区，不覆盖并行工作。测试实例与资源由创建者关闭。

## Done When

六种样式及随句编排可选可保存，播放时具有真实差异且文字不丢失；既有时间/当前句/清理合同通过聚焦验证，编辑与本地输出连接通过隔离 Electron 验证，文档同步且差异已审查。

## Evidence

- 歌词单元与浏览器检查 24/24 通过；扩大既有文字副本显隐检查后定向复验 1/1 通过，覆盖轮廓和残影。
- 隔离 Electron 的 `motion, advanced lyrics` 用例 1/1 通过，证明画布选择纸片展开回填桌面、桌面选择随句编排回填画布，并保存进实际本地输出。
- 七个变更 JavaScript 模块语法检查通过。文档门禁 10/10；最终归档后再执行同一门禁。
- 隔离 Chromium 实际播放六款，检查快速密集句；确认无页面异常，密集句星屑为零。复用现有共享字体，纸片使用悠哉、轮廓/弧光使用思源宋体、残影/字块使用得意黑、星屑使用麦圆；末次字体和卡片检查通过。
- QA 截图位于根目录 `tmp/advanced-lyric-expressions/`；未操作用户运行中的应用或真实数据。未执行真实 OBS/直播姬长时实播、打包、提交或发布。
- 技术参考、组件来源指南与配置/画布指引同步；交互导览没有具体样式枚举，不需要修改。
