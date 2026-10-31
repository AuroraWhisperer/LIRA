# 双仓审计问题修复计划

Status: Completed

## Goal

按用户2026-10-31授权，先纠正审计文档的范围、分级和历史/当前状态，再并行修复F-001—F-044；同步已确认的文档与测试漂移，对待验证项给出证据裁定。每项以对应缺陷消失、正常行为和反例仍受保护为完成条件。

## Current Behavior

修复前见[原审计报告](../../../docs/reports/2026-10-29-full-stack-audit.md)。独立复核找到一份现役测试输入漏纳，未找到可撤销的F类误报；六项隔离诊断重新复现。原收尾凭证是修复前快照，不覆盖本次修复。当前44项源码修复与针对性验证完成，新收尾证据位于 `tmp/audit-remediation-2026-10-31/`；本计划归档保留逐项证据及依赖安装边界。

## Ownership And Compatibility

- Server分区：服务器全部F项及所属规范/测试；依赖在隔离候选目录更新验证，不重装正在使用的工作目录依赖。
- Client runtime分区：客户端后台、存储、Electron及播放链；对应backend/desktop/playback参考由该分区同步。
- Client UI分区：管理页、场景显示、外观和世界时钟；`docs/reference/frontend/app.md`、`overlays.md`由该分区统一维护。
- Root分区：审计文档与计划、客户端F-016/F-029、F-038—040、已确认指南漂移、最终整合；共享文件需先协调再修改。
- 保留现有未提交修改、账号/租户隔离、safeStorage、无凭据子框架、来源权限、存储格式与正常交互。F-009按原有发送owner增加兼容的可选会话断言，旧调用省略时保留手动发送合同；该断言不替代授权。F-031在现有场景显示投影中补充已授权房间的四字段公开房主资料，保持子页无凭据。其余HTTP/WS/IPC合同保持。仅在现有owner修根因，不增加框架、服务或无关抽象。
- 不提交、建分支、部署、发布，不使用用户数据或真实账号，不控制用户正在运行的应用；临时证据均在两仓根tmp。

## Milestones

- [x] 纠正报告当前状态及F-011/F-013分级，补读遗漏manifest；原3553清单与收尾凭证冻结。
- [x] Server：F-001、F-011、F-014、F-021服务器部分、F-022、F-024、F-037、F-042服务器部分。
- [x] Client runtime：F-002、F-003、F-004、F-005、F-006、F-007、F-008、F-009、F-010、F-012、F-013、F-015、F-017、F-018、F-019、F-025。
- [x] Client UI：F-020、F-021客户端部分、F-023、F-026、F-027、F-028、F-030、F-031、F-032、F-033、F-034、F-035、F-036、F-041、F-042客户端部分、F-043、F-044。
- [x] Root：F-016、F-029、F-038、F-039、F-040及遗漏manifest消费测试。
- [x] D类：同步已确认的D-002/003/004/009/010/011/012/014漂移；D-005按明确现行规范统一两端并保留未采样上游边界，D-006修稳定等待并在同批并发复验，D-007现版复验，D-008并入F-036；D-013实际追加/重建观察后裁定无已证实产品缺陷；D-001其余公告未扩成无依据产品修复。
- [x] 汇总每项实际证据，运行影响面所需的文档、语法、架构及针对性回归，完成差异审阅；具体输出及最终文件摘要见新凭证。

## Proposed Changes And Verification

各F项精确owner、调用链及最小修复方向在原报告对应条目，执行前重新核对当前代码与适用AGENTS。各分区只改自身owner和直接测试，不以旧审计代替现行要求。修改和运行分批完成，同一测试运行期间不改它的输入。

- 在既有对应测试文件增加非显然回归：失败注入、乱序回包、撤销/换账号、损坏导入、正常与边界对照。具体运行命令与结果按分区登记在 `tmp/audit-remediation-2026-10-31/<partition>/`，合并至本计划完成记录。
- 客户端使用已安装Node24：`node --experimental-vm-modules --test <affected-test-files>`；遗漏manifest用 `node --test --test-name-pattern="documented background manifest" test/scenes/component-styles.test.js`。
- 服务器使用 `D:/Work/lira-server/runtime/node/node.exe`，选择测试前核对test-mode与隔离环境；现有verify入口先同范围`--plan`再执行，不运行全量作为默认。
- 客户端文档 `npm run verify:docs`；服务器文档 `npm run docs:check`。生命周期/授权/存储按消费者增加相关回归和现有架构门禁，不擅自放宽断言。
- 最终两仓 `git diff --check`、`git status --short`，对照修复前快照检查仅任务相关差异；真实外部运行未验收时明确说明。

