# 客户端与服务器通讯整改及复审

**Status:** Completed

依据：[当日通讯审查](../../../docs/reports/2026-10-10-client-server-communication-review.md)。用户已要求开始修复并在修复后整体大审查。本计划按仓库 PLANS.md 在当前会话逐项实施，不创建提交。

2026-10-10 收尾：C01–C05、复审补漏及范围内验证完成，证据见[整改与整体复审报告](../../../docs/reports/2026-10-10-communication-remediation-review.md)。保留本计划中的跨端合同、上传确认和模块边界裁决。服务端额外租户目录故障注入出现未定因的 Windows EPERM，作为发布前验证限制记录，不将其标记为已修复或全套通过。

## 目标与当前证据

修复完整歌库同步误用筛选结果，减少重复读取，收敛连接生命周期和 JSON 响应处理，并让远程适配器及 Device 路由遵循已有领域边界。完成后重新核对客户端/服务器 HTTP、SSE、IPC、WebSocket 和页面通信，验证契约、隔离、顺序、资源清理与复用。

现有审查已用合成数据复现：手动同步筛选后的 1 首或空结果会全量替换服务器歌库；六个并发 profile 读取发出六个远程请求；Device SSE 未向有界读取器传递取消信号，缺少连接/空闲期限。当前工作树再次确认这些路径存在。

## 边界与兼容

- 继续使用 Electron 主进程、既有模块化单体和 no-build ESM；不增加依赖、进程或远程服务。
- 保留当前未提交的其他工作。涉及并发修改的文件每次编辑前核对最新内容。
- 不改变歌曲持久化、授权签名、设备/主播隔离、礼物 epoch/cursor 或 overlay 会话语义。
- 旧 syncSongs(songs) 保留显式 payload 语义；新命令从主进程完整歌库取数。两者进入现有同步队列。
- 不合并不同职责的业务状态机；只共享已存在于多个消费者的机制。
- 不恢复历史延期事项，不触碰真实用户数据库、凭据或运行中的应用，不部署。

## 所有权、交付与验证

### C01 完整歌库手动同步

- Owner：src/electron/cloud-sync-controller.js 的串行队列及 cloud-song-sync-controller.js 的 pending/ack；runtime 提供完整歌库。
- 修改：license-songs-ipc.js、license-ipc.js、preload.js、main.js 注入窄接口；cloud-song-sync.js 和 song-import.js 改用完整计数/同步命令。
- 接口：getLocalSongCount() 返回完整本地数量；syncCurrentSongs() 在确认后读取当前完整快照并复用 dirty/重试/ack；旧 syncSongs(songs) 串行执行原 payload。
- 覆盖：筛选命中/空结果均不影响同步；确认后本地修改；自动与手动顺序；失败保留 dirty；账号切换/取消后不确认旧结果；IPC 来源与脱敏。
- [x] 实现与对应 cloud-song-sync、license-ipc/preload 测试通过。
- [x] 同步桌面 IPC、前端通讯参考及歌库操作说明。

### C02 profile 并发合并

- Owner：license-operations.js；生命周期来自 license-manager.js。
- 在同一授权生命周期内共享正在进行的 profile Promise；完成或失败即清除，下一次显式刷新仍访问服务器。新账号/生命周期不得复用旧 Promise。
- 只需已知账号/URL 的初始化消费者使用已有 getState；完整设备资料/显式刷新仍用 getProfile。
- [x] 并发请求、失败重试、切账号迟到结果测试通过，核对相关 UI 消费者。

### C03 SSE 生命周期

- Owner：remote-license-client.js、bounded-sse-reader.js；cloud-sync-controller.js 与 remote-gift-controller.js 继续拥有各自业务恢复。
- Device 流转发取消信号，添加连接与空闲期限；空闲期限大于服务器 25 秒 keepalive，任何有效接收块包括注释心跳重置期限。
- 提取可取消、支持长延迟分段并屏蔽过期回调的重连调度机制；不合并 cloud revision 与 gift cursor 状态。
- [x] SSE 取消、静默连接/响应、正常心跳、超限、Retry-After 长计时及停止/重启测试通过。
- [x] 更新通讯参考中的期限与责任边界。

### C04 本地 JSON 响应处理

- Owner：public/js/shared/ 的小型非 UI JSON 工具；各领域保留请求组装、验证和提示。
- 消费者：utils.api、scene-api、gift-wish-client、component-style-api、opening-settings-api、danmaku-tool。
- 保留 HTTP status、业务 code、原 payload 与兼容 api() 行为；二进制、FormData、credentials 按已有调用保留。
- [x] 对共享错误语义和受影响领域测试，核对无新增重复请求/提示。

### C05 领域适配器与 Device 路由

- 沿用 createRemoteDanmakuSettings/createRemoteGiftReads 和服务器 registerDailyBotRoutes/registerBackgroundRoutes 模式，按实际领域提取歌曲/云状态/场景端点。
- 只需主播 ID 的服务器操作使用已认证 req.device.streamer_id，保留 body 后复核与异步写前复核。
- 复用 remote-url-policy 的 HTTPS 根 origin 纯验证；保留不同 owner key 格式和生命周期。
- 核对云端数量读取；仅在有明确兼容且有测试的摘要合同后减少完整歌库传输，不读取不存在的 count。
- [x] 所有客户端调用方法/路径仍匹配服务端；Device 路由/授权/隔离与适配器测试通过。
- [x] 服务端 normative/OpenAPI/fixture 的受影响内容同步，未改变的规范明确沿用。

