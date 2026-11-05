# 2026-11-05 审计缺陷复核与修复计划

Status: Completed

19 项已复核并修复；534 项聚焦回归、1,710 文件语法、28 项架构与 10 项文档检查通过，最终差异已复核。

## 目标与边界

复核[审计报告](../../../docs/reports/2026-11-05-continuous-audit.md)的 19 项缺陷，在各自 owner 内修复实际根因，以直接相关回归证明问题消除和既有有效行为保留。5 项维护/优化建议不进入本次修改；不扩大审计、不操作真实用户数据/账号、不发布、不提交或创建分支。

原有工作区修改为审计报告、提示词、归档计划及其索引，均保留。历史报告的测试数字和未修复结论作为当时事实保留，本计划记录后续修复证据。临时产物只放仓库 `tmp/`。

## 当前证据与所有者

| 工作包 | 问题 | Owner / 消费者 | 回归入口 |
| --- | --- | --- | --- |
| 数据 | DATA-02/03/04/05 | `storage/retention`、`fans/profile-transfer`、`storage/legacy-superchat-migration`、`storage/gift-local-retention` / 数据统计、档案恢复、启动迁移、盲盒查询 | `test/storage/retention.test.js`、`test/fan-profiles/fan-profiles-transfer.test.js`、`test/storage/database-maintenance.test.js`、既有礼物保留期测试 |
| 素材与抽奖隔离 | SEC-01/02/03 | `electron/component-web-picker`、`server/component-web-references`、`server/component-web-library`、`electron/dynamic-lottery-auth*` / 素材导入、公开素材、抽奖认证与活动 | `test/desktop/component-web-picker.test.js`、`test/scenes/component-web-import.test.js`、既有抽奖认证/生命周期测试 |
| 前端状态 | FRONT-01—09 | 各原有缓存、编辑器、设置、复制、字体与菜单 owner / 管理页及播放器 | 对应 playback、gifts、fan-profiles、ai、planner、ui 既有测试 |
| 解析与图片 I/O | PERF-01/02、DATA-01 | `music/lyric-parser`、`bilibili/gift/remote-gift-image-cache` / Provider、歌词解析 HTTP、礼物图片初始化 | `test/lyrics/lyrics.test.js`、Provider/路由直接消费测试、`test/gifts/remote-gift-image-cache.test.js` |

代码位置均在 `src/`（前端在 `public/js/`）。路由/契约归属依据 `docs/reference/README.md` 与 `docs/architecture/engineering/ai-workflow.md`。各工作包先复核，再修改；误报或不满足触发前提的项不机械实施报告建议。独立代理只编辑分配 owner/测试，主代理统一修改共享契约与计划，避免同时改同一文件。

## 兼容与最小实现决策

- SC 迁移：实际无平台 ID 回退比较纳入规范化金额，保留稳定 ID、删除收据、原事务和失败保留源表。
- 档案恢复：在原事务内验证最终身份集合，只统一释放明确批准替换的目标，再插入；不清空账号资料、不移除唯一约束。
- 盲盒归档：用可空精确发生时刻兼容旧日桶；新归档按原事件时间区分，查询保持本机自然日。旧桶没有跨日分布，原样保留并明确精度限制，不伪造回填，不修改服务器北京时间汇总合同。
- 抽奖主体：沿用已有可信服务器 origin 规范化 helper，以 `[origin, streamerId]` 生成抽奖私有 scope，贯穿现有持久化/预算 owner；不冒充服务器发行的原账号 ID、不向远端发送私有 scope。旧无来源数据保留且不自动认领，需要重新登录。
- 素材选择：同目录正常导入保持；越界依赖须先由用户在原生选择器明确选择素材根，之后才能读取/递归收集，不自动提升权限范围。
- 素材/歌词解析：在现有 owner 单向扫描标记，消除失败时反复扫描尾部；歌词在展开和昂贵消费者之前限制行数/累计文本，并提供可诊断错误。保留正常多时间戳、YRC/QRC、翻译语义。
- 图片缓存：仅重试等待异步化，完整 await；索引写入串行且跟踪在等待期间产生的新 revision。原子替换、旧文件保留、失败清理规则不变。
- 前端：在既有 owner 固定操作对象/编辑意图、保留无关草稿、序列化保存、回收自身缓存和菜单监听、对字体暂态失败有界重试；不引入通用框架，不调整相邻视觉样式。

