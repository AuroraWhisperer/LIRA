# Client and Server File Splitting Implementation Plan

> Status: complete; 2026-09-22. Non-normative implementation and review record.
> For agentic workers: 用户已指定 Astra Max 并行协作；按独立工作包实施和交叉复核。

**Goal:** 全面评估双仓库达到 600 行的文件，尽可能拆分超过 800 行的维护源码，酌情拆分 600–800 行文件，保持行为和契约。

**Architecture:** 保留 Electron + Node 模块化单体、URL、CommonJS/ESM 边界。CSS 顺序导入连续职责片段，HTML 复用固定片段机制，仅提取独立迁移、详情 DOM 和测试场景。

**Tech Stack:** Node.js 24+、Electron 43、原生 JavaScript/CSS/HTML、node:test、Playwright。

## Constraints and Current Behavior

- 以任务启动时两个工作区为基线，保留大量既有未提交修改；不提交、建分支、重置或全盘格式化。
- 不改 HTTP/WS/IPC、授权/租户边界、存储格式、事务语义、页面 DOM、CSS 级联与测试场景。
- 已发布游戏 v1/v2 文件受 system-rules 的不可变契约保护，原字节保留。
- 物理行数含注释和空行，不计末尾换行的虚拟行；600 行纳入盘点。服务器现有 JS gate 的末尾空行口径也须通过。
- 范围是 rg 可见文本维护文件，排除依赖/Git内部/二进制。客户端 31 个候选（12 个 >800），服务器 58 个（38 个 >800）。
- 非目标：文档重新编排、数据格式分片、发布新版游戏、视觉重设计、引入框架/依赖、无关修复。
- 基线：客户端 verify:quick 通过（987 JS 语法、22 architecture）；服务器 docs:check 35/35；服务器相关样式测试 47/47。

## Ownership

客户端以 docs/architecture/README.md、engineering/ai-workflow.md、modularity-standard.md 和 scoped AGENTS 为归属入口。服务器以 docs/README.md 为入口；游戏发布受 requirements/system-rules.md、acceptance-criteria.md 与 game-offline-contract 测试约束。

## Round One: Complete Inventory

拆分 A/B/C/D 对应下文工作包。保留 D：规范/协议保留现有锚点与事实源，历史计划/日志/审计保持记录完整性。保留 S：固定 JSON/schema/fixture、锁文件或输出证据，分片会改变消费契约。保留 V：已发布游戏版本必须保持原字节。

### 客户端

