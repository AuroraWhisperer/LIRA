# 遗留边界登记表

本文记录存量遗留边界的现状与收敛方向，不维护具体数字上限。若某项债务存在数量冻结限制，以对应测试文件及测试用例中的数值为唯一准绳。

## 已收敛的遗留边界（保留防回流检查）

以下历史边界已在生产代码中完成收敛，详细依赖方向与架构适应度函数见 [模块化规范](modularity-standard.md)：

- **Admin 全局状态（已于 2026-11-06 退役）**：管理端组合根现直接创建桌面界面并初始化播放模块，业务模块、共享工具、主题、日志与事件全部改用具名导入或显式回调（含全屏关闭回调），旧 `window.AdminApp` 桥接与发布器已彻底移除，测试直接加载真实归属模块。新代码禁止重新引入全局服务注册表；由 `test/engineering/module-boundaries.test.js` 中的 `frontend modules use explicit dependencies without an Admin registry` 全量扫描防护，计算属性等隐式访问继续依靠代码评审把关。
- **存储层外的领域 SQL（已知例外已清零）**：歌库（`song-store.js`）、礼物投影/统计/查询/维护四类专用存储（`gift-projection-store.js`、`gift-statistics-store.js`、`gift-query-store.js`、`maintenanceStore`，`src/bilibili/gift/index.js` 中的旧数据库上下文降级已于 2026-11-06 退役，门面仅装配领域能力并管理活动来源与视图纪元）、AI 配置与配额（`ai-state-store.js`、`ai-api-usage-store`）以及加班机（`overtime-store.js`）均已由组合根注入专用存储接口，不再直调 SQLite 语句。新领域逻辑必须依赖专用存储/仓储接口；由 `test/engineering/module-boundaries.test.js` 中的 `domain SQL receivers stay inside storage`（零白名单）配合目录级导入守卫与行为测试共同防护。
- **组合根中的可变子系统逻辑（`desktop-state` 已移除）**：桌面端退出截止时间与窗口状态已归入 `desktop-lifecycle` 与 `desktop-main-window`，日志与更新模块各自管理内部状态，跨领域的全局可变状态对象 `desktop-state` 已删除；服务端消息决策与维护恢复已归属应用层模块。新代码保持组合根仅负责装配与生命周期管理，由非数值边界断言及代码评审守护。

## 共享工具函数聚合

- **现状**：`src/shared/utils.js` 仍是依赖面较广的领域无关工具聚合点。B 站醒目留言价格与大航海等级已抽离至纯模块 `src/shared/bilibili-value-contract.js`，房间号解析归 `src/bilibili/room-input.js`，对外错误文案归 `src/bilibili/api-error.js`；存储层直接使用共享值规范，不依赖平台运行时。
- **新代码规则**：领域无关的辅助函数按单一主题拆分为独立小模块；业务或协议逻辑留在各自归属模块内。
- **按需迁移**：仅在当前任务需要改动某组工具时抽离，并同步更新直接调用方与专项测试。
- **目标架构**：小而稳定的共享模块仅暴露主题清晰的纯工具，不管理运行时资源。
- **检查手段**：常规主题依靠代码评审；`test/engineering/module-boundaries.test.js` 中的回归断言禁止表格/ZIP 编解码及 B 站业务规则回流至聚合文件。

<a id="frontend-pure-helpers-and-compatibility"></a>
### 前端纯工具函数与兼容保留

HTML/属性转义由 `public/js/shared/html-escape.js` 负责，展示格式化由 `display-format.js` 负责，多语言字体回退由 `font-family.js` 负责。播放辅助模块、当前播放渲染及管理端队列等直接调用方单独导入这些纯模块，避免顺带拉起无关弹窗或请求代码。原有假值（falsy）输入语义保持不变；经典叠加层与确认弹窗的转义规则维持各自原有约束。

`shared/utils.js` 仅为现有界面与请求调用方保留具名导出（含 `withMultilingualFallback` 的兼容重导出）。现有字体调用方均已直接使用 `font-family.js`，待明确移除旧工具导入约定后再下线该兼容重导出。原无用聚合对象及全局挂载已删除，播放源操作改用注入的工具接口执行登出确认。`module-boundaries.test.js` 防止纯工具具名导入回流至界面/请求入口；`test/ui/frontend-pure-utils.test.js` 在无界面全局对象与无网络环境下验证真实 ESM 导入及字体选择。

## 空 `catch` 块

- **现状**：`src/` 与 `public/js/` 仍存留少量空 `catch` 或仅含注释的 `catch` 代码块（含内嵌原生代码字符串中的匹配项）。
- **新代码规则**：`catch` 块必须执行恢复、上报、清理或显式向上抛出，禁止新增空 `catch` 或纯注释 `catch`。
- **按需迁移**：仅当当前任务明确界定了正确失败行为时顺带修复存量，不要为无关路径臆造日志或异常传播。
- **目标架构**：错误处理逻辑清晰可见，由具备安全恢复或上报能力的层级负责。
- **检查手段**：由 `test/engineering/module-boundaries.test.js` 中的 `empty catch text debt is frozen and can only decrease` 渐进强制执行；该测试是唯一数字上限准绳，注释不构成豁免。

## 经典脚本全局注册

- **现状**：少量旧浏览器代码仍通过传统 `<script>` 向全局挂载对象，尚未并入目标 ESM 架构。
- **新代码规则**：新前端模块统一使用显式具名 ESM 导入导出；仅在确有既有兼容需求时保留传统脚本例外。
- **按需迁移**：改动涉及时按完整的生产—调用链分批迁移，保持原有加载顺序与页面行为不变。
- **目标架构**：浏览器端依赖关系通过 ESM 边界静态可见，残余传统脚本仅保留最小化兼容适配层。
- **检查手段**：`test/engineering/esm-module-boundaries.test.js` 校验 `public/js/` 下 ES 模块中未声明、未导入的标识符；传统脚本例外与显式导出依靠代码评审把关。

## Bilibili 身份缓存兼容

`IdentityCache` 的直接调用方已全部迁移，兼容投影已移除。`UserInfoService` 统一合并身份并维护房间观众索引。解析器与轮询器通过注入的接收器提交 `IdentityHint`，小游戏与运行时通过门面查询。详见 [ADR-0010](../adr/0010-bilibili-user-info-facade.md) 和[当前实现](../../reference/backend/bilibili/danmaku.md)。

标注为“迁移目标”的条目有意不设人为数字基线。
