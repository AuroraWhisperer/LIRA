# Toast 修复实施计划

状态：已完成，2026-09-14。

**Goal:** 按 `docs/reports/2026-09-14-toast-review.md` 修复 B01–B09、U01–U06、V01–V07、C01–C05，使通知表达最新结果、绑定正确动作，并可阅读和关闭。

**Architecture:** 原生 ESM/CSS；共享工具直接拥有通知显示生命周期，业务模块决定身份、结果和语义。独立对账页复用轻量通知模块而不加载 Admin 样式。

## 当前行为与归属

公共 `shared/utils.js` 的 Set 丢弃状态更新，淘汰回调删除错误 key；业务入口混用盲盒字段、更新阶段及可变平台。详情见报告复现。事实地图及 ROUTE-ADMIN/ROUTE-PLAYBACK 指向 `frontend/app.md`、`frontend/playback.md`；通知 CSS 按现有六个模块归属。

## 兼容与非目标

- 保留 `toast(message)`、默认 API 错误反馈、现有 HTML 转义、礼物五种外观、图片更新静默规则。
- 不改变认证、HTTP/WS/IPC、更新安装确认、价格结算、对账算法、存储或部署。
- 不提交或操作真实用户数据；保留任务开始前已有工作树修改。

## 实施里程碑

- [x] 公共行为：新增直接拥有通知的 `public/js/shared/toast.js`，`utils.js` 兼容转发。Map 绑定 key/节点/计时器；`update: true` 原位更新，返回关闭句柄；`duration: 0` 保持进度；交互暂停、真实按钮、幂等关闭、退出 180ms。系统最多 3 条、礼物最多 6 条，并以实际高度调度，先保留错误/操作，待展示系统结果排队。用隔离时钟/DOM 验证更新、淘汰、暂停和队列。
- [x] 业务准确性：修改 gifts/notification、desktop、provider-operations、settings-form、gift-audit/index；`api(url, body, {notifyError:false})` 供自有 catch 使用。聚焦验证 B01–B08、两个更新时序、认证三态。
- [x] 页面反馈：playlist 删除和 AI 测试使用稳定 key；AI 回复/账号条件/删除统计保留页面落点；blindbox 与 danmaku 校验就地显示并聚焦；导入按返回统计区分四类结果。更新对应内容契约测试。
- [x] 生命周期及视觉：catalog-update-toast 复用公共控制器；对账页单条更新；system/ai/playback/live/desktop-update/gifts CSS 修复宽度、换行、图标、关闭、播报、减少动态效果和堆叠移动；保留现有主题。更正指南，移除可见页面动作冗余提示。
- [x] 交付：更新报告实施状态及 app.md 的通知契约；审查任务 diff、运行聚焦测试与架构检查，记录实际验收与实机限制。

## 验证

`node --experimental-vm-modules --test test/frontend-toast.test.js test/playback-provider-operations.test.js test/frontend-gift-catalog-update.test.js test/frontend-blindbox-admin.test.js test/gift-audit-page.test.js test/admin-style-ownership.test.js test/frontend-admin-shell.test.js`，以及定位后的 AI/账号/词库/导入相关测试。

`npm run check`、`npm run verify:architecture`、`npm run verify:modularity`、`git diff --check`、`git status --short`。用无真实数据的渲染场景验证默认/最小桌面尺寸、长文本、混合通知空间、按钮和 reduce。测试不访问外部音乐或账号服务。

## 失败处理与完成条件

失败时定位拥有层，只逆转本任务相关差异；不使用 reset/checkout 或覆盖用户修改。所有报告项有实现和相称证据，契约检查通过（或明确既有失败），最终 diff 无运行数据/凭据，报告标注实机未覆盖项，才标记完成。

## 执行记录

- 2026-09-14：读取报告、计划规则、Admin 约束及通知入口；初始工作树存在其他功能修改，已记录范围。

- 2026-09-14 完成：报告 27 项已实施，公共层独立为 1 个直接拥有通知的模块，无运行时依赖；字段错误 CSS 归共享基础样式，AI 持续详情 CSS 归 AI 页面，保留 toast 样式职责。
- 最终验证：145 项聚焦测试通过；719 个 JS 文件语法检查通过；真实浏览器焦点/Enter 和对账替换通过；Electron 43.2 离屏默认/最小尺寸与 Chromium 长文/reduce 检查通过。
- 架构/模块检查仅余既有 song.css 与 license.css 行数基线失败；未触碰这两个文件或放宽基线。原生读屏、真实账号业务与硬件加速手感不在本轮隔离验证内。
- 发现并解决：使用 DOM append 排序可能丢失键盘焦点，改为 CSS order 并补真实浏览器回归；辅助页补齐共享语义 SVG 的本地尺寸；旧登录装饰和更新圆点让位于真实动作/关闭按钮。
- 最终差异与工作树状态已审查，`git diff --check` 无空白错误，文档检查 5 项通过；运行截图与隔离脚本均位于工作树之外，无凭据或运行数据进入任务差异。
