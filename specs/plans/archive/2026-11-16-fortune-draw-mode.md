# 抽签方式 Implementation Plan

**Status:** Completed

## Goal

抽签设置提供「每日固定」（默认）和「每次随机」。用户已澄清随机模式允许重复、没有每日次数限制，并非无重复抽取。桌面提供配置，LIRA Server 独占执行。

## Current Behavior / Ownership

- Server `src/storage/daily-bot-store.js` 在租户设置保存开关/词库，按 UID 和北京时间日期保存固定签文；`daily-bot-settings-service.js` 投影设置并取消旧 revision 的回复。
- Live `src/electron/daily-bot-controller.js`、`src/shared/daily-bot-contract.js` 持有受限 IPC 校验；`danmaku-daily-bots.js` 与 `danmaku-daily-library.js` 管理云端设置及词库面板。
- 规范：Live `specs/cloud-daily-bots.md`、`docs/reference/backend/bilibili/danmaku.md`、`docs/reference/desktop/preload.md`；Server `docs/protocol/daily-bots.md`、Device OpenAPI/fixture、REQ-BOT-001/AC-BOT-001。
- 两仓库已有未提交修改，包括 Server daily bot runtime/test 的冷却调整；保留原有改动。

## Compatibility Constraints / Non-goals

新增 fortune 专用 `drawMode: daily | random`，缺省读取为 daily；旧客户端省略参数时保留服务器现值。新客户端遇到未返回模式的旧服务器时禁用此选项并提示更新。复用 enabled/expectedRevision 写入和授权上下文，不增加路由、定时任务或本地执行。每日固定记录保持原位；随机结果只用于当前回复，不写入每日表。签到不受影响。保留有效待发回复合并、共享队列、平台限速、跨日和来源失效规则。本任务不提交或部署。

## Proposed Changes / Milestones

- [x] Server：在现有设置和结果 owner 扩展模式；随机抽取当前词库，修改模式推进 revision/取消旧待发回复。验证默认、重复抽取、切回固定、设置冲突与租户隔离。
- [x] Live：IPC 校验并透传模式，读取保留服务端能力缺省；抽签「设置」面板新增自动保存下拉框。验证保存读回、失败恢复、旧服务器和账号隔离，沿用现有桌面夹具。
- [x] 同步协议/OpenAPI/fixture、需求验收、Live 规格及使用说明。无架构或数据库 schema 变更，不新增 ADR 或迁移。

## Verification

- Server：`node scripts/run-with-node.cjs --test test/daily-bot-store.test.js test/daily-bot-settings.test.js test/daily-bot-runtime.test.js test/daily-bot-http.test.js test/daily-bot-bindings.test.js test/daily-bot-import-maintenance.test.js test/backup-wal.test.js`；`npm run docs:check`。
- Live：`node --test test/bots/daily-bot-takeover.test.js test/bots/daily-bot-controller.test.js test/desktop/daily-bot-editor-electron.test.js`（跨库 fixture 按现有契约工具配置）；相关前端检查按既有 runner；`npm run verify:docs`。
- 最后检查两仓库 touched diff、`git diff --check`、`git status --short`，确认没有运行数据进入修改。

## Rollback / Failure Handling

服务端缺字段时不提供模式写入，既有开关和词库仍可使用；失败保留最后确认值，冲突重新读取。只反向修改本任务拥有的行，不重置工作区。上线顺序为 Server 后客户端；线上验收与本次源码/隔离测试区分。

## Done When

两端实现上述模式，相关检查通过，文档描述一致，最终 diff 审阅完成。记录实际检查结果及未执行的线上验证。

## Verification Results

- Server 上述 7 个文件 52/52 通过，`npm run docs:check` 60/60 通过。
- Live takeover、frontend、桌面编辑与关联面板检查 28/28 通过；固定历史协议 fixture 的 controller 检查单独 1/1 通过。首次桌面失败来自测试在抽屉打开时点击背景刷新，已按真实操作先关闭抽屉后恢复；功能实现未因此修改。
- 历史协议检查使用锁定提交 `67119e81a3f5f49470ed2b191f6552556d0a704e` 的隔离稀疏检出，覆盖旧服务器兼容，不修改发布契约锁；新协议由 Server HTTP schema 测试和 Live 模式 IPC 测试验证。
- 隔离 Electron 使用生产 admin 片段、preload、请求认证、受限 IPC 与真实选择控件，匿名 `/admin` 返回 401。每日固定→每次随机→每日固定、筛选词库、模式与保存入口可见性已检查；截图留在根目录 `tmp/`。未使用真实账号或发送弹幕。
- 使用说明保留现有签到词库示意图，图片仍准确；交互引导没有抽签方式的旧说明，无需改动。
- 未提交、打包或部署；配套上线应先更新 Server 再更新客户端，无手工数据库迁移。已有未提交的冷却调整、礼物与样式修改保持原状。
