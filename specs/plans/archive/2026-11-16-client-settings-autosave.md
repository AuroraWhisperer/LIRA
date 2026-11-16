# 日常设置自动保存实施计划

**Status:** Complete

**Goal:** 将无需创建、发布或切换运行状态的日常参数和文案编辑改为自动保存，去掉平时占位的保存栏；无效输入、网络失败和冲突保留草稿并提供重试。

**Architecture:** 继续由各设置模块负责校验、草稿与确认。复用现有保存请求，增加共用的防抖调度及组件控制器绑定，不改变 HTTP/IPC、设置键、持久化格式和账户边界。

## 范围与边界

- 自动保存：完整匹配/关键词规则；签到/抽签词库；欢迎参数、各词库、定制欢迎及名单；PK 欢迎参数；互动/礼物答谢词库；昵称黑名单。
- 自动保存：时钟、弹幕、歌曲信息、点歌板、礼物显示/感谢、互动样式、配套资源参数、加班机背景、冲刺目标，以及粉丝自动更新偏好。
- 已自动保存的 AI 主设置和展示板改为仅失败时出现重试按钮。
- 记录创建/逐条昵称修改、人格和歌词命名预设、素材导入、画布/文本框发布保留明确提交。直播间号、缓存目录、盲盒 JSON、运行中加班规则及转盘配置保留现状。
- 保留当前工作区其他未提交改动，不提交、分支、打包或部署。

## 现状、owner 与消费者

- 盘点依据：`output/manual-save-audit-2026-11-16.md`。
- `public/js/admin/component-config-controller.js` 已保护保存期间的新编辑、确认回写、冲突和 generation。通过独立的自动保存绑定复用它，禁止把所有控制器默认改成自动提交。
- `danmaku-{libraries,daily-library,welcome,pk-report,interaction-thanks,gift-thanks,viewer-names}.js` 各自保留领域草稿；固定回复读写通过 `danmaku-cloud-replies.js` 统一串行，账户变化取消旧队列。
- 技术参考 owner：`docs/reference/frontend/app.md`；入口表在 `pages.md`。操作说明 owner：`usage-guide-danmaku-replies.html`、`usage-guide-song.html`、`usage-guide-toolbox-overlays.html`、`usage-guide-toolbox-danmaku-gifts.html`、相关组件说明及 AI 指南。

## 实施与验证

- [x] 共用调度：`createAutosave({ save, canSave, root, windowRef })` 提供 `schedule/resume/flush/cancel/dispose`。600ms 合并输入、composition 期间暂停、单请求串行、保存中新编辑继续提交、取消后旧结果不启动新任务；失败不无限重试。用 Node 假时钟验证这些有数据丢失风险的行为。
- [x] 组件绑定：只在选定模块挂接 `bindComponentAutosave`，根据 DOM 有效性、控制器状态及 generation 调度；正常保存栏隐藏，错误/冲突提供重试。运行相关 controller、gift display/guard/frame、resource style、interaction appearance、overtime focused suites。
- [x] 弹幕编辑器：改输入/增删回调为调度已有保存方法，静默跳过不完整草稿；保留各库和账户隔离，回写不重建正在编辑的输入框。运行 fixed-reply、daily-bot、welcome、PK 与昵称相关 owner suites。
- [x] 偏好与冗余按钮：冲刺目标和粉丝自动更新偏好自动保存；AI/展示板仅错误时重试。验证普通内容编辑/发布行为保留。
- [x] 同步技术参考、操作说明及会误导保存步骤的截图，更新盘点清单。运行 `npm run verify:docs`，必要的架构门禁，以及覆盖受影响领域的定向测试。
- [x] 用现成隔离 Electron 夹具核对词库与代表性组件：无需保存按钮也能持久化；失败仍可重试；关闭侧栏后待保存内容继续提交；布局释放原保存栏空间。禁止使用真实用户数据或重启用户客户端。
- [x] 最后审阅任务 diff、`git diff --check`、`git status --short`；检查无临时/运行时数据进入变更。

## 失败处理与完成条件

无效草稿保持可编辑，网络错误保留输入并显示重试；远端冲突不自动覆盖。账号切换和页面销毁取消调度，各 owner 的 generation 继续阻止旧回写。只通过补丁撤回任务自有改动，不使用 destructive reset 或整体 checkout。完成时记录实际验证结果与限制，再将计划移出活动索引。

## 完成证据（2026-11-16）

- 原盘点 29 组设置中完成 23 组自动保存；AI 主设置与歌曲展示板仅失败时显示重试。逐条记录、预设、导入和画布发布等明确提交保持原用途。清单更新到 `output/manual-save-audit-2026-11-16.md`。
- 已运行 helper、controller、fixed-reply、daily-bot、welcome、PK、昵称、AI、粉丝档案、歌曲展示板、时钟、礼物显示／感谢、互动外观、加班机和资源样式的相关定向用例。旧手动保存 UI 预期已按自动保存调整；正常保存不重建输入，新编辑及账号切换继续受原代次保护。
- 欢迎 owner 最终 27/27；DOM／粉丝与界面集成最终 59/59；自动保存及感谢 owner 最终 7/7。资源桌面最终 2/2、共享画布与固定回复桌面 9/9，签到桌面 1/1、欢迎桌面 4/4。各组覆盖有交集，不累加为总数。日志留在仓库 `tmp/autosave-*.log`。
- 隔离 Electron 另核对资源参数刚编辑即关闭面板仍写入 `54`，以及正常状态无占位保存栏；13 张会误导保存步骤的指南截图已刷新。全部测试使用隔离夹具与合成数据，测试实例已关闭并移除其独立数据目录。
- 最后核对修正允许留空的字号、预览字段不阻塞业务设置保存、礼物金额取整、失败按钮失焦后仍可重试，以及用户定制欢迎词连续自动保存后的输入引用。对各具体回归采用 owner 或既有桌面用例验证。
- `npm run verify:docs` 10/10、`npm run verify:architecture` 30/30、54 个相关 JS 文件语法检查与 `git diff --check` 通过。技术参考、相关使用说明及截图已同步；HTTP／IPC、设置键与持久化格式未改变，不需调整后端契约。未运行全仓测试、打包、提交或替换用户运行中的客户端。
