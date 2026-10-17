# SC 点歌开关实施计划

**Status:** Completed

**Goal:** 点歌规则可关闭 SC 点歌；关闭后 SC 保留为留言，不进入点歌队列或点歌板。明确非大航海点歌间隔按同一观众计时。

**Architecture:** 沿用共享点歌设置、settings 同步和 Bilibili → music 桥接入口。SC 留言消费路径保持独立；队列和点歌板继续使用现有数据源。

**Tech Stack:** CommonJS、原生 ESM/HTML/CSS、SQLite settings、Electron。

## 当前行为与边界

- `MessageHandlers.handleSuperChat` 先调用 `onSuperChat`，再把点歌指令交给 `onMessage`；`handleDanmakuMessage` 统一解析普通及随机点歌。
- `userCooldownSeconds` 已供非大航海使用；三档大航海空串沿用该值，显式 0 不限制。只澄清文案，不增加重复配置或改变已存间隔。
- 新增 `scSongRequestEnabled` 默认 true，保存为字符串、云端为 boolean。旧云端快照缺字段不覆盖本地；旧客户端省略字段不重置服务端已存值。
- 不改变 SC 展示、删除、金额置顶、已有队列、冷却持久化、账号/授权边界；不提交、打包或部署。
- 保留 Live 和 lira-server 两仓既有未提交改动。

## 所有者与同步材料

- Live：`src/shared/song-request-settings.js`（默认/校验/序列化）、`src/bilibili/bilibili-message-handler.js`（指令入口）、`src/bilibili/diagnostics.js`（诊断）、`public/js/admin/settings-form.js`（保存）、`public/pages/admin/song/request-rules.html` / 对应 CSS（表单）。
- Server：`src/lib/streamer-sync-settings.js` 的既有可选同步字段集合，Device/Management OpenAPI 与 `settings-input.json` fixture。
- 文档：Live 的 API、storage、Bilibili danmaku 参考及内置点歌指南/FAQ/设置索引；Server 的 client-server protocol 及受影响 requirements/acceptance。既有架构和交互式引导不变。
- 测试：Live settings-contract、frontend-song-request-settings、queue-service、bilibili-superchat/diagnostics；Server cloud-state-sync、settings-input-contract、cloud-sync-http。

## 实施与验证

- [x] 在现有队列测试补足关闭 SC 后普通/随机 SC 不入队、不计冷却、不产生回复，已有歌曲保留、普通弹幕可点、重开可点。
- [x] 接入设置与桥接，关键分支为：

  ```js
  if (source === 'superchat' && settings.scSongRequestEnabled === 'false') {
    return { accepted: false, reason: 'SC 点歌已关闭。' };
  }
  ```

- [x] 表单增加「接受 SC 点歌」开关；关闭选项「关闭 · 仅显示留言」。非大航海间隔帮助说明按每位观众分别计时，三档大航海留空沿用；沿用既有四列布局。
- [x] Server 可选 boolean 字段保存和返回，并延伸已有旧客户端省略、租户隔离、标量校验测试。更新协议与指南，使用既有隔离 Electron 文档 fixture 检查实际表单及更新截图。
- [x] Live：`node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/queue-service.test.js test/bilibili/bilibili-superchat.test.js test/bilibili/bilibili-diagnostics.test.js test/admin/frontend-admin-shell.test.js test/admin/frontend-usage-guide.test.js test/cloud-sync/cloud-sync-controller.test.js test/cloud-sync/cloud-runtime-sync.test.js`。
- [x] Server：`runtime/node/node.exe --test test/cloud-state-sync.test.js test/settings-input-contract.test.js test/cloud-sync-http.test.js`。
- [x] 文档与结构：Live `npm run verify:docs`、`npm run verify:architecture`；Server `npm run docs:check`。新设置按现有扩展机制接入，不跑无关全量测试；固定发布契约锁不擅自更新。
- [x] 两仓检查本次 diff、`git diff --check`、`git status --short`；确认无生成/秘密/运行数据进入 diff。

## 失败处理与完成条件

失败时保留用户修改，按本次具体 hunks 修正或回退，不重置工作区。只有开关行为、兼容同步、UI 和相应文档验证完成后标记完成。验收记录区分本地源码验证与未执行的打包、部署及真实直播环境。

## 验证记录

- 2026-10-16：先补的四项定向用例在旧实现失败；实现后通过。Live 组合 93 项通过，最后补默认值断言及截图说明后，相关 settings/指南 33 项复验通过（与组合测试重叠，不累加）。Server 37 项通过；初次系统 Node 24.21 被项目版本规则拒绝，改用仓库已有 Node 24.15 后通过，未改运行时保护。
- Live 架构 27 项、文档 10 项，Server 文档/协议门禁 57 项通过；Impeccable 对本次表单/CSS/保存模块检测无发现。
- 复用现有文档 Electron fixture，使用独立 tmp 数据和 userData、随机端口、真实 preload/授权，导航前 `/license` 与 `/admin` 均 HTTP 200。实际点击关闭 → 保存仅发 1 个请求 → 刷新仍为 false；冷却 60 秒与按小时模式正常保存、帮助说明可见、控件无重复或溢出。截图为 1440 宽桌面中 1396×760 的面板，已更新两份正式指南 WebP 与尺寸/说明。
- 测试、技术参考、Server requirement/acceptance/protocol/OpenAPI/fixture、内置指南及截图同步。交互式引导只介绍主入口，仍准确，不改。无数据库迁移或新增运行依赖。
- 两仓任务 diff 已审查，空白检查通过；原有用户修改保留。未提交、打包、更新发布契约锁、部署或连接真实直播间；账号同步上线需包含 Server 此可选字段。
- 隔离 Electron PID 20980 已正常关闭。安全策略拒绝删除本次 `tmp/sc-song-request-qa-nMJxx6/` 的合成 data/profile 和临时启动脚本，仅返回 `blocked by policy`；未重试绕过，临时材料仍在被忽略的 tmp 下，未进入 diff。
