# 弹幕样式收藏实施计划

**Status:** Completed

## 目标与当前行为

客户端弹幕样式库与画布添加组件共用收藏标记。右上角空心星可收藏，收藏后实心；已选标签移到左上角。用户确认后收藏的在前。收藏立即进入列表前部，取消收藏本次位置不变，重新打开列表恢复为收藏队列加原始目录顺序。现有样式库只有标签筛选及按账号隔离的最近使用；外部浏览器画布通过桌面预览会话工作，浏览器 localStorage 不与桌面共享。

## 归属与边界

- `public/js/admin/danmaku-style-favorites.js`：本机账号收藏偏好、订阅及共用卡片收藏绑定；内置样式目录仍由现有 DOM 与 `danmaku-style-options.js` 拥有。
- `danmaku-style-library.js` 与 `component-preview-picker.js`：各自负责打开时重建显示顺序、筛选及选择，复用收藏绑定。
- `component-preview-canvas-controller.js` 通过已有 `startActualData` 传递收藏投影，新增 `favorite` 会话命令交给桌面收藏 owner；`component-preview-remote.js`、`component-preview-dialog.js`、`component-preview-sessions.js` 保持现有凭据、账号代际、attachment 与命令顺序检查。
- 技术合同：`docs/reference/frontend/overlays.md`（偏好键与排序）、`docs/reference/backend/api.md`（会话操作）；用户说明：弹幕姬使用指南。现有样式、外观配置、最近使用、导入样式与直播输出保持原合同，收藏不触发选择或保存外观。
- 不引入新服务、依赖、HTTP 路由、数据库迁移、额外轮询、拖拽排序或其他组件收藏。
- 保留任务开始前 `app.md`、`topbar-status.js`、入门指南及其测试的未提交修改；不提交、打包或发布。

## 实施与验证

- [x] 实现本机收藏及共用卡片操作。沿用 localStorage 账号隔离，写入失败保留原状态；DOM 顺序与显示顺序一致，星标为选择按钮的同级按钮。
- [x] 接通客户端与画布的同一份偏好和实时投影；会话验证只允许 canvas 的有效样式及布尔收藏值，复用操作编号去重。
- [x] 在现有样式库、会话和 Electron 套件补最小行为覆盖：新收藏置前、取消后延迟归位、重开与账号隔离、失败不误报成功、跨桌面与外部浏览器同步且不编辑外观。
- [x] 执行下列定向检查并记录结果；收藏原生接线独立于其他参数用例，避免参数面板改动阻塞收藏验收。
- [x] 隔离 Electron 及外部画布目视：左右角互不遮挡、未收藏/收藏/已选组合、筛选不留空格、星标不关闭列表。探索取消后重新收藏及筛选后开关列表。
- [x] 同步技术参考和用户指南；文档、相关 JS 语法、架构及 diff 检查完成，status 中的并行修改保留，无合成运行数据进入变更。

## 实际验证与限制

- 初始四文件定向组 77/77 通过；随后加入组件库与浏览器预览组，83/86 通过。三个失败属于同时进行的 `danmaku-parameter-controls.js` 参数分组改动：旧 `.danmaku-advanced` 已替换，Spooky 配色控件不可见、RIPPLOID 旧 details 为 null、旧 summary 不存在。本任务未修改这些参数实现或测试预期；并行工作随后开始更新相应测试，不能把这次批次视作稳定修订的完整通过。
- 收藏最终 owner 与协议检查：`node --experimental-vm-modules --test --test-name-pattern='style library combines|only an attached canvas' test/danmaku/danmaku-panel-edit-state.test.js test/transport/component-preview.test.js`，2/2 通过，覆盖重开、持久化、账号隔离、写入失败可见反馈及命令权限／重试。
- 原 Electron 两用例在参数分组变更前 2/2 通过；后续旧长流程在其飘窗参数部分出现 `speedPixelsPerSecond` 未定义，保留该参数工作所有者处理。将本任务的收藏接线移成同文件独立用例，未弱化旧断言。最终 `node --test --test-name-pattern='danmaku favorites synchronize' test/desktop/danmaku-canvas-electron.test.js`，1/1 通过。
- 隔离 Electron 主页面和外部 Chromium 画布实测双向更新、新收藏置前、取消后保留位置及重新收藏；筛选到飘窗只显示其 5 款卡片，无空格。整个收藏流程的外观保存次数为 0，两个页面没有 pageerror。
- 11 个任务 JS 语法检查通过；最终修改的三个 JS 及拆出的 Electron 用例再次检查通过。`npm run verify:architecture` 30/30，`npm run verify:docs` 10/10；最终归档后的文档导航另行复核。
- impeccable 检测只报告画布分类导航既有的左侧强调线，非本次改动，未扩大修改范围。桌面效果图已更新至指南的 public/docs 两份 WebP，尺寸保持 1100×790、两份 SHA-256 相同。
- 使用指南和技术参考已同步；新手引导没有样式收藏或参数步骤，无需修改。没有新增服务器 schema、HTTP 路由或运行依赖。
- 自有 Electron、浏览器和测试 profile 均已关闭／清理，临时数据仅在仓库 `tmp/`；保留既有及并行编辑，不提交、打包、发布或重启用户客户端。

## 失败处理与完成条件

收藏保存错误只报告失败，不改变偏好与卡片顺序；会话过期沿用现有断开反馈。需要回退时仅撤回本任务拥有的 diff，不执行破坏性 reset 或覆盖用户修改。上述行为、定向检查、桌面及画布接线、文档和最终 diff 审查完成后归档计划，记录实际结果与限制。