## Failure Handling

失败时定位本条根因，保留失败输出并先用聚焦检查验证修正。不重置仓库、不覆盖既有修改、不改旧凭证为通过；撤回仅限本任务明确新增的差异。无法由现行合同确定目标时记录具体冲突，先继续独立修复。

## Done When

44项全部有当前修复和与风险相称的验证；D类有同步/裁定及明确剩余边界；补充覆盖可追溯；正式文档与实现一致；任务差异通过复核。部署、真实平台/设备验收不在本次授权范围，不能在报告中冒称完成。

## Progress And Evidence

2026-10-31实施起点：先纠正审计说明，再开始并行修复；当时未完成状态保留至实际验证，不用部分通过关闭整个Goal。

- Root首批：开播媒体文件/名称与主题预设使用同一设置事务；失败注入验证回滚、保留原媒体URL且不广播。互动外观重置保留已保存基准；截图筛选不恢复暂缓镜头，补图失败会回收监听。7个现有/新增聚焦测试文件25/25通过，日志 `tmp/audit-remediation-2026-10-31/root/group-one-tests.log`。首次测试的Windows清理顺序错误已修正；失败不计为通过，重跑全部25项成功。
- 遗漏manifest消费测试1/1通过，摘要与消费说明位于 `tmp/audit-remediation-2026-10-31/supplemental-background-manifest.json`。
- D-005两端以服务器现行明确规范为准：只排除显式 `option.source=2`，不以顶层source回填缺失选项；相应parser边界由两端同步。D-009已按启动失败实现校正文档清理顺序，D-014已将弹幕外观归为按账号保存在本机并使用“保存外观”步骤。

## Final Verification And Limits

- 客户端最终语法：1,686文件通过；最后恢复点补丁后仅重验2文件、复用1,684份同摘要证明。架构29/29通过。文档10/10通过，归档和链接更新后再运行同门禁；最终状态以 `root/final-docs.log` 与 `gates.json` 为准。
- Server隔离候选：17份Node文件190/190；8份浏览器文件144/144，另3份说明/焦点消费者22/22。候选源码与原树2,534项摘要一致，未借候选旧源码冒充当前修复。其Node批次包含 `npm run docs:check` 的全部5份实际门禁文件。
- Client runtime最终批次57/57、55/55、恢复点15/15、第三批156/156、补充45/45、Chromium发送15/15；UI最终124/124、73/73及17/17。它们是批次执行数，存在重叠，不能叠加为唯一用例总数。
- 新增/扩展测试复用所属suite，保留正确的正常和反例断言。RSS、事务、恢复、授权代次、播放请求、规范化导入与UI竞态的事实参考已同步；API补充可选sendSession及场景房主投影。用户指南同步自动发送终止与本机外观保存步骤；其余修复恢复既有语义，无新增用户操作，因此未机械改动无关指南。
- F-001仅源码/锁文件与隔离候选已修复；原Server安装树仍为body-parser2.3.0，未重装依赖、部署或重启用户服务。安全安装和部署后的真实环境验收不属于本次源码修复完成声明。
- 全部运行仅使用合成数据、自有Node/Chromium/Electron进程和隔离tmp目录；未访问用户数据库、私人上游账号或真实音频设备，未执行平台发送或直播软件实播。D-013结论不推广为全样式动画认证，F-044两城修正不代表人工认证全部6,442城市。
- 基线HEAD：Client `7caf830e66d913f615a6cca5d63718db65c668ab`，Server `87f1c0de95f6b3096b79307923b43e436311742e`，加原有未提交工作树。最终两仓diff检查和状态保存在新凭证；没有提交、分支、打包、发布或部署。

## Finding Completion Ledger

每行的全部分区均已修复并通过所属针对性验证。具体关键断言、命令、日志和失败过程保存在 `tmp/audit-remediation-2026-10-31/<分区>/remediation-summary.json`；F-021/F-042双端分别验证。F-001保留上述安装环境边界。

