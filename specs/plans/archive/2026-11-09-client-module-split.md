# 客户端两项职责拆分

**Status:** Complete

## Goal

落实用户“直接修复”的要求，完成[三轮审计](../../../docs/reports/2026-11-09-client-responsibility-audit.md)保留的两项职责归位：播放器工作区与通用表单分离；弹幕样式私有判定回归渲染拥有者。保持可观察行为和已有数据、公开接口不变。

## Non-goals

不改播放器 toggle 语义、音频实现、歌词呈现、弹幕视觉设计或消息协议，不拆 feed 的队列/布局/取消/清理，不新增框架、依赖、插件注册系统，不处理其他历史审计项，不操作用户账号/设备或提交、发布。

## Current Behavior

FormsService 的工作区方法和表单方法消费者不同，但表单消费者静态依赖 output-device/native-output。公共 danmaku feed 内存在 Harbor 两入口资格选择、prismatic/snowfox 事件卡适配选择和 Stardust 私有锚点读取。现有测试基线见审计报告，实施前重新运行直接受影响场景。工作区已有其他未提交修改，初始摘要、状态和受影响文件原文保存在根 `tmp/client-module-split-2026-11-09/`。

## Ownership 与最小文件边界

### A：播放器工作区

- 新建 `public/js/admin/player-workspace.js`，具名导出 `PlayerWorkspace` 与页面单实例 `playerWorkspace`，沿用当前类式附近约定。
- 从 `forms.js` 整体迁移 initWorkspaceControls/openFullscreenPlayer/closeFullscreenPlayer/setPlayerDockCollapsed/closeDockDependentPlaybackUi 及私有工作区依赖。状态 getCloseQueuePopup/releaseFullscreenFocus 仍由该实例拥有，初始化不提前产生副作用。
- `app.js` 在原位置调用 playerWorkspace.initWorkspaceControls，向播放器传入相同的 closeFullscreenPlayer 回调；formsService 只承担原有表单/tab职责。
- `test/admin/frontend-admin-startup.test.js` 调整装配 mock，保留行为断言。复用现有运行/歌词/队列测试；真实工作区的焦点、键盘和晚到输出准备是必要验证缺口，优先使用现有 fixture 检查。

### B：弹幕样式能力

- 在现有 message renderer/style 层选择消息资格、内容适配和锚点；feed 只在原同步调用点使用窄谓词/能力，保持 renderer 返回 DOM 节点的合同。
- 在 `danmaku-message-renderer.js` 桌面适配层与已有样式模块提供能力；遵守 ADR-0020，保持 `danmaku-renderer-core.js` 固定源码快照及来源摘要不变，避免另一份相同样式分类。
- `danmaku-feed.js` 保留 entries、测量、字号搜索、zoom、随机坐标、动画、定时器、移除和 destroy；资格过滤仍先于 DOM 创建与容量裁剪。
- 复用 overlay-renderer/fullscreen/feed-buffer/motion/typography 现有行为场景，只为真实未覆盖的回归风险补充断言，不新增默认值或源文本快照。

主代理负责文档、集成与桌面验证；两个实现子代理分别独占 A/B 文件；第三代理只读审查最小边界与完成后补丁。技术事实更新到 frontend/app、playback、overlays 及需要时的 motion/pages 参考。README、guides、内置使用说明和导览检查影响；操作步骤不变则不改。

## Compatibility Constraints

保留 settings/localStorage 键、页面和 HTTP/WS/IPC、renderer 返回形状、DOMContentLoaded 装配顺序。播放器保留默认折叠、队列关闭的延迟读取及 fallback、焦点/ARIA/inert、Space 输出准备的等待和错误处理、WeSing 切换关闭。弹幕保留快照/增量过滤等价、长 SC/舰长卡重排、随机锚点、缩放、密集打断和销毁。

## Milestones 与验证

- [x] A：先运行原场景，提取完整工作区并调整唯一装配方；执行 admin-runtime/admin-startup、desktop-lyric-settings、frontend-queue 及所需工作区行为验证。
- [x] B：运行原 renderer/fullscreen 场景，归位样式能力；执行相关 Node/VM 测试及既有浏览器 motion/typography 验证实际重排、密集到达和清理。
- [x] 交叉复审与集成：检查无重复 owner、事件、请求或 renderer 变更；主代理使用隔离 Electron fixture 验证真实桌面工作区，不接管用户实例。
- [x] 同步参考与审计收尾；运行架构、受影响文件语法、文档及差异检查，任务外文档失败按下述限制保留。

不默认运行全量套件。当前文档门禁已有旧报告引用缺失临时材料的失败，复核失败是否仍仅属于原有材料，不伪造证据或降低断言。

