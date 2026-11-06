# 客户端与服务器效率修复实施计划

Status: Completed

2026-11-06，用户已授权并行修复上一轮审计中不改变正常使用的效率问题。本计划遵守根 `PLANS.md`，使用当前会话的原生子代理执行，不提交、切分支或部署。

## 目标与当前证据

保持产品输出、授权、账本一致性、保存恢复和页面操作不变，消除审计确认的九项正常路径工作量放大。审计证据位于仓库根 `output/efficiency-audit-2026-11-06/`，作为问题复现，不替代现行规范。代码仍需按当前工作区重新核对。

已有证据：服务器一条当天礼物导致两遍 5001 行汇总候选；客户端 100 次队列通知引发 50 万聚合输入；当天礼物增一条重读 51 页；32 层画布的 60 次几何更新触发 1920 次外观序列化；服务器概览产生二次查找和未使用租户聚合；单 UID 陪伴观察读完整名单；容量拒绝全局重验；五会话预览空闲模拟一分钟 2700 次本机请求。

## 边界与兼容约束

- 本轮不处理默认关闭的物理删除清理、非默认慢轮询配置、图片目录 P3 观察或歌库分页体验决策。
- 保留现有 HTTP/WS/IPC、字段、页面 URL 和持久数据。需要兼容扩展时先记录所有者、消费者及回退方式，不静默删字段或改变授权。
- 保留 tenant/source/owner/generation 隔离、每段发送前新鲜校验、迟到 final、跨日、外部写入、独立核对与 fail-closed。
- 保留画布撤销、共享/独立外观、lease、ACK、重放、恢复、撤销授权和取消进行中请求。性能缓存不能成为新的状态权威。
- 不改变真实用户数据库、凭据、正在运行的应用或远程服务。验证使用隔离夹具，临时内容只放各仓库 `tmp/efficiency-fixes-2026-11-06/`。
- 两仓库已有大量并行修改。已记录初始状态、工作区与暂存 diff；每组还须保存其编辑前文件副本，按任务差异复核，避免覆盖其他工作。

## 所有者与并行工作

| 组 / 负责人 | 审计项 | 实现所有者与消费者 | 测试和文档所有者 |
| --- | --- | --- | --- |
| server_storage | A01、A05、A06 | Server `gift-summary-store` / 维护调度；`public/admin/app.js` / overview；admin overview API / monitor manager | `gift-retention.test.js`、`admin-live-state.test.js`；Server 数据边界、gift-retention、management-api、相应 requirements/acceptance |
| server_realtime | A07、A08 | Server guard-membership、guard-roster reader/API；danmaku scheduler 及 producer 验证回调 | guard-membership / roster-sync、send-scheduler 及来源撤销用例；fan-facts、public-overlay-api、gift-interaction |
| client_rendering | A04、A09 | Live scene model/item controller/stage；component-preview dialog/remote/relay 与本机路由 | scene-item-notifications、scene model、component-preview、preview-browser；frontend app/comms/pages 及实际 owner 章节 |
| 主代理 | A02、A03、集成 | Live gift-query-store/query-service；gift-feed-state 与场景/独立来源消费者 | gift-query-service、gift-display-query、gift-banner-feed、websocket-transport；backend gift/storage 与 overlays |

各组只编辑自己的实现和直接测试。共享文档先通报章节；计划索引与本计划由主代理维护。发现跨组必要修改先协调所有者；不引入新进程、依赖或框架。

## 实施与验收里程碑

