# 实施计划与未结项

本目录只保留仍需实施、复核、补验收或明确延期的计划。状态描述当前剩余工作；计划中的历史命令与旧复选框不代表当前缺陷，也不自动授权恢复暂停、部署或账号操作。需求及验收条件仍由 [规格索引](../README.md) 和 Accepted ADR 决定。

跨主题事项见 [未结项台账](open-items.md)；仍有保留价值的历史证据及完成摘要见 [归档索引](archive/README.md)。新计划按 [PLANS.md](../../PLANS.md) 编写，不再放入 docs。

## 当前计划

| 计划 | 状态 | 尚需处理 |
| --- | --- | --- |
| [2026-10-25-ai-subscription-kimi](2026-10-25-ai-subscription-kimi.md) | Awaiting Verification | Kimi API、ChatGPT 订阅与 API 共存、加密凭据和界面已实现；359 项相关回归、桌面夹具、语法/架构/文档检查通过。真实账号授权与模型回复待验，未构建安装包。 |
| [2026-10-25-danmaku-twitter](2026-10-25-danmaku-twitter.md) | Awaiting Verification | 正式实施、公开礼物／SC 数据、精确房主资料能力、四类卡片与 SVG、注册预览、文档及合成播放已完成；203 项聚焦测试和语法／文档门禁通过。真实 B 站上游、OBS／哔哩哔哩直播姬及远程服务器验收待补。 |
| [2026-10-20-native-playback-outputs](2026-10-20-native-playback-outputs.md) | Awaiting Verification | 实际接口/设备及 ASIO 驱动选择已接入；本机 9 个 Windows 输出、后台时钟及播放操作通过。本机 ASIO 驱动启动失败，外接声卡/硬件回送与听感待实机，安装包未更新。 |
| [2026-10-20-audio-device-inputs](2026-10-20-audio-device-inputs.md) | Awaiting Verification | 已补齐 Windows 录音/回送输入、声道映射、格式适配和独立设备模式；原生及聚焦回归、隔离 Electron 已通过。外接声卡线路/硬件回送、听感、热拔插与直播软件实播待验，安装包未更新。 |
| [2026-10-18-audio-assistant-isolation-diagnostics](2026-10-18-audio-assistant-isolation-diagnostics.md) | Awaiting Evidence | 已收到 Win10 + ROUTIST 的 v5 报告：枚举、静音及路由读回通过，播放器实际迁移未通过，停止恢复成功。待确认网易云默认/非独占输出后复测及实际播放验收；此前验证和安装版状态见计划。 |
| [2026-10-18-audio-assistant-win10](2026-10-18-audio-assistant-win10.md) | Awaiting Verification | 已将实时采集下限修正为 Win10 2004，同步提示和说明；原生构建/回归与前端及指南 21 项通过。Win10 实机待验证，安装包未构建或发布。 |
| [2026-10-16-audio-assistant-model](2026-10-16-audio-assistant-model.md) | Paused | 10 月 17 日分离模型已更新原入口；15 组 PCM、20 秒静音、17 项路由、8 项歌曲及完整 DSP 检查通过。用户确认 QQ《咏春》和网易云外放正常，耳机按用户要求稍后再测。 |
| [2026-10-16-audio-assistant-output-isolation](2026-10-16-audio-assistant-output-isolation.md) | Paused | QQ / 网易云实际外放已验收，网易云切歌自动恢复原声通过；保留当前使用版与用户设置，剩余新模型耳机输出、设备选择及恢复按用户要求稍后验证。 |
| [2026-10-15-ai-conversation-continuity](2026-10-15-ai-conversation-continuity.md) | Awaiting Verification | 多轮历史、同观众串行、空闲清理和设置已完成；294 项相关测试、隔离 Electron、子代理验收及 DeepSeek 10 回合真实互动通过。豆包官网可聊天，但 adapter 经实际 207 秒间隔仍被验证拒绝；真实多轮待网页接入恢复后补验，安装版未更新。 |
| [2026-10-15-random-danmaku-entrance](2026-10-15-random-danmaku-entrance.md) | Awaiting Verification | 尺寸、两种入场动画及客户端/画布 UI 已完成，214 项相关测试与隔离 Electron/浏览器验收通过；Server 并行修改使验证记录失效，文档门禁被盲盒 ADR-0102 冲突及豆包计划状态不同步阻断，待外部修改收束后复验。未打包或部署。 |
| [2026-10-15-wesing-audio-diagnostics](2026-10-15-wesing-audio-diagnostics.md) | Awaiting Verification | 已修复非默认输出设备识别，加入播放诊断；报告按英文用途和本机时间命名，导出到日志文件夹。157 项相关回归、隔离 Electron、本机 COM、文档/架构/固定版本契约通过。待主播更新后实播验收，安装包未构建或发布。 |
| [2026-10-14-netease-independent-clock](2026-10-14-netease-independent-clock.md) | Awaiting Verification | 实机外置采集、会员完整播放已验收。所有播放器共享的换句首字延迟已修复，91 项相关回归、架构/指南/文档及 Electron 延迟状态对照通过。安装包未更新，更新后的持续实播与特定模式验收仍待完成。 |
| [2026-10-13-doubao-conversation-isolation](2026-10-13-doubao-conversation-isolation.md) | Awaiting Verification | 观众会话隔离与过期新建已完成本地验证；新增全部预设共享的身份/指令边界、JSON 风格资料及本地拦截，保留正常问题和豆包单次生成。AI/指南 277 项、架构 27 项及语法检查通过；真实私人对话隔离、模型防护效果及约 1 秒首字仍待更新后验收，未构建安装包。 |
| [2026-10-12-fan-song-retention](2026-10-12-fan-song-retention.md) | Awaiting Verification | 汇总、30 天统计、队列回收及两份恢复点已实现，相关 299 项与指南 16 项通过；隔离桌面工具超时，临时实例清理被策略拦截，桌面验收尚未完成。 |
| [2026-10-12-gift-retention](2026-10-12-gift-retention.md) | Awaiting Verification | 存储实现及两端聚焦回归已完成，B 站读取保持原样；待发布阶段固定提交契约锁与验收，删除默认关闭，未上线。 |
| [2026-10-12-guard-expiry-sync](2026-10-12-guard-expiry-sync.md) | Awaiting Verification | 客户端与服务器实现及合成验证完成；真实主播账号上游验收尚未执行。 |
| [2026-10-08-danmaku-prismatic](2026-10-08-danmaku-prismatic.md) | Awaiting Verification | 主题、身份投影及隔离检查已完成；剩真实报文/实播验收及客户端契约版本锁核验。 |
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
| [2026-09-21-client-server-reuse-modularity](2026-09-21-client-server-reuse-modularity.md) | Deferred | 18 项已有完成记录；F07 消息渲染核心已在 10 月 10 日优化中完成，公共样式规则与 S04 仍延期。 |
| [2026-09-22-usage-guide-supplement](2026-09-22-usage-guide-supplement.md) | Needs Review | 10 月 9 日指南纠错及 92 项相关测试已核对；剩成功操作/真实环境证据与服务器指南覆盖复核，旧写作步骤和图库编排已移出维护正文。 |
| [2026-09-25-audit-followup](2026-09-25-audit-followup.md) | Awaiting Evidence | 代码及隔离检查已有记录；生产认证 SSE 持续交付、完整恢复与独立备份材料仍缺证据。 |
| [2026-09-25-resource-runtime-secret-audit](2026-09-25-resource-runtime-secret-audit.md) | Blocked | 资源与生产运行时审计已有记录；仅剩历史会话失效/撤销的持有人确认，不探测会话或复制秘密。 |
| [2026-09-26-client-resource-integrity](2026-09-26-client-resource-integrity.md) | Awaiting Verification | 实现和自动化已有记录；正式签名安装包验收尚未完成，依赖签名接入。 |
| [games-poll-rating](games-poll-rating.md) | Awaiting Verification | 功能代码和隔离界面验证已有记录；C0 真实直播间 UID/时间/计数及端到端验收待补。 |
| [windows-code-signing](windows-code-signing.md) | Blocked | 等待发布者、证书来源与执行策略确认。 |

2026-10-09 已依据后续完整验证关闭三项旧验收阻塞，见[完成摘要](archive/README.md#2026-10-09-补齐的历史验收)。9 月文档分层过程仍见[原整理记录](archive/2026-09-28-documentation-consolidation.md)。

## 状态说明

- `Draft`：目标或范围仍需确认。
- `In Progress`：当前实施尚未完成。
- `Needs Review`：已有实现或材料，旧状态不足以证明剩余工作，先复核。
- `Awaiting Verification` / `Awaiting Evidence`：实现或检查已有记录，仍缺指定验收或外部材料。
- `Deferred` / `Paused`：保留明确延期或暂停决定，不自动恢复。
- `Blocked`：依赖明确输入或前置交付；文档整理不等于获得操作授权。

`Completed` 与 `Superseded` 计划退出活动区；按 [PLANS.md](../../PLANS.md#locations-and-lifecycle)选择保留证据、压缩为完成摘要或从维护目录清理。原结果及限制可从 Git 查询，不补写未实际执行的测试，也不将历史代码路径当作当前实现。
