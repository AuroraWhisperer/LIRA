# 定时弹幕文案补充与容量扩展

Status: Completed

## Goal

按用户指定的梦游机器人房间配置页补充全部定时文案，保留原有 15 条，去掉一条重复内容后提供 199 条内置文案。用户已确认容量从 100 扩到 300，并接受客户端与服务端配套升级。

## Current Behavior / Ownership

- 服务端 `D:/Work/lira-server/src/lib/fixed-reply-settings.js` 提供默认值与写入校验；`src/storage/cloud-settings-store.js` 在未保存配置时回退默认值，已有配置及显式空词库原样保留。
- 客户端 `src/shared/fixed-reply-contract.js` 校验 IPC 输入及云端读取结果，`public/js/admin/danmaku-scheduled-library.js` 控制添加上限。定时发送仍归现有服务端运行时。
- 服务端 `docs/protocol/fixed-replies.md`、两份 OpenAPI、REQ-BOT-002 / AC-BOT-002 维护契约；客户端 `docs/reference/{frontend/app,desktop/main}.md` 与弹幕页及其使用指南维护说明。

## Boundaries / Compatibility

- 只补充内置内容及必要容量，不增加批量导入、模板变量或发送策略。
- `{upname}` 改为“主播”，换行合为单行；固定价格和充值入口改成通用表述。每条仍限 120 Unicode 字符。
- 不迁移或覆盖已保存词库，不改变开关、时间间隔、调度、认证、数据库结构或字段。
- 新服务器返回的 199 条默认词库不能被旧版 100 条校验器接受；交付明确要求两端配套升级。用户已接受此兼容约束，本任务不部署、不打包、不提交。
- 保留两个工作目录内所有无关改动。编辑前文件快照放在 `tmp/youmoe-scheduled-2026-11-12/before/`，仅用于本次差异核对。

## Milestones / Verification

- [x] 更新现有服务端默认词库与边界用例、客户端 IPC 用例及分页编辑用例；旧实现下两端 300 条校验用例分别以 `INVALID_SYNC_SETTING` / `INVALID_FIXED_REPLY_SETTINGS` 失败。
- [x] 补充服务端文案与 300 条限制，同步客户端限制和两份 OpenAPI 默认数组。199 条唯一、最长 33 字、无控制字符或未解析占位符，原 15 条逐项保持；跨双端纯函数往返一致。
- [x] 同步协议、需求、验收、桌面参考、页面帮助和使用指南。引导与示例截图的入口及布局没有变化，保持现状。
- [x] 服务端 `node scripts/run-with-node.cjs --test test/fixed-reply.test.js test/cloud-sync-http.test.js`：36/36；`npm run docs:check`：59/59。覆盖默认值与保存校验、旧配置及空库保留、两份协议和原定时行为。
- [x] 客户端 `node --test test/bots/fixed-reply-settings-ipc.test.js test/bots/fixed-reply-frontend.test.js`：14/14；含 300 条跨页搜索、编辑、删除、添加与保存，301 条拒绝。复用既有 DOM 编辑行为和 IPC 自动化，未声称真实 B 站发送或 Electron 实机验收。
- [x] 两端 `git diff --check` 通过。客户端 `npm run verify:docs` 为 9/10，唯一失败为并行工作的 `2026-11-12-interaction-thanks.md` 状态标签不符合门禁；不属于本任务，保留原文件。

## Rollback / Done When

失败时只撤回快照对比确认属于本任务的行，不还原用户原有改动。完成条件为 199 条文案可通过 300 条保存契约、301 条被拒绝，现有自定义及空词库覆盖仍通过，受影响说明一致。线上生效由后续两端配套发布负责。