- [x] A01：限制汇总候选到实际新增贡献；对已覆盖历史复用检查结果或有界候选。完整核验旧 ID 迟到 final、跨日、外部写入、损坏账本、恢复构建，比较全构建总候选数，不能只减少单批大小。
- [x] A02：在礼物查询所有者缓存冲刺聚合，以可靠的连接内/外变化标记与 source scope 失效；验证队列通知不反复 SUM，礼物更新、reset、carry 和来源切换仍即时正确。
- [x] A03：在已有账本/显示查询边界减少整日重读，保留完整历史和更正/删除/跨日/档案补齐。实现前确定现有修订能否证明增量，不能盲目追加或只取第一页；必要的兼容回退须有直接回归。
- [x] A04：几何变化在外观构建之前短路，复用 ID 索引/稳定引用；必要时合并同帧位置更新。验证通知数、实际计算数、撤销和最终坐标，完整边界校验保持。
- [x] A05：管理状态建立一次索引/设备分组，只渲染可见页，一次刷新只渲染一次。保留筛选计数、告警导航、删除乱序和操作反馈。
- [x] A06：当前概览请求避免未消费的租户级统计，保留已有 API 消费者的完整返回能力；验证轻量路径和完整路径、租户不可用/身份库错误。
- [x] A07：只观察一个 UID 时允许可靠命中后停止分页，完整 roster 同步继续完整读；验证 owner/room/UID、取消/代次、目标不存在及并发共享。
- [x] A08：将不相关旧任务的全局维护从每次拒绝入队分离，保留无效任务容量回收和每段发送前撤权验证；验证拒绝输入规模、取消/关闭/过期/重试、跨租户与凭据轮换。
- [x] A09：减少空闲预览交换，复用本机通知/会话批次或有界等待，保持编辑响应、命令 ACK、重连、lease、保存与关闭。验证空闲请求数与真实编辑/恢复结果，不仅调大固定轮询间隔。
- [x] 集成：复核每组最小 diff、文档与指令同步，执行相关契约/架构/文档门禁，检查最后状态和 task-owned diff。

## 验证方式

先将现有审计复现转为所属套件中的具体性能回归，并确认旧实现失败，再实现与运行完整所属测试文件。不要加入只扫源码或复刻实现的断言。旧探针保存为基线；修复后的计数独立输出，不能覆盖原审计证据。

客户端聚焦起点：

```powershell
node --test --test-reporter=spec test/gifts/gift-query-service.test.js test/gifts/gift-display-query.test.js test/gifts/gift-banner-feed.test.js test/transport/websocket-transport.test.js
node --test --test-reporter=spec test/admin/scene-item-notifications.test.js test/transport/component-preview.test.js
npm run verify:docs
npm run verify:architecture
```

服务器聚焦起点（按修改实际依赖增加完整文件，运行时不编辑对应输入）：

```powershell
node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/gift-retention.test.js test/admin-live-state.test.js
node scripts/run-with-node.cjs --test test/guard-membership-service.test.js test/guard-roster-sync.test.js test/danmaku-send-scheduler.test.js
npm run docs:check
```

预览的本机传输与生命周期需要现有 browser/Electron 隔离夹具验证保存、重连与关闭；不控制用户应用。具体测试文件与隔离目录由负责组检查现有脚本后记录。若使用 Server verify，先运行相同选择的 `--plan`。不默认运行全量套件或真实账号验证。

## 文档与失败处理

实现事实变化同步 owning reference；涉及兼容参数/响应则同步 protocol、机器 schema 和消费者测试。用户入口和操作方式保持时，核对指南与交互引导后不做无关改写。所有文档 gate 的失败区分本次和并行改动。

若优化无法保留正确性，停止该项的实现并记录已确认冲突与安全替代，不以少校验、漏数据或延迟撤权换性能。回退仅逆向本任务改动，以编辑前副本和当前 diff 逐块操作，不使用 reset/checkout/clean 覆盖其他内容。

## 完成条件与执行记录

九项逐一有修复后计数及正确性证据；所有相关测试/文档一致，未完成的验证明确列出；没有真实数据、敏感内容或临时产物进入源码 diff；最终差异和状态完成复核。不能只凭测试全绿承诺绝对零风险。

- 2026-11-06：用户授权后开始并行修复；仓库状态及暂存/未暂存基线已保存于各自 tmp/efficiency-fixes-2026-11-06/。
- A02：先红（100次聚合，期望1），随后修复；gift-query-service 与 websocket-transport 两文件33/33通过，涵盖外部写入、回滚、carry、reset、原来源隔离。
- A01协调：现有schema迁移入口兼容新增3个内部checkpoint列，旧在途build默认all保持原路径；使用现有索引与当前工作区已有的retention完整性索引，不增加重复基础设施。需验证重复迁移与旧/新阶段恢复。
- A09协调：现有本机preview action可兼容增加有界等待，旧调用立即返回；等待必须可取消且不占用交换锁，保留lease和ACK。不增加远程服务。
- A03协调：仅给明确选择增量的本机history消费者增加可选delta字段及排序标识，旧客户端/普通分页仍保持原响应。复用连接内TEMP修订机制，保留有界变更日志；外部写入、日志缺口、连接/来源/保留快照变化退回完整分页，不持久化新表。同步管理路由、overlay授权投影和scene内部调用三条消费者。