## 执行与验证策略

每项先补充能复现具体缺陷的现有测试，再实施并运行受影响完整测试文件。行为保持的提取优先沿用已有测试，不为函数拆分重复覆盖。

客户端使用 `node --experimental-vm-modules --test --test-concurrency=4 <affected-files>`；服务器使用 `node --require ./test/support/test-mode.cjs --test --test-concurrency=4 <affected-files>`。精确文件及结果在实施记录登记。最终按消费者范围补充跨领域通讯/授权/隔离/架构检查；当前 Markdown 分别运行 `npm run verify:docs`、`npm run docs:check`。不以纯浏览器替代桌面权限验收，不启动用户应用或真实远程写入。

## 复审与完成条件

- [x] C01–C05 每项有实现证据、行为验证和文档同步结果，无法成立的优化记录具体原因。
- [x] 重新盘点两仓通讯入口及调用关系，核对方法、路径、DTO、认证边界、复用、取消、重试和清理。
- [x] 复审发现的本次范围内问题修复并复验；输出独立的修复后复审报告，不把旧报告描述成已修复证据。
- [x] 最后检查两仓 touched diff、git diff --check、git status --short；没有生成物、凭据或用户数据进入变更。

失败时保留本地 pending 状态，不把失败/取消记为同步成功；若需撤销，仅手工反向本任务的具体片段，保留其他变更。

## 实施记录

- 2026-10-10：重读两仓规则及当前实现，确认审查中的关键缺陷仍存在。两仓已有大量其他未提交修改，记录基线并按片段编辑。
- C01/C02 首轮：完整歌库主进程命令、确认代次、手动/自动/兼容上传串行、profile 在途合并及六处初始化快照读取已实施。对应 12 个完整测试文件 113/113 通过，日志 tmp/communication-remediation/c01-c02.log；此前 controller/recovery/UI/IPC 39/39 通过。已同步 IPC/主进程参考与歌库帮助，不改变服务器歌曲全量替换契约。
- C03 首轮：Device SSE 取消与期限、共享长延迟调度已实施；连接超时、注释心跳、同块取消、重连及两个业务恢复控制器共 30/30 测试通过（tmp/communication-remediation/c03.log）。协议事件、礼物 cursor 和公开 overlay 状态机保持原合同。
- C04：统一非 UI 信封校验，保留原生 JSON 与兼容正文解析的既有调用契约；起初切换为正文解析导致仅提供 json() 的消费测试失败，已收敛为共享校验并重跑受影响文件 50/50 通过（c04-fixed.log），没有批量放宽断言。
- C05：客户端歌曲/背景、云同步/B 站凭据适配器及服务器三组 Device 路由按领域归位，ID-only 路由省去 profile 读取。适配器/预算/owner 隔离 37/37，服务器 51/51 通过。服务器须用仓库已安装的 tmp/danmaku-efficiency/node-runtime/node-v24.18.0-win-x64/node.exe（系统 24.21.0 不在服务器声明范围），未改版本保护或依赖。数量摘要新增可选字段及窄 IPC，旧服务器仍能回退全量读取；文档/fixture/对应测试同步中。
- C05 收尾：歌曲摘要 count、旧服务器回退、隐藏/空歌库、租户隔离及 IPC 已完成；两仓合同和使用说明同步。服务器注册适配器最终放在 src/modules/device/register-{danmaku,cloud,song}-routes.js，复用既有模块注册模式，不放宽 routes 依赖规则。实际注册 35 路径、45 操作（42 个受保护），与 OpenAPI 和客户端方法/路径一致，无重复。
- 复审补漏：上传只在授权生命周期仍有效且服务器返回 ok:true、count 等于提交快照长度时确认成功；错误确认保留 pending。补例及相关文件 37/37；组合检查 564 项先有两项旧成功 fixture 缺 count，修订 DTO 后完整续期/manual 文件 20/20，通过原隔离/续期断言。最终 IPC 文件 5/5。
- 整体复审：本地 HTTP/WS、overlay/场景及浏览器输出 47/47；随后并行场景改动定向复验 73/73。服务器最终 32 文件 216/216；架构、认证、正文后复核、异步写前复核及三个领域注册 owner 均覆盖。跨端合成往返验证本地 3 首、筛选 1/0 首均上传 3 首，profile 并发 6→1。固定 revision 的 10 项 fixture 另行通过，未修改版本锁。
- 验证限制：服务器 33 文件扩展组合 218/219，唯一异常为 tenant-storage-http.test.js 在业务断言前重命名合成目录时 EPERM；当前工作区单文件仍复现，干净 HEAD 3/3，四次带诊断插桩运行 3/3，原因未定。未修改该用例、加入重试或将诊断通过当作修复；后续发布验收需单独排查。
- 收尾门禁：客户端 npm run check（1433 JS）、verify:architecture（27/27）、verify:docs（10/10），服务器受支持 Node 的 docs:check 对应五文件（50/50）。证据及文件清单保留在两仓 tmp/communication-remediation/，不累计重叠用例、不声称整仓发布验收。最终只复查任务差异、文档链接与两仓 diff/status；未操作真实用户数据、提交或部署。
