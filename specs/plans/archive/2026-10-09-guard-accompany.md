# 陪伴天数共享接口与日历纪念日

Status: Complete

用户授权在当前会话直接实施；未提交或部署。

## Goal

B 站实际陪伴天数进入本机粉丝档案；上舰检测、天数提取及答谢使用共享模块。日历自动显示可配置的 100、365、500、1000 天纪念日，复用档案提醒状态。

## Current Behavior / Ownership

- 两仓库 `bilibili-guard-roster.js` 已从陪伴榜提取 `accompanyDays`，桌面 importer 尚未保存。
- Server `bilibili-guard-membership.js` 已统一上舰检测；RoomMonitor 内的名单补全需要抽成可调用服务。
- `src/fans/` 拥有档案数据、提醒与备份校验；`src/storage/fan-profile-store.js` 事务保存 JSON。
- `fan-profile-controller.js` 绑定授权账号；`fans/view.js` 与工作台是私有 IPC 消费者。
- `reminders.js` 已有人工累计/连续里程碑；工作台日历目前只显示手动日程。

## Compatibility / Non-goals

沿用 DeviceBearer、原账号 scope、稳定会员事实 ID、IPC 来源校验、备份 v1 及 SQLite 表结构。新快照字段可选，旧资料无需迁移。私人资料不进入 overlay。保留已有卡片设计及无关修改；不新增框架、依赖、HTTP 公开档案接口或通知系统，不从购买月数推导陪伴天数。

## Proposed Changes

1. 共享 `normalizeGuardAccompany` 校验 `{ days, observedAt, roomId, source }`；Server `createGuardMembershipService` 对显式 toast 或同 UID / 绑定房间名单取值，并共享进行中的读取及取消。
2. 私有会员事实可选携带 `guardAccompany`。同稳定 ID 的较新快照提升游标，保留原会员事实。桌面在会员记录去重之前应用快照，防止漏掉晚到的天数，同时不重复插入上舰记录。
3. 本机档案 JSON 保存独立 `guardAccompany`。统一 helper 提供读取、新旧比较和预测资格；从名单消失保留实际天数、暂停未来预测。备份校验和恢复支持可选字段。
4. 档案提醒使用独立 `accompany:<roomId>:<threshold>` key，默认阈值 100/365/500/1000；可设置阈值和是否在日历显示。按北京时间从观测日推算未来日期，标为预计。超过 7 天、已确认下舰、归档或关闭里程碑时不生成预计提醒；不回填未知历史达标日期。
5. `calendar` 是已有私有 IPC 的只读 action，生成日历显示 DTO；工作台只在内存组合，绝不写入全局 localStorage 日程。轮询与页面生命周期绑定，授权变化及读取失败清除旧显示，处理状态继续由档案 owner 管理。

## Milestones / Verification

- [x] 共享服务和事实增量：Server membership、fan-facts、room-monitor-overlay 及 independent-monitoring 测试；覆盖 UID/房间、取消、无效及晚到快照。
- [x] 档案持久化与提醒：现有 fan-profiles 测试；增加观测来源、旧快照、同单补全、备份重启、阈值日期、下舰/过期/归档/处理历史覆盖。
- [x] 档案与日历 UI：前端 view、planner 测试及隔离 Electron 实际显示；覆盖私有数据不入日程存储、过期响应与停止清理。
- [x] 同步 `specs/fan-profiles.md`、preload/storage 参考、Server fan-facts/OpenAPI/fixture、所属 requirement/acceptance 和使用指南；运行两仓库文档 gate。
- [x] 最终检查 scoped diff、`git diff --check`、`git status --short`，确认无运行数据进入 diff。

命令使用 Server `tmp/runtime/node-v24.15.0/node.exe`。Server Node 测试加 `--require ./test/support/test-mode.cjs`，Live 前端测试加 `--experimental-vm-modules`；临时数据库设置 TEMP/TMP 到 Live 根 `tmp/`。不默认运行全量测试。

## Failure Handling / Done When

查询失败保留已确认的天数；不制造新天数或上舰记录。账号变化/停止丢弃晚到结果。备份与导入校验失败在现有事务回滚。仅按任务前快照审阅和反向修改本次范围，不破坏其他未提交内容。

上述三个消费方使用同一数据口径、默认纪念日正确显示、直接相关检查通过且契约同步后完成；真实线上/OBS/直播姬运行或发布未执行时如实记录。

## Verification Results

- Live：fan-profiles 全目录、planner/model/view/reminder 与 roster 共 177/177；使用独立的锁定服务端检出验证旧 v1 兼容，不改 server-contract.lock.json。
- Server：fan-facts、shared guard service/parser、overlay gifts、RoomMonitor 和 independent-monitoring 共 62/62。发现并修复卡片延迟发布条件对“已接收礼物关闭监听后继续结算”的影响。
- 最后局部更新后 Live 功能/架构检查 57/57（同轮文档检查另列），Server 共享接口/事实测试 23/23；Server docs:check 48/48。
- 隔离 Electron：复用现有 canvas fixture 的真实 preload/请求授权，注册真实 fan IPC/controller/service，测试数据库位于 tmp。验证 499 天档案、100/365/500/1000 默认值、次日 500 天预计日历、设置开关、已处理消失、日程 localStorage 仍空；pageerror 为零。截图位于 tmp/guard-accompany-ui。
- Live 文档检查收尾复验 10/10；自己的接口、文档链接及路由边界检查通过。
- 隔离 Electron 已关闭。自动审批拒绝临时验证数据清理命令（blocked by policy）；本次隔离数据与锁定服务端检出暂留在被 Git 忽略的 tmp/guard-accompany-ui 和 tmp/guard-accompany-contract。
- 没有修改真实用户数据，没有联网购买/发送消息，没有发布或实播验证。计划完成范围是源码、隔离验证和合同同步。
