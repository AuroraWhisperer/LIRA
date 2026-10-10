# Component Workspace And Scene Implementation Plan

**Status:** Completed. P1–P3 and the user-confirmed local P4 scope are implemented and verified; cross-device synchronization, cloud output and OBS control remain outside this request.

**Goal:** 用户要求按阶段完成剩余组件方案。依据 specs/component-workspace.md，先收尾 P1，再实现 P2、P3 和已确定的 P4。

**Architecture:** 保留各组件权威服务，共用 controller 与 sandbox renderer；P2 的批量保存不是事务。P3 引入有实际消费者的场景文档、受限只读输出与完整版本发布。

**Tech Stack:** Existing Electron / Node / ESM / CSS / SQLite / node:test; no new dependency.

## Current Behavior And Ownership

- 四个 owner：danmaku-overlay-settings、clock-card、theme、overtime-preview。
- 公共 owner：component-config-controller、component-preview-dialog、component-preview-client。
- app.js 管理懒加载；toolbox-lifecycle 管理页面激活，不能因打开工作区误触发业务动作。
- P1 的 `2026-09-30-component-preview.md` 已从维护目录清理，原文通过[归档索引的 Git 查询方式](README.md#2026-10-09-补齐的历史验收)读取；当时隔离固定 Server 提交已验证，保留用户原检出。
- 现有未提交的其他功能改动保持原样。

## Milestones And Verification

### 1. P1 Closure

- [x] 在 tmp 下核对固定 Server 提交的契约，不切换用户仓库或修改锁。
- [x] 复核 P1 验证覆盖与实际缺口；记录并解决本任务回归。

### 2. P2 Reusable Component Instances

- [x] 新增 component-preview-registry.js；四 owner 注册工厂，沿用相同 controller、参数面板、尺寸、数据和区域操作。
- [x] 提取 component-preview-surface.js，管理单个 iframe 的消息、加载、缩放、来源切换和 dispose。dialog 与工作区共用它；窗口生命周期互斥。
- [x] controller 增加同步提交预检/冻结机制；新 component-save-batch.js 记录逐项结果与仅失败重试。
- [x] 新 component-workspace.js/CSS 提供左侧组件选择、中央四预览、右侧当前参数、底部保存当前/全部/重试。复用原 token 与参数布局，清楚标注默认配置和示例数据。
- [x] app.js 接入惰性打开入口；确保四个 owner 初始化一次。单组件小预览在工作区打开期间暂停。
- [x] 专项测试验证冻结、部分失败、重试、reset、双入口和完整释放；隔离 Electron 验证四 renderer、选择、编辑保存、窄窗与关窗。
- [x] 复核并修复批次生命周期：跨关窗重开保留进行中保存/失败结果；账号 generation 变化清除旧重试资格并忽略迟到结果，替换 controller 释放旧批次订阅。

### 3. P3 Local Scenes

- [x] 从存储、HTTP/WS、overlay 投影、Electron 云弹幕边界定位 owner，形成 specs/component-scenes.md 与 ADR-0022，并完成运行实现。
- [x] 实现场景文档持久化、共享/独立配置目标、多实例和编辑布局。
- [x] 实现受限只读组合来源与真实弹幕接入，不使用示例代替正式数据。
- [x] 实现草稿/完整版本发布、准备失败保留旧版及重启恢复。
- [x] 验证权限、状态隔离、发布一致性、重启恢复和旧 URL 兼容。

### 4. P4 Editing Efficiency

- [x] 完成本地对齐、吸附、组合移动、锁定/显隐和基于手势的撤销重做。
- [x] 完成允许展示字段的模板导入导出、资源重新绑定与非法输入测试。
- [x] 用户确认先完成本地能力；跨设备、云端输出和 OBS 控制另议，不纳入当前目标。

## Verification Commands

P2: node --experimental-vm-modules --test test/admin/component-config-controller.test.js test/admin/component-save-batch.test.js test/admin/component-preview-contracts.test.js test/admin/component-workspace.test.js.

Integration: npm run test:admin; npm run check; npm run verify:architecture; npm run verify:docs; npm run verify:contracts with its supported isolated Server fixture. P3/P4: node --experimental-vm-modules --test test/scenes/*.test.js test/admin/scene-document-model.test.js test/admin/scene-editor.test.js; final npm test with LIRA_SERVER_ROOT pointing to the isolated pinned Server checkout.

## Failure Handling And Compatibility

保存失败保留目标草稿；不回滚其他组件。账号重置使旧准备/提交失效。视图失败可关闭重开；不自动发布或改变真实业务状态。场景不持有运行时数据或凭据。只反向修改本任务 hunks，不 reset 或 blanket checkout。

## Done When

所有规格验收项有直接证据，按范围完成 Electron 和正式来源隔离验收，文档契约一致；最终 diff/check/status 通过；无运行数据或凭据进入补丁。远端/OBS 集成按用户答复不属于当前范围。

## Evidence

- P1: fixed revision and ten fixture hashes passed; 133 contract and 5 roundtrip tests passed. See archived P1 plan.
- P2: 47 controller/batch/registry/surface/workspace tests passed; the final run including danmaku account/IPC regressions passed 59 tests. 114 Admin tests, 22 architecture checks and 9 documentation checks passed. Logs: tmp/component-p2-final.log, tmp/component-p2-admin.log, tmp/component-p2-architecture-final.log, tmp/component-p2-docs-final.log.
- Isolated Electron with real preload/license IPC and real renderer fragments: four simultaneous frames, shared clock/overtime edits, save-all exact component payloads, mixed IPC success/HTTP failure and HTTP-only retry passed. No iframe API requests or renderer errors.
- Closing removed four workspace frames and resumed the small clock; 800 CSS-pixel viewport had no horizontal overflow. Native screenshot tmp/component-workspace.png inspected; owned Electron instance closed.
- Modularity records reviewed for six-line navigation entry and six-line gift-picker mock; neither adds business responsibility to the oversized owner.
- Syntax pass checked 1,080 JavaScript files; the three modules changed in the last lifecycle repair passed individual node --check. P2 review's two lifecycle gaps (batch outcome across close/reopen and account reset) were repaired and verified in the final 59-test run. Final touched diff/status and whitespace review passed for P2.

### P3/P4 Closure

- Final full suite: 3,280 tests passed, zero failures, skips or cancellations. Command: npm test with LIRA_SERVER_ROOT=D:/Work/Live/tmp/p1-contract-01fb2b47. Log: tmp/component-local-verified-suite.log. The isolated checkout remains pinned to 01fb2b47d5e081f5dd559933991ade4819eb3428; the user's Server checkout was not changed.
- Focused scene service, storage, HTTP, cloud, renderer and editor tests cover revision conflicts, encrypted capability recovery/rotation, exact route scope, account fencing, publication staging, event resets/gaps, template validation and document-only history. A delayed shared-default cache rejects publication rather than freezing stale appearance; template validation occurs before any scene creation or draft switch.
- Real Chromium output exercised five component frames, including two distinct clocks, actual projected queue/messages, failed staging with continuing old-version data, atomic successful replacement, same-version stability and revocation. No child API credentials or child API requests.
- Isolated Electron with real preload, IPC, SQLite and safeStorage exercised create/save/reopen/publish, shared versus independent targets, group movement/alignment/lock, one-gesture undo/redo, explicit template rebinding and actual JSON download. Imported templates receive new identities and save successfully. Fit-mode canvas had no horizontal overflow; native screenshots in tmp/component-scene-editor*.png were inspected. No renderer errors. Test data are synthetic; no production live-account acceptance or deployment is claimed.
- Pinned contracts passed 133 tests; cloud/license/SSE regression checks passed 196 tests. Architecture passed 22 checks; final documentation checks passed 9 tests and syntax checked 1,111 JavaScript files. Final diff/status and whitespace review passed; scratch data remain under ignored tmp/, with no runtime data or credentials added to the patch. The owned Electron window, HTTP listener and CDP connection were closed.
- Local sources require the desktop runtime and the same OS secret protection. Same-port restart recovery passed; listener address changes require recopying the source. Cross-device, cloud output and OBS control are explicitly excluded by the user's scope decision.

## P3 Implementation Record

1. Add src/scenes/scene-contract.js and scene-service.js plus src/storage/scene-store.js and appended songDb migration. Scene service receives current trusted owner, secret codec, component config normalizers/default readers and display readers; routes never receive database handles. Test isolated migration/idempotence, optimistic revision, encrypted capabilities, rotation, scope changes and complete snapshot publication.
2. Reuse createElectronSecretCodec from the composition boundary, wrapping scene error messages. Add a bounded public-overlay SSE consumer in main with owner/generation fencing. Reuse the current byte parser through an extracted helper only when both existing Device SSE and new public SSE consumers use it; retain Device auth behavior and tests.
3. Add src/server/routes/scene-routes.js and narrow scenes API facade. Only exact GET /api/scene/output recognizes scene bearer; common resolver and WS remain unchanged. Serve /scene as credential-free sandboxed static HTML. Component child URLs with componentPreview=1 must not receive overlay bootstrap tokens. Add fragment token log redaction.
4. Add scene parent renderer and explicit scene child mode, including exact source/opaque-parent message handling and readiness acknowledgements. Consume the existing per-component field projections; real cloud events go only to the danmaku renderer. Stage complete published versions and swap only after every renderer is ready, retaining prior output on failure.
5. Build the scene editor using explicit per-item controller targets and existing panels, geometry/history document model and copied source URL. Shared defaults and independent appearances have separate save ownership. Continue P4 local history/align/snap/group/lock/templates on this document model; do not save business data or credentials.
6. Run focused storage/auth/cloud/runtime/UI suites and isolated Electron source acceptance, then architecture/docs/syntax and pinned contracts. Preserve existing listener port fallback; test same-port restart, disclose recopying source when actual port changes.
