# 固定回复类型扩展实施计划

Status: Completed

用户要求：新增精确自定义回复（内置菜单）与定时／随机弹幕，按四行两列重排，并统一随机点歌说明及 PK 刷新。

## 目标与边界

保持现有桌面视觉和八项功能的独立开关。新精确回复去首尾空白后全字匹配；`菜单`为保留指令，由已启用的云端能力及桌面命令摘要生成。现有包含关键词匹配保持兼容。定时消息仅直播中发送，固定或随机秒数，每轮顺序或随机选择一条词库；开启先等待，停止不追发。

不迁移现有关键词/随机点歌执行所有权，不增加进程或依赖，不提交或发布。保留两仓已存在的未提交改动。

## 当前行为与所有权

- `public/pages/admin/toolbox/danmaku.html`、`danmaku-fixed-replies.js`：固定回复卡片与单一展开编辑区；PK 通过独立云端 IPC 读取并有多余行内刷新。
- `danmaku-libraries.js`：关键词词库草稿编辑；签到/抽签已有独立云端词库。
- `src/electron/ipc/license-overlay-ipc.js`、`license/license-operations.js`：受授权账户保护的窄桥；扩展同类 fixed reply 桥。
- 服务端 `streamer-sync-settings` 与 `room-monitor`：既有租户云设置、事件和统一发送调度。新字段可选且旧客户端省略时保留，不新增数据库表。
- 桌面 `custom-reply-service`/`domain-services`：包含匹配、AI前置判定。新增只读内存投影抑制云端精确指令重复回复。
- 菜单桌面命令由组合根读取各领域公开状态，作为展示摘要上传；不是授权依据。

## 契约与兼容

新增云端字段：`customExactReplyEnabled`、`customExactReplies`（最多30条，trigger 30字、reply 120字）、`scheduledDanmakuEnabled`、`scheduledDanmaku`（fixed/random、10–86400秒、sequential/random、最多100条120字词库）。`menuCommands`为桌面能力摘要，云端明确标注需客户端在线。新配置仅云端持久化，不能加入本地默认同步键覆盖远端。旧服务器未返回新字段时明确提示升级。

保留设备认证、账户切换隔离、既有端点与发送队列。timer所有者取消禁用/离线/停播/换房/改配置任务，发送前再次检查有效会话。不读取真实用户数据、不向真实直播间发测试弹幕。

## 里程碑与验证

- [x] 云端可选配置、精确/菜单路由、定时执行；服务端领域/HTTP/调度测试验证精确匹配、租户隔离、旧客户端省略保留、停播与取消。
- [x] 桌面受限 IPC、内存投影与菜单摘要；IPC、投影、系统指令优先和菜单定向检查通过。
- [x] 八项总览、两个编辑区、草稿保留、统一刷新；前端针对性测试及既有隔离 Electron fixture 验证真实 preload/IPC、四行顺序和表单行为。
- [x] 更新前端/桌面/弹幕技术参考、应用内使用说明、服务端协议与需求验收；运行两仓相关文档门禁。
- [x] 查看任务 diff、`git diff --check`、`git status --short`，只有两张有意补充的使用指南图片进入产品目录，运行数据与 QA 截图留在 tmp。

## 验证与复核证据

2026-10-12 完成：客户端新旧固定回复编辑器最终 9 项通过，IPC/命令去重/云投影/菜单/PK 相关 24 项通过，使用指南 16 项通过。既有签到/抽签及新增固定回复隔离 Electron 测试通过；真实管理页、preload 与 IPC 使用临时授权 fixture，没有读取用户数据或连接真实直播间。总览、自定义回复和定时编辑器截图已复核。

服务端最终 `fixed-reply`、`cloud-sync-http`、`cloud-state-sync`、`cloud-state-atomicity`、`settings-input-contract` 五套件 50 项通过，文档检查 55 项通过。调度器、发送合同和监控接线定向检查也通过。客户端 `npm run check` 的 1477 个 JS 与架构检查 27 项通过；文档门禁首次受同期点歌冷却计划状态阻断，该任务修正后，本计划归档时复验 10 项全部通过。

独立复核的四项问题均已闭环：固定回复窄 PATCH 在真实 HTTP 入口可保存且并发字段互不覆盖；切换定时模式忽略未启用字段的草稿；系统点歌保留优先级；菜单列出实际可用的自定义触发词。点歌解析兼容对照 480 组输入零差异。最终复核结论可交付，无已知任务阻塞。

测试、技术文档和使用指南已同步；交互引导没有逐项固定回复操作说明，无需改动。保留新服务端需发布、真实 B 站发送尚未执行的验收边界；本任务未提交、部署或替换安装版。

隔离 Electron 进程已关闭；工具安全策略拒绝删除 `tmp/fixed-replies-visual-vaJHLJ`，临时 fixture 数据与 QA 截图因此保留在该目录，不进入产品 diff。

## 研究依据

[Nightbot Timers](https://docs.nightbot.tv/control-panel/timers)采用固定间隔与聊天门槛；[StreamElements Timers](https://docs.streamelements.com/chatbot/timers)支持多条消息轮播。本次只采用间隔、词库与直播条件；随机秒数为用户额外要求，不引入聊天门槛。

## 失败处理与完成条件

保存失败保留草稿与已确认开关；切换账户丢弃旧账户内存状态。检查失败定位任务相关差异，不批量回滚已有变更。完成要求是功能/对应测试/文档一致、隔离桌面可操作且最终diff已审查；真实云端上线和真实B站发送不属于本次验证。
