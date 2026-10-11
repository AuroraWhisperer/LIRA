# 客户端文档分歧的后续裁决

**Status:** Completed

日期：2026-10-11；承接[一致性审查](../../../docs/reports/2026-10-11-client-document-alignment.md)。用户已要求测试阶段先保留备份、歌词偏移采用 3 秒，并授权参考常见实践确定 AI 第三方配额策略。

## Decisions And Boundaries

- 播放：保留当前 SQLite 保存和旧 localStorage 恢复/迁移，不删除旧副本，不在本轮新增持续镜像。
- 微唱：已有实现、测试和指南均为 ±3000ms，仅修正规格中的三处 ±1500ms 范围；1500ms 暂停检测窗口是不同参数，保持不变。
- AI：月度安全用量按发起请求的次数计算；发送前取消/本地配置拒绝/额度拦截不消费，开始请求后无论成功、超时、网络失败、业务失败或本地结果处理失败都不退回。保留月度上限、北京时间月份、表结构和既有计数，不回填历史失败。
- 规则参考 [express-rate-limit 默认不跳过失败请求](https://express-rate-limit.mintlify.app/reference/configuration#skipfailedrequests)。这是一项请求预算选择，并非供应商账单对账：[和风天气 FAQ](https://dev.qweather.com/help/)说明非 2xx 不统计请求，服务计费与本机保守预算可能不同。

## Ownership

配额规则归 `src/ai/api-quota-store.js` 的 `withApiQuota`；天气/地图工具在进入它之前复用 `http-client.throwIfAborted` 检查取消。沿用现有 API 和错误映射，不引入依赖、第二套计数或网络探测。

同步范围：AI 技术参考与使用指南、微唱规格、审查报告、未结项 B10/B11 和旧暂停计划中的 R4-AI-QUOTA-REFUND。旧暂停计划的其他条目仍保留原状态。

## Milestones And Verification

- [x] 扩展既有配额/工具测试，复现失败重试释放预算、发送前取消仍触发调用的问题（8 个预期失败）。
- [x] 修改拥有者及两个调用点，验证失败也占用预算、跨月晚到失败不改旧计数、取消和额度耗尽不发请求；配额/工具 18/18、AI 调用方与微唱 45/45 通过。
- [x] 同步文档与用户指导；指南 26/26、`npm run verify:docs` 10/10 通过，五个变更 JS 文件语法检查、任务增量 diff、`git diff --check` 和工作区状态复核通过。

测试使用内存 SQLite 和 fetch 替身；不请求真实天气/地图，不操作用户数据库。只运行与计数规则、取消、既有工具集成及文档直接相关的检查。

验证命令与范围：

- `node --test test/ai/ai-api-quota-store.test.js test/ai/ai-tools.test.js`：先 8 个预期失败，修改后 18/18 通过。
- `node --experimental-vm-modules --test` 运行 `ai-provider-contracts`、`ai-assistant-generation`、`ai-assistant-lifecycle`、`ai-assistant-service`、`wesing-capture-refresh` 和 `wesing-routes` 六个所属测试文件：45/45 通过。
- `node --experimental-vm-modules --test test/admin/frontend-usage-guide.test.js test/admin/admin-page-composition.test.js`：26/26 通过。
- `npm run verify:docs`：10/10；`node --check` 覆盖配额 owner、两个工具和两个更新测试文件。未运行全量套件或真实桌面/平台验收。

## Failure Handling And Completion

任务前快照与日志放在 `tmp/client-doc-followup-2026-10-11/`。修复新增失败或只撤回本轮增量，不覆盖用户和前轮审查的修改。上述规则落实、相关检查通过、台账反映最新裁决且最终 diff 已复核后归档；不提交或发布。
