# 画布与客户端共享显示参数

Status: Completed

## Goal

同一组件样式的公共显示参数在客户端、画布参数面板、所有同样式实例及已发布直播源中一致。用户确认首次以客户端已保存参数为准；已有画布布局保留。

## Non-goals

不共享场景位置、尺寸、层级、锁定、名称和预览输入，不把礼物目标/进度、每条许愿内容、游戏会话或账号配置变成外观参数。不创建服务、依赖或前端构建步骤，不修改另一服务器仓库。

## Current Behavior

- 时钟、队列、弹幕、加班钟已有客户端控制器及预览中继，但独立画布实例使用参数快照。
- 开播内置样式已共享设置/人物图片/音乐；客户端仍依赖聚焦重新读取。
- 导入资源样式在客户端修改样式库默认值，已有实例保留旧副本。
- 展示板、歌词、投票评分、礼物滚动和大航海感谢具有相同含义的客户端参数；画布使用默认值或独立参数。歌词、展示板字段不齐。
- 发布冻结外观；场景版本不变时只推送业务数据，无法跟随保存后的共享参数。

## Ownership

现有 settings/domain owners 和导入样式库继续拥有参数。共享映射只投影/写入明确白名单字段，客户端没有对应项的画布配置继续属于场景。弹幕仍使用已授权桌面控制器及远程设置接口，不能经本地通用 settings 接口写入。画布通过已有受限会话访问外观 API；不获得 admin token/IPC。

| 类型 | 共享来源 |
| --- | --- |
| 时钟 / 队列 / 弹幕 / 加班钟 | 现有默认组件控制器；样式身份及实例布局单独保存 |
| 开播动画 | 已有按样式设置和媒体接口 |
| 导入资源样式 | 样式库中同一 style id 的 config |
| 展示板 / 桌面歌词 / 投票评分 | 现有对应 settings 字段，补齐缺失显示字段 |
| 礼物滚动 | 现有 gift display settings 校验与持久化 |
| 大航海感谢 | 对应样式的文字模式；资源样式仍由样式库拥有 |
| 盲盒榜 | 对应显示设置；原仅存在 URL 的选项需明确持久化 |

## Compatibility Constraints

保留既有设置键、样式资源身份/地址和场景文档格式；既有文档的公共参数在读取/渲染时投影为客户端值，不批量重写用户场景。独立组件继续支持不同样式及尺寸。公共外观更新不发布未保存布局。资源移除后保留最后保存的公共参数及资源可用性，重新导入前拒绝修改已移除样式。账号/会话撤销、Origin 校验及异步后再次授权保持有效。

## Proposed Changes

1. 建立明确的公共字段投影和受限写入入口，复用现有校验/存储。导入资源样式跟随同一 id 的参数。
   时钟原先只有一份通用字段，增加经过白名单校验的 `clockStyleOptions` 设置，按内置样式保留外观；首次按已保存客户端字段初始化，旧设置写入兼容更新当前样式。盲盒榜原 URL 显示选项改为持久化公共参数，新复制地址跟随设置，旧显式 URL 参数保持兼容。
2. 画布实例控制器对公共参数使用已有控制器或外观入口，其他字段仍写场景；所有实例与参数面板使用相同投影。
3. 补齐同义字段并让客户端表单订阅已保存设置，保留尚未保存的用户编辑，避免回环保存。
4. 场景输出增加按已发布 item id 的公共外观投影；渲染器原地更新配置，布局发布版本保持原语义。
5. 更新 ADR-0022 的外观快照决策及 API/前端/场景说明。

## Milestones / Verification

- [x] 共享来源与白名单：新增定向单元/HTTP测试，覆盖客户端优先、样式隔离、拒绝业务字段、撤销会话、导入资源不变。
- [x] 编辑器/客户端同步：控制器与已有组件测试，覆盖双向更新、多实例、草稿保留和失败反馈；补齐字段。
- [x] 已发布输出同步：场景 service/renderer 测试，验证不依赖重新发布、不带入未发布布局、不重复播放事件。
- [x] 隔离 Electron 端到端验证代表性内置和导入样式，使用现有 fixture，不操作用户运行实例/数据。
- [x] `npm run check`、架构/文档门禁，最终 scoped diff、`git diff --check`、`git status --short`。

