# 客户端文档未完成事项

记录基线：2026-09-26；2026-09-28 从报告目录迁为当前未结项导航。范围为客户端与相关跨端验收，具体实施及验收状态见 [计划索引](README.md)。没有重新执行真实账号、生产或正式签名验收。

本文件只保留尚未闭环的工作，不记录完成项、历史核验流水或已排除的问题。后续建设、延期提案和验收材料分开列出；缺少验收记录不等于现有功能失效。条目编号沿用原审计，删除后不补号。

## A. 后续工程

### A1. 统一日志与诊断后续阶段

- 待做：统一日志分流与轮转、跨重启日预算、有限故障上下文、礼物管线汇总；客户端查看/导出、服务器诊断入口，以及经用户授权的问题摘要上传。
- 边界：按已接受设计继续分阶段实施，不将整体后续建设视为一处已复现的局部故障；原生 dump、外部探活仍是按需选项。
- 来源：[日志规格](../client-server-logging-design.md)、[ADR-0018](../../docs/architecture/adr/0018-unified-logging-and-diagnostics.md)、[容量报告](../../docs/reports/2026-09-14-log-volume-and-signal-report.md)。

### A2. Windows 签名及发布前身份验证

状态与剩余步骤只在 [签名接入计划](windows-code-signing.md) 维护；当前工具契约见 [签名参考](../../docs/reference/engineering/code-signing.md)。

### B8. 客户端资源自检的正式签名安装验收

- 待做：在正式签名安装包的隔离安装环境完成尚缺的实机验收，核对签名后的资源清单、实际安装资源与 AC01–AC15 的最终闭环证据。
- 前提：需要正式签名产物与经确认的发布配置；不把无签名隔离包验证替代正式签名安装验收，也不为验收执行发布。
- 来源：[资源完整性设计](../client-resource-integrity-design.md)、[实施计划](2026-09-26-client-resource-integrity.md)。

## B. 提案或明确延期的范围

### B1. 统计查询进一步优化与主线程预算验证

- 待做：测量 summary/top gifts/time buckets 的重复扫描及合成大数据下的主线程停顿，再确定必要的优化。
- 前提：仍属 proposal；只有优化后仍超预算，才考虑有界只读 worker，不无条件引入新执行架构。
- 来源：[查询与首次同步报告](../../docs/reports/2026-09-19-database-query-and-history-sync-plan.md) §3.1、§9.4。

### B2. 首次礼物历史恢复的确认/暂停与实时增量解耦

- 待做：确认开始/暂不同步、暂停/恢复、历史完整度与在线游标独立持久化、无缺口交接及旧版本回退保护。
- 前提：按提案确认新的用户流程与同步合同后实施，不能仅调整 `bootstrapHistory()`/`startEventStream()` 顺序。
- 来源：[同步报告](../../docs/reports/2026-09-19-database-query-and-history-sync-plan.md) §5、§9.1–9.2、[同步控制器](../../src/electron/remote-gift-controller.js)。

### B3. 历史恢复的服务器配套与规模验收

- 待做：协调历史传输预算、压缩、有界排队与客户端超时；复核完整性失效、列表/目录查询扩展性、Device 恢复的主线程成本和代理联调。
- 前提：依赖 B2 的共享合同；报告建议的限速及压缩参数不能直接当作部署配置。
- 来源：[同步报告](../../docs/reports/2026-09-19-database-query-and-history-sync-plan.md) §3.4、§6–9。

### B4. F07 弹幕共享源与 S04 protobuf 读取器

- 待做：恢复任务后确认 owner、源码分发与 content pin 决策，再实施共享源及依赖它的读取器。
- 前提：用户明确延期，不自动恢复，也不合并生命周期或渲染策略不同的实现。
- 来源：[复用计划](2026-09-21-client-server-reuse-modularity.md)、[ADR-0020](../../docs/architecture/adr/0020-shared-danmaku-source.md)。

### B5. 动态抽奖旧 M2–M4 增强范围

- 待做：若恢复旧范围，重新确认多奖项、领奖管理、独立控制/公示网页和多页 PNG 公示导出的需求与验收。
- 前提：最新简化范围优先；旧增强设计不自动成为本轮修复要求。
- 来源：[抽奖规格](../bilibili-dynamic-lottery_design.md)、[实施计划](2026-09-14-bilibili-dynamic-lottery.md)。

### B6. 粉丝档案第三阶段增强

- 待做：农历自动规则、外部 CSV/其他工具档案导入与字段映射、工作台日历联动。
- 前提：分别确认需求及验收，不从调研阶段表直接推导完整产品要求。
- 来源：[调研报告](../../docs/reports/2026-09-18-fan-profile-research-and-design.md)、[首发规格](../fan-profiles.md)。

### B7. 授权完整链路的真实 HTTP stub E2E

- 待做：需要恢复该延期范围时，补激活→challenge→verify→续期/撤销的真实 HTTP stub 联测。
- 前提：这是额外验证层，不是已证实的授权功能故障。
- 来源：[License P1 计划](2026-08-29-license-p1-hardening.md)、[现有链路测试](../../test/license/license-protocol-e2e.test.js)。

## C. 尚缺验收或操作材料

### C1. 投票/评分的真实直播间 C0 与端到端验收

