# 2026-09-18 Current Review Remediation Implementation Plan

状态：Completed（2026-09-18）。本轮 14 项修复完成；HTML-TOKEN 按用户要求跳过，权限决策草案继续保留在 `specs/plans/2026-09-18-overlay-access-decision.md`。

**Goal:** 分阶段修复当前审计清单中已确认、范围已收窄的问题，保留此前有效修复与工作区改动，并为每个阶段留下可复查的验证结果。

**Architecture:** 在现有领域 owner 修复原因，沿用 Electron + Node 模块化单体。不同 owner 的独立任务由 Astra 最高推理级别子代理协作；跨域接线、契约与最终集成由主代理负责。

**Tech Stack:** Node.js >=24、Electron 43、CommonJS 后端、原生 ES modules 前端、node:test、临时 SQLite。

## Global Constraints / Compatibility Constraints

- 范围来源：`D:/Work/lira-audit/current-review-2026-09-18/current-review.md`，15 项明确修复候选。
- 当前用户授权恢复实施；2026-09-17 计划中的暂停描述是此前撤销工作的历史状态。
- 27 项已有处理不重复修复，31 项已撤销条目不恢复；8 项待补证和 4 项规则/兼容待裁决不擅自修改产品。
- 保留工作区未提交内容；不提交、建分支、发布或操作真实业务数据、密钥、上游服务。
- 保持数据完整性、safeStorage、session partition、HTTP/WS/IPC 权限边界、OBS 已授权互动与现有页面 URL。

## Non-goals

不重新审计全部仓库，不扩充产品需求，不把理论性能风险直接改成限制，不改变待裁决的管理会话/Host、服务器旧游标或 AI 配额规则。

## Current Behavior

报告记录设备密钥在激活成功前被替换、旧导入可写入 5001 首、播放持久化与 overlay HTTP/WS 缺少顺序门。其余已确认项涉及平台校验、头像 Cookie、游戏身份、通知及错误类别。报告中的既有测试仅是历史证据，本计划只登记实际重跑结果。

## Ownership / Proposed Changes

| 阶段 | 审计项 | 拥有者及预计修改范围 | 验证边界 |
|---|---|---|---|
| 1 数据安全 | LICENSE-CLIENT-ROBUST | `src/electron/license/license-activation.js`、`device-key-store.js`、`license-manager.js`、`remote-license-client.js` 与相关测试 | 临时密钥文件/合成 safeStorage、失败激活保留原文件、丢响应恢复、流式响应预算 |
| 1 数据安全 | SONG-IMPORT-LIMIT | `src/storage/song-store.js`、`src/music/` 导入 owner、`src/server/routes/song-routes.js`（按需要） | 内存 SQLite、合并/替换最终数量、超限原子拒绝 |
| 1 数据一致性 | PLAYBACK-SNAPSHOT-RACE | `src/storage/playback-store.js`、`public/js/playback/operations/state-persistence.js`、HTTP/IPC 调用边界（按需要） | 旧 HTTP 晚于新卸载快照、同一卸载双通道、重建/重启代次 |
| 2 秘密/身份 | AVATAR-COOKIE-FORWARD、MUSIC-PLATFORM-LOOKUP、GAME-ROLE、GIFT-TOAST-SOURCE | Bilibili api-client / gift-command-utils、Electron music IPC / auth-manager / login-window、game-session-service | 假 fetch 和 Electron 桩、合成游戏/礼物消息；不接真实账号 |
| 3 状态恢复 | DOM-REBUILD-MISC、DEAD-BRANCHES、WHEEL-SNAPSHOT、LYRIC-ENDPOINT-METHOD | `public/js/overlays/{queue,songs,blindbox,games,wheel,lyric-window}.js` | 受控 HTTP/WS 乱序、清空全部、配置变更、首次请求失败后的连接恢复 |
| 3 接口行为 | REQ-BODY-DESTROY、4XX-AS-500、WESING-CONFIG-SNAPSHOT | http-utils、music-routes / qq-encrypted-stream、settings-routes / wesing-routes / music-runtime | 本地 HTTP 超限/滴流、4xx 与上游错误区分、通用/专用配置热更新 |
| 4 权限契约 | HTML-TOKEN | HTTP 页面引导、API/WS 权限、Electron 初始加载与 OBS 消费者 | 先完成端点/消息能力清单与兼容方案，再判断可直接实施范围或需要的具体用户裁决 |

契约入口：`docs/architecture/engineering/ai-workflow.md`，各领域对应 `backend/api.md`、`backend/ws.md`、`backend/server-core.md`、`backend/music/services.md`、`frontend/playback.md`、`frontend/overlays.md`、`desktop/auth.md`。子目录规则在编辑前读取。

## Milestones

