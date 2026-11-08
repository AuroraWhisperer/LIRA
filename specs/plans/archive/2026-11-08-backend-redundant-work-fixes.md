# 客户端后端重复计算修复实施计划

Status: Completed

范围来自用户对 2026-11-08 审计报告的“全部修复”。

## 目标与边界

完成审计中的五项优化：礼物许愿重叠扫描、礼物统计重复归一化、WeSing QRC 解码及远程空结果重试、盲盒场景重复投影、同响应加班机快照重复读取。保留业务结果、数据隔离和恢复能力，以真实 owner 的工作次数及合成数据验证收益。

不涉及远程 Server、发布、提交、架构迁移或无关清理。当前工作区已有大量未提交修改，先保存任务开始状态，并在每个文件修改前复制到 `tmp/backend-fixes-2026-11-08/baseline/`；不得覆盖其他工作。

## 现状与证据

审计报告为 `output/backend-redundant-work-audit-2026-11-08.md`。30 个不同创建时间的长期许愿产生 31 次重叠扫描；10 万条统计记录产生 180 万次金额归一化；80 个未变化 QRC 在 20 轮检查中解码 1600 次并触发 40 次远程搜索；盲盒 100 次无关更新仍重复克隆完整榜单；100 次加班机输出读取 200 次快照。此前 243 项聚焦回归通过，不视作本轮修复验收。

## 责任、合同与兼容

| 组 | 拥有者与消费者 | 合同及验证 |
| --- | --- | --- |
| 存储 | `src/storage/gift-wish-store.js`、retention 查询、`gift-query-store.js`；wish-service / gift-query-service | `docs/reference/backend/storage.md`；gift-wishes、gift-retention、gift-statistics-service、gift-display-query |
| WeSing | `src/music/wesing-cache.js`、capture-engine、lyric-resolver、online-lyrics；`src/server/music-runtime.js` | `docs/reference/backend/music/wesing.md`；wesing 缓存、采集、自动恢复、在线匹配及 lyrics |
| 场景 | `src/server/scene-extra-display.js`、scene-components、scene-runtime、scene-shared-appearance；`src/scenes/scene-output-reader.js`；display-source | `docs/reference/backend/api.md`、`ws.md`、相关场景合同；scene-extra-components、scene-runtime-events、websocket-transport、overtime |

维持每个许愿的精确时间区间、Shanghai 日边界、retention 汇总/贡献/活动成员去重、guard 与 variant 匹配、金额安全整数与错误语义。WeSing 保留已知 mid 的精确版本、手动刷新、自动最终恢复，缓存按文件身份失效，禁止跨账号泄漏或把临时失败写入长期歌词缓存。场景使用现有 dataVersions 协议，旧消费者完整响应保持兼容；缓存按实际数据、账号、过滤条件和日期失效；实时倒计时不得冻结。

## 实施与里程碑

- [x] 存储：用现有批量计数入口共享重叠扫描，各 CASE 保留独立时间过滤；将金额/数量归一化移入 materialized CTE。不同起始时间与 retention 混合数据回归已通过，storage 文档同步完成；最终串行性能采样随集成执行。
- [x] WeSing：在采集生命周期内缓存解析后的 QRC，按文件元数据重新核实；远程失败/空结果与本地 3 秒发现分离，使用 30→60 秒退避及同请求合并，身份/偏好/认证变化和手动刷新可以立即重试。文件替换、未命中恢复及调用次数回归通过；音乐合同已同步。
- [x] 场景：扩展盲盒 dataVersions，未变化时跳过克隆、投影和传输；同一次响应复用加班机快照供共享背景读取。数据/账号/日期/过滤失效、旧客户端及动态时钟回归通过；场景合同已同步。
- [x] 集成：三组任务 diff 及场景独立交叉审查完成；415/415 相关回归、1790 文件语法、30 项架构和10项文档门禁通过。实际优化后的合成探针已串行执行；性能结果明确区分函数调用降幅与总查询提速。

三个组由已有审计子代理并行实施，文件职责互不重叠；主代理处理计划、交叉审查和集成。新增测试先确认能复现原问题，再验证修复；不运行外部服务或真实用户数据，不变更用户正在运行的应用。

实现细化：盲盒复用 `blind-box-analysis.js` 原有内容/来源/日期缓存键，通过 gift 门面及 `api-context.js` 交付，避免场景另建一套日期判断。WeSing 在现有 provider registry 内提供无秘密的认证变更版本，比较内存会话 Cookie，避免每轮调用会读取磁盘并解密的 auth state。

## 验证

各组先执行各自命名的实际测试文件，完整命令及结果在交付时记录。集成阶段使用 `node --experimental-vm-modules --test <受影响测试文件>`，`npm run check`、`npm run verify:architecture`、`npm run verify:docs`。这些静态和边界门禁用于跨模块缓存/场景协议改动；不默认执行整个测试库。合成性能探针放 `tmp/backend-fixes-2026-11-08/`，核对结果相等、工作次数与冷/热缓存或失败恢复；不以机器耗时阈值作为自动化测试断言。

最后检查任务相对 baseline 的 diff、`git -c core.safecrlf=false diff --check`、`git status --short`，确认没有运行时数据或敏感资料进入改动。测试与技术文档随实现同步；用户指南仅在操作或恢复说明受到影响时修改。

已取得的证据：存储组 59/59 聚焦回归通过；实际 owner 计数证据为许愿明细扫描 31→1、10 万条统计金额 UDF 180 万→30 万、数量 UDF 30 万→10 万。主代理独立 `node tmp/backend-fixes-2026-11-08/storage-differential.cjs` 比较 baseline 及当前实现，160 批共 9,600 个请求一致，覆盖保留/未保留、独立时间窗口、汇总修订、成员与来源排除、贡献 epoch、guard/variant/盲盒旧名称。

完成证据：`output/backend-redundant-work-fixes-2026-11-08.md` 记录分组命令、实际数据和边界。七轮交错新旧 owner 中位数：许愿 3326.04→357.45 ms（9.30×），统计1007.09→659.20 ms（1.53×）。WeSing 20 轮热复查解密1600→0、平台搜索40→2；5000用户盲盒100轮响应28,487,500→90,200字节；加班机100轮快照200→100。用户指南无需修改；未提交、打包或实播。工作区既有修改及并行音频助手修改保留，暂存区未变。

## 失败处理与完成条件

失败时先用聚焦用例定位所属组；必要时仅逆转本任务相对 baseline 的改动，保留既有工作，禁止 reset/checkout 清理。只有五项已实现、工作次数证据成立、恢复与隔离回归通过、合同同步及最终 diff 复核完成才能标记 Completed。结束后按 PLANS.md 保留有价值的验收证据并从活动计划区归档。
