# 四项审计缺陷修复 Implementation Plan

Status: Complete — 2026-11-09

**Goal:** 修复审计确认的跨账号设置覆盖、暂停被迟到音源撤销、正常续期打断粉丝同步、兼容清空接口丢失写入代次四项缺陷。

**Architecture:** 在现有 settings store／同步控制器、播放控制器、粉丝控制器和数据库清空事务各自修复。沿用现有授权 generation 和播放快照墓碑，不改变凭据 epoch 语义，不添加服务或运行依赖。

**Tech Stack:** Electron 43、Node.js 24+、CommonJS backend、Vanilla JavaScript ES modules、SQLite。

## 约束与当前证据

- 用户已授权并行修复；三个原审计子代理分别负责 A01/A02/A03，主代理负责 A04、文档及整合。
- 本轮范围仅为四个已复现问题；保留现有未提交修改，不提交、分支、发布，不读取真实账号数据。
- 隔离复现保存在根 `tmp/audit-20261109-*`；修改前的文件副本保存在 `tmp/fix-audit-20261109/baseline/`，不覆盖已有副本。
- 保留同账号离线待传、首次播种、队列顺序、真正授权失效取消、公开清空响应及数据原子性。A01 必要的未就绪错误以稳定 503 返回；旧账号设置不得变成新账号待传。
- 当前工作区还有其他任务修改；共享文档仅由主代理按当前文件内容插入对应事实。

## 任务与所有权

### A01 — 设置所属账号与恢复门禁

- Owner：`src/storage/settings-store.js`、`cloud-settings-sync-store.js`，直接同步消费者 `src/electron/cloud-settings-sync-controller.js`、`cloud-sync-controller.js` 和 `src/server/cloud-sync-runtime.js`；错误映射 `src/server/http-utils.js`。
- 测试：`test/cloud-sync/cloud-settings-sync-recovery.test.js` 及现有账号隔离、settings store／runtime 相关套件。
- [x] 在既有夹具确认 B 已初始化、首读失败、期间编辑、重连的回归失败；补跨重启/同账号 pending 必要边界。
- [x] 独立记录设置快照 owner；未恢复 B 前阻止捕获 A 的完整快照和修改云设置，原子恢复 owner 与 B 的设置；dirty 不能阻止恢复。
- [x] 聚焦套件通过，同账号离线编辑及首次播种保持有效。
- 契约：`docs/reference/backend/storage.md`、`api.md` 和现有云同步规格；用户操作不新增步骤，仅在恢复失败时诚实返回暂不可编辑。

### A02 — 暂停优先于迟到音源

- Owner：`public/js/playback/features/playback-controls.js`；消费者为播放按钮、媒体快捷操作及工作区播放入口。
- 测试：`test/playback/playback-stream-recovery.test.js`，复用现有 playback-app 夹具。
- [x] 新增延迟下一首→暂停→音源返回仍暂停的回归，并确认旧代码失败。
- [x] 撤销自动播放意图但保留已经出队的 B 为当前暂停曲目，恢复播放继续 B；失败跳过也遵守最新意图。
- [x] 验证队列 C 顺序、电台行为及已有播放恢复回归。
- 契约：`docs/reference/frontend/playback.md`；正常操作步骤不变。

### A03 — 续期不取消同一授权生命周期的同步

- Owner：`src/electron/fan-profile-controller.js`；复用 `getAuthorizationGeneration()`，不改变 token epoch。
- 测试：`test/fan-profiles/fan-profiles-roster.test.js`、`fan-profiles-ipc.test.js`、`fan-profiles-sync.test.js` 与直接共享夹具消费者。
- [x] 正常续期和未观察到 A→B→A 的旧上下文用例先失败。
- [x] 同生命周期任务继续，真实生命周期变更取消并换发页面 contextId。
- [x] 续期可完成，撤销/换账号/换房间/关闭仍取消。
- 契约：`docs/reference/desktop/auth.md`、`main.md`；用户入口与步骤不变。

### A04 — 兼容清空保留写入代次

- Owner：`src/storage/database-maintenance.js` 的 `clearPlaybackData(musicDb)`；复用 `playback-store.js` 导出的 `clearAllQueueStatesInTransaction(musicDb)`，现有事务仍由 maintenance 持有。
- 测试：`test/playback/playback-snapshot-ordering.test.js` 的内存 SQLite 夹具。
- [x] 新增旧页面保存→清空→新页面领取代次→旧保存迟到→新页面成功保存的回归，确认旧实现失败。
- [x] 将 `DELETE FROM play_queue_state` 替换为 `clearAllQueueStatesInTransaction(musicDb)`，保留历史删除和响应格式。
- [x] 相关快照与清空套件通过。
- 契约：`docs/reference/backend/storage.md`、`api.md`；该兼容 API 没有当前前端直接入口，不调整指南。

