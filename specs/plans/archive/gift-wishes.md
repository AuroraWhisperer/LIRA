# Gift Wishes Implementation Plan

**Goal:** 在礼物姬「滚动礼物」之后加入礼物许愿，提供长效、本日、本场直播的整数目标、实时进度和 OBS 展示。

**Architecture:** 复用当前来源的最终礼物账本、加班机目录及图片缓存。在 gift-data.db 保存来源隔离的许愿定义和最近确认的直播窗口；服务端负责时间窗口和计数，管理页与 OBS 共用卡片组件。

**Tech Stack:** Node.js 24、SQLite、现有 Vanilla ESM / CSS / Electron，无新增依赖。

**Status:** Completed，2026-09-20。

## Requirements and boundaries

- 长效从服务端创建时间起算；本日按北京时间 00:00 起算，包含创建前本日已捕获流水；本场从 B 站确认的开播时间起算。重连/重启不建立新场次，下播后本场归零等待下一次开播；状态查询失败冻结到最后确认仍在直播的时间，恢复后重算。
- 盲盒本体按已确认盒子身份统计开盒数量，产出按产出身份统计数量。未知身份不猜测；礼物完整 variant 身份优先，舰/提/总使用现有标准 ID 和本地图。
- 同一个事件只读取账本最终行，不增加独立实时累加器；重放与补同步不会重复累计。清除礼物流水会同步影响统计，延续现有账本的数据保留语义。
- 目标为 1–999999999 的整数，实际计数可超过目标，进度条最大 100%。支持多条、新增、改目标/说明、删除；改目标不重置起点。
- 不改现有加班机行为、礼物展示样式、远端服务器或现有用户修改；不提交、分支、发布。

## Ownership and current behavior

- `src/bilibili/gift/index.js` 拥有当前授权来源；`gift_events` 已有最终数量、来源、礼物/盒子 variant ID 与时间。
- `src/bilibili/gift/hybrid-catalog.js` 提供房间和全库快照及 B 站 webp 缓存。
- `src/server/domain-services.js` 组装领域；`api-context.js` / `routes/gift-routes.js` 提供管理 API；`access-policy.js` / `overlay-projection.js` 限制 OBS 权限。
- `public/pages/admin/toolbox/gift.html` / `public/js/admin/gift-assistant.js` 拥有礼物姬标签页。
- 目前没有可复用的持久直播场次边界；新增按需查询 B 站公开 room_init 的小型直播窗口服务，30 秒缓存并合并并发，请求失败标注待确认，不用软件启动时间代替开播时间。

## Milestones

- [x] 数据与领域：追加 v13 迁移、来源隔离的存储、目录身份选择、整数统计、开播窗口。验证临时数据库迁移重复运行、三周期、时区换日、盲盒、重放、重启、来源变化。
- [x] API 与权限：新增许愿读取/保存/删除、OBS 只读 scope。请求只接受当前 viewRevision，服务端校验目录和目标；覆盖错误输入和来源切换。
- [x] UI：现有奶油色管理页内新增标签页、礼物选择器、编辑/空/加载/错误状态、共用可爱进度卡和 OBS 页面。复用现有目录读取与图片缓存。
- [x] 验证与合同：在隔离数据目录中用 Electron 验证实际管理页面和 OBS；运行受影响测试、静态检查及架构/文档门禁，记录结果。

## Verification

`node --experimental-vm-modules --test test/gift-wishes.test.js test/gift-wish-routes.test.js test/frontend-gift-wishes.test.js`；相关礼物目录、来源投影、迁移、权限、管理页组合测试按修改范围选择；`npm run check`、`npm run verify:architecture`、`npm run verify:docs`。最终检查 touched diff、`git diff --check`、`git status --short`。

### Results

- 聚焦组 114/114：`node --experimental-vm-modules --test --test-reporter=dot test/gift-wishes.test.js test/gift-wish-routes.test.js test/frontend-gift-wishes.test.js test/overlay-http-access.test.js test/overlay-projection.test.js test/database-maintenance.test.js test/frontend-gift-display-settings.test.js test/domain-services-initialization.test.js test/gift-query-service.test.js test/gift-sync-store.test.js test/gift-identity-catalog.test.js test/gift-sale-catalog.test.js test/query-optimization.test.js test/websocket-access-policy.test.js test/frontend-admin-toolbox.test.js`。
- 迁移兼容补充组 17/17：`node --test test/gift-analysis-service.test.js test/gift-projection-service.test.js test/overtime-service.test.js`。仅更新既有最新 schema 断言为 v13。
- 目录协议测试使用已有隔离检出 `D:/Work/lira-audit/current-review-2026-09-18/remediation-2026-09-18/server-contract-fixture` 设置 `LIRA_SERVER_ROOT`；固定提交和 5 份 fixture 校验通过，未修改开发中的服务器检出或契约锁。
- `npm run check`：938 个 JavaScript 文件通过。`npm run verify:architecture`：22/22。`npm run verify:docs`：5/5。
- Electron 使用隔离 DB、实际 preload、桌面鉴权和管理片段，验证三周期创建、编辑保留计数、目标达成、舰队图片与 OBS 读取。匿名 `/admin` 保持 401，OBS 使用独立只读凭据；管理与 OBS 截图保存在仓库外。上游直播状态和账本用合成数据，未进行真实直播送礼验证。
- 最终独立 UI/代码复核发现下播边界不可用重新打开页面的时间替代，已改为离线归零、失败冻结，回归覆盖页面关闭期间的离线礼物、重启、查询恢复和新场次。
- 实际 OBS 验证发现独立 HTTP dispatcher 也需注册许愿读取，已修正并补充真实 HTTP 权限/投影测试。
- 本次新增文件及已跟踪改动已复核，`git diff --check` 通过；未生成仓库内运行数据，保留其他任务修改。隔离 Electron 进程正常关闭；删除临时目录 `C:/Users/Tom/AppData/Local/Temp/lira-wishes-qa-BfYgL9` 被自动审批策略阻止，目录保留。

## Failure handling and done when

上游开播时间未知时暂停本场计数并明确提示，不把未知区间当成已确认直播；只读快照与写操作均检查授权来源。迁移只追加表，不修改原流水。若失败，仅撤销本任务修改。三周期、准确整数计数、房间/全库选择、webp/本地舰队图、管理和 OBS 展示均可用，针对性测试通过，合同和最终 diff 已复核即完成。
