# 客户端六项功能缺陷修复计划

Status: Completed

日期：2026-11-09。

## Goal

修复本轮已复现的六项功能缺陷：账号切换时歌库恢复失败后的错误上传、清空记录后的播放保存失效、电台补歌后不续播、本地最近播放被平台登录挡住、网易云登录状态误判、音乐浏览器 HTTP 缓存未清理。用户已明确要求并行修复。

## Scope and constraints

- 仅修复以上功能与数据一致性问题，不扩展安全风险审计。
- 保留公共页面/API/IPC、现有存储格式、正常离线编辑与待上传恢复；不增加依赖、服务或前端构建。
- 保留工作区已有周表、测试工具、配色控件及文档改动，不提交、分支或发布。
- 合成复现位于 `tmp/client-audit-20261109/`；测试只使用内存数据库或仓库 `tmp/`，不操作真实用户数据或运行中的客户端。
- 各并行任务只编辑自身 owner 和直接相关测试；共享播放文档、桌面主进程文档与计划由主任务统一同步。

## Current behavior and ownership

1. **云歌库恢复**：`src/electron/cloud-sync-controller.js` 在首次拉取新账号歌库之前切换归属；`src/storage/cloud-song-sync-store.js` 将仍包含旧内容的整库捕获为新账号待上传记录。Owner 为云歌曲同步控制器及对应存储；消费者是歌曲编辑和桌面恢复。契约为 `specs/cloud-authoritative-streamer-sync_design.md`、`docs/reference/desktop/main.md`。现有 `test/cloud-sync/cloud-song-sync-recovery.test.js` 已覆盖持久待上传恢复，可扩展失败切换场景。
2. **清空后的播放保存**：`src/storage/database-clear-operations.js` 删除快照及已发放写入代次，旧窗口保存持续被 `src/storage/playback-store.js` 拒绝；`public/js/playback/operations/state-persistence.js` 仅检查 HTTP 成功。消费者是设置清空操作与播放运行时；契约为 `docs/reference/frontend/playback.md`、`docs/reference/backend/storage.md`。复用数据库清空、播放排序与持久化测试。
3. **电台续播**：`public/js/playback/features/playback-controls.js` 空队列停止，`features/radio-mode.js` 补歌只入队。在本电台会话中复用正在进行的补歌，并有界等待；用户暂停、换源、换集合或清空后不得被旧任务重启。扩展现有 playback-app 与 `test/playback/playback-radio-feedback.test.js` 对应行为测试。
4. **本地历史入口**：`public/js/playback/features/home-handler.js` 将 recent 错误地放在平台登录检查之后。在当前 handler 中先分流本地 recent，复用 `HomeService.loadLocalRecentHistory`，在线入口保持原条件。扩展 `test/playback/playback-home-lifecycle.test.js`。
5. **网易云登录状态**：`src/electron/music-auth-manager.js` 回退到包含辅助 Cookie 的列表。明确网易云会话判定，扩展 `test/music/music-auth-manager.test.js`，核对 `music-login-window` 消费，更新 `docs/reference/desktop/auth.md`。
6. **浏览器缓存**：同一 manager 的清理入口未调用会话 HTTP 缓存清理。复用该入口等待实际缓存清理，并保留既有 CacheStorage 语义；使用隔离 Electron 本机资源验证实际缓存效果。

## Milestones and parallel boundaries

- [x] A：云歌库任务先复现失败切换，在 owner 层保证本地内容归属与可上传快照一致；不能通过无条件删除旧歌库丢弃离线编辑。直接测试云歌库恢复、手动同步与账号切换；提交具体证据和文档修改建议。
- [x] B：主任务修复清空与快照写入生命周期，保留拒绝旧请求的排序规则。保存结果识别业务拒绝，不能把过时保存当作已落盘；验证清空前在途快照不可复活内容、清空后新编辑可以保存、失败提示仍只反映有效请求。
- [x] C：播放任务修复电台续播和最近播放入口。一个补歌请求由该电台会话共享，续播检查取消/暂停与队列身份；复用既有集成 fixture 验证慢补歌和取消，不新增重复请求。
- [x] D：桌面任务修复登录判定和缓存清理，核对当前 Electron 分区行为，运行直接音乐测试与隔离 HTTP 缓存探针。只编辑音乐会话 owner、直接测试与 auth 文档。
- [x] E：主任务审查并行 diff，同步共有技术文档与必要用户指南，运行受影响聚焦测试、语法/架构/文档门禁，最终检查 diff 和工作区状态。

## Verification

先在直接测试中复现相应问题，再修复到通过；已证明的独立行为不做重复测试。

- 云歌曲：`node --test test/cloud-sync/cloud-song-sync-recovery.test.js test/cloud-sync/cloud-song-sync-manual.test.js test/cloud-sync/cloud-song-sync-store.test.js`，按实际影响补充控制器相关用例。
- 播放：`node --experimental-vm-modules --test test/playback/playback-persistence.test.js test/playback/playback-snapshot-ordering.test.js test/playback/playback-snapshot-bootstrap.test.js test/playback/playback-radio-feedback.test.js test/playback/playback-home-lifecycle.test.js`，连播场景放入现有 owning suite 后一起运行。
- 清空：`node --test test/storage/database-clear-all.test.js test/storage/data-clear-all-runtime.test.js test/storage/data-clear-all-recovery.test.js`。
- 桌面音乐：直接 `test/music/music-auth-manager.test.js`、`music-login-window.test.js`，以及使用独立 userData/sessionData 的 Electron 本机缓存验证；不连接第三方音乐服务。
- 集成后：`npm run check`、`npm run verify:architecture`、`npm run verify:docs`、`git diff --check`。按具体变更确定是否需额外桌面集成检查，不重复整套离线或桌面组来掩盖既有间歇失败。
- 正式门禁运行期间不编辑受测文件；任何失败先定位，再做聚焦修复。

