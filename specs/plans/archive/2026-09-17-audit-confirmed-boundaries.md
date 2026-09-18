# 已确认审计问题首批修复计划

状态：已完成本计划的首批三项修复；仓库级既有门禁失败如下单独记录。未提交代码。

## Goal

验收第四轮 rev 2 的编号覆盖与关键裁决，并修复三个已有明确行为证据的问题：私有盲盒价格比较、开播资源读取错误、AI 已保存密钥跨目标复用。其余问题继续使用审计账本跟踪，不把待证条目直接转成代码变更。

## Current Behavior And Ownership

- `D:/Work/lira-server/src/lib/gift-variant-valuation.js`：私有配置以两位小数人民币保存，直接乘 1000 比较金瓜子整数会使 2.01 等价格不匹配。规范为 `REQ-GIFT-006`，消费者是礼物计价模块；已有 `test/gift-variant-valuation.test.js`。
- `src/server/http-utils.js`：开播音频、人物图片在 stat 后直接 pipe ReadStream，未收敛源流错误。既有成功响应、HEAD、文件名及扩展名校验保持。
- `src/ai/config-store.js`、`src/ai/ai-assistant-service.js`：修改服务 origin 或请求模型列表时，可继续复用已保存的模型密钥。配置存储是持久化写入 owner，service 是临时模型列表请求 owner；连接测试和正常生成从配置存储读取。

## Constraints

- 保留现有工作区改动；不提交、切换分支或修改审计原始证据。
- 不新增依赖、数据表或密钥持久化格式；密钥继续经既有 codec 加密，公开配置不得回显密钥。
- 不硬编码供应商域名；同 origin 的自定义供应商、合法路径及协议设置仍可使用。
- 新目标不能隐式继承旧密钥；允许显式提供密钥或明确清空后更新配置。请求失败时不得部分写入配置。
- 不扩大到 HTML token 引导、WS 协议、歌词协议或退出生命周期；这些各有独立 owner 与兼容验证需求。
- 测试仅使用临时目录、内存数据库、假密钥和受控网络桩。

## Milestones

- [x] **1. 编号与裁决验收。** 从原报告标题独立提取 97 个 ID，与 rev 2 JSON 和 Markdown 双向对照；记录语义映射、状态或实施建议的剩余问题，不以 31/31 文本自检代替独立验收。
- [x] **2. 私有盲盒价格。** 在既有 valuation 测试补 2.00/2.01/4.03 和差 1 金瓜子的反例，先观察失败；将私有人民币价格换算为整数分后再乘 10，与原始金瓜子精确比较。同步服务器 requirement 和 acceptance 小节。
- [x] **3. 开播资源流。** 对音频和人物图注入“stat 成功、读流失败”，覆盖请求确定收尾、无未捕获错误及正常 GET/HEAD。源流 owner 负责错误与响应提前关闭时的资源释放；不把任何 I/O 错误一律解释为文件不存在。
- [x] **4. AI 密钥目标。** 先检查 provider 预设的有效 URL 与配置存储、列表请求路径。用既有 URL 规范化规则比较有效 origin，在配置写入与列表请求两个入口拒绝隐式跨目标复用；显式密钥不受该复用限制。补无部分写入、同 origin、预设/自定义切换及调用前拒绝的回归，并同步 AI 架构/接口约束。
- [x] **5. 验收与交付。** 运行各自的直接相关测试、语法和必要文档检查；检查任务 diff、`git diff --check`、两仓状态。在外部审计目录记录实际修复与未完成项。

## Verification

- Server：`node --test test/gift-variant-valuation.test.js test/bilibili-blind-box-valuation.test.js test/monitor-legacy-valuation.test.js`。
- Live 资源：`node --test test/http-utils.test.js test/opening-upload-api.test.js`；若新增隔离故障测试，加入其确切文件。
- Live AI：`node --test test/ai-config-store.test.js test/ai-assistant-service.test.js test/ai-provider-contracts.test.js test/ai-routes.test.js`，按实际修改补充直接调用者测试。
- 使用仓库现有 Node 测试框架，不引入 Jest/ESLint 或重新格式化无关文件。

## Results And Discoveries

- 独立检查：97/97 覆盖，85 个 JSON 目标与 Markdown 行一致；语义残留另记，未认可“85 个已确定独立根因”。
- Server 三个计价文件 36/36；文档治理与架构治理 22/22。
- Live 文件流、HTTP 工具、开播上传 24/24。新增故障测试为 `test/opening-media-stream.test.js`。
- Live AI 配置、真实模块目标绑定、服务、供应商、路由、生命周期及前端密钥/自动保存 49/49。新增集成测试为 `test/ai-model-key-origin.test.js`。
- 修改的 JS 语法检查通过。Live 架构/文档四文件组合 26/27：既有用户改动 `public/pages/admin/toolbox/danmaku.html` 为 632 行，超过已登记 622 行；本计划未触碰该文件或放宽门禁。
- 发现从供应商预设切回自定义时，会恢复数据库中的旧自定义 URL；因此必须在事务提交前按实际持久化结果检查目标，不能只依据当前内存预设地址。
- 资源流修复收敛读取错误，不改变并发文件替换的一致性语义；未采用审计报告一律 404 或扩大为文件快照重构的建议。
- 完整验收与剩余项：`D:/Work/lira-audit/复核与第四轮指导-2026-09-17/06-rev2验收与第一批修复结果.md`。

## Failure Handling And Done When

若复现、规范或当前调用者显示报告建议不成立，停止该条实现并记录具体冲突，其余独立条目可继续。修复必须使原失败用例通过且相邻成功行为仍通过；不以降低断言、吞错或改锁消除失败。仅在以上里程碑完成且最后 diff 已检查后标记完成并归档计划。任何撤销只处理本任务修改，不使用整仓回滚。
