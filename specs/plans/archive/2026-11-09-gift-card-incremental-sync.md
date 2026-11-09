# 礼物卡片资料增量读取实施计划

**Status:** Completed

用户在联合性能审计第二轮后明确要求修复全日重复读取；2026-11-09 已完成两端实现、相关验证和联合测量。源码已完成，未提交、打包或上线。

## 目标与范围

同一账号、北京时间当天的连续新增礼物只传输新增资料；修改、删除、乱序终结及无法证明旧前缀稳定时完整重读。5000条已缓存资料后逐次新增5条，目标从130请求/25015条资料降至5请求/5条资料，结果必须与完整读取一致。

不改变卡片分组、金额、展示、用户操作、授权或礼物结算；不做持久化变更日志或引入新存储表/依赖。两仓已有其他聊天修改，按所属文件/段落维护；不提交、推送、上线。

## 当前行为与拥有者

服务端 `src/storage/gift-card-profile-store.js` 用账本revision确认未变，但版本变化后始终按日重读；`src/modules/bilibili/gift-card-profiles.js` 拥有专用DTO。客户端 `src/server/gift-card-runtime.js` 完整分页确认后缓存，main经 `src/electron/license/gift-protocol.js` 发请求，`src/shared/gift-card-profiles.js` 校验页面。现有成功回归覆盖账号/日期/epoch、头像、失败回退与旧版本。

协议源为服务端 `docs/protocol/client-server-api.md`、`device-api.openapi.json`、`fixtures/gift-card-profiles.json`、REQ/AC-GIFT-006；客户端 owning reference 为 `docs/reference/backend/bilibili/gift.md` 与 `docs/reference/backend/api.md`。ADR-0067的独立只读身份查询及UID边界不变，不重写已接受决策。

## 最小协议扩展

- 请求新增 `afterRevision`，使用已经完整接受的64位revision；仍可用 `revision` 做未变确认，cursor仍为公开eventId。只有服务端报告 `incremental:true` 后客户端才发送新参数。
- 响应可携带 `incremental:true` 表示支持该优化；只有可证明基线前缀没变时带 `append:true`，items仅包含基线之后的记录。没有append时完整替换缓存。旧客户端不发送afterRevision，仍读取完整页。
- 所有页必须有相同revision、day、epoch及append模式；只在完整成功后更新缓存和确认版本。追加时保留原数组不被迟到回复或后续头像修复改写；重复eventId视为无效增量，不悄悄重复卡片。
- 来源、日期、epoch变化清除旧依据，继续抛出既有GIFT_VIEW_STALE；普通网络/分页失败保留同来源同日且epoch未变的已接受缓存并标partial，不确认半轮版本。完整读取的首个新epoch允许整轮成功后替换。曾支持增量的服务器降级拒绝新参数时，本轮只重试一次旧格式完整读取。

## 服务端证明边界

连接内只维护有界revision检查点（最多256个）和单行TEMP失效计数，不保存资料副本或修改账本。旧资料更新/删除、INSERT/UPDATE OR REPLACE冲突、较小ID迟到final使旧前缀失效；新final在末尾时用既有ID索引读取追加。外部连接提交、schema/epoch/day/连接变化、检查点淘汰和外层事务读回退full。TEMP安装仅在事务外，失效计数随SQLite事务/保存点回滚；不能把未提交读取发布为可续接检查点。

## 里程碑与验证

- [x] 复核简单追加方案的回滚、REPLACE、外部连接和跨页语义，再完成两端规范与实现。
- [x] 服务端在既有gift-card-profiles测试中复现全日重复传输，覆盖追加分页、低ID终结、改删、替换、回滚、跨日/epoch/租户及重新打开后的fallback。
- [x] 客户端在gift-card-runtime测试中覆盖追加/替换、协议降级、部分失败重试、不一致页、旧服务器和来源fence；真实远端client/manager传递参数的既有测试同时更新。
- [x] 用隔离真实服务端SQLite及真实客户端runtime/HTTP解析做两仓联测，比较5000+5的请求、记录、字节与最终内容；测量局部耗时和TEMP触发器写入开销，分别报告边界。
- [x] 运行相关完整文件、两仓文档门禁，检查最终diff及输入指纹；归档可复现证据，完成后移至archive并更新索引。

服务端先 `npm run verify -- --node test/gift-card-profiles.test.js --plan` 再执行同范围，按新增触发器实际消费者补充检测/清理文件。客户端 `npm test -- --file=test/gifts/gift-card-runtime.test.js --file=test/license/remote-license-client.test.js --file=test/license/license-manager-operations.test.js --file=test/license/remote-license-response-budget.test.js`。文档分别 `npm run docs:check` 与 `npm run verify:docs`。测试运行期间不编辑相关输入。

## 失败处理与完成条件

任何不稳定来源或未完成分页都不提交增量结果；服务器无法证明旧前缀时显式回退完整页。只回退本任务拥有的改动，不重置他人文件。完成条件是上述实测数据量目标达到、增量最终资料等于完整读取、fallback场景不留旧数据、测试和规范同步、源码diff已审查；生产发布不在本次授权范围。

## 验证结果与证据

服务端实际使用 `--node test/gift-card-profiles.test.js --node test/gift-ledger-integrity.test.js`，先 plan 再执行；32/32 通过，末次计划复用两文件。客户端四完整文件 74/74 通过，最终空追加复用修改后 runtime 完整文件 29/29 再过，不重复累计数量。两仓文档门禁分别 60 和 10 项通过，归档后复核导航；独立代码审查未发现必修缺陷。

冻结原两端与新两端代码，经真实 SQLite、领域服务、HTTP、客户端 transport/endpoint/runtime 对比：5000 条缓存后五次各新增一条，从 130 请求/25015 条/3635825 字节降到 5 请求/5 条/1825 字节；六轮交错测量舍首轮后，耗时中位数 174.37→7.84ms，约 22.25 倍。八个恢复场景与三种新旧版本/降级组合通过。首次 5000 条仍需 25 请求，未变刷新仍每次一请求零资料。

额外发现并消除了空日高水位扫描历史的风险，5000 条旧 final 加今日 progress 流量的候选访问为零。收窄 TEMP 触发器以跳过普通 progress 更新后，单独八组交错写入测量舍首组：5000 组 progress、四次金额更新、final 和 delivery 的墙钟中位数 175.20→207.25ms（+18.3%，每组约 +6.4 微秒），进程 CPU 中位数 188→203ms。环境存在明显时间波动，原始轮次完整保留；不把同步读取收益泛化为整个客户端/服务器加速。

临时证据位于两仓 `tmp/gift-card-incremental-sync/`，长期报告及源码/日志/基线归入同级 `lira-audit/joint-performance-2026-11-09/gift-card-incremental-sync.md` 与对应 evidence 目录。性能脚本为服务端临时目录内 `integration-benchmark.cjs`，附 `--writes-only` 用于仅复测写入。未修改客户端固定服务端合同 SHA/fixture 锁；本次证明的是当前两仓工作树联测。没有真实 B 站流量、TLS/生产网络或桌面渲染测量，既有 UI/用户操作和 ADR-0067 的职责不变。