- 待补：受控账号与主播归属、两名观众 UID 稳定性和区分、主播排除、原始事件 ID/时间精度、最终计数和冻结结果。
- 前提：需要受控真实直播间和观众，不代替用户发送弹幕。
- 来源：[互动规格](../games-poll-rating_design.md)、[实施计划](games-poll-rating.md)。

### C2. 云签到/运势的真实长时间运行验收

- 待补：关桌面、未开播、凭据异常、服务器重启、跨北京时间零点，以及确需迁移时的旧端停写/导入证据。
- 前提：真实服务器和受控账号；不能用模拟测试宣布真实全天运行通过。
- 来源：[云机器人计划](2026-09-18-cloud-daily-bots.md) E 阶段。

### C3. 动态抽奖的真实上游与受控账号验收

- 待补：真实评论/互动来源、关注核验、分页、风控、凭据过期及暂停恢复。
- 前提：受控账号与活动，不自行读取 Cookie 或探测真实活动。
- 来源：[抽奖规格](../bilibili-dynamic-lottery_design.md)关注检测说明及退出条件。

### C4. Windows 原生显示缩放验收

- 待补：Windows 系统 100% 和 125% 显示缩放下的实机证据；150% 为探索项。
- 前提：原生系统缩放，不能用 Electron zoom 或浏览器视口替代，也不擅自改变用户当前显示设置。
- 来源：[排版层级计划](2026-08-23-desktop-typography-hierarchy.md) Task 9。

### C6. 使用手册 D.2 的成功态与实操材料

2026-09-28 状态为 Needs Review：以下是原审查待补范围，需对照后续截图/手册修改逐项复核，不把历史缺项直接判为当前缺失。

- 待补本地材料：播放中的全屏/桌面歌词、礼物实际导出并保存、粉丝提醒处理、表格/备份恢复、作画/结算记录。允许隔离合成数据，需注明其性质并实际完成对应操作。
- 待补外部材料：受控抽奖名单与结果、B 站/音乐登录和直播连接、授权初始化/网络恢复/更新、AI 测试成功、真实云歌单同步、OBS 添加浏览器源。
- 边界：礼物导出截图环境的 `getGlobalSnapshot` 缺失只作为拍摄工具与材料的待核验事项，不认定为正式桌面导出缺陷。
- 来源：[使用文档补充方案](2026-09-22-usage-guide-supplement.md) D.2、[截图工具说明](../../scripts/usage-guide-shots/README.md)。

## D. 按触及范围维护的事项

### D1. 剩余兼容边界的渐进迁移

- 待做：触及相应 owner/consumer 时迁移 desktop/playback/shared 的 Admin 全局访问、AI/overtime 的域外 SQL 和登记的 empty-catch 债务；同步下调对应测试基线。
- 边界：维持事务、生命周期和兼容合同，不进行无需求的大重构。
- 来源：[Legacy Boundary Registry](../../docs/architecture/engineering/legacy-boundaries.md)、[架构测试](../../test/engineering/module-boundaries.test.js)。

### D2. 文件登记与长函数的后续复审

- 待做：按[唯一登记](../../docs/architecture/engineering/modularity-baseline.json)逐条遵守退出条件及复审日期；最早期限为 **2026-12-13**，粉丝档案相关期限为 **2026-12-18**，实质修改时提前复审。
- 长函数需重新测量，不能照搬历史跨度或以文件行数合规代替职责复核。
- 来源：[函数债务](../../docs/architecture/engineering/modularity-debt.md)、[规模门禁](../../test/engineering/modularity-size.test.js)。

### D3. B 站 API 参考资料的三处错误码缺口

- 待做：获得可信平台资料或受控观测证据后，补充管理接口两处、消息流接口一处的错误码与语义。
- 边界：不猜测错误码，不把参考资料不完整认定为客户端功能失效。
- 来源：[manage.md](../../docs/bilibili-live-api/manage.md)、[message_stream.md](../../docs/bilibili-live-api/message_stream.md)。

## E. 需要账号持有人确认

### E1. 历史 QQ 音乐/ChatGPT 会话失效或撤销证据

- 待补：账号持有人确认相关历史会话已失效，或提供全设备撤销/重新授权等闭环结果。
- 边界：不复制秘密、不探测会话、不代替用户撤销访问；文件删除不能证明历史副本已经失效。
- 来源：[资源/运行时/秘密审计计划](2026-09-25-resource-runtime-secret-audit.md)最后一项。

## 其他尚需核实的历史验收

- 歌词渲染硬件性能对比：[渲染计划](2026-08-18-desktop-lyric-rendering.md)。
- 歌单背景跨端上传/删除与错误流程：[背景计划](2026-08-28-song-page-background-upload.md)。
- 完整礼物投影的最大租户数据集性能：[投影计划](2026-09-01-gift-ledger-projection-sync.md)。
- 粉丝档案首发的两仓收尾证据：[档案计划](2026-09-18-fan-profiles.md)。旧门禁失败不是当前失败结论。
- 生产认证 SSE/完整恢复材料：[审计跟进](2026-09-25-audit-followup.md)。
- 暂停的产品修复与规则裁决：[暂停记录](2026-09-17-audit-remediation.md)。
