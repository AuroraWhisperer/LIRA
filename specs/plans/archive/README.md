# 历史证据与计划归档

本目录只保留仍被规格、ADR、报告或制作指南引用的实施证据，以及有复用价值的故障复盘和产品裁决。当前事实见[技术参考](../../../docs/reference/README.md)，未结事项见[计划索引](../README.md)及[台账](../open-items.md)。历史检查只证明记录时点和范围，旧命令不作为当前执行指令。

## 保留与清理

[弹幕交付与复用优化](2026-10-10-danmaku-delivery-efficiency.md)：2026-10-10 完成云弹幕按需订阅、展示通知复用与公共渲染核心固定源码快照。桌面 209 项定向检查、6 项浏览器/Electron 检查及最终定向复验通过；服务端 11 项渲染/静态检查和 4 项浏览器检查通过。保留闲置清理、配置缓存隔离及独立发布裁决；记录无关架构门禁失败，未部署或做实播性能基准。

[画布场景删除与空状态](2026-10-10-canvas-scene-deletion.md)：2026-10-10 支持删除初始及当前输出场景、自动切换已保存输出、连续删空并保留固定地址；明确「当前输出」标记。435 项相关测试及后续定向复验通过；保留迁移、删除回滚、空状态与并发确认裁决，另记录共享工作区的无关门禁失败。

[弹幕渐隐边选择](2026-10-10-danmaku-fade-edge.md)：2026-10-10 为全部固定弹幕增加上边/下边渐隐选项，兼容旧单端配置；保留两仓参数、协议、保存重读和隔离 Electron/浏览器证据。正式来源需同步发布服务端，本次未部署。

[粉丝日期日历与黑名单](2026-10-09-fan-calendar-blacklist.md)：2026-10-09 完成目标日前三天的日期日历、问号说明和可恢复黑名单。保留所有档案入口屏蔽、旧备份恢复隔离和 Electron 验证证据；未提交或部署。

[陪伴天数共享接口与日历纪念日](2026-10-09-guard-accompany.md)：2026-10-09 完成平台观察入档、上舰识别/名单补全共用接口和 100/365/500/1000 天默认纪念日；保留跨端去重、隔离 Electron 与文档检查限制的验收记录。未提交或部署。

2026-10-09 清理了 310 份已版本化的重复实施步骤、旧样式调整及发布验证计划；三份已补齐验证的活动计划压缩为下方摘要。仍有未结验收、暂停或延期决定的活动计划保留准确状态，未进行真实账号、生产或实播操作。