| 文件 | 初始行数 | 决策 | 依据 / 职责边界 |
| --- | ---: | --- | --- |
| package-lock.json | 3725 | 保留 S | 固定读取契约 / 生成数据 |
| docs/bilibili-live-api/message_stream.md | 2491 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| UPDATE.md | 2429 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| Review.md | 1466 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| public/pages/admin/toolbox/usage-guide.html | 1438 | 拆分 | A: getting-started / features / configuration / faq；复用单层 admin-fragment |
| docs/bilibili-live-api/info.md | 946 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| lira-server-public-feature-inventory.md | 897 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| public/data/theme-presets.json | 893 | 保留 S | 固定读取契约 / 生成数据 |
| specs/plans/archive/2026-08-16-ai-assisted-development-governance.md | 864 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/客户端使用文档补充方案.md | 863 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| specs/plans/2026-08-17-existing-code-governance-remediation.md | 839 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/startup-performance-evaluation-2026-08-21.md | 834 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| test/fan-profiles-ipc.test.js | 798 | 拆分 | A: ipc / sync / roster 场景及共享夹具 |
| public/css/admin/other-features/usage-guide.css | 792 | 保留 | 正文、FAQ 和现有工具箱覆盖次序交织；导航已独立，不机械拆媒体查询 |
| public/css/admin/workspace/song.css | 768 | 拆分 | A: song-management / song-layout 连续规则 |
| src/electron/remote-gift-controller.js | 768 | 保留 | 同一 source/cursor/epoch/generation、重连和定时器生命周期；恢复纯函数已独立 |
| src/server.js | 743 | 保留 | 组合根启动/关闭与 facade；领域已归独立 runtimes |
| public/pages/admin/toolbox/shell-start.html | 735 | 保留 | 导航/静态 SVG 及外壳标签；整段再抽将形成不支持的嵌套 include |
| src/electron/main.js | 710 | 保留 | 组合根接线与完整关停序列；业务已有独立控制器 |
| test/overtime-gift-picker.test.js | 692 | 保留 | 单一选择器的搜索代次/来源/身份，专用 DOM 夹具无第二消费者 |
| test/cloud-sync-controller.test.js | 681 | 保留 | 同一同步身份和生命周期场景，已有独立 fixture |
| test/qq-provider.test.js | 667 | 保留 | 单一 provider 的协议家族及错误处理 |
| src/electron/license/license-manager.js | 663 | 保留 | 授权、续期和 token 接受共享状态不变量；协议操作已独立 |
| src/storage/database-migrations.js | 659 | 拆分 | A: legacy-superchat-migration 独立历史迁移 |
| public/css/overlays/desktop.css | 651 | 拆分 | A: desktop/theme / update / shell 连续规则 |
| public/css/overlays/opening.css | 647 | 保留 | 单一开场画面、动效及降质模式 |
| docs/reports/2026-09-19-client-queries-after.json | 625 | 保留 S | 固定读取契约 / 生成数据 |
| public/js/admin/overtime.js | 617 | 保留 | 规则/时钟/状态视图已独立，剩余编辑状态与异步代次内聚 |
| test/wesing-capture-recording-mode.test.js | 608 | 保留 | 完整录制模式状态转换和音频来源 |
| docs/reports/2026-09-19-client-queries-before.json | 606 | 保留 S | 固定读取契约 / 生成数据 |
| public/css/admin/blindbox-analysis.css | 600 | 保留 | 恰好 600 行，单一分析面板 |

### 服务器端

