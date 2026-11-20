# 点歌间隔与每日上限实施计划

Status: Complete

## 目标与边界

四种身份各显示「间隔（秒）」与「每日上限（首）」两列，默认空、提示不填即不限。
空间隔不再继承非大航海间隔；已有正数保留，旧 0 与空值都表示不限。
每日额度按本机授权账号和稳定观众身份统计北京时间自然日内成功接收次数；普通、随机、SC 共用额度，手动入队不扣额度。完成、取消、删除及重启不恢复额度。
不调整其他点歌规则、队列顺序或部署运行服务。

## 当前行为与归属

- `public/pages/admin/song/request-rules.html` / `public/css/admin/workspace/song-request-settings.css`：身份间隔卡片。
- `public/js/admin/settings-form.js` / `state-renderer.js`：自动保存与回填。
- `src/shared/song-request-settings.js` / `src/server/settings-contract.js`：设置默认值、校验及同步；普通间隔当前拒绝空串，身份间隔空串继承。
- `src/music/song-request-policy.js` / `queue-service.js`：身份及入队规则。
- `src/storage/queue-store.js`：入队事务；完成后原始点歌记录删除，粉丝汇总可编辑且排除随机点歌，不能用于额度校验。
- 新计数表通过 `database-migrations.js` 追加迁移，仍由 queue-store 的入队事务拥有。计数按账号、自然日、身份类型及 UID 隔离，每次成功接收清理同账号过去日期。
- `D:/Work/lira-server/src/lib/streamer-sync-settings.js`：同步可选设置的配套服务端契约，执行与计数继续由本机拥有。

## 实施与验证

- [x] 界面与设置：增加四项 0–300 每日上限，普通间隔空串归一为兼容数值 0；四种间隔独立，0 回填为空。现有自动保存测试与 settings-contract 覆盖清空、保存、非法值原子拒绝和云端往返。
- [x] 入队与持久化：北京时间日期由接纳时间确定，事务内检查并递增成功次数，失败回滚；按核验身份选择上限，身份变化不重置当天总数。复用 queue-service 夹具验证普通/随机/SC、身份边界、账号隔离、完成/取消/重启、午夜与入队失败；迁移重复运行不丢数据。完整清库按已有冷却清理边界清除此计数。
- [x] 同步与说明：更新 Live 的 API、storage、music、danmaku 引用和内置使用指南；同步 Server 的设置校验、OpenAPI、fixture 与规范/验收。只做源码改动，不部署。
- [x] 桌面检查：隔离 tmp 数据、临时端口，真实 Electron preload 与桌面认证；查看双列宽度、空提示，填写正数再清空并重载确认。仅使用合成数据，不接触正在运行的用户应用。

## 验证命令

- `node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/queue-service.test.js test/songs/queue-random-request.test.js test/storage/database-maintenance.test.js test/storage/query-optimization.test.js`
- 根据实际调用变更补充清库、设置渲染和云同步所属测试。
- Server：所属 cloud-state-sync / settings-input-contract / device-write-boundaries 完整文件及 `npm run docs:check`。
- Live：`npm run verify:docs`、`npm run check`、`npm run verify:architecture`，不运行无关全套。
- 最后检查两个仓库的任务差异、`git diff --check`、`git status --short`。

## 兼容性与失败处理

保留现有已保存数值、用户其他修改、鉴权与队列契约；新同步字段可省略，旧快照不清空新设置。新额度只统计升级后的成功接收，不从可编辑粉丝汇总推算旧次数。计数不跨设备同步，沿用点歌队列本机所有权。
失败先停在当前步骤，修复并重跑相关检查；只逆转任务所属差异，不重置工作树或修改用户数据。

## 完成条件

所有输入可正常保存/清空且显示准确；每日额度实际生效；持久化、原子性与隔离证据通过；文档及同步契约一致；桌面检查通过并完成最终差异复核。记录实际结果，不用源码检查代替运行证据。

## 验收证据（2026-11-16）

- Live：上列聚焦命令补入 `test/settings/frontend-room-settings.test.js`、`test/storage/database-clear-all.test.js`、`test/admin/frontend-admin-runtime.test.js`、`test/cloud-sync/cloud-settings-sync-recovery.test.js`，119/119 通过。日志：`tmp/song-daily-focused.log`。
- Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/cloud-state-sync.test.js test/settings-input-contract.test.js test/device-write-boundaries.test.js test/admin-sync-compatibility.test.js`，37/37 通过。
- Live 1,907 个 JavaScript 文件语法检查通过，架构检查 30/30；Server 文档与 OpenAPI 检查 60/60。Live 文档首次唯一失败为本计划使用中文状态标签，改为门禁识别的 `Status:` 后 10/10 通过。
- 隔离 Electron 复用生产 preload、桌面请求认证、设置路由、保存与回填模块：匿名 `/admin` 返回 401；桌面填写八项正数、自动保存、重载，再清空八项并重载均成功，保存响应 200、无页面异常，普通间隔底层保存为 `0`。
- 桌面截图确认秒数与首数双列、完整空提示及框内单位；内置指南与文档副本替换为 1180 × 674 截图。测试实例已关闭；清理 `tmp/song-daily-desktop-data` 的递归删除被工具策略拒绝（blocked by policy），保留该临时目录，未尝试替代删除方式。
- API、音乐、弹幕、存储、前端参考及 Server 规范/协议同步；应用内使用指南与截图同步。README、独立 guides 与新手引导未描述被改字段，无需修改。
- 源码验收不包含部署、打包或真实跨设备同步；计数由本机拥有，配套 Server 新字段需要随双端版本发布。未提交或替换用户正在运行的应用。
