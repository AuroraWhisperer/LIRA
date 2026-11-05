# 沉笺客户端接入

**Status:** Completed

用户已要求接入客户端，并确认气泡密度 100 的最终量为现有成品预览的 3 倍，滑杆范围 1–100。

## Goal

将已完成的贝壳玻璃 v2 及已认可的下沉动效作为本地内置飘窗样式「沉笺」交付，支持客户端选择、参数保存、重启恢复和本地场景输出。保留原生中文、表情及安全消息 DOM。

## Non-goals 与兼容约束

不修改远端事件通道、认证、数据库格式、旧服务器 renderer 或其他样式行为；不提交、打包或发布。保留工作区已有修改和 output 原件。三张约 100 KB 的 WebP 由本地样式 CSS 消费并随客户端 public 资源交付，不增加启动下载。

## Current Behavior 与 Ownership

- `public/js/shared/danmaku-style-options.js` 拥有参数合同，经 `scripts/sync-danmaku-style-options.cjs` 生成本机 Node 镜像；`danmaku-parameter-controls.js` 生成桌面和画布控件。
- `danmaku-message-renderer.js` 分发安全消息装饰；`danmaku-feed.js` 分发 feed。既有 floating feed 只支持横向穿屏；随机 feed 没有持续下沉和轨迹占位，不能直接承载本款。
- 新 `danmaku-sinking.js` 组合贝母底片、正文和署名；新 `danmaku-sinking-feed.js` 负责路径占位、有限等待、下沉与气泡循环以及撤回/清空/销毁。复用既有随机落点计算与消息 renderer。
- `danmaku.js` 是预览和本地场景的共同装配入口；账号外观仍由 `src/server/danmaku-appearance.js` 与现有本地 store 保存。
- 文档 owner 为 `docs/reference/frontend/overlays.md`，用户入口说明为 `public/pages/admin/toolbox/usage-guide-toolbox-danmaku-gifts.html`。

## Proposed Changes

1. 在本地样式合同、布局、样式库及预览入口注册 `sinking`。沿用字体、字号和透明度；专属参数为色泽、停留时间、下沉行程、水流幅度、气泡密度。只展示适用于下沉的运动控件。
2. 引入已生成 v2 珍珠白、浅海绿、冰蓝 WebP 和来源记录。CSS 保留九宫格边缘和独立文字。额外事件以同款布局保留礼物/SC 内容和金额。
3. 把原型时序移入专属 feed；每条锁定行程、摆幅和到期时间。设置更新不重播已有消息；快照恢复不重播已过期消息；拥挤等待有界；移除、销毁和减少动态效果释放气泡和调度。
4. 密度 100 从 40 个/秒提高到 120 个/秒，并相应提高有限粒子池容量。低、中档保留原曲线，上半段平滑增量，避免中档直接过密。

## Milestones / Verification

- [x] 注册与材质：Node/浏览器镜像、参数范围、旧布局兼容及安全消息渲染通过聚焦用例。
- [x] 生命周期：实际到期/撤回、拥挤占位、快照、修改参数不重播及粒子数量上限通过；现有 floating feed 与本地预览回归通过。
- [x] 桌面和场景：隔离 Electron、真实 preload 和本地外观 store 验证选择/显式保存/重启恢复；完整场景运行时使用读取到的已保存外观播放合成事件，验证长文本、礼物、SC、普通与密集播放和密度 1/50/100。截图位于仓库 tmp，测试浏览器、Electron 和服务已关闭。
- [x] 同步技术参考和应用内指南；参数镜像、15 个文件语法、10 项文档检查及 `git diff --check` 通过，已核对本任务增量与原有工作区改动。

## 验收结果与限制

聚焦命令：`node --experimental-vm-modules --test test/danmaku/danmaku-sinking.test.js test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-layout.test.js test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-floating.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-entry-display.test.js test/overlays/component-style-effects.test.js`。90 项中首次 89 项通过；公共效果清理检查发现下沉 transform 始终保留变量引用，改为使用共享效果模型计算实际变换，随后重跑 sinking 与 component-style-effects 的 8 项全部通过。其余受影响用例沿用本次成功结果。未运行全仓套件。

实际画面发现通用 gift/SC 根类会套用旧卡片的 grid、宽度和 zoom；沉笺改用自己的消息类型标记，恢复原生安全文字、完整金额和正常排版。三色素材、入水和退场均通过播放观察；50 档每张 28 个槽位，100 档每张 390 个槽位。一次最大密度检查中，两张卡片共 780 个槽位、449 个可见气泡；18 条连续到达时已显示卡片无重叠或越界，到期后卡片和气泡均清空，页面异常为零。

`danmaku-canvas-editor.cjs` 用于桌面保存与恢复，其省略云事件 buffer，不能单独验证正式场景事件输出；因此复用已有 `canvas-output-fixture.js` 的完整场景运行时，将从桌面管理 API 读取的配置传入隔离 store，再从真实 `/scene` 路由播放合成事件。没有修改生产认证或测试夹具。测试会话到期通过隔离应用重启恢复；一次 REPL 超时后，按该测试实例的 DevToolsActivePort 恢复句柄并正常关闭 Electron。

截图：`tmp/sinking-client-2026-11-05/qa/mint-density-1.png`、`scene-blue-density-50.png`、`scene-density-100.png`。后两张为透明场景在检查用深色底上的实际输出。技术参考与使用指南已同步；交互引导只讲通用入口，不枚举本款参数，无需修改。未使用真实账号、进行 B 站或直播软件实播，也未提交、打包或发布。

测试进程、浏览器和服务均已正常关闭。删除已隔离的 `tmp/sinking-client-electron-R93PLJ` 目录时被自动审批拒绝，返回 `blocked by policy`，未给出具体原因；未换工具绕过，合成数据和测试配置目录保留，截图另已复制到上述 QA 路径。

## Rollback / Failure Handling

编辑前将相关文件副本保存在 `tmp/sinking-client-2026-11-05/before/`。问题通过本任务增量差异定位，只逆转本任务内容，不恢复整个工作区文件；不操作用户正在运行的客户端或真实账号数据。

## Done When

客户端可选择并保存沉笺，本地场景实际显示 v2 底片与原下沉动效；100 档达到旧预览三倍发射率，参数更新与生命周期检查通过，文档一致，本任务差异已复核。测试进程、浏览器和服务均已关闭；清理受限的临时目录按上方记录保留。