| 文件 | 初始行数 | 决策 | 依据 / 职责边界 |
| --- | ---: | --- | --- |
| gift-import/bilibili-gifts.json | 125584 | 保留 S | 固定读取契约 / 生成数据 |
| test/fixtures/gift-seed-refresh-2026-09-16.json | 8365 | 保留 S | 固定读取契约 / 生成数据 |
| test/fixtures/gift-seed-refresh-2026-09-09.json | 8293 | 保留 S | 固定读取契约 / 生成数据 |
| output/mobile-ui-audit-2026-09-16/control-metrics.json | 6618 | 保留 S | 固定读取契约 / 生成数据 |
| docs/protocol/device-api.openapi.json | 6284 | 保留 S | 固定读取契约 / 生成数据 |
| output/overlay-motion-research-2026-09-17/measurements.json | 4658 | 保留 S | 固定读取契约 / 生成数据 |
| docs/protocol/management-api.openapi.json | 3821 | 保留 S | 固定读取契约 / 生成数据 |
| docs/requirements/acceptance-criteria.md | 2952 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/requirements/system-rules.md | 2453 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| output/mobile-ui-audit-2026-09-16/browser-verification-summary.json | 2393 | 保留 S | 固定读取契约 / 生成数据 |
| gift-import/blind-box-variant-relations.json | 2081 | 保留 S | 固定读取契约 / 生成数据 |
| docs/superpowers/plans/2026-08-29-client-onboarding-v0.6-legacy.md | 2006 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| package-lock.json | 2003 | 保留 S | 固定读取契约 / 生成数据 |
| output/overlay-motion-research-2026-09-17/edge-measurements.json | 1679 | 保留 S | 固定读取契约 / 生成数据 |
| public/admin/styles.css | 1611 | 拆分 | B: foundation / layout / data / streamer-detail / responsive |
| docs/protocol/public-gifts-api.openapi.json | 1517 | 保留 S | 固定读取契约 / 生成数据 |
| public/song/styles.css | 1513 | 拆分 | B: base / filters / request-controls / song-list / responsive / mobile-controls |
| public/gifts/styles.css | 1508 | 拆分 | B: catalog-shell / catalog-cards / gift-detail / gift-previews / responsive / activity-controls |
| e2e/public-homepage.spec.js | 1271 | 拆分 | D: 布局 / preferences / motion；共享无状态 helpers |
| test/fixtures/blind-box-probabilities.json | 1202 | 保留 S | 固定读取契约 / 生成数据 |
| public/games/styles.css | 1186 | 拆分 | C: catalog-base / detail-shell / shell-responsive / gameplay-shell / catalog-layout |
| output/page-release-audit-2026-09-13.json | 1167 | 保留 S | 固定读取契约 / 生成数据 |
| docs/superpowers/plans/2026-08-29-repository-cleanup.md | 1151 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| public/games/v2/treasure-house.css | 1084 | 保留 V | 已发布版本不可变 |
| docs/audits/2026-08-29-gift-effect-catalog-plan.md | 1079 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| public/streamer/manage.css | 1077 | 拆分 | C: shell-controls / content / responsive |
| public/games/v2/fame-road.css | 1056 | 保留 V | 已发布版本不可变 |
| public/site/styles.css | 1011 | 拆分 | B: base / section-motion / catalog-consent / responsive |
| e2e/admin-streamer-detail.spec.js | 999 | 拆分 | D: 请求生命周期 / presentation；共享安装夹具 |
| public/streamer/gift-workspace.css | 988 | 拆分 | C: workspace / analytics / history / responsive |
| test/fixtures/gift-room-additions-2026-09-11.json | 986 | 保留 S | 固定读取契约 / 生成数据 |
| public/games/v1/game.css | 952 | 保留 V | 已发布版本不可变 |
| docs/superpowers/plans/2026-08-29-documentation-governance.md | 946 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/design/song-request-conditions-design-report.md | 887 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/audits/2026-09-01-gift-ledger-sync-audit.md | 878 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| output/constellation-assets-inspection/asset-inspection.json | 843 | 保留 S | 固定读取契约 / 生成数据 |
| docs/audits/2026-09-14-gift-interaction-research-audit.md | 829 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| docs/protocol/management-api.md | 823 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| e2e/song-request-conditions.spec.js | 798 | 拆分 | D: 条件筛选 / song-request-copy；共享页面夹具 |
| docs/design/unified-management-console-modification-guide.md | 783 | 保留 D | 规范锚点 / 完整参考或历史记录 |
| public/streamer/gift-ledger.js | 748 | 保留 | 分页/snapshot/drilldown 共用 state、AbortController、generation；避免状态袋 |
| e2e/offline-games.spec.js | 743 | 保留 | 双游戏离线交互/持久化验收，共享矩阵与 slow 设置 |
| test/room-monitor-overlay.test.js | 729 | 保留 | 同一 monitor 异步失效和 socket 夹具；已有专题拆分 |
| public/site/fonts/console-font-manifest.json | 728 | 保留 S | 固定读取契约 / 生成数据 |
| src/routes/device.js | 684 | 保留 | 既有纯 HTTP 编排；不为行数拆散授权中间件和限流归属 |
| e2e/gift-variants.spec.js | 675 | 保留 | 活动目录身份/排序/分页/返回语义内聚 |
| docs/protocol/public-overlay-api.openapi.json | 669 | 保留 S | 固定读取契约 / 生成数据 |
| src/modules/bilibili/room-monitor.js | 668 | 保留 | 一个 generation/socket/live-session 状态机 |
| public/gifts/catalog-view.js | 663 | 拆分 | D: catalog-detail 负责详情 DOM；请求/导航/清理留原入口 |
| public/streamer/manage.html | 659 | 保留 | 静态 sendFile 页面，无模板组合机制，避免引入异步 DOM |
| public/games/v1/treasure-house.js | 650 | 保留 V | 已发布版本不可变 |
| test/streamer-gift-query.test.js | 640 | 保留 | 单一 worker/DB 夹具与完整关停顺序 |
| public/song/app.js | 636 | 保留 | 页面控制器和 facet 缓存共持筛选状态，已有独立 UI 模块 |
| public/song/fonts/v1/wenkai/manifest.json | 616 | 保留 S | 固定读取契约 / 生成数据 |
| public/admin/index.html | 614 | 保留 | 静态 sendFile 页面，未超上限，避免新增构建或模板层 |
| test/gift-catalog-service.test.js | 614 | 保留 | 10 个同一 service 用例及 afterResources 顺序 |
| test/bilibili-api.test.js | 608 | 保留 | 同一 VM 隔离夹具、超时和 WBI 代际 |
| public/games/v1/fame-road.js | 601 | 保留 V | 已发布版本不可变 |

