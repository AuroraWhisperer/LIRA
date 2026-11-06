# 第三轮重复工作审计

Status: Completed (2026-11-06)

## 目标与边界

从数据投影、素材索引、不可见界面和多租户发送队列继续审计，以真实 owner 的操作计数确认工作量放大，修复已证实热点。前两轮结果见 [首轮](2026-11-06-repeated-work-audit.md) 与 [复审](2026-11-06-repeated-work-audit-followup.md)，不计作本轮新发现。

保持现有 HTTP/IPC/WebSocket、持久化格式、事务、鉴权和数据隔离；不增加依赖、后台服务或设置键。保留用户全部并发修改，不提交、发布或操作真实账号。探针只使用各仓根 `tmp/` 内合成数据。

## 已确认问题与所有者

1. 普通弹幕只需关键词开关和规则，却在真实 `MessageHandlers → domain-services → settings-store` 路径中取得三次完整设置。1,000 条消息、277 个设置计数为 3,000 个快照、831,000 个复制属性。`bilibili-message-handler.js` 的内置指令解析不消费 settings，可在普通非命令时提前返回；SC 关闭的原拒绝优先级须保留。`settings-store.js` 增加按键投影，`domain-services.js` 的关键词适配器只取两个字段。完整快照独立性、内部键隐藏、写入后失效和回滚不变。测试归 `test/settings/settings-contract.test.js`、`test/bots/custom-reply-service.test.js`、`test/songs/queue-service.test.js`；文档归 `docs/reference/backend/storage.md` 与 `docs/reference/backend/bilibili/danmaku.md`。
2. `component-style-index.js` 缓存命中仍深复制全库，`scene-shared-appearance.js` 为一个样式展开整库。200 包、2,000 样式、100 次单样式读取复制 200,000 份样式。新增受控的按样式读取，保持每个公共外观请求只取得一次已验证索引、返回独立对象、按 root 隔离、removed 历史可读，以及外部变更、备份恢复和版本拒绝。`component-style-store.js` 的 `list` 另对每包两次扫描全部历史包；1,000 包为 2,000,000 次包匹配。一次构造套装身份集合并复用分类，保留历史多类别必须来自同一包的语义。沿用 `test/scenes/component-style-recovery.test.js`、`component-styles.test.js`、`shared-appearance.test.js`；文档归 storage 参考。

## 其他审计分支

- AI 设置账号轮询已确认：显示、切主页面、切百宝箱面板、文档隐藏、恢复五阶段各模拟十分钟，每阶段仍有 200 次本机状态请求；OpenAI 订阅另重建 200 次账号选项。`pagehide` 已正常清理，不是关闭后泄漏。修复归 `public/js/admin/ai-assistant-settings.js`，观察既有主页面 active、子面板 hidden、document visibility；隐藏停调度、恢复立即刷新，保留独立 OAuth owner。使用 `test/helpers/ai-settings-fixture.js` 和 `test/ai/frontend-admin-ai-settings.test.js` 验证。
- `D:/Work/lira-server` 的 DailyBot 有效性复核已确认：20 租户各 4 项合法待发送任务、每库 1,000 项，单次重复签到被冷却拒绝却解析 82 份完整词库；30 次共 2,460 次解析、246 万项、40,716,900 字节 JSON 输入。修复限定 `src/storage/daily-bot-store.js` 与 `src/modules/danmaku/daily-bot-service.js`，复用当前原文的只读运行时配置或窄投影，保留发送前实时开关、revision、租户隔离、事务回滚与排队取消语义。测试归 `test/daily-bot-store.test.js` 与 `test/daily-bot-runtime.test.js`，文档归 `docs/protocol/daily-bots.md`。不得取消共享 scheduler 的必要复核。

## 实施与验证

