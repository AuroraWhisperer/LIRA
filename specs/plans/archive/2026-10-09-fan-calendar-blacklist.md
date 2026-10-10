# 粉丝日期日历与黑名单

Status: Complete

## Goal / Scope

粉丝档案中的有效日期与陪伴纪念日，在目标日期前三天开始显示于工作台日历的目标日，并通过现有 lira-help 问号说明。默认陪伴节点保持 100、365、500、1000。增加可恢复黑名单，使该身份退出粉丝档案的展示、写入、提醒、日历和表格导出。

## Ownership / Compatibility

`src/fans/reminders.js` 拥有日期，`profile-service.js` 生成私有日历投影；`public/js/admin/fans/` 消费 IPC，工作台只组合内存数据。复用 `fan_suppressions` 的 scope + typed identity 标记，不新增表或改备份版本；旧删除排除标记也作为黑名单。资料保留在完整备份内，以便解除屏蔽后恢复。UID 与 open_id 不互换，不修改原始礼物/点歌业务、公开弹幕接口或服务器。

已有归档不等于黑名单：归档可查看，抑制当前只挡自动创建。扩展 owner 的同一抑制规则，防止通过手动创建/绑定、事实同步、名单同步、点歌归档、恢复或合并重新暴露。解除屏蔽只在名单管理中执行；恢复备份/恢复点保留当前黑名单。

## Steps / Verification

- [x] 日期：日历显示目标日到前三天的窗口，修订日期自动移动，删除日期/处理/稍后不留下旧项；陪伴档案提醒也改为提前三天。覆盖北京时间边界、500 天、跨月、重复读取及手动日期。
- [x] 黑名单：增加私有 `suppress` action，复用 suppression-list/unsuppress；检查 revision 和可靠身份。所有粉丝读写/导出入口复用 store/domain 过滤，保留完整备份与解除屏蔽能力。覆盖既有记录、自动事实/点歌/名单、重启、旧备份恢复及 scope 隔离。
- [x] UI：详情更多菜单加入黑名单，设置页管理/解除；复用 lira-help 说明三天窗口、日期跟随和 B 站估算。复用现有前端套件和隔离 Electron fixture 验证真实问号/黑名单/日历。
- [x] 同步规格、preload/storage 参考、使用指南；运行受影响 fan-profiles/planner/IPC 测试、架构和文档门禁；最终 diff/status 检查。

## Commands / Done When

测试使用 `D:/Work/lira-server/tmp/runtime/node-v24.15.0/node.exe --experimental-vm-modules --test`，TEMP/TMP 指向 Live/tmp。复用既有隔离 fixture，不使用真实用户数据，不重启用户应用。文档门禁为 `node --test test/engineering/governance-docs.test.js`，架构采用相关现有套件。

不修改已有不相关改动、不提交、不部署。出错仅撤销本任务差异；未完成异步结果不得重新显示已屏蔽用户。达到上述行为及直接证据后归档计划。

## Results

- 领域聚焦检查 18/18，前端 32/32；fan-profiles 全目录、三个 planner 套件、架构与文档门禁合计 204/204。使用上次保留的锁定 Server worktree 校验协议，不修改契约版本。
- 隔离 Electron 复用现有 canvas fixture 的真实 preload、桌面鉴权和私有 fan IPC；使用合成用户与独立 tmp 数据。验证问号可键盘展开、默认 100/365/500/1000、10 月 9 日显示 12 日满 500 天而四天后的节点不显示、屏蔽后档案与日历立即清除、解除后恢复；pageerror 为空，手动日历 localStorage 仍为空。
- off-happy-path 证据覆盖失败的黑名单写入不隐藏原档案、隐藏页面的待处理日历读取不能回填已屏蔽内容、旧备份及恢复点不解除屏蔽。
- 规格、私有 IPC/storage 参考和应用内指南已同步；服务器协议、schema、交互引导入口未变化，不改相关文档。
- Electron 已关闭；截图在 tmp/fan-calendar-blacklist-evidence。自动审批拒绝删除本次 tmp/fan-calendar-blacklist-ui 隔离缓存的命令（blocked by policy，未提供具体原因），保留该测试目录；未改真实用户数据。
