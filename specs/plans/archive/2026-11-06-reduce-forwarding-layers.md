# 收拢无独立职责的转发层

Status: Completed

## Goal

减少播放、画布预览和设置启动中的无职责跨文件跳转。由独立资深审查代理复核判断及最终差异；只收拢已经确认无状态、资源、策略或兼容职责的包装。

## Current Behavior And Decision

- `lyric-controls.js` 只读取歌曲和音频并委托 `LyricService.syncWindow`；`controller.js` 已有同名委托。
- `games-canvas-data.js`、`opening-canvas-data.js` 只向同一个画布轮询器传配置。
- `danmaku-canvas-dialog.js` 只重导出预览工厂并组合打开操作。
- `settings-bootstrap.js` 只调用存储门面的原子初始化并包装返回值。
- 独立审查已确认以上五个模块可以收拢。现有模块化规范要求抽象保护实际边界，不强制按行数拆分，故修改代码和实现参考，不放宽规范。
- 当前 `settings-defaults.js` 已不再依赖浏览器目录；上轮发现的该问题已由工作区其他改动修复，本任务仅验证。

## Ownership And Parallel Work

| 批次 | 源码和消费者 | 文档 | 验证 |
| --- | --- | --- | --- |
| 播放（主代理） | `public/js/playback/controller.js`、原歌词包装、`test/helpers/playback-app.js` 及相关歌词测试 | `docs/reference/frontend/playback.md`、`docs/reference/frontend/pages.md` | 歌词交接、播放组合与实际初始化事件路径 |
| 管理端（独立实施代理） | 画布控制器、弹幕设置、三个原预览包装及直接测试 | `docs/reference/frontend/overlays.md` | 预览数据取消/失败/共享、弹幕保存、浏览器依赖隔离 |
| 设置启动（独立实施代理） | `src/server.js`、原启动包装及三个直接测试套件 | `docs/reference/backend/storage.md`、`docs/architecture/engineering/ai-workflow.md` | 设置事务回滚/重试、盲盒默认值、开播设置重启 |
| 独立审查 | 复核当前规范、边界与各批次最终差异 | 本计划记录裁决 | 根据源码与测试提出问题，主代理修正后复核 |

## Compatibility And Non-goals

保留 HTTP/WS/IPC、页面地址、持久化字段、存储事务和升级顺序。保留 async 返回/错误传播、轮询取消和迟到响应屏蔽、空数据投影、预览草稿与账号隔离。保留有生命周期的订阅、预览会话、领域服务和路由；不按文件大小合并。用户界面及操作步骤不变，使用指南和交互引导只核对影响。不得覆盖其他未提交改动，不提交、不建分支。

## Milestones

- [x] 独立复核五个候选及规范冲突，确认当前设置依赖修复状态。
- [x] 播放：在已有控制器委托内直接调用歌词服务，删除旧包装；将行为测试迁到实际组合路径。
- [x] 管理端：轮询配置就近放到画布控制器；弹幕设置直接组合工厂和打开操作；删除三个旧包装，保留原生命周期保护。
- [x] 设置启动：直接使用既有 `bootstrapSettingsStore`；测试跟随存储 owner，删除旧包装并同步路由表。
- [x] 同步实现参考、清理失效的测试基线，运行边界与文档门禁。
- [x] 独立最终复审、检查任务差异与工作区、归档完成证据。

## Verification

先运行已有相关行为测试建立基线，修改后运行同组测试。保留独立场景的断言，不以删除测试或放松架构限制获得通过。实际执行的收尾检查：

```text
node --experimental-vm-modules --test test/lyrics/lyric-source-handoff.test.js test/playback/playback-wesing.test.js test/lyrics/desktop-lyric-publication.test.js
node --experimental-vm-modules --test test/admin/component-preview-contracts.test.js test/admin/component-preview-providers.test.js test/admin/component-preview-canvas-controller.test.js test/danmaku/server-danmaku-settings.test.js
node --experimental-vm-modules --test test/settings/settings-bootstrap.test.js test/gifts/blind-box-defaults.test.js test/overlays/opening-overlay.test.js
node --test --test-name-pattern="server normalizes localhost to the IPv4 loopback address" test/server/server-smoke.test.js
node --experimental-vm-modules --test test/engineering/module-boundaries.test.js test/engineering/esm-module-boundaries.test.js
npm run verify:docs
git -c core.safecrlf=false diff --check
git status --short
```

