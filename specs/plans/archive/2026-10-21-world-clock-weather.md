# 世界时钟天气与列表调整

Status: Completed — 2026-10-21 已接入独立实际天气；按用户要求将日月移至国家和 UTC 之间，右侧温度上、天气下，移除底部来源行。50 项相关测试、真实上游解析及隔离 Electron 验证通过；文档同步，未打包或发布。

此前比较北京、上海、广州、深圳、成都与默认六座海外城市，同测站经纬度/海拔、相近时刻的单次抽样：MET Norway 平均绝对误差 0.89°C，Open-Meteo 1.43°C；MET 更接近 8 座、Open-Meteo 2 座、相同 1 座。美国三站预报比实测晚 7–9 分钟，此样本不代表长期准确率。原始响应及网页来源见本地 `tmp/world-clock-temperature-compare/comparison.md`。初次接入使用 MET Norway；本轮用户指定改用微软公开网页采集，不将此前比较作为微软数据的准确率证据。

此前列表调整已经隔离 Electron 检查：首项内容距顶部 11px（原 23px），相邻城市为 1px 主题分隔线，选中描边保留，无横向溢出；四个 UI 源文件的设计扫描无发现。本轮只改变来源文案及刷新周期，不改变温度布局。

## Goal

城市之间增加细分隔线、收紧首项上边距；按用户补充要求，日月图标放在国家和 UTC 之间，右侧上方显示摄氏温度、下方显示实际天气，移除底部来源行。日月仅表示当地昼夜，不推断天气。软件启动立即刷新一次，之后每个整点后台更新，切页和隐藏不触发或中止天气请求，所有结果均无 toast。同城页面采集缓存至下个整点，不使用付费 API。

## 天气文字恢复实施与验证

当前 `currentRaw.cap` 已含微软天气中文描述，但服务仅返回温度、前端仅绘制温度与天文昼夜。扩展原响应为 `{temperature,condition,validAt,updatedAt,fetchedAt}`，`condition` 为去除首尾空白的原始天气描述，缺失/非字符串/空白时为 `null`，不影响有效温度。复用既有缓存和请求，不增加请求、来源或日月映射。

- [x] 扩展 `src/server/world-clock-temperature.js` 与原测试，验证天气随温度缓存/刷新、缺失描述不丢失温度、原管理权限不变。命令：`node --experimental-vm-modules --test test/server/world-clock-temperature.test.js test/admin/world-clock-temperature.test.js test/admin/world-clock.test.js`，27 项通过。
- [x] `public/js/admin/world-clock/index.js` 按用户补充布局：日月移至国家和 UTC 之间、右侧温度下方用 `textContent` 显示天气，移除底部来源及其模板和样式。缺失明确占位，失败保留并标记上次值；`world-clock.css` 保持既有风格并允许长描述换行。复用已有 Electron QA fixture，在独立临时目录和随机端口验证白昼小雨/夜间阴天、长描述、缺失/失败及恢复；筛选/时制不额外请求。
- [x] 同步前端/后端参考及应用内指南，`npm run verify:docs` 10 项和 toolbox/guide 23 项通过。引导没有世界地图步骤，不改。仅新增响应字段，不改路由、身份、存储或生命周期，聚焦服务路由测试覆盖兼容性。

验收：隔离 Electron 使用真实 preload 和桌面会话授权，管理页 200、匿名管理页 401；合成天气下验证 12/24 小时布局、日月位于国家与 UTC 之间、天气位于温度下方、长描述换行、缺失占位且无横向溢出。筛选/时制切换零额外请求；快进两个整点共 14 次本地请求，失败保留 `10°C* / 小雨*`，恢复显示 `17°C / 雷阵雨`，检查期间无 pageerror。截图及结果在 `tmp/world-clock-condition-qa/`，测试进程已退出。两次 REPL 超时后通过同一隔离实例的调试连接完成检查，未操作用户实例。真实上游服务读取伦敦、北京均得到非空天气描述；合成截图不代表实况。4 个 JS 文件语法检查与 3 个 UI 源文件设计扫描通过。没有改动调度和认证边界，未重复全量套件、未等待真实整点，未打包或发布。自动审批以“策略拦截”拒绝删除本次隔离数据目录，临时数据保留在仓库 `tmp/` 内，不进入 diff。

