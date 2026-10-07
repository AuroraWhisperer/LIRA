# 当前代码与技术文档一致性审查

日期：2026-10-07。对象：`D:/Work/Live` 当前工作区。开始时已有 643 项未提交变更，本次以修改前文件快照区分增量，未用 HEAD 覆盖现有工作。

## 判定方法与覆盖范围

按当前明确要求、已接受规格、Accepted ADR、owner 契约、测试与实现的顺序判断预期。代码和通过的测试只证明当前行为；历史设计、较新的代码或文档日期均不能单独证明变更已被接受。

本轮核对文档/规格/ADR 状态、现行源码引用及路由登记，并追踪近期变化集中的 HTTP/WS 授权与投影、组件预览/样式/场景、Electron IPC/云同步、礼物事件及测试命令。以下是已确认并处理的差异，不宣称逐行审计了全仓每个领域，也不代表真实账号、正式安装器或生产服务验收。

## 已修正的实现偏差

### C01：旧账号或已停止刷新仍能回写互动错误状态

- 有效要求：[gift-interaction-controls](../../specs/gift-interaction-controls.md) 要求账号变化立即丢弃旧显示，迟到操作不得应用结果；同步关闭由既有生命周期 owner 管理。
- 原行为：[cloud-sync-controller.js](../../src/electron/cloud-sync-controller.js) 的同步主路径已检查账号、代次和取消信号，但 [gift-interaction-controller.js](../../src/electron/gift-interaction-controller.js) 的刷新 catch 再次无条件发布错误。旧请求在切账号或停止后失败，仍可向当前界面发布 `NETWORK_UNAVAILABLE`。
- 复现：新增隔离用例在旧刷新挂起期间切账号或停止，再拒绝旧 Promise。修复前两种场景均观察到不应出现的错误事件，原有用例仍通过。这是当前代码缺陷；本审查不将其归因到未经历史核实的某次提交。
- 修正：刷新失败也由 cloud-sync owner 使用现有 `isCurrent(work)` 判断后发布；互动状态模块只读取结果。保留当前账号真实刷新失败的提示和未授权错误，不改变远端协议、持久化格式或功能开关。
- 验证：[gift-interaction-controls.test.js](../../test/gifts/gift-interaction-controls.test.js) 同时验证当前账号失败应报告、旧账号失败应忽略、停止后失败应忽略；云同步与桌面生命周期相关回归通过。

## 已修正的文档滞后

