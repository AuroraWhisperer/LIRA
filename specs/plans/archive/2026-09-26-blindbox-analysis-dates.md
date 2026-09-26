# 盲盒分析日期筛选实施计划

状态：已完成。

## 目标与范围

在盲盒分析工作区标题栏增加紧凑日期入口，默认今天，可选单日或包含首尾两天的日期区间。弹出日历沿用现有青绿色样式，保留汇总、筛选栏、三种视图的布局。首页今日统计、OBS、存储格式和身份边界不变。

## 当前行为与归属

- `public/js/admin/gifts/blindbox-analysis.js` 管理工作区筛选、分页、请求取消及实时刷新。
- `public/pages/admin/gifts/blindbox-analysis.html` 与 `public/css/admin/blindbox-analysis.css` 拥有布局。
- `src/server/routes/gift-routes.js` 将查询交给 `src/bilibili/gift/blind-box-analysis.js`，后者目前固定本机当天。
- `queryStore.listBlindBoxRows` 已支持起点包含、终点不包含的时间查询和来源隔离，无需改存储层。
- 接口合同归属 `docs/architecture/backend/api.md`；现有覆盖位于 `test/gift-query-service.test.js`、`test/frontend-blindbox-admin.test.js`。

## 决策与兼容

接口增加可选 `startDate/endDate`（YYYY-MM-DD，本机日期）；只给一端视为该单日，都省略仍为今天。使用现有日期格式校验，非法日期或逆序返回 400。响应追加 `dateRange`，保留原有 `today` 含义。范围换算为本地零点至结束日次日零点，来源过滤继续由服务端决定。UI 日期草稿点击应用后生效；今天恢复默认实时日期。切换日期重置分页，保留观众/盲盒筛选及查看方式。

## 实施与验证

- [x] 查询：补充跨日边界、三种视图、筛选分页、来源隔离、非法日期测试；扩展服务与路由，更新 API 文档。
- [x] 界面：新增仅供此工作区使用的日历模块与样式；覆盖单日、区间、月份切换、应用/取消、今天、键盘和关闭行为。
- [x] 验证：运行 `node --experimental-vm-modules --test test/gift-query-service.test.js test/blind-box-analysis-dates.test.js test/frontend-blindbox-admin.test.js test/admin-page-composition.test.js test/admin-style-ownership.test.js`；运行相关语法检查及 `npm run verify:architecture`、`npm run verify:docs`。
- [x] 使用现有 Electron 截图 fixture 的独立临时数据实例验证实际日历和真实日期请求；检查打开/关闭不挤动布局、跨月区间、取消不改变结果、无数据状态。
- [x] 检查最终 diff、`git diff --check`、`git status --short`，记录证据后归档计划。

## 验证记录

- 31 项定向测试通过，包含新增 6 项日期测试（单日、含首尾日、跨月、分页、来源隔离、400 错误和夏令时边界）。相关 JavaScript 语法检查通过；文档检查 5 项通过。
- 架构检查 21/22 通过，唯一失败为工作区已有 `public/js/admin/display.js` 空 catch 债务，与此改动无关，保留用户修改。
- Electron 使用现有截图 fixture、独立临时数据/浏览器目录、随机端口和正常 preload/主进程请求鉴权；授权 `/admin` 返回 200。合成历史记录验证 8 月 31 日单日 1 盒、至 9 月 1 日区间 2 盒，三视图相同。
- 桌面 1440×900 与最小 1024×680 窗口检查通过；日历不裁切，展开前后原筛选栏位置不变，区间高亮、反向点选、月份/键盘导航、取消、Escape、外部点击、今天、无数据下保留筛选、关闭重开均已检查。无 renderer 异常。
- Impeccable 检查未发现问题。截图只保存于工作区外，测试实例已退出。自动安全审核拒绝删除临时测试目录，仅返回 `blocked by policy`；没有改用其他方式绕过，目录 `C:/Users/Tom/AppData/Local/Temp/lira-blindbox-dates-01c2wS` 保留且不在 Git 工作区内。

## 失败处理与完成条件

请求失败沿用已有错误/重试状态；未应用草稿不改变查询。只撤回本任务改动，保留工作区已有修改，不提交、不重置用户文件。完成要求为单日和区间统计正确、日历交互和桌面显示通过检查、默认今日与来源隔离不变、文档同步、临时进程关闭。临时目录清理受策略阻止，已向用户说明并保留目录。
