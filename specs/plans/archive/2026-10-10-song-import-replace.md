# 歌单整份替换导入

Status: Completed

## Goal and decisions

用户明确要求移除导入模式，上传的新表格作为完整歌库，删除未列出的旧歌曲。统一为预览后确认替换；空白或缺失字段采用新歌默认值（文本为空、分类为默认、是否可点为是），不保留旧字段。空表或任一错误/冲突阻止整批写入。

## Ownership and boundaries

- 音乐域 `src/music/song-import-update.js` 继续拥有匹配、校验、差异和删除计划；扩展现有实现，不另起替换服务。
- `src/storage/song-store.js` 在现有事务中执行删除/更新/新增、批次及云同步待发送快照。匹配歌曲保留 id；删除歌曲解除队列/历史关联但保留记录快照；分类目录保持既有独立管理语义。
- `src/server/routes/song-routes.js` 的 preview/apply 接受 `replaceAll: true`，将其纳入 token；旧 API 不带参数时继续兼容原行为。无 schema、认证或跨仓同步协议变更。
- `public/js/admin/song-import-update.js` 及页面只保留统一导入入口和确认替换；移除旧 UI 事件连接及因此失去调用者的代码。
- 同步 `specs/song-request-metadata.md`、API、storage、music/services、frontend/app、应用内使用指南和交互引导。

## Milestones and verification

- [x] 扩展既有领域/存储测试：整份替换、字段清空、同名不同歌手、仅删除、无效/空表拒绝、过期 token、超限旧库替换、引用与回滚。
- [x] 实现事务替换与路由参数；云同步测试覆盖最终完整快照及快照失败回滚。
- [x] 简化前端并更新既有 UI 测试：单一入口、删除明细、确认一次、输入变化作废、错误反馈。
- [x] 同步当前规范、参考与引导；隔离 Electron 检查预览/确认/错误，不使用真实用户歌库。
- [x] 执行受影响的 songs、cloud-song-sync-store、admin shell/guide、toast、blindbox 测试；运行文档、语法、架构检查并记录限制。

## Verification results — 2026-10-10

- 117 项定向测试通过：song-import-update、song-import-update-ui、song-file-codec、song-import-limit、song-metadata、song-service-boundary、queue-service、cloud-song-sync-store、frontend-admin-shell、frontend-usage-guide、frontend-admin-startup、frontend-toast-business、frontend-blindbox-mapping-refresh。
- `npm run verify:docs` 10 项通过；`npm run check` 1425 个 JavaScript 文件通过（包含缓存复用）。
- `npm run verify:architecture` 25/26 通过；唯一失败来自其他工作区任务的 `public/js/admin/song-background-image.js` 空 catch 检查，本任务未修改该模块，不扩大范围修复。
- 隔离 Electron 使用真实 preload、桌面请求认证、admin 片段、导入模块和 HTTP/SQLite owner；端口由 OS 分配，数据库在内存，应用路径位于仓库 tmp。匿名 `/admin` 为 401，桌面正常加载。实测 XLSX 预览和替换、文本无效值、空表、过期预览拒绝，零页面异常；测试窗口/进程已关闭，隔离目录已清理。
- 更新两张应用内指南 WebP 截图；原始预览证据仅在 tmp。未连接真实云服务，云同步待发送快照及失败回滚由存储测试验证。未操作用户歌库、提交或发布。

## Failure handling and completion

校验和 token 检查在任何写入前完成；事务失败原样保留歌曲、分类、队列/历史引用、批次和待同步状态。前端预览必须明确列出删除项，确认前不修改歌库。不提交、发布或操作用户运行中的应用。完成后记录实际验证和限制，归档本计划；不改动其他任务的工作区变更。