## Failure Handling / Rollback

共享设置保存失败保留草稿并明确反馈；读取失败不覆盖已确认值。先验证整个 patch，再写入一个现有 owner；不承诺跨多个 owner 原子保存。输出更新只投影已保存参数。任务结束前检查实际 diff，仅反向恢复本任务的改动，不清除已有脏工作区。

## Done When

上述公共字段双向同步、同样式实例一致、重开及已发布输出跟随客户端保存值；布局/业务边界与权限保持；定向及必要门禁通过，文档与 diff 已复核。具体命令和结果在执行后记录。

## Execution Results — 2026-10-08

- 用户补充的图片区别已落实：像素卡带为独立大头贴，经典舞台为完整人物图，两槽默认空，既有上传保留。隔离测试上传裁剪头像并观察真实 Canvas 图片绘制位置随动画变化；切换经典舞台后图片仍为空。
- 回归发现展示板继承的 0.48 不透明度与画布 0.05 步长冲突，已统一为 0.01；补齐 900 字重、歌词两端对齐及 50ms 偏移。客户端展示板控件接受原画布字号/圆角范围，歌词滑块按共享字段精度回填。增强下拉框显隐改由字段容器持有。
- 新的外观共享不影响资源/媒体身份、发布布局和事件游标；同版本输出返回当前外观，更新配置不会重建 iframe 或重播礼物。时钟旧式 URL 按指定样式读取档案后应用显式参数。
- 本次不操作真实直播软件、不重启用户应用、不修改真实设置或上传，不修改服务器仓库。测试使用内存数据库、隔离 Electron 路径与临时端口；截图和日志位于根目录 `tmp/`。

验证命令与结果：

1. `node --experimental-vm-modules --test test/admin/canvas-shared-appearance.test.js test/scenes/shared-appearance.test.js test/scenes/scene-renderer-state.test.js test/overlays/clock-overlay.test.js test/overlays/frontend-clock-runtime.test.js test/overlays/overlay-projection.test.js test/settings/settings-contract.test.js test/gifts/frontend-blindbox-admin.test.js test/gifts/frontend-blindbox-overlay.test.js test/overlays/opening-canvas-settings.test.js`：81/81。
2. `node --experimental-vm-modules --test --test-concurrency=2 test/admin/canvas-songlist.test.js test/admin/song-board-settings.test.js test/scenes/shared-appearance.test.js test/scenes/scene-extra-components.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/lyrics/desktop-lyric-settings.test.js`：34/34。
3. `node --experimental-vm-modules --test --test-concurrency=2 test/scenes/scene-live-updates.test.js test/scenes/scene-renderer.test.js test/admin/canvas-songlist.test.js test/admin/canvas-queue.test.js test/gifts/frontend-gift-display-settings.test.js`：14/14。早期失败的展示板测试已改为检查共享 owner，并通过真实下拉控件操作重新验证。
4. `node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern 'desktop and canvas share' test/desktop/shared-canvas-appearance-electron.test.js test/desktop/opening-styles-electron.test.js`：2/2；真实 preload、会话、WebSocket、上传接口和画布双向同步。
5. 前序定向验证包括场景保存/发布、资源样式、开播 API/runtime、礼物/歌词/互动表单；资源参数隔离 Electron 测试和画布输出 9 项回归通过。修正测试工具的 utils 导出后礼物表单组通过。
6. `npm run check`：1349 个 JavaScript 文件通过；`npm run verify:architecture`：23/23；`npm run verify:docs`：10/10。
7. Impeccable 对涉及的参数页和控制器静态扫描无问题；人工检查空卡带、上传头像和共享歌词画布截图。最终差异与工作区状态检查完成，无生成或运行数据进入版本差异；保留已有无关改动，未提交。

未执行完整仓库测试或真实 OBS/直播姬实播；本任务没有更改远端协议或安装发布流程。
