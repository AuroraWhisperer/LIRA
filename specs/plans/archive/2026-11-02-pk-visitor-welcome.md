# PK 串门欢迎实施计划

Status: Completed (2026-11-02)

## Goal

在现有「PK 对手信息播报」位置提供 PK 总开关、对手概况与对面观众进场欢迎两个子开关；串门欢迎可设置进房后的延时和词库。用户已确认仅检测对面观众进入己方直播间，并在己方欢迎。

## Current Behavior

客户端只有 `enabled` 开关，服务器 `PkReportService` 在认证 PK START 后复用房间信息与最多三页在线榜采样，聚合大航海、榜内身份和贡献档位；尚未识别访客。采样的 UID 被聚合后丢弃。`WelcomeService` 已拥有进房接收、昵称/称呼、去重冷却、延时、40 UTF-16 单位格式化、统一发送队列及欢迎回声隐藏。

## Ownership

- Live：`public/pages/admin/toolbox/danmaku-pk-report-switch.html`、`public/js/admin/danmaku-pk-report.js` 及固定回复编辑区；`src/electron/ipc/license-overlay-ipc.js` 验证/投影服务器设置。
- Server：`src/storage/pk-report-settings.js` 持有租户设置；`pk-report-service.js` 持有 PK 身份和生命周期；`pk-report-snapshot.js` 持有本次采样；进房 parser 和 `room-monitor.js` 传递归属线索；`welcome-service.js` 持有唯一欢迎流程。
- 合同：Server `docs/protocol/pk-opponent-report.md`、Device OpenAPI、REQ-BILI-012 / AC-BILI-011；Live desktop/main、preload 与 frontend/pages 及应用内固定回复指南。

## Compatibility Constraints

保留原 endpoint、IPC 名称与 `danmaku.pkReportEnabled` 布尔键。新增选项保存在同租户 `streamer_settings` 的 `danmaku.pkReportOptions`，无需 schema migration；旧 `{enabled}` 写入不得清空新偏好。保留锁定的旧 fixture 字节，新增扩展 fixture。旧服务器响应仍可操作原总开关，新增编辑项显式不可用。

当前两仓均有用户未提交修改，尤其监控、发送器和相关文档；仅修改本任务内容。不提交、建分支、部署、打包或接触真实用户数据。凭据、租户和来源边界不变。

## Proposed Changes

新增设置默认值为：

```js
{
  reportEnabled: true,
  visitorWelcomeEnabled: false,
  visitorWelcomeDelaySeconds: 5,
  visitorWelcomeMessages: ['欢迎 {username} 从对面来串门～'],
}
```

总开关默认仍为 false。延时为 0–300 秒整数；词库复用现有欢迎规则：1–30 条、每条非空、最多 80 码点、无控制字符。更新采用严格白名单、非空 patch 与事务；普通旧写入兼容。

识别使用同一次在线榜采样 UID（最多 150 个）或进房事件中对手直播间的粉丝牌房号，仅保存在本局内存。不另开对面 WebSocket、添加轮询或补采请求。榜单和粉丝牌仅提供观众归属线索，不能证明实际切房路径，也不是完整观众名单。

PK session 提供 `getWelcomeContext(entry)`，返回本次延时、词库、取消信号和有效性检查。仅认证 START 和明确对手齐备、直播与来源仍有效时可匹配；检测持续到本局结束，不能误用开场播报的 30 秒期限。开场播报到期独立取消；PK/直播结束、换来源/凭据、关闭或改变相关设置取消待发串门欢迎。

`RoomMonitor` 在唯一的 `WelcomeService.onEnter` 调用传入该上下文。命中后用串门词库和延时替代普通欢迎，独立于普通欢迎开关、荣耀门槛、个人/久别文案，不另发二次问候；复用原 UID 冷却、发送权限、队列、格式化和回声隐藏。未命中继续原欢迎流程。

## Milestones

- [x] 设置与合同：兼容旧写入，新增字段严格校验、事务持久化与租户隔离；验证扩展 HTTP/存储用例和旧 fixture。
- [x] 检测与欢迎：保留榜内 UID、解析牌子归属、分离开场播报和整局检测生命周期，复用单次欢迎流程；验证 UID/牌子匹配、普通欢迎不重复、延时及取消。
- [x] 客户端设置：当前开关作为总开关、共享编辑区内两个子开关与延时/词库；验证确认状态、保存失败草稿、账号隔离与旧服务器兼容，并做隔离 Electron 检查。
- [x] 同步合同和用户指南、聚焦回归、两仓文档门禁、最终 diff/status 检查。

## Verification

Server：通过仓库 Node wrapper 执行完整相关文件：`test/pk-report-settings-http.test.js`、`test/pk-report-settings.test.js`、`test/pk-report-service.test.js`、`test/pk-report.test.js`、`test/pk-history.test.js`、`test/room-monitor-pk.test.js`、进房 parser 所属测试和 welcome 所属测试；运行 `npm run docs:check`。

Live：执行 `test/gifts/frontend-pk-report.test.js`、`test/gifts/pk-report-settings-ipc.test.js`、`test/gifts/pk-report-settings-owner.test.js` 和直接受影响的固定回复编辑区测试；复用 `scripts/verify-welcome-settings.cjs` 的隔离 Electron fixture 做共享编辑区、两个子开关、延时和文案保存/读回检查。运行 `npm run verify:docs`，以及 impeccable 对修改 UI 的一次检测。

相关输入编辑完成后再执行统一回归；不在运行中修改被测输入。两仓最终都检查 `git diff --check`、任务 diff、`git status --short`，确认临时材料仅在 `tmp/`。

## Rollback Or Failure Handling

关闭新子开关即可停止串门欢迎，保留原播报与已保存偏好。失败时检查本任务 diff，逐块撤回任务改动，不覆盖用户既有修改。检测只能尽力识别；上游未发进房事件、未在采样榜单且无对手牌子的观众无法识别，不声称全覆盖。

## Done When

以上里程碑完成，实际 UI 保存/读回和后台合成行为均有证据，相关文档一致，已执行的聚焦验证通过，未发现越权、跨租户、重复欢迎或生命周期遗留；明确报告真实 B 站实播、安装包与部署的验证边界。

## Results

Server 18 份相关完整测试文件共 135 项通过；Live 6 份完整相关文件共 50 项通过。两个补充边界先有失败回归再修复：START 的凭据快照绑定本局线索；等待对手期间关闭两个子功能后不再取数。独立复查确认两项均已解决。

隔离 Electron 通过真实 preload/IPC 和生产页面片段完成总/子开关、延时与词库保存、重载读回、旧服务器兼容及原欢迎流程检查；没有启动用户应用。初次检查发现既有 QA 片段截取正则被嵌套 section 提前截断，改为按 section 深度截取。视觉检查发现新增词库添加按钮被旧图标列宽挤压，复用欢迎词库的 auto 列宽修复，确认截图在仓库 `tmp/welcome-check-kfv7OG/pk.png`。

Live 文档门禁 10 项通过，Server 文档/契约/架构门禁 59 项通过。Server 第一次文档检查受无关的缺失 ADR 链接阻断；该文件随后已在当前工作区出现，复跑 59 项全通过，本任务未修改该 ADR。UI detector 返回空问题列表；两仓 `git diff --check`、任务差异和状态已核对，未提交运行数据或生成物。

保留旧合同锁和 fixture；Live 兼容测试使用 `tmp/` 中独立的锁定版本只读检出，不修改当前 Server 分支。实际 B 站直播中的上游事件覆盖、安装包和服务器部署均未执行；识别是已有榜单/牌子的尽力归属推断，不是全量跨房追踪。
