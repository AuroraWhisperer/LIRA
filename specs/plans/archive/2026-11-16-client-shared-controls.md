# 客户端通用控件与主题迁移

Status: Completed（2026-11-16）

## 目标与范围

核对注释 1 所列重复实现及客户端遗漏，将数字框、开关、浮层主题、保存提示、参数滑杆与可复用的内容状态接入既有组件体系。保持现有页面操作、保存时机、空值含义及用户自选直播画面配色。

本次不改变 HTTP/WS/IPC、存储格式、设置键、桌面权限、资源下载或连接生命周期；不提交、打包或发布。工作区已有多项未提交修改，只叠加本任务所需变更。

## 当前实现与所有权

- `public/css/components/number-field.css`、`switch-control.css` 已存在；数字框目前主要用于点歌规则。页面继续拥有原生输入属性、校验和事件。
- `public/js/shared/parameter-range.js` 与对应 CSS 已拥有滑杆呈现；电音助手控件由 `public/js/admin/audio-assistant-controls.js` 生成。
- 保存流程归各页面，先核查 `public/js/admin/component-save-feedback.js`，仅统一呈现，避免引入新的保存协调器。
- 播放队列、抽屉及礼物选择浮层的行为归原有控制器。复用 `styles-base.css` 及客户端主题变量，保留不同遮罩强度、定位和开关行为。
- 内容状态只共享相同层级与主题语义，页面保留文案、操作和数据判断。
- 组件参考归 `docs/reference/frontend/app.md`，播放相关说明归 `playback.md`。指南检查 `public/pages/admin/toolbox/usage-guide*.html`、交互引导和 `docs/guides/`；操作没有变化时不重写说明或截图。

## 实施与验证

- [x] 数字框与开关：44 个静态带单位数字框与导入礼物动态金额模板接入既有组件，电音助手另接入变速百分比数字框；开播动画总开关复用 `switch-control`。保留 id、原生属性及空值处理。
- [x] 保存状态：新增轻量呈现模块及 CSS；桌面歌词、弹幕、点歌板、开播、主播工作台、周表、盲盒及既有自动保存反馈接入。页面请求、重试、可见性及并发策略不变。
- [x] 参数滑杆与内容状态：电音助手完整页 4 个、快捷面板 3 个滑杆接入既有初始化、回填刷新及销毁；播放队列、粉丝档案、主播工作台共享内容状态基础样式。
- [x] 浮层主题与全局核查：队列、播放抽屉、礼物选择窗与抽屉、新手引导接入既有主题变量；保留遮罩强弱、事件与开关行为。桌面外壳和加班礼物选择窗已接入主题，无需重复实现；Windows 原生关闭按钮语义色不改。
- [x] 整合：组件参考同步至 `docs/reference/frontend/pages.md`、`app.md` 与 `playback.md`。指南操作、单位、范围及保存时机不变，既有指南与截图无需因组件实现替换而重写。
- [x] 完成检查：任务差异、语法、模块边界、相关回归和隔离桌面核查已完成；新组件不新增请求或保存所有者。工作区其他未提交修改保留。

## 验证记录

现有测试覆盖业务语义；仅补齐保存提示需要的两处 DOM fixture 接口，没有新增静态外观断言或测试基础设施。

- 数字框／开关相关：`node --experimental-vm-modules --test test/admin/admin-page-composition.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/overlays/frontend-opening-runtime.test.js test/overtime/frontend-overtime.test.js test/gifts/gift-frame-controller.test.js test/playback/player-appearance-browser.test.js`。初次 42 项中歌词 fixture 的 DOM 接口缺失，补齐后该文件在下面保存组通过；播放器最终复验 2/2 通过。
- 保存组：`node --experimental-vm-modules --test test/admin/settings-autosave.test.js test/admin/streamer-planner-view.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/overlays/frontend-opening-runtime.test.js test/gifts/frontend-blindbox-admin.test.js test/gifts/frontend-blindbox-overlay.test.js test/admin/component-settings-save.test.js test/admin/component-save-batch.test.js test/danmaku/frontend-admin-danmaku.test.js test/admin/frontend-admin-runtime.test.js`，76/76 通过。
- 保存消费者扩展：`node --experimental-vm-modules --test test/danmaku/danmaku-panel-edit-state.test.js test/danmaku/server-danmaku-settings.test.js test/admin/component-preview-providers.test.js test/admin/component-preview-registry.test.js test/songs/frontend-queue.test.js`。registry 的 DOM fixture 补齐后单独复验 7/7；与保存组去重合计 115 项通过。server-danmaku 的 7 项字体 stub 链接失败保留，见限制。
- 滑杆／内容状态：`node --experimental-vm-modules --test test/admin/audio-assistant-controls.test.js test/ui/frontend-parameter-range.test.js test/fan-profiles/frontend-fan-profiles.test.js test/fan-profiles/frontend-fan-profiles-view.test.js test/admin/streamer-planner-view.test.js`，64/64 通过；变速数字框接入后前两份复验 12/12。
- `npm run check`：1,908 个 JavaScript 文件通过；`npm run verify:architecture`：30/30 通过。`npm run verify:docs` 归档后为 9/10：本任务原计划状态格式已修正，剩余失败为另一任务的 `specs/plans/2026-11-16-third-party-reasoning-controls.md` 缺少当前 Status；本次文档链接与导航检查通过，未改动另一任务的计划。`git diff --check` 通过。
- 一次 Impeccable 机械检查完成；两条提示为原有日历事件颜色边线及运行时赋图、无图时隐藏的礼物缩略图，均与本次组件替换无关，未改动。
- 复用使用指南截图 fixture，使用独立数据目录、Electron profile 和随机端口，实际桌面 preload／授权会话下 `/license`、`/admin` 均返回 200。九种主题下数字后缀、保存提示、音频滑杆及浮层颜色核对通过；电音完整页与快捷面板数值、进度同步，单次操作只生成一次参数写入；开播开关单次操作只发一次保存请求。歌词负小数、播放器 `112.5%`、礼物长单位、通知金额禁用态和队列打开关闭已检查，无页面脚本错误。音频 IPC 状态为该隔离进程内的合成数据，没有启动真实音频设备。

## 限制与测试环境收尾

- `server-danmaku-settings.test.js` 的 7 项用例在模块链接时失败：本任务开始前已有修改为 `danmaku-parameter-controls.js` 引入 `fontValueForStack`，其字体测试 stub 仍只导出另外两个函数。判断依据为初始工作区状态与源码／fixture 对照，没有回退其他修改重跑基线；本任务未改动该字体行为或削弱测试。
- 本轮验证是源码与隔离桌面检查，未验证真实音频硬件、系统通知投递、真实账号或安装版；未运行全套测试，未提交、打包或发布。
- 隔离 Electron 进程 59604 已正常退出，退出码 0。截图、主题计算值及机械检查记录在仓库 `tmp/client-shared-controls-9dpgSx/`。删除该目录内合成数据库及三个临时 profile 的受限清理命令被自动审批以 `blocked by policy` 拒绝，未换用其他方式绕过；临时测试数据仍保留。

## 失败处理与完成条件

失败先在所属组件和聚焦测试中定位，不反复运行无关全套；如需回退，只手动撤销本任务补丁并保留原有工作。六类建议的适用边界明确、实际迁移完成、相关验证通过且文档准确后关闭计划。未运行的真实设备/外部业务验收不写成通过。
