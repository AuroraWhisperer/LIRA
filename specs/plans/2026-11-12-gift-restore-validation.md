# 重装后的礼物恢复校验修复

Status: Awaiting Verification

用户要求重装后能看到云端礼物记录。

## 证据与边界

安装版与工作区的恢复模块一致。只读诊断发现本机首次 bootstrap 未完成，暂存快照停在 history；服务器访问日志确认汇总和历史均返回 200。合成数据证明网络入口规范化后的金额分字段被存储入口的 wire 白名单再次拒绝。现有控制器集成测试使用原始历史 DTO，未经过真实网络入口规范化。

继续使用现有来源、保留快照、事务和重试机制；不改服务器、认证、wire 字段、数据库格式、保留期限或历史事件的统计资格，不操作运行中的应用及真实账本。

## 修改与验收

- [x] 在现有恢复集成测试中接入 `createGiftOperations`，复现规范化页面不能入库；内部历史页使用独立 canonical 入口，网络入口继续严格校验 wire。
- [x] 最近礼物读取当前来源已发布的保留明细；恢复完成后发布一次现有来源快照。历史恢复不触发新礼物通知、冲刺或加班消费者。沿用现有恢复、来源快照、通知测试补齐上述业务覆盖。
- [x] 更新礼物 owner 参考及受影响使用说明，核对现有流水重试说明；受影响的 9 个完整测试文件共 64 项、文档门禁 10 项及 8 个变更 JavaScript 文件语法检查通过。
- [ ] 包含修复的新安装版及原账号恢复验收；本任务未打包、替换或重启用户正在运行的应用。

Owner：`src/shared/processed-gift-contract.js`、`src/storage/gift-retention-store.js`、`src/storage/gift-query-store.js`、`src/server/gift-export-runtime.js`、`public/js/admin/gifts/notification.js`。契约：`docs/reference/backend/bilibili/gift.md`。消费者：现有 Electron 恢复控制器、Admin 最近礼物及历史抽屉。测试：`test/gifts/gift-retention.test.js`、`gift-source-snapshot.test.js`、礼物通知所属测试与严格 wire 契约测试。

失败处理：事务失败继续保留已提交的下载检查点；只检查并修正本任务差异，不清理用户数据。安装版恢复验收需包含修复的新客户端，源码测试不能代替正式安装后的结果。

验证记录：恢复控制器的首次启动和旧 epoch 两例接入真实 `createGiftOperations` 后先失败，修复后通过；已发布明细展示、恢复快照刷新和通知隔离三例同样先失败后通过。运行 `npm test` 的文件选择为 `gift-retention`、`gift-source-snapshot`、`gift-query-service`、`processed-gift-import`、`processed-gift-import-atomicity`、`processed-gift-contract`、`frontend-gift-history-recovery`、`frontend-gift-panel` 和 `frontend-toast-business`。契约文件首次因相邻 Server HEAD 与锁定版本不同而未加载；按原锁在 `tmp/` 准备独立检出后，仅重跑该文件，5 项通过，未修改版本锁或相邻工作区。接口和持久化格式保持不变；引导入口未变化，无需修改交互式导览。
