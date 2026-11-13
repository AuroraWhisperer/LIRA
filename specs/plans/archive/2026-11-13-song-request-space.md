# 点歌空格限制实施计划

**Status:** Completed

**Goal:** 在点歌规则增加默认关闭的「点歌指令必须带空格」，开启后仅接收「点歌 歌名」，避免紧连文本误触发。

**Architecture:** 沿用现有点歌设置、自动保存和账号同步；Bilibili 指令桥接层在入队与冷却前检查分隔空格。服务器仅保存认证租户的设置，不执行本地点歌。

**Tech Stack:** CommonJS、原生 ESM/HTML、SQLite settings、Electron。

## 当前行为与所有者

- `src/bilibili/bilibili-message-handler.js` 当前接受「点歌晴天」及「点歌 晴天」；`cleanText` 负责既有空白归一化，普通聊天不读取点歌设置。
- Live 的 `src/shared/song-request-settings.js` 拥有默认值、布尔归一化和同步序列化；表单由 `public/pages/admin/song/request-rules.html`、`public/js/admin/settings-form.js` 拥有。
- Server 的 `src/lib/streamer-sync-settings.js` 拥有同步字段；两份 OpenAPI、输入 fixture、REQ-SYNC-001 和 AC-SYNC-001 是受影响的同步契约。
- 新键 `songRequestRequireSpace`：本地字符串 `'false'`，同步 boolean false；旧快照省略时沿用同账号已存值。无数据库迁移。

## 边界与兼容

- 仅普通点歌（含已启用的 SC 点歌）要求「点歌」后有分隔空格并带非空歌名；沿用既有空白归一化。默认及显式关闭时保留紧连格式。
- 未满足格式时按非点歌指令忽略，不入队、不记录请求、不消耗冷却、不生成点歌失败提示。随机、取消、管理员手动入队及现有队列保持原规则。
- 保留现有未提交修改，不提交、分支、发布或部署；测试使用既有隔离夹具。

## 实施与验证

- [x] 扩展已有设置契约、表单自动保存、点歌桥接和 Server 租户同步用例，先确认新增行为失败。
- [x] 增加共享默认/校验/序列化、表单控件和提交字段、桥接层格式限制；补齐服务器可选布尔设置和协议 schema/fixture。
- [x] 同步 Live 设置 API、存储参考、指令说明及应用内点歌指南；同步 Server requirement、acceptance、protocol。交互引导只介绍入口，未受影响。
- [x] Live：`node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/queue-service.test.js test/songs/random-song-filter.test.js test/cloud-sync/cloud-sync-controller.test.js test/cloud-sync/cloud-runtime-sync.test.js`。
- [x] Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/cloud-state-sync.test.js test/settings-input-contract.test.js test/device-write-boundaries.test.js test/cloud-sync-http.test.js`。
- [x] `npm run verify:docs`（Live）、`npm run docs:check`（Server）；相关 JS 语法检查。表单沿用现有控件、自动保存和回填，Node/VM 已验证设置流程，本次未另建 Electron 检查。
- [x] 审阅两仓 touched diff、`git diff --check` 与状态，确认无敏感/运行数据进入本任务改动。

## 验证记录

- 2026-11-13：实现前新增 Live 四项、Server 两项筛选测试均按预期失败；实现后 Live 六个完整相关文件 97/97、Server 四个完整相关文件 40/40 通过，无跳过。
- Live 文档 10/10、Server 文档/协议/架构 60/60 通过；九个改动 JavaScript 文件语法检查通过。
- 设置保存、重建、默认关闭、非法标量整批拒绝、旧快照省略保留与租户隔离均沿用现有覆盖扩展；普通弹幕和 SC 均验证无空格无副作用、带空格只入队一次，以及取消、随机和关闭后恢复原格式。
- 技术契约与应用内使用说明同步；架构、页面入口和交互引导流程未变。未单独复验 Electron 窗口、真实直播或生产跨设备同步；未提交、打包或部署。
- 保留用户既有礼物修改及并行的点歌失败原因修改；最终审阅只归属本任务新增的字段、控件、格式检查与覆盖。

## 失败处理与完成条件

失败时只修正本任务具体改动，保留其他修改，不破坏性回滚。默认关闭、启用后两种消息来源的紧连格式均无副作用、空格格式可入队、关闭恢复旧行为、保存与兼容同步通过、文档一致且差异审阅完成后交付。线上服务与已安装客户端需后续更新才能包含源码变更。
