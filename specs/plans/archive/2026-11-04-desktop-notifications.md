# 桌面通知设置实施计划

Status: Completed — 2026-11-04。实现、聚焦测试与隔离 Electron 设置验证完成；未提交、打包或发布。

## 目标与范围

在「百宝箱 → 设置」新增「通知提醒」页签。工作台日程通知默认开启；大额礼物通知默认关闭，单次已结算总额严格大于门槛时提醒，默认门槛 1000 元。两项独立控制，修改自动保存到本机。Windows 10/11 使用既有 Electron 原生通知能力，系统通知权限与勿扰模式仍由 Windows 决定。

不改变应用内礼物提示、直播画面、云设置、账本结算或现有工作台存储格式。不提交、发布或操作用户正在运行的客户端。

## 当前实现与归属

- `src/electron/planner-reminder-controller.js` 拥有日程定时、睡眠恢复、通知与清理；已有 `test/desktop/planner-reminders.test.js`。
- `src/bilibili/gift/projection-service.js` 仅在 final 新提交后调用 `onGiftFlushed`，历史记录导入和消费者重试不重复调用；`src/server.js` 组合该回调。
- `src/electron/desktop-notifications.js` 新增本机通知偏好及礼物通知 owner；日程 controller 在触发时读取开关，关闭期间到期的不补发。
- `src/electron/ipc/desktop-notifications-ipc.js` 新增仅主窗口 `/admin`、主 frame、精确 origin 可用的 get-state/update 接口；不允许 renderer 直接请求通知或传入文件路径。
- `public/js/admin/desktop-notification-settings.js` 接入设置控件，`client-settings.js` 继续拥有页签导航。
- 契约 owner：`docs/reference/desktop/main.md`、`preload.md`；界面 owner：`docs/reference/frontend/app.md`、`pages.md`；使用指导：`usage-guide-toolbox-software.html` 与 `usage-guide-toolbox-work.html`。

## 兼容与失败处理

偏好写入独立 `desktop-notifications.json`，沿用本机外观设置的临时文件原子替换模式。写失败保留旧设置并显示失败，非法字段/类型/金额拒绝整次修改。原有 planner IPC 和事件格式不变。通知关闭、释放资源及退出均清理 owner 创建的资源。只改本任务涉及的行，保留当前工作区已有修改。

## 里程碑与验证

- [x] 通知 owner、持久化与受限 IPC：验证默认关闭的大额礼物不通知、门槛严格比较、最终总额不重复乘数量、设置持久化与失败回滚、原生通知清理、IPC 来源与载荷拒绝。
- [x] 日程开关：扩展现有测试，验证关闭时不通知、打开后未来日程正常提醒、关闭期间到期的不补发。
- [x] 设置 UI：新增第四页签和两项开关、金额输入；隔离 Electron 宿主加载真实 preload/IPC/片段，验证保存重载与禁用状态，检查一次实际布局。
- [x] 文档同步：接口、持久化归属、页面模块及两处操作说明均同步；交互式引导未描述相关设置，无需修改。
- [x] 最终差异与状态审查：`git diff --check` 通过；已检查任务差异及 `git status --short`，保留工作区既有与并行修改。测试脚本、截图及合成偏好仅在被忽略的 `tmp/notifications-qa/`，没有运行数据或敏感内容进入任务差异。

## 验证结果与限制

- `node --test test/desktop/desktop-notifications.test.js test/desktop/planner-reminders.test.js test/admin/streamer-planner-reminders.test.js test/gifts/gift-projection-service.test.js`：25 项通过；增加启动前旧礼物过滤后，通知与日程两套 13 项重新通过。
- `node --experimental-vm-modules --test test/admin/frontend-admin-toolbox.test.js test/admin/frontend-admin-startup.test.js test/server/domain-services-initialization.test.js test/gifts/processed-gift-import-atomicity.test.js test/server/runtime-event-publication.test.js`：27 项通过。
- 最终日程页面、通知 owner、IPC 来源、提醒同步与 ESM 检查：45 项通过；11 个受影响 JS 文件语法通过；Impeccable 定向检测无发现。
- 隔离 Electron：匿名 `/admin` 返回 401，真实桌面授权后加载正常；默认值、两开关、金额修改、重载、保存失败回退、非法金额拒绝及更正后重试均通过，测试进程已关闭。没有使用真实用户数据或实际发送系统通知。
- `npm run verify:docs`：9 项通过，活动计划检查被并行新增的 `2026-11-04-comic-danmaku.md` 缺少 Status 阻塞；未修改该计划。
- 计划归档后重新检查两类 Markdown 相对链接，2 项均通过；活动计划检查仍是同一并行计划问题。
- 模块边界与大小检查：22 项通过，唯一失败是任务开始前已有的 `public/js/admin/client-settings.js` 注释型空 catch；本次仅新增通知设置初始化，未改该 catch。
- Win10/Win11 原生通知兼容性核对 Electron 与微软官方说明，未宣称双系统实际弹窗验收。
- 临时目录清理被自动安全审查拒绝，工具仅返回 `blocked by policy`；没有尝试其他删除方式。隔离 Electron 进程已关闭，测试宿主、截图与合成数据暂留被 Git 忽略的 `tmp/notifications-qa/`。

## 回滚

按文件检查本任务差异，仅撤销任务新增模块和对应接线，不重置或覆盖已有用户修改。通知失败只记录固定错误代码，不记录观众或日程内容，不影响礼物入账。

## 完成条件

控件可保存重载，两类通知遵循独立开关和严格门槛，聚焦测试通过，技术参考和操作说明与实现一致。实际 Windows 弹出效果需要两套系统各自验证；隔离宿主与 mock 证据不声称为 Win10/Win11 双机实测。
