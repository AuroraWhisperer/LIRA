# ADR-0004: 复用现有模块化单体与 `gift-data.db`

## 状态

已采纳（2026-08-10，原编号：ADR-OT-003）

## 背景

LIRA 是面向单用户的本地桌面工具，采用 Node.js 原生 HTTP/WebSocket、原生 JavaScript 与 SQLite 的模块化单体架构，已具备礼物数据库（`gift-data.db`）、静态页面路由、会话令牌鉴权以及建连推送全量快照的 WebSocket 通道。本 ADR 提炼自加班机设计规格（2026-08-10 采纳），并在 v3.3.14 代码库（`src/storage/database.js` v5 迁移、`src/overtime/`）中验证落地。

## 决策

将加班机作为新领域模块纳入现有进程，并在既有 `gift-data.db` 中新增三张表：`overtime_machine_state`（倒计时状态机单行表）、`overtime_gift_rules`（按礼物配置的规则表）与 `overtime_settlements`（以 `gift_event_id` 为键的结算账本）。不引入新进程、微服务、消息队列、框架或运行时依赖；直接复用现有会话令牌鉴权与 WebSocket 通道，并将 `/overtime` 页面加入既有静态页面映射。

## 影响

### 正面影响

- 只要本地服务启动，加班机即刻可用，部署边界与现有系统完全一致。
- 礼物结算、共享 `gift_events` 账本与加班机状态表可在单个 SQLite 事务内原子提交。
- 不增加新的运维复杂度、网络边界或部署形态。

### 代价

- `gift-data.db` 同时承载加班机数据：清空礼物库时，必须在同一事务中一并清空 `gift_events` 与 `overtime_settlements`（含各自自增序列），同时保留规则配置和当前倒计时状态。
- 加班机领域不可独立部署，随本地服务一同交付。

### 中性影响

- 新增表结构与索引均通过现有数据库迁移机制（v5）完成。

## 备选方案

**拆分为独立服务进程或微服务**

- 否决：单用户本地部署不需要额外的网络边界和分布式运维负担。

**为加班机单独新建 SQLite 数据库**

- 暂缓：会破坏与共享礼物事件账本之间的单事务原子结算，并增加备份与清理复杂度。

## 参考

- [server-core.md](../../reference/backend/server-core.md)
- [storage.md](../../reference/backend/storage.md)
- [overtime.md](../../reference/backend/overtime.md)
- `src/storage/database.js`（`giftDb: 'gift-data.db'`，v5 迁移）
