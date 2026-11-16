# 开播连接提示开关实施计划

Status: Completed — 2026-11-16

## 目标与当前行为

用户要求把服务器每场一次的“欢迎…回家”主播问候改成默认开启的独立开关，并说明其连接确认用途。现有 `liveGreeting` producer 由 monitor 创建，等待当前 socket 认证和有效房间资料，60 秒内最多接纳一次；普通进场欢迎没有控制它。

## 边界与兼容

- 在现有 Device welcome-settings/v2 和租户 welcomeOptions 中增加 `liveGreetingEnabled` 布尔字段，缺省为 true。保留 V1 的原投影及 partial-write 行为，无数据库结构迁移。
- 开关属于主播租户；不新增连接、轮询、发送器、检测消息或回执系统，不改认证、监控生命周期和原有发送约束。
- 关闭阻止新入队并取消尚未发送的本租户问候；每段发送前重新验证。已经发出的请求无法撤回；同场已经接纳的问候不因重开补发。
- 新客户端遇到旧服务器缺字段时，仅禁用此开关并提示更新服务器。保存必须收到该字段的有效确认，不能用本地默认值伪装云端状态。
- 放在「百宝箱 → 弹幕互动 → 欢迎答谢 → 欢迎与播报」，复用现有 switch-control 和 lira-help。单独即时保存，不提交欢迎参数、词库或名单草稿，也不取消其他欢迎任务。
- 两仓已有大量未提交工作，逐段保留，不提交、部署或打包。

## 所有者与同步范围

- Server：`src/lib/welcome-options.js` 定义字段，`src/storage/welcome-settings.js` 读取持久状态，`src/modules/danmaku/live-greeting-service.js` 控制发送，`welcome-service.js` 处理设置取消。
- Desktop：`src/shared/welcome-settings-contract.js` 保持 IPC 白名单和旧服务器兼容，`public/js/admin/danmaku-welcome{,-model}.js` 管理现有设置流程，`danmaku-welcome-switch.html` 放置独立控件。
- 技术契约：Server `docs/protocol/viewer-welcome.md`、Device OpenAPI/fixture、REQ-BILI-005、对应验收、ADR-0075 和连接操作说明；Desktop `docs/reference/desktop/preload.md` 的现有欢迎设置条目。
- 用户指导：`public/pages/admin/toolbox/usage-guide-danmaku-replies.html`；检查相关 guide、tour，仍准确的内容不改。
- 测试：扩展 Server 现有 live-greeting/welcome-settings/HTTP 测试及合成 monitor fixture；Desktop 现有 frontend-welcome/IPC/隔离 Electron 编辑器测试。

## 实施与验证

- [x] Server：先补关闭、取消、租户隔离与旧写入保留的行为用例；增加 `liveGreetingEnabled: true` 和布尔校验，复用 welcomeOptions 存储。通过 `LiveGreetingService` 注入的设置读取函数在入队及每段校验中判断；设置更新仅取消对应租户 liveGreeting，不因该字段单独变化清空普通欢迎。同步对应规范与 schema。
  - 验证：`node scripts/run-with-node.cjs --test test/live-greeting.test.js test/welcome-settings.test.js test/welcome-settings-http.test.js test/room-monitor-live-greeting.test.js test/room-monitor-room-change.test.js`。
- [x] Desktop：增加 optional IPC 字段与旧服务能力判断，在现有欢迎设置中独立保存开关，并加入默认开启小字和问号说明。失败保留已确认值，草稿保持。同步用户说明与 preload 契约。
  - 验证：`npm test -- --file=test/settings/frontend-welcome.test.js --file=test/settings/welcome-settings-ipc.test.js --file=test/desktop/welcome-editor-electron.test.js`。复用隔离 Electron fixture，不操作用户应用或真实账号。
- [x] 完成：运行两仓文档门禁（Live `npm run verify:docs`，Server `npm run docs:check`），对受影响 JS 做语法检查，检查两仓任务 diff、`git diff --check` 和 `git status --short`，记录实际证据与部署限制。

## 失败处理与完成条件

失败时只修改本任务已确定的问题并复跑对应检查；通过逐段补丁撤回任务自有修改，不重置用户工作。默认开启、关闭持久化、发送取消、租户隔离、客户端能力兼容及独立保存有对应证据，文档一致，最终差异已检查后完成。源码完成与实际部署分别报告。

## 验证记录

2026-11-16：Server 4 个发送/设置/monitor 文件 49/49，通过独立 HTTP 契约文件 1/1；Live 前端及 IPC 39/39、隔离 Electron 编辑器 4/4。Server 文档/协议/架构门禁 60/60，Live 文档门禁 10/10；16 个受影响 JS 文件语法检查通过，Impeccable detector 无发现。

隔离桌面目视验收：欢迎答谢默认状态下开关、小字和问号同屏可见；点击问号可读连接确认用途，正常切换及刷新已由 Electron 自动化覆盖。旧服务器能力缺失和未确认保存通过前端/IPC 检查，不触发真实 B 站发送。

技术契约、Server 需求/验收/ADR/运维说明以及应用内使用指南已同步；现有新手引导没有对此提示的操作描述，组件外观指南不控制这条主播问候，均无需修改。旧用户设置缺字段仍默认开启，V1 写入保留关闭偏好。此次未提交、打包、部署或向真实直播间发送弹幕；启用新开关需要匹配客户端与服务器源码版本。
