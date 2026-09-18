# 模块化存量与函数债务

日期：2026-09-13。对应[复审报告](../../client-modularity-reassessment-2026-09-13.md)批次 D；规则见[模块化规范](modularity-standard.md)。

## 文件登记与复审

[modularity-baseline.json](modularity-baseline.json)是当前文件上限和逐文件评估的唯一登记处，包含 `review`（警告区）、`legacy`（待整改超限）与 `exception`（有具体理由的放宽）。已有 A 批次变更已经降低部分文件，因此不复用报告的历史 63 项计数。

每条记录的 `owner` 是负责评审的代码领域；`test` 是须维持的现有保护测试，不代表该测试证明所有边界正确。`reason` 记录职责及保留/拆分理由，`removal` 给出提取替代方案或取消例外条件。所有记录初次复审期限为 **2026-12-13（UTC，当天有效）**，应在此前或实质修改时复核；续期必须重新检查当前源码，不自动延期。

常规整改流程：按职责改源码 → 运行对应保护测试 → 用仓库格式化配置整理适用文件 → 重新计数 → 下调上限；降到 601–800 行时将 `legacy` 改为 `review`，降到 600 或以下时删除文件规模记录。未完成的函数债务不会因为文件变短自动清除。删除/重命名文件须同步登记；不接受无理由的新 legacy 或提高旧上限。静态例外若不再满足纯数据/帮助内容职责，必须取消例外并重新设计边界。

## 已知长函数：保留一个状态所有者

### 2026-09-18 粉丝档案增量复核

新文件经 Prettier 3.9.8 格式化后均低于 600 行。`createFanUi` 保留单一选中项、编辑草稿、账号上下文和弹层生命周期；备份/恢复/合并多步界面已按职责抽为 `createFanTransferUi`。`createFanProfileService` 保留同一 scope 内的同步事务协调；校验、会员算法、提醒、事实消费、合并、传输以及 SQL 均已独立。`createFanFactConsumer`、`createFanBackupService` 与各 store 的闭包只持有本领域的注入 store/clock，未共享全局当前主播。

这些工厂及 `summarizeMembership` / `buildReminders` 超过 120 行的跨度显式暂缓拆分：当前每个分别负责一组完整状态/证据计算，进一步机械拆分会分散事务、提醒事项或取消不变量。负责人为粉丝档案领域维护者；保护为 fan-profiles-domain/music/transfer/merge/ipc 测试和 Electron 虚构资料验证。2026-12-18 前或扩展会员来源/第三阶段能力时复核，出现独立状态机即提取；不以文件行数通过宣称函数全部合规。组合根与迁移注册表新增内容已逐项记录在 baseline；不提升不相关文件上限。

下面跨度沿用复审报告的定位口径，是整改起点；不是新一轮全库 AST 检查的结果。每行的文件与函数是定位标识，后续移动行号不改变所有者。下次实质修改或上述期限前须重新测量并记录处理结果。

| 文件 / 函数                                                                                         |        报告跨度 | 所有者与暂缓原因                                                 | 下一步与退出条件                                                                                | 保护测试                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------: | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `public/js/admin/import.js` 模块 IIFE；`parseTable`；`initCloudSongSync`                            | 620 / 131 / 142 | 歌单导入入口；解析与云 UI 确有独立职责                           | 批次 B 已提取解析、云同步和背景 UI；parseTable 80 行；原入口与两类 UI 初始化闭包继续登记        | `test/song-import-table.test.js`、`test/song-import-update-ui.test.js`     |
| `public/js/admin/todo.js` 模块 IIFE；`init`                                                         |       743 / 154 | 规划器状态模块；保存及读失败禁止写回必须集中                     | 批次 B 已提取只读视图与动作；init 47 行，状态 IIFE 491 行继续登记，写保护保持集中               | `test/toolbox-todo.test.js`                                                |
| `public/js/overlays/danmaku-feed.js:createDanmakuFeed`                                              |             520 | 弹幕生命周期；消息队列、计时与布局仍归 feed                      | 批次 B 已提取消息渲染器；feed 工厂 379 行继续登记，队列、布局和定时器保持集中                   | `test/danmaku-feed-buffer.test.js`、`test/danmaku-overlay.test.js`         |
| `scripts/inspect-wesing-playback.js:runDiagnostic`；内部 `start`                                    |        217 / 98 | 诊断 CLI；日志和终端资源需有完整停止顺序                         | 批次 B 已提取日志探测器和终端资源；runDiagnostic 180 行继续登记，停止刷新与退出顺序由 CLI 组合  | `test/wesing-playback-diagnostic.test.js`                                  |
| `src/electron/license/license-manager.js:createLicenseManager`；`authenticate`                      |        560 / 86 | 授权管理器；token、续期代次和撤销不能分散                        | 2026-09-16 B1 修复后复核：工厂物理跨度 595 行，文件 647 行已登记；请求主体、会话失效与维护任务共用单一 owner，后续只提取独立协议或纯转换 | `test/license-manager.test.js`、`test/license-manager-identity.test.js` |
| `src/electron/main.js:startDesktopApp`                                                              |             323 | 桌面组合入口；保留创建与销毁顺序                                 | 批次 C 已提取就绪导航/恢复；当前启动函数 237 行，保留资源接线和统一停机，后续按阶段评估         | `test/electron-main-modules.test.js`、`test/electron-startup-data.test.js` |
| `src/overtime/overtime-service.js:createOvertimeService`；`resolveGiftSettlement`                   |        593 / 65 | 加班机；规则快照、随机结算、恢复和提交强关联                     | 批次 B 已改具名结算输入；65 行结算及 593 行状态工厂不变，后续只提取独立纯计算                   | `test/overtime-service.test.js`                                            |
| `src/server.js:createServerRuntime`；`initializeApplication`                                        |       702 / 143 | 服务入口；统一启停与失败清理仍需单一所有者                       | 批次 C 已迁移广播适配；当前工厂/初始化 694 / 117 行，保留统一启停与失败清理                     | `test/server-lifecycle.test.js`、`test/server-smoke.test.js`               |
| `src/electron/remote-gift-controller.js:createRemoteGiftController`                                 |             725 | 远端礼物同步；授权/来源代次、串行任务和取消共用状态              | 批次 C 已提取纯恢复规则；工厂仍为 725 行，后续按真实协议阶段评估；代次/取消保持单一所有者       | `test/remote-gift-controller.test.js`                                      |
| `src/storage/database-maintenance.js:clearAllData`                                                  |             295 | 存储协调；多库部分提交不是全局原子事务                           | 批次 C 已完成：具名输入 coordinateClearAll 为 80 行，事务内操作及结果独立；公开位置参数保留兼容 | `test/database-clear-all.test.js`                                          |
| `src/storage/database-migrations.js:runAllMigrations`；`migrateLegacySuperChatsToDedicatedDatabase` |        305 / 81 | 手写历史迁移；版本、SQL 和数据转换语义须稳定，不是 snapshot 例外 | 下一次实质修改对应库迁移时提取注册/转换；新增大型迁移独立注册，保持旧版本执行顺序与幂等         | `test/database-maintenance.test.js`、`test/superchat-store.test.js`        |

