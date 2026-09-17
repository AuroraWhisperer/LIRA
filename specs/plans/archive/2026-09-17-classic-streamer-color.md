# Classic Streamer Color Implementation Plan

**Goal:** 经典样式中，当前房间主播本人的名字标签和正文气泡显示参考图的绿色；普通观众保持青蓝色，舰队配色保持原样。

**Architecture:** 在已有 B 站房间上下文中比较发言 UID 与房间主播 UID，公开展示只携带可选布尔值 `isStreamer`，不新增 UID 暴露。共享渲染器输出独立的 `data-streamer` 标记，仅 `ranked.css` 使用它改变配色。

**Tech Stack:** 现有 Node.js、原生 JavaScript/CSS 与 Node test runner，无新依赖。

## Boundaries and Current Behavior

当前本地消息入口持有 `roomOwnerUid`，服务器 RoomMonitor 的 `room_init` 结果提供 `uid`，但弹幕展示投影未携带主播身份。`ranked` 只有 viewer/fan/captain/admiral/governor 配色。

不修改授权、租户选择、B 站连接策略、持久化、其他风格或舰队等级字段。不提交、打包或部署；保留已有未提交修改。

## Ownership and Compatibility

- Client: `src/bilibili/danmaku/message-handlers.js` 判定主播；`feed-buffer.js` 保留展示字段；共享渲染器、`ranked.css` 和本地预览消费它。
- Server: `src/modules/bilibili/room-monitor.js` 保留当前房间主播 UID 并在事件投影中判定；`public/overlay/app.js`、共享渲染器及 `styles/ranked.css` 传递和显示。
- Contract: `docs/protocol/public-overlay-api.md`、对应 OpenAPI 与合成 fixture；requirement/acceptance 同步说明。`isStreamer` 可选，缺失等同 false，旧客户端忽略新字段；不新增事件类型，不发布 UID。主播绿色优先，主播不显示舰队船锚。

## Implementation and Verification

- [x] 在现有入口和投影测试中加入本人、同名非本人、房间切换与缺失身份场景；新增字段遵循布尔值严格判断。
- [x] 最小实现入口标记、投影保留及绿色样式；为本地经典样式保留一条可见主播示例。
- [x] 更新协议、fixture、需求和验收；运行 Client 的 `danmaku-client`、`danmaku-feed-buffer`、`danmaku-overlay-renderer`、`danmaku-overlay`、`danmaku-local-preview` 测试，以及 Server 的 `room-monitor-overlay`、`overlay-preview`、`overlay-protocol-contract`、`overlay-public-sse`、`overlay-static`、`overlay-asset-cache` 测试。
- [x] 比较两端 CSS/renderer；在源码预览确认主播绿色、普通观众青蓝及舰队船锚；检查两仓库 diff、`git diff --check`、status。

## Failure Handling and Done When

UID 未知时按普通观众显示，不按昵称、房管或登录账号猜测。失败仅修正本任务差异；不重置用户文件。上述展示、兼容测试、协议说明及最终差异检查完成后归档本计划。

## Completion Evidence

2026-09-17 完成。修改前的五项针对性验证复现缺少主播标记；实现后 Client 23 项、Server 39 项及服务器文档/架构治理 22 项全部通过。源码浏览器预览已确认主播绿色、普通观众青蓝和蓝紫红舰队船锚。

两端经典 CSS（资源前缀转换后）一致，renderer 的严格布尔标记一致；服务器原有 `is-system` 类差异保留。已保存配置和事件类型未变，`isStreamer` 为可选兼容字段。未打包、部署或提交。
