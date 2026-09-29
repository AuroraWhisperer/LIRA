# 点歌设置迁移与黑名单实施计划

**Status:** Completed

## 目标与边界

将五项点歌规则移至第三个「点歌板」标签的样式上方，并在规则与样式之间加入黑名单。直播账号、直播间和全局「接收弹幕和礼物」仍由设置页管理。

黑名单每行一项，完整匹配「点歌」后的内容；`78` 拦截 `点歌78` 和 `点歌 78`，不拦截包含 `78` 的完整歌名。沿用指令的空白清洗规则，区分大小写。空名单不拦截；保存后只影响后续普通弹幕点歌，不删除已有队列，不修改随机点歌或手动入队。

## 现状与所有权

- `public/pages/admin/song/settings.html`、`queue-theme.html`：现有设置与点歌板表单；保留控件 ID 和样式。
- `public/js/admin/settings-form.js`：拆分连接设置和点歌规则的保存范围。规则与黑名单共用一个独立表单，不参与主题自动保存。
- `src/server/settings-contract.js`、`src/storage/settings-defaults.js`：新增本地字符串设置 `songRequestBlacklist`，默认空，按行清洗、去空、去重；非字符串整批拒绝。沿用 settings 表，无 schema 迁移，无新增云端同步键。
- `src/bilibili/bilibili-message-handler.js`：在自动补全、冷却写入和入队前拦截；`diagnostics.js` 记录可识别的拒绝类型。
- 契约：`docs/reference/backend/{api,storage,bilibili/danmaku}.md`、`docs/reference/frontend/app.md`；同步调整相关使用指南入口。

## 兼容性

保持已有设置键、HTTP 路径、云同步字段、认证与 Electron 安全边界。新增键通过既有 INSERT OR IGNORE 默认值初始化，重复初始化不覆盖用户配置。工作区已有大量修改，使用任务前文件快照区分本次变更，不提交、分支或清理用户修改。

## 里程碑与验证

- [x] 添加并运行聚焦回归：完整匹配在自动补全之前拦截、拦截不消耗冷却/写请求、包含词汇允许入队、清空恢复、设置持久化和非法批次原子拒绝。
- [x] 实现默认值、规范化及弹幕入口拦截。
- [x] 迁移表单、接入黑名单并验证两个表单提交范围独立。
- [x] 更新契约及页面指南。
- [x] 聚焦测试通过；隔离 Electron 检查布局顺序、表单归属、保存与重载，确认没有重复控件或提交。
- [x] 检查任务差异、`git diff --check` 和 `git status --short`，完成后归档计划。

命令：

```text
node --experimental-vm-modules --test test/settings/settings-contract.test.js test/settings/frontend-song-request-settings.test.js test/songs/song-request-autocomplete.test.js test/songs/random-song-filter.test.js test/songs/queue-service.test.js test/admin/admin-page-composition.test.js test/admin/frontend-admin-startup.test.js test/gifts/frontend-blindbox-mapping-refresh.test.js
node scripts/check-js.js
npm run verify:architecture
npm run verify:docs
git diff --check
git status --short
```

Electron QA 使用独立临时数据库、profile 和随机本地端口，以真实 preload 和桌面认证机制加载管理页面；测试后关闭自己启动的窗口/服务。检查空名单、命中与非命中、清空保存；截图检查五项规则、黑名单、样式的顺序与可见性。

## 失败处理与完成条件

失败时只检查并修正任务拥有的差异；如需撤回，依据任务前快照逐段还原本次修改。不会覆盖工作区其他内容或读取真实用户数据库。行为测试、桌面检查、契约同步及最终差异审查完成后方可标记完成。

## 验证记录

- 初次新增四项回归均按预期失败；实现后八个聚焦文件的 54 项测试通过。补充运行使用指南 16 项、主题/运行时/toast/新表单 26 项均通过；新表单在两轮中重复验证，不重复计数。
- 桌面检查发现主题自动保存会覆盖尚未保存的点歌草稿。沿用 `formsService.fillForm` 已有的 `data-preserve-dirty` 支持，保存失败及请求途中继续编辑保留草稿，保存成功只释放未再修改的字段；补充相应异步回归并通过相关 11 项检查。
- Electron 43 使用独立临时数据库/profile、随机端口、真实服务/preload/桌面请求认证；匿名 `/admin` 401，授权 200。五项规则和黑名单只出现在第三个标签，各 ID 唯一且无嵌套表单；界面每次保存只产生一个所属字段的 POST。重载可回填，清空可保存，切换样式/保存连接不会覆盖规则草稿。
- 1426×849 桌面内容区检查中，点歌设置、黑名单、保存按钮和六个既有样式均可完整显示，无水平溢出。界面扫描只报告原有隐藏账号头像缺少 src，头像由登录状态动态设置，不属本次新增问题。
- `node scripts/check-js.js`：1049 个 JavaScript 文件通过；后续表单修改再次通过 `node --check`。`verify:docs` 九项通过。
- `verify:architecture`：20 项通过、2 项被本次未修改的工作区问题阻断：`public/css/admin/gift-display.css` 633 行和 `test/gifts/frontend-gift-display-settings.test.js` 632 行缺少文件级大小审查；`public/js/admin/start-animation.js` 超出空 catch 基线。未扩大范围修复。
- 任务差异与工作区初始快照对照审查；`git diff --check` 通过，没有暂存、提交或引入运行时数据。隔离 Electron 及服务已关闭。
