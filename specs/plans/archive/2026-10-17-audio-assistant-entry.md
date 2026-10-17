# 电音助手入口与紧凑顶栏

Status: Completed

用户已确认在客户端落实方案。

## 目标与边界

百宝箱的「主播工具」提供电音助手开关和顶部图标 / 侧边悬浮选择，两者共用客户端内的小面板。侧边入口可拖动、贴左右边缘收起；跨页面与重新加载保留本机偏好。首期只有真实可操作的入口和空面板，不连接音频引擎、不增加桌面窗口、IPC 或服务。现有音频样例及暂停计划不在范围内。

## 当前行为与归属

- `src/server/admin-page.js` 组合片段；`toolbox-navigation.js` 负责百宝箱分组、选择与键盘导航。
- `app.js` 负责全局装配；新增 `audio-assistant.js` 持有入口偏好、拖动与面板生命周期，DOM 位于全局片段，不依赖百宝箱激活。
- `state-renderer.js` 消费直播和本机连接事件；新增 `topbar-status.js` 负责单一紧凑状态与详情，`live-status-presentation.js` 投影已有状态事实。连接成功不能推断已开播。
- `settings-operations.js` 已有刷新成功 / 失败 toast，沿用；刷新期间保留图标并标记忙碌。
- 复用 CSS 主题变量、开关、现有图标笔画、toast 和原生非模态 popover。

## 兼容与持久化

新增本机 localStorage 键 `admin.audioAssistant:v1`，记录 enabled（默认 false）、placement（默认 top）、归一化位置 x/y 与 dock（left/right/空）。不写服务器设置、不变更旧键。损坏记录恢复默认；保存失败保留当次操作并提示未保存。分组 ID `streamer-work` 保持，标题改为「主播工具」。保留现有页面 URL、认证、主题、播放功能及用户未提交改动。

## 实施与验收

1. 新增工具页、单一面板和全局入口；验证开关、互斥位置、跨页 / 重载、左右贴边与窗口缩小后的边界。
2. 紧凑状态保留昵称与已开播 / 未开播，长昵称截断；本机断连优先显示，toast 仅状态转换时出现，恢复后还原直播状态；详情保留完整诊断。核验不会把历史轮询接收误标成开播。
3. 同步拥有者参考与使用指南，运行聚焦测试和隔离 Electron 验证；检查唯一 DOM、重复初始化、pointercancel、损坏偏好、Escape / 点击外部收起、浅色 / 深色与窄窗口。

自动检查：`node --experimental-vm-modules --test test/admin/audio-assistant.test.js test/admin/topbar-status.test.js test/admin/admin-state-renderer.test.js test/admin/toolbox-sidebar.test.js test/admin/toolbox-sidebar-routing.test.js test/admin/admin-page-composition.test.js`；按实际涉及的已有测试补充。使用仓库语法检查、`npm run verify:docs`、`git diff --check` 与最终 `git status --short`。

桌面验证使用 `tmp/` 下自有 fixture、独立数据 / profile / 临时端口、真实 preload 与授权请求入口，不重启或控制用户实例。断连由合成事件验证 UI，不依赖真实直播间。结束关闭自有进程。

文档拥有者：`docs/reference/frontend/app.md`、`pages.md`；用户指引：`usage-guide-toolbox-work.html`、初次使用顶栏说明及 `interactive-tour-config.js`。

## 失败处理与完成条件

仅修正本任务 diff，不重置已有用户改动。不能通过时记录实际限制，不把截图当音频功能验收。入口 / 状态交互与聚焦检查完成、文档一致、diff 审核无无关数据后归档；不提交、不打包发布。

## 验证记录

- 81 项聚焦功能 / 导航 / 组合 / 引导 / 指南测试通过；另 5 项 ESM 作用域检查、10 项文档检查通过。`npm run check` 通过（1599 个脚本，15 项重新检查，其余复用有效缓存）。
- 初次检查发现计划状态格式与直接 re-export 的静态审计兼容问题；改为标准 Status 标签及显式具名导入 / 导出后复验通过，保留原模块导出兼容。
- 隔离 Electron 真实 preload、独立数据 / profile / session、临时端口；导航前 `/admin?desktop=1` 授权 200、匿名 `/admin` 401。27 项交互断言通过，含互斥入口、跨页 / 重载、双侧吸附 / 拖动不误开、pointercancel、键盘脱离边缘、点击外部 / Escape / 收起、播放器避让、900px 顶栏、损坏偏好 / 保存失败、重复初始化与本机状态优先 / toast 去重。无 renderer pageerror。
- 1440×900 浅色与 900×700 深色截图已检查；Impeccable 对新增界面检测无发现，独立界面复核 disposition 为 ship。设计记录检查沿用已有系统，无新增全局设计文件。
- 参考文档、使用指南、功能索引、新手引导及顶栏截图同步。旧粉丝 / 工作台截图的分组更名通过章节说明澄清，其余操作不变。
- 证据位于 `tmp/audio-assistant-entry-qa/`；测试实例已关闭。删除两份自有临时 profile / 数据目录时，自动审批返回 `blocked by policy`，没有更具体原因；遵守拒绝，保留 `run-BZvJ2C` 与 `run-Dc9BHb`，未换工具重试删除。保留已有用户改动，无提交、安装器构建或发布。本轮不验收音频处理或真实直播间连接。
