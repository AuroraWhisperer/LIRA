# 2026-10-16 审查缺陷修复计划

Status: Completed

## 目标与边界

复核并修复审查报告中的六项 P2，使心愿统计、凭据退出、设置同步、旧服务器恢复、点歌去重及模型选择符合已有契约。六项均已使用生产模块和隔离数据重新复现。首次 SSE 通知窗口属于已接受恢复取舍，不修改。保留当前两库已有未提交修改，不提交、不打包、不部署，不接触真实账号或用户数据库。

## 所有者、方案与独立验收

- [x] 心愿：`gift-wish-store.js` 使用活动成员、完整日汇总与未覆盖明细互斥计数。创建日/本场起止的非整日窗口不能用日汇总近似；gift_db v20 保存所需的精确事件身份/时间/数量，由 `gift-wish-retention.js` 在快照替换和回收事务内归档。同 epoch 保留，换 epoch、删除许愿或清空来源移除。已有迁移、身份筛选、回收、重建及边界回归通过。历史上已物理删除的非整日数据无法从日汇总还原，不编造补偿。选择精确贡献而非重新加入公共成员集合，避免影响其他统计的覆盖判定。
- [x] 授权：`desktop-auth-controller.js` 区分本地用户意图和云写入；`cloud-sync-controller.js` 在发起读取时捕获会话代次，并向实际执行点传入当前账号/生命周期检查，`main.js` 只负责接线。扩展既有 cloud/auth 测试，验证退出开始后旧 GET、已入队导入、本地交互登录与账号切换。保留会话分区、加密、IPC 形状。
- [x] 设置：`cloud-sync-controller.js` 仅在 `INVALID_GIFT_BLIND_BOX_CONFIG` 时读取服务器当前有效自定义身份，过滤已删除的旧 customId，保留有效项、新草稿和普通设置；无可确定修复时继续报错/保留 pending。复用 mutationId、dirty 代次及账号 fence，成功回执才确认 pending。`cloud-settings-sync-recovery.test.js` 覆盖重开数据库、处理中编辑、换账号及网络失败；跨端隔离复现验证服务器仍拒绝旧身份。
- [x] 礼物兼容：`remote-gift-controller.js` 只在没有持久游标时接受 discovery baseline；否则建流后沿用 `catchUpLegacy`。在 `remote-gift-controller.test.js` 验证恢复、首次基线、重入。
- [x] 播放：`state/actions.js` 发布待确认请求时记录处理身份，已有批次取消逻辑保持。在 `playback-queue-behavior.test.js` 验证部分已发布时清空、旧匹配结束、再导入及快照恢复；未处理项仍可导入。
- [x] AI：`ai-assistant-settings.js` 模型请求捕获 provider/URL/protocol/key 与代次；参数变更清空列表，成功、失败、选项提交和 finally 只作用于当前请求。在 `frontend-admin-ai-settings.test.js` 验证迟到结果、已加载列表和新请求正常选择。

## 契约与同步

文档 owner：`docs/reference/backend/bilibili/gift.md`、`docs/reference/backend/storage.md`、`docs/reference/desktop/auth.md`、`docs/reference/desktop/main.md`、`docs/reference/frontend/playback.md`、`docs/reference/frontend/app.md`。检查 `docs/guides/third-party-api-support.md` 及现有使用指南；修复恢复已有承诺，没有新入口或用户操作时不重写指南。保留 HTTP/IPC/持久设置格式、服务器校验、历史导入无实时副作用和 source 隔离。

## 验证

逐项先添加失败回归，再修复并运行直接相关测试。汇总运行：

```powershell
node --experimental-vm-modules --test test/gifts/gift-wishes.test.js test/gifts/gift-retention.test.js test/gifts/remote-gift-controller.test.js test/cloud-sync/*.test.js test/playback/playback-queue-behavior.test.js test/ai/frontend-admin-ai-settings.test.js test/desktop/desktop-auth-diagnostics.test.js test/desktop/desktop-auth-race-electron.test.js
npm run verify:docs
npm run check
npm run verify:architecture
git diff --check
git status --short
```

跨端脚本使用 server 的 `runtime/node/node.exe` v24.15.0；系统 v24.21.0 不在服务器支持范围。原报告脚本断言缺陷存在，修复验收使用正向回归断言，保留原证据。必要的授权测试使用仓库现有隔离 Electron 探针，不重启用户应用。只有出现具体更广影响才扩大测试。

## 失败处理与完成条件

所有 scratch 放在根 `tmp/`。发现反证时缩小修复，不调整既有业务契约来迎合实现。失败时保留证据并仅回退本任务改动，不执行 reset/checkout 或整体文件覆盖。完成需六项正向回归通过、相关契约一致、最终 diff/状态检查结束；如存在无法恢复的历史数据或验证限制，明确记录。

## 执行记录

- 修复前：心愿历史 1 条但今日 0；清理后长期 1→0；旧游标 5→8 且无导入；退出后恢复并上传旧 Cookie；普通 queueLimit 37 被旧盲盒阻塞；清空后重复待确认；旧服务模型写入新服务，全部复现。

## 验收结果（2026-10-16）

- `node scripts/run-tests.js offline --file='test/gifts/*.test.js' --file='test/storage/*.test.js' --file='test/cloud-sync/*.test.js' --file='test/playback/*.test.js' --file='test/ai/frontend-admin-ai-settings.test.js' --file='test/desktop/desktop-auth-diagnostics.test.js' --file='test/desktop/desktop-request-auth.test.js' --test-concurrency=4`：共 923 项，922 项首次通过；唯一失败为旧库升级测试仍期望 v19。更新为本次实际 v20 后，`node --test test/storage/database-maintenance.test.js` 的 6 项全部通过。未以反复整套运行掩盖失败。
- `node --test test/gifts/gift-retention.test.js test/gifts/gift-wishes.test.js test/desktop/desktop-auth-race-electron.test.js`：33 项通过。原生探针使用隔离 userData/sessionData/dataDir 和合成凭据，实际 Electron Cookie 与 safeStorage 快照在退出后不被旧云响应恢复，正常登录恢复仍通过，子进程已退出并清理临时数据。
- 服务端 Node v24.15.0 运行跨端正向复现：原失效 customId 仍被服务器拒绝；客户端修复后云端 queueLimit=37、本地=37、pending 清除、控制器重建后仍收敛。所有数据库为隔离内存库，未修改服务端产品源码。
- gift interaction UI 在补充可操作的配置冲突提示后，原有 13 项再次通过；两个最后修改的 JS 文件单独语法检查通过。
- `npm run check`：1578 个 JavaScript 文件通过；`npm run verify:architecture`：27 项通过；`npm run verify:docs`：10 项通过（首次计划状态标签不符合门禁，改用 `Status:` 后通过）。
- 六份技术参考已同步：礼物、存储、桌面授权、桌面同步、播放和 Admin。核对第三方模型指南、站内 AI/播放/礼物指南及引导配置；没有新增入口、步骤或用户可配置项，原说明仍成立，用户指南及截图不改。
- 最终检查采用本次源文件基线副本与当前 diff 对照；既有字体、富文本 v19 等未提交内容保留。仅新增 gift_db v20 的精确贡献表，不改变云端协议或凭据格式，不放宽授权/官方盲盒校验。

限制：未跑整个仓库全量套件、生产规模性能测试或真实外部账号登录；升级前已经物理删除的非整日明细不能靠日汇总精确补回。未提交、打包、发布或替换用户安装版。详细日志位于 `tmp/quality-review-2026-10-16/fix-*.log`。