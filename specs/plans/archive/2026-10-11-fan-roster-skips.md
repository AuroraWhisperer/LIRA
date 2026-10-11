# 档案同步跳过明细

Status: Completed

## 目标与现状

同步提示目前只有跳过数量，用户无法核对成员和原因。补充当前大航海名单的跳过明细；不改变同步规则、名单外资料补查、存储或认证。

## Owner 与兼容

- `src/shared/bilibili-guard-roster.js` 保留隐藏身份/无有效 UID 的名单位置和原因，不泄露隐藏身份的上游 UID 或昵称。
- `src/fans/guard-roster-import.js` 合并名单明细与已归档/黑名单成员的昵称、UID 和原因。
- IPC 结果只新增 `skippedDetails`，原计数及旧快照兼容；controller 原样传递，权限与生命周期不变。
- `public/js/admin/fans/view.js` 统一格式化；手动结果与自动通知消费同一明细。
- 契约 owner：`docs/reference/desktop/preload.md`；用户说明：`public/pages/admin/toolbox/usage-guide-toolbox-work.html`。不涉及新的导航或交互式引导步骤。

## 实施与验证

- [x] 扩展现有名单解析、导入测试，覆盖原因、身份保护、去重和旧快照兼容。
- [x] 增加结果明细并接入现有纯文本提示，验证前端格式化与自动通知。
- [x] 同步契约和使用说明；相关检查及限制见下文。

2026-10-11 验证：`node --experimental-vm-modules --test test/bilibili/bilibili-guard-roster.test.js test/fan-profiles/fan-profiles-guard-roster.test.js test/fan-profiles/fan-profiles-roster.test.js test/fan-profiles/fan-profiles-ipc.test.js test/fan-profiles/frontend-fan-profiles-view.test.js test/fan-profiles/frontend-fan-profiles.test.js`，83/83 通过。临时目录指向仓库 `tmp/`，使用既有隔离夹具，不读取真实用户数据。原同步行为和计数不变，所有新增名单跳过分支可解释，隐藏身份不暴露。前端机械检查无发现。

文档门禁初次因本计划状态标签未用 `Status:` 失败，归档时修正。不涉及布局调整，未启动真实 Electron 或读取用户本次名单；此次旧通知无法反推出具体成员，更新后重新同步才能获得明细。保留此记录用于隐藏身份数据最小化和旧结果兼容的决策追溯。

## 失败处理

按任务文件 diff 撤回本任务改动，保留既有用户改动；不删除档案、不重启用户应用、不进行提交。
