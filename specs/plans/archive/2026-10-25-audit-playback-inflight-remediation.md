# Audit Playback In-Flight Flush Remediation Implementation Plan

Status: Completed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 F-03，使空当前曲目且普通保存仍在途时，卸载和 Electron 关机 flush 能同步重发最新快照。

**Architecture:** 在现有 state-persistence factory 内保留一个最新 in-flight payload 引用，普通请求 settle 时按对象身份清理；显式 flush 在没有 dirty/pending 且 current 为空时复用该 payload。沿用现有 `snapshotVersion`、IPC/beacon/keepalive 幂等写入，不等待 pagehide 中的普通 fetch。

**Tech Stack:** 原生 ES modules、现有 playback store/HTTP/IPC 合同、Node VM frontend module tests。

## Global Constraints

- 保留 Electron 关闭 quiesce/drain 顺序、writer/generation/sequence 协议和 IPC 参数形状。
- 不为卸载新增异步等待，不把已成功进入 HTTP tracker 的正常路径描述成故障。
- 只使用隔离 VM、内存 SQLite 和合成播放状态；不启动真实账号或读取用户播放数据。
- 不提交、不发布；只修改本工作包直接拥有的实现、测试和播放参考。

## Ownership And Current Behavior

- Owner：`public/js/playback/operations/state-persistence.js`；注册点：`public/js/playback/core/initializer.js`（只核对，不预计划改动）。
- Consumers：`src/server/routes/playback-routes.js`、`src/electron/ipc/music-ipc.js`、`src/storage/playback-store.js`。
- 当前缺陷：`takePendingPayload()` 清空 pending 后，普通 fetch 未 settle 且 `current === null` 时，两个显式 flush 都取不到 payload。
- 回归套件：`test/playback/playback-snapshot-ordering.test.js`；契约：`docs/reference/frontend/playback.md` §6。

## Proposed Changes And Tasks

### Task 1: 加入两个交错回归

**Files:**
- Modify: `test/playback/playback-snapshot-ordering.test.js`

- [x] 复用 `sender()`、`deferred()` 和内存 `fixture()`，对 `flushPlaybackStateOnUnload` 与 `flushPlaybackStateForShutdown` 各写一例：`current=null`、队列非空，启动普通保存并阻塞其 HTTP；在 HTTP 未 settle 时调用显式 flush，随后让普通请求失败。
- [x] 两例断言显式 IPC 与适用的 beacon/keepalive 携带同一 sequence 的空 current 快照，服务端最终接受该快照；保留现有非空 current、迟到旧响应和较新快照优先断言。先运行 `node --experimental-vm-modules --test test/playback/playback-snapshot-ordering.test.js`，确认新增用例在修复前失败。

### Task 2: 保留并清理最新在途快照

**Files:**
- Modify: `public/js/playback/operations/state-persistence.js`
- Test: `test/playback/playback-snapshot-ordering.test.js`

- [x] 增加 factory 私有 `playbackStateSaveInFlight`。普通 `flushPlaybackStateSave()` 在 fetch 前记录较新的 payload，在 `finally` 中仅当引用仍是该 payload 时清空；旧请求 settle 不得清除较新的引用。
- [x] 提取显式 flush 取值辅助函数：dirty/pending 优先走现有 `takePendingPayload()`；没有待存内容且 current 非空时仍先 `savePlaybackState()`；current 为空时返回最新 in-flight。两个显式入口共用该辅助函数，其他普通保存取值逻辑不变。
- [x] 运行完整播放快照顺序套件，确认新增两例及既有 23+ 用例通过；检查失败普通请求不会把旧快照覆盖显式已提交的版本。

### Task 3: 合同同步与复核

- [x] 更新 `docs/reference/frontend/playback.md` §6，说明 settle 前的最新在途快照也可被显式 flush 重发，IPC/beacon 同版本幂等语义不变。API、IPC、设置和用户操作不变，用户指南无需改动。
- [x] 运行 `node scripts/check-js.js`、`npm run verify:docs`、`git diff --check` 和 scoped status 复核；若需桌面运行检查，只使用现有隔离 Electron 路径并记录实际结果。

## Completion Evidence

2026-10-25 完成 F-03。新增 unload/shutdown 两种空 current、普通 HTTP 在途后显式 flush 的回归；快照顺序套件 25/25、播放目录 268/268 通过。隔离 Electron 认证、URL、本地媒体、关闭与资源等 104/104 通过，文档门禁 10/10 通过。IPC/beacon/keepalive 参数和版本幂等合同未变，用户操作与指南无需更新；未读取真实播放数据。

## Verification / Rollback / Done When

核心命令为 `node --experimental-vm-modules --test test/playback/playback-snapshot-ordering.test.js`。不在 `pagehide` 中等待 fetch，不新增本地持久化副本。回滚仅反向编辑本计划拥有的 in-flight 引用、辅助取值和对应测试/文档。

完成条件：两种显式 flush 的空 current 在途失败交错均有第二通道证据，旧响应/新快照顺序不回退，合同文档与实际行为一致，最终 diff 无生成物或用户数据。