| 编号 | 原差异 | 判定依据 | 修正位置 |
| --- | --- | --- | --- |
| D01 | IPC 仍列旧弹幕样式枚举，输入/DTO 漏记 layout、styleParameters 及校验错误 | [license-overlay-ipc.js](../../src/electron/ipc/license-overlay-ipc.js) 的双向白名单、共享合同；现行[样式参考](../reference/frontend/overlays.md)及样式参数归档记录已有新增能力 | [preload.md](../reference/desktop/preload.md) |
| D02 | HTTP 能力总表称 queue/overtime 无额外 REST，漏记四类组件的尺寸读取；总页数和 gift-sprint 条目滞后 | [component-scenes](../../specs/component-scenes.md)、[ADR-0022](../architecture/adr/0022-local-component-scenes.md) 已接受固定像素及默认尺寸；[access-policy.js](../../src/server/access-policy.js) 和 [overlay-http.js](../../src/server/overlay-http.js) 按凭据 scope 读取尺寸 | [api.md](../reference/backend/api.md) |
| D03 | 预览 edit 说明漏记旧草稿新增 styleParameters 的特例；时钟/弹幕 HTTP 配置和时钟 WS 设置说明漏记该字段 | [component-preview-sessions.js](../../src/server/component-preview-sessions.js)、[clock-contract.js](../../src/server/clock-contract.js)、[cloud-display-buffer.js](../../src/scenes/cloud-display-buffer.js)、[overlay-projection.js](../../src/server/overlay-projection.js) 与现行样式/存储 owner 一致 | [api.md](../reference/backend/api.md)、[ws.md](../reference/backend/ws.md) |
| D04 | 大航海感谢 WS 表仍描述单一旧开关，漏掉 style 与逐风格实时事件身份 | [guard-thanks-config.js](../../src/bilibili/gift/guard-thanks-config.js)、[runtime-transport.js](../../src/server/runtime-transport.js) 与已更新的[礼物 owner](../reference/backend/bilibili/gift.md) 一致 | [ws.md](../reference/backend/ws.md) |
| D05 | 后端核心仍将 HTTP 回调/context 构建归到旧位置，漏记许可门、专用预览/场景能力、dataDir 资源处理，并保留过时的页面和 context 组数 | [http-server.js](../../src/server/http-server.js)、[api-routes.js](../../src/server/api-routes.js)、[runtime-api-context.js](../../src/server/runtime-api-context.js) 的实际接线符合既有模块职责及场景边界；这些是实现参考过时，无需把代码搬回组合根 | [server-core.md](../reference/backend/server-core.md) |
| D06 | 构建参考称服务器默认检出只有相邻 lira-server，未说明专用锁定检出的优先级 | [verify-server-contract.js](../../scripts/verify-server-contract.js) 的 resolveServerRoot 与已更新的[测试参考](../reference/engineering/test.md#固定服务器契约输入)一致 | [build.md](../reference/engineering/build.md) |

以上仅更新事实归属章节，没有将旧要求改写为“当前代码就是正确要求”。完整字段及规则仍由各 owner 维护，本报告不另建一份合同。

## 不作为错误回退的差异与限制

- [component-workspace](../../specs/component-workspace.md) 保留早期 P2 描述，但首段已明确后续用户纠正及浏览器编辑器的替代依据。不能据早期段落恢复已撤下的桌面工作区入口。
- [动态抽奖规格](../../specs/bilibili-dynamic-lottery_design.md) 仍为 Draft，活动计划明确旧增强范围待确认；已有简化实现不等于整份草稿全部验收。没有据此实施旧 M2–M4。
- [ADR-0020](../architecture/adr/0020-shared-danmaku-source.md) 为 Proposed，共享源码提案不能用于要求当前两仓立即改成统一分发。明确 Paused/Deferred 的历史事项保留原裁决。
- `npm run verify:contracts` 实测报告服务器版本不匹配：锁定 `01fb2b47d5e081f5dd559933991ade4819eb3428`，当前 `D:/Work/lira-server` 为 `e81be2892254d56d23db4abb81d9a3efc35745d3`。这是跨仓验证前置条件未满足，不能证明当前代码违反远端合同，也不能更新锁文件或重置开发仓来掩盖失败。本轮未执行锁定服务器的运行时联调。
- 未运行全量 `npm test`、浏览器或真实 Electron UI；本次产品行为修正位于 main 的异步错误路径，使用既有隔离控制器/IPC/生命周期测试验证，没有视觉或持久化变更。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| gift-interaction-controls + `rg --files test/cloud-sync -g '*.test.js'` 返回的明确文件清单，使用 `node --experimental-vm-modules --test` | 104/104 通过 |
| license-ipc、scene-cloud-controller、component-style-parameters、scene-component-contract、component-preview、websocket-access-policy、guard-thanks、runtime-event-publication、clock-overlay 九个测试文件 | 130/130 通过 |
| electron-shutdown、electron-main-modules | 39/39 通过 |
| `npm run verify:quick` | 通过：文档 10/10、架构 23/23；语法覆盖 1322 个 JS 文件，其中 28 个执行、1294 个按内容缓存复用 |
| 归档后 `npm run verify:docs` | 最终 10/10；期间并行背景文档先新增引用、后创建 background-art-workflow.md，曾短暂造成两个链接检查失败；文件落盘后复跑通过，本任务未修改那些文件 |
| `npm run verify:contracts` | 未通过：上述服务器检出版本不匹配 |
| `git diff --check` 与工作区复核 | 通过；暂存区为空，任务快照和日志保持在 tmp，已有修改保留 |

相关测试共 273 项，另有快速门禁的 33 项文档/架构检查。过程曾将测试目录直接交给 Node 而报模块找不到，随后改为显式文件清单并成功执行；不把该命令错误当作产品缺陷。

原文件快照与日志保存在根目录 `tmp/code-document-alignment/`，不纳入源码。任务增量和工作区状态已复核；各检查结果仅适用于其执行时的工作区，跨仓验证限制仍保留。实施记录见[归档计划](../../specs/plans/archive/2026-10-07-code-document-alignment.md)。