保留规则见 [PLANS.md](../../../PLANS.md#locations-and-lifecycle)。今后结束任务时先将有效要求、现状和剩余工作写入各自归属，再决定是否保留过程文档；归档不是永久保留每次执行步骤的要求。清理前确认文件已进入 Git、无未提交改动，更新引用；无须再复制一份长正文或删除清单。

## 2026-10-09 补齐的历史验收

复核的是已完成的 v5.2.1 验证，发布提交为 `1f32b5ccb9edec2ab67b7b9bf6056b58107f5e76`。`tmp/release-5.2.1/verify-final.log` 记录 `npm run verify` 通过，锁定服务器 `01fb2b47d5e081f5dd559933991ade4819eb3428` 的 10 个契约夹具通过；`tmp/test-results/run-ugScCl/results.json` 标记 `scope: full`、`complete: true`，542 文件共 4,036 项通过，失败、取消、跳过均为 0。已逐一核对下表文件在该次全量中的结果，部分原失败文件同时与发布输入 SHA-256 一致。这是后续历史证据核销，不代表本次文档整理重跑了产品全套测试，也不扩大为实播或生产验收。

| 原计划 | 原剩余条件与关闭依据 |
| --- | --- |
| `2026-10-08-module-responsibilities.md` | 原剩固定样式枚举、CSS 清单与完整门禁；后续全量含 `admin-danmaku-markup` 2/2、`danmaku-style-ownership` 1/1 和全部锁定契约，所列阻塞已消除。原六项职责及定向回归结果留在 Git。 |
| `2026-10-07-client-test-suite-remediation.md` | 原剩 browser 组 suite-clock、样式库及 contracts；后续全量中的 `canvas-component-suites` 7/7（包含 adding a suite clock）、`component-style-library` 9/9 通过，契约组已纳入；原并发条件的修复另见[并发稳定性记录](2026-10-08-concurrent-test-stability.md)。 |
| `2026-10-06-woodland-frame-avatar.md` | 原实现、54 项回归和隔离展示已通过，仅欠锁定服务器契约门禁；后续相同 revision 的 10 个夹具全部通过。原素材、头像和隔离展示证据留在 Git，不推断正式安装器或实播验收。 |

上述日志是本机临时证据，可能被后续清理；本段保留本次已核实的范围、结果和限制。原文及已删除归档可按固定提交查询：

```sh
git show 1f32b5ccb9edec2ab67b7b9bf6056b58107f5e76:specs/plans/2026-10-08-module-responsibilities.md
git ls-tree -r --name-only 1f32b5ccb9edec2ab67b7b9bf6056b58107f5e76 specs/plans/archive
git show 1f32b5ccb9edec2ab67b7b9bf6056b58107f5e76:specs/plans/archive/2026-09-19-release-4.2.9-validation.md
```

## 保留文件

- [使用文档八章迁移](2026-10-09-usage-guide-chapters.md)：2026-10-09 正文迁移、原图片与锚点保留、媒体布局及隔离 Electron 验证的决策和证据。

每项均说明保留原因；涉及现状时仍以相应 owner 为准。

| 记录 | 保留原因 |
| --- | --- |
| [2026-10-09-danmaku-edge-fade](2026-10-09-danmaku-edge-fade.md) | 固定弹幕边缘参数的跨端保存契约、柔彩双端默认与旧样式兼容决策，以及隔离 Electron / 浏览器验证证据 |
| [2026-10-09-heart-box-progress](2026-10-09-heart-box-progress.md) | 心动盲盒城堡进度的计数规则、手动剩余数解释，以及设置/画布同步和隔离 Electron 验收证据 |
| [2026-10-09-blindbox-component-controls](2026-10-09-blindbox-component-controls.md) | 冲刺与盲盒独立组件标签、全部外观参数共享、720px 与至少 30px 字号，以及隔离桌面和投屏验收证据 |
| [2026-10-09-installation-lifecycle-audit](2026-10-09-installation-lifecycle-audit.md) | 安装/卸载进程误判、异常退出及备份目录链接修复；4,052 项全量检查和隔离完整安装、升级、启动、卸载证据 |
| [2026-10-09-installer-startup-recovery](2026-10-09-installer-startup-recovery.md) | 缺依赖启动失败导致后台残留及安装阻塞的复现、原生退出回归、本机恢复与修复包验证证据 |
| [2026-10-09-packaged-dependencies](2026-10-09-packaged-dependencies.md) | 本轮进行期间其他任务新增的完成记录，保留原文 |
| [2026-10-09-ai-assistant-persona-tools](2026-10-09-ai-assistant-persona-tools.md) | 被 docs/reports/2026-10-09-ai-assistant-personas-and-tools.md 引用；被 specs/ai-assistant-persona-tools.md 引用 |
| [2026-10-08-release-journal-retry](2026-10-08-release-journal-retry.md) | Windows 原生查询与 Node 崩溃排查、复现和最终验证证据 |
| [2026-10-08-concurrent-test-stability](2026-10-08-concurrent-test-stability.md) | 后续关闭旧验证阻塞所需的原范围并发验收证据 |
| [2026-10-08-client-ux-decisions](2026-10-08-client-ux-decisions.md) | 保留四项尚未接受实施的产品讨论和已裁决行为 |
| [2026-10-08-canvas-concurrent-add](2026-10-08-canvas-concurrent-add.md) | 并发新增与 Windows 文件锁的可复用复现及数据安全依据 |
| [2026-10-07-code-document-alignment](2026-10-07-code-document-alignment.md) | 被 docs/reports/2026-10-07-code-document-alignment.md 引用 |
| [2026-10-05-text-box](2026-10-05-text-box.md) | 被 specs/component-scenes.md 引用 |
| [2026-10-05-scene-live-updates](2026-10-05-scene-live-updates.md) | 被 docs/architecture/adr/0022-local-component-scenes.md 引用 |
| [2026-10-05-remove-satin-ribbon](2026-10-05-remove-satin-ribbon.md) | 被 specs/gift-effects-frame-overlay_design.md 引用 |
| [2026-10-05-opening-moonlit-fan](2026-10-05-opening-moonlit-fan.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-opening-moonlit-fan-revision](2026-10-05-opening-moonlit-fan-revision.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-moonlit-background](2026-10-05-moonlit-background.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-moonlit-background-motion](2026-10-05-moonlit-background-motion.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-gift-wish-moonlit](2026-10-05-gift-wish-moonlit.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-danmaku-moonlit](2026-10-05-danmaku-moonlit.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-component-suites](2026-10-05-component-suites.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-05-clock-moon-palettes](2026-10-05-clock-moon-palettes.md) | 被 docs/guides/overlay-suites/sources-and-history.md 引用 |
| [2026-10-04-gift-frame-satin-ribbon](2026-10-04-gift-frame-satin-ribbon.md) | 被 specs/gift-effects-frame-overlay_design.md 引用 |
| [2026-10-03-woodland-effect-one](2026-10-03-woodland-effect-one.md) | 被 specs/gift-effects-frame-overlay_design.md 引用 |
| [2026-10-03-client-round-two-fixes](2026-10-03-client-round-two-fixes.md) | 被 docs/reports/2026-10-03-client-round-two-optimization-review.md 引用 |
| [2026-10-01-component-output-size](2026-10-01-component-output-size.md) | 被 specs/component-scenes.md 引用 |
| [2026-09-30-component-workspace](2026-09-30-component-workspace.md) | 被 specs/component-workspace.md 引用；被 specs/component-scenes.md 引用 |
| [2026-09-30-browser-component-preview](2026-09-30-browser-component-preview.md) | 被 specs/component-workspace.md 引用 |
| [2026-09-28-documentation-consolidation](2026-09-28-documentation-consolidation.md) | 被 specs/plans/README.md 引用 |
| [2026-09-26-fan-profile-archive-recovery](2026-09-26-fan-profile-archive-recovery.md) | 归档/恢复数据保留和竞态的隔离桌面验收证据 |
| [2026-09-21-test-suite-maintenance](2026-09-21-test-suite-maintenance.md) | 被 docs/reports/2026-09-26-client-documentation-open-items.md 引用 |
| [2026-09-19-query-optimization](2026-09-19-query-optimization.md) | 被 docs/reports/2026-09-19-database-query-and-history-sync-plan.md 引用 |
| [2026-09-18-overlay-access-isolation](2026-09-18-overlay-access-isolation.md) | 保留记录 2026-09-18-current-review-remediation.md 的证据依赖 |
| [2026-09-18-overlay-access-decision](2026-09-18-overlay-access-decision.md) | 展示能力与交互权限的已接受兼容裁决 |
| [2026-09-18-live-gift-display-export](2026-09-18-live-gift-display-export.md) | 被 docs/reports/2026-09-15-live-gift-display-and-export-research.md 引用 |
| [2026-09-18-fan-guard-roster](2026-09-18-fan-guard-roster.md) | 被 specs/fan-profiles.md 引用 |
| [2026-09-18-daily-bots-direct-start](2026-09-18-daily-bots-direct-start.md) | 被 docs/reports/2026-09-26-client-documentation-open-items.md 引用 |
| [2026-09-18-current-review-remediation](2026-09-18-current-review-remediation.md) | 被 docs/reports/2026-09-26-client-documentation-open-items.md 引用 |
| [2026-09-17-audit-confirmed-boundaries](2026-09-17-audit-confirmed-boundaries.md) | 计价/密钥目标绑定与流错误建议的接受和拒绝边界 |
| [2026-09-16-pinned-server-contract-ci](2026-09-16-pinned-server-contract-ci.md) | 被 docs/reports/2026-09-16-client-server-architecture-audit.md 引用 |
| [2026-09-16-client-server-audit-fixes](2026-09-16-client-server-audit-fixes.md) | 被 docs/reports/2026-09-16-client-server-architecture-audit.md 引用 |
| [2026-09-14-toast-fixes](2026-09-14-toast-fixes.md) | 被 docs/reports/2026-09-14-toast-review.md 引用 |
| [2026-09-14-log-volume-phase-a1](2026-09-14-log-volume-phase-a1.md) | 被 docs/reports/2026-09-14-log-volume-and-signal-report.md 引用 |
| [2026-09-13-song-import-update](2026-09-13-song-import-update.md) | 现行规格或审查报告的实施证据引用 |
| [2026-09-13-frontend-queue-test-ownership](2026-09-13-frontend-queue-test-ownership.md) | 现行规格或审查报告的实施证据引用 |
| [2026-09-10-project-review-fixes](2026-09-10-project-review-fixes.md) | 被 docs/reports/2026-09-10-project-review-and-fixes.md 引用 |
| [2026-09-07-persistent-desktop-user-data](2026-09-07-persistent-desktop-user-data.md) | 被 docs/architecture/adr/0013-persistent-desktop-user-data.md 引用 |
| [2026-08-21-startup-performance-hardening](2026-08-21-startup-performance-hardening.md) | 被 docs/reports/2026-08-21-startup-performance-evaluation.md 引用 |
| [2026-08-20-song-board-style-6-layout-tuning](2026-08-20-song-board-style-6-layout-tuning.md) | 版本记录 UPDATE.md 直接引用的原始布局记录 |
| [2026-08-20-song-board-style-3-layout-tuning](2026-08-20-song-board-style-3-layout-tuning.md) | 版本记录 UPDATE.md 直接引用的原始布局记录 |
| [2026-08-18-first-run-onboarding](2026-08-18-first-run-onboarding.md) | 被 docs/architecture/adr/0009-first-run-onboarding.md 引用 |
| [2026-08-17-existing-code-governance-remediation](2026-08-17-existing-code-governance-remediation.md) | 被 docs/reports/2026-09-26-client-documentation-open-items.md 引用 |
