# 网页歌单访问开关与同步面板

Status: Completed

## 目标与范围

用户确认：开关控制网页歌单直达链接能否访问，不是站内搜索或搜索引擎收录；默认关闭。关闭不删除歌曲、不停止本地歌库同步。同步面板将说明移入已有 `lira-help`，账号标签与账号名、数量标签与数量分别同一行；保留覆盖操作的确认弹窗。

不调整官网搜索、直播画面、点歌规则、歌曲同步算法或网页管理站的其他配置。

## 当前行为与所有权

- Live：`public/pages/admin/song/import-export.html`、`public/css/admin/workspace/song-management.css`、`public/js/admin/cloud-song-sync.js` 拥有面板；`src/electron/preload.js`、`src/electron/ipc/license-songs-ipc.js`、`src/electron/license/song-protocol.js` 拥有受限桌面桥与授权请求。
- Server (`D:/Work/lira-server`)：`src/app.js` 发布租户歌单页面；`src/routes/public.js` 发布歌曲、资料、外观和社区接口；`src/modules/device/register-song-routes.js` 拥有设备歌单路由。现无访问开关。
- 持久化沿用租户 song DB 的 `song_page_settings`，新增独立 `access` 键 `{enabled:boolean}`，不改表结构、不混入同步设置或外观。
- 契约：Live desktop/preload 与 frontend/app；Server client-server-api、Device OpenAPI、public-song-page-api、system-rules / acceptance-criteria；用户指导为 Live usage-guide-web / usage-guide-song。

## 约束与方案

- 未保存 `access` 的现有账号和新账号都按关闭读取；仅显式 `true` 开启。
- DeviceBearer 的 GET/PUT `/api/device/song-page/access` 只作用于已认证设备的 streamerId；PUT 严格接受 `{enabled:boolean}`，沿用设备请求校验、额度与审计。
- 新的主进程操作与 IPC 仅暴露布尔值；授权代次和来源校验沿用现有 owner，renderer 不选择账号或服务地址。
- 页面入口 `/`、`/song[/]`、`/learning[/]`、`/wishes[/]` 以及公共歌曲、资料、外观、社区入口在关闭时返回 404 / no-store；profile 异步读取完成时再次核验，防止关闭后迟到响应。
- 已有匿名背景图片是桌面背景预览的消费者，保持其现有读取与缓存契约；关闭不暴露歌曲或社区内容，直播画面事件接口不受影响。
- renderer 初始禁用开关，读取成功再启用；保存期间禁用防重复，失败恢复已确认值并给出错误；开启后才显示“查看网页歌单”。不把读取失败冒充已关闭。

## 交付与验证

1. 服务端 owner、持久化和公共入口拦截。
   - 用隔离 HTTP/SQLite 测试验证缺省关闭、开启/关闭可持久化、跨租户隔离、未授权/非法输入拒绝、关闭后的页面和歌曲/社区接口 404、本地设备读写仍工作。
   - 既有公开歌单测试使用显式开启的租户 fixture，保持原有读取/限流/外观/社区断言。
2. 桌面桥与紧凑面板。
   - 复用 license IPC fixture 验证来源、布尔输入和响应字段收敛；复用 cloud-song-sync UI fixture 验证初始/保存失败回滚及链接显隐，保留覆盖同步行为。
   - 用隔离 Electron 测试实例验证真实 preload / IPC 与面板布局，截图只放根目录 tmp；不启动或控制用户实例。
3. 同步文档与最终审查。
   - 更新受影响协议、OpenAPI、需求/验收、使用指南；架构责任不变，无需 ADR。
   - 执行 Live 相关 Node 测试、`npm run verify:docs`、相关架构检查；Server 相关 HTTP/契约测试和 `npm run docs:check`；再据具体故障扩大。
   - 两仓分别审查本次 diff、`git diff --check`、`git status --short`，保留既有用户改动。

## QA 清单与失败处理

- 默认关闭/打开后链接可访问/再次关闭后同链接 404：真实本地 HTTP 测试。
- 账号和数量各自标签值一行、说明问号可打开、开关与动作布局：隔离 Electron 实际渲染。
- 保存请求失败：开关回滚且仍可重试；初始化失败：禁用并说明不能读取。
- 非法布尔值及非桌面 IPC 来源：不写入；关闭不改歌曲及同步状态。
- 回退仅逐项逆转本任务的源码和文档补丁；不删除用户数据，不重置仓库。

## 完成条件

上述行为与受影响契约一致，聚焦测试和实际桌面检查通过或明确记录限制，完成两仓 diff 审查。源码完成不等于线上部署；本任务不提交、推送、打包或部署。

## 验证结果（2026-11-09）

- Live：5 个相关测试文件 43 项通过；背景操作原有 3 项通过；架构 29 项通过，4 个修改的 JS 语法检查通过。
- Server：9 个相关 HTTP、限流、外观、资料、社区与应用测试文件共 80 项通过；复用未失效的成功结果，修正显式开启的 fixture 后重跑受影响文件。`npm run docs:check` 60 项通过。
- Live `npm run verify:docs` 为 9/10：本次计划状态、当前文档链接和接口登记通过；唯一失败为原有 `docs/reports/2026-11-05-continuous-audit.md` 指向已不存在的 tmp 审计报告。未改写这些历史链接或重建占位报告。
- 隔离 Electron 使用实际 preload、license IPC 与授权操作；匿名 `/admin` 为 401，桌面会话能打开。验证默认关闭、开启、关闭、保存失败回滚、键盘连续切换和保存后焦点恢复，两种问号均可查看。830px 面板中账号/歌曲标签与值同行；合成账号截图已同步使用指南。测试实例与其 HTTP listener 已关闭。
- Impeccable 检测仅报告原有动态背景预览 `<img>` 无静态 src；该元素在取得背景前隐藏，不是本次新增的破图。
- 技术协议、需求/验收、路由登记和用户指南已同步；引导只介绍本地导入，不涉及网页发布，保持不变。无架构所有权变动，无需 ADR。
- 仅本地源码与合成验证；未操作真实账号、更新正在运行的客户端、提交、打包或部署。网页访问规则需客户端及服务端更新后生效。
