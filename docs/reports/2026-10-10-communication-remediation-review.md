# 客户端与服务器通讯整改及整体复审

日期：2026-10-10。承接[首次通讯审查](2026-10-10-client-server-communication-review.md)及[实施计划](../../specs/plans/archive/2026-10-10-communication-remediation.md)。本文是工作区实现与验证记录，不代表已发布版本。

## 结论

C01–C05 已实施：完整歌库上传归入现有同步队列；账号资料在途读取合并；Device SSE 补齐取消和期限；本地 JSON 错误处理复用；远程端点及服务端注册适配器按领域归位。额外完成云端歌库数量摘要，旧服务器可回退完整读取。

复审发现并修复了无效上传确认可能被当作成功的问题，也修正了路由拆分与既有依赖规则的冲突。当前证据支持保留模块化单体以及 HTTP、SSE、WebSocket、IPC 各自的职责。没有发现应继续扩大本轮抽象范围的具体收益。

**验证仍有一项限制：**服务端 `tenant-storage-http.test.js` 的 Admin overview 用例在 Windows 重命名合成租户目录时出现 `EPERM`。未将诊断插桩后的通过当作修复，也不声称所有测试全绿。详见下文。

## 基线与范围

- 客户端工作区 `D:/Work/Live`，HEAD `eeedb1440a3123ffde0200e3ddd0ff9f4090ac88`。
- 服务器工作区 `D:/Work/lira-server`，HEAD `8995b126254fff13345307b564ace15b6be40615`。
- 两仓均包含其他任务的未提交修改；本报告只归属通讯整改片段。通讯组合测试运行前后分别对客户端 1515、服务器 745 个源码/测试输入取哈希，两轮对应清单均无变化。最后的少量测试修订、服务器注册模块移动，以及随后检测到的并行场景修改另有定向复验。
- 客户端测试用 Node 24.21.0；服务器按版本约束用已有 Node 24.18.0。未修改依赖或版本保护。
- 复审覆盖 Device REST/SSE、公共礼物目录、云弹幕、renderer/main IPC、本地 HTTP/WS、场景通知及 iframe 通信、服务器浏览器 HTTP helper。第三方 Bilibili、音乐、AI、更新器只核对接入边界，不将其上游协议或生产行为纳入结论。
- 测试使用合成账号、隔离临时目录、内存数据库、注入 transport 及已有浏览器测试。没有线上写入、真实歌库操作或用户 Electron 应用操作；没有发布或提交。

## 已实施的收敛

| 项目 | 实现与责任 | 关键证据 |
| --- | --- | --- |
| C01 完整歌库同步 | [cloud-sync-controller.js](../../src/electron/cloud-sync-controller.js) 统一手动、自动和兼容上传队列。新 IPC 只传确认代次，main 在执行时读取完整快照；复用 dirty、pending、mutationId、重试和生命周期检查。 | 真实 StateService 筛选、UI、IPC handler、manager/controller 与服务器歌曲服务组合：本地 3 首，筛选显示 1 首或 0 首，均上传 3 首、云端保留 3 首；确认后的新修改也进入快照。 |
| C02 账号读取 | [license-operations.js](../../src/electron/license/license-operations.js) 仅合并同授权生命周期的在途 profile 请求。六处只需账号/URL 的初始化读取已有 getState；完整设备资料仍用 getProfile。 | 6 个并发调用只发 1 次请求；完成后显式刷新继续请求，失败可重试，新账号不会加入旧请求。 |
| C03 连接生命周期 | [remote-license-client.js](../../src/electron/license/remote-license-client.js) 向 fetch 和有界 reader 传递取消，建连 15 秒、完整事件块空闲 60 秒，注释心跳续期。两个恢复控制器复用 [cancellable-delay.js](../../src/shared/cancellable-delay.js)。 | 同一缓冲块内取消后停止后续回调；静默建连/响应被取消；超长 Retry-After 分段且不重算业务退避，过期 timer 回调失效。 |
| C04 JSON 响应 | [json-response.js](../../public/js/shared/json-response.js) 统一 HTTP/业务信封检查，保留 status、code、payload。utils、场景、礼物许愿、组件样式、开播设置和弹幕工具采用同一规则。 | 错误信封、无效 JSON、HTTP 错误中的 ok:true 均拒绝；每次操作只发一个请求，FormData、二进制下载、credentials、AbortSignal、领域错误字段及提示策略保留。 |
| C05 领域适配 | Client 增加 [remote-songs.js](../../src/electron/license/remote-songs.js)、[remote-cloud-sync.js](../../src/electron/license/remote-cloud-sync.js)，弹幕设置延续已有适配器。Server `modules/device/register-{danmaku,cloud,song}-routes.js` 沿用 background 注册模式，入口注入错误映射。 | 实际服务器注册 45 个 Device 操作，与 OpenAPI 全部一致，无重复；42 个受保护操作保留 Device 请求中间件。客户端 42 个 Device 操作及 1 个公共目录 GET 方法/路径符合契约。 |
| 数量摘要 | Server `cloud-state.songs.count` 返回含隐藏歌曲的完整数量；Client 用窄 getCloudSongCount IPC。 | 新服务器不为显示数量拉完整歌库；旧服务器缺 count 才回退，非法值拒绝。HTTP 测试覆盖空库、隐藏歌、revision、未授权与租户隔离。 |