## Work Packages and Verification

### A — Client Owned Regions

- usage-guide.html 保留外壳/目录/search include，新增 usage-guide-getting-started.html、usage-guide-features.html、usage-guide-configuration.html、usage-guide-faq.html；单层 include，章节/锚点顺序一致。
- workspace/song.css 原 1–332 行到 song-management.css，333–768 行到 song-layout.css；原入口顺序 import。
- overlays/desktop.css 保留 scrollbar import；原 3–81、82–299、300–651 行依序到 public/css/desktop/{theme,update,shell}.css；不混入 OBS 样式拥有层。
- database-migrations.js 的 migrateLegacySuperChatsToDedicatedDatabase/dropLegacySuperChatTable/legacySuperChatFingerprint 原样迁移到 legacy-superchat-migration.js，原公开导出、SQL、版本注册和事务不变。
- fan-profiles-ipc.test.js 保留 10 个 IPC 用例；fan-profiles-sync.test.js 7 个；fan-profiles-roster.test.js 11 个；共享 helpers/fan-profile-controller-fixture.js，保留每测试独立状态与 t.after。
- 移除上述降至 <=600 的 baseline 条目；同步准确的源码归属文档，不上调阈值。
- 验证：组合后 HTML、CSS 展开、迁移函数文本及 28 个粉丝测试名称保持；node --experimental-vm-modules --test 执行 admin-page-composition/frontend-usage-guide/frontend-admin-shell/toolbox-sidebar-routing/admin-style-ownership/frontend-admin-layout/frontend-desktop-update/frontend-typography/ui-surface/desktop-lyric-settings-runtime/database-initialization/database-maintenance/superchat-store/query-optimization/gift-wishes 及三组粉丝测试。

### B — Server Public and Admin Styles

- admin/styles.css → styles/{foundation,layout,data,streamer-detail,responsive}.css。
- song/styles.css → styles/{base,filters,request-controls,song-list,responsive,mobile-controls}.css；652 行的多行选择器作为完整规则迁移。
- gifts/styles.css → styles/{catalog-shell,catalog-cards,gift-detail,gift-previews,responsive,activity-controls}.css。
- site/styles.css → styles/{base,section-motion,catalog-consent,responsive}.css。
- 原入口顺序 @import，片段不超过 600 行；现有静态检查通过 helpers/read-stylesheet.cjs 读取按加载顺序展开的样式，全部原断言保留。
- 验证：与基线 CSS 展开顺序一致；node --require ./test/support/test-mode.cjs --test test/admin-surface-boundary.test.js test/public-song-page.test.js test/gift-url-state.test.js test/site-preferences.test.js test/public-surface.test.js；现有 admin/song/gift/public 浏览器覆盖。

### C — Server Streamer and Shared Game Styles

- streamer/manage.css → manage-styles/{shell-controls,content,responsive}.css。
- streamer/gift-workspace.css → gift-workspace-styles/{workspace,analytics,history,responsive}.css。
- games/styles.css → styles/{catalog-base,detail-shell,shell-responsive,gameplay-shell,catalog-layout}.css。
- 新游戏 CSS 逐项纳入精确 GAME_ASSET_PATHS 白名单；既有 404、Host 和版本 immutable 语义不变。
- 验证：基线展开内容相等；game-offline-contract/public-games-page/game-host/game-assets；既有 streamer/games 浏览器测试；新 CSS 通过正常 HTTP 路由返回。

