# 模块化存量与函数债务

建档日期：2026-09-13（持续更新）。起于 [复审报告](../../reports/2026-09-13-client-modularity-reassessment.md) 批次 D，现行评审口径见 [模块化规范](modularity-standard.md)。

## 评审口径说明

自 2026-10-04 起（[ADR-0023](../adr/0023-purpose-aware-file-size-review.md)），文件规模改为按类型、职责与用途评审，不再设行数硬上限（详见 [文件规模评审](modularity-standard.md#file-size-review)）。[modularity-baseline.json](modularity-baseline.json) 仅保留为历史快照，不再随文件增减或重命名维护。

本文专注跟踪尚未清理的**长函数、复杂度与职责耦合债务**：相关模块发生实质修改时一并复核，按真实职责决定保留或拆分，并用保护测试回归。文件行数变短不代表函数复杂度已消除，仅超过提示线也不自动触发重构任务。

## 2026-11-06 职责与依赖复核

本轮按静态依赖、实际调用方与状态生命周期复核客户端，以下结论用于更新下文历史表的保留判断（历史跨度不代表当前行数）。仅当某段逻辑具备独立的状态、资源或业务规则时才考虑拆分；单纯装配、共用同一事务或共享同一取消周期的逻辑仍归同一模块维护。

| 范围 | 当前归属与处理 | 保留理由与行为保护 |
| --- | --- | --- |
| Electron 启停与窗口 | `desktop-lifecycle.js` 独占退出意图、确认、幂等关闭与截止时间；`desktop-main-window.js` 独占窗口与导航；日志与更新状态归各自模块管理，移除 `desktop-state.js` | `main.js` 保留资源装配与释放顺序；由启停、请求鉴权及资源生命周期测试覆盖真实模块 |
| 授权与远端协议 | `device-authentication.js` 收拢完整设备证明逻辑；礼物/歌单/显示/云账号协议各自管理请求编码、DTO 与能力协商；`license-transport.js` 仅负责网络请求、SSE、重试预算与取消控制 | `license-manager` 保留令牌、账号切换代次、续期、撤销及待处理密钥顺序；由原授权、IPC、预算、中止与 SSE 测试保护 |
| 远端礼物 | `remote-gift-history.js` 负责完整历史分页与快照重启；来源键规则归恢复规则模块；删除已无调用方的旧 JSON 游标存储 | 控制器仍独占来源代次、串行调度与取消控制，防止分页任务写入错误来源；由历史/保留/归属隔离测试保护 |
| Admin 与播放 | 删除已无实际调用方的 Admin 全局桥与播放加载壳；模型选择、歌曲草稿、列表筛选与资源完整性视图各自管理状态 | Admin 显式初始化与注入能力；播放控制器保留统一装配。由启动、状态失效、歌曲编辑及菜单浏览器测试保护 |
| AI 与全民 K 歌 | AI 生成回合独立管理上下文快照、工具调用与安全审核；模型编解码模块收拢协议转换；全民 K 歌追踪器合并播放证据与时钟 | AI 服务保留队列、取消及投递确认后提交记忆；采集引擎保留 IO、歌词与缓存。由生成/投递、协议与播放时钟测试保护 |
| 领域与应用 | AI 配额、礼物模块均接收注入存储；消息业务决策归应用层消息处理器，维护恢复归既有维护运行时；结算、画布 reducer、场景输出与硬件缓存各自独立归属 | 领域层不导入 `storage`、`server` 或 `electron`；加班机事务、游戏回合与场景鉴权仍归原服务。由对应领域、传输与恢复测试保护 |
| 服务运行期 | `gift-sync` 运行时负责同步/保留存储、就绪状态与清理执行顺序 | `server.js` 保留部分初始化失败时的统一清理与 HTTP 生命周期；仅为初始化、销毁或快照多包一层宽泛上下文对象没有收益 |

静态依赖检查的覆盖范围与局限见 [模块化规范](modularity-standard.md) 第 7、8 节（静态无环不代表运行期动态调用无耦合，计算路径、回调与动态状态仍需代码评审与行为测试把关）。迁移注册表、稳定声明数据及生命周期独立的小模块按需保留，不按 600/800 行机械拆分。

## 已知长函数：历史保留判断

### 2026-09-18 粉丝档案增量复核

新文件经 Prettier 3.9.8 格式化后均低于 600 行。`createFanUi` 保留单一选中项、编辑草稿、账号上下文与弹层生命周期；备份/恢复/合并多步界面已按职责拆出为 `createFanTransferUi`。`createFanProfileService` 保留同一租户范围内的同步事务协调；校验、会员算法、提醒、事实消费、合并、传输及 SQL 均已独立。`createFanFactConsumer`、`createFanBackupService` 与各存储的闭包只引用注入的本领域存储与时钟，不共享全局当前主播。

上述工厂函数及 `summarizeMembership` / `buildReminders` 超过 120 行，显式暂缓拆分：它们各自封装了一组完整的状态或证据计算，机械拆分反而会打散事务边界、提醒逻辑或取消控制。由粉丝档案维护者负责，受 `fan-profiles-domain`/`music`/`transfer`/`merge`/`ipc` 测试及 Electron 模拟资料测试保护；计划在 2026-12-18 前，或扩展会员来源与第三阶段功能时复核，一旦出现独立状态机即行抽离。

下表跨度沿用原复审报告定位口径作为整改起点，并非最新全库 AST 扫描结果。每行以文件与函数名定位，后续行号移动不改变归属；下次实质修改或到期前须重新测量并记录处理结果。

| 文件 / 函数 | 报告跨度 | 归属与暂缓原因 | 下一步与退出条件 | 保护测试 |
| --- | ---: | --- | --- | --- |
| `public/js/admin/song-import.js` 模块 IIFE；`parseTable`；`initCloudSongSync` | 620 / 131 / 142 | 歌单导入入口；解析与云同步界面各有独立职责 | 已提取解析、云同步与背景界面；重测 `parseTable` 80 行、入口 IIFE 91 行、云同步初始化 113 行、背景初始化 92 行，仍作为界面装配职责保留 | `test/songs/song-file-codec.test.js`、`test/songs/song-import-update-ui.test.js` |
| `public/js/admin/streamer-planner.js` 模块 IIFE；`init` | 743 / 154 | 规划器状态模块；保存与读失败禁止写回必须集中 | 已提取只读视图与动作；重测 `init` 47 行、状态 IIFE 491 行，写保护保持集中 | `test/admin/streamer-planner.test.js` |
| `public/js/overlays/danmaku-feed.js:createDanmakuFeed` | 520 | 弹幕生命周期；消息队列、计时与布局归属队列模块 | 已提取消息渲染器；重测工厂 379 行，队列、布局与定时器保持集中 | `test/danmaku/danmaku-feed-buffer.test.js`、`test/danmaku/danmaku-overlay.test.js` |
| `scripts/inspect-wesing-playback.js:runDiagnostic`；内部 `start` | 217 / 98 | 诊断 CLI；日志与终端资源需保证完整停止顺序 | 已提取日志探测器与终端资源；重测 `runDiagnostic` 180 行，停止刷新与退出顺序由 CLI 组合 | `test/wesing/wesing-playback-diagnostic.test.js` |
| `src/electron/license/license-manager.js:createLicenseManager`；`authenticate` | 560 / 86 | 授权管理器；令牌、续期代次与撤销不可分散 | 2026-09-16 B1 修复后复核：工厂跨度 595 行（文件 647 行）；请求主体、会话失效与维护任务保持单一归属，后续仅抽离独立协议或纯转换 | `test/license/license-manager-renewal.test.js`、`test/license/license-manager-identity.test.js` |
| `src/electron/main.js:startDesktopApp` | 323 | 桌面组合根；保留创建与逆序销毁顺序 | 已提取就绪导航与恢复逻辑；重测启动函数 237 行，保留资源装配与统一停机，后续按阶段评估 | `test/desktop/electron-main-modules.test.js`、`test/desktop/electron-startup-data.test.js` |
| `src/overtime/overtime-service.js:createOvertimeService`；`resolveGiftSettlement` | 593 / 65 | 加班机；规则快照、随机结算、恢复与提交强关联 | 已改为具名结算输入；65 行结算函数与 593 行状态工厂不变，后续仅抽离独立纯计算 | `test/overtime/overtime-service.test.js` |
| `src/server.js:createServerRuntime`；`initializeApplication` | 702 / 143 | 服务组合根；统一启停与失败清理需单一归属 | 已迁移广播适配；重测工厂 694 行、初始化 117 行，保留统一启停与失败清理 | `test/server/server-lifecycle.test.js`、`test/server/server-smoke.test.js` |
| `src/electron/remote-gift-controller.js:createRemoteGiftController` | 725 | 远端礼物同步；授权/来源代次、串行任务与取消共用状态 | 已提取纯恢复规则；工厂仍为 725 行，后续按协议阶段评估，代次与取消保持单一归属 | `test/gifts/remote-gift-controller.test.js` |
| `src/storage/database-maintenance.js:clearAllData` | 295 | 存储协调；多库部分提交不是全局原子事务 | 已收敛：内部拆出具名输入协调器 `coordinateClearAll`（80 行），事务内操作与结果独立，公开位置参数保留兼容 | `test/storage/database-clear-all.test.js` |
| `src/storage/database-migrations.js:runAllMigrations`；`src/storage/legacy-superchat-migration.js:migrateLegacySuperChatsToDedicatedDatabase` | 305 / 81 | 手写历史迁移；版本、SQL 与数据转换语义须稳定 | 2026-09-22 已提取完整醒目留言跨库迁移，旧入口转发兼容；函数跨度债务保留，实质修改时复核，不改注册版本与事务顺序 | `test/storage/database-maintenance.test.js`、`test/gifts/superchat-store.test.js` |

## 已知复杂度与嵌套风险

- 目录校验已迁至 `remote-catalog-contract.js` 与 `remote-catalog-image-policy.js`：`normalizeRemoteCatalog`、`normalizeRemoteGift`、`normalizeImagePath` 的跨度 / 分支估算分别为 38/11、27/9、23/11；原刷新回调仍为 85 行 / 分支估算 29，保留单一请求生命周期，继续登记。保护：`test/gifts/remote-catalog-cache.test.js`。
- `database-maintenance.js:clearAllData`：已提取具名协调器 `coordinateClearAll`（80 行），原 295 行 / 分支估算 24 债务已收敛，由隔离数据库回归覆盖清理失败、提交中途失败、回滚失败与来源隔离。
- `createBubble` 已迁至 `danmaku-message-renderer.js` 并按头像、身份、表情细分，当前 29 行 / 分支估算 7；渲染器工厂 171 行仅管理渲染配置，继续登记跨度。保护：`test/danmaku/danmaku-overlay.test.js`。
- 诊断资源已提取至 `wesing-log-probe.js` 与 `wesing-diagnostic-terminal.js`，停止刷新、输入模式恢复与清理失败均有隔离回归；日志探测工厂 125 行继续登记资源跨度。
- `admin/overtime.js:renderGiftPicker` 已按选项过滤与节点构造局部拆分，当前 43 行 / 分支估算 14；搜索代次、身份与房间/全局来源仍归原控制器。保护：`test/overtime/overtime-gift-picker.test.js`。

局部改造后需同步复核输入输出、实际调用方与依赖方向；上述分支估算仅作评审参考，不替代正式 ESLint 复杂度指标，也不豁免清单外其他短文件中的长函数。

## 历史重测口径与未进表项

2026-09-13 使用 Prettier 3.7.4 整理并按 Babel AST 起止行重测（不扣除嵌套函数与内部回调）。除主表已记录的条目外，以下函数保留单一职责并在后续实质修改时复核：

- **桌面端与服务辅助函数**：就绪控制器工厂 123 行（管理订阅、恢复代次与销毁，内部导航工厂另管 `loadURL` 代次；仅在出现独立协议职责时拆分，不把可变状态拆散进可变依赖对象）、事务内来源清理函数 86 行、窗口创建 86 行、服务器启动 88 行、礼物历史初始化 84 行。相关保护：`test/desktop/desktop-readiness-controller.test.js`、`test/gifts/remote-gift-recovery-rules.test.js`、`test/server/runtime-event-publication.test.js` 及既有清库、礼物、授权与启停回归。
- **静态分析器**：`scanExpression` 从 164 行 / 分支估算 45 降至 35 行 / 分支估算 20；`sanitizeSource`（121 行）封装单一扫描游标与词法辅助逻辑，`collectDeclaredNames` 仍为 76 行 / 分支估算 23，作为启发式分析器债务登记（已补充位置保持及字符串、模板、正则/除法与数字字面量回归，不将其视为完整 JavaScript 解析器）。