- [x] 设置投影与非命令早退：修复前两个回归分别复现返回全 277 键和普通消息仍读设置；修复后八套 111 项回归通过。相同 1,000 条消息的设置快照属性复制 831,000→4,000，读取调用 3,000→2,000。这是内存投影计数，不是 SQL 次数。已更新 storage 与 danmaku 参考。
- [x] 素材按需读取和套装索引：修复前共享外观回归复现全库 clone `1 !== 0`；修复后三套 scene 测试 41/41 通过，新增 reader 副本隔离、同次快照稳定、外部变更和恢复验证。相同 2,000 样式、100 次单样式读取的复制数 200,000→100；两索引 stat 仍 200、根目录 lstat 仍 100，暖缓存 JSON 读取和目录扫描仍为 0。1,000 包列表的全库套装比较 2,000,000→0，改为 1,000 次分类检查加集合查询（原分类检查为 4,000 次）。已更新 storage 参考。
- [x] AI 可见性轮询：修复前回归复现初始隐藏仍请求；修复后两个前端测试文件 43/43 通过。相同十分钟输入，主页面切走、子面板切走、文档隐藏时两种账号状态查询各 200→0，订阅列表重建同步 200→0；可见时仍 200，恢复为 201（含立即刷新）。导航完整读取复用、在途跨隐藏/恢复不重入和 pagehide 不重启均通过。
- [x] 服务端词库复用：两套完整测试 18/18、`docs:check` 59/59 通过。20 租户冷读取 20 个词库各解析一次（20,000 项）；暖缓存单次 / 30 次重复签到整库解析分别 82→0 / 2,460→0。SQL 原文读取和比较、来源/开关/revision 复核保留。管理结果独立、事务回滚、其他数据库连接写入即时可见、租户隔离与日结果稳定均已验证。依赖只安装于服务端根 tmp，package/lock 无改动。
- [x] 技术参考已同步 storage、danmaku、frontend/app 及服务端 daily-bots；无新增字段、用户入口或操作步骤，相关指南和应用内引导仍准确，未机械修改。其他租户 broker 已按 streamerId 定位，全局同步仅单实例；礼物历史 reconciliation 为规范要求，保留。
- [x] 已审查本轮产品与测试 diff；Live 13 个修改 JavaScript 文件及 Server 4 个文件语法通过，两仓 `git diff --check` 通过并检查状态。未将探针、隔离数据库或测试依赖加入差异。Live 当前文档 10/10、Server 文档 59/59 通过。
- [x] 架构检查 27/28，唯一失败为并行修改的 `public/js/admin/overtime.js` 已无空 catch，但 `test/engineering/module-boundaries.test.js:38` 仍保留旧基线。已核对该文件的并发差异，不属于本轮修改；保留原工作，不删除基线或改动加班机，不将本轮报告为全仓门禁全部通过。

代理按分配文件实施，主代理维护 Live 计划和技术参考。所有测试使用隔离数据；操作次数不代表实机 CPU/帧率或生产吞吐收益。失败时检查该项最小差异，只逆向撤销本轮所加片段，不恢复整文件、不覆盖并发更改。

本轮不同相关用例共 213 项（设置/弹幕 111、素材 41、AI 前端 43、服务端 18）。SC 保持原拒绝顺序的最后简化后重跑 68 项桥接消费者，均通过，不重复计数。执行命令：

```powershell
node --test test/settings/settings-contract.test.js test/settings/settings-bootstrap.test.js test/settings/monitoring-settings.test.js test/cloud-sync/cloud-settings-sync-recovery.test.js test/bots/custom-reply-service.test.js test/songs/queue-service.test.js test/songs/song-cooldown.test.js test/songs/random-song-filter.test.js
node --test test/scenes/component-style-recovery.test.js test/scenes/component-styles.test.js test/scenes/shared-appearance.test.js
node --experimental-vm-modules --test test/ai/frontend-admin-ai-settings.test.js test/ai/frontend-admin-ai.test.js
```

服务端使用 Node 24.15.0 和本轮 `tmp/repeated-work-audit-round3-2026-11-06/dependencies/node_modules` 的锁定依赖运行 `test/daily-bot-store.test.js`、`test/daily-bot-runtime.test.js`；当前检出原依赖配置不变。计数证据分别为 Live 根 `tmp/repeated-work-audit-round3-2026-11-06/{settings,assets,ui}/` 和服务端同名 tmp 目录的 `daily-bot-counts.before.json` / `daily-bot-counts.after.json`。所有数据均为合成数据，没有真实账号、直播软件实播或生产容量测试。

## 完成条件

五处确证热点的原行为保留、重复工作计数下降、直接相关回归通过、技术文档和用户指导影响已核对、最终差异审查完成。架构门禁的并行基线失配已单列；未实测的外部账号与生产服务明确列作限制，不声称穷尽全仓效率问题。无提交、发布或部署。
