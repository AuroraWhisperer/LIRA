# ADR-0006: 共享礼物检测核心与消费者注册表

## 状态

已采纳（2026-08-10，原编号：ADR-OT-005）

### 2026-09-13 归属变更说明

下文所述的客户端原始检测核心已移除。礼物解析、分组、金额与盲盒判定以及终态确认现已统一由服务端负责（详见 [服务端权威礼物检测规格](../../../specs/server-authoritative-gift-detection_design.md)）。客户端 [礼物投影服务](../../reference/backend/bilibili/gift.md) 仅保留对服务端事件的消费者故障隔离、资格冻结与幂等交付机制。以下原始决策仅作为历史记录保留，不再作为本地降级方案。

## 背景

此前 `src/bilibili/gift/event-service.js` 将底层礼物检测、事件持久化与 `enableGiftSprint` 开关耦合在同一服务内，导致关闭礼物统计开关时加班机也收不到礼物。礼物统计与加班机需要共用同一套标准化、平台去重与连击合并逻辑，但各自的启停开关和业务结果必须互相独立。本 ADR 提炼自加班机设计规格（2026-08-10 采纳），并在 v3.3.14 代码库（`src/bilibili/gift/detection-service.js`、`consumer-registry.js`、`statistics-consumer.js`、`src/overtime/overtime-consumer.js`）中验证落地。

## 决策

由单实例 `GiftDetectionService` 统一负责礼物解析、字段标准化、平台去重与连击合并。每条原始 B 站礼物仅通过 `giftDetection.detect(gift)` 进入系统一次；检测核心在 `gift_events` 中维护 `progress`/`final` 生命周期，并在该分组收到首个平台数据包时冻结各消费者的业务资格（`gift_stats_eligible`、`overtime_epoch`）。标准化事件通过消费者注册表分发给 `GiftStatisticsConsumer` 与 `OvertimeConsumer`，单个消费者抛错不会阻断其他消费者。

只要至少有一个消费者处于启用状态，检测核心即保持运行；当所有消费者均关闭时，核心停止接收新原始礼物，但会先将已落库的 `progress` 分组排空至 `final` 后再进入空闲。所有连击定时器、强制刷盘与停机排空均汇入同一条 `finalizeDetected()` 路径，查询接口绝不修改礼物生命周期。终态由基于 `last_platform_at_ms` 整数字段的单个 10 秒静默窗口统一裁定，两个消费者收到 `final` 后均立即结算，不再各自二次等待 10 秒。

通过幂等检查点（统计侧的 `counted_in_sprint`/`gift_stats_delivered`、加班机侧的 `overtime_settlements` 状态）以及按 1–30 秒指数退避的补偿扫描，实现“至少一次投递、恰好一次业务生效”，在首次投递失败或进程重启后无需依赖平台重发即可恢复符合条件的 `final` 事件。

## 影响

### 正面影响

- 全系统只有一套解析、标准化与去重规则，两项功能不会对同一数据包产生分歧。
- 礼物统计与加班机彻底解耦，任意一方关闭时另一方仍可独立运行。
- 消除重复解析与重复写入 `gift_events`，共享账本便于审计与排查。
- 两个消费者共用同一 `gift_events.id`，统计归属与加班机结算互不干扰。

### 代价

- 需要重构原有礼物服务边界，并为故障隔离与补偿扫描补充测试。

### 中性影响

- `gift_events` 成为共享检测事件账本；统计查询只读取 `gift_stats_eligible` 为真的 `final` 记录，`progress` 与仅用于加班机的事件不会混入礼物统计。

## 备选方案

**让加班机继续调用受 `enableGiftSprint` 控制的旧服务**

- 否决：两个功能开关仍会耦合，关闭礼物统计时加班机无法接收礼物。

**在加班机模块内复制一套礼物解析器**

- 否决：两套去重与连击合并状态会随演进逐渐分叉。

## 参考

- [overtime.md](../../reference/backend/overtime.md)
- `src/bilibili/gift/detection-service.js`
- `src/bilibili/gift/consumer-registry.js`
- `src/bilibili/gift/statistics-consumer.js`
- `src/overtime/overtime-consumer.js`
