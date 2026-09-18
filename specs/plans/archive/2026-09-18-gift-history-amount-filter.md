# 礼物流水金额门槛实施计划

状态：已完成（2026-09-18），相关测试和 Electron 验证通过；全库检查的既有失败见验证结果。依据：用户要求全部礼物只显示大于指定人民币金额的记录。

## Goal

在全部礼物流水筛选栏添加“金额大于（元）”：按单条记录总金额严格大于门槛筛选，留空不限；分页、总数、全选和导出使用同一条件。

## Current Behavior / Ownership

- `public/pages/admin/gifts/history.html`、`public/js/admin/gifts/history-tools.js` 和 `history.js` 拥有筛选输入、状态与请求。
- `src/server/routes/gift-routes.js` 白名单转交历史查询；选择和导出复用 `getGiftSelection`。
- `src/bilibili/gift/history-filters.js` 规范化筛选，`query-service.js` 将其绑定到分页游标和选择快照。
- `src/storage/gift-query-store.js` 共用参数化条件查询列表、数量和快照；已有整数分转换函数。
- 契约归属 `docs/architecture/backend/api.md`；验证复用金额查询、路由、前端测试和 `scripts/verify-gift-history.cjs` 的隔离 Electron 环境。

## Non-goals / Compatibility Constraints

不改礼物结算、单价、盲盒计算、本日 OBS 展示配置或数据库结构；不持久化本次筛选。保留账号来源隔离、HTTP/IPC 授权、旧接口默认值与旧游标。保留当前未提交的既有改动，不提交或发布。

## Proposed Changes

新增可选 `amountAbove` 参数，单位人民币元；接受非负、有限且精确到分的数值或数值字符串。留空时不加入规范化 filters，保持旧游标字段形状。非法值使用既有 `INVALID_GIFT_FILTER` 错误；SQL 使用 `giftMoneyCents(g.total_price) > ?` 比较整数分。前端使用 `number/min=0/step=0.01` 和原生表单校验；重置同时清空门槛，筛选变化清空选择并回到第一页。名称、日期与金额按交集处理，导出继续复用选择快照校验，无新增权限；仅设置门槛时 history 响应随既有筛选字段返回规范化 `amountAbove`。

运行时发现 `history-view.js` 原先固定显示一位小数，会将 >100 元的 100.01 元显示为 100.0。保留原有一位格式，在有分位时显示两位，避免门槛与可见金额产生矛盾。验收夹具的 LIVE 来源同时标记 dirty=false/epochValidated=true，按完整同步状态验证空筛选结果。

## Milestones / Verification

- [x] 在现有测试中覆盖严格大于的等值边界、单条总金额、分页/总数、组合条件、全选及指定记录、非法值、游标变更和未设置门槛兼容性，先确认新增断言失败。
- [x] 实施接口白名单、规范化、存储条件、筛选输入与 URL 传递；更新 API 契约表。
- [x] 运行 `node --experimental-vm-modules --test test/gift-display-query.test.js test/gift-query-service.test.js test/gift-routes.test.js test/frontend-gift-history.test.js test/frontend-gift-history-recovery.test.js test/gift-export-controller.test.js`，34 项通过；金额显示精度调整后复验前端 5 项通过。
- [x] 扩展已有 Electron 合成数据验证，运行 `node node_modules/electron/cli.js scripts/verify-gift-history.cjs`，筛选、重置、选择/导出与实际布局通过。
- [x] 运行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`，检查结果和既有失败见下；未运行无关的服务端协议或全量测试。
- [x] 审阅任务 diff，运行 `git diff --check` 和 `git status --short`，确认无真实数据或生成产物进入变更。

## 验证结果与限制

- 新增断言先得到 4 项预期失败；实现后 34 项直接相关测试通过。
- Electron 使用隔离 SQLite 和 55 条合成记录，验证 >100 元仅保留 100.01 元、>100.01 元为空、筛选后回第一页并清空旧选择、全选与导出一致、重置恢复 50 条第一页；保留原整窗与窗口控制验收。已检查渲染截图。
- `npm run check`：871 个 JavaScript 文件通过；最终金额显示和 `.cjs` 验证脚本另跑语法检查通过。impeccable 对新增输入返回空问题集。
- `verify:architecture`：21/22 通过，失败是既有改动超过文件行数登记上限：`public/pages/admin/toolbox/shell-start.html`、`src/electron/license/remote-license-client.js`、`src/electron/main.js`、`src/server.js`、`src/storage/database-migrations.js`、`test/ui-edit-state.test.js`。这些文件不属于本次任务。
- `verify:docs`：4/5 通过，失败是既有 `specs/fan-profiles.md` 未加入规格索引；本次未改动该规格或索引。
- 无真实数据操作、数据库迁移、提交或发布。

## Rollback / Failure Handling

输入无效时保留当前筛选和选择；后端拒绝非法门槛。金额条件改变后旧分页游标被拒绝。失败时只撤销本任务的金额筛选改动，保留之前的整窗布局和其他工作；不重置或删除数据库。

## Done When

输入 10 后只显示单条总金额 >10 元的礼物，等于 10 元不显示；留空和重置恢复不限。列表数量、翻页、全选和导出一致，受影响测试与 Electron 检查通过，契约和最终 diff 完成审阅。
