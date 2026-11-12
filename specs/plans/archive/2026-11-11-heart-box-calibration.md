# 心动盲盒进度校准

Status: Completed

## 目标与范围

缩小并内缩「已收集」，让同一条进度填充经过标签背景而文字始终在上层。提供本期累计数量校准，后续有效礼物继续累计；超过 120 保留实际数量并保持满格。管理页说明归入现有问号组件。

不调整固定奖励、礼物识别、服务器事件或其他盲盒统计，不修改用户的真实数据，不提交或发布。

## 当前行为与归属

- `src/bilibili/gift/heart-box-collection.js` 用 `gift-wish-store.countMany` 聚合授权来源本周数量，已有超额累计与周界测试，无校准存储。
- `src/server/routes/gift-wish-routes.js` 提供读取接口；overlay scope 仅授权 GET。
- `public/js/shared/heart-box-collection.js` 与共享 CSS 为桌面预览、画布及独立来源渲染。当前标签背景单独计算填充，且标签贴轨道左端。
- 管理页 owner 为 `public/js/admin/gifts/heart-box-collection.js`、对应片段与 CSS；说明复用 `lira-help`。
- 文档 owner：backend/api、backend/bilibili/gift、backend/storage、backend/ws、frontend/pages、frontend/overlays；用户指南为 `usage-guide-guard-thanks.html`。入口不变，交互式导览无需更新。

## 决策与兼容

1. 新增 `heart_box_collection_adjustments`，每个授权来源保存最近校准的周期起点和差额。显示数量 = max(0, 本期原始聚合 + 本期差额)。周期匹配失败时差额为 0，不写造假流水，不影响其他统计。单行 upsert；通过 gift_db 追加迁移创建，重复启动安全。
2. 新增管理 POST `/api/gifts/heart-box-collection/adjust`，接受 `count`、`expectedCount`、`startsAt`、`viewRevision`。数量为 0–999999999 整数；拒绝来源选择、过期来源/周期/进度。同步读取、验证、写入期间无异步切换点。保留已有 GET DTO。
3. 校准成功发布 `gift:heart-box-collection`，只使该组件的场景缓存失效；独立源继续使用原共享 feed。
4. 桌面输入在编辑期间保留，普通保存失败不抹掉输入；来源/周期/数量过期时刷新并回填最新数量，要求重新输入，避免误用旧来源或覆盖新礼物。正常自动更新与设置同步不常驻说明，加载/同步中/错误仍显示。
5. 标签底色、进度填充、文字依次叠放，填充动画只保留一份；节点与奖励位置保持不变。

## 里程碑与验证

- [x] 存储和校准：扩展 `test/gifts/heart-box-collection.test.js`，覆盖补计、后续累加、下调、重建服务后读取、来源/周界隔离、无效和过期写入。增加独立 store/migration，接入组合根。
- [x] 管理接口与发布：扩展现有 routes 和 runtime-event-publication 测试，检查 overlay 无写权限及只刷新所属组件。
- [x] 管理页和共享视觉：用隔离 Electron、真实 preload、临时 SQLite 与端点验证校准及失败保留；查看 0、5、10、20、140，检查标签文字和进度位置。复用现有存储、HTTP 与认证夹具模块，不接触用户运行实例。
- [x] 同步接口/存储/页面参考与用户操作说明。普通视觉不新增静态断言；更新已有功能覆盖，不重复规则测试。

命令：`node --experimental-vm-modules --test test/gifts/heart-box-collection.test.js test/gifts/gift-wish-routes.test.js test/gifts/gift-wishes.test.js test/server/runtime-event-publication.test.js test/storage/database-initialization.test.js`；`npm run check`；`npm run verify:architecture`；`npm run verify:docs`。定向运行 Electron UI 检查，最后检查任务差异、`git diff --check`、`git status --short`。

## 失败处理与完成标准

数据库失败保留旧值，页面显示可重试错误；过期请求返回 409。任务前相关文件保存在 `tmp/heart-box-calibration/before/`，只回退本任务差异，保持工作区已有修改。新增表不需要删除用户数据才能回退读取逻辑。

完成需：四项用户要求通过定向验证，校准持久化与隔离正确，文档一致，未引入生成数据或敏感材料，测试实例关闭，差异已审查。

## 验证结果

2026-11-11：74 项直接相关检查通过（收集/许愿/初始化 50 项，路由/发布 10 项，overlay 投影 13 项，已有画布与直播来源流程 1 项）；最后强化同数量下的跨来源/跨周期冲突检查后，收集、路由、发布和投影 31 项复跑通过。架构 29 项通过，JavaScript 语法检查通过。

隔离 Electron 使用真实 preload、桌面请求认证和临时 SQLite。匿名 `/admin` 为 401，正常桌面会话及独立来源可读；实际控件验证 5 + 新礼物 5 = 10、失败输入保留并重试、编辑中进度变化拒绝覆盖、重载后保存值恢复、问号说明及原显示开关可用。0/5/10/20/140 已查看；独立 620px 来源在 140 时填充宽度等于轨道宽度，ARIA 上限为 120、真实数量为 140。现有画布两种样式与发布流程通过，未新增周期请求。设计机械检测无结果，未发现重复输入或重复提交。

截图和 QA 摘要位于 `tmp/heart-box-calibration/`，测试 Electron、HTTP 和 SQLite 已关闭；临时配置目录 `electron-data/` 的清理被执行策略拦截，原地保留。只修改本地客户端；未用真实账号、未运行真实 OBS/直播姬、未打包发布。现有指南截图仍为任务卡示意，没有旧校准操作；交互式导览入口不变。文档门禁初次因计划状态标签不符合解析格式失败，已修正并归档，最终 10 项通过。差异检查通过，工作区其他任务修改保留。
