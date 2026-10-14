# 点歌身份插队与 LIVE 实施计划

状态：Completed，2026-10-14。功能、两端同步实现及隔离桌面验收完成；未提交或发布。仓库中无关文档失败和临时目录清理限制见验收记录。

## 目标与决定

删除冷却控件下方重复说明，保留问号中的规则。增加默认关闭、随账号同步的 `guardPriorityEnabled`；开启时未置顶歌曲按总督、提督、舰长、非大航海排序，同身份按原入队顺序。手动置顶优先于身份排序，最近置顶最靠前。队首可手动标记 / 取消 LIVE；LIVE 始终第 1 位，置顶只能到第 2 位。完成、跳过、删除、清空移除标记，下一首不自动继承；重启保留。保存开关立即影响已有队列。

## 当前行为与所有权

- `src/music/queue-service.js` 拥有点歌动作，`src/storage/queue-store.js` 拥有 SQLite 写入与活跃队列读取；当前按置顶时间升序、创建时间升序排列，`current` 恒为 null。
- `database-migrations.js` 追加 song_db v16，增加 `queue.is_live` 和最多一条 LIVE 的唯一索引。旧记录默认 false，保留原数据。
- `public/js/admin/queue.js` 与 `public/css/admin/collapsible.css` 增加仅队首可见的 LIVE 按钮；队列 overlay 的现有四个渲染器显示 LIVE 标记，沿用后端顺序。
- 点歌规则 fragment、settings-form、settings-contract、settings-defaults、cloud-settings 负责开关和清理重复说明。LIRA Server 的 streamer-sync-settings / cloud-settings-store 仅同步开关，不接管本地点歌。
- 文档 owner：backend/music/services、backend/api、backend/ws、backend/storage、frontend/app、frontend/overlays、应用内点歌指南；服务端 system-rules、acceptance-criteria、client-server-api、management-api 及对应 OpenAPI。

## 边界与安全

沿用桌面授权和 API 路由；LIVE 操作服务端校验 ID 与当前队首，过期界面返回冲突，不标记别的歌。状态仍为 waiting，不复用遗留 current。SQL 参数化、输出使用现有转义；不新增公开接口、依赖或自动播放器联动。同步可选字段缺省时保留已存值，非法值整批拒绝，主播之间隔离。保持已有歌词与服务端管理相关未提交修改。

## 实施与验证

- [x] 队列：在现有 queue-service 测试 fixture 增加四级排序、同级稳定、关闭恢复、手动置顶、LIVE 保护、失效 ID、删除/完成/清空、重启和旧库迁移覆盖；实现共享读取 / 完成队首排序与 v16 迁移。
- [x] 设置：扩展已有 settings-contract、frontend-song-request-settings 和服务器 cloud-state-sync 覆盖默认值、保存、非法批次、缺省保留与租户隔离；完成两端字段同步。
- [x] 界面：复用现有队列控件和渲染测试结构，验证 LIVE 按钮仅在队首出现、切换和请求不重复、HTML 转义；冷却模式切换仍可用。同步技术契约与使用指南，更新相关旧截图。
- [x] Electron：沿用项目隔离 fixture / preload / IPC，仅使用 tmp 合成数据；检查规则保存、LIVE 与置顶交互、取消 / 完成后的队首、不再出现重复冷却说明，并截图。本任务实例已关闭，临时目录清理受策略限制。
- [x] 最终门禁：运行受影响 Node 测试，`npm run verify:docs`、`npm run verify:architecture`，服务端 `npm run docs:check`，两仓 `git diff --check` 与状态审查。记录通过范围及无关失败，不重复全量测试。

## 失败处理与完成条件

迁移事务失败不推进版本；点歌拒绝不写队列；设置失败保留草稿。只回退本任务补丁，不覆盖其他未提交工作。上述行为、同步、文档、隔离桌面检查全部完成后归档本计划；未执行的真实账号同步 / 部署不记为已验证。

## 验收记录与限制

- 客户端队列、设置、存储迁移、云端恢复、前端与指南组合运行 129 项，128 项通过；唯一失败来自旧冷却测试把最新版数据库的版本号直接改回 v11，导致新字段重复迁移。改为真正构建 v11 夹具后，冷却文件全部 9 项通过。旧库迁移文件全部 10 项通过，未改迁移逻辑绕过错误。
- 指南、WebSocket 权限 / 快照与队列画布后续定向检查 50 项通过。LIVE 覆盖六种队列样式，公开投影仅增加明确的布尔标记；同级排序、失效队首、并发点击、重启与终止动作均有覆盖。
- 客户端 `npm run verify:architecture` 27 项通过，`npm run check` 检查 1528 个 JavaScript 文件通过。服务端 cloud-state-sync 17 项通过，设置输入 / HTTP / Device 写入边界组合 17 项通过，`npm run docs:check` 55 项通过。
- 客户端 `npm run verify:docs` 为 8/10：既有歌词来源的三个 API 未写入文档，既有 lyric-source-feasibility 计划缺少有效活动状态。本任务契约、指南和索引已同步，保留其他任务修改；未把总门禁记为通过。
- 隔离 Electron 使用项目真实 preload、桌面授权、HTTP / WebSocket 与合成 SQLite 数据。匿名 `/admin` 返回 401，正常桌面入口成功。实际点击验证保存身份开关、LIVE 保护、无 LIVE 时置顶到第一、取消 / 完成不继承、重启恢复；检查并更新点歌规则和队列操作两张指南截图。新控件未出现重复请求或重复说明。
- 技术参考、两端 OpenAPI / 兼容输入夹具及使用指南已更新；`interactive-tour-config.js` 没有受影响的详细步骤，保持不变。只同步开关，LIVE 留在本地；未部署服务器、替换安装版或使用真实主播数据。
- 测试 Electron 进程已退出。自动安全审查拒绝删除 `tmp/queue-live-electron-nJqeAP`，返回 `blocked by policy`；未绕过限制，临时数据库与截图留在被 Git 忽略的 `tmp/`。最终差异和两仓状态已检查，未提交或发布。