## Failure handling and done when

各任务出现范围冲突先协调 owner，不覆盖其他任务改动。失败修复只调整本轮引入内容，不以 reset、批量 checkout 或删除用户产物回退。所有六项实现及直接回归通过、文档与指南影响已处理、探针进程退出、最终 diff 已审查后完成；真实平台登录频率、硬件音频试听和实际安装升级不在这些局部修复的必需验收内。

## Evidence

### 实现与交叉复核

- 磁盘歌库归属由新增私有 `cloudSongAccountKey` 记录，账号准备只初始化缺失值；编辑事务和当前库上传先校验，替换快照与接纳归属原子提交。未改变表结构或云端 DTO。失败切换回归先失败，完整云同步目录 119/119 通过。
- 全清空在原事务内用仅元数据的撤销记录保留 writer 代次，成功后页面重载获取新 writer；HTTP/关机 IPC 检查实际 `saved`。主要聚焦检查先有 1 项测试夹具缺少 `clearTimeout`，补齐后通过；随后排序与清空 UI 31/31 通过。
- 独立复核实证发现旧 localStorage v1/v2 可在重载时恢复已清空内容。扩展既有清空用例先复现 3 项失败，再由存储 owner 提供统一清理：成功或 partial 的 `musicDb` 已提交才清理，回滚时保留。清空 UI 与持久化 18/18 通过。
- 独立复核发现全清空包装会丢失恢复中歌库的错误码；仅在完整回滚后透传原 `CLOUD_SONGS_NOT_READY`，回滚失败仍使用 partial 500。直接清空与恢复 32/32 通过。
- 电台复用当前会话 Promise，并用 30 秒取消期限覆盖请求和响应体读取；自动续播只等待一次，用户操作使旧续播失效。本地 recent 在登录检查前分流。相关播放 58/58 通过。
- 网易云只将 `MUSIC_U` 作为登录依据；缓存清理等待 `session.clearCache()` 和 CacheStorage。音乐认证与登录窗口 16/16 通过；隔离 Electron 探针 HTTP 缓存 200341 → 66 bytes，清理后资源请求计数 1 → 2，辅助 Cookie 单独存在时 `loggedIn:false`。探针仅本机 HTTP，进程已退出。
- 已同步存储、API、桌面主进程、音乐认证、播放参考及云同步规格验收；应用内歌库和播放指南已更新。README、交互导览和截图入口/布局未变，无需修改。历史审计报告保留当时结论，未覆写。

### 集成验证

- 以 `node --experimental-vm-modules --test --test-concurrency=4` 运行 18 个直接受影响文件（清空 UI/三套清空存储、四套云歌曲同步、七套播放、两套音乐认证及关机生命周期），236/236 通过，0 失败/跳过。完整命令对应 `tmp/client-functional-fixes-20261109/integrated-focused.log`。
- `npm run check`：1,827 个 JavaScript 文件语法通过；`npm run verify:architecture`：29/29 通过。
- 首次 `npm run verify:docs` 为 9/10；唯一失败是本计划状态行混入日期，不符合状态解析格式。修正格式后 10/10 通过，未放宽门禁。完成后归档并复核文档导航。
- 已复核本任务生产与测试差异，`git diff --check` 通过。周表、测试工具、配色和并行歌词任务的已有修改保留，临时日志与探针未进入 tracked diff；未暂存、提交、打包或发布。

集成测试实际命令：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/admin/settings-clear-all-ui.test.js test/storage/database-clear-all.test.js test/storage/data-clear-all-runtime.test.js test/storage/data-clear-all-recovery.test.js test/cloud-sync/cloud-runtime-sync.test.js test/cloud-sync/cloud-song-sync-recovery.test.js test/cloud-sync/cloud-song-sync-store.test.js test/cloud-sync/cloud-song-sync-manual.test.js test/playback/playback-persistence.test.js test/playback/playback-snapshot-ordering.test.js test/playback/playback-snapshot-bootstrap.test.js test/playback/playback-radio-feedback.test.js test/playback/playback-home-lifecycle.test.js test/playback/playback-stream-recovery.test.js test/playback/playback-logout-recovery.test.js test/music/music-auth-manager.test.js test/music/music-login-window.test.js test/desktop/electron-shutdown.test.js
```

中间日志与探针结果位于仓库 `tmp/client-functional-fixes-20261109/`，不进入正式产物。上述分组有重叠，不累加为唯一用例数。基线 HEAD 为 `f16db44e577432a7dc514bf1d76405240c0ced79` 加原有工作区修改；历史审计报告位于根 `output/client-functional-audit-2026-11-09.md`，保留原结论。

验证限制：没有使用真实音乐账号、实际声卡试听或运行完整桌面/安装器组。前轮审计的桌面重载超时、ERR_ABORTED 和清理 EPERM 间歇失败未在本轮归因，不声称这些无关现象已修复；本轮六项功能修复及其失败恢复路径已有直接证据。
