# 直播期间固定回复 Implementation Plan

Status: Completed

## Goal

固定回复九项中，签到、抽签全天可用；进场欢迎、点歌回复、完整匹配回复（含菜单）、关键词回复、PK、定时／随机弹幕、查询回复仅在确认直播中生效。下播取消未发送工作，保留开关和词库；再次开播不补发旧消息。

## Scope and ownership

- Server `RoomMonitor` 保留全天连接、礼物记录与签到/抽签 source；`danmaku/live-reply-session.js` 管理独立的直播回复 source 和取消信号。欢迎、查询和精确/定时回复共用该信号，PK 沿用其取消入口。
- Desktop `LiveStatusMonitor` 统一接收 REST 与 LIVE/PREPARING 状态；`danmaku/live-reply-sender.js` 统一约束点歌回复和关键词回复，在发送前及每段发送前核对直播与原账号/房间会话。
- 欢迎仍记录有效的下播进场时间，查询及精确回复的冷却对象不因下播被重建。礼物答谢、AI、手动发送、点歌入队规则不在本次九项开关范围内。

## Constraints

不新增进程、依赖、数据库或配置字段，不改变 HTTP/IPC schema、鉴权、租户边界和全天监听。保留两仓现有未提交修改，不提交或发布。新直播会话不能恢复旧队列；已提交给 B 站的单次请求不能撤回。

## Current behavior

PK/定时已有直播限制，其余七项原本全天可触发。Server ADR-0060 的欢迎与查询取消边界需要由新 ADR 部分替代。桌面 LIVE/PREPARING 原来只清点赞状态，LiveStatusMonitor 只轮询下播房间。

## Milestones

- [x] 更新现有欢迎、连续监听、固定回复测试，补直播来源隔离和排队取消；实现 Server 共享直播回复会话。
- [x] 补桌面直播状态和发送中下播测试；实现统一发送入口，处理过期轮询与开下播事件。
- [x] 同步 Server requirement/acceptance/protocol/ADR、Desktop 技术参考与应用内说明；UI 复用固定回复说明位置，不复制提示。
- [x] 相关模块测试、文档与架构门禁通过；差异只包含本次职责边界及原有用户修改。

## Verification

Server：`npm run verify -- --node test/welcome-lifecycle.test.js --node test/welcome-stages.test.js --node test/room-monitor-continuous.test.js --node test/room-monitor-pk.test.js --node test/fixed-reply.test.js --node test/gift-chat.test.js --node test/daily-bot-runtime.test.js --plan`，查看计划后执行同范围；`npm run docs:check`。

Desktop：`node --test` 执行 `test/bilibili/bilibili-live-status-monitor.test.js`、`test/bilibili/live-reply-sender.test.js`、`test/bots/custom-reply-service.test.js`、`test/danmaku/danmaku-client.test.js`、`test/danmaku/danmaku-reconnect-backoff.test.js`、`test/danmaku/danmaku-sender-service.test.js`；指南测试使用 `--experimental-vm-modules`。`npm run verify:docs`、`npm run verify:architecture`。

不启动真实账号或生产服务。异步及生命周期变更按消费者扩展相关测试，避免无关全量。失败先定位再重跑所属文件。

## Failure handling and done when

失败保留已保存设置，未知/失效的直播会话拒绝回复；仅撤回本任务 diff，绝不覆盖现有修改。九项行为与文档一致、测试通过、差异检查完成即结束；真实 B 站与安装包/部署状态单独说明。

## Completion evidence — 2026-10-21

- Server 扩展到 17 个相关文件，执行的 189 项测试全部通过，2 个调度器文件复用有效结果。涵盖持续连接、下播取消、再开播不回放、租户隔离、查询等待及签到/抽签；`npm run docs:check` 57 项通过。
- Desktop 10 个相关文件共 92 项通过；`npm run verify:architecture` 27 项、`npm run verify:docs` 10 项通过。
- 查询和欢迎领域对象保留 cooldown；仅本场发送 source 作废。原有重连允许开播检测接管未完成的连接，未停止该轮询路径。
- UI 仅调整现有说明文案，没有布局或控件变化；使用现有 markup/指南测试。README、交互引导、HTTP/IPC schemas 不含失真的相关操作或字段，未修改。
- 未访问真实 B 站、启动用户应用、构建安装包、提交或部署。检测下播前存在既有状态监测延迟，已提交上游的请求无法撤回。