播放测试使用已有 `createPlaybackApp` 夹具初始化实际控制器并触发音频 `seeking`，观察内部候选歌词发布；迁移后的该套测试在删除包装前先通过 7/7。管理端基线 46/46，收拢后新增一条真实控制器数据投影用例，其余取消、失败、隔离覆盖迁到所属模块。设置启动基线及修改后均为 23/23。

服务启动用例使用合成数据目录和系统分配端口，结束后停止实例并清理；未启动或操作真实用户应用。相关生产源码、播放测试和夹具的 `node --check` 通过。删除文件后搜索当前代码、测试与维护文档，无旧包装引用；历史报告/归档中的当时事实保持。

## Failure Handling

每个实施代理记录自己的修改前内容。失败时定位实际契约或夹具问题，只修本任务差异；不使用 reset/checkout 回滚整个文件，不改正在运行的测试输入。若独立复核发现包装具有真实边界价值，保留原模块并记录理由。

## Done When

五个已确认包装被移除、直接调用链清楚；现有行为和安全边界的聚焦验证通过；当前技术文档路径准确；独立审查无未解决问题；全部任务差异已核对且其他用户改动完整。

## Results

2026-11-06 完成三批并行实施，独立资深审查代理逐批对照任务前快照和最终差异复核，无未解决问题。主代理核对任务差异及最终工作区，保留其他未提交修改；未提交、打包或发布。

| 验证 | 结果 | 主要覆盖 |
| --- | --- | --- |
| 播放与歌词 | 32/32 通过 | 来源交接、实际初始化/音频事件发布、桌面歌词发布 |
| 管理端预览 | 47/47 通过 | 轮询共享/失败/取消、成功及空数据投影、区域编辑、账号切换与浏览器依赖隔离 |
| 设置初始化 | 23/23 通过 | 事务回滚、重试、迁移、重复启动、盲盒及开播默认值 |
| 隔离服务启动 | 1/1 通过 | 实际 server 组合入口在临时目录和随机端口启动及停止 |
| 模块边界 | 23/23 通过 | 后端与 ESM 依赖、模块化与空 catch 基线 |
| 文档门禁 | 归档前 10/10；收尾 9/10 | 本任务归档链接已修正；另一个进行中重构删除桌面状态文件后，其文档链接暂未同步，详见下方范围说明 |

五个转发文件已删除，行为位于现有调用方或 owner。歌词委托保留读取顺序、`async/await`、错误传播与 `undefined` 返回；小游戏空数据仍为 `{ preview: true, session: null }`；预览依赖禁入规则改为实际桌面设置 owner。存储初始化继续由已有事务 owner 负责。

现行模块化规范与本次决定一致，无需修改规范或新增 ADR。清理 `module-boundaries.test.js` 中已失效的 `overtime.js` 空 catch 例外，未放松规则；已由其他工作区修改消除的 storage → browser 默认值依赖仅验证，不重复实现。

实现参考与 owner 路由已同步。用户指南、应用内说明和交互引导无需为本任务修改，因为入口、操作、字段及可见限制未变。本次为内部接线收拢，使用既有模块链夹具和隔离服务检查；未扩大为全仓测试或真实用户桌面验收。

任务前快照保存在 `tmp/forwarding-root-before/`、`tmp/forwarding-admin-before/`、`tmp/bootstrap-consolidation-before/`，仅作本地复核材料，不进入提交。

收尾范围说明：归档后同步修正另一份进行中架构计划的入站链接。此后文档门禁唯一失败变为 `docs/reference/desktop/main.md:129` 仍链接其他并行重构刚删除的 `src/electron/desktop-state.js`，本任务未修改这两处文件。全工作区 `git diff --check` 还在其他并行修改的 `public/js/shared/logger.js`、`theme.js`、`utils.js` 报告文件末尾新增空行；本任务未修改这三处文件，任务范围的差异检查单独通过。这些结果是收尾时工作区的状态，由其所属重构继续同步，不扩大本任务。
