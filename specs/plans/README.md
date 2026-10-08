# 实施计划与未结项

本目录只保留仍需实施、复核、补验收或明确延期的计划。状态描述当前剩余工作；计划中的历史命令与旧复选框不代表当前缺陷，也不自动授权恢复暂停、部署或账号操作。需求及验收条件仍由 [规格索引](../README.md) 和 Accepted ADR 决定。

跨主题事项见 [未结项台账](open-items.md)；已完成或被替代的过程记录见 [归档索引](archive/README.md)。新计划按 [PLANS.md](../../PLANS.md) 编写，不再放入 docs。

## 当前计划

| 计划 | 状态 | 尚需处理 |
| --- | --- | --- |
| [2026-10-08-danmaku-prismatic](2026-10-08-danmaku-prismatic.md) | Awaiting Verification | 主题、身份投影及隔离检查已完成；剩真实报文/实播验收及客户端契约版本锁核验。 |
| [2026-10-08-module-responsibilities](2026-10-08-module-responsibilities.md) | Awaiting Verification | 六项实现及相关回归、语法、架构、文档检查通过；全量待并发弹幕样式的两项断言更新后补验。 |
| [2026-10-07-client-test-suite-remediation](2026-10-07-client-test-suite-remediation.md) | Awaiting Verification | P0–P3 已落实（547→518 文件，offline 无新增失败）；剩 browser 组并发下 suite-clock 超时待查与 contracts 组未运行。 |
| [2026-10-06-woodland-frame-avatar](2026-10-06-woodland-frame-avatar.md) | Awaiting Verification | 宽边、头像及铭牌已实现；54 项测试与隔离展示检查通过。仅契约门禁因服务器检出版本与锁定版本不一致待补验。 |
| [2026-10-02-client-themes](2026-10-02-client-themes.md) | Awaiting Verification | 实现、自动化与隔离 Electron 验证完成；原生 100% 缩放及实播/真实密集内容人工验收未覆盖。 |
| [2026-08-18-desktop-lyric-rendering](2026-08-18-desktop-lyric-rendering.md) | Awaiting Verification | 实现与自动化已有记录；剩余硬件加速开/关下 Paint、主线程和帧率对比，没有真实 Electron 性能录制证据。 |
| [2026-08-23-desktop-typography-hierarchy](2026-08-23-desktop-typography-hierarchy.md) | Awaiting Verification | 剩余 Windows 原生 100%/125% 显示缩放实机验收；不能用窗口缩放替代。 |
| [2026-08-28-song-page-background-upload](2026-08-28-song-page-background-upload.md) | Needs Review | 客户端背景桥已存在；原计划五项跨端上传/删除/失败与预览联调未记录结果。先核对当前图片契约并补证，不重新实施已存在的上传功能。 |
| [2026-08-29-license-p1-hardening](2026-08-29-license-p1-hardening.md) | Deferred | 实现和自动化已有历史记录；真实 HTTP stub E2E 为延期验证，原手工离线续期、配对及同步确认仍未补齐证据。 |
| [2026-09-01-gift-ledger-projection-sync](2026-09-01-gift-ledger-projection-sync.md) | Awaiting Verification | 完整投影实现由规格索引标记 Implemented；原计划要求的最大租户脱敏数据集性能证据未提供，本次不把源码测试当作该发布验收。 |
| [2026-09-14-bilibili-dynamic-lottery](2026-09-14-bilibili-dynamic-lottery.md) | Draft | 简化客户端流程已有实现；真实上游/受控账号验收待补，旧 M2–M4 增强须重新确认，不按原任务列表自动恢复。 |
| [2026-09-17-audit-remediation](2026-09-17-audit-remediation.md) | Paused | 保留用户暂停产品修复及规则/兼容裁决的决定；本次仅整理文档，不恢复任何暂停项。 |
| [2026-09-18-cloud-daily-bots](2026-09-18-cloud-daily-bots.md) | Awaiting Verification | 实现与自动化已有记录；E 阶段真实关桌面、服务器重启、跨日及需要时的旧库停写/导入证据待补。 |
| [2026-09-18-fan-profiles](2026-09-18-fan-profiles.md) | Needs Review | 首发功能和隔离桌面验收已有记录；需复核两仓收尾门禁及部署材料。原文所列并行门禁失败是当时结果，本次未证明其仍存在，也未把规格升级为 Implemented。 |
| [2026-09-21-client-server-reuse-modularity](2026-09-21-client-server-reuse-modularity.md) | Deferred | 18 项已有完成记录；F07 及依赖它的 S04 按用户决定延期，不能记为已实施。 |
| [2026-09-22-usage-guide-supplement](2026-09-22-usage-guide-supplement.md) | Needs Review | 现有手册与截图素材需按当前工作区复核；原 D.2 是历史待补清单，不直接推定全部仍缺失。 |
| [2026-09-25-audit-followup](2026-09-25-audit-followup.md) | Awaiting Evidence | 代码及隔离检查已有记录；生产认证 SSE 持续交付、完整恢复与独立备份材料仍缺证据。 |
| [2026-09-25-resource-runtime-secret-audit](2026-09-25-resource-runtime-secret-audit.md) | Blocked | 资源与生产运行时审计已有记录；仅剩历史会话失效/撤销的持有人确认，不探测会话或复制秘密。 |
| [2026-09-26-client-resource-integrity](2026-09-26-client-resource-integrity.md) | Awaiting Verification | 实现和自动化已有记录；正式签名安装包验收尚未完成，依赖签名接入。 |
| [games-poll-rating](games-poll-rating.md) | Awaiting Verification | 功能代码和隔离界面验证已有记录；C0 真实直播间 UID/时间/计数及端到端验收待补。 |
| [windows-code-signing](windows-code-signing.md) | Blocked | 等待发布者、证书来源与执行策略确认。 |

本轮文档整理的阶段结果与验证见 [完成记录](archive/2026-09-28-documentation-consolidation.md)。

## 状态说明

- `Draft`：目标或范围仍需确认。
- `In Progress`：当前实施尚未完成。
- `Needs Review`：已有实现或材料，旧状态不足以证明剩余工作，先复核。
- `Awaiting Verification` / `Awaiting Evidence`：实现或检查已有记录，仍缺指定验收或外部材料。
- `Deferred` / `Paused`：保留明确延期或暂停决定，不自动恢复。
- `Blocked`：依赖明确输入或前置交付；文档整理不等于获得操作授权。

`Completed` 与 `Superseded` 计划进入 archive。归档保留原结果及限制，不补写未实际执行的测试，也不将历史代码路径当作当前实现。
