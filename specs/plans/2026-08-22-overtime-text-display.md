# 加班机文字展板实施计划

**目标**：在现有数字倒计时和礼物时间规则之上增加“文字展板”规则；管理员可为某个礼物输入最多 6 个字符，送出后只展示文字、不参与时间计算。

**非目标**：不改变数字倒计时算法、fixed/random 规则、礼物检测去重/静默窗口、加班机页面地址或现有背景配置。

**所有权与约束**：后端 owner 为 `src/overtime/`，契约为 `docs/architecture/backend/overtime.md` 与 `docs/architecture/backend/api.md` §11；Admin/叠加层消费者分别为 `public/js/admin/overtime-rule-editor.js`、`public/js/overlays/overtime.js`；聚焦测试为 `test/overtime-service.test.js`、`test/overtime-routes.test.js`、`test/overtime-overlay.test.js`、`test/overtime-rule-editor.test.js`。保持 Node.js 24+、CommonJS 后端、Vanilla JS ESM 前端、参数化 SQL、session token、`textContent` 输出。

## 当前行为

- 规则模式只有 fixed/random，规则表 CHECK 也只允许这两个值。
- 礼物结算统一通过 `resolveGiftSettlement` 修改时间并广播 `overtime:update`。
- Admin 规则编辑器只有“直接改时间/随机抽结果”两项；叠加层效果卡将规则显示为“加时/减时/盲盒”。

## Proposed Changes

1. 新增 `MAX_DISPLAY_TEXT_LENGTH = 6` 和 display 规则服务端校验；`displayText` 存入现有 `outcomes_json`。
2. 增加 gift DB v7 迁移并更新 schema/存储归一化，保留旧规则数据。
3. 在 Admin 编辑器加入“文字展板”模式及输入框，保存/读取 displayText；更新结算列表文案。
4. 在 `/overtime` 卡片显示 displayText；display 结算不触发时间正负动画。
5. 补充 focused tests、规格/架构事实源并运行快速门禁。

## Milestones & Verification

1. **契约与存储**：先补校验、迁移、规则归一化和 display 结算测试；运行 `node --test test/overtime-service.test.js test/overtime-limits-roundtrip.test.js`。
2. **Admin 编辑器**：补模式输入、长度限制、读写和摘要测试；运行 `node --test test/overtime-rule-editor.test.js`。
3. **叠加层**：补 display 卡片/动画回归断言；运行 `node --test test/overtime-overlay.test.js`。
4. **路由与全量检查**：运行 `node --test test/overtime-routes.test.js`、`npm run check`、`npm run verify:quick`，最后审阅 `git diff --check` 与 `git status --short`。

## Rollback / Failure Handling

只回滚本计划新增或修改的文件；不使用 `git reset --hard`、广泛 checkout 或删除命令。若 v7 迁移或 display 结算测试失败，停止扩大范围，保留旧 fixed/random 路径并检查迁移事务回滚。

## Done When

- Admin 能保存并重新加载 display 规则，服务端拒绝非法长度/字符。
- display 礼物结算不改变剩余时间且保持幂等；叠加层显示自定义文字并不显示时间增减动画。
- 旧数据库升级到 v7 后原有数据不丢失；聚焦测试、语法检查、快速验证通过；最终差异不包含无关文件。