新命令不接受 renderer 指定服务器、账号或歌曲数组。旧 `syncSongs(songs)` 保留显式 payload 语义并串行执行，不确认另一个本地 pending。歌曲全量替换、5 MiB 请求上限、8 MiB 完整响应预算与 5000 首限制不变。

## 复审发现及处理

1. **上传确认必须可信。**先补用例复现 `{}`、缺数量、错误数量或失败信封仍被视为上传完成，再由 manager 在授权复核后要求 `ok === true` 且 count 等于提交快照长度。无效响应报 `INVALID_RESPONSE`；不生成一个本地数量冒充服务器确认，pending 保留。补齐旧续期测试的成功 DTO，保留原续期次数及账号隔离断言。
2. **注册模块遵循现有依赖方向。**初版把注册函数放在 `src/routes/device/`，触发禁止路由互相导入的架构门禁。最终改用已有 `modules/.../register-*-routes` 模式，保留 `app → routes → modules → storage`；架构测试未放宽。HTTP 清单测试增加三个实际注册 owner，接口清单未删减。
3. **测试选择命令纠正。**一次服务器文件筛选为空，使 Node 自动发现了历史 tmp 检出中的测试；发现后终止了本任务测试进程树，改用明确且非空的文件清单。误跑日志不作验收依据，没有修改旧临时检出的失败测试。

## 整体通讯复核

| 边界 | 复核结论 |
| --- | --- |
| Device 鉴权和秘密 | 仍由 license-manager 掌握 token/续期，renderer 接收白名单 DTO。秘密读取只供 main；公开目录不发送 DeviceBearer。服务端从已验证 req.device 取 streamerId，不信任正文中的租户字段。 |
| 变更与取消 | 上传入队即保护本地 songs；自动/手动不能交错覆盖；确认代次失效、停止和迟到响应不能确认旧 pending。取消续期等待的并发修改也已纳入当前 manager 测试，但该修改归其他任务所有。 |
| 请求防护 | 原正文大小、认证优先于解析、接收正文后的再次鉴权、异步写入前复核及背景 afterBody 保留。未以“重复”为理由删除安全检查。 |
| 恢复与顺序 | Cloud revision、gift epoch/cursor、public overlay liveSessionId 仍各自拥有状态机。SSE 重连后的权威读取与本地低频兜底保留；不把通知当作可靠消息队列。 |
| 本地 HTTP/WS | 新 JSON helper 不组装认证，也不改变 fetch/WS 来源策略。Admin StateService 仍负责 HTTP/实时字段排序；普通 overlay 继续复用 socket-client。 |
| 场景通知及 postMessage | 展示读取/通知已有共享 owner，保留取消、订阅、销毁与回压规则。sandbox iframe 校验 source 与 opaque origin；外部网页不接收内部配置。47 项本地展示/浏览器测试通过。 |
| Server 网页 HTTP | 已有 `public/shared/http-client.js` 处理 Cookie 请求与页面动作；不引入跨仓运行时 helper，也不把 Cookie、DeviceBearer 和公开 capability 合并。 |
| 纯机制与业务边界 | HTTPS 根 origin 只复用纯校验；持久 owner key 编码和各领域身份语义保留。Node Buffer SSE reader 与浏览器 EventSource/展示解析器不机械合并。 |

## 验证记录

下列计数是各次命令自身的结果，有覆盖重叠，不累加为唯一用例数。完整日志及明确文件清单在两仓 `tmp/communication-remediation/`。