## 集成验证与完成条件

各 owner 先运行自己的失败回归与直接相关套件，主代理复核相对本轮基线的差异。直接相关检查和最终门禁：

```powershell
node --experimental-vm-modules --test test/playback/playback-snapshot-ordering.test.js test/storage/database-clear-all.test.js
npm run check
npm run verify:architecture
npm run verify:docs
git diff --check
git status --short
```

- [x] 四项行为均有有效回归，受影响现有测试通过；记录实际命令和计数，不把交叠组相加。
- [x] 同步 owning 技术参考，检查使用指南；没有步骤变化的指南保持不变。
- [x] 完成差异与工作区审阅，确认无生成数据/秘密进入代码差异。
- 不运行真实账号、上游网络、声卡或用户应用验收；本次规则可由隔离 Node/VM 用例证明，不重复全量套件。

## 失败处理

失败先定位到具体触发场景，再按相关套件验证。回退只依据本轮基线和当前差异撤销本轮对应行，保留已有及并发修改；禁止 reset、整文件覆盖或批量删除。

## 完成证据

- A01 两批相关检查为 67/67、62/62，共 129 个不同用例；旧服务器可选字段隔离修正后，交叉复核发现默认通道覆盖关闭的旧总开关，已先复现失败并修正。最后受影响 recovery/monitoring 重跑 21/21，独立复核 recovery 15/15（均为上述 129 的子集）。生产 adapter 真实参与，核对账号参数完整传递。
- A02 四个直接相关文件 83/83，原暂停复现已转通过；全屏空格键原先绕过控制器，改为点击现有统一播放按钮，并通过隔离模块接线验证。新增回归覆盖暂停后保留 B、恢复后 B→C、快速暂停/恢复和失败后不继续自动取歌。
- A03 五个 fixture 消费套件 43/43；用例先证明旧实现正常续期取消及 A→B→A 上下文复活，再验证稳定 generation 的修复。未修改授权 manager。
- A04 新用例在旧代码失败，复用既有墓碑后快照/清空两套件 33/33。
- `npm run check`：1,826 个 JavaScript 文件通过；`npm run verify:architecture`：29/29；`npm run verify:docs`：10/10。采用聚焦而非全量测试，未验真实账号、声卡、上游或发布包。
- 技术参考 storage/API/playback/auth/main 与云同步规格已同步；入门指南增加设置未恢复时联网等待说明，其余 README、引导及操作步骤无变化而保持不变。补充默认值规则仅覆盖跨账号云字段，本机字段保留，旧监控关闭不被默认值开启。
- 所有本轮差异对照预先备份审阅，`git diff --check` 通过，最终工作区状态已检查；无真实数据、秘密或临时脚本进入本轮业务差异。其他并行任务的修改保留，未提交、分支、打包或发布。

准确的主要聚焦命令（项目根目录）：

```powershell
node --test test/cloud-sync/cloud-settings-sync-recovery.test.js test/cloud-sync/cloud-room-account.test.js test/cloud-sync/cloud-sync-controller.test.js test/cloud-sync/cloud-fixed-reply-projection.test.js test/transport/http-utils.test.js test/cloud-sync/cloud-song-sync-recovery.test.js test/cloud-sync/cloud-sync-account-isolation.test.js test/cloud-sync/cloud-sync-response-validation.test.js
node --experimental-vm-modules --test test/settings/settings-bootstrap.test.js test/settings/settings-contract.test.js test/settings/settings-service.test.js test/settings/monitoring-settings.test.js test/gifts/gift-interaction-controls.test.js test/cloud-sync/cloud-sync-polling.test.js
node --test test/cloud-sync/cloud-settings-sync-recovery.test.js test/settings/monitoring-settings.test.js
node --experimental-vm-modules --test test/playback/playback-stream-recovery.test.js test/playback/playback-queue-behavior.test.js test/playback/playback-state-actions.test.js test/playback/playback-radio-feedback.test.js
node --test --test-reporter=spec --test-concurrency=2 test/fan-profiles/fan-profiles-roster.test.js test/fan-profiles/fan-profiles-ipc.test.js test/fan-profiles/fan-profiles-sync.test.js test/fan-profiles/fan-former-names.test.js test/fan-profiles/fan-guard-expiry.test.js
```
