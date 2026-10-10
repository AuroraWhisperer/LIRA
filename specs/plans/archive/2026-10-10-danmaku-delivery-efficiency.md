# 弹幕交付与复用优化

**Status:** Completed

**完成日期：** 2026-10-10。本任务相关验证通过；共享工作区一项无关架构门禁失败保留在下方证据中。

## Goal

保持现有在线弹幕、本机场景、独立组件、样式编辑和本地互动的使用方式，减少没有消费者时的云端传输及本机空轮询；公共连接行为由单一模块维护。

## Current Behavior

- Electron `scene-cloud-controller` 在授权后持续接收公共 overlay SSE，与本机是否读取展示数据无关。
- 场景使用 `scene-source` 的通知加增量读取；独立弹幕组件每次响应后等待 750ms 轮询。
- 服务器已经一次采集、多订阅分发；客户端直连 B 站承担点歌/小游戏/AI 等业务，不能用过滤后的展示流替换。
- 两仓工作区均有大量既有修改；只修改本任务拥有的逻辑，保留其他差异。

## Ownership And Compatibility

- `src/scenes/cloud-display-buffer.js` 拥有展示投影；新增按需活动管理模块，不把 Electron 或远端认证引入它。
- `src/server/scene-runtime.js` 组合展示读取、通知和需求信号；`src/electron/scene-cloud-controller.js` 继续独占远端连接、授权 fencing、退避和清理。
- `src/server/scene-output-events.js` 与 `public/js/overlays/scene-source.js` 中可复用的通知机制提取为展示通知模块；场景权限与 projection 仍由原 scene service 负责。
- 既有页面地址、JSON 数据形状、token 权限、租户隔离、存储、点歌及 B 站直连契约保持兼容。新增本机弹幕只读通知端点，旧读取接口继续可用。
- 用户已授权本次优化及必要模块复用；不提交、发布、部署或操作真实账号。

## Proposed Changes

1. 活跃展示或默认外观读取续期需求；使用有界空闲宽限避免切页/网络短暂停顿反复重连。无需求时停止云端订阅，有需求时自动恢复。配置缓存保留，旧会话事件清空；授权切换仍清空旧账号数据。
2. 独立弹幕组件通过与组合场景共用的通知客户端读取增量；通知缺失/断开时沿用 750ms 回退，健康时五秒校验。复用后端流的合并、限额、授权复核和清理逻辑。
3. Server 的 `public/overlay/danmaku-renderer-core.js` 维护共同 DOM 渲染；桌面通过显式维护脚本导入同名本地快照及摘要。原入口为策略适配器，保留系统消息类与入场延迟差异。两端样式装饰器、校验规则和 feed 生命周期保持原 owner，不恢复旧计划的 protobuf 工作。

## Milestones And Verification

- [x] 需求管理和云端 controller：用确定性计时器验证零消费者零请求、多个读取共享连接、空闲释放、重开、授权切换、迟到响应及 shutdown。
- [x] 展示通知复用和独立组件接入：既有 scene-source / scene-output-events 回归；新增组件适配及真实隔离 HTTP 路由验证，涵盖通知、权限、降级、游标、关闭与无重复请求。
- [x] 核对公共渲染复用范围、技术参考、场景规格和用户说明。
- [x] 运行受影响检查与模块/文档门禁，审阅本任务 diff、`git diff --check`、`git status --short`；无关架构门禁失败单独记录。

Commands: `node --experimental-vm-modules --test test/scenes/scene-cloud-controller.test.js test/scenes/scene-output-events.test.js test/scenes/scene-source.test.js test/scenes/scene-runtime-events.test.js test/scenes/scene-runtime.test.js`，扩展加入新增测试；`npm run verify:architecture`、`npm run verify:docs`、`npm run check`。不默认运行无关完整业务/浏览器套件。

## Documentation

同步 `docs/reference/backend/api.md`、`docs/reference/frontend/overlays.md`、`docs/reference/desktop/main.md` 与 `specs/component-scenes.md`。检查 `docs/guides/component-sources.md` 和应用内场景/浏览器源说明；操作不变时无需改写指南或截图。

## Failure Handling

通知失败保留轮询兼容路径；云端仍有原有超时、退避和 owner/session 校验。回滚只逆转本任务的具体差异，不覆盖同文件中既有修改，不删除用户数据。

## Done When

没有本机弹幕消费者时云端连接能自动释放；重新使用时恢复；两类本机来源共享通知实现且没有重复注册或并发读取；相关测试、权限和生命周期检查通过，参考文档与实际行为一致。

## Evidence

- 实施前场景 controller、通知、source、runtime 定向基线 106/106 通过。实施后场景、独立弹幕、渲染、feed、权限、IPC 与源码快照的 18 文件检查 209/209 通过，日志保存在本机 `tmp/danmaku-final-focused.log`。
- 最后复核将闲置断开与真实 cloud buffer 联测：先复现连接已取消但 buffer 未接收同一 connectionEpoch 的 offline，随后保留关闭前连接身份完成清理。原用例扩展断言清空实时消息、保留配置；controller/demand/runtime/IPC 五文件复验 75/75 通过（`tmp/danmaku-final-lifecycle.log`）。
- 共享核心保留两端原有系统消息 class 和入场延迟；服务器 `getSuperChatColors` 原导出由适配器保留，不放入桌面公共核心。源码比对、只读漂移检测及桌面渲染复验 19/19 通过（`tmp/danmaku-final-renderer.log`）。
- `node --experimental-vm-modules --test test/scenes/scene-live-updates.test.js test/desktop/danmaku-canvas-electron.test.js`：6/6 通过。真实浏览器验证通知健康时不再每 750ms 读取弹幕、单次消息仅渲染一次、通知 503 回退、关闭取消请求及场景发布恢复；隔离 Electron 验证样式选择、保存、重开、预览及 IPC/沙箱发布。日志 `tmp/danmaku-final-ui.log`。
- Server 的 `overlay-message-renderer`、`overlay-static`、`overlay-asset-cache` 测试 8/8，`overlay-superchat-renderer` 3/3 通过；Playwright 完整文件 `overlay-emotes`、`overlay-gift`、`overlay-superchat`、`overlay-prismatic` 共 4/4 通过。临时独立数据库、端口与运行目录隔离；日志位于 Server `tmp/danmaku-efficiency/`。
- Server 初次文档/浏览器检查被系统 Node 24.21 的既有版本约束阻止启动。随后在 Server `tmp/` 下载官方 Node 24.18.0 并核对官方 SHA-256，只在验证进程 PATH 使用它；未放宽版本门禁或修改系统安装。Server `npm run docs:check` 最终 49/49 通过。
- Desktop `npm run verify:docs` 10/10 通过，`npm run check` 语法检查通过。`npm run verify:architecture` 为 25/26：唯一剩余失败为既有其他任务对 `src/shared/danmaku-style-options.js` 的 comment-only catch 变更；本任务未编辑此文件或放宽门禁。
- 已同步桌面 API、frontend/desktop 参考、场景规格、ADR-0020 与 Server ADR-0096/架构入口。现有用户指南和应用内操作说明仍准确，URL、复制/编辑/保存步骤不变，因此本任务不改指南或截图。公共样式规则及 protobuf 共享仍在原延期计划。
- 两仓仅审阅本任务差异并保留已有修改；没有提交、分支、发布或真实账号操作。未进行真实实播或 CPU/带宽百分比基准，不把隔离测试等同于生产性能测量。