### D — Server Detail DOM and Browser Scenarios

- catalog-view.js → catalog-detail.js 仅创建详情 DOM；导航 generation、请求、停预览与页面状态保留原控制器。
- public-homepage.spec.js 拆为原布局 + preferences/motion spec，共享 support/public-homepage.js；每 spec 保留 viewport 与每场景 context/timeout。
- admin-streamer-detail.spec.js 拆为生命周期 + presentation spec，共享 support/admin-streamer-detail.js。
- song-request-conditions.spec.js 拆为条件筛选 + song-request-copy.spec.js，共享 support/song-request-page.js。
- run-browser-tests.cjs 的领域组和 ci 组纳入全部新 spec；normative 的测试引用只更新覆盖路径，不改变行为规范。
- 验证：Playwright --list 前后标题/数量一致；移动后的完整 E2E 与礼物详情 E2E；受影响 Node 单测。

## Milestones

- [x] 第一轮：全面盘点 >=600 的 89 个文件和逐项决定。
- [x] 实施前方案复核：三位 Astra Max 检查 owner、immutable、CSS 完整规则、单层 include 与 E2E 枚举。
- [x] 并行完成 A/B/C/D，执行各组直接验证。
- [x] 第二轮：交叉审查任务增量、资源加载与顺序、状态拥有权、测试覆盖；修正发现。
- [x] 最终验证：客户端 verify:quick/test:offline 与必要受影响组；服务器 npm test/受影响浏览器；双方 git diff --check 和 status。

## Rollback and Failure Handling

初始源码副本、hash、inventory 与 git status 已保存系统临时目录。仅对任务自己的增量检查/回退，不用 HEAD 覆盖既有用户修改。失败先区分基线已存在问题，不弱化测试或修改无关行为。浏览器使用已有隔离服务器与独立端口/run ID，不操作用户实例。

## Done When

所有候选有理由；选定文件拆至 <800 且职责清晰；CSS/HTML 输出顺序和 JS 接口不变；E2E 场景与 runner 覆盖完整；第二轮审查与比例适当的验证完成；实际任务增量无生成数据/秘密、未经提交、用户原改动保留。

## Execution and Round Two Review Record

已完成三位 Astra Max 代理的第一轮分区盘点、并行实施，以及 A/B/C/D 的交叉第二轮审查。主代理复核任务基线差异、集成验证和资源清理。

### Final Outcomes

- 实际源码候选 46 份（客户端 18、服务器 28）；其余 43 份为规范、文档、数据或输出证据，均在前表记录保留理由。
- 拆分 16 个原文件：超过 800 行的 10 个，600–800 行的 6 个；所有选择拆分后的入口和片段均低于 600 行。
- 维护源码超过 800 行的文件从 13 个降至 3 个：客户端 0；服务器仅保留不可变历史游戏 v1/game.css、v2/fame-road.css、v2/treasure-house.css。
- 客户端 5 条文件大小登记删除；其余登记阈值与理由保持不变。
- 既有用户修改保留。任务期间外部并行修改的使用文档、usage-guide-shots 与图片资料未纳入本任务变更。

### Second-Round Findings and Corrections