## 里程碑与验收

- [x] 四个工作包逐项核实，19 项均成立，未把 P3 临时成本夸大为永久泄漏，未把本机触发缺陷升级为匿名远程攻击。
- [x] 数据四项修复及对应回归：Unicode 字节数、UID 交换替换/回滚、不同金额迁移/重试、新归档跨时区前后统计一致与旧库保留。
- [x] 素材与抽奖三项修复及对应回归：明确读取边界、near-miss 输入有限时间结束、同 origin 重启/异 origin 同 ID/不同 ID/旧数据隔离。
- [x] 前端九项修复及对应回归：草稿与目标归属、逆序/迟到回执、缓存重启回收、失败恢复和监听清理。
- [x] 解析与图片三项修复及对应回归：异常歌词限时子进程、展开预算/普通语法对照、重试期间事件循环继续与并发索引不丢更新。
- [x] 同步受影响的技术契约和必要用户操作说明；不为未改变的步骤增写规则。
- [x] 最后编辑后检查 diff、`git diff --check`、`git status --short`，确认未夹带生成物/敏感信息/无关修改。

## 验证命令与同步范围

各包使用 `node --experimental-vm-modules --test <对应测试文件>`（CJS 文件可省 VM 参数），回归先失败后通过；算法成本采用受控子进程上限，不写脆弱耗时快照。最终统一运行 `npm run check`、`npm run verify:docs`、`npm run verify:architecture`，以及本次涉及的持久化/认证/消费者回归。明确变更范围后选择直接相关测试，不默认运行安装器、真实上游或完整发布套件。

技术同步涉及 `docs/reference/backend/storage.md`、`desktop/auth.md`、素材 API/制作指南、`backend/music/services.md`、`frontend/playback.md` 和受影响的 app/pages 说明，以及 `specs/gift-retention.md` 等真实合同变更。API/备份形状/操作未改变的项只记录影响评估，不强行改文档。新增公开限制或交互步骤须同步现有用户指南/使用说明对应位置。

## 失败处理与完成条件

失败时保留源数据和原事务；只检查及撤回本任务自己的修改，不使用 reset/整文件 checkout/广泛删除。不得绕过历史平台安全审查或自动审批拒绝，不恢复被中止的真实账号检查，也不重试被拒绝清理路径。

完成要求：19 项均有复核结果，成立项在最小 owner 修复并有足够回归；必要合同一致；已知不可恢复的旧数据精度/归属限制明确说明；最终 diff 通过范围审查。真实在线账号、直播软件、安装升级不在本次隔离验证中，不宣称已验收。

## 执行证据