## 实施结果与验证

- A 新增 `player-workspace.js`，5 个方法体与任务前基线逐字一致，4 项专用依赖随状态迁移；`app.js` 仍在原位置初始化并注入关闭回调。独立复核确认通用表单的其余修改保留，没有重复注册或旧 owner 调用残留。
- B 的 `createDanmakuMessageFilter(options, fullscreen)` 保留原配置引用，feed 的快照/增量共用同步谓词；字号适配与锚点由原卡片分支声明。原过滤时点、数字/字符串守护等级差别、DOM 返回、测量和生命周期不变。公共 core 字节摘要与任务前相同，来源 manifest 未改。
- 新增 2 项行为用例：Stardust 最终上下居中位置及交换；prismatic/snowfox 的 SC 与大航海卡在区域缩小时保持整卡宽度、完整文字并缩小字号。两项在任务前源码上均通过，再恢复本次源码并逐文件核对摘要。字号测量夹具关闭 transition，与既有静态排版用例一致；生产样式及动画未改。

| 验证 | 结果 |
| --- | --- |
| Admin runtime/startup、歌词设置与队列，重构前后相同 4 套 | 14/14 |
| 弹幕 message renderer、overlay renderer、fullscreen、feed buffer | 74/74；原基线 73/73 |
| 真实浏览器 typography | 7/7 |
| prismatic/snowfox 打断与 moonlit 密集到达的浏览器 motion | 3/3 |
| `npm run verify:architecture` | 29/29 |
| `test/engineering/danmaku-source.test.js` | 2/2 |
| 本次 13 个 JS 源码/测试语法 | 全部通过 |

上述为 129 项独立检查；旧源码上的 2 项补充对照不重复计数。`danmaku-overlay-fullscreen.test.js` 是 Node/VM 场景，实际浏览器证据来自 typography 与 motion。

Electron 验证复用 `daily-bot-editor.cjs` 的生产 Admin HTML、preload 与桌面请求授权，使用根 `tmp/` 内独立 userData/sessionData 和随机端口，匿名 `/admin` 确认为 401。入口仅装配真实 PlayerWorkspace，验证默认折叠、展开/收起偏好重载、全屏焦点/Tab/Escape、关闭后的 inert 恢复、队列 fallback/延迟回调、音量联动及外观入口。生产 output-device 配合合成音频边界验证准备后播放、准备期间换曲/已播放的取消判断、暂停及两条失败反馈；没有真实设备播放或完整账号会话。自有 Electron 已关闭。

技术事实已同步 frontend/app、pages、playback、overlays。动效参考和用户指南/导览无需修改：可观察操作、外观与动效参数均未变。只读独立复审已完成，最终无必须修正点。其他并行粉丝/歌曲信息任务的修改保留，未提交或发布。

文档门禁已执行，仍存在任务外材料失败：旧 `2026-11-05-continuous-audit.md` 引用的历史临时报告缺失。收尾前还观察到并行粉丝任务的完成计划尚未归档导致状态检查失败；本任务不修改其他计划。最终门禁结果按实际收尾输出报告，不把全局文档检查写成全绿。工作树摘要、检查日志及隔离桌面证据保存在根 `tmp/client-module-split-2026-11-09/`，不作为长期文档依赖。

精确聚焦命令：

```powershell
node --experimental-vm-modules --test test/admin/frontend-admin-runtime.test.js test/admin/frontend-admin-startup.test.js test/lyrics/desktop-lyric-settings.test.js test/songs/frontend-queue.test.js
node --experimental-vm-modules --test test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-overlay-renderer.test.js test/danmaku/danmaku-overlay-fullscreen.test.js test/danmaku/danmaku-feed-buffer.test.js
node --test test/danmaku/danmaku-typography-browser.test.js
node --test --test-name-pattern 'prismatic keeps interrupted|snowfox keeps interrupted|moonlit bounds bursts' test/danmaku/danmaku-feed-motion.test.js
node --test test/engineering/danmaku-source.test.js
npm run verify:architecture
npm run verify:docs
```

## Rollback Or Failure Handling

先保留聚焦失败证据并修复当前拥有者；新增回归应先在旧实现证明覆盖有效，纯行为保留用原测试基线。仅逆向本任务增量，保留所有已有改动，不进行 reset、整文件 checkout 或广泛删除。真实 Electron 验证前确认独立数据/会话目录及端口/单实例策略，自有实例结束时关闭。

## Done When

两项拥有者已明确、最小提取完成，聚焦与真实界面验证证明原行为保留，独立复审无未处理的具体问题，技术参考同步，测试/用户说明影响已说明，最终任务增量和既有文档失败的归属明确。