| 条目 | 已验证分区 | 实现owner |
| --- | --- | --- |
| F-001 | server | `package.json`、`package-lock.json`、`test/body-parser-compression.test.js` |
| F-002 | runtime | `src/ai/tools/web-search-tool.js` |
| F-003 | runtime | `public/js/playback/features/native-output.js` |
| F-004 | runtime | `src/overtime/overtime-service.js`、`src/storage/overtime-store.js` |
| F-005 | runtime | `src/electron/desktop-readiness-controller.js` |
| F-006 | runtime | `src/scenes/cloud-display-buffer.js` |
| F-007 | runtime | `src/fans/profile-transfer.js` |
| F-008 | runtime | `src/fans/profile-transfer.js` |
| F-009 | runtime | `public/js/admin/danmaku-tool.js`、`src/bilibili/danmaku/sender-service.js`、`src/server/bilibili-runtime.js`、`src/server/routes/bilibili-routes.js` |
| F-010 | runtime | `src/music/providers/netease-provider.js` |
| F-011 | server | `public/streamer/manage.js`、`e2e/song-page-appearance.spec.js` |
| F-012 | runtime | `public/js/playback/features/playback-controls.js` |
| F-013 | runtime | `public/js/playback/services/wesing-service.js` |
| F-014 | server | `public/admin/app.js`、`test/admin-live-state.test.js` |
| F-015 | runtime | `src/bilibili/parsers/danmaku-parser.js`、`src/bilibili/utils/user-meta-extractor.js` |
| F-016 | root | `src/server/opening-service.js`、`src/storage/theme-store.js` |
| F-017 | runtime | `src/electron/local-media-access.js` |
| F-018 | runtime | `src/shared/xlsx-codec.js`、`src/music/song-file-codec.js` |
| F-019 | runtime | `src/storage/settings-store.js` |
| F-020 | ui | `public/js/admin/fans/index.js` |
| F-021 | ui + server | `public/js/shared/select-menu.js`、`public/shared/select-menu.js`、`e2e/select-menu.spec.js` |
| F-022 | server | `public/overlay/danmaku-twitter.js`、`e2e/overlay-added-styles.spec.js` |
| F-023 | ui | `public/js/admin/ai-assistant-settings.js` |
| F-024 | server | `public/site/site.js`、`e2e/public-homepage-preferences.spec.js` |
| F-025 | runtime | `src/server/admin-launcher.js` |
| F-026 | ui | `public/js/admin/overtime-rule-editor.js`、`public/js/admin/overtime.js` |
| F-027 | ui | `public/js/admin/danmaku-overlay-settings.js` |
| F-028 | ui | `public/js/admin/desktop-lyric.js` |
| F-029 | root | `public/js/admin/interaction-appearance.js` |
| F-030 | ui | `public/js/admin/settings-blindbox.js` |
| F-031 | ui | `src/server.js`、`src/server/scene-runtime.js`、`public/js/overlays/scene-danmaku-display.js`、`public/js/overlays/danmaku.js`、`public/js/overlays/danmaku-twitter-profile.js` |
| F-032 | ui | `public/js/admin/overtime-rule-effect-editor.js`、`public/js/admin/overtime-rule-model.js`、`public/js/admin/overtime-time-view.js` |
| F-033 | ui | `public/js/admin/song-request-user-blacklist.js` |
| F-034 | ui | `public/js/admin/song-request-blacklist.js` |
| F-035 | ui | `public/js/admin/text-box-media.js`、`public/js/admin/text-box-preview.js`、`public/js/admin/text-box.js` |
| F-036 | ui | `public/js/admin/overtime-rule-effect-editor.js` |
| F-037 | server | `src/modules/gifts/gift-variant-catalog.js`、`test/gift-variant-catalog.test.js` |
| F-038 | root | `scripts/usage-guide-shots/capture.cjs` |
| F-039 | root | `scripts/usage-guide-shots/web-supplement.cjs` |
| F-040 | root | `scripts/verify-gift-history.cjs` |
| F-041 | ui | `public/js/overlays/component-media.js` |
| F-042 | ui + server | `public/css/overlays/danmaku/bubble.css`、`public/overlay/styles/bubble.css`、`e2e/overlay-style-options.spec.js` |
| F-043 | ui | `public/js/overlays/opening.js` |
| F-044 | ui | `scripts/generate-world-clock-cities.js`、`public/js/admin/world-clock/city-catalog.js` |