1. 礼物详情拆分时 createBackLink 同时被加载页/错误页使用，最初漏导出与导入。已通过具名 export/import 修复，保留唯一 DOM 创建实现；8 项 gift-layout 浏览器用例全部通过。
2. 既有 browser-pages 测试夹具只允许单层 CSS，导致新子目录被 mock route 拒绝。仅为 styles、manage-styles、gift-workspace-styles 的单层 CSS 增加允许规则；未修改生产 Host/CSP/静态服务器。独立复核 21 个允许路径和 9 个拒绝路径。
3. 新 CSS 文件格式化移除片段末尾多余空行时，入口 import 之间保留相应分隔；7 组服务器展开结果仍与原快照逐字节相同。
4. 游戏公共 CSS 的所有 5 个新增资源均纳入精确白名单、404 边界、no-cache/ETag 和各游戏 shared/session/publication 压缩预算；46 份已版本化游戏文本未改动。
5. 详情模块 AST、旧 DOM 语句顺序、导入导出和模块图经独立审查；三组 E2E 的 61 个声明及动态展开的 88 个场景、外层循环、viewport、timeout、skip 和 context 清理保持。普通领域组和 CI 均完整登记新 spec。
6. 客户端 14 个迁移函数、旧公开导出、SQL/事务顺序、28 个粉丝测试主体与共享夹具保持；帮助页全部 1,410 个标签与非空白内容一致，章节无嵌套 include；CSS 原规则顺序保持。

### Verification Actually Run

- 客户端 npm run verify:quick：991 个 JS 语法检查、5 项文档治理和 22 项架构检查通过。
- 客户端 focused：161/161；npm run test:offline：2504/2504。
- 客户端最终 npm test：2740 项中 2736 通过、0 失败、4 项 NSIS 安装器环境测试跳过。
- 全套客户端首次运行因默认相邻服务器 HEAD 与 server-contract.lock.json 固定 revision 不同而阻断 8 个契约测试文件。使用已存在且校验通过的独立检出 5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577，通过本次进程环境 LIRA_SERVER_ROOT 指向它后，全套复跑得到上一条结果；未改版本锁和任何工作区 Git 状态。
- 服务器基线 npm test：1680/1680；最终 npm test -- --test-concurrency=4：1681/1681。默认并发的首次最终运行出现一次 song-page-title 文件级失败；独立 15/15 和完整受控并发重跑均通过，未修改该文件或相关业务。
- 服务器静态与直接相关测试：CSS 47/47；C 组 35/35（新增 constellation 预算覆盖后 4/4 重跑）；D 组 38/38（返回链接修复后直接相关 15/15 重跑）。
- 服务器浏览器：修复后的 18-spec 联合运行 205/205，独立 gift-layout 8/8，原离线游戏 35/35，共 248 个不同场景通过。联合运行含拆分后的全部 88 个 E2E 场景。
- 浏览器沿用现有 Playwright 环境、独立随机端口和 runId；任务创建的服务器均退出，端口释放，临时 Admin/Streamer/runtime 数据已清理，测试证据保存在系统临时目录。
- 最后对 14 个服务器 JS 文件按 Prettier 3.7.4 规范格式化；Babel AST 前后完全等价、14/14 语法检查及 88 场景标题清单保持，相关源文本和样式检查 60/60 重跑通过；未重复运行已经通过的浏览器全套。
- 双仓库 git diff --check 通过；任务自有 diff/status 与新增文件已审阅，未添加运行数据、秘密或提交。

### Split Entrypoints

| 仓库 / 原文件 | 原行数 | 最终入口行数 |
| --- | ---: | ---: |
| client / public/pages/admin/toolbox/usage-guide.html | 1438 | 70 |
| client / test/fan-profiles-ipc.test.js | 798 | 194 |
| client / public/css/admin/workspace/song.css | 768 | 2 |
| client / src/storage/database-migrations.js | 659 | 560 |
| client / public/css/overlays/desktop.css | 651 | 5 |
| server / public/admin/styles.css | 1611 | 8 |
| server / public/song/styles.css | 1513 | 11 |
| server / public/gifts/styles.css | 1508 | 9 |
| server / e2e/public-homepage.spec.js | 1271 | 346 |
| server / public/games/styles.css | 1186 | 9 |
| server / public/streamer/manage.css | 1077 | 5 |
| server / public/site/styles.css | 1011 | 7 |
| server / e2e/admin-streamer-detail.spec.js | 999 | 381 |
| server / public/streamer/gift-workspace.css | 988 | 7 |
| server / e2e/song-request-conditions.spec.js | 798 | 323 |
| server / public/gifts/catalog-view.js | 663 | 391 |