### 最终实施与验证（2026-11-06）

- A01：5000 条已汇总历史后增加 1 条当天礼物，完整维护轮次从 5001 scan + 5001 verify 降为 2 + 2。三候选来源、六阶段恢复、旧 all 检查点、重复迁移、迟到 final、同时间索引续页及缺口失败关闭均覆盖；所属三文件 66/66，通过另一子代理只读复核。首次完整性索引建立或外部/schema 失效仍可全量检查，未把冷启动承诺为常数时间。
- A02/A03：100 个无关通知的冲刺 SUM 从 100 次降为 1 次；整日 5000 条后新增 1 条，刷新从 51 请求/5001 条降为 1 请求/1 条。保留完整 5001 条集合和精确排序，更正、隐藏、物理删除、日志缺口、回滚、外部写入、retention 成员及快照变化都有回归。交叉复核发现 rangeEnd 随 asOf 推进导致错误全读，已改绑定稳定 endDate，并补推进时钟红绿回归；独立 6 项时间/固定日期探针通过。主代理最终完整 8 文件 98/98。
- A04：32 层 × 60 次拖动，外观序列化 1920→0、find 回调 31680→0、完整文档序列化 300→60；仍检查几何和文档大小，保留撤销、取消与最后坐标。
- A05/A06：1000 主播概览刷新监控 ID 读取 5006000→2000、设备 owner 500000→0、隐藏表格行 1000→0。显式 summary=1 接口仅做 5 次共享身份库查询，取消额外 2000 次租户借用和 3000 条租户 SELECT；无参数旧接口保留。Admin 8 个完整 Node 文件 108/108；末次审计独立刷新修复后受影响 2 文件 57/57、4 个完整浏览器文件 49/49。需求、验收、OpenAPI 和协议同步。
- A07：3000 人名单中目标在第一页时，3 次陪伴观察从 300 页/9000 行降为 3 页/90 行；完整同步保持 100 页。目标缺失仍完整读取，迟加入查询使用原 3 秒预算。
- A08：原任意闭包可随设置/凭据直接写入失效，不能安全跨入队缓存。最终只让已证明等价的 thanks 谓词显式共享单次 prune 内结果；每次入队、finish 后与实际发送前仍新鲜验证。2 来源 80 任务、1000 拒绝从 80000→2000 校验；未知回调保持原语义，残余 O(queue) 廉价扫描保留。A07/A08 完整相关 Node 文件合计 379/379。
- A09：有界本机 long-poll 保留旧立即响应，状态变化即时唤醒并校验 owner/token/attachment/lease/license/phase；被动等待不阻塞 shutdown tracker。5 会话空闲模拟一分钟请求 2700→30；真实 Chromium 2 秒 7 次（含初次收束），编辑、保存、撤销、刷新和关闭通过。A04/A09 完整 Node 88/88、浏览器 26/26。
- 集成：客户端架构 30/30、文档 10/10，服务器文档/协议/架构组合门禁 59/59；范围语法客户端 31、服务器 18 文件通过。两仓库 git diff --check 通过，已检查 status 和各组 before 相对差异，保留既有暂存及并发改动。未执行全量仓库测试；全局语法运行中发现 A03 时间问题后主动终止，修复后使用上述范围检查，不宣称全局语法通过。
- 技术文档按 owner 同步；用户入口、步骤和可见限制不变，指南与交互引导核对后不作无关改写。未提交、打包、部署或操作真实账号/运行应用。
- 修复证据分别保留在两仓库 tmp/efficiency-fixes-2026-11-06/{root,client-rendering,server-realtime,server-storage}/；原审计产物未覆盖。服务器 tmp/gift-retention-reopen-OozVuW 为失败用例留下的合成数据，精确目录清理被工具安全策略拒绝，已保留且未绕过；不影响源码验收。