## 已知复杂度与嵌套风险

- 目录校验已迁至 `remote-catalog-contract.js` 与 `remote-catalog-image-policy.js`：`normalizeRemoteCatalog`、`normalizeRemoteGift`、`normalizeImagePath` 的当前跨度 / 分支估算分别为 38/11、27/9、23/11；原刷新回调仍为 85 行 / 分支估算 29，保留单一请求生命周期，继续登记。保护：`test/remote-catalog-cache.test.js`。
- `database-maintenance.js:clearAllData`：批次 C 已完成内部具名输入及事务内操作/结果提取，协调器 `coordinateClearAll` 为 80 行。隔离数据库覆盖清理失败、提交中途失败、回滚失败与来源隔离；旧的 295 行/分支估算 24 债务已收敛。
- `createBubble` 已迁至 `danmaku-message-renderer.js` 并按头像、身份、表情细分，当前 29 行 / 分支估算 7。渲染器工厂 171 行只持有渲染配置，继续登记跨度；安全文本与图片处理保持。保护：`test/danmaku-overlay.test.js`。
- 诊断资源已提取至 `wesing-log-probe.js` 与 `wesing-diagnostic-terminal.js`，停止刷新、输入模式恢复及清理失败均有隔离回归。日志探测工厂 125 行继续登记资源跨度。
- `admin/overtime.js:renderGiftPicker` 已按选项过滤、节点构造局部拆分，当前 43 行 / 分支估算 14；搜索代次、身份与房间/全局来源仍在原控制器。保护：`test/overtime-gift-picker.test.js`。

局部改造后重新检查输入输出、真实消费者和依赖方向。复杂度估算不等于正式 ESLint 指标；本清单只覆盖报告已指出的生产函数风险，不豁免其他短文件中的长函数，也不证明所有测试回调或分析器已满足函数规则。

## 批次 C 重测记录

2026-09-13 使用同版本 Prettier 整理并按 AST 起止位置重测，不扣除嵌套函数。清库协调器 80 行；`startDesktopApp` 237 行；`initializeApplication` 117 行；`createServerRuntime` 694 行；远端礼物工厂仍为 725 行。新就绪控制器工厂 123 行（含独立回调），拥有订阅、恢复代次与销毁；内部导航工厂另管 loadURL 代次。123 行工厂显式登记审查，后续只在出现独立协议职责时继续拆，不把可变状态散到依赖袋中。迁移后的事务内来源清理函数 86 行、既有窗口创建 86 行、服务器启动 88 行仍保留单一职责，不能因文件下降就声称函数全部合规。

保护：`test/desktop-readiness-controller.test.js`、`test/remote-gift-recovery-rules.test.js`、`test/runtime-event-publication.test.js`，以及既有清库、礼物控制器、授权、启动和停机回归。

## 批次 B 重测记录

2026-09-13 使用 Prettier 3.7.4 整理并以 Babel AST 起止位置重测，包含内部回调跨度。除上表保留的状态/资源工厂外，导入入口 IIFE 91 行、云同步初始化 113 行、背景初始化 92 行、礼物历史初始化 84 行仍作为单一界面接线职责保留，后续实质修改时复核；文件变短不代表全部函数已达标。

静态分析器的 `scanExpression` 从报告的 164 行 / 分支估算 45 降至 35 行 / 分支估算 20；`sanitizeSource` 121 行包围单一扫描游标及词法协作者，`collectDeclaredNames` 仍为 76 行 / 分支估算 23，作为启发式分析器债务登记。位置保持与字符串、模板、正则/除法及数字字面量已补回归；此分析器仍不是完整 JavaScript parser。
