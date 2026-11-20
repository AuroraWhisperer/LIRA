# 客户端恢复故障整改

**Status:** Completed

**目标**　修复隔离审计复现的五项故障，让暂停的播放队列从短暂保存失败恢复，本机 B 站监听通过鉴权和备用地址恢复，首屏失败后接受就绪通知，歌库能接纳服务端备份恢复后的内容。

**归属与约束**　播放 renderer 持有保存计时器，SQLite 播放 store 仲裁快照代次。WebSocket 负责开连、鉴权和心跳，弹幕 client 负责历史点歌回退和地址选择。桌面 readiness controller 统一持有首屏与后续导航。歌曲同步继续由主进程协调器与歌库子控制器执行，复用现有设备 API 的 revision 和 updatedAt 以及服务端事务。保持现有 HTTP、IPC、存储格式、授权校验与退出落盘顺序。验证使用合成上游、隔离进程及内存库。

## 实施与验证

| 事项 | 修改与验收 |
| --- | --- |
| 播放快照 | `state-persistence` 为瞬时失败保留同一序号并有界退避。新快照、退出 flush 和 stale-snapshot 按各自已有语义处理。扩展 `playback-recovery-checkpoints`，验证暂停新增歌曲、首写 503、无需下一次编辑或退出即可从 SQLite 读到新曲。 |
| B 站监听 | `websocket-connection` 将打开与鉴权分开。明确拒绝及限时未收到鉴权结果进入既有关闭/退避路径，等待期间保留已有历史轮询。`danmaku-client` 的每次连接尝试轮换候选地址。扩展 `danmaku-reconnect-backoff` 与传输夹具，校验回退、恢复、备用地址以及旧连接不能重新取得所有权。 |
| 桌面首屏 | `desktop-readiness-controller.start()` 经统一导航入口发出首屏请求，由 `desktop-main-window` 建窗并绑定请求鉴权。扩展 `desktop-readiness-controller`，验证失败后的同目标通知和迟到的旧路由失败。 |
| 歌库恢复 | `cloud-sync-controller` 和 `cloud-song-sync-controller` 用成功读取的歌库摘要和完整快照认定恢复后的版本。摘要版本回退或相同版本的更新时间变化会重新读歌库。使用完整响应的版本标识，保留当前账号及待传保护。扩展 `cloud-sync-polling`，等版本常规重连不新增完整读取，恢复后接纳旧版与复用版本。 |

每项先运行能复现原问题的现有或扩展用例，再运行受影响的播放持久化、弹幕/运行时、桌面启动退出、云同步、隔离桌面鉴权组。技术参考更新播放、弹幕协议、首屏和云同步事实，核对已有使用指南。执行 `npm run verify:docs`、架构检查及 `git diff --check`。以五项定向回归通过、现有契约与相关文档一致为完成条件。

按表中四组审阅及撤回任务所属改动，保留工作树中其他改动。外部 B 站与服务端恢复按隔离输入验收，交付以当前源码和测试结果为准。

## 验收记录

客户端基线为 `a6c78d82`。隔离回归共通过 444 项。

| 领域 | 结果 | 覆盖 |
| --- | --- | --- |
| 播放快照 | 80 项 | `playback-recovery-checkpoints`、`playback-snapshot-ordering`、`playback-snapshot-bootstrap`、`playback-radio-feedback`、`playback-flush`、`playback-persistence`、`playback-logout-recovery`。暂停队列首写 503 后，同一快照重试并从内存 SQLite 读回。 |
| B 站监听 | 73 项 | WebSocket、重连、运行时、启动接线、诊断、点赞、直播活动和开播检测。覆盖鉴权拒绝、格式异常、只有心跳的无回包状态、旧 socket 与退避封顶后的地址轮换。 |
| 桌面生命周期 | 73 项 | readiness、startup、startup-data、shutdown 和内置请求鉴权。真实隔离 Electron 由就绪控制器发起首屏并完成会话鉴权验证。 |
| 云同步及设备协议 | 218 项 | `test/cloud-sync` 及设备协议、授权操作、设备 IPC、远端 HTTP、SSE 和响应预算。覆盖回档、复用修订号、旧库空时间戳、摘要与完整响应之间的更新、本机待传保护。服务端锁定版本 `67119e81a3f5f49470ed2b191f6552556d0a704e` 的 10 份协议夹具通过校验。 |

架构检查 30 项、文档检查 10 项和 18 个 JS/CJS 文件的语法检查通过。同步了弹幕协议、桌面与播放技术参考及播放使用指南。B 站消息和服务端回档用隔离输入验证。两项歌库标记完全相同时，等标记变化或客户端重新启动后会再次读取完整歌库。
