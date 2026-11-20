# 客户端测试精简实施计划

Status: Completed

2026-11-18 完成已核实审查项的精简与验证。本轮修改 8 个测试文件：删除 3 个无独立行为价值的完整用例，把 210 次逐字段矩阵检查收敛到既有 owner 分支覆盖，替换 8 处发布成功文案等待，并收窄重复状态、静态控件库存和无因果关系的全序断言。

## 目标与边界

减少无独立检测价值、绑定文案或内部写法的断言，把公共规则收敛到拥有者；保留权限、数据完整性、独立异常路径及真实界面集成覆盖。依据现行[测试策略](../../../docs/reference/engineering/test.md#6-测试约定)和本轮审查证据执行，不设用例数量或删减比例目标。

本任务只改变测试与必要的覆盖说明，不改变产品行为、接口、存储格式或已接受的架构。保留工作区其他任务的修改，不提交、创建分支或发布；修改前的任务基线位于 `tmp/client-test-refinement-2026-11-18/baseline/`。不为文件归档位置而扩大夹具依赖。

## 当前证据与职责

- 初始审查清单有 690 个测试文件；审查后的 5 文件定向基线 94/94 通过。已有隔离探针证明注释字串和函数引用身份会误报，而代表性独立边界能发现逐字段 schema 矩阵漏掉的上限变化。
- 工程边界由 `test/engineering/module-boundaries.test.js` 的依赖图与实际生命周期测试承接；函数名出现并不证明接线。
- 外观字段由 `src/server/scene-extra-config.js` 校验；`scene-extra-components.test.js` 保留通用类别、委托歌词校验和组件特殊约束。
- 保存状态由 `component-config-controller.test.js` 负责，toast 消费者只验证反馈；工具箱导航验证目标及有因果要求的顺序。
- 桌面画布的 IPC、保存、发布和重载由已有隔离 Electron 用例验证；操作等待应跟随业务状态。
- 技术说明 owner 为 `docs/reference/engineering/test.md`；架构门禁的覆盖说明同步 `docs/architecture/engineering/modularity-standard.md`，不改变架构要求。用户入口和操作不变，用户指南无需改动。

## 实施与验证

- [x] 删除注释/函数身份/静态控件库存断言；收窄反馈文案、重复 controller 状态和工具箱全序调用检查。运行这些文件及相应 owner 用例。
- [x] 将组件的全字段非法值循环收敛到既有校验用例；保留每类组件接线、私有字段、shared 模式、歌词委托、背景与礼物关系校验。用隔离错误注入确认真实边界仍失败。
- [x] 核对画布现有保存/发布状态，以其替换成功提示原文等待，保留真实 IPC 与输出断言；运行受影响的 Electron 文件。继续检查相邻同类断言，记录应保留的独立行为，不机械扩大修改。
- [x] 核对覆盖职责与当前文档，补充必要说明；运行受影响文件集合、架构门禁、文档门禁和语法检查；评估是否有尚未覆盖的跨层风险再扩大范围。
- [x] 检查任务增量 diff、`git diff --check`、`git status --short`，交付实际变化、验证结果和保留理由。

定向命令使用 `node scripts/run-tests.js <offline|desktop> --file=<上述文件>`，允许多个 `--file`。架构使用 `npm run verify:architecture`，文档使用 `npm run verify:docs`；受改测试逐文件 `node --check`。验证过程中不修改正在运行范围的文件。

## 失败处理与完成条件

发现失败先复现并区分任务改动与并行工作；只修本任务引入的问题，不删有效断言换取通过。需要回退时对照任务基线仅撤回自己的片段，不整文件覆盖其他改动。所有审查项都有实施或明确保留结果，必要行为仍有可定位的承接用例，聚焦验证和误报/故障探针完成，文档与最终增量一致后才能完成。

## 执行记录

- 已重读当前测试与工作区状态，记录 10 个拟修改文件的基线。
- 修改前运行 9 文件，179/180 通过；现有空 catch 门禁因 `src/music/providers/netease-provider.js` 失败，记录于 `tmp/test-results/run-zzpvUf/results.json`。此失败发生在本任务改变测试前，空 catch 门禁保持不变。
- 第一批功能收窄后 7 文件 138/138 通过；字段矩阵收敛后 4 文件 50/50 通过，分别见 `run-bLwyhB`、`run-YHKfM6`。
- 最终离线范围含上述 9 文件及 scene-component-contract、settings-contract、settings-service，共 12 文件 204/204 通过，见 `tmp/test-results/run-ZtCRT0/results.json`。原空 catch 失败已被工作区其他修改解决，未改变该门禁。
- 同类架构断言中，HTTP/opening/settings 的 import 正则改用既有依赖图；移除 HTTP/settings 的内部函数名清单，工具回流与 Admin DOM 检查忽略注释和字符串。保留已接受的已知 codec/平台规则回流检查及 wheel 清理接线检查：没有等价的组合清理行为证据，不凭外观相似删掉。
- 隔离探针只改内存中的源码、模块或 schema：无害注释及等价函数包装仍通过；5 种职责越界、错误校验输出、数字上限、步长、可选空值、歌词委托及私有字段放行共 11 种故障均触发失败。源码和结果在 `tmp/client-test-refinement-2026-11-18/probe.cjs`、`probe-results.json`；未增加永久测试基础设施。
- 本任务保留既有跨业务通知集成，不为目录搬迁引入跨领域共享夹具。收尾发现并行工作已将两个播放器通知案例从 toast 移到 playback-provider-operations；保留该变化，不计入本任务删除量。once 重入、controller 乱序/重置、权限、样式独立运动、无障碍及 PNG 导出覆盖保持原样。
- 桌面等待改为参数控件启用、保存按钮恢复可操作及实际发布版本/输出。首次运行中保存状态节点被自动保存订阅重写为 idle，`saved` 不能代表初始化就绪；只修测试等待条件为已加载后启用的字号控件。最终弹幕画布 3/3 通过（`run-S3HE5S`），共享画布 4/4 通过（`run-VGBj8J`）；真实 preload、IPC、失败重试、权限隔离、发布与重载均参与，夹具自行清理。
- `npm run verify:architecture` 28/28、`npm run verify:docs` 10/10 通过；8 个受改测试文件 `node --check` 通过。未运行完整发布套件：产品行为、公共契约、存储和安全机制没有修改。
- 已对照修改前副本检查本任务增量，保留并行的播放器用例搬迁和 AI 测试文档拆分；清理本任务新增的 EOF 空行后 `git diff --check` 通过。测试预期及覆盖说明同步，产品使用方式不变，用户指南无需编辑；无提交、分支、发布或运行时数据进入本任务改动。
