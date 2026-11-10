# 模块职责与粒度整改

Status: Completed

归档记录：用户批准的七项职责整改已完成。本文保留实施边界和验证证据，现行合同以 reference 文档为准。

## Goal

实施[职责审查](../../../docs/reports/2026-11-10-module-responsibility-review.md)确认的 S1–S4、M1–M3，让共享能力和独立生命周期回到明确拥有者，减少无边界收益的中间模块，保持产品行为。

## Non-goals

不修改服务器仓库，不调整 HTTP/WS/IPC、存储格式、用户操作、Electron 安全或发布流程；不统一具有不同身份和缓存合同的图片解析器，不接管工作区其他整改。

## Current Behavior

审查报告记录了当前实现、调用方和初步验证。最近礼物视图拥有三个消费者共用的图片目录；盲盒模块同时拥有映射和统计生命周期；画布协调者包含组件布局策略和图层条 DOM；API context 包含 AI 同步判断与观众合并。另有三个可直接收回拥有者的薄层。开始实施时工作区已有并行修改，按文件保留基线用于区分。

## Ownership And Proposed Changes

| 项目 | 实现拥有者与消费者 | 合同及验证拥有者 |
| --- | --- | --- |
| S1 | 新建 `public/js/admin/gifts/artwork-catalog.js`，持有索引、请求、快照版本和订阅；recent、notification、blindbox 消费，Admin 礼物入口显式初始化/销毁 | `docs/reference/frontend/app.md`、`pages.md`；recent-gifts、gift-artwork-identity 与契约测试 |
| S2 | `gifts/blindbox.js` 保留映射及房间目录生命周期；新建 `gifts/blindbox-stats.js`，整体持有统计请求、可见性、渲染及清理 | frontend app；mapping-state、mapping-refresh、统计生命周期覆盖 |
| S3 | `component-preview-definitions.js` 接管初始布局策略；新建 `component-preview-layers.js` 接管图层条 DOM 与菜单；canvas-view 保留单一模型/选择/历史协调 | frontend app；registry、scene-document-model、canvas-editing |
| S4 | `ai-runtime.js` 配置成功通知通过窄回调连接既有菜单签名同步；`game-runtime.js` 拥有观众投影，api-context/runtime-api-context/server 只装配 | backend server-core/api；AI routes/runtime、danmaku-menu、game-routes |
| M1 | Admin sprint 与 sprint-overlay 合入 `gifts/sprint.js`，更新 gift-assistant 消费 | frontend pages；canvas-gift-components、frontend-gift-sprint |
| M2 | browser-source-preview、clock-preview 直接引用 shared 参数视图，删除内部转导出 | component-preview-registry；保留 local-font-library 兼容入口 |
| M3 | realtime-state 计算收回 `BilibiliDanmakuClient.getRealtimeState()` | backend bilibili/danmaku；danmaku-client、bilibili-runtime |

## Compatibility Constraints

- 图片 variant/同名歧义/安全路径、空目录缓存、请求去重、失败重试及慢请求防回退保持。
- 映射草稿、切房失效和请求顺序保持；统计隐藏取消、恢复请求、键盘和分析入口保持；显式初始化不增加订阅或请求。
- 组件初始几何、锁定、焦点及一次操作一次历史记录保持。可变文档状态集中，不传递宽 context。
- AI 无关设置及失败不产生额外上传；观众 UID 合并、时间排序和来源失效保持。
- B 站 socket 打开不等于鉴权成功，实时就绪及 connectionKey 合同不变。
- 不回退或覆盖工作区已有修改。现有模块 URL 兼容约束优先于删除薄层。

## Milestones

- [x] S1/S2：迁移目录与统计生命周期、显式装配并调整现有夹具；运行礼物相关聚焦测试，补实际生命周期缺口。
- [x] S3：迁移初始布局策略和完整图层条；运行模型/注册表与现有画布浏览器场景。
- [x] S4：应用规则归位；运行 AI、菜单同步、游戏观众与 runtime 聚焦回归。
- [x] M1/M2/M3：合并薄层并同步消费者；运行相关预览/弹幕测试。
- [x] 同步各项拥有者文档、审查实施状态，执行架构/文档门禁并检查最终任务差异。

## Verification