- [x] 1. 设备密钥、导入上限、播放顺序修复并通过各自聚焦测试。
- [x] 2. 身份/秘密与礼物解析修复并通过合成输入回归。
- [x] 3. Overlay 恢复和接口行为修复并通过受控异步及 HTTP 回归。
- [x] 4. 已完成匿名 HTML 凭据权限方案；用户明确“先跳过”，本轮排除实施，草案见 `2026-09-18-overlay-access-decision.md`。
- [x] 5. 汇总实际修复/保留项，执行与跨域变更相称的仓库门禁，审查本次增量与最终状态。

## Verification

- 每个 owner 先补能复现审计现象的最小测试，然后执行 `node --experimental-vm-modules --test <相关测试文件>`；已有充分测试覆盖时不新增重复测试。
- 存储与 Electron 风险项分别覆盖事务/失败路径、生命周期与安全参数。
- 最终执行 `npm run verify:contracts`、`npm run verify:quick` 和跨域回归 `npm test`，只有在实际涉及边界时补相应专项测试。
- 执行 `git diff --check`、`git status --short`，对照执行前内容确认仅添加任务差异，未混入运行数据或秘密。

## Rollback Or Failure Handling

执行前在仓库外保存代码基线和状态。失败时保留现场，仅逐块撤回本任务引入的改动；禁止 reset、整文件 checkout、批量删除。需要产品语义裁决时先完成独立修复和具体方案，再提出有依据的选择。

## Done When

可直接实施的明确项均已修复并验证；需要权限/兼容裁决的项目有具体方案和清晰剩余范围；原有已修复、已撤销和未证实条目不被篡改；契约文档与实际实现一致；最终增量完成审查。

## Execution Record

- 2026-09-18：读取当前 54 条清单及 root / planning / owner 路由规则；启动分阶段修复。报告路径实际为 `current-review.md`。
- 用户选择跳过 HTML-TOKEN，本轮实施范围收敛到其余 14 项；原审计报告保留为历史证据，本计划记录新结果。
- 聚焦回归：导入 40/40、平台/头像/游戏/解析 50/50、授权 178/178、播放与 HTTP 集成 82/82、overlay 56/56、WeSing 88/88。各组有重叠，不相加作为唯一测试总数；游戏新增身份用例已移到独立的 `game-streamer-role.test.js`，避免原测试文件越过 600 行。
- 授权独立复核发现丢响应会遗失内存候选私钥，已加入 safeStorage 加密候选暂存和已有设备身份恢复。真实模块、临时磁盘与签名探针 11 项通过，覆盖精确 401 回退、key/identity/cleanup 失败和 dispose；首次无 deviceId 不能自动找回身份的协议限制保留。
- 播放独立复核修正两处边界：HTML 只分配持久高水位，实际保存才推进已接受版本，未执行的 GET 不抢占播放；旧 HTTP 晚失败不能复活旧 pending。页内 senderGeneration 同步分配，卸载直接 IPC/beacon，不再等待网络握手。最终跨播放/页面/overlay 独立复跑 42/42。
- Overlay 复核加入完整状态与 live:status 局部更新交错用例；局部直播状态更新不再阻止待完成的主题/设置生效，且不被旧 HTTP 回退。
- HTTP 真实路由复核发现原领域 wrapper 会把超量 body 改成 400/502，扩充到 body 限额异常透传及 10 类真实路由回归，保留其余领域错误合同。
- WeSing 独立使用真实 settings store + SQLite 触发器模拟批量写失败：整批回滚、运行态不提前应用、不广播；重试后持久化与运行态一致，监视进程不重启。
- 验证环境：本机服务器 checkout 与 lock 不同，已在仓库外建立锁定 `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577` 的 detached worktree，用 `LIRA_SERVER_ROOT` 执行契约和全库检查，未切换原服务器工作区。
- 集成门禁最初暴露并行礼物工作引入的 29 项 Electron harness 缺依赖桩、7 项旧 schema 断言和文件行数门禁。schema 断言由并行 owner 更新；本轮仅补 harness 两个依赖桩，并逐块复核现有组合入口、迁移注册表及样式按钮后登记精确上限，没有修改并行功能实现。Windows 进程查询一次并发超时，单独重跑 2/2 通过。
- 最终统一命令：设置上述 `LIRA_SERVER_ROOT` 后执行 `npm run verify`，exit 0；5 个服务端契约 fixture、文档门禁、全部 JavaScript 语法和架构门禁通过；全库 `node:test` 共 2284 项，2280 通过、4 跳过、0 失败。日志保存在仓库外 `D:/Work/lira-audit/current-review-2026-09-18/remediation-2026-09-18/verify-all-final.txt`。
- 最终执行 `git diff --check` 通过，检查工作区状态及本轮增量；保留原有/并行修改，未提交、建分支或发布。验证未使用真实用户密钥、上游账号或 OBS；真实 Electron GUI、DPAPI 和断电恢复没有实测。
