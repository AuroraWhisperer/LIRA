# 弹幕姬显示屏蔽 Implementation Plan

**Goal:** 将直播画面链接移到样式选择上方，在原位置提供 UID 黑名单、直播间观众选择、包含词屏蔽及一键清空。

**Architecture:** 延续服务器拥有 OBS 弹幕的架构；屏蔽设置独立于样式，保存在认证租户的 `streamer_settings`。RoomMonitor 仅在发布普通弹幕到 overlay 前过滤，其他消费不受影响。桌面通过固定 Device API 和受限 IPC 读写。

**Tech Stack:** 现有 Electron、CommonJS、Vanilla ESM/CSS、SQLite；不增加依赖。

## Current behavior and ownership

- 客户端 `public/pages/admin/toolbox/danmaku.html`、`public/js/admin/danmaku-overlay-settings.js` 管理样式草稿；正式地址来自服务器。
- 服务器 `src/modules/bilibili/room-monitor.js` 已拥有发送者 UID 和完整正文，公开 SSE DTO 不包含 UID。
- 服务器已有 `bilibili/api.js#getContributionRank`，最多三页、每页 50 人；它不是完整在线名单。
- 当前两个工作区都有用户修改，先保存任务前相关文件副本，仅修改本任务增量。

## Contracts and compatibility

- 新增 DeviceBearer `GET/PUT /api/device/overlay-filters`；PUT 为非空字段 patch，`blockedUsers`（最多 500 个 `{uid, name}`）、`blockedKeywords`（最多 200 个非空、最长 100 字符字符串）。UID 为 1–20 位非零开头十进制字符串，name 最长 80 字符；服务端去重。缺省配置为空。
- 新增 DeviceBearer `GET /api/device/overlay-viewers`，从认证绑定房间读取在线榜，仅返回 `{roomId, viewers:[{uid,name}]}`，最多 150 人；不允许客户端选择房间/租户。
- 私有列表不进入公开 SSE、日志、Device 同步 revision。现有样式配置、样式草稿、网页管理和 OBS 地址保持兼容。
- 黑名单精确匹配 UID；屏蔽词对完整弹幕正文按包含匹配，英文不区分大小写，不解释正则。规则影响保存后新收到的弹幕；已显示消息按原生命周期退出。
- 只过滤普通弹幕显示，不改变礼物、系统通知、点歌、机器人或 B 站禁言。

## Milestones

- [x] Server：实现校验、租户内设置、过滤与观众只读服务、Device 路由；补充隔离、持久化、原子校验、完整正文、错误和认证测试。
- [x] Desktop：新增受限 IPC/remote operations，复用账号代次防护；增加表单、列表、搜索/勾选、即时确认保存状态，网络失败保留输入，账号切换清空旧状态。
- [x] Contracts：同步服务器 requirement、acceptance、Device OpenAPI/fixture、overlay protocol 与客户端 preload 文档。
- [x] Verify：运行下列针对性检查并审查任务增量。

## Verification

- Server：`node --require ./test/support/test-mode.cjs --test test/overlay-filters.test.js test/overlay-viewers.test.js test/overlay-settings-routes.test.js test/room-monitor-overlay.test.js test/overlay-protocol-contract.test.js`。
- Desktop：`node --experimental-vm-modules --test test/danmaku-overlay-filters-ipc.test.js test/frontend-danmaku-overlay-filters.test.js test/danmaku-overlay-ipc.test.js test/frontend-admin-danmaku.test.js`。
- 因新增 IPC/API/持久设置，运行双方文档/架构治理检查及受影响语法检查；用合成数据查看桌面设置区。
- 两个工作区均执行 `git diff --check`、`git status --short`，核对任务前副本，确保无运行数据或敏感信息进入修改。

## Failure handling and done when

服务器未提供新接口时明确提示需要更新，不假报已保存；请求失败保留可重试的输入。数据库写失败不更新缓存。账号切换后旧读写结果无效。只回退任务增量，不覆盖已有工作。

完成条件：链接已上移，所有屏蔽操作经服务器确认且重启保留，普通弹幕过滤与其他消费隔离，观众列表来源说明准确，相关测试通过或明确记录既有失败，契约一致且最终差异已审查。

## Results — completed 2026-09-19

- Server 5 项新增过滤/观众服务测试、18 项原 overlay monitor 测试通过；34 项接口、公开 SSE、协议和 monitor 生命周期测试通过；`npm run docs:check` 34 项通过。
- Desktop 最终组合 29 项测试通过（新过滤 IPC/UI、原样式 IPC、Admin fragment/CSS 归属）；906 个 JavaScript 文件语法检查通过，新增 Electron 验证脚本单独语法检查通过。
- `scripts/verify-overlay-filters.cjs` 使用真实 Electron、正式 preload/IPC、页面片段和 CSS、独立临时目录与合成数据验证链接位置、添加 UID/词、观众搜索勾选、清空、保存失败输入保留。首轮发现复选框继承通用宽度，修正后复验通过；未请求真实 B 站数据。
- 过滤样式独立放入 `danmaku-overlay-filters.css`；固定远端调用加入既有 `remote-danmaku-settings.js`，避免扩大已达审查行数上限的 remote client。
- 客户端架构/模块检查只有两项既有超限：`public/css/admin/other-features/usage-guide.css` 798/760，`public/pages/admin/song/queue-theme.html` 642/610。本任务未修改这些文件。
- 设计检测只报告已有回复控件的左边线，未改变该无关区域。两次界面检查完成；最终差异和两个工作区状态已审查，无运行数据或凭据进入本任务新增文件。
- 已完成本地客户端及服务器实现，未提交或部署；使用新功能需要发布服务器变更并重启更新后的客户端。现有旧服务器会明确提示更新。