按里程碑运行对应现有 `node --experimental-vm-modules --test ...` 套件，将确切命令、通过数量和限制记录在下方。使用已有隔离浏览器测试验证画布交互，不启动或操作用户运行中的应用。最终执行 `npm run verify:architecture`、`npm run verify:docs`、相关 JavaScript 语法检查、`git diff --check`、`git status --short`。不因内部移动运行全仓业务套件。

图片契约需要锁定 Server revision；优先使用匹配的独立夹具 checkout，不切换用户 Server 工作区，不修改锁文件绕过验证。

## Rollback Or Failure Handling

失败时保留聚焦证据并修复本项拥有者；通过 `tmp/module-responsibility-refactor-2026-11-10/` 的实施前文件和当前 diff 区分并行改动，只撤销本任务修改。遇到未解决的行为或兼容冲突明确记录，不以放宽断言获得通过。

## Done When

七项职责调整完成，相关行为覆盖和必要 UI 检查通过；合同、索引和文档路径同步；最终差异仅包含本任务改动且保留已有工作。未执行的验证如实记录，未满足完成条件不得归档为完成。

## Execution Evidence

| 验证 | 结果 |
| --- | --- |
| 下列 19 文件聚焦回归 | 126/126 通过，包含固定 Server 图片契约 |
| `node --experimental-vm-modules --test --test-concurrency=1 test/admin/canvas-editing.test.js test/admin/canvas-gift-components.test.js test/gifts/frontend-gift-sprint.test.js` | 18/18 通过：布局、菜单、拖动、撤销、锁定/隐藏、冲刺预览和独立投屏 |
| `node --experimental-vm-modules --test test/admin/canvas-browser-source.test.js` | 1/1 通过：浏览器源视口独立性、保存和发布 |
| `node --experimental-vm-modules --test test/ui/frontend-toast-browser.test.js` | 2/2 通过：通知本地图片、节点复用、回退和焦点 |
| `npm run verify:architecture` | 29/29 通过 |
| `npm run verify:docs` | 10/10 通过，先前其他计划的状态格式问题已消失 |
| `npm run check` | 1,826 个 JavaScript 文件语法检查通过 |
| 差异与工作区检查 | 对照实施前文件复核；保留既有及并行修改，执行 `git diff --check` 与 `git status --short` |

```powershell
$env:LIRA_SERVER_ROOT = 'D:\Work\Live\tmp\v6.1.5-server-contract'
node --experimental-vm-modules --test test/gifts/frontend-recent-gifts-contract.test.js test/gifts/frontend-recent-gifts.test.js test/gifts/gift-artwork-identity.test.js test/gifts/frontend-blindbox-mapping-state.test.js test/gifts/frontend-blindbox-mapping-refresh.test.js test/gifts/frontend-gifts.test.js test/gifts/frontend-gift-panel.test.js test/gifts/frontend-blindbox-admin.test.js test/admin/component-preview-registry.test.js test/admin/scene-document-model.test.js test/admin/scene-component-definitions.test.js test/ai/ai-routes.test.js test/ai/ai-runtime-cleanup.test.js test/games/game-routes.test.js test/cloud-sync/danmaku-menu.test.js test/danmaku/danmaku-client.test.js test/bilibili/bilibili-runtime.test.js test/server/bilibili-likes-api.test.js test/server/live-rankings-api.test.js
```

契约使用已有干净独立检出，HEAD 为锁定的 `67119e81a3f5f49470ed2b191f6552556d0a704e`，读取夹具时由已有校验器验证修订及哈希。没有切换用户 Server 工作区或修改锁文件。审查阶段的失败保留为历史证据，本次契约用例实际执行通过。

新增回归针对目录重复初始化/取消/迟到响应、映射卸载与旧房结果、AI 配置失败不通知；统计既有可见性回归扩展了监听清理与重新挂载。其余主要调整现有测试的拥有者路径，未放宽行为断言。

同步了 frontend app/pages、backend server-core/api、B 站弹幕参考及原审查报告。用户指南保持不变：操作、界面、URL 和公开协议均未改变。画布与图片验证复用既有隔离 Chromium/本机 HTTP 夹具，不操作用户应用或数据；未运行全仓业务套件、完整 Electron 流程或真实 B 站/直播软件实播，未提交、打包或发布。

日志、实施前副本和任务差异位于 `tmp/module-responsibility-refactor-2026-11-10/`。其他任务在执行期间修改的 hybrid gift catalog 测试与 API 目录刷新合同不属于本次整改，保留其内容。
