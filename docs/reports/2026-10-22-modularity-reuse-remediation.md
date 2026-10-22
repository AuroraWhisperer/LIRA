# 模块化与公共能力复用整改记录

日期：2026-10-22。依据：[原审计](2026-10-22-modularity-reuse-audit.md)。用户随后明确授权建议项和可选项全部实施，并行完成 M1–M5；原报告的“暂不调整”项不属于本轮范围。代码基线为 `35f822fb8ccfa73f8f4cfd33de760a88fceb4481` 加原有世界时钟工作树。

状态：已完成。[实施计划与逐项验收](../../specs/plans/archive/2026-10-22-modularity-reuse-remediation.md)已归档。

## 实施结果

| 项目 | 已落实的边界 | 兼容与验证重点 |
| --- | --- | --- |
| M1 时钟 | `shared/clock-settings.js` 统一样式、默认文案、翻页颜色和外观键；后端、场景和 overlay 复用 | 严格输入校验、浏览器回退、旧 URL 优先级和 styleOptions 保留 |
| M2 前端纯函数 | 新增 `shared/html-escape.js`、`shared/display-format.js`，16 个实际生产消费者直接导入 | 原转义/格式化语义保留；真实 ESM 导入不读写 UI 全局、不发请求；旧具名/聚合/全局出口保留 |
| M3 AI 存储 | 新增 `storage/ai-state-store.js`，由 `server/ai-runtime.js` 创建并注入配置领域 | SQL/事务归 storage；codec、origin、persona、TTL/hash 和脱敏留领域，提交后才发布缓存 |
| M4 加班机存储 | store 原样移动至 `storage/overtime-store.js`，由 `server/domain-services.js` 注入 | 同一个 giftDb、原事务和幂等/恢复行为保留；领域不再接收数据库或创建适配器 |
| M5 旧感谢实现 | 删除没有消费者的 `bilibili/gift/guard-thanks.js` | 静态/动态加载和打包入口核对完成，当前 `guard-thanks-config.js` 与 `gift:guard-thanks` 不变 |

加班机 store 与旧文件忽略换行后完全一致。AI 和加班机两项均经独立只读复核，未发现实质回归。没有新增框架、运行依赖、服务进程或数据库迁移。

`module-boundaries.test.js` 移除最后两项已知 SQL 例外，检查非 storage 的已知数据库 receiver，并补充 AI 配置/整个加班机领域边界及纯函数 named import 门禁。文本扫描仍不能证明任意别名或动态调用都满足边界。

## 验证证据

定向结果按各批次记录，集合之间可能重叠，不相加冒充独立总数：

- 时钟/场景与感谢事件：45 项通过；导入形式整合后，时钟/场景 23 项复验通过。
- 前端纯函数及消费者：207 项通过，包含 4 项新纯入口/兼容合同回归。
- AI：后端 140 项、设置界面 48 项通过。新增真实 SQLite COMMIT 失败回归，验证配置、人格映射、密钥来源及缓存原子性；storage 写入入口验证密文。
- 加班机、礼物导入/维护、构造失败清理与清库恢复：137 项通过；固定服务器契约环境补验 3 项通过。移动前核心基线 41 项通过。
- `npm run verify:architecture`：28 项通过；`npm run verify:docs`：10 项通过。
- `npm run check`：1,641 个 JavaScript 文件通过。第一轮与最后一次导入调整重叠，脚本拒绝记录结果；冻结后重新运行全仓检查通过。
- `npm test`：全部 647 个测试文件，两个批次合计 **5,224 项通过，0 失败、0 跳过**；运行期间没有编辑受测文件。结构化记录：`tmp/test-results/run-HKqgKL/results.json`，`complete: true`、`scope: full`，失败文件列表为空。
- 最终差异检查通过，无暂存修改或运行数据进入交付差异；原有世界时钟 8 个文件哈希一致，`app.md` 排除本轮新增段落后也与原内容一致。

测试环境使用 Node.js 24.21.0。默认相邻服务器检出的提交不匹配契约锁；复用已存在的 `tmp/release-5.4.3/server-contract`，校验提交 `67119e81a3f5f49470ed2b191f6552556d0a704e` 及 10 份 fixture 后设置 `LIRA_SERVER_ROOT`，对应定向测试通过。没有切换或修改服务器开发目录。

整合曾暴露静态扫描器对大写 import 别名的误报，时钟使用直接具名导入与局部常量引用后通过；文档门禁发现的规格索引旧 store 路径也已同步。没有削弱断言或增加例外。

日志与临时证据放在 `tmp/modularity-reuse-remediation/`，不属于交付源文件。

## 同步与局限

技术参考已同步 AI、加班机、存储、服务器组合根、前端工具与时钟 owner；归属地图、遗留登记、模块标准和规格索引同步。HTTP/WS/IPC、页面 URL、设置键、持久化格式和用户操作保持原样，因此本轮无需修改用户指南或操作截图。原有世界时钟改动保留。

没有打包或发布；本轮验证针对仓库代码和隔离测试，不等同于真实 B 站账号、直播软件或生产数据验收。
