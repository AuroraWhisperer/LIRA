# 客户端三套配色实施计划

**Status:** Awaiting Verification

2026-10-02 用户明确要求按设计评审开始实施；该指令取代评审中的历史“暂不实施”说明。

## Goal

按 [设计评审](../../docs/reports/2026-10-02-client-theme-design-review.md) 提供 neutral、classic、terracotta 三套浅色客户端配色，默认 terracotta（暖陶；按用户后续要求调整，已保存选择保持）。选择候选后显式应用，成功落盘后原位切换；外部工具打开时跟随。

## Non-goals / Compatibility

不改登录、直播输出、观众页、歌词内容、业务专属视觉及公共几何排版。不增加深色、主题导入或云同步。不放宽授权。保留现有导航、登录及报告用户修改，不提交、不发布。

## Current Behavior / Ownership

`public/css/desktop/theme.css` 包含单套桌面颜色与壳样式。`styles-base.css` 被登录及输出复用，不能全局改值。Admin 由 `src/server/admin-page.js` 拼装；`http-utils.js` 完成授权后响应 HTML。主进程在 `src/electron/main.js` 组合本地 runtime 并创建窗口。IPC 来源由 `ipc/main-window-ipc.js` 限制，preload 提供窄桥。现有业务 theme 与本机外观分开。

## Proposed Changes / Milestones

1. 提取 `desktop/palettes.css`，保持 token 名和别名；同一选择器同时适用于根主题与选项小样。各控件 owner 适配功能边线、选中、按下、禁用及语义角色；预览检查底固定，审计只引入色板。验证：色板完整性、对比度与相关样式测试。
2. 主进程新增本机外观 owner，dataDir/client-appearance.json 只存 themeId。启动读取容错且不覆盖坏记录，写入原子替换并串行提交。新增仅主窗口可调用的应用 IPC；成功返回 `{ ok: true, themeId }`，失败不改变已提交状态。通过 runtime 的只读 getter 向白名单 HTML 在 CSS 前写入枚举属性。验证：存储失败、并发、IPC 来源、HTML 白名单与首帧背景测试。
3. 设置页新增“客户端外观”，同构小样、候选单选、当前标签、应用按钮和 live 反馈。仅成功后改根属性，不调用业务保存或刷新。验证：候选不提交、重复点击、失败保留、成功原位切换与初始化幂等。
4. 整合独立工具、文档契约和隔离 Electron 运行验证。验证新页面跟随、旧页面保持、草稿与 DOM 保持、登录与 iframe 输出隔离。仅使用 tmp 下临时数据，不能触及用户正在使用的实例。

## Verification

先运行新增主题测试及直接受影响的 Admin、HTTP、Electron 测试。随后因 IPC/启动/持久化变更运行 `npm run verify:quick`、`npm test`（不访问实际账号），按实际运行结果记录。UI 使用现有隔离 Electron 路径，先核查 dataDir、单实例与端口隔离。末尾检查 `git diff --check`、修改 diff、`git status --short`。

## Rollback / Failure Handling

读取坏记录回退 terracotta，不写文件；应用失败保留当前主题和候选。仅撤销本任务增改的具体行与新增文件，禁止整文件回退覆盖用户修改。未完成的运行验收如实保留。

## Done When

三套色板和应用链路落地，相关自动化通过；独立工具只读跟随且授权不变；排除页面不受染色；契约文档更新且最终 diff 无临时数据。原生 Windows 缩放等无法执行的项目单列证据限制，不用自动化替代。

## Execution Evidence

- 初始工作区已有报告、报告索引、导航 CSS/HTML、登录 CSS/欢迎动画修改；已记录并保留。
- 实现已完成：三个预设和同构小样、组件状态、类别与动作分离、专属内容隔离、只读 HTML 初始化、本机原子串行存储、窄 IPC、退出排空与原生窗口底色；设置入口为百宝箱 → 设置。
- `npm run verify:quick` 通过（文档 9 项、JavaScript 检查、架构 22 项）。新增主题测试、直接相邻样式/组件/启动/停机测试均通过。
- 完整 `npm test` 首轮：本机实例 3 项通过，另一批 3304 项中 3290 通过、14 失败。两项启动 VM 夹具缺新模块依赖，补齐后与外观测试共 10 项通过；另 12 项由服务器工作区不匹配锁定 revision 导致，在 `tmp/` 的临时 detached 契约检出下运行 `npm run test:contracts`，133 项全通过；未更改锁或服务器主工作区，临时检出已清理。
- 隔离 Electron 使用真实 HTML/CSS、preload、授权请求注入、IPC/文件 owner，业务启动由最小合成夹具替代。当前 Windows `devicePixelRatio=1.5`：三套设置面板均为 1080.67 × 371.66 CSS px、无溢出；已检查真实设置、双队列、播放与礼物页面结构及色板。新单选框曾继承通用输入尺寸，已局部修正为 16px。
- 真实交互验证：选择候选不改当前页；应用后文件只含 themeId；根属性/当前标签/落盘一致；未保存输入、播放器与设置节点身份保持，应用期间无 HTTP 请求。制造目标文件替换失败后仍为旧主题、候选保留，恢复后可重试。重载及退出重新创建隔离 Electron 恢复已保存主题，原生底色一致。
- 独立浏览器验证：工具旧页保持暖陶，应用经典后新工具页为经典且无桌面桥；匿名礼物审计仍 401；登录和 clock 输出页面无客户端主题属性/色板。礼物审计只验样式接入与授权边界，不声称其既有数据连接问题已修复。
- 静态设计检测仅提示选项小样的侧边标记；这是评审明确保留的导航选中示意，保留。截图和检查日志位于仓库 tmp，未进入产品文件。

## Remaining Acceptance Evidence

- 原生 Windows 100% 缩放、不同缩放与真实密集业务内容的最终视觉验收未覆盖；本轮为当前 150% 的隔离窗口。
- 未连接实际直播间、登录账号或实际播放音源，因此不声称完成实播不中断、完整生产登录冷启动和全部局部控件状态的人工验收。自动化已覆盖启动顺序、授权、持久化失败、快速提交、草稿 DOM 保持和内容边界。
- 此状态表示实现已交付、仍保留上述人工运行验收，不恢复报告列为独立问题的礼物审计授权/数据链路修复。

最终复核：相关 9 个测试文件合计 83 项全部通过，`npm run verify:quick` 再次通过。真实按下态使用独立 active 色；已打开的 Toast 节点保持，换色后背景继承新配色、信息标记仍为独立 info 色。隔离 Electron 和浏览器已关闭，临时服务器契约检出已移除。

临时运行数据清理命令被工具安全策略拒绝（仅返回 `blocked by policy`），因此 `tmp/client-theme-run-dPpzVK` 的合成 profile、记录及截图和 QA 脚本保留在被忽略的 tmp；未改用其他执行方式绕过，产品差异不包含这些文件。