- 初始：数据四项隔离复现均成立；前端九项与安全三项 owner 代码根因与报告一致，其中四项前端复现已独立重跑。歌词扫描与图片同步等待根因已由主代理直接核对。各包尚待修复后的回归证据。
- 数据组首轮 147、前端组 173、素材选择/导入 37、抽奖组 79 项通过；这是分组中间结果，不与最终回归数字相加。
- 最终合并去重 52 个直接相关测试文件，`node --experimental-vm-modules --test --test-concurrency=4 --test-reporter=tap <下列文件>`：534 项通过、0 失败/跳过，约 17 秒。完整结果 `tmp/audit-remediation-focused-tests.log`；FRONT-07 复用隔离夹具验证四场景，未引入大型常驻设施。
- 主代理对 QRC/YRC 做了 2,000 份有界样本的前后语义比较，结果一致；该诊断不计入 534 项。QQ Provider 原包装会丢失超预算类型，已补一条真实 provider/route 合成回归并保留正常 fallback。
- `npm run check`：1,710 JS 文件通过。`npm run verify:architecture`：28 项通过；首轮发现缓存新添空 catch 违反现有门禁，已改为明确报告不可用存储/删除损坏缓存，未放宽规则；修后缓存与边界聚焦 25 项及完整架构门禁均通过。
- `npm run verify:docs`：10 项通过；修正本计划状态标签格式后通过，归档及更新链接后复检仍为 10 项通过。最终复核确认产品改动对应上述 19 项，没有实施单列优化建议；`git diff --check` 通过，状态中无本次生成物或敏感数据。并行出现的窗口高度、礼物布局及其它界面/字体修改属于其它工作，原样保留；上述 534 项结果针对本次修复组合，不代表后续外部改动的验收。
- 技术参考同步存储 v21、SC 回退键、档案替换顺序、抽奖 origin scope、素材选择、歌词预算/错误、缓存/字体/菜单生命周期；使用指南只补素材目录确认、歌词限制和旧盲盒精度。其它修复恢复原有行为，HTTP/IPC/备份格式及操作步骤未变，未机械扩写指南。架构 owner/依赖方向未变，无需新增 ADR；页面入口与导览未变，不改 pages/interactive-tour 清单。
- 兼容限制：旧抽奖无来源数据保留但不自动关联，需要在新分区重新登录；旧盲盒日桶已丢失的跨日分布无法恢复。未读写真实用户库、未登录真实账号、未验收原生桌面登录或直播软件实播，未更改部署/安装包。

最终聚焦文件（每行均为仓库根目录相对路径）：

```text
test/admin/streamer-planner.test.js
test/ai/frontend-admin-ai-settings.test.js
test/desktop/component-web-picker.test.js
test/dynamic-lottery/dynamic-lottery-auth-ipc.test.js
test/dynamic-lottery/dynamic-lottery-auth.test.js
test/dynamic-lottery/dynamic-lottery-collection.test.js
test/dynamic-lottery/dynamic-lottery-provider.test.js
test/dynamic-lottery/dynamic-lottery-results.test.js
test/dynamic-lottery/dynamic-lottery-retention.test.js
test/dynamic-lottery/dynamic-lottery-scheduler.test.js
test/dynamic-lottery/dynamic-lottery-service.test.js
test/dynamic-lottery/dynamic-lottery-session.test.js
test/dynamic-lottery/dynamic-lottery-store.test.js
test/dynamic-lottery/dynamic-lottery-transaction.test.js
test/dynamic-lottery/frontend-dynamic-lottery-workflow.test.js
test/dynamic-lottery/frontend-dynamic-lottery.test.js
test/fan-profiles/fan-profiles-merge.test.js
test/fan-profiles/fan-profiles-transfer.test.js
test/fan-profiles/fan-song-retention.test.js
test/fan-profiles/frontend-fan-profiles-view.test.js
test/fan-profiles/frontend-fan-profiles.test.js
test/gifts/blind-box-analysis-dates.test.js
test/gifts/frontend-blindbox-admin.test.js
test/gifts/frontend-gift-wishes.test.js
test/gifts/gift-catalog-background-updates.test.js
test/gifts/gift-catalog-initializer.test.js
test/gifts/gift-frame-draft.test.js
test/gifts/gift-ledger-maintenance.test.js
test/gifts/gift-projection-service.test.js
test/gifts/gift-query-service.test.js
test/gifts/gift-retention.test.js
test/gifts/gift-sync-store.test.js
test/gifts/gift-wishes.test.js
test/gifts/hybrid-gift-catalog.test.js
test/gifts/remote-gift-image-cache.test.js
test/lyrics/lyrics.test.js
test/music/music-stream-route.test.js
test/music/netease-provider.test.js
test/music/qq-provider-streams.test.js
test/playback/playback-cache.test.js
test/playback/playback-home-lifecycle.test.js
test/playback/playback-queue-behavior.test.js
test/scenes/component-web-import.test.js
test/storage/data-clear-all-recovery.test.js
test/storage/data-clear-all-runtime.test.js
test/storage/database-clear-all.test.js
test/storage/database-maintenance.test.js
test/storage/query-optimization.test.js
test/storage/retention.test.js
test/transport/http-server-errors.test.js
test/transport/http-utils.test.js
test/ui/font-library-loader.test.js
```