## Decisions and ownership

- `public/js/admin/app.js` 启动时初始化世界地图控制器；`world-clock/index.js` 保持城市和页面可见性 owner，地球仅首次可见时加载。`temperature.js` 管理内存温度、初始批次两个并发请求、整点定时及销毁取消。筛选、切页和时制切换不发请求，新增城市独立补拉且按城市去重；销毁后的旧响应不得回写。
- `src/server/world-clock-temperature.js` 拥有微软页面解析、坐标校验、有界内存缓存、请求去重和关闭。既有和风接入服务于 AI 工具，不改 AI 或和风行为。
- `world-clock-routes.js` 保留管理身份专用 `GET /api/world-clock/temperature?latitude=...&longitude=...`，只接受合法经纬度，固定上游域名、不接受 URL；沿用认证边界，不授予 overlay 权限。返回摄氏温度、天气描述、数据生成时间及页面获取时间，保留原字段名。
- 固定读取微软天气页面的 `redux-data` JSON，不执行网页脚本；经纬度和摄氏单位必须匹配，拒绝回退位置和过期数据。上游请求带版本与项目联系链接，坐标最多四位小数，响应限 512 KiB，12 秒超时；失败退避并尊重 Retry-After。成功结果缓存至请求开始时的下个整点，避免整点读取旧缓存；缓存仅在当前 runtime 内共享。
- `server.js` 每次初始化创建实例，启动时无旧缓存，关闭前取消请求并排空；无独立后台采集进程或持久化。管理页运行时持续调度天气请求，无需打开世界地图面板。列表底部不显示来源。来源：[微软天气](https://www.msn.cn/zh-cn/weather/forecast)。
- 文档 owner：`docs/reference/frontend/app.md`、`docs/reference/backend/api.md`，入口与模块索引为 `docs/reference/frontend/pages.md`；用户指导 owner：`public/pages/admin/toolbox/usage-guide-toolbox-work.html`。AI 文档无变化；现有引导没有世界时钟专属步骤。

## Constraints and non-goals

保留既有未提交世界时钟改动、时区换算、城市保存格式、URL、地球交互与 Electron 安全边界。不引入依赖、进程、联网校时、城市目录扩充或多源回退，不改既有 AI 对话天气行为，不提交或发布。时间依赖系统时钟，IANA 时区处理夏令时，不承诺联网校时。

## 整点后台刷新实施与验证

- [x] 修改 `temperature.js` 与既有控制器测试：启动幂等、定时对齐整点且不受耗时影响、在途批次不重叠、失败静默并保留旧值、销毁取消。
- [x] 修改 `app.js`、`world-clock/index.js` 与 `toolbox-lifecycle.test.js`：应用启动即刷新，切页不联网、不 toast；地球仍按首次可见加载。保存城市失败也不 toast，仅记录日志。
- [x] 修改服务缓存及 `test/server/world-clock-temperature.test.js`：整点前命中缓存，整点重新获取；跨整点的慢响应不延长缓存，软件新 runtime 首次读取必抓取。
- [x] 温度、世界地图、toolbox lifecycle 共 35 项，toolbox/guide/admin runtime 共 33 项测试通过，7 个 JS 文件语法通过。技术参考、应用内指南、计划索引已同步；引导不变，因为没有世界地图专属步骤且入口/操作未改。
- [x] 隔离 Electron 使用真实 preload 与桌面会话认证：启动时停留在点歌页，已发 7 次本地/上游请求，地球影像尚未加载；进入地图显示 7 个温度，往返使用文档后仍为 7 次请求且无新增 toast。新增上海模拟失败后显示 `—°C`，切页回来不重试；模拟偏好保存失败也无 toast。运行时无 pageerror，测试实例已关闭，截图及结果在 `tmp/world-clock-hourly-qa/`。整点及慢请求由确定性测试覆盖，未实际等待一小时；未使用真实用户数据。
- [x] 最终 `npm run verify:docs` 10 项通过，本轮 diff、`git diff --check` 与状态已检查，既有用户改动保留。自动审批策略拦截删除隔离测试数据目录，测试进程已确认退出，临时数据保留在仓库 `tmp/` 内且未进入 diff。

## 微软来源切换验证

- [x] 北京、伦敦、纽约页面均返回 200，内嵌数据包含匹配的坐标、摄氏温度和更新时间；仅经纬度参数也可读取。原始页面和结果位于 `tmp/msn-weather-probe/`。
- [x] 来源替换及刷新节奏验证：温度后端、前端控制器、世界时钟、toolbox 和使用指南共 43 项测试通过；3 个修改的 JS 模块语法检查通过。北京、伦敦、纽约保存的真实页面通过正式解析器；正式服务实时访问东京、达拉斯成功，重复读取命中缓存。
- [x] 技术参考、使用指南和计划已同步，`npm run verify:docs` 10 项通过。既有路由身份及关闭机制未改；未重跑全量套件或启动 Electron，1 小时定时通过确定性测试验证，未实际等待一小时。界面引导无变化，因为入口和操作步骤未改。

## 历史验证（微软来源切换前）

- [x] 核对时间算法和既有变更；现有 `world-clock.test.js` 9 项通过。
- [x] 温度服务及路由：坐标、插值、Expires/304、去重、失败退避、关闭、容量和管理/overlay 权限通过；服务端温度套件 7 项。
- [x] 前端温度生命周期：进入/自动/退出/新增、失败和旧响应通过；温度控制器 4 项，既有世界时钟 9 项，共 20 项。
- [x] 隔离 Electron 使用真实 preload、会话认证及本地 HTTP 服务，合成上游温度验证位置、12/24 小时、进入 toast、失败标记/空值及恢复。重新打开发 7 次本地请求，上游保持 7 次；筛选/时制零额外请求；新增上海后上游为 8 次，无横向溢出。30 分钟静默更新由确定性控制器测试验证，未实际停留 30 分钟。临时实例已关闭，截图在 `tmp/world-clock-temperature-qa/`；没有读取或修改用户数据。
- [x] 同步技术参考与用户指南；相关 toolbox/guide/权限/传输回归 56 项、`npm run verify:docs` 10 项、`npm run verify:architecture` 27 项通过；8 个已改 JS 入口语法检查通过。

聚焦命令：`node --experimental-vm-modules --test test/server/world-clock-temperature.test.js test/admin/world-clock-temperature.test.js test/admin/world-clock.test.js`。相关回归命令：`node --experimental-vm-modules --test test/admin/frontend-admin-toolbox.test.js test/admin/frontend-usage-guide.test.js test/admin/toolbox-lifecycle.test.js test/overlays/overlay-http-access.test.js test/server/http-websocket-boundary.test.js`。合计 113 项测试通过；未运行全量套件，未打包或发布。AI 配置/文档及引导步骤未变，因为未接入天气文字、未改入口或 AI 天气行为。

## Failure handling

失败保留上次值并明确标注未更新，没有旧值则显示占位，所有结果均无 toast。请求不自动连续重试；隐藏/离开保留后台任务，pagehide 销毁后取消前端请求和定时器，旧响应不回写。服务端共享请求不因单个调用者离开而取消，超时或 runtime 关闭时终止。只反向修正本任务 hunks，原有变更和测试数据均保留。

## Done when

温度与独立天气文字可见，日月仍只由昼夜计算决定；缺失和失败不伪装成晴天，相关回归通过、文档契约一致且最终 diff 已审查。明确区分真实上游解析和合成 UI 验收。
