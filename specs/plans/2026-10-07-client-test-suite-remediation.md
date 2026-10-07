# Client Test Suite Remediation Plan

**Status:** Awaiting Verification

## Goal

按 2026-10-07 全目录测试审查结论分批落实 P0–P3：修正错误分组、隐藏顺序依赖、伪测试和端口/时钟竞态；为已核实的高风险缺口补测试；合并碎片文件、删除重复与装饰断言、收拢重复 helper；降低浏览器和工具测试的冗余耗时。

## Non-goals

- 不修改产品代码、存储、权限、公开协议或桌面生命周期。新增测试若暴露产品缺陷，只记录复现并报告，不顺手修复，也不提交失败或跳过的测试。
- 不删除 `src/bilibili/gift/guard-thanks.js` 等疑似死模块，不删 `desktop-runtime` 旧分支；这些属于产品决定。
- 不新增测试框架、运行依赖或通用解析器；不提交、分支或发布。

## Current Behavior

- 547 个测试文件、约 3190 个顶层用例；全量约 2.3 分钟（6 并发），浏览器组约占一半 CPU 时间。
- 审查发现：6 个启动 Chromium 的文件未登记 browser 组；约 24 个不依赖服务器的用例因模块级 `readServerFixture` 被锁在 contracts 组；4 个文件依赖其他测试预先创建 `tmp/`；`gift-maintenance` 伪回滚；`server-smoke` 端口探测竞态；`electron-shutdown` 夹具的 require 白名单使每个新增 main 依赖同时打断 38 个用例。
- 已核实的缺口：动态抽奖服务归属/幂等/互斥、旧 SuperChat 迁移、`resolve-stream` 会话令牌注入、`dailyBotRequest` 路径校验、B 站凭据写入校验、SuperChat 入口、保留期删除、盲盒配置迁移等。
- 基线（改动前，工作区含其他任务的未提交产品修改）：offline 组 71 个用例失败于 13 个文件；browser/desktop 组结果及测试快照保存在 `tmp/test-remediation/baseline/`。contracts 组因本机服务器检出与锁定提交不一致无法运行。

## Ownership

`test/<领域>` 拥有对应行为测试；`test/helpers` 提供共享夹具；`scripts/run-tests.js` 拥有运行分组；策略事实源为 [test.md](../../docs/reference/engineering/test.md) §6。

## Compatibility Constraints

保留安全、来源/租户隔离、数据完整性、协议与持久化、并发与重试、资源释放、无障碍、明确输出尺寸与用户设置应用的覆盖。合并或删除须给出承接用例。保留其他任务的未提交修改；临时文件只放根目录 `tmp/`。

## Proposed Changes

只改 `test/`、`test/helpers/`、`scripts/run-tests.js` 分组、`package.json` 的 `test:admin` 文件清单，以及引用被移动测试的文档链接。

## Milestones

- [x] P0 基础修正：browser 分组登记 6 个文件、4 个文件先创建 `tmp/`、`server-smoke` 改用临时端口（并发启停用例仍需预知端口而保留探测）、shutdown 夹具对未建模依赖返回惰性桩并由单一用例报告（38 项连带失败 → 1 项）、伪回滚改为触发器中途失败、runner 测试按分组推导 ui 浏览器清单。contracts 拆分与真实时钟用例随所属批次处理。
- [x] 批次 A：admin（共享浏览器 helper、-26 次 Chromium 启动、ZIP UI 上传 6→1、删 17 处无断言截图）、media（74→69 文件，+resolve-stream/cookie 快照/QQ 电台/歌词窗口缺口用例）、gifts-data（contracts 中 10 项改为 offline，+SuperChat 迁移/保留期/盲盒迁移缺口用例）。各自受影响文件相对基线无新增失败；缺口用例均经内存变异验证。
- [x] 批次 B：gifts-ui（contracts 拆分、guard-thanks 14.1→3.3 s、-3 文件）；live-interaction（daily-bot contracts 拆分、动态抽奖服务/SuperChat 入口/开播缺口用例、弹幕按样式文件合并、动态抽奖测试移入 `test/dynamic-lottery/`、观众刷新重试改为运行时用例）。
- [x] 批次 C：scenes/overlays/ui（scene-renderer 32→6 s、toast/text-box VM 用例回 offline）；accounts（dailyBotRequest 与 B 站凭据缺口用例、AI/授权文件合并、license IPC 夹具、云同步控制器拆分，设置恢复 4.8→0.37 s；按账号共享云后端 helper 因两套后端语义不同不做）；platform（更新控制器与资源完整性 IPC 缺口用例、健康检查与弹幕连接计时器去真实等待、server-contract 13.8→7.1 s、安装器静态用例合并）。

进度记录：各组报告的逐项结果与验证日志在 `tmp/test-remediation/<组>/`；发现但未修改的产品现象：盲盒分析按本机时区而查询服务按 Asia/Shanghai；`normalizeSuperChatPrice(-5)` 返回负值；组件选择器“套装”分类内容区重复标题；数字炸弹输出预期可能已过时。
- [x] 收尾：文档链接更新、全组回归、统计。

结果（2026-10-07）：测试文件 547→518，顶层用例约 3213→3161；offline 组失败 71→31（均为基线已失败文件，无新增，耗时 48 s），desktop 组二次运行全通过（36 s），browser 组 94–99 s。

剩余：browser 组并发运行时 `canvas-component-suites`“adding a suite clock…”两次全组运行均超时，单独或 6 文件并发运行通过，需确认是否与该文件改用共享浏览器有关；`component-style-library` 背景控件用例因其他任务在基线后修改背景参数界面而失败（测试代码与基线相同）；首轮 desktop 中 `local-instance-windows` 与 `danmaku-canvas-electron` 各一次负载性失败，重跑通过。contracts 组未运行（服务器检出与锁定提交不一致）。

## Verification

每批改前先跑受影响文件基线，改后重跑同一批及新文件并 `node --check`；收尾运行 `npm run verify:docs`、`npm run check`、offline/browser/desktop 组，并与基线失败清单对比。installer 组仅在改动其文件时运行；contracts 组受服务器检出限制，记录未运行。

## Rollback Or Failure Handling

对照 `tmp/test-remediation/baseline/test/` 快照逐文件撤销本任务增量，不覆盖其他任务修改。新测试失败先区分测试模型错误与产品缺陷；产品缺陷不放宽断言掩盖。

## Done When

P0–P3 已核实项目落实或注明不做的理由；受影响测试相对基线无新增失败；文档门禁通过；统计删除、合并、迁移、新增数量并说明未运行的环境。
