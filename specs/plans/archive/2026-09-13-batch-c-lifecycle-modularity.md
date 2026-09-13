# Batch C Lifecycle Modularity Implementation Plan

**Goal:** 落实复审报告批次 C，分离清库操作、远端礼物恢复规则、桌面就绪协调和服务器广播转换，保持现有数据及生命周期契约。

**Architecture:** 事务、授权代次、取消及启停仍各有唯一所有者。提取的纯规则接收值并返回值；事务内操作不得提交；桌面就绪控制器拥有自己注册的监听并由 main 销毁。

**Tech Stack:** Node.js 24+、CommonJS、Electron 43、node:test。

## Global Constraints

- 不提交、建分支、发布；保留当前未提交改动。
- 不修改批次 A 的 CSS/HTML 和测试拆分；仅在已有 Electron 入口测试依赖新模块时适配引用，断言不删。
- 保留 clearAllData 外部位置参数、SQL 执行/默认行恢复/提交顺序、部分失败形状和来源隔离。
- 保留 HTTP/WebSocket/IPC、授权、safeStorage、窗口地址、播放 flush 和停机顺序。

## Current Behavior / Ownership

- `src/storage/database-maintenance.js` 同时包含清理 SQL、结果构造与五库协调；消费者为 database 门面和 data-service。契约见 backend/storage.md。
- `src/electron/remote-gift-controller.js` 同时包含纯恢复规则与同步状态；消费者为 main。契约见 desktop/main.md。
- `src/electron/main.js` 在启动中注册目录/授权监听并实现导航和恢复；创建销毁仍归 main。
- `src/server.js` 在 initializeApplication 中转换领域事件；传输适配已有 runtime-transport.js。
- 修改前 114 项相关测试通过，日志在本地 `.codex-tmp/batch-c-baseline.log`。

## Milestones / Proposed Changes

- [x] 清库：增加 `database-clear-operations.js`（已有事务内各库删除/默认行）与 `database-clear-result.js`（结果），`database-clear-coordinator.js` 接收具名数据库输入，统一 BEGIN/COMMIT/ROLLBACK；maintenance 保留公开兼容门面。
- [x] 礼物：增加 `remote-gift-recovery-rules.js`，迁移历史能力、投影重建、游标页检查及错误构造；状态和异步阶段留在控制器；增加独立纯规则测试，复跑完整控制器测试。
- [x] 桌面：增加 `desktop-readiness-controller.js` 接管就绪导航/授权恢复监听；main 创建主窗、连接控制器并在停机时销毁；为撤销/停机后的异步恢复增加独立测试。
- [x] 服务器：在 `runtime-transport.js` 集中 gift/danmaku/overtime 发布适配；server 仅接线，资源初始化和异常清理保留；验证广播载荷及已有启动失败测试。
- [x] 同步拥有者文档与报告批次 C 实施记录；保留大型工厂尚未收敛的债务事实。

## Verification

每单元运行 `node --experimental-vm-modules --test` 加该领域现有测试与新增测试。最终运行 `npm run verify:quick` 与 `npm test`；格式化仅本任务文件，检查新文件规模；检查任务前快照差异、`git diff --check`、`git status --short`。如并行 A 导致独立失败，记录真实限制，不覆盖 A 代码。

## Rollback Or Failure Handling

只对任务开始快照比较本次改动，不用 HEAD 覆盖已有工作。出现契约不确定或并行同区修改时停下该单元并保留证据；不对真实数据库执行维护。

## Done When

四个单元职责明确，故障注入、部分提交、来源/授权隔离、停止失效与启动清理回归通过；架构和完整回归结果已记录，差异仅覆盖 C，相关文档与实际实现一致。

## Results

2026-09-13：本轮四项职责提取完成。C 定向验收 162/162；verify:quick 通过（文档 5、635 个 JS 语法、架构/规模 22）。完整回归 1757 通过、2 跳过、1 失败，唯一失败为已有播放 CSS 静态清单未跟随 A 拆分；保留该文件，未把全套结果标记为通过。

实现细节：为保留 SQL 失败前的 deletedCounts，事务内操作接收仅用于计数的累加器，不共享事务状态。纯恢复规则移出不改变 725 行礼物工厂债务。新就绪工厂 123 行已明确登记复审；导航代次由内部导航协作者独占。读取旧入口的静态消费者断言适配新模块，测试用例及 A 的既有修改保留。