| 检查 | 结果与日志 |
| --- | --- |
| C01/C02 直接消费者（12 个完整文件） | 113/113；`c01-c02.log`。 |
| C03 SSE/调度与恢复 | 30/30；`c03.log`。调度器最终版本也纳入后续 564 项组合。 |
| C04 JSON 与 UI 消费者 | 50/50；`c04-fixed.log`。 |
| C05 客户端适配器、预算、owner | 37/37；`c05-adapters.log`。 |
| 上传确认、账号切换、controller | 37/37；`song-ack.log`。 |
| Client 通讯组合（云同步、授权、礼物、IPC、HTTP/WS、场景、固定契约） | 564 项中首轮 562 通过、2 项旧成功 fixture 缺 count；补齐后完整续期文件及 manual 文件 20/20，通过日志 `client-review-fix.log`。未把首轮失败称为全绿。 |
| 本地 overlay/场景展示及浏览器输出 | 47/47；`local-display-review.log`。 |
| 后续并行场景修改复验 | 完整 scene-cloud-controller、scene-display 文件 73/73；`scene-final.log`。不将其他任务修改归为本轮实现。 |
| 最终 IPC fixture 复验 | license-ipc 完整文件 5/5；`ipc-final.log`。 |
| Server 最终 32 个 Device/Cloud/SSE/歌曲及管理鉴权文件 | 216/216；`server-final.log`，包含最终注册模块位置。 |
| Server 扩展租户不可用检查 | 先前 33 文件组合为 218/219，异常和诊断见下节；不包含在上述 216/216 中。 |
| 当前工作区跨端探针 | 3→3 / 3→3 完整歌曲往返及 profile 6→1；`roundtrip.log`、`roundtrip-results.json`。 |
| 实际路由注册与客户端调用清单 | 35 路径、45 Device 操作、42 受保护操作；Client 42 Device + 1 public。另 3 个 pairing 兼容操作无当前桌面调用；`registered-routes.log`、`route-inventory.json`。 |
| 固定服务器契约 | 使用已有干净 `tmp/guard-accompany-contract`，revision `01fb2b47d5e081f5dd559933991ade4819eb3428`，10 个固定 fixture 校验通过。没有更改 lock，也不把该检查当作当前服务器实现验证。 |
| Client 语法与架构 | `npm run check`：1433 JS 文件通过；`npm run verify:architecture`：27/27。 |
| 文档/协议治理 | Client `npm run verify:docs`：10/10；Server `docs:check` 对应五文件命令：50/50（受支持 Node）。 |

### Windows 故障注入限制

`test/tenant-storage-http.test.js:147` 在 `storage.closeAll()` 后把合成的 `overview-broken` 目录改名时发生 `EPERM`，尚未执行“缺失租户概览”的业务断言。同文件两个 Device 缺数据库/目录的 HTTP 用例通过。

当前工作区单独运行仍复现；同一受支持 Node、同一临时根下的干净 HEAD 检出为 3/3。加入数据库 close/rename 诊断插桩后，四次均为 3/3，未捕获 close 失败。因此不能确认是运行时代码差异、GC/句柄时序还是 Windows 文件系统干扰；不以单次通过掩盖它，也未添加睡眠/重试或削弱断言。该非本轮修改用例保留为发布前验证限制。

本轮没有运行整仓发布验收、真实 Electron 联服操作、真实直播或吞吐基准；“请求合并”只报告合成并发的实际次数，不推导生产流量百分比。

## 同步与后续边界

- 测试：对明确缺口增加/更新覆盖，已有行为保持的模块移动沿用原测试；跨端 probe 只留在 tmp，未引入生产依赖或永久测试框架。
- 技术文档：更新[主进程参考](../reference/desktop/main.md)、[IPC 参考](../reference/desktop/preload.md)、[前端通讯参考](../reference/frontend/comms.md)，以及 Server requirement、acceptance、protocol、OpenAPI、摘要 fixture、架构模块所有权和文档清单检查。当前架构决策不变，无需新增 ADR。
- 用户指导：更新歌单导入导出页与歌库使用指南中的“完整歌库、不受筛选影响”说明。README 和交互引导没有描述筛选上传或新增的内部接口，保持原文；已有截图没有把筛选结果描述为上传源。
- 改动停留在工作区，保留其他任务变更。剩余复用机会必须有具体消费者和相同合同再实施；不增加通用 SyncManager、跨仓运行时依赖或新的通讯框架。
