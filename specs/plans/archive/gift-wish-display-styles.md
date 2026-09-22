# Gift Wish Display Styles Implementation Plan

**Goal:** 精简礼物许愿预览，为每条许愿提供礼物卡片与可自定义的纯文字展示，保存后管理预览和 OBS 同步生效。

**Architecture:** 许愿服务继续拥有来源、礼物身份和计数；在已有定义上增加展示样式与文字模板。共享 renderer 负责安全替换动态文字，不改变计数逻辑或 OBS URL。

**Tech Stack:** 现有 Node.js / SQLite / Vanilla ESM / CSS / Electron，无新依赖。

**Status:** Completed，2026-09-22。

## Scope and current behavior

- 当前每条许愿仅有图片、数量、进度条；预览外围有标题、完成汇总和说明，用户要求精简。
- 新增 `displayStyle: card | text` 与 `textTemplate`（最多 200 字，空值使用默认“许愿{礼物}（{已收}/{目标}）”）。动态标记为 `{礼物}`、`{已收}`、`{目标}`，替换后只作为文本展示。
- 样式按每条许愿保存；表单提供两个选项，纯文字选项展开文案输入及动态内容插入按钮。既有礼物选择器、三周期、备注、编辑和删除保留。
- 非目标：字体/颜色设置、额外样式、模板执行器、独立展示配置服务、远端服务器变更、打包发布。

## Ownership and compatibility

- `src/bilibili/gift/wish-service.js` 校验新增可选字段并返回展示配置；旧调用不传字段时，新增默认为卡片，编辑保留已有配置。
- `src/storage/gift-wish-migration.js` 增加独立幂等迁移，`database-migrations.js` 追加 gift_db v14；`gift-wish-store.js` 持久化。保留 v13 表结构函数及既有数据、来源、创建时间和计数。
- `src/server/overlay-projection.js` 仅新增两个展示字段；鉴权、来源限制与 OBS 只读权限不变。
- 管理片段、`admin/gifts/wishes.js`、共享卡片 JS/CSS 拥有输入与展示。继续保留前一轮旧浏览器请求兼容修复。
- 合同更新：`docs/architecture/backend/storage.md`、`backend/api.md`、`frontend/pages.md`。

## Milestones and verification

- [x] 存储/服务：增加升级、重入、来源隔离、缺省兼容、非法样式及文案长度测试；实现 v14、保存与快照。验证 `test/gift-wishes.test.js`。
- [x] 展示/UI：清理预览外围文字，加入样式选择和文字编辑，安全渲染动态标记；管理与三个 OBS 周期共享 renderer。验证 `test/frontend-gift-wishes.test.js` 和 `test/gift-wish-routes.test.js`，保留旧浏览器回归。
- [x] 集成：隔离 Electron 会话验证样式切换、保存后重开、编辑不重置进度、纯文字无图片/进度条；合成数据，检查长文案换行与空模板默认值；OBS 浏览器验证相同结果。
- [x] 合同与门禁：受影响迁移断言更新为 v14；运行相关 gift / overlay HTTP / projection / admin composition 测试，`npm run check`、`npm run verify:architecture`、`npm run verify:docs`。最后检查 touched diff、`git diff --check`、`git status --short`。

## Results

- 许愿存储/路由 11 项、前端 17 项通过；前端包括旧浏览器加载、三周期文字显示、安全文本、空模板默认值及编辑切换。
- 关联组共 95 项：gift-wishes、gift-wish-routes、frontend-gift-wishes、overlay-http-access、overlay-projection、database-maintenance、gift-analysis-service、gift-projection-service、gift-sync-store、overtime-service、admin-page-composition、admin-style-ownership、frontend-gift-display-settings。首次发现 pre-v1 测试的最新版本断言仍为 13；改为 14 后单独复跑 database-maintenance 全部通过。
- `npm run check`：986 个 JS 文件通过。文档门禁 5 项通过。架构门禁只因迁移注册器追加两行超过已审核上限失败；逐行确认 DDL 保持独立、旧步骤未改并在登记中记录理由后，modularity-size 与 database-maintenance 共 12 项通过，其余架构项目首次已通过。
- 使用临时 Electron 入口、真实 preload、主进程鉴权、现有管理片段及本地数据库；匿名 admin 401，授权 admin 和 OBS 路由 200。保存/重开、动态数量、修改目标保持进度及 144 字展示换行通过；OBS 实际 HTML 和只读投影显示一致、透明底、文字行没有图片/进度条。上游礼物为合成数据，无真实直播验证。
- 设计检查器无发现；视觉检查后缩小文字框，沿用现有桌面样式。临时浏览器和 Electron 进程已关闭，未改动用户运行数据。
- 删除临时目录 `C:/Users/Tom/AppData/Local/Temp/lira-wish-display-6xRAuR` 被自动审批策略拒绝（blocked by policy）；目录保留，未通过其他方式重试删除。

## Failure handling and done when

测试只用临时数据库和隔离桌面会话，不迁移用户运行数据；不启动真实产品主入口碰触用户资料。回退仅撤销本任务 diff，不删数据或反向迁移。两个展示选项可用，自定义文字与进度实时同步、持久化兼容测试通过、桌面和 OBS 检查完成、合同一致且最终 diff 复核后归档本计划。
