# Official Blind-Box Mappings Implementation Plan

**Goal:** 当前盲盒映射统一使用官方目录和新版租户自定义配置，不再要求确认旧版内置映射。

**Architecture:** 服务端 MonitorManager 选择有效配置，cloud-state 报告相同状态；Electron 仅显示已确认状态。保留现有设置与事件格式，旧配置留存但不参与当前服务的新组识别或计价。

**Tech Stack:** Node.js、SQLite、Vanilla JavaScript ESM、现有 node:test。

**Status:** Complete（2026-09-13）；代码与验证完成，尚未部署服务端。

## Global Constraints

- 当前用户要求停用旧版映射，取代 ADR-0014 的 legacy 模式选择决策；在服务端新增 ADR 明确范围。
- 不删除旧设置或历史流水，不回填或重算已建立礼物组。
- 保留新版自定义配置、租户隔离、官方接管规则及已有未提交修改。
- 不提交、创建分支、发布或修改运行中的用户数据。

## Current Behavior

服务端 `cloud-state.js` 和 `monitor-manager.js` 都按“旧配置非空且没有 v2 设置”选择 legacy。
因此程序附带的五条默认映射也会显示迁移待确认，并使正式监听绕过官方盲盒关系。
客户端 `gifts/blindbox.js` 直接显示这个计数。基线 31 项相关服务端测试通过。

## Ownership And Contracts

- `D:/Work/lira-server/src/modules/bilibili/monitor-manager.js`：正式监听的配置提供者。
- `D:/Work/lira-server/src/modules/streamer/cloud-state.js`：只读配置状态。
- `public/js/admin/gifts/blindbox.js`：映射状态文案。
- 服务端 REQ-GIFT-006 / REQ-SYNC-003、对应 AC、Client/server API、Device OpenAPI、ADR 索引。
- 服务端 `test/monitor-legacy-valuation.test.js`、`test/cloud-state-sync.test.js` 与客户端 `test/frontend-gifts.test.js`。

## Proposed Changes And Milestones

- [x] 升级 requirement、acceptance、protocol 描述，新增 ADR-0037：旧字段仅用于兼容保存，当前模式始终 v2；目录不可用时 applied=false。
- [x] 增加失败用例：仅有旧映射也应启用官方关系；旧金额不能作为目录缺失回退；新版私有配置仍有效；旧行与其他租户不被改写。
- [x] MonitorManager 去掉旧配置读取和模式分支，始终提供 `{ mode: 'v2', customConfig, officialSnapshot, settingsRevision }`；cloud-state 保留 wire 字段，返回 `mode: 'v2'`、`migrationPendingCount: 0`、`applied: Boolean(catalogVersion)`。
- [x] 客户端显示“官方映射已启用”或“等待服务器应用官方映射”，只显示实际自定义和官方接管计数；旧服务器状态不会被伪装为成功。
- [x] 运行相关计价、冻结、目录、配置同步与监听隔离测试，以及双方文档/架构检查；审查两仓库的任务范围 diff 和 status。

## Findings And Results

- 新测试先复现了 6 个服务端失败和 1 个页面失败，确认旧选择逻辑会阻止官方目录生效。
- 正式监听始终注入活动目录提供者；原 detector 即使没有活动快照也会覆盖有效 v2 匹配为 null。将该检查收窄为实际存在 `gift.variantSnapshot`，保留可用活动快照的全部身份约束。
- 服务端配置/盲盒测试 34 项、扩大后的计价/同步/监听隔离测试 65 项通过。
- 客户端页面/云状态/礼物投影测试 63 项通过。
- 服务端 `docs:check` 33 项及单独协议治理检查通过；客户端文档与模块边界检查 18 项通过。
- 三处服务端 JavaScript 和客户端映射模块语法通过；两仓库 `git diff --check` 通过。任务修改均为源码、合成测试和文档，没有操作运行数据或发布服务。

## Verification

服务端工作目录 `D:/Work/lira-server`：

```powershell
node --test test/monitor-legacy-valuation.test.js test/cloud-state-sync.test.js test/bilibili-blind-box-valuation.test.js
node --test test/bilibili-gift-detector.test.js test/bilibili-gift-parity.test.js test/gift-variant-valuation.test.js test/blind-box-catalog.test.js test/cloud-state-atomicity.test.js test/cloud-sync-http.test.js test/monitor-login-gate.test.js test/monitor-startup-isolation.test.js test/room-monitor-gift-batches.test.js
npm run docs:check
node --test test/gift-sync-documentation-governance.test.js
```

客户端工作目录 `D:/Work/Live`：

```powershell
node --experimental-vm-modules --test test/frontend-gifts.test.js test/frontend-gifts-panel.test.js test/cloud-runtime-sync.test.js test/processed-gift-import.test.js
node --check public/js/admin/gifts/blindbox.js
```

两仓库分别执行 `git diff --check` 和 `git status --short`。只核查当前修改相关门禁；其他领域测试不作为本任务扩展范围。

## Rollback Or Failure Handling

目录不可用继续保留事件事实和显式金额/成本，不猜测旧名称映射。已有组按既有冻结依据恢复。
实现失败时只逆向修改任务新增的行；不操作历史数据，不覆盖其他未提交改动。

## Done When

仅含旧配置的租户自动使用官方关系，新版私有规则继续生效；页面不再显示旧版确认计数；失败状态真实；相关测试和规范一致；最终 diff 已审查。上线需要服务端部署更新，本任务不包含发布。
