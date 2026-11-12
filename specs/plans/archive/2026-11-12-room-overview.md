# 紧凑直播间资料实施计划

**Status:** Completed

**目标：** 在账号登录页原有两栏下方增加与表单相同边框、紧凑留白的房间资料栏，将输入区的房主头像和昵称移入其中，显示直播标题、房间号、开播状态、头像、昵称、主播等级、粉丝数、UID、粉丝牌、分区和公告。其他登录、保存及大航海操作保持原样。

## 现状与职责

- `public/pages/admin/song/settings.html`、`public/css/admin/workspace/base.css` 和 `public/js/admin/settings-room-profile.js` 拥有布局及房间资料渲染；目前仅有房主昵称和头像。
- `src/server/bilibili-runtime.js` 拥有已保存房间的资料读取；`src/bilibili/danmaku/api-client.js` 已使用 Master/info 读取房主昵称，可扩展同一实现提供主播资料，Room/get_info 提供标题、状态、分区。已对用户参考房间的公开上游返回核对字段。
- `src/server/routes/bilibili-routes.js` 管理请求可获得附加详情；场景及 overlay 继续只用原有四个身份字段，不触发新增详情查询。
- 契约 owner 为 `docs/reference/backend/api.md`；页面职责说明在 `docs/reference/frontend/app.md`；使用说明在 `public/pages/admin/toolbox/usage-guide-getting-started.html`。

## 约束与失败处理

不改配置键、认证、IPC、监听、用户数据和账号登录资料；只移动房主资料。复用既有头像代理与前端版本控制，不增加轮询或持久化。附加资料获取失败时保留可用身份，未知字段显示中性占位；编辑房间清空旧资料，过期响应不得覆盖新房间。仅撤回本任务 diff，不回退现有用户改动。

## 实施与验证

- [x] 扩展现有上游资料读取和管理接口，维持 overlay/场景四字段契约；在 `test/bilibili/bilibili-room-profile.test.js` 补充真实映射、部分失败、请求数量和投影覆盖。
- [x] 新资料栏使用现有 theme-section 外观，标题放栏头、正文紧凑排布；输入区保留状态和输入。扩展 `test/settings/settings-room-profile.test.js` 的既有案例验证资料、手动刷新和编辑/旧响应清理。
- [x] 房间资料、账号、场景、overlay 和监听相关 Node 测试共 72 项通过；原有大航海隔离 Electron 测试 1 项通过。
- [x] 使用既有隔离 Electron 夹具：1440 和最小 1024 窗口中，上方表单高 76.44px、新资料栏高 75.59px，内边距同为 8px 10px，无横向溢出。资料刷新只新增一次读取，长公告不撑高，失败和编辑输入隐藏旧资料，重新读取恢复；房主头像只在下方。公开 B 站房间通过实际新接口读取全部字段。
- [x] 接口、前端说明与使用指南及截图已同步，相关 JS 语法通过。交互引导仍指向原有登录与输入入口，无需改动。文档门禁已运行，9/10 通过；另一项并行任务的 `2026-11-12-viewer-name-management.md` 状态格式被门禁拒绝，未修改其文件。

## 完成条件

新增资料均来自已保存房间；资料栏没有宽大的上下留白，与原表单保持相同形式和接近高度；房主头像/昵称只出现在新区域，登录账号仍独立；旧功能和 overlay 契约保持，测试、文档与实际桌面渲染证据一致。

未提交、打包或发布。截图使用合成账号与示例资料，不代表用户登录状态。
