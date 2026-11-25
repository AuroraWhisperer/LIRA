# ADR-0019: 以稳定主播 ID 标识礼物数据来源

## 状态

已采纳（2026-09-16，替代 [ADR-0011](0011-source-partitioned-gift-ledger-projection.md) 仅按账号名标识来源的方案）

## 背景

服务端移除租户后允许以新的不可变主播 ID（`streamerId`）复用原账号名。旧版 `gift-source-v1` 哈希仅包含服务端源地址与账号名，导致同名新建的主播在发现接口完成前可能读到前任账号的本地投影。早期客户端规格中“账号名不可变”的假设与服务端身份约定及 [LIRA Server ADR-0016: Permanent Streamer Removal](https://github.com/AuroraWhisperer/LIRA-server/blob/b4e7447c5a83c03b3e0bfc62a733782886f05da9/docs/architecture/decisions/0016-permanent-streamer-removal.md) 相冲突。

## 决策

改用带版本号的 SHA-256 来源键，输入为规范 HTTPS 源地址、小写账号名以及来自主进程专用 `getCloudSyncIdentity` 边界的正安全整数 `streamerId`。缺少稳定身份时按默认拒绝（fail-closed）处理。渲染进程快照不可替代该主体身份，也不向礼物传输格式（DTO）或渲染进程接口额外暴露身份字段。

存量 v1 来源缺少可证明的稳定归属，保留其记录仅供诊断，不自动分配、复制或迁移至 v2 来源。v2 来源从已认证的服务端账本重新初始化；对同一已验证的 v2 账号，正常离线读取（含发现接口失败场景）依然可用。沿用 [ADR-0011](0011-source-partitioned-gift-ledger-projection.md) 的授权/控制器/投影防护校验（fence），丢弃旧账号的迟到异步任务。

## 影响

- 同名重建的主播无法复用前任账号的本地投影或同步游标。
- 首次切换至 v2 来源时会重新拉取历史记录；不支持新协议的旧服务端保持 `LEGACY_PARTIAL`，不能把留存的 v1 历史视为完整账本。
- 旧记录保留在磁盘上，但不参与活动来源查询结果。
- SQLite 表结构、存储事务、渲染进程路由与传输协议均保持不变。

## 验证

来源键单元测试覆盖同名重建区分与缺失 ID 拒绝；基于真实 SQLite/控制器/查询服务的回归测试验证保留旧记录与遗留记录的同时，在发现接口失败时仅返回新账号的空投影，且切号后延迟到达的旧发现响应不得推进任何一方游标。

## 参考

- [礼物账本投影同步设计规格](../../../specs/gift-ledger-projection-sync_design.md)
- [ADR-0011](0011-source-partitioned-gift-ledger-projection.md)
